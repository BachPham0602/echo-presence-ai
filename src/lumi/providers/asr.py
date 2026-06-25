from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from time import time_ns

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError


class PhoWhisperASR:
    """ASR provider dùng Hugging Face Transformers pipeline với PhoWhisper."""

    def __init__(self, config: LumiConfig):
        self.config = config
        self._pipe = None

    def transcribe_file(self, audio_path: str | Path) -> str:
        pipe = self._load_pipeline()
        try:
            result = pipe(
                str(audio_path),
                generate_kwargs={
                    "language": "vi",
                    "task": "transcribe",
                    "temperature": 0.0,
                    "no_speech_threshold": 0.6,
                    "logprob_threshold": -1.0,
                    "condition_on_prev_tokens": False,
                }
            )
        finally:
            # Giải phóng VRAM dù có lỗi hay không
            import torch
            torch.cuda.empty_cache()

        if isinstance(result, dict):
            return str(result.get("text", "")).strip()
        return str(result).strip()

    def _load_pipeline(self):
        if self._pipe is not None:
            return self._pipe
        try:
            from transformers import pipeline
        except ImportError as exc:
            raise MissingDependencyError(
                "PhoWhisperASR cần transformers/torch. Cài bằng: pip install -e '.[asr]'"
            ) from exc

        self._pipe = pipeline(
            "automatic-speech-recognition",
            model=self.config.asr_model,
            device=_select_pipeline_device(self.config),
        )
        return self._pipe


class MicrophoneRecorder:
    """Ghi âm microphone ra wav để đưa vào ASR. VAD thật sẽ được gắn sau."""

    def __init__(self, output_dir: str | Path, sample_rate: int = 16000, device: int | str | None = None):
        self.output_dir = Path(output_dir)
        self.sample_rate = sample_rate
        self.device = device

    def record(self, seconds: float) -> Path:
        sd, sf = _load_audio_modules()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = self.output_dir / f"mic_{time_ns()}.wav"
        frames = int(seconds * self.sample_rate)
        try:
            audio = sd.rec(
                frames,
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                device=self.device,
            )
            sd.wait()
        except sd.PortAudioError as exc:
            raise MissingDependencyError(_audio_device_error(self.device)) from exc
        sf.write(audio_path, audio, self.sample_rate)
        return audio_path

    def stream_chunks(self, chunk_seconds: float, max_chunks: int | None = None) -> Iterator[Path]:
        """Yield liên tục các chunk wav từ microphone.

        Đây là streaming theo chunk cố định. Sau này có thể thay method này bằng
        VAD-based utterance streaming mà không đổi phần pipeline phía sau.
        """
        index = 0
        while max_chunks is None or index < max_chunks:
            yield self.record(chunk_seconds)
            index += 1

    @staticmethod
    def list_input_devices() -> str:
        sd, _ = _load_audio_modules()
        try:
            devices = sd.query_devices()
        except sd.PortAudioError as exc:
            raise MissingDependencyError(_audio_device_error(None)) from exc

        default_input = None
        try:
            default_input = sd.default.device[0]
        except Exception:
            default_input = None

        lines = ["Input audio devices:"]
        found = False
        for index, info in enumerate(devices):
            max_input_channels = int(info.get("max_input_channels", 0))
            if max_input_channels <= 0:
                continue
            found = True
            marker = " *default" if index == default_input else ""
            name = info.get("name", "unknown")
            hostapi = info.get("hostapi", "?")
            samplerate = info.get("default_samplerate", "?")
            lines.append(
                f"  [{index}] {name} | inputs={max_input_channels} | "
                f"hostapi={hostapi} | default_sr={samplerate}{marker}"
            )

        if not found:
            lines.append("  Không thấy input device nào.")
        return "\n".join(lines)


def _select_pipeline_device(config: LumiConfig) -> int:
    if config.cuda_visible_devices is None:
        return -1
    try:
        import torch
    except ImportError:
        return -1
    return 0 if torch.cuda.is_available() else -1


def _load_audio_modules():
    try:
        import sounddevice as sd
        import soundfile as sf
    except (ImportError, OSError) as exc:
        raise MissingDependencyError(
            "Ghi âm/stream microphone cần sounddevice, soundfile và PortAudio. "
            "Trong conda: conda install -c conda-forge portaudio python-sounddevice pysoundfile. "
            "Hoặc cài PortAudio bằng conda rồi dùng pip install soundfile. "
            "Trên Ubuntu apt: sudo apt-get install libportaudio2 portaudio19-dev."
        ) from exc
    return sd, sf


def _audio_device_error(device: int | str | None) -> str:
    selected = "default input device" if device is None else f"input device {device!r}"
    return (
        f"PortAudio không mở được {selected}. "
        "Thường là máy/container không có microphone mặc định, hoặc bạn cần chọn device cụ thể. "
        "Chạy: PYTHONPATH=src python -m lumi.mvp_cli --list-audio-devices. "
        "Sau đó chạy lại với: --device <index>. "
        "Nếu danh sách rỗng, môi trường hiện không expose microphone cho Python."
    )
