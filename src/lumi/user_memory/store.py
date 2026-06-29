from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any

from lumi.config import PROJECT_ROOT, LumiConfig
from lumi.user_memory.prompt import preference_system_addon

DEFAULT_PREFERENCES: dict[str, Any] = {
    "response_length": "medium",
    "tone": "warm_polite",
    "ask_followup": True,
    "likes_examples": False,
    "notes": [],
    "signals": {},
    "session_count": 0,
    "updated_at": None,
}


def sanitize_user_id(display_name: str) -> str:
    raw = display_name.strip()
    if not raw:
        raise ValueError("Tên người dùng không được để trống.")

    normalized = unicodedata.normalize("NFKD", raw.lower())
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", ascii_name).strip("-")
    if cleaned:
        return cleaned[:64]

    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    return f"user_{digest}"


class UserMemoryStore:
    """Filesystem store: users/<id>/profile, preferences, session transcripts."""

    def __init__(self, config: LumiConfig | None = None, root_dir: str | Path | None = None):
        self.config = config or LumiConfig.from_env()
        self.root = Path(root_dir) if root_dir else PROJECT_ROOT / "users"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._session_turn_counts: dict[str, int] = {}

    def user_dir(self, user_id: str) -> Path:
        safe = re.sub(r"[^a-z0-9_-]+", "-", user_id.strip().lower())[:64]
        if not safe:
            raise ValueError("user_id không hợp lệ.")
        path = self.root / safe
        path.mkdir(parents=True, exist_ok=True)
        return path

    def login(self, display_name: str) -> dict[str, Any]:
        user_id = sanitize_user_id(display_name)
        with self._lock:
            base = self.user_dir(user_id)
            profile_path = base / "profile.json"
            prefs_path = base / "preferences.json"
            if not profile_path.exists():
                profile_path.write_text(
                    json.dumps(
                        {
                            "display_name": display_name.strip(),
                            "user_id": user_id,
                            "created_at": _utc_now(),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            else:
                profile = self._read_json(profile_path, {})
                profile["display_name"] = display_name.strip()
                profile["last_login_at"] = _utc_now()
                profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

            if not prefs_path.exists():
                prefs_path.write_text(
                    json.dumps(DEFAULT_PREFERENCES, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

            preferences = self.load_preferences(user_id)
            return {
                "user_id": user_id,
                "display_name": display_name.strip(),
                "preferences": preferences,
                "preference_prompt_ready": bool(preference_system_addon(preferences)),
            }

    def load_preferences(self, user_id: str) -> dict[str, Any]:
        prefs_path = self.user_dir(user_id) / "preferences.json"
        data = self._read_json(prefs_path, dict(DEFAULT_PREFERENCES))
        merged = dict(DEFAULT_PREFERENCES)
        merged.update(data)
        return merged

    def save_preferences(self, user_id: str, preferences: dict[str, Any]) -> None:
        prefs_path = self.user_dir(user_id) / "preferences.json"
        payload = dict(DEFAULT_PREFERENCES)
        payload.update(preferences)
        payload["updated_at"] = _utc_now()
        with self._lock:
            prefs_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def preference_prompt_addon(self, user_id: str | None) -> str:
        if not user_id:
            return ""
        return preference_system_addon(self.load_preferences(user_id))

    def session_file(self, user_id: str, session_id: str) -> Path:
        day = datetime.now().strftime("%Y-%m-%d")
        sessions_dir = self.user_dir(user_id) / "sessions" / day
        sessions_dir.mkdir(parents=True, exist_ok=True)
        safe_session = re.sub(r"[^a-zA-Z0-9_-]+", "-", session_id)[:80] or "session"
        return sessions_dir / f"{safe_session}.jsonl"

    def append_turn(self, user_id: str, session_id: str, user_text: str, assistant_text: str) -> None:
        if not user_id or not session_id:
            return
        user_text = (user_text or "").strip()
        assistant_text = (assistant_text or "").strip()
        if not user_text and not assistant_text:
            return

        record = {
            "ts": _utc_now(),
            "session_id": session_id,
            "user": user_text,
            "assistant": assistant_text,
        }
        path = self.session_file(user_id, session_id)
        with self._lock:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        key = f"{user_id}:{session_id}"
        self._session_turn_counts[key] = self._session_turn_counts.get(key, 0) + 1

    def session_turn_count(self, user_id: str, session_id: str) -> int:
        return self._session_turn_counts.get(f"{user_id}:{session_id}", 0)

    def read_session_transcript(self, user_id: str, session_id: str) -> list[dict[str, str]]:
        day = datetime.now().strftime("%Y-%m-%d")
        sessions_dir = self.user_dir(user_id) / "sessions" / day
        safe_session = re.sub(r"[^a-zA-Z0-9_-]+", "-", session_id)[:80] or "session"
        path = sessions_dir / f"{safe_session}.jsonl"
        if not path.exists():
            return []

        turns: list[dict[str, str]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            turns.append(
                {
                    "user": str(item.get("user", "")),
                    "assistant": str(item.get("assistant", "")),
                }
            )
        return turns

    def get_memory_summary(self, user_id: str) -> dict[str, Any]:
        profile_path = self.user_dir(user_id) / "profile.json"
        profile = self._read_json(profile_path, {})
        preferences = self.load_preferences(user_id)
        return {
            "user_id": user_id,
            "display_name": profile.get("display_name", user_id),
            "preferences": preferences,
            "preference_prompt_addon": preference_system_addon(preferences),
        }

    @staticmethod
    def _read_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return default


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
