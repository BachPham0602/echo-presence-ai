import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from lumi.output_metadata import write_audio_sidecars


class OutputMetadataTest(unittest.TestCase):
    def test_writes_text_and_json_next_to_audio(self):
        with TemporaryDirectory() as tmpdir:
            audio_path = Path(tmpdir) / "lumi_test.wav"
            audio_path.write_bytes(b"fake wav")

            paths = write_audio_sidecars(
                audio_path,
                "Xin chào bạn",
                {"audio_role": "assistant_response", "tts_engine": "fake-tts"},
            )

            text_path = Path(paths["text_path"])
            metadata_path = Path(paths["metadata_path"])
            self.assertEqual(text_path.read_text(encoding="utf-8"), "Xin chào bạn\n")

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["audio_file"], "lumi_test.wav")
            self.assertEqual(metadata["text"], "Xin chào bạn")
            self.assertEqual(metadata["audio_role"], "assistant_response")
            self.assertEqual(metadata["tts_engine"], "fake-tts")


if __name__ == "__main__":
    unittest.main()
