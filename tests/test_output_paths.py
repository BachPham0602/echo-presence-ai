import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from lumi.config import PROJECT_ROOT, LumiConfig, output_date_dir_name
from lumi.web_app import _output_file_url, _resolve_output_file_path


class OutputPathTest(unittest.TestCase):
    def test_output_path_uses_date_directory(self):
        self.assertEqual(output_date_dir_name(datetime(2026, 6, 26, 10, 30)), "20260626")

        config = LumiConfig(output_dir="outputs")

        self.assertEqual(config.output_root_path, PROJECT_ROOT / "outputs")
        self.assertEqual(config.output_path, PROJECT_ROOT / "outputs" / output_date_dir_name())

    def test_output_path_can_use_test_subdir(self):
        config = LumiConfig(output_dir="outputs", output_subdir="test")

        self.assertEqual(config.output_path, PROJECT_ROOT / "outputs" / "test")

    def test_output_url_keeps_date_directory(self):
        with TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "outputs"
            audio_path = output_root / "20260626" / "lumi_test.wav"
            audio_path.parent.mkdir(parents=True)
            audio_path.write_bytes(b"fake wav")

            self.assertEqual(
                _output_file_url(audio_path, output_root),
                "/outputs/20260626/lumi_test.wav",
            )
            self.assertEqual(
                _resolve_output_file_path(
                    "/outputs/20260626/lumi_test.wav",
                    output_root,
                    output_root / "20260626",
                ),
                audio_path.resolve(),
            )

    def test_output_file_resolution_rejects_parent_paths(self):
        with TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "outputs"
            output_root.mkdir()

            self.assertIsNone(
                _resolve_output_file_path(
                    "/outputs/../secret.wav",
                    output_root,
                    output_root / "20260626",
                )
            )


if __name__ == "__main__":
    unittest.main()
