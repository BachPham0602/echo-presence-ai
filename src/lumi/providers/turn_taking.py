from __future__ import annotations

from lumi.models import TranscriptSegment, TurnDecision
from lumi.providers.addressee import _normalize


class HeuristicTurnTakingDetector:
    end_particles = {
        "nhỉ", "nhé", "nha", "nghen", 
        "hả", "hah", "không", "chưa", 
        "à", "ừ", "ờ", "thôi"
    }

    keep_turn_particles = {
        "mà", "nhưng mà", "rồi",
        "là", "tức là", "ý tôi là",
        "ừm", "à", "thì", "kiểu như", "kiểu",
        "và", "với", "nhưng", "vì", "nên", "nếu"
    }

    def __init__(self, silence_seconds: float = 0.6):
        self.silence_seconds = silence_seconds

    def decide(self, segment: TranscriptSegment, speech_gap_seconds: float) -> TurnDecision:
        text = segment.text.strip()
        normalized = _normalize(text)

        if not text:
            return TurnDecision(False, 1.0, "Transcript rỗng.", wait_ms=400)

        tokens = normalized.split()
        if not tokens:
            return TurnDecision(False, 1.0, "Transcript rỗng.", wait_ms=400)

        last_1 = tokens[-1]
        last_2 = " ".join(tokens[-2:]) if len(tokens) >= 2 else ""
        last_3 = " ".join(tokens[-3:]) if len(tokens) >= 3 else ""

        # 1. Có filler word hoặc từ nối ở cuối? -> Giữ lượt, chờ lâu hơn (2000ms)
        for p in self.keep_turn_particles:
            if last_1 == p or last_2 == p or last_3 == p:
                return TurnDecision(False, 0.9, f"Có từ giữ lượt: '{p}'", wait_ms=2000)

        # 2. Câu có tiểu từ kết thúc hoặc câu hỏi? -> Chuyển lượt
        for p in self.end_particles:
            if last_1 == p or last_2 == p:
                return TurnDecision(True, 0.9, f"Có tiểu từ kết thúc: '{p}'", wait_ms=0)

        # Mẹo: câu không có động từ chính (nếu chỉ 1-2 từ không phải tiểu từ) thường chưa xong
        if len(tokens) <= 2:
            return TurnDecision(False, 0.6, "Câu quá ngắn, có thể chưa xong", wait_ms=800)
            
        # Nếu câu quá dài, khả năng cao là họ đã hoàn thành một ý lớn
        if len(tokens) > 15:
            return TurnDecision(False, 0.8, "Câu dài, có thể đã xong ý", wait_ms=400)

        # 3. Không rõ -> Xem như đã xong (True) để phản hồi ngay, LLM sẽ tự hỏi lại nếu thiếu ý
        return TurnDecision(True, 0.5, "Không rõ ý, nhưng chuyển LLM tự hỏi lại", wait_ms=0)

class LlmTurnTakingDetector:
    """Sử dụng Qwen LLM để quyết định người dùng đã nói xong chưa."""
    def __init__(self, llm):
        self.llm = llm

    def decide(self, segment: TranscriptSegment, speech_gap_seconds: float) -> TurnDecision:
        text = segment.text.strip()
        if not text:
            return TurnDecision(False, 1.0, "Câu trống.", wait_ms=400)
        prompt = f"Câu nói: '{text}'. Câu này đã trọn ý chưa hay người nói đang ngập ngừng và sẽ nói tiếp? Trả lời 'Xong' hoặc 'Chưa'."
        reply = self.llm.generate_classification(prompt).strip().lower()
        finished = "xong" in reply or "yes" in reply
        return TurnDecision(finished, 0.9, f"LLM decision: {reply}", wait_ms=0 if finished else 2000)
