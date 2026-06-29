from __future__ import annotations

import re
import threading
from typing import Any, Callable

from lumi.user_memory.store import DEFAULT_PREFERENCES, UserMemoryStore

_SHORT_HINTS = (
    "ngan thoi",
    "noi ngan",
    "gon thoi",
    "tom lai",
    "it thoi",
    "mot cau thoi",
)
_LONG_HINTS = (
    "noi dai hon",
    "ke them",
    "chi tiet hon",
    "noi ro hon",
    "gioi thich them",
)
_NO_FOLLOWUP_HINTS = (
    "dung hoi",
    "khoi hoi",
    "thoi hoi",
    "dung hoi nua",
    "khong hoi",
)
_FOLLOWUP_HINTS = (
    "hoi minh",
    "hoi them",
    "ban nghi sao",
)
_EXAMPLE_HINTS = (
    "vi du",
    "ke vi du",
    "goi y cu the",
)
_CASUAL_HINTS = ("thoi", "oke", "ok", "vui ve", "vui thoi")
_FORMAL_HINTS = ("dạ", "ạ", "lễ phép")


def _normalize(text: str) -> str:
    lowered = text.lower()
    replacements = {
        "ă": "a",
        "â": "a",
        "á": "a",
        "à": "a",
        "ả": "a",
        "ã": "a",
        "ạ": "a",
        "ắ": "a",
        "ằ": "a",
        "ẳ": "a",
        "ẵ": "a",
        "ặ": "a",
        "ấ": "a",
        "ầ": "a",
        "ẩ": "a",
        "ẫ": "a",
        "ậ": "a",
        "đ": "d",
        "ê": "e",
        "é": "e",
        "è": "e",
        "ẻ": "e",
        "ẽ": "e",
        "ẹ": "e",
        "í": "i",
        "ì": "i",
        "ỉ": "i",
        "ĩ": "i",
        "ị": "i",
        "ô": "o",
        "ơ": "o",
        "ó": "o",
        "ò": "o",
        "ỏ": "o",
        "õ": "o",
        "ọ": "o",
        "ư": "u",
        "ú": "u",
        "ù": "u",
        "ủ": "u",
        "ũ": "u",
        "ụ": "u",
        "ý": "y",
        "ỳ": "y",
        "ỷ": "y",
        "ỹ": "y",
        "ỵ": "y",
    }
    for src, dst in replacements.items():
        lowered = lowered.replace(src, dst)
    return re.sub(r"\s+", " ", lowered).strip()


def learn_preferences_from_turns(turns: list[dict[str, str]], current: dict[str, Any] | None = None) -> dict[str, Any]:
    """Heuristic preference update from a finished session transcript."""
    prefs = dict(DEFAULT_PREFERENCES)
    if current:
        prefs.update(current)

    signals = dict(prefs.get("signals") or {})
    user_blob = " ".join(_normalize(t.get("user", "")) for t in turns)
    if not user_blob.strip():
        return prefs

    def bump(key: str, amount: int = 1) -> None:
        signals[key] = int(signals.get(key, 0)) + amount

    for hint in _SHORT_HINTS:
        if hint in user_blob:
            bump("short")
    for hint in _LONG_HINTS:
        if hint in user_blob:
            bump("long")
    for hint in _NO_FOLLOWUP_HINTS:
        if hint in user_blob:
            bump("no_followup")
    for hint in _FOLLOWUP_HINTS:
        if hint in user_blob:
            bump("followup")
    for hint in _EXAMPLE_HINTS:
        if hint in user_blob:
            bump("examples")
    for hint in _CASUAL_HINTS:
        if hint in user_blob:
            bump("casual")
    for hint in _FORMAL_HINTS:
        if _normalize(hint) in user_blob or hint in user_blob:
            bump("formal")

    if signals.get("short", 0) > signals.get("long", 0):
        prefs["response_length"] = "short"
    elif signals.get("long", 0) > signals.get("short", 0):
        prefs["response_length"] = "long"
    else:
        prefs["response_length"] = current.get("response_length", "medium") if current else "medium"

    if signals.get("no_followup", 0) > signals.get("followup", 0):
        prefs["ask_followup"] = False
    elif signals.get("followup", 0) > 0:
        prefs["ask_followup"] = True

    if signals.get("examples", 0) > 0:
        prefs["likes_examples"] = True

    if signals.get("casual", 0) > signals.get("formal", 0):
        prefs["tone"] = "casual"
    elif signals.get("formal", 0) > signals.get("casual", 0):
        prefs["tone"] = "formal"
    else:
        prefs["tone"] = current.get("tone", "warm_polite") if current else "warm_polite"

    notes = list(prefs.get("notes") or [])
    if signals.get("short", 0) >= 2 and "Thích câu trả lời ngắn." not in notes:
        notes.append("Thích câu trả lời ngắn.")
    if signals.get("no_followup", 0) >= 2 and "Không thích bị hỏi thêm nhiều." not in notes:
        notes.append("Không thích bị hỏi thêm nhiều.")
    prefs["notes"] = notes[:5]
    prefs["signals"] = signals
    prefs["session_count"] = int(prefs.get("session_count") or 0) + 1
    return prefs


class PreferenceLearningWorker:
    """Background worker: learn style when a chat session ends."""

    def __init__(self, store: UserMemoryStore):
        self.store = store

    def schedule_session_end(
        self,
        user_id: str,
        session_id: str,
        reason: str = "session_end",
        min_turns: int = 1,
    ) -> None:
        thread = threading.Thread(
            target=self._run_session_end,
            args=(user_id, session_id, reason, min_turns),
            name=f"lumi-memory-{session_id[:8]}",
            daemon=True,
        )
        thread.start()

    def _run_session_end(self, user_id: str, session_id: str, reason: str, min_turns: int) -> None:
        try:
            if self.store.session_turn_count(user_id, session_id) < min_turns:
                turns = self.store.read_session_transcript(user_id, session_id)
                if len(turns) < min_turns:
                    print(f"[user_memory] Bỏ qua học style ({reason}): session quá ngắn.")
                    return

            turns = self.store.read_session_transcript(user_id, session_id)
            current = self.store.load_preferences(user_id)
            updated = learn_preferences_from_turns(turns, current)
            self.store.save_preferences(user_id, updated)
            print(
                f"[user_memory] Đã cập nhật sở thích cho {user_id} "
                f"(session={session_id}, reason={reason}, turns={len(turns)})."
            )
        except Exception as exc:
            print(f"[user_memory] Lỗi học style: {exc}")
