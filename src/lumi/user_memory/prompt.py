from __future__ import annotations

from typing import Any


def preference_system_addon(preferences: dict[str, Any] | None) -> str:
    """Short system-prompt block derived from learned user preferences."""
    if not preferences:
        return ""

    lines = ["=== SỞ THÍCH NGƯỜI DÙNG (áp dụng nhẹ, không lặp lại nguyên văn) ==="]

    length = preferences.get("response_length")
    if length == "short":
        lines.append("- Ưu tiên câu trả lời ngắn: 1–2 câu, đi thẳng vào ý.")
    elif length == "long":
        lines.append("- Người dùng thích nghe kỹ hơn: có thể 2–4 câu, thêm chi tiết nhẹ nhàng.")

    tone = preferences.get("tone")
    if tone == "casual":
        lines.append("- Giọng thân mật, ít xưng hô trang trọng.")
    elif tone == "formal":
        lines.append("- Giọng lễ phép, nhẹ nhàng, tránh slang.")

    if preferences.get("ask_followup") is False:
        lines.append("- Hạn chế hỏi thêm; ưu tiên lắng nghe và xác nhận cảm xúc.")
    elif preferences.get("ask_followup") is True:
        lines.append("- Có thể hỏi thêm một câu mở nhẹ nếu phù hợp.")

    if preferences.get("likes_examples"):
        lines.append("- Thích ví dụ hoặc gợi ý cụ thể khi phù hợp.")

    notes = preferences.get("notes") or []
    for note in notes[:3]:
        text = str(note).strip()
        if text:
            lines.append(f"- {text}")

    if len(lines) <= 1:
        return ""
    return "\n".join(lines)
