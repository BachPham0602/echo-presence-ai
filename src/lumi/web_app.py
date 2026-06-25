from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse
import html
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import time_ns
from urllib.parse import unquote, urlparse
import wave
import struct
import math

from lumi.config import LumiConfig
from lumi.errors import LumiProviderError
from lumi.mvp_pipeline import LumiMvpPipeline
from lumi.output_metadata import write_audio_sidecars
from lumi.providers.speaker import list_speaker_profiles
import threading

pipeline_lock = threading.Lock()

class LumiWebHandler(BaseHTTPRequestHandler):
    pipeline: LumiMvpPipeline
    config: LumiConfig
    output_dir: Path

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Bot-Pronoun, X-User-Pronoun, X-Owner-Name, X-Sample-Index, X-Prompt")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_HEAD(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            data = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._send_html(INDEX_HTML)
            return
        if path == "/api/speakers":
            self._send_json({"speakers": list_speaker_profiles(self.config.owner_voice_path)})
            return
        if path.startswith("/outputs/"):
            self._serve_output_file(path)
            return
        self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/text":
                self._handle_text()
            elif path == "/api/audio":
                self._handle_audio()
            elif path == "/api/chat":
                self._handle_chat()
            elif path == "/api/voice_chat":
                self._handle_voice_chat()
            elif path == "/api/voice_text":
                self._handle_voice_text()
            elif path == "/api/owner_voice_sample":
                self._handle_owner_voice_sample()
            elif path == "/api/flush":
                self._handle_flush()
            elif path == "/api/voice_stream":
                self._handle_voice_stream()
            elif path == "/api/interrupt":
                self._handle_interrupt()
            elif path == "/api/clear":
                with pipeline_lock:
                    self.pipeline.clear_history()
                self._send_json({"status": "cleared"})
            else:
                self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except LumiProviderError as exc:
            self._send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self._send_json({"error": f"Lỗi server: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[web] {self.address_string()} - {fmt % args}")

    def _handle_text(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        if not text:
            self._send_json({"error": "Text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        with pipeline_lock:
            result = self.pipeline.handle_text(text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        self._send_json(_payload_from_result(result))

    def _handle_chat(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        if not text:
            self._send_json({"error": "Text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        with pipeline_lock:
            result = self.pipeline.handle_chat(text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result))

    def _handle_voice_text(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        owner_name = payload.get("owner_name") or user_pronoun
        if not text:
            self._send_json({"error": "Voice text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        voice_user_pronoun = user_pronoun or owner_name
        with pipeline_lock:
            result = self.pipeline.handle_voice_transcript(
                text, bot_pronoun=bot_pronoun, user_pronoun=voice_user_pronoun
            )
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result))

    def _handle_flush(self) -> None:
        payload = self._read_json()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        mode = str(payload.get("mode", "text")).strip().lower()
        with pipeline_lock:
            if mode == "voice":
                result = self.pipeline.flush_voice_chat(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, is_timeout=True)
            else:
                result = self.pipeline.flush_chat(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result))

    def _handle_voice_stream(self) -> None:
        payload = self._read_json()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        
        # We must NOT use pipeline_lock for the entire stream, otherwise it blocks /api/interrupt
        # But we do need thread safety for history. We'll rely on the pipeline's own mechanisms or stream outside the lock.
        generator = self.pipeline.flush_voice_chat_stream(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, is_timeout=True)
        
        try:
            for chunk_data in generator:
                data_str = json.dumps(chunk_data, ensure_ascii=False)
                self.wfile.write(f"data: {data_str}\n\n".encode("utf-8"))
                self.wfile.flush()
        except Exception as e:
            print(f"[ERROR] Voice Stream error: {e}")
            
    def _handle_interrupt(self) -> None:
        self.pipeline.interrupt_event.set()
        self._send_json({"status": "interrupting"})

    def _handle_audio(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"error": "Audio body rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        bot_pronoun = unquote(self.headers.get("X-Bot-Pronoun", "")) or None
        user_pronoun = unquote(self.headers.get("X-User-Pronoun", "")) or None
        self.output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = self.output_dir / f"web_input_{time_ns()}.wav"
        audio_path.write_bytes(self.rfile.read(length))
        with pipeline_lock:
            result = self.pipeline.handle_audio_file(audio_path, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        self._send_json(_payload_from_result(result))

    def _handle_voice_chat(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"error": "Audio body rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        bot_pronoun = unquote(self.headers.get("X-Bot-Pronoun", "")) or None
        user_pronoun = unquote(self.headers.get("X-User-Pronoun", "")) or None
        owner_name = unquote(self.headers.get("X-Owner-Name", "")) or None
        self.output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = self.output_dir / f"web_input_voice_{time_ns()}.wav"
        audio_data = self.rfile.read(length)
        audio_path.write_bytes(audio_data)
        
        # Lọc tạp âm môi trường và giọng nói quá xa bằng RMS
        try:
            with wave.open(str(audio_path), 'rb') as wf:
                nframes = wf.getnframes()
                if nframes > 0:
                    data = wf.readframes(nframes)
                    # Float32 buffer từ browser khi encodeWav đã chuyển sang 16-bit PCM.
                    samples = struct.unpack(f"<{nframes}h", data)
                    sum_sq = sum(s * s for s in samples)
                    rms = math.sqrt(sum_sq / nframes)
                    if rms < 300: # Ngưỡng tiếng ồn, nếu nhỏ hơn là người ở xa hoặc tiếng quạt
                        reason = "Âm thanh quá nhỏ hoặc ở xa"
                        write_audio_sidecars(
                            audio_path,
                            f"[Không có transcript]\n{reason}",
                            {
                                "audio_role": "user_input",
                                "channel": "voice",
                                "status": "ignored",
                                "reason": reason,
                                "rms": rms,
                            },
                        )
                        payload = {"status": "ignored", "reason": reason}
                        _attach_input_audio_links(payload, audio_path)
                        self._send_json(payload)
                        return
        except Exception as e:
            print(f"Lỗi đọc RMS: {e}")

        with pipeline_lock:
            result = self.pipeline.handle_voice_chat(
                audio_path,
                bot_pronoun=bot_pronoun,
                user_pronoun=user_pronoun,
                owner_name=owner_name,
            )
        if isinstance(result, dict):
            payload = dict(result)
            _attach_input_audio_links(payload, audio_path)
            self._send_json(payload)
        else:
            self._send_json(_payload_from_result(result))

    def _handle_owner_voice_sample(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"error": "Audio body rỗng."}, HTTPStatus.BAD_REQUEST)
            return

        owner_name = unquote(self.headers.get("X-Owner-Name", "")).strip()
        if not _is_safe_owner_name(owner_name):
            self._send_json({"error": "Tên người dùng không hợp lệ."}, HTTPStatus.BAD_REQUEST)
            return

        try:
            sample_index = int(self.headers.get("X-Sample-Index", "1"))
        except ValueError:
            sample_index = 1
        sample_index = max(1, min(sample_index, 99))

        owner_dir = self.config.owner_voice_path / owner_name
        owner_dir.mkdir(parents=True, exist_ok=True)
        audio_path = owner_dir / f"{sample_index:02d}_{time_ns()}.wav"
        audio_path.write_bytes(self.rfile.read(length))
        sample_count = len(list_speaker_profiles(self.config.owner_voice_path))
        saved_samples = len([path for path in owner_dir.iterdir() if path.is_file() and path.suffix.lower() == ".wav"])
        self._send_json({
            "status": "saved",
            "speaker": owner_name,
            "filename": audio_path.name,
            "sample_count": saved_samples,
            "profile_count": sample_count,
        })

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _serve_output_file(self, path: str) -> None:
        filename = Path(unquote(path.removeprefix("/outputs/"))).name
        file_path = self.output_dir / filename
        if not file_path.exists() or not file_path.is_file():
            self._send_json({"error": "Output file not found"}, HTTPStatus.NOT_FOUND)
            return
        suffix = file_path.suffix.lower()
        if suffix == ".wav":
            content_type = "audio/wav"
        elif suffix == ".txt":
            content_type = "text/plain; charset=utf-8"
        elif suffix == ".json":
            content_type = "application/json; charset=utf-8"
        else:
            content_type = "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_html(self, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _is_safe_owner_name(value: str) -> bool:
    value = value.strip()
    return bool(
        value
        and value not in {".", ".."}
        and "/" not in value
        and "\\" not in value
        and chr(0) not in value
    )


def _payload_from_result(result) -> dict:
    payload = {
        "input_text": result.input_text,
        "response_text": result.response_text,
        "audio_url": _output_file_url(result.audio_path),
        "audio_text_url": _sidecar_url(result.audio_path, ".txt"),
        "audio_metadata_url": _sidecar_url(result.audio_path, ".json"),
        "tts_engine": result.tts_engine,
    }
    if result.input_audio_path:
        _attach_input_audio_links(payload, result.input_audio_path)
    return payload


def _attach_input_audio_links(payload: dict, audio_path: str | Path | None) -> None:
    if not audio_path:
        return
    payload["input_audio_url"] = _output_file_url(audio_path)
    payload["input_text_url"] = _sidecar_url(audio_path, ".txt")
    payload["input_metadata_url"] = _sidecar_url(audio_path, ".json")


def _output_file_url(path: str | Path | None) -> str | None:
    if not path:
        return None
    return f"/outputs/{html.escape(Path(path).name)}"


def _sidecar_url(audio_path: str | Path | None, suffix: str) -> str | None:
    if not audio_path:
        return None
    sidecar_path = Path(audio_path).with_suffix(suffix)
    if not sidecar_path.exists():
        return None
    return _output_file_url(sidecar_path)


def run_server(config: LumiConfig, host: str, port: int) -> None:
    pipeline = LumiMvpPipeline(config)
    if config.cuda_visible_devices:
        print(f"CUDA_VISIBLE_DEVICES={config.cuda_visible_devices} (GPU vật lý Lumi được phép dùng)")
    output_dir = config.output_path
    output_dir.mkdir(parents=True, exist_ok=True)
    config.owner_voice_path.mkdir(parents=True, exist_ok=True)

    print("Đang nạp AI models lên GPU (warm-up), vui lòng đợi...")
    if hasattr(pipeline.asr, "_load_pipeline"):
        pipeline.asr._load_pipeline()
    if hasattr(pipeline.response_generator, "_load_model"):
        pipeline.response_generator._load_model()
    if hasattr(pipeline.tts, "_load_engine"):
        pipeline.tts._load_engine()
    print("Nạp model hoàn tất!")

    class Handler(LumiWebHandler):
        pass

    Handler.pipeline = pipeline
    Handler.config = config
    Handler.output_dir = output_dir

    server = ThreadingHTTPServer((host, port), Handler)
    url_host = "127.0.0.1" if host in {"0.0.0.0", ""} else host
    print(f"Lumi web đang chạy: http://{url_host}:{port}")
    print("Nếu dùng máy remote, hãy port-forward về localhost để browser được phép dùng microphone.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLumi web đã dừng.")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Lumi web: browser record -> backend model pipeline.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--response-provider", choices=["qwen", "template"], default=None)
    parser.add_argument("--tts-provider", choices=["vieneu", "no-audio", "edge-tts"], default=None)
    parser.add_argument("--asr-provider", choices=["phowhisper"], default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--cuda-visible-devices", default=None, help="GPU vật lý mà Lumi được phép thấy, mặc định 1. Ví dụ: 1 hoặc 1,2.")
    args = parser.parse_args()

    base = LumiConfig.from_env()
    config = LumiConfig(
        owner_name=base.owner_name,
        bot_pronoun=base.bot_pronoun,
        user_pronoun=base.user_pronoun,
        silence_seconds=base.silence_seconds,
        debug=base.debug,
        asr_model=base.asr_model,
        llm_model=base.llm_model,
        speaker_model=base.speaker_model,
        asr_provider=args.asr_provider or base.asr_provider,
        response_provider=args.response_provider or base.response_provider,
        tts_provider=args.tts_provider or base.tts_provider,
        tts_mode=base.tts_mode,
        tts_voice=base.tts_voice,
        llm_max_new_tokens=base.llm_max_new_tokens,
        llm_voice_max_new_tokens=base.llm_voice_max_new_tokens,
        llm_temperature=base.llm_temperature,
        llm_repetition_penalty=base.llm_repetition_penalty,
        llm_no_repeat_ngram_size=base.llm_no_repeat_ngram_size,
        output_dir=args.output_dir or base.output_dir,
        owner_voice_dir=base.owner_voice_dir,
        cuda_visible_devices=args.cuda_visible_devices if args.cuda_visible_devices is not None else base.cuda_visible_devices,
    )
    run_server(config, args.host, args.port)


INDEX_HTML = r"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lumi</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f3ee;
      color: #202124;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(246,243,238,0.96), rgba(238,242,244,0.96)),
        radial-gradient(circle at top left, #f8d49a, transparent 32rem),
        radial-gradient(circle at bottom right, #a8d8cf, transparent 28rem);
    }
    main {
      width: min(920px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 6vw, 72px);
      line-height: 0.95;
      letter-spacing: 0;
    }
    .status {
      min-width: 220px;
      padding: 10px 12px;
      border: 1px solid #d8d5ce;
      border-radius: 8px;
      background: rgba(255,255,255,0.72);
      font-size: 14px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 18px;
    }
    button {
      border: 1px solid #202124;
      background: #202124;
      color: #fff;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 15px;
      cursor: pointer;
    }
    button.secondary {
      background: #fff;
      color: #202124;
      border-color: #c7c2ba;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    textarea {
      width: 100%;
      min-height: 92px;
      resize: vertical;
      border: 1px solid #c7c2ba;
      border-radius: 8px;
      padding: 14px;
      font: inherit;
      background: rgba(255,255,255,0.78);
    }
    input[type="text"] {
      border: 1px solid #c7c2ba;
      border-radius: 8px;
      padding: 10px;
      font: inherit;
      background: rgba(255,255,255,0.78);
      width: 150px;
    }
    .settings {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      align-items: center;
      font-size: 14px;
    }
    .guide-panel {
      display: none;
      border: 1px solid #ddd8d0;
      border-radius: 8px;
      background: rgba(255,255,255,0.78);
      padding: 14px;
      margin-bottom: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    .guide-panel.open { display: block; }
    .guide-panel code {
      background: #f1eee8;
      border-radius: 6px;
      padding: 2px 5px;
    }
    .guide-panel pre {
      overflow-x: auto;
      background: #f1eee8;
      border-radius: 8px;
      padding: 10px;
      margin: 8px 0;
    }
    .conversation {
      display: grid;
      gap: 12px;
      margin-top: 18px;
    }
    .message {
      border: 1px solid #ddd8d0;
      border-radius: 8px;
      background: rgba(255,255,255,0.78);
      padding: 14px;
      white-space: pre-wrap;
    }
    .label {
      display: block;
      margin-bottom: 6px;
      color: #62605a;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .message-details {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #e4dfd7;
      color: #54504a;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    audio {
      width: 100%;
      margin-top: 10px;
    }
    @media (max-width: 680px) {
      header { align-items: stretch; flex-direction: column; }
      .status { min-width: 0; }
      button { flex: 1; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Lumi</h1>
      <div class="status" id="status">Sẵn sàng</div>
    </header>

    <div class="settings">
      <label>Lumi xưng là: <input type="text" id="botPronoun" value="Lumi"></label>
      <label>gọi người dùng là: <input type="text" id="userPronoun" value="bạn"></label>
      <label>người nói voice: <select id="speakerSelect"><option value="">Chưa có profile</option></select></label>
      <button class="secondary" id="voiceGuideBtn" type="button">Hướng dẫn owner voice</button>
    </div>

    <section class="guide-panel" id="voiceGuidePanel" aria-live="polite">
      <strong>Tạo owner voice</strong>
      <p>Nút này dùng để thu các câu mẫu của một người nói và lưu thành profile trong <code>owner_voices/&lt;tên&gt;</code>. Sau đó Voice Chat sẽ dùng profile đó để nhận diện đúng người và gọi đúng tên.</p>
      <label>Tên người dùng: <input type="text" id="ownerVoiceName" placeholder="Ví dụ: Minh"></label>
      <p><strong>Câu mẫu cần đọc:</strong> <span id="ownerPromptText"></span></p>
      <div class="toolbar">
        <button class="secondary" id="ownerRecordBtn" type="button">Thu câu 1</button>
        <button class="secondary" id="ownerResetBtn" type="button">Thu lại từ đầu</button>
      </div>
      <p id="ownerEnrollStatus">Cần thu 5 câu, mỗi câu khoảng 4 giây, nói rõ gần micro và ít nhiễu.</p>
    </section>

    <div class="toolbar">
      <button id="voiceToggleBtn">Bật Voice Chat</button>
    </div>

    <textarea id="textInput" placeholder="Nhập text cho Lumi..."></textarea>
    <div class="toolbar">
      <button class="secondary" id="sendTextBtn">Gửi text</button>
      <button class="secondary" id="clearBtn">Xóa</button>
    </div>

    <section class="conversation" id="conversation"></section>
  </main>

  <script>
    const statusEl = document.getElementById('status');
    const voiceToggleBtn = document.getElementById('voiceToggleBtn');
    const sendTextBtn = document.getElementById('sendTextBtn');
    const clearBtn = document.getElementById('clearBtn');
    const textInput = document.getElementById('textInput');
    const botPronounInput = document.getElementById('botPronoun');
    const userPronounInput = document.getElementById('userPronoun');
    const speakerSelect = document.getElementById('speakerSelect');
    const voiceGuideBtn = document.getElementById('voiceGuideBtn');
    const voiceGuidePanel = document.getElementById('voiceGuidePanel');
    const ownerVoiceNameInput = document.getElementById('ownerVoiceName');
    const ownerPromptText = document.getElementById('ownerPromptText');
    const ownerRecordBtn = document.getElementById('ownerRecordBtn');
    const ownerResetBtn = document.getElementById('ownerResetBtn');
    const ownerEnrollStatus = document.getElementById('ownerEnrollStatus');
    const conversation = document.getElementById('conversation');

    let stream = null;
    let audioContext = null;
    let source = null;
    let processor = null;
    let zeroGain = null;
    let buffers = [];
    let textIsBuffered = false;
    let textFlushTimer = null;
    let textIsProcessing = false;
    let voiceIsBuffered = false;
    let voiceFlushTimer = null;

    let isVoiceActive = false;
    let voiceIsSpeaking = false;
    let voiceSilenceTimer = null;
    let voiceAudioElement = null;
    let currentAudioQueue = null;
    let voiceIsProcessing = false;
    let ownerEnrollIndex = 0;
    let ownerEnrollRecording = false;
    const VOICE_THRESHOLD = 0.06;
    const OWNER_SAMPLE_PHRASES = [
      'Lumi ơi, đây là giọng của tôi.',
      'Hôm nay tôi muốn trò chuyện với Lumi.',
      'Tôi đang kiểm tra hệ thống nhận diện giọng nói.',
      'Khi tôi nói, Lumi hãy gọi đúng tên của tôi.',
      'Tôi muốn Lumi ghi nhớ đây là giọng chủ nhân.'
    ];
    const OWNER_SAMPLE_SECONDS = 4;

    function resetTextFlushTimer() {
      if (textFlushTimer) clearTimeout(textFlushTimer);
      if (!textIsBuffered) return;
      textFlushTimer = setTimeout(async () => {
        if (textInput.value.trim().length > 0) {
          setStatus('Đang chờ nhập...');
          resetTextFlushTimer();
          return;
        }
        textIsBuffered = false;
        try {
          setStatus('Đang phản hồi...');
          const botP = botPronounInput.value.trim() || 'Lumi';
          const userP = userPronounInput.value.trim() || 'bạn';
          const flushData = await postJson('/api/flush', { mode: 'text', bot_pronoun: botP, user_pronoun: userP });
          if (flushData.response_text) {
            addMessage('Lumi', flushData.response_text, flushData.audio_url);
          }
          setStatus('Sẵn sàng');
        } catch (err) {
          setStatus(err.message);
        }
      }, 2500);
    }

    class AudioQueue {
      constructor() {
        this.queue = [];
        this.isPlaying = false;
        this.currentAudio = null;
        this.interrupted = false;
      }
      add(base64Audio) {
        if (this.interrupted) return;
        this.queue.push(base64Audio);
        if (!this.isPlaying) this.playNext();
      }
      playNext() {
        if (this.interrupted || this.queue.length === 0) {
          this.isPlaying = false;
          this.currentAudio = null;
          return;
        }
        this.isPlaying = true;
        const b64 = this.queue.shift();
        const audio = new Audio("data:audio/wav;base64," + b64);
        this.currentAudio = audio;
        audio.onended = () => {
          this.currentAudio = null;
          this.playNext();
        };
        audio.play().catch(e => {
          console.error("AudioQueue play error", e);
          this.playNext();
        });
      }
      stop() {
        this.interrupted = true;
        this.queue = [];
        if (this.currentAudio) {
          this.currentAudio.pause();
          this.currentAudio = null;
        }
        this.isPlaying = false;
      }
    }

    function resetVoiceFlushTimer(waitMs = 2500) {
      if (voiceFlushTimer) clearTimeout(voiceFlushTimer);
      if (!voiceIsBuffered) return;
      voiceFlushTimer = setTimeout(async () => {
        voiceIsBuffered = false;
        try {
          setStatus('Đang phản hồi voice (Streaming)...');
          const botP = botPronounInput.value.trim() || 'Lumi';
          const speakerName = selectedSpeakerName();
          const userP = speakerName || userPronounInput.value.trim() || 'bạn';
          
          if (currentAudioQueue) {
             currentAudioQueue.stop();
          }
          currentAudioQueue = new AudioQueue();
          
          const response = await fetch('/api/voice_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_pronoun: botP, user_pronoun: userP })
          });
          
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          
          // Tạo sẵn một message rỗng để điền dần chữ vào
          const el = document.createElement('div');
          el.className = 'message';
          const labelEl = document.createElement('span');
          labelEl.className = 'label';
          labelEl.textContent = 'Lumi';
          el.appendChild(labelEl);
          const textNode = document.createTextNode('');
          el.appendChild(textNode);
          conversation.prepend(el);
          
          let fullText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // Giữ lại phần chưa hoàn chỉnh
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.substring(6);
                try {
                  const chunk = JSON.parse(dataStr);
                  if (chunk.text_chunk) {
                    fullText += chunk.text_chunk;
                    textNode.nodeValue = fullText;
                  }
                  if (chunk.audio_base64) {
                    currentAudioQueue.add(chunk.audio_base64);
                  }
                  if (chunk.status === 'interrupted') {
                    setStatus('Đã ngắt lời Lumi...');
                    return;
                  }
                } catch(e) { console.error("Parse chunk error", e); }
              }
            }
          }
          setStatus(isVoiceActive ? 'Voice Chat đang bật (Micro luôn mở)' : 'Sẵn sàng');
        } catch (err) {
          setStatus(err.message);
        }
      }, waitMs);
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function addMessage(label, text, audioUrl, detailsText) {
      const el = document.createElement('div');
      el.className = 'message';
      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = label;
      el.appendChild(labelEl);
      el.appendChild(document.createTextNode(text || ''));
      if (audioUrl) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.autoplay = true;
        audio.src = audioUrl;
        el.appendChild(audio);
        if (label === 'Lumi') {
          voiceAudioElement = audio;
          audio.addEventListener('play', resetVoiceCapture);
          audio.addEventListener('playing', resetVoiceCapture);
        }
      }
      if (detailsText) {
        const detailsEl = document.createElement('div');
        detailsEl.className = 'message-details';
        detailsEl.textContent = detailsText;
        el.appendChild(detailsEl);
      }
      conversation.prepend(el);
    }

    function addVoiceInputMessage(data) {
      const details = voiceInputDetails(data);
      if (data.input_text) {
        addMessage('Lumi nghe được', data.input_text, null, details);
        return;
      }
      if (data.status === 'ignored' || data.reason || data.input_audio_url) {
        addMessage('Voice input', data.reason || 'Không có transcript', null, details);
      }
    }

    function voiceInputDetails(data) {
      const lines = [];
      if (data.status) lines.push(`Trạng thái: ${data.status}`);
      if (data.reason) lines.push(`Lý do: ${data.reason}`);
      if (data.buffered_text) lines.push(`Đang gom câu: ${data.buffered_text}`);
      if (data.input_audio_url) lines.push(`Input audio: ${data.input_audio_url}`);
      if (data.input_text_url) lines.push(`Transcript file: ${data.input_text_url}`);
      if (data.input_metadata_url) lines.push(`Metadata: ${data.input_metadata_url}`);
      return lines.join('\n');
    }

    function responseDetails(data) {
      const lines = [];
      if (data.input_text) lines.push(`Lumi nghe được: ${data.input_text}`);
      if (data.tts_engine) lines.push(`TTS: ${data.tts_engine}`);
      if (data.audio_text_url) lines.push(`Lời audio: ${data.audio_text_url}`);
      if (data.audio_metadata_url) lines.push(`Metadata: ${data.audio_metadata_url}`);
      return lines.join('\n');
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    async function loadSpeakers() {
      try {
        const response = await fetch('/api/speakers');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không tải được danh sách người nói');
        const previous = localStorage.getItem('lumiSelectedSpeaker') || '';
        speakerSelect.innerHTML = '';
        if (!data.speakers || data.speakers.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'Thêm mẫu vào owner_voices/<tên>';
          speakerSelect.appendChild(option);
          return;
        }
        data.speakers.forEach(speaker => {
          const option = document.createElement('option');
          option.value = speaker.name;
          option.textContent = `${speaker.name} (${speaker.sample_count} mẫu)`;
          speakerSelect.appendChild(option);
        });
        const hasPrevious = data.speakers.some(speaker => speaker.name === previous);
        speakerSelect.value = hasPrevious ? previous : data.speakers[0].name;
        localStorage.setItem('lumiSelectedSpeaker', speakerSelect.value);
      } catch (error) {
        setStatus(error.message);
      }
    }

    function selectedSpeakerName() {
      return speakerSelect.value.trim();
    }

    speakerSelect.addEventListener('change', () => {
      const name = selectedSpeakerName();
      if (name) {
        localStorage.setItem('lumiSelectedSpeaker', name);
        setStatus(`Đã chọn người nói: ${name}`);
      }
    });

    voiceGuideBtn.addEventListener('click', () => {
      const isOpen = voiceGuidePanel.classList.toggle('open');
      voiceGuideBtn.textContent = isOpen ? 'Ẩn hướng dẫn owner voice' : 'Hướng dẫn owner voice';
      if (isOpen && !ownerVoiceNameInput.value.trim() && selectedSpeakerName()) {
        ownerVoiceNameInput.value = selectedSpeakerName();
      }
      updateOwnerEnrollUi();
    });

    ownerResetBtn.addEventListener('click', () => {
      ownerEnrollIndex = 0;
      updateOwnerEnrollUi();
      ownerEnrollStatus.textContent = 'Đã reset tiến trình thu. Các file đã lưu trước đó vẫn nằm trong owner_voices.';
    });

    ownerRecordBtn.addEventListener('click', recordNextOwnerSample);

    updateOwnerEnrollUi();
    loadSpeakers();

    function updateOwnerEnrollUi() {
      const phrase = OWNER_SAMPLE_PHRASES[Math.min(ownerEnrollIndex, OWNER_SAMPLE_PHRASES.length - 1)];
      ownerPromptText.textContent = phrase;
      if (ownerEnrollIndex >= OWNER_SAMPLE_PHRASES.length) {
        ownerRecordBtn.textContent = 'Đã thu đủ mẫu';
        ownerRecordBtn.disabled = true;
        return;
      }
      ownerRecordBtn.textContent = `Thu câu ${ownerEnrollIndex + 1}/${OWNER_SAMPLE_PHRASES.length}`;
      ownerRecordBtn.disabled = ownerEnrollRecording;
    }

    async function recordNextOwnerSample() {
      if (ownerEnrollRecording) return;
      if (isVoiceActive) {
        setStatus('Tắt Voice Chat trước khi thu owner voice');
        return;
      }
      if (ownerEnrollIndex >= OWNER_SAMPLE_PHRASES.length) {
        ownerEnrollIndex = 0;
      }
      const ownerName = ownerVoiceNameInput.value.trim();
      if (!ownerName) {
        setStatus('Nhập tên người dùng trước khi thu');
        ownerVoiceNameInput.focus();
        return;
      }

      ownerEnrollRecording = true;
      updateOwnerEnrollUi();
      try {
        const sampleNumber = ownerEnrollIndex + 1;
        ownerEnrollStatus.textContent = `Đang thu câu ${sampleNumber}/${OWNER_SAMPLE_PHRASES.length} trong ${OWNER_SAMPLE_SECONDS} giây...`;
        const wavBlob = await recordOwnerVoiceSample(OWNER_SAMPLE_SECONDS);
        const response = await fetch('/api/owner_voice_sample', {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/wav',
            'X-Owner-Name': encodeURIComponent(ownerName),
            'X-Sample-Index': String(sampleNumber),
            'X-Prompt': encodeURIComponent(OWNER_SAMPLE_PHRASES[ownerEnrollIndex])
          },
          body: wavBlob
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không lưu được mẫu giọng');

        ownerEnrollIndex += 1;
        ownerEnrollStatus.textContent = `Đã lưu ${data.filename} cho ${data.speaker}. Tổng mẫu WAV: ${data.sample_count}.`;
        localStorage.setItem('lumiSelectedSpeaker', ownerName);
        await loadSpeakers();
        speakerSelect.value = ownerName;
        if (ownerEnrollIndex >= OWNER_SAMPLE_PHRASES.length) {
          ownerEnrollStatus.textContent = `Đã thu đủ ${OWNER_SAMPLE_PHRASES.length} câu cho ${ownerName}. Có thể bật Voice Chat.`;
        }
      } catch (error) {
        setStatus(error.message);
        ownerEnrollStatus.textContent = error.message;
      } finally {
        ownerEnrollRecording = false;
        updateOwnerEnrollUi();
      }
    }

    async function recordOwnerVoiceSample(seconds) {
      const enrollStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const enrollContext = new AudioContext();
      const enrollSource = enrollContext.createMediaStreamSource(enrollStream);
      const enrollProcessor = enrollContext.createScriptProcessor(4096, 1, 1);
      const enrollGain = enrollContext.createGain();
      const enrollBuffers = [];
      const sampleRate = enrollContext.sampleRate;

      enrollGain.gain.value = 0;
      enrollProcessor.onaudioprocess = event => {
        enrollBuffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      enrollSource.connect(enrollProcessor);
      enrollProcessor.connect(enrollGain);
      enrollGain.connect(enrollContext.destination);

      await new Promise(resolve => setTimeout(resolve, seconds * 1000));

      enrollProcessor.disconnect();
      enrollSource.disconnect();
      enrollGain.disconnect();
      enrollStream.getTracks().forEach(track => track.stop());
      await enrollContext.close();

      return encodeWav(enrollBuffers, sampleRate);
    }

    async function handleVoiceUtterance(wavBlob) {
      if (voiceIsProcessing) return;
      voiceIsProcessing = true;
      resetVoiceCapture();
      if (voiceFlushTimer) clearTimeout(voiceFlushTimer);
      voiceIsBuffered = false;
      try {
        setStatus('Đang phân tích giọng nói...');
        const botP = botPronounInput.value.trim() || 'Lumi';
        const speakerName = selectedSpeakerName();
        if (!speakerName) {
          setStatus('Chưa chọn người nói voice');
          return;
        }
        const userP = speakerName;
        const response = await fetch('/api/voice_chat', {
          method: 'POST',
          headers: { 
            'Content-Type': 'audio/wav',
            'X-Bot-Pronoun': encodeURIComponent(botP),
            'X-User-Pronoun': encodeURIComponent(userP),
            'X-Owner-Name': encodeURIComponent(speakerName)
          },
          body: wavBlob
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed');
        
        addVoiceInputMessage(data);

        if (data.status === 'buffered') {
          setStatus('Lumi đang chờ bạn nói thêm...');
          voiceIsBuffered = true;
          resetVoiceFlushTimer(data.wait_ms || 2500);
        } else if (data.status === 'ignored') {
          setStatus(data.reason ? `Bỏ qua: ${data.reason}` : 'Sẵn sàng (bỏ qua do lẩm bẩm hoặc ồn)');
        } else if (data.response_text) {
          if (currentAudioQueue && currentAudioQueue.isPlaying) currentAudioQueue.stop();
          addMessage('Lumi', data.response_text, data.audio_url, responseDetails(data));
          if (data.audio_url) currentAudioQueue.add(data.audio_url);
          setStatus('Voice Chat đang bật (Micro luôn mở)');
        }
      } catch (error) {
        setStatus(error.message);
      } finally {
        voiceIsProcessing = false;
      }
    }

    voiceToggleBtn.addEventListener('click', async () => {
      if (isVoiceActive) {
        isVoiceActive = false;
        voiceToggleBtn.textContent = 'Bật Voice Chat';
        voiceToggleBtn.classList.remove('secondary');
        cleanupAudioGraph();
        setStatus('Sẵn sàng');
        return;
      }
      try {
        setStatus('Đang khởi động Voice Chat...');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        zeroGain = audioContext.createGain();
        zeroGain.gain.value = 0;
        buffers = [];

        processor.onaudioprocess = event => {
          if (!isVoiceActive) return;
          if (voiceIsProcessing || textIsProcessing || isTextInputActive()) {
            resetVoiceCapture();
            return;
          }
          const chunk = event.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < chunk.length; i++) {
            sumSquares += chunk[i] * chunk[i];
          }
          const rms = Math.sqrt(sumSquares / chunk.length);

          let currentThreshold = VOICE_THRESHOLD;
          if (currentAudioQueue && currentAudioQueue.isPlaying) {
             // Tăng ngưỡng nhận diện lên 3 lần khi loa đang phát (TTS)
             // Để tránh microphone bắt nhầm tiếng của chính mình (Acoustic Echo)
             currentThreshold = VOICE_THRESHOLD * 3.0; 
          }

          if (rms > currentThreshold) {
            if (!voiceIsSpeaking) {
              voiceIsSpeaking = true;
              setStatus('Đang nghe bạn nói...');
              // Bất cứ khi nào người dùng bắt đầu nói, gửi tín hiệu ngắt lời
              // để dọn dẹp các luồng sinh chữ/âm thanh đang chạy dang dở trên server
              console.log("Người dùng bắt đầu nói, gửi tín hiệu interrupt.");
              fetch('/api/interrupt', { method: 'POST' }).catch(e => {});
              
              if (currentAudioQueue && currentAudioQueue.isPlaying) {
                 currentAudioQueue.stop();
              }
              
              if (voiceFlushTimer) {
                clearTimeout(voiceFlushTimer);
                voiceFlushTimer = null;
                voiceIsBuffered = false;
              }
            }
            if (voiceSilenceTimer) {
              clearTimeout(voiceSilenceTimer);
              voiceSilenceTimer = null;
            }
            buffers.push(new Float32Array(chunk));
            
            // Ép xả (flush) nếu nói liên tục quá lâu (~12 giây) để tránh tràn bộ đệm
            if (buffers.length > 150) {
              voiceIsSpeaking = false;
              const wavBlob = encodeWav(buffers, audioContext.sampleRate);
              buffers = [];
              handleVoiceUtterance(wavBlob);
            }
          } else {
            if (voiceIsSpeaking) {
              buffers.push(new Float32Array(chunk)); // Thu thêm phần đuôi để khỏi bị cụt
              if (!voiceSilenceTimer) {
                voiceSilenceTimer = setTimeout(async () => {
                  voiceIsSpeaking = false;
                  voiceSilenceTimer = null;
                  const wavBlob = encodeWav(buffers, audioContext.sampleRate);
                  buffers = []; // Reset để thu câu tiếp theo
                  await handleVoiceUtterance(wavBlob);
                }, 1500); // 1.5 giây im lặng
              }
            }
          }
        };

        source.connect(processor);
        processor.connect(zeroGain);
        zeroGain.connect(audioContext.destination);

        isVoiceActive = true;
        voiceToggleBtn.textContent = 'Tắt Voice Chat';
        voiceToggleBtn.classList.add('secondary');
        setStatus('Voice Chat đang bật (Micro luôn mở)');
      } catch (error) {
        setStatus(error.message);
      }
    });

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextBtn.click();
      }
    });

    textInput.addEventListener('input', () => {
      if (textIsBuffered) {
        resetTextFlushTimer();
      }
    });

    // TEXT CHAT GUARDRAIL:
    // Keep typed-text handling separate from Voice Chat. This path should only
    // buffer user text and let the text idle timer call /api/flush; do not add
    // voice ASR/speaker/interrupt/streaming behavior here.
    sendTextBtn.addEventListener('click', async () => {
      const text = textInput.value.trim();
      if (!text) return;
      
      addMessage('Bạn', text);
      textInput.value = '';
      
      if (textFlushTimer) clearTimeout(textFlushTimer);
      textIsBuffered = false;
      textIsProcessing = true;
      resetVoiceCapture();
      
      try {
        setStatus('Đang phân tích...');
        const botP = botPronounInput.value.trim() || 'Lumi';
        const userP = userPronounInput.value.trim() || 'bạn';
        const data = await postJson('/api/chat', { text, bot_pronoun: botP, user_pronoun: userP });
        
        if (data.status === 'buffered') {
          setStatus('Đang chờ nhập...');
          textIsBuffered = true;
          resetTextFlushTimer();
        } else if (data.status === 'ignored') {
          setStatus('Đang chờ nhập...');
        } else if (data.response_text) {
          addMessage('Lumi', data.response_text, data.audio_url);
          setStatus('Sẵn sàng');
        }
      } catch (error) {
        setStatus(error.message);
      } finally {
        textIsProcessing = false;
      }
    });

    clearBtn.addEventListener('click', async () => {
      textInput.value = '';
      conversation.innerHTML = '';
      if (textFlushTimer) clearTimeout(textFlushTimer);
      if (voiceFlushTimer) clearTimeout(voiceFlushTimer);
      textIsBuffered = false;
      voiceIsBuffered = false;
      textIsProcessing = false;
      try {
        await postJson('/api/clear', {});
        addMessage('Lumi', 'Xin chào, tôi là Lumi. Bạn cần tôi giúp gì không?');
        setStatus('Sẵn sàng');
      } catch (error) {
        console.error("Lỗi khi xóa lịch sử:", error);
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      addMessage('Lumi', 'Xin chào, tôi là Lumi. Bạn cần tôi giúp gì không?');
    });

    function resetVoiceCapture() {
      buffers = [];
      voiceIsSpeaking = false;
      if (voiceSilenceTimer) {
        clearTimeout(voiceSilenceTimer);
        voiceSilenceTimer = null;
      }
    }

    function isAssistantAudioPlaying() {
      if (voiceAudioElement && !voiceAudioElement.paused && !voiceAudioElement.ended) return true;
      if (currentAudioQueue && currentAudioQueue.isPlaying) return true;
      return false;
    }

    function isTextInputActive() {
      return document.activeElement === textInput || textInput.value.trim().length > 0;
    }

    function cleanupAudioGraph() {
      resetVoiceCapture();
      voiceIsProcessing = false;
      if (processor) processor.disconnect();
      if (source) source.disconnect();
      if (zeroGain) zeroGain.disconnect();
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (audioContext) audioContext.close();
      processor = null;
      source = null;
      zeroGain = null;
      stream = null;
      audioContext = null;
    }

    function encodeWav(chunks, sampleRate) {
      const samples = mergeBuffers(chunks);
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, 'data');
      view.setUint32(40, samples.length * 2, true);
      floatTo16BitPcm(view, 44, samples);
      return new Blob([view], { type: 'audio/wav' });
    }

    function mergeBuffers(chunks) {
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Float32Array(length);
      let offset = 0;
      chunks.forEach(chunk => {
        result.set(chunk, offset);
        offset += chunk.length;
      });
      return result;
    }

    function floatTo16BitPcm(view, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
    }

    function writeString(view, offset, value) {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    }
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
