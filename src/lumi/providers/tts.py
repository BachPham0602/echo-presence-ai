from __future__ import annotations

import threading
import tempfile
from pathlib import Path
from time import time_ns

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError
from lumi.models import LumiResponse, TTSResult

SUPPORTED_REFERENCE_SUFFIXES = {'.wav', '.flac', '.ogg', '.mp3', '.m4a'}


def _ensure_writable_dir(dir_path: Path) -> Path:
    def _try_dir(path: Path) -> Path | None:
        try:
            path.mkdir(parents=True, exist_ok=True)
            test_file = path / ".write_test"
            test_file.touch()
            test_file.unlink()
            return path
        except (PermissionError, OSError):
            return None

    writable = _try_dir(dir_path)
    if writable is not None:
        return writable

    sibling_fallback = dir_path.parent / "_tmp"
    writable = _try_dir(sibling_fallback)
    if writable is not None:
        print(f"[TTS] Không ghi được {dir_path}, dùng {writable} thay thế.")
        return writable

    fallback = Path(tempfile.mkdtemp(prefix="lumi_"))
    print(f"[TTS] Không ghi được {dir_path}, dùng {fallback} thay thế.")
    return fallback


class BaseTTSProvider:
    """Common interface for pluggable TTS engines."""

    provider_name = "base"

    def synthesize_text(self, text: str) -> TTSResult:
        raise NotImplementedError


class StubTTS:
    """Chỗ giữ tạm cho pipeline cũ. CLI cũ hiện in text thay vì phát audio."""

    def synthesize(self, response: LumiResponse) -> TTSResult:
        return TTSResult(audio_path=None, sample_rate=None, engine="stub-text-output")


class NoAudioTTS(BaseTTSProvider):
    """Provider test: không sinh audio thật."""

    provider_name = "no-audio"

    def synthesize_text(self, text: str) -> TTSResult:
        return TTSResult(audio_path=None, sample_rate=None, engine="no-audio")


class VieNeuTTS(BaseTTSProvider):
    """TTS provider dùng SDK vieneu để sinh wav tiếng Việt."""

    provider_name = "vieneu"

    def __init__(self, config: LumiConfig):
        self.config = config
        self._engine = None
        self._lock = threading.Lock()

    def synthesize_text(self, text: str) -> TTSResult:
        engine = self._load_engine()
        if engine is None:
            raise RuntimeError("VieNeuTTS engine failed to initialize.")
        output_dir = _ensure_writable_dir(self.config.output_path)
        audio_path = output_dir / f"lumi_{time_ns()}.wav"

        infer_kwargs = {"text": text}
        if self.config.tts_voice:
            try:
                infer_kwargs["voice"] = engine.get_preset_voice(self.config.tts_voice)
            except Exception as exc:
                print(f"Không thể tải giọng {self.config.tts_voice}: {exc}")

        if hasattr(engine, "backbone") and hasattr(engine.backbone, "reset"):
            engine.backbone.reset()

        audio = engine.infer(**infer_kwargs)

        if hasattr(engine, "backbone") and hasattr(engine.backbone, "reset"):
            engine.backbone.reset()

        sample_rate = getattr(engine, "sample_rate", 24000)
        import soundfile as sf

        sf.write(str(audio_path), audio, sample_rate, subtype="PCM_16")
        return TTSResult(audio_path=str(audio_path), sample_rate=sample_rate, engine=f"vieneu:{self.config.tts_mode}")

    def _load_engine(self):
        if self._engine is not None:
            return self._engine
        try:
            from vieneu import Vieneu
        except ImportError as exc:
            raise MissingDependencyError(
                "VieNeuTTS cần package vieneu. Cài bằng: pip install -e '.[tts]' hoặc pip install vieneu"
            ) from exc

        if self.config.tts_mode:
            try:
                self._engine = Vieneu(mode=self.config.tts_mode)
            except Exception as exc:
                raise RuntimeError(
                    f"Không thể khởi tạo vieneu với mode '{self.config.tts_mode}': {exc}"
                ) from exc
            if self._engine is None:
                raise ValueError(
                    f"VieNeuTTS mode '{self.config.tts_mode}' không được hỗ trợ bởi vieneu SDK."
                )
        else:
            self._engine = Vieneu()
            if self._engine is None:
                raise ValueError("Không thể khởi tạo vieneu với mode mặc định.")
        return self._engine


class EdgeTTS(BaseTTSProvider):
    """TTS cực nhanh và nhẹ dùng Microsoft Edge TTS (không cần API key, 0 VRAM)."""

    provider_name = "edge-tts"

    def __init__(self, config: LumiConfig):
        self.config = config
        self._lock = threading.Lock()

    def synthesize_text(self, text: str) -> TTSResult:
        import asyncio

        try:
            import edge_tts
        except ImportError as exc:
            raise MissingDependencyError(
                "EdgeTTS cần package edge-tts. Chạy lệnh: pip install edge-tts"
            ) from exc

        output_dir = _ensure_writable_dir(self.config.output_path)
        mp3_path = output_dir / f"lumi_{time_ns()}.mp3"
        wav_path = output_dir / f"lumi_{time_ns()}.wav"

        voice = self.config.tts_voice
        if not voice or not voice.startswith("vi-VN"):
            voice = "vi-VN-HoaiMyNeural"

        async def _generate():
            communicate = edge_tts.Communicate(text, voice, rate="+10%", pitch="+5Hz")
            await communicate.save(str(mp3_path))

        asyncio.run(_generate())

        import subprocess

        try:
            subprocess.run(
                ["ffmpeg", "-i", str(mp3_path), "-ar", "24000", str(wav_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            mp3_path.unlink(missing_ok=True)
            final_path = wav_path
        except Exception:
            final_path = mp3_path

        return TTSResult(audio_path=str(final_path), sample_rate=24000, engine=f"edge-tts:{voice}")


class ZipVoiceTTS(BaseTTSProvider):
    """Prompt-based voice cloning wrapper for ViZipVoiceTTS."""

    provider_name = "zipvoice"

    def __init__(self, config: LumiConfig):
        self.config = config
        self._engine = None
        self._lock = threading.Lock()
        self._prompt_cache: tuple[Path, str] | None = None

    def synthesize_text(self, text: str) -> TTSResult:
        engine = self._load_engine()
        prompt_wav, prompt_text = self._resolve_prompt()

        output_dir = _ensure_writable_dir(self.config.output_path)
        audio_path = output_dir / f"lumi_{time_ns()}.wav"

        metrics = engine.synthesize(
            prompt_wav=str(prompt_wav),
            prompt_text=prompt_text,
            text=text,
            output_path=str(audio_path),
        )
        sample_rate = None
        if isinstance(metrics, dict):
            sample_rate = metrics.get("sample_rate")
        if sample_rate is None:
            sample_rate = getattr(engine, "sample_rate", None)
        return TTSResult(
            audio_path=str(audio_path),
            sample_rate=sample_rate,
            engine=f"zipvoice:{prompt_wav.stem}",
        )

    def _load_engine(self):
        if self._engine is not None:
            return self._engine
        try:
            from zipvoice.vizipvoice import ViZipVoiceTTS
        except ImportError as exc:
            raise MissingDependencyError(
                "ZipVoiceTTS cần package hỗ trợ `from zipvoice.vizipvoice import ViZipVoiceTTS`. "
                "Hãy cài package zipvoice/vizipvoice tương ứng trước khi chọn provider này."
            ) from exc

        self._engine = ViZipVoiceTTS()
        return self._engine

    def _resolve_prompt(self) -> tuple[Path, str]:
        if self._prompt_cache is not None:
            return self._prompt_cache
        prompt_wav = self._resolve_prompt_wav()
        prompt_text = self._resolve_prompt_text(prompt_wav)
        self._prompt_cache = (prompt_wav, prompt_text)
        return self._prompt_cache

    def _resolve_prompt_wav(self) -> Path:
        prompt_wav = self.config.tts_reference_wav
        if prompt_wav:
            path = Path(prompt_wav).expanduser()
            if not path.exists():
                raise MissingDependencyError(f"Không tìm thấy prompt wav cho ZipVoiceTTS: {path}")
            return path

        speaker_name = self._resolve_reference_speaker_name()
        owner_dir = Path(self.config.owner_voice_dir).expanduser() / speaker_name
        references = self._reference_files(owner_dir)
        if not references:
            raise MissingDependencyError(
                f"Profile giọng `{speaker_name}` không có file audio dùng được trong {owner_dir}."
            )
        chosen = references[0]
        print(f"[ZipVoiceTTS] Dùng mẫu giọng {chosen.name} từ profile {speaker_name}.")
        return chosen

    def _resolve_reference_speaker_name(self) -> str:
        owner_name = (self.config.owner_name or '').strip()
        if owner_name:
            owner_dir = Path(self.config.owner_voice_dir).expanduser() / owner_name
            if self._reference_files(owner_dir):
                return owner_name

        explicit = (self.config.tts_reference_speaker or '').strip()
        if explicit:
            return explicit

        profiles = self._available_reference_profiles()
        if len(profiles) == 1:
            return profiles[0].name
        if not profiles:
            raise MissingDependencyError(
                "ZipVoiceTTS chưa tìm thấy profile giọng nào trong owner_voices. "
                "Hãy thêm file WAV hoặc đặt `LUMI_TTS_REFERENCE_WAV`."
            )
        profile_names = ', '.join(path.name for path in profiles)
        raise MissingDependencyError(
            "ZipVoiceTTS thấy nhiều profile giọng. Hãy đặt `LUMI_TTS_REFERENCE_SPEAKER` "
            f"hoặc `LUMI_TTS_REFERENCE_WAV`. Profiles hiện có: {profile_names}"
        )

    def _available_reference_profiles(self) -> list[Path]:
        base_dir = Path(self.config.owner_voice_dir).expanduser()
        if not base_dir.exists() or not base_dir.is_dir():
            return []
        profiles = []
        for path in sorted(base_dir.iterdir(), key=lambda item: item.name.lower()):
            if path.is_dir() and self._reference_files(path):
                profiles.append(path)
        return profiles

    def _reference_files(self, directory: Path) -> list[Path]:
        if not directory.exists() or not directory.is_dir():
            return []
        return sorted(
            [
                path for path in directory.iterdir()
                if path.is_file() and path.suffix.lower() in SUPPORTED_REFERENCE_SUFFIXES
            ],
            key=lambda path: path.name.lower(),
        )

    def _resolve_prompt_text(self, prompt_wav: Path) -> str:
        if self.config.tts_reference_text and self.config.tts_reference_text.strip():
            return self.config.tts_reference_text.strip()

        sidecar_path = prompt_wav.with_suffix('.txt')
        if sidecar_path.exists():
            text = sidecar_path.read_text(encoding='utf-8').strip()
            if text:
                return text

        text = self._transcribe_prompt_text(prompt_wav)
        sidecar_path.write_text(text, encoding='utf-8')
        print(f"[ZipVoiceTTS] Đã tự tạo transcript mẫu tại {sidecar_path}.")
        return text

    def _transcribe_prompt_text(self, prompt_wav: Path) -> str:
        try:
            from lumi.providers.asr import PhoWhisperASR
        except ImportError as exc:
            raise MissingDependencyError(
                "ZipVoiceTTS cần transcript mẫu. Không có sidecar .txt và cũng không tải được ASR để tự chép lời."
            ) from exc

        try:
            transcript = PhoWhisperASR(self.config).transcribe_file(str(prompt_wav)).strip()
        except Exception as exc:
            raise MissingDependencyError(
                f"Không thể tự chép lời cho prompt wav {prompt_wav}: {exc}"
            ) from exc
        if not transcript:
            raise MissingDependencyError(
                f"ASR không tạo được transcript cho prompt wav {prompt_wav}. Hãy tạo file {prompt_wav.with_suffix('.txt').name} thủ công."
            )
        return transcript



def available_tts_providers() -> list[str]:
    return ["edge-tts", "vieneu", "zipvoice", "no-audio"]



def create_tts_provider(config: LumiConfig):
    provider = (config.tts_provider or '').strip().lower()

    if provider == 'vieneu':
        return VieNeuTTS(config)
    if provider in {'edge', 'edge-tts', 'edgetts'}:
        return EdgeTTS(config)
    if provider in {'zipvoice', 'vizipvoice', 'vi-zipvoice'}:
        return ZipVoiceTTS(config)
    if provider in {'none', 'silent', 'no-audio'}:
        return NoAudioTTS()
    raise ValueError(f"TTS provider chưa hỗ trợ: {config.tts_provider}")



def _lock_synthesize_text(method):
    def wrapped(self, *args, **kwargs):
        lock = getattr(self, '_lock', None)
        if lock is None:
            return method(self, *args, **kwargs)
        with lock:
            return method(self, *args, **kwargs)

    return wrapped


VieNeuTTS.synthesize_text = _lock_synthesize_text(VieNeuTTS.synthesize_text)
EdgeTTS.synthesize_text = _lock_synthesize_text(EdgeTTS.synthesize_text)
ZipVoiceTTS.synthesize_text = _lock_synthesize_text(ZipVoiceTTS.synthesize_text)
