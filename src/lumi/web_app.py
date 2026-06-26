from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    #sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "ViZipvoice"))

import argparse
import json
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import time, time_ns
from urllib.parse import quote, unquote, urlparse
import wave
import struct
import math

from lumi.config import LumiConfig
from lumi.errors import LumiProviderError
from lumi.mvp_pipeline import LumiMvpPipeline
from lumi.output_metadata import write_audio_sidecars
from lumi.providers.tts import _ensure_writable_dir, available_tts_providers
from lumi.providers.speaker import list_speaker_profiles
import threading

pipeline_lock = threading.Lock()
SESSION_ID_HEADER = "X-Session-Id"
SESSION_COOKIE_NAME = "lumi_session_id"


class LumiSessionState:
    def __init__(self, pipeline: LumiMvpPipeline):
        self.pipeline = pipeline
        self.lock = threading.RLock()
        self.last_used = time()


class LumiSessionManager:
    def __init__(self, prototype: LumiMvpPipeline, max_sessions: int = 128):
        self.prototype = prototype
        self.max_sessions = max(1, max_sessions)
        self._sessions: dict[str, LumiSessionState] = {}
        self._lock = threading.RLock()

    def get(self, raw_session_id: str | None) -> LumiSessionState:
        session_id = _clean_session_id(raw_session_id) or _new_session_id()
        with self._lock:
            state = self._sessions.get(session_id)
            if state is None:
                state = LumiSessionState(self._new_pipeline())
                self._sessions[session_id] = state
                self._trim_locked()
            state.last_used = time()
            return state

    def _new_pipeline(self) -> LumiMvpPipeline:
        return LumiMvpPipeline(
            config=self.prototype.config,
            asr=self.prototype.asr,
            response_generator=self.prototype.response_generator,
            tts=self.prototype.tts,
            turn_detector=self.prototype.turn_detector,
            addressee_detector=self.prototype.addressee_detector,
            speaker_verifier=self.prototype.speaker_verifier,
            emotion_classifier=self.prototype.emotion_classifier,
        )

    def _trim_locked(self) -> None:
        overflow = len(self._sessions) - self.max_sessions
        if overflow <= 0:
            return
        oldest = sorted(self._sessions.items(), key=lambda item: item[1].last_used)[:overflow]
        for session_id, _state in oldest:
            self._sessions.pop(session_id, None)


class LumiWebHandler(BaseHTTPRequestHandler):
    pipeline: LumiMvpPipeline
    session_manager: LumiSessionManager
    config: LumiConfig
    output_dir: Path

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-Id, X-Bot-Pronoun, X-User-Pronoun, X-Owner-Name, X-Sample-Index, X-Prompt")
        self.send_header("Access-Control-Expose-Headers", "X-Session-Id")
        session_cookie = getattr(self, "_session_cookie_to_set", None)
        if session_cookie:
            self.send_header(
                "Set-Cookie",
                f"{SESSION_COOKIE_NAME}={session_cookie}; Path=/; Max-Age=2592000; SameSite=Lax",
            )
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
                self._handle_clear()
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

    def _request_session_id(self, payload: dict | None = None) -> str:
        session_id = None
        if payload:
            session_id = _clean_session_id(payload.get("session_id") or payload.get("conversation_id"))
        if not session_id:
            session_id = _clean_session_id(self.headers.get(SESSION_ID_HEADER))
        if not session_id:
            session_id = self._session_id_from_cookie()
        if not session_id:
            session_id = _new_session_id()
            self._session_cookie_to_set = session_id
        self._active_session_id = session_id
        return session_id

    def _session_id_from_cookie(self) -> str | None:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE_NAME)
        if not morsel:
            return None
        return _clean_session_id(morsel.value)

    def _session_for_payload(self, payload: dict | None = None) -> LumiSessionState:
        return self.session_manager.get(self._request_session_id(payload))

    def _handle_text(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        if not text:
            self._send_json({"error": "Text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        session = self._session_for_payload(payload)
        with session.lock:
            result = session.pipeline.handle_text(text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        self._send_json(_payload_from_result(result, self.config.output_root_path))

    def _handle_chat(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        if not text:
            self._send_json({"error": "Text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        session = self._session_for_payload(payload)
        with session.lock:
            result = session.pipeline.handle_chat(text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result, self.config.output_root_path))

    def _handle_voice_text(self) -> None:
        payload = self._read_json()
        text = str(payload.get("text", "")).strip()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        owner_name = payload.get("owner_name") or user_pronoun
        print(f"[DEBUG] /api/voice_text nhận được: '{text}'")
        if not text:
            self._send_json({"error": "Voice text rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        voice_user_pronoun = user_pronoun or owner_name
        session = self._session_for_payload(payload)
        print(f"[DEBUG] /api/voice_text đang chờ session.lock...")
        with session.lock:
            result = session.pipeline.handle_voice_transcript(
                text, bot_pronoun=bot_pronoun, user_pronoun=voice_user_pronoun
            )
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result, self.config.output_root_path))


    def _handle_flush(self) -> None:
        payload = self._read_json()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        mode = str(payload.get("mode", "text")).strip().lower()
        session = self._session_for_payload(payload)
        with session.lock:
            if mode == "voice":
                result = session.pipeline.flush_voice_chat(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, is_timeout=True)
            else:
                result = session.pipeline.flush_chat(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        if isinstance(result, dict):
            self._send_json(result)
        else:
            self._send_json(_payload_from_result(result, self.config.output_root_path))

    def _handle_voice_stream(self) -> None:
        payload = self._read_json()
        bot_pronoun = payload.get("bot_pronoun")
        user_pronoun = payload.get("user_pronoun")
        
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        
        # Do not hold the session lock for the whole stream, otherwise it blocks /api/interrupt.
        session = self._session_for_payload(payload)
        generator = session.pipeline.flush_voice_chat_stream(bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, is_timeout=True)
        
        try:
            for chunk_data in generator:
                data_str = json.dumps(chunk_data, ensure_ascii=False)
                self.wfile.write(f"data: {data_str}\n\n".encode("utf-8"))
                self.wfile.flush()
        except Exception as e:
            print(f"[ERROR] Voice Stream error: {e}")
        finally:
            # QUAN TRọNG: đóng generator rõ ràng để chắc chắn generation_lock luôn
            # được giải phóng, ngay cả khi client ngắt kết nối giữa chừng (BrokenPipe).
            generator.close()

            
    def _handle_interrupt(self) -> None:
        payload = self._read_json()
        session = self._session_for_payload(payload)
        session.pipeline.interrupt_event.set()
        self._send_json({"status": "interrupting"})

    def _handle_clear(self) -> None:
        payload = self._read_json()
        session = self._session_for_payload(payload)
        with session.lock:
            session.pipeline.clear_history()
        self._send_json({"status": "cleared"})

    def _handle_audio(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"error": "Audio body rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        bot_pronoun = unquote(self.headers.get("X-Bot-Pronoun", "")) or None
        user_pronoun = unquote(self.headers.get("X-User-Pronoun", "")) or None
        output_dir = self._current_output_dir()
        audio_path = output_dir / f"web_input_{time_ns()}.wav"
        audio_path.write_bytes(self.rfile.read(length))
        session = self._session_for_payload()
        with session.lock:
            result = session.pipeline.handle_audio_file(audio_path, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        self._send_json(_payload_from_result(result, self.config.output_root_path))

    def _handle_voice_chat(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json({"error": "Audio body rỗng."}, HTTPStatus.BAD_REQUEST)
            return
        bot_pronoun = unquote(self.headers.get("X-Bot-Pronoun", "")) or None
        user_pronoun = unquote(self.headers.get("X-User-Pronoun", "")) or None
        owner_name = unquote(self.headers.get("X-Owner-Name", "")) or None
        output_dir = self._current_output_dir()
        audio_path = output_dir / f"web_input_voice_{time_ns()}.wav"
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
                        _attach_input_audio_links(payload, audio_path, self.config.output_root_path)
                        self._send_json(payload)
                        return
        except Exception as e:
            print(f"Lỗi đọc RMS: {e}")

        session = self._session_for_payload()
        with session.lock:
            result = session.pipeline.handle_voice_chat(
                audio_path,
                bot_pronoun=bot_pronoun,
                user_pronoun=user_pronoun,
                owner_name=owner_name,
            )
        if isinstance(result, dict):
            payload = dict(result)
            _attach_input_audio_links(payload, audio_path, self.config.output_root_path)
            self._send_json(payload)
        else:
            self._send_json(_payload_from_result(result, self.config.output_root_path))

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

    def _current_output_dir(self) -> Path:
        return _ensure_writable_dir(self.config.output_path)

    def _serve_output_file(self, path: str) -> None:
        file_path = _resolve_output_file_path(
            path,
            self.config.output_root_path,
            self.config.output_path,
        )
        if not file_path or not file_path.exists() or not file_path.is_file():
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
        self._request_session_id({})
        data = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        active_session_id = getattr(self, "_active_session_id", None)
        if active_session_id and "session_id" not in payload:
            payload = {**payload, "session_id": active_session_id}
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if active_session_id:
            self.send_header(SESSION_ID_HEADER, active_session_id)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _new_session_id() -> str:
    return f"lumi_{uuid.uuid4().hex}"


def _clean_session_id(value: str | None) -> str | None:
    raw = str(value or "").strip()[:120]
    cleaned = "".join(
        char for char in raw if char.isascii() and (char.isalnum() or char in "-_.:")
    )
    return cleaned or None


def _normalize_session_id(value: str | None) -> str:
    return _clean_session_id(value) or "default"


def _is_safe_owner_name(value: str) -> bool:
    value = value.strip()
    return bool(
        value
        and value not in {".", ".."}
        and "/" not in value
        and "\\" not in value
        and chr(0) not in value
    )


def _payload_from_result(result, output_root: str | Path) -> dict:
    payload = {
        "input_text": result.input_text,
        "response_text": result.response_text,
        "audio_url": _output_file_url(result.audio_path, output_root),
        "audio_text_url": _sidecar_url(result.audio_path, ".txt", output_root),
        "audio_metadata_url": _sidecar_url(result.audio_path, ".json", output_root),
        "tts_engine": result.tts_engine,
    }
    if result.input_audio_path:
        _attach_input_audio_links(payload, result.input_audio_path, output_root)
    return payload


def _attach_input_audio_links(payload: dict, audio_path: str | Path | None, output_root: str | Path) -> None:
    if not audio_path:
        return
    payload["input_audio_url"] = _output_file_url(audio_path, output_root)
    payload["input_text_url"] = _sidecar_url(audio_path, ".txt", output_root)
    payload["input_metadata_url"] = _sidecar_url(audio_path, ".json", output_root)


def _output_file_url(path: str | Path | None, output_root: str | Path) -> str | None:
    if not path:
        return None
    file_path = Path(path)
    root_path = Path(output_root)
    try:
        relative_path = file_path.resolve().relative_to(root_path.resolve())
    except (OSError, ValueError):
        try:
            relative_path = file_path.relative_to(root_path)
        except ValueError:
            relative_path = Path(file_path.name)
    return "/outputs/" + quote(relative_path.as_posix(), safe="/")


def _sidecar_url(audio_path: str | Path | None, suffix: str, output_root: str | Path) -> str | None:
    if not audio_path:
        return None
    sidecar_path = Path(audio_path).with_suffix(suffix)
    if not sidecar_path.exists():
        return None
    return _output_file_url(sidecar_path, output_root)


def _resolve_output_file_path(
    request_path: str,
    output_root: str | Path,
    current_output_dir: str | Path,
) -> Path | None:
    raw_relative = unquote(request_path.removeprefix("/outputs/")).strip("/")
    if not raw_relative:
        return None
    relative_path = Path(raw_relative)
    if relative_path.is_absolute() or any(part in {"", ".", ".."} for part in relative_path.parts):
        return None

    root_path = Path(output_root).resolve()
    file_path = (root_path / relative_path).resolve()
    try:
        file_path.relative_to(root_path)
    except ValueError:
        return None

    if not file_path.exists() and len(relative_path.parts) == 1:
        fallback_path = (Path(current_output_dir) / relative_path.name).resolve()
        try:
            fallback_path.relative_to(root_path)
        except ValueError:
            return file_path
        if fallback_path.exists():
            return fallback_path

    return file_path


def run_server(config: LumiConfig, host: str, port: int) -> None:
    pipeline = LumiMvpPipeline(config)
    if config.cuda_visible_devices:
        print(f"CUDA_VISIBLE_DEVICES={config.cuda_visible_devices} (GPU vật lý Lumi được phép dùng)")
    output_root_dir = config.output_root_path
    output_dir = config.output_path
    output_dir.mkdir(parents=True, exist_ok=True)
    config.owner_voice_path.mkdir(parents=True, exist_ok=True)
    print(f"Output hôm nay: {output_dir} (root: {output_root_dir})")

    print("Đang nạp AI models lên GPU (warm-up), vui lòng đợi...")
    if hasattr(pipeline.asr, "_load_pipeline"):
        pipeline.asr._load_pipeline()
    if hasattr(pipeline.response_generator, "_load_model"):
        pipeline.response_generator._load_model()
    if hasattr(pipeline.tts, "_load_engine"):
        pipeline.tts._load_engine()
    emotion_warmup = getattr(pipeline.emotion_classifier, "warmup", None)
    if callable(emotion_warmup):
        print("Đang nạp emotion classifier HuggingFace...")
        if emotion_warmup():
            print("Nạp emotion classifier hoàn tất!")
        else:
            print("Không nạp được emotion classifier HuggingFace, tạm dùng heuristic emotion.")
    print("Nạp model hoàn tất!")

    class Handler(LumiWebHandler):
        pass

    Handler.pipeline = pipeline
    Handler.session_manager = LumiSessionManager(pipeline)
    Handler.config = config
    Handler.output_dir = output_root_dir

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
    parser.add_argument("--tts-provider", choices=available_tts_providers(), default=None)
    parser.add_argument("--tts-reference-wav", default=None, help="Giọng mẫu cho provider clone voice như zipvoice.")
    parser.add_argument("--tts-reference-text", default=None, help="Transcript chính xác của file --tts-reference-wav.")
    parser.add_argument("--tts-reference-speaker", default=None, help="Tên profile trong owner_voices dùng làm giọng mẫu cho zipvoice.")
    parser.add_argument("--asr-provider", choices=["phowhisper"], default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--output-subdir", default=None, help="Thư mục con dưới output-dir. Mặc định là ngày hiện tại; dùng 'test' khi chạy thử.")
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
        emotion_model=base.emotion_model,
        asr_provider=args.asr_provider or base.asr_provider,
        response_provider=args.response_provider or base.response_provider,
        tts_provider=args.tts_provider or base.tts_provider,
        emotion_provider=base.emotion_provider,
        tts_mode=base.tts_mode,
        tts_voice=base.tts_voice,
        tts_reference_wav=args.tts_reference_wav or base.tts_reference_wav,
        tts_reference_text=args.tts_reference_text or base.tts_reference_text,
        tts_reference_speaker=args.tts_reference_speaker or base.tts_reference_speaker,
        llm_max_new_tokens=base.llm_max_new_tokens,
        llm_voice_max_new_tokens=base.llm_voice_max_new_tokens,
        llm_temperature=base.llm_temperature,
        llm_repetition_penalty=base.llm_repetition_penalty,
        llm_no_repeat_ngram_size=base.llm_no_repeat_ngram_size,
        emotion_min_confidence=base.emotion_min_confidence,
        output_dir=args.output_dir or base.output_dir,
        output_subdir=args.output_subdir if args.output_subdir is not None else base.output_subdir,
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
    const SESSION_STORAGE_KEY = 'lumiSessionId.v2';

    function makeSessionId() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
      return `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) {
      sessionId = makeSessionId();
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }

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
    let voiceBufferStartedAt = null;
    let voiceHadBufferedBeforeCurrentUtterance = false;
    let voiceFlushInFlight = false;
    let voiceFlushQueued = false;

    const VOICE_MAX_BUFFER_MS = 2200;
    const VOICE_MIN_FLUSH_MS = 100;
    const VOICE_COMPLETE_FLUSH_MS = 250;

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
      }, 1000);
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

    function resetVoiceFlushTimer(waitMs = 1700) {
      if (voiceFlushTimer) clearTimeout(voiceFlushTimer);
      if (!voiceIsBuffered) {
        voiceBufferStartedAt = null;
        return;
      }
      if (voiceBufferStartedAt === null) voiceBufferStartedAt = Date.now();
      const elapsedMs = Date.now() - voiceBufferStartedAt;
      const forcedRemainingMs = Math.max(VOICE_MIN_FLUSH_MS, VOICE_MAX_BUFFER_MS - elapsedMs);
      const effectiveWaitMs = Math.min(waitMs, forcedRemainingMs);
      voiceFlushTimer = setTimeout(async () => {
        voiceFlushTimer = null;
        if (voiceFlushInFlight) {
          voiceFlushQueued = true;
          return;
        }

        voiceIsBuffered = false;
        voiceBufferStartedAt = null;
        voiceFlushInFlight = true;
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
            body: JSON.stringify({ session_id: sessionId, bot_pronoun: botP, user_pronoun: userP })
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
        } finally {
          voiceFlushInFlight = false;
          if (voiceFlushQueued || voiceIsBuffered) {
            voiceFlushQueued = false;
            if (voiceIsBuffered) resetVoiceFlushTimer(VOICE_MIN_FLUSH_MS);
          }
        }
      }, effectiveWaitMs);
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
        body: JSON.stringify({ ...payload, session_id: sessionId })
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
      const hadBufferedBeforeRequest = voiceHadBufferedBeforeCurrentUtterance || voiceIsBuffered;
      voiceHadBufferedBeforeCurrentUtterance = false;
      voiceIsProcessing = true;
      resetVoiceCapture();
      if (voiceFlushInFlight || (currentAudioQueue && currentAudioQueue.isPlaying)) {
        if (currentAudioQueue) currentAudioQueue.stop();
        fetch('/api/interrupt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        }).catch(() => {});
      }
      if (voiceFlushTimer) {
        clearTimeout(voiceFlushTimer);
        voiceFlushTimer = null;
      }
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
            'X-Owner-Name': encodeURIComponent(speakerName),
            'X-Session-Id': encodeURIComponent(sessionId)
          },
          body: wavBlob
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed');
        
        addVoiceInputMessage(data);

        if (data.status === 'buffered') {
          setStatus('Lumi đang chờ bạn nói thêm...');
          voiceIsBuffered = true;
          const waitMs = data.is_complete ? Math.min(data.wait_ms || VOICE_COMPLETE_FLUSH_MS, VOICE_COMPLETE_FLUSH_MS) : (data.wait_ms || 1700);
          resetVoiceFlushTimer(waitMs);
        } else if (data.status === 'ignored') {
          if (hadBufferedBeforeRequest) {
            voiceIsBuffered = true;
            setStatus('Lumi sẽ trả lời phần bạn vừa nói trước đó...');
            resetVoiceFlushTimer(VOICE_MIN_FLUSH_MS);
          } else {
            voiceBufferStartedAt = null;
            setStatus(data.reason ? `Bỏ qua: ${data.reason}` : 'Sẵn sàng (bỏ qua do lẩm bẩm hoặc ồn)');
          }
        } else if (data.response_text) {
          voiceBufferStartedAt = null;
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
              fetch('/api/interrupt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId })
              }).catch(e => {});
              
              if (currentAudioQueue && currentAudioQueue.isPlaying) {
                 currentAudioQueue.stop();
              }
              
              if (voiceFlushTimer) {
                voiceHadBufferedBeforeCurrentUtterance = voiceIsBuffered;
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

    function normalizeCommandText(text) {
      return text.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isStopTextCommand(text) {
      const normalized = normalizeCommandText(text);
      return /(^|\s)(dung|ngung|thoi)\s+(noi|tra loi|lai|di|thoi)(\s|$)/.test(normalized)
        || /(^|\s)(dung|ngung)\s+noi\s+(nua|lai|di)(\s|$)/.test(normalized)
        || /(^|\s)(im lang|im di|giu im lang)(\s|$)/.test(normalized)
        || /(^|\s)(stop|cancel|huy)(\s|$)/.test(normalized);
    }

    // TEXT CHAT GUARDRAIL:
    // Keep typed-text handling separate from Voice Chat. This path should only
    // buffer user text and let the text idle timer call /api/flush; do not add
    // voice ASR/speaker/interrupt/streaming behavior here.
    sendTextBtn.addEventListener('click', async () => {
      const text = textInput.value.trim();
      if (!text) return;
      const isStopCommand = isStopTextCommand(text);
      if (isStopCommand) {
        if (voiceAudioElement) {
          voiceAudioElement.pause();
          voiceAudioElement = null;
        }
        if (currentAudioQueue) currentAudioQueue.stop();
      }
      
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
        addMessage('Lumi', 'Xin chào, Lumi đây. Bạn cần Lumi giúp gì không?');
        setStatus('Sẵn sàng');
      } catch (error) {
        console.error("Lỗi khi xóa lịch sử:", error);
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      addMessage('Lumi', 'Xin chào, Lumi đây. Bạn cần Lumi giúp gì không?');
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
      voiceIsBuffered = false;
      voiceBufferStartedAt = null;
      voiceHadBufferedBeforeCurrentUtterance = false;
      if (voiceFlushTimer) {
        clearTimeout(voiceFlushTimer);
        voiceFlushTimer = null;
      }
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
