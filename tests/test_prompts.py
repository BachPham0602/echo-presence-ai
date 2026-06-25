import unittest

from lumi.prompts import RESPONSE_SYSTEM_PROMPT


class PromptTest(unittest.TestCase):
    def test_common_response_prompt_prioritizes_natural_listening_experience(self):
        self.assertIn("text chat và voice chat", RESPONSE_SYSTEM_PROMPT)
        self.assertIn("trải nghiệm nghe", RESPONSE_SYSTEM_PROMPT)
        self.assertIn("tự nhiên và dễ nghe", RESPONSE_SYSTEM_PROMPT)
        self.assertIn("Tránh gạch đầu dòng", RESPONSE_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
