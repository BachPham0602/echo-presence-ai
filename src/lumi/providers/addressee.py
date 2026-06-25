from __future__ import annotations

import re

from lumi.models import AddresseeDecision


class HeuristicAddresseeDetector:
    """Bản heuristic nhỏ, dùng tạm trước khi gắn LLM addressee detector."""

    direct_patterns = (
        r"\blumi\b",
        r"lumi oi",
        r"anh sang oi",
        r"ban oi",
        r"nghe minh",
    )
    self_talk_patterns = (
        r"tu noi",
        r"noi mot minh",
        r"khong noi voi ai",
        r"thoi ke",
    )
    question_words = ("sao", "duoc khong", "nen", "co nen", "ban nghi", "giup minh")
    emotional_disclosures = (
        "co don",
        "buon",
        "met",
        "cang thang",
        "ap luc",
        "so hai",
        "lo lang",
        "khong on",
    )

    def detect(self, text: str, history: list[dict[str, str]]) -> AddresseeDecision:
        normalized = _normalize(text)

        if any(re.search(pattern, normalized) for pattern in self.self_talk_patterns):
            return AddresseeDecision(False, 0.82, "Người dùng nói rõ đây là độc thoại/tự nói một mình.")

        if any(re.search(pattern, normalized) for pattern in self.direct_patterns):
            return AddresseeDecision(True, 0.94, "Người dùng gọi trực tiếp Lumi hoặc dùng cách xưng hô trực tiếp.")

        if history and history[-1].get("role") == "assistant" and normalized:
            return AddresseeDecision(True, 0.72, "Người dùng có vẻ đang trả lời tin nhắn gần nhất của Lumi.")

        if "?" in text or any(phrase in normalized for phrase in self.question_words):
            return AddresseeDecision(True, 0.68, "Người dùng đang hỏi hoặc muốn nghe góc nhìn từ Lumi.")

        if any(phrase in normalized for phrase in self.emotional_disclosures):
            return AddresseeDecision(True, 0.61, "Người dùng chia sẻ cảm xúc nên Lumi có thể đáp lại nhẹ nhàng.")

        return AddresseeDecision(False, 0.58, "Chưa thấy dấu hiệu rõ rằng người dùng đang nói với Lumi.")

class LlmAddresseeDetector:
    """Sử dụng Qwen LLM để phân tích xem người dùng có đang nói chuyện với Lumi không."""
    def __init__(self, llm):
        self.llm = llm

    def detect(self, text: str, history: list[dict[str, str]]) -> AddresseeDecision:
        if not text.strip():
            return AddresseeDecision(False, 1.0, "Câu trống.")
        prompt = f"Câu nói: '{text}'. Câu này có phải là câu đang nói với bạn không? Trả lời 'Có' hoặc 'Không'."
        reply = self.llm.generate_classification(prompt).strip().lower()
        addressed = "có" in reply or "yes" in reply or "co" in reply
        return AddresseeDecision(addressed, 0.9, f"LLM decision: {reply}")


def _normalize(text: str) -> str:
    lowered = text.lower()
    replacements = {
        "ơi": "oi",
        "ánh": "anh",
        "đ": "d",
        "Đ": "d",
        "á": "a",
        "à": "a",
        "ả": "a",
        "ã": "a",
        "ạ": "a",
        "ă": "a",
        "ắ": "a",
        "ằ": "a",
        "ẳ": "a",
        "ẵ": "a",
        "ặ": "a",
        "â": "a",
        "ấ": "a",
        "ầ": "a",
        "ẩ": "a",
        "ẫ": "a",
        "ậ": "a",
        "é": "e",
        "è": "e",
        "ẻ": "e",
        "ẽ": "e",
        "ẹ": "e",
        "ê": "e",
        "ế": "e",
        "ề": "e",
        "ể": "e",
        "ễ": "e",
        "ệ": "e",
        "í": "i",
        "ì": "i",
        "ỉ": "i",
        "ĩ": "i",
        "ị": "i",
        "ó": "o",
        "ò": "o",
        "ỏ": "o",
        "õ": "o",
        "ọ": "o",
        "ô": "o",
        "ố": "o",
        "ồ": "o",
        "ổ": "o",
        "ỗ": "o",
        "ộ": "o",
        "ơ": "o",
        "ớ": "o",
        "ờ": "o",
        "ở": "o",
        "ỡ": "o",
        "ợ": "o",
        "ú": "u",
        "ù": "u",
        "ủ": "u",
        "ũ": "u",
        "ụ": "u",
        "ư": "u",
        "ứ": "u",
        "ừ": "u",
        "ử": "u",
        "ữ": "u",
        "ự": "u",
        "ý": "y",
        "ỳ": "y",
        "ỷ": "y",
        "ỹ": "y",
        "ỵ": "y",
    }
    for source, target in replacements.items():
        lowered = lowered.replace(source, target)
    return re.sub(r"\s+", " ", lowered).strip()
