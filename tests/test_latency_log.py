import unittest
from io import StringIO
from unittest.mock import patch

from lumi.latency_log import ModelTimer, format_wall_time


class ModelTimerTest(unittest.TestCase):
    def test_logs_start_and_end_with_duration(self):
        buffer = StringIO()
        with patch("sys.stdout", buffer):
            with ModelTimer("llm/test-model", method="generate", detail="xin chao"):
                pass
        output = buffer.getvalue()
        self.assertIn("[MODEL] llm/test-model/generate start=", output)
        self.assertIn("detail='xin chao'", output)
        self.assertIn("→", output)
        self.assertIn("ms) status=ok", output)

    def test_format_wall_time_has_milliseconds(self):
        self.assertRegex(format_wall_time(), r"^\d{2}:\d{2}:\d{2}\.\d{3}$")


if __name__ == "__main__":
    unittest.main()
