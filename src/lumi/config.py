from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DATE_FORMAT = "%Y%m%d"
DEFAULT_EMOTION_REPO_ID = "tabularisai/multilingual-emotion-classification"
DEFAULT_EMOTION_LOCAL_DIR = PROJECT_ROOT / "models/emotion/tabularisai-multilingual-emotion-classification"
DEFAULT_EMOTION_MODEL = str(DEFAULT_EMOTION_LOCAL_DIR) if DEFAULT_EMOTION_LOCAL_DIR.exists() else DEFAULT_EMOTION_REPO_ID


@dataclass(frozen=True)
class LumiConfig:
    owner_name: str = "Uyên"
    bot_pronoun: str = "Lumi"
    user_pronoun: str = "bạn"
    silence_seconds: float = 1.5
    debug: bool = True

    asr_model: str = "vinai/PhoWhisper-small"
    llm_model: str = "Qwen/Qwen2.5-3B-Instruct"
    speaker_model: str = "speechbrain/spkrec-ecapa-voxceleb"
    emotion_model: str = DEFAULT_EMOTION_MODEL

    asr_provider: str = "phowhisper"
    response_provider: str = "qwen"
    tts_provider: str = "zipvoice" # "edge-tts" hoặc "zipvoice"
    emotion_provider: str = "hf"

    tts_mode: str = "standard"
    tts_voice: str | None = "Doan"
    tts_reference_wav: str | None = None
    tts_reference_text: str | None = None
    tts_reference_speaker: str | None = "Uyên"
    llm_max_new_tokens: int = 160
    llm_voice_max_new_tokens: int = 110
    llm_temperature: float = 0.25
    llm_repetition_penalty: float = 1.12
    llm_no_repeat_ngram_size: int = 5
    emotion_min_confidence: float = 0.55
    output_dir: str = "outputs"
    output_subdir: str | None = None
    owner_voice_dir: str = "owner_voices"
    cuda_visible_devices: str | None = "0"

    @classmethod
    def from_env(cls) -> "LumiConfig":
        cuda_visible_devices = os.getenv(
            "LUMI_CUDA_VISIBLE_DEVICES",
            os.getenv("CUDA_VISIBLE_DEVICES", cls.cuda_visible_devices or ""),
        )
        return cls(
            owner_name=os.getenv("LUMI_OWNER_NAME", cls.owner_name),
            bot_pronoun=os.getenv("LUMI_BOT_PRONOUN", cls.bot_pronoun),
            user_pronoun=os.getenv("LUMI_USER_PRONOUN", cls.user_pronoun),
            silence_seconds=float(os.getenv("LUMI_SILENCE_SECONDS", cls.silence_seconds)),
            debug=os.getenv("LUMI_DEBUG", "1") not in {"0", "false", "False"},
            asr_model=os.getenv("LUMI_ASR_MODEL", cls.asr_model),
            llm_model=os.getenv("LUMI_LLM_MODEL", cls.llm_model),
            speaker_model=os.getenv("LUMI_SPEAKER_MODEL", cls.speaker_model),
            emotion_model=os.getenv("LUMI_EMOTION_MODEL", cls.emotion_model),
            asr_provider=os.getenv("LUMI_ASR_PROVIDER", cls.asr_provider),
            response_provider=os.getenv("LUMI_RESPONSE_PROVIDER", cls.response_provider),
            tts_provider=os.getenv("LUMI_TTS_PROVIDER", cls.tts_provider),
            emotion_provider=os.getenv("LUMI_EMOTION_PROVIDER", cls.emotion_provider),
            tts_mode=os.getenv("LUMI_TTS_MODE", cls.tts_mode),
            tts_voice=os.getenv("LUMI_TTS_VOICE", cls.tts_voice),
            tts_reference_wav=os.getenv("LUMI_TTS_REFERENCE_WAV", cls.tts_reference_wav),
            tts_reference_text=os.getenv("LUMI_TTS_REFERENCE_TEXT", cls.tts_reference_text),
            tts_reference_speaker=os.getenv("LUMI_TTS_REFERENCE_SPEAKER", cls.tts_reference_speaker),
            llm_max_new_tokens=int(os.getenv("LUMI_LLM_MAX_NEW_TOKENS", cls.llm_max_new_tokens)),
            llm_voice_max_new_tokens=int(os.getenv("LUMI_LLM_VOICE_MAX_NEW_TOKENS", cls.llm_voice_max_new_tokens)),
            llm_temperature=float(os.getenv("LUMI_LLM_TEMPERATURE", cls.llm_temperature)),
            llm_repetition_penalty=float(os.getenv("LUMI_LLM_REPETITION_PENALTY", cls.llm_repetition_penalty)),
            llm_no_repeat_ngram_size=int(os.getenv("LUMI_LLM_NO_REPEAT_NGRAM_SIZE", cls.llm_no_repeat_ngram_size)),
            emotion_min_confidence=float(os.getenv("LUMI_EMOTION_MIN_CONFIDENCE", cls.emotion_min_confidence)),
            output_dir=os.getenv("LUMI_OUTPUT_DIR", cls.output_dir),
            output_subdir=os.getenv("LUMI_OUTPUT_SUBDIR", cls.output_subdir),
            owner_voice_dir=os.getenv("LUMI_OWNER_VOICE_DIR", cls.owner_voice_dir),
            cuda_visible_devices=cuda_visible_devices or None,
        )

    @property
    def output_root_path(self) -> Path:
        return _project_path(self.output_dir)

    @property
    def output_path(self) -> Path:
        subdir = _safe_output_subdir(self.output_subdir) if self.output_subdir else output_date_dir_name()
        return self.output_root_path / subdir

    @property
    def owner_voice_path(self) -> Path:
        return _project_path(self.owner_voice_dir)

    def apply_cuda_visible_devices(self) -> None:
        """Pin Lumi to selected physical GPU(s) before torch/transformers load CUDA."""
        if self.cuda_visible_devices is None:
            return
        os.environ["CUDA_VISIBLE_DEVICES"] = self.cuda_visible_devices
        # Giúp PyTorch trả lại VRAM cho OS tích cực hơn, tránh xung đột với llama-cpp-python
        os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"


def output_date_dir_name(now: datetime | None = None) -> str:
    return (now or datetime.now()).strftime(OUTPUT_DATE_FORMAT)


def _project_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else PROJECT_ROOT / path


def _safe_output_subdir(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        return output_date_dir_name()
    path = Path(cleaned)
    if path.is_absolute() or len(path.parts) != 1 or path.name in {".", ".."}:
        raise ValueError(f"Output subdir không hợp lệ: {value}")
    return cleaned
