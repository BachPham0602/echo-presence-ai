from __future__ import annotations

from lumi.config import LumiConfig
from lumi.models import EmotionDecision
from lumi.latency_log import ModelTimer
from lumi.providers.addressee import _normalize


class HeuristicEmotionClassifier:
    keywords = {
        "cô_đơn": ("co don", "mot minh", "trong trai", "khong co ai", "nho nha"),
        "buồn": ("buon", "that vong", "muon khoc", "chan nan", "dau long"),
        "mệt": ("met", "kiet suc", "buon ngu", "duoi", "khong con suc"),
        "căng_thẳng": ("cang thang", "stress", "ap luc", "lo lang", "so", "roi"),
        "vui": ("vui", "hanh phuc", "thich qua", "vui qua", "on qua", "tuyet"),
        "bình_yên": ("binh yen", "nhe long", "de chiu", "em"),
    }

    def classify(self, text: str) -> EmotionDecision:
        normalized = _normalize(text)
        for label, phrases in self.keywords.items():
            matched = [phrase for phrase in phrases if phrase in normalized]
            if matched:
                confidence = 0.78 if len(matched) > 1 else 0.66
                return EmotionDecision(label, confidence, f"Khớp từ khóa: {', '.join(matched)}")

        return EmotionDecision("trung_tính", 0.52, "Không thấy từ khóa cảm xúc rõ.")


class HuggingFaceEmotionClassifier:
    """Optional multilingual emotion classifier with heuristic fallback."""

    label_map = {
        "anger": "căng_thẳng",
        "disgust": "căng_thẳng",
        "fear": "căng_thẳng",
        "joy": "vui",
        "love": "bình_yên",
        "neutral": "trung_tính",
        "sadness": "buồn",
        "surprise": "trung_tính",
        "happy": "vui",
        "sad": "buồn",
        "anxiety": "căng_thẳng",
        "worry": "căng_thẳng",
    }

    def __init__(self, config: LumiConfig):
        self.config = config
        self._pipe = None
        self._fallback = HeuristicEmotionClassifier()
        self._disabled_reason: str | None = None

    def warmup(self) -> bool:
        try:
            pipe = self._load_pipeline()
            pipe("mình đang ổn")
            return True
        except Exception as exc:
            self._disabled_reason = str(exc)
            return False

    def classify(self, text: str) -> EmotionDecision:
        if self._disabled_reason:
            fallback = self._fallback.classify(text)
            return EmotionDecision(
                fallback.label,
                fallback.confidence,
                f"Fallback heuristic vì emotion model chưa sẵn sàng: {self._disabled_reason}",
            )
        try:
            pipe = self._load_pipeline()
            with ModelTimer(f"emotion/{self.config.emotion_model}", method="classify", detail=text[:80]):
                raw = pipe(text)
            choices = _flatten_classifier_output(raw)
            if not choices:
                return self._fallback.classify(text)

            best = max(choices, key=lambda item: float(item.get("score", 0.0)))
            raw_label = str(best.get("label", "neutral")).lower()
            score = float(best.get("score", 0.0))
            label = self.label_map.get(raw_label, self._fallback.classify(text).label)
            return EmotionDecision(label, score, f"HF {self.config.emotion_model}: {raw_label}={score:.2f}")
        except Exception as exc:
            self._disabled_reason = str(exc)
            fallback = self._fallback.classify(text)
            return EmotionDecision(fallback.label, fallback.confidence, f"Fallback heuristic sau lỗi emotion model: {exc}")

    def _load_pipeline(self):
        if self._pipe is not None:
            return self._pipe
        from transformers import pipeline

        self._pipe = pipeline(
            "text-classification",
            model=self.config.emotion_model,
            device=_select_pipeline_device(self.config),
            top_k=None,
        )
        return self._pipe


def _flatten_classifier_output(raw) -> list[dict]:
    if isinstance(raw, list) and raw and isinstance(raw[0], list):
        return [item for group in raw for item in group if isinstance(item, dict)]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        return [raw]
    return []


def _select_pipeline_device(_config: LumiConfig) -> int:
    try:
        import torch
    except ImportError:
        return -1
    return 0 if torch.cuda.is_available() else -1
