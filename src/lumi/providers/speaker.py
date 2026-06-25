from __future__ import annotations

from pathlib import Path

from lumi.models import SpeakerDecision, TranscriptSegment


SUPPORTED_REFERENCE_SUFFIXES = {".wav", ".flac", ".ogg", ".mp3", ".m4a"}


def list_speaker_profiles(owner_voice_dir: str | Path = "owner_voices") -> list[dict[str, object]]:
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


class RealSpeakerVerifier:
    """Sử dụng SpeechBrain ECAPA-TDNN để nhận diện người nói đã enroll."""

    def __init__(
        self,
        reference_audio_path: str = "owner_reference.wav",
        threshold: float = 0.20,
        owner_voice_dir: str | Path = "owner_voices",
        speaker_model: str = "speechbrain/spkrec-ecapa-voxceleb",
        top_k: int = 3,
    ):
        self.reference_audio_path = Path(reference_audio_path)
        self.threshold = threshold
        self.owner_voice_dir = Path(owner_voice_dir)
        self.speaker_model = speaker_model
        self.top_k = max(1, top_k)
        self.verifier = None

    def _load_model(self):
        if self.verifier is None:
            try:
                from speechbrain.inference.speaker import SpeakerRecognition

                self.verifier = SpeakerRecognition.from_hparams(
                    source=self.speaker_model,
                    savedir="tmpdir",
                )
            except Exception as e:
                print(f"Không thể tải SpeechBrain model: {e}")
                self.verifier = False

    def verify(self, segment: TranscriptSegment, owner_name: str | None = None) -> SpeakerDecision:
        if not segment.audio_path:
            return SpeakerDecision("unknown", True, 1.0, "Không có audio để phân tích.")

        clean_owner_name = _safe_owner_name(owner_name)
        if not clean_owner_name:
            return SpeakerDecision(
                "unknown",
                False,
                0.0,
                "Chưa chọn người nói. Hãy chọn một profile trong owner_voices trước khi bật Voice Chat.",
            )

        owner_dir = self.owner_voice_dir / clean_owner_name
        references = _reference_files(owner_dir)
        if not references:
            return SpeakerDecision(
                clean_owner_name,
                False,
                0.0,
                f"Chưa có mẫu giọng cho {clean_owner_name}. Thêm file audio vào {owner_dir}.",
            )

        self._load_model()
        if not self.verifier:
            return SpeakerDecision(clean_owner_name, True, 0.5, "Không tải được model, tạm chấp nhận.")

        scores: list[float] = []
        failed = 0
        for reference_path in references:
            try:
                score, _prediction = self.verifier.verify_files(str(reference_path), str(segment.audio_path))
                scores.append(float(score.item()))
            except Exception as exc:
                failed += 1
                print(f"Lỗi so sánh giọng với {reference_path}: {exc}")

        if not scores:
            return SpeakerDecision(
                clean_owner_name,
                True,
                0.5,
                f"Không so sánh được mẫu nào cho {clean_owner_name}, tạm chấp nhận.",
            )

        scores.sort(reverse=True)
        best_score = scores[0]
        top_scores = scores[: self.top_k]
        top_average = sum(top_scores) / len(top_scores)
        is_owner = best_score >= self.threshold or top_average >= self.threshold
        status = "owner" if is_owner else "guest"
        detail = (
            f"Người nói đã chọn: {clean_owner_name}. "
            f"best={best_score:.2f}, top{len(top_scores)}_avg={top_average:.2f}, "
            f"threshold={self.threshold:.2f}, samples={len(scores)}"
        )
        if failed:
            detail += f", lỗi {failed} mẫu"
        return SpeakerDecision(status, is_owner, best_score, detail)


def _reference_files(directory: Path) -> list[Path]:
    if not directory.exists() or not directory.is_dir():
        return []
    return sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_REFERENCE_SUFFIXES),
        key=lambda path: path.name.lower(),
    )


def _safe_owner_name(owner_name: str | None) -> str | None:
    if owner_name is None:
        return None
    value = owner_name.strip()
    if not value or "/" in value or "\\" in value or chr(0) in value:
        return None
    return value
