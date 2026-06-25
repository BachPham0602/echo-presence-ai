import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

from lumi.models import TranscriptSegment
from lumi.providers.speaker import RealSpeakerVerifier, list_speaker_profiles


class SpeakerProfileTest(unittest.TestCase):
    def test_list_speaker_profiles_counts_audio_samples(self):
        with TemporaryDirectory() as tmpdir:
            owner_dir = Path(tmpdir) / "Minh"
            owner_dir.mkdir()
            (owner_dir / "sample_1.wav").write_bytes(b"fake")
            (owner_dir / "notes.txt").write_text("ignore")

            profiles = list_speaker_profiles(tmpdir)

        self.assertEqual(profiles, [{"name": "Minh", "sample_count": 1}])

    def test_verify_requires_selected_owner_profile(self):
        verifier = RealSpeakerVerifier(owner_voice_dir="missing-owner-voices")

        decision = verifier.verify(TranscriptSegment(text="", audio_path="input.wav"), owner_name=None)

        self.assertFalse(decision.verified)
        self.assertIn("Chưa chọn người nói", decision.reason)

    def test_verify_requires_samples_in_selected_profile(self):
        with TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / "Minh").mkdir()
            verifier = RealSpeakerVerifier(owner_voice_dir=tmpdir)

            decision = verifier.verify(TranscriptSegment(text="", audio_path="input.wav"), owner_name="Minh")

        self.assertFalse(decision.verified)
        self.assertIn("Chưa có mẫu giọng", decision.reason)


if __name__ == "__main__":
    unittest.main()
