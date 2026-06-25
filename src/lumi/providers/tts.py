from __future__ import annotations

from pathlib import Path
from time import time_ns

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError
from lumi.models import LumiResponse, TTSResult


class StubTTS:
    """Chỗ giữ tạm cho pipeline cũ. CLI cũ hiện in text thay vì phát audio."""

    def synthesize(self, response: LumiResponse) -> TTSResult:
        return TTSResult(audio_path=None, sample_rate=None, engine="stub-text-output")


class NoAudioTTS:
    """Provider test: không sinh audio thật."""

    def synthesize_text(self, text: str) -> TTSResult:
        return TTSResult(audio_path=None, sample_rate=None, engine="no-audio")


class VieNeuTTS:
    """TTS provider dùng SDK vieneu để sinh wav tiếng Việt."""

    def __init__(self, config: LumiConfig):
        self.config = config
        self._engine = None

    def synthesize_text(self, text: str) -> TTSResult:
        engine = self._load_engine()
        output_dir = self.config.output_path
        output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = output_dir / f"lumi_{time_ns()}.wav"

        infer_kwargs = {"text": text}
        if self.config.tts_voice:
            try:
                infer_kwargs["voice"] = engine.get_preset_voice(self.config.tts_voice)
            except Exception as e:
                print(f"Không thể tải giọng {self.config.tts_voice}: {e}")
                
        # Dọn sạch KV cache của llama.cpp trước khi sinh audio mới để tránh vỡ bộ nhớ
        if hasattr(engine, "backbone") and hasattr(engine.backbone, "reset"):
            engine.backbone.reset()
            
        audio = engine.infer(**infer_kwargs)
        
        # Lập tức dọn sạch KV cache sau khi sinh xong để trả VRAM cho PyTorch LLM!
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
            self._engine = Vieneu(mode=self.config.tts_mode)
        else:
            self._engine = Vieneu()
        return self._engine

class EdgeTTS:
    """TTS cực nhanh và nhẹ dùng Microsoft Edge TTS (không cần API key, 0 VRAM)."""

    def __init__(self, config: LumiConfig):
        self.config = config

    def synthesize_text(self, text: str) -> TTSResult:
        import asyncio
        try:
            import edge_tts
        except ImportError as exc:
            raise MissingDependencyError(
                "EdgeTTS cần package edge-tts. Chạy lệnh: pip install edge-tts"
            ) from exc

        output_dir = self.config.output_path
        output_dir.mkdir(parents=True, exist_ok=True)
        # Sinh MP3 trước
        mp3_path = output_dir / f"lumi_{time_ns()}.mp3"
        wav_path = output_dir / f"lumi_{time_ns()}.wav"

        voice = self.config.tts_voice
        if not voice or not voice.startswith("vi-VN"):
            voice = "vi-VN-HoaiMyNeural"

        async def _generate():
            # Tăng tốc độ và cao độ một chút để giọng Hoài My bớt ngang và có sinh khí hơn
            communicate = edge_tts.Communicate(text, voice, rate="+10%", pitch="+5Hz")
            await communicate.save(str(mp3_path))

        asyncio.run(_generate())

        # Chuyển đổi sang WAV bằng ffmpeg hoặc trả về trực tiếp MP3 nếu frontend chấp nhận
        # Vì frontend đang code cứng MIME wav nên dùng ffmpeg
        import subprocess
        try:
            subprocess.run(
                ["ffmpeg", "-i", str(mp3_path), "-ar", "24000", str(wav_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True
            )
            mp3_path.unlink(missing_ok=True)
            final_path = wav_path
        except Exception:
            # Nếu không có ffmpeg, trả về mp3 và trình duyệt sẽ tự xử lý
            final_path = mp3_path

        return TTSResult(audio_path=str(final_path), sample_rate=24000, engine=f"edge-tts:{voice}")
