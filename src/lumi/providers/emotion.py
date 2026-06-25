from __future__ import annotations

from lumi.models import EmotionDecision
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
