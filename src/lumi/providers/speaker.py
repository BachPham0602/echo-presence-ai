from __future__ import annotations

from pathlib import Path

SUPPORTED_REFERENCE_SUFFIXES = {".wav", ".flac", ".ogg", ".mp3", ".m4a"}


def list_speaker_profiles(owner_voice_dir: str | Path = "owner_voices") -> list[dict[str, object]]:
    """List ZipVoice reference-voice folders under owner_voices/."""
    base_dir = Path(owner_voice_dir)
    if not base_dir.exists():
        return []

    profiles = []
    for directory in sorted(base_dir.iterdir(), key=lambda item: item.name.lower()):
        if not directory.is_dir():
            continue
        references = _reference_files(directory)
        profiles.append({"name": directory.name, "sample_count": len(references)})
    return profiles


def _reference_files(directory: Path) -> list[Path]:
    if not directory.exists() or not directory.is_dir():
        return []
    return sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_REFERENCE_SUFFIXES),
        key=lambda path: path.name.lower(),
    )
