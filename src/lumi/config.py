from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LumiConfig:
    owner_name: str = "bạn"
    bot_pronoun: str = "Lumi"
    user_pronoun: str = "bạn"
    silence_seconds: float = 1.5
    debug: bool = True

    asr_model: str = "vinai/PhoWhisper-small"
    llm_model: str = "Qwen/Qwen2.5-3B-Instruct"
    speaker_model: str = "speechbrain/spkrec-ecapa-voxceleb"

    asr_provider: str = "phowhisper"
    response_provider: str = "qwen"
    tts_provider: str = "edge-tts"

    tts_mode: str = "standard"
    tts_voice: str | None = "Doan"
    llm_max_new_tokens: int = 220
    llm_voice_max_new_tokens: int = 180
    llm_temperature: float = 0.40
    llm_repetition_penalty: float = 1.12
    llm_no_repeat_ngram_size: int = 5
    output_dir: str = "outputs"
    owner_voice_dir: str = "owner_voices"
    cuda_visible_devices: str | None = "1"

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
            asr_provider=os.getenv("LUMI_ASR_PROVIDER", cls.asr_provider),
            response_provider=os.getenv("LUMI_RESPONSE_PROVIDER", cls.response_provider),
            tts_provider=os.getenv("LUMI_TTS_PROVIDER", cls.tts_provider),
            tts_mode=os.getenv("LUMI_TTS_MODE", cls.tts_mode),
            tts_voice=os.getenv("LUMI_TTS_VOICE", cls.tts_voice),
            llm_max_new_tokens=int(os.getenv("LUMI_LLM_MAX_NEW_TOKENS", cls.llm_max_new_tokens)),
            llm_voice_max_new_tokens=int(os.getenv("LUMI_LLM_VOICE_MAX_NEW_TOKENS", cls.llm_voice_max_new_tokens)),
            llm_temperature=float(os.getenv("LUMI_LLM_TEMPERATURE", cls.llm_temperature)),
            llm_repetition_penalty=float(os.getenv("LUMI_LLM_REPETITION_PENALTY", cls.llm_repetition_penalty)),
            llm_no_repeat_ngram_size=int(os.getenv("LUMI_LLM_NO_REPEAT_NGRAM_SIZE", cls.llm_no_repeat_ngram_size)),
            output_dir=os.getenv("LUMI_OUTPUT_DIR", cls.output_dir),
            owner_voice_dir=os.getenv("LUMI_OWNER_VOICE_DIR", cls.owner_voice_dir),
            cuda_visible_devices=cuda_visible_devices or None,
        )

    @property
    def output_path(self) -> Path:
        return Path(self.output_dir)

    @property
    def owner_voice_path(self) -> Path:
        return Path(self.owner_voice_dir)

    def apply_cuda_visible_devices(self) -> None:
        """Pin Lumi to selected physical GPU(s) before torch/transformers load CUDA."""
        if self.cuda_visible_devices is None:
            return
        os.environ["CUDA_VISIBLE_DEVICES"] = self.cuda_visible_devices
        # Giúp PyTorch trả lại VRAM cho OS tích cực hơn, tránh xung đột với llama-cpp-python
        os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
