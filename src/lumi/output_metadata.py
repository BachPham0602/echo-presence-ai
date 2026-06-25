from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any


def write_audio_sidecars(
    audio_path: str | Path | None,
    text: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Write .txt and .json files next to an audio file.

    The .txt file is the human-readable speech for that exact audio file.
    The .json file carries the same text plus pipeline metadata for debugging.
    """
    if not audio_path:
        return {}

    path = Path(audio_path)
    if not path.exists() or not path.is_file():
        return {}

    spoken_text = text or ""
    text_path = path.with_suffix(".txt")
    metadata_path = path.with_suffix(".json")

    text_path.write_text(_text_file_body(spoken_text), encoding="utf-8")

    payload: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "audio_file": path.name,
        "audio_path": str(path),
        "text": spoken_text,
    }
    if metadata:
        payload.update(_json_safe(metadata))

    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"text_path": str(text_path), "metadata_path": str(metadata_path)}


def _text_file_body(text: str) -> str:
    if not text:
        return ""
    return text.rstrip() + "\n"


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    return value
