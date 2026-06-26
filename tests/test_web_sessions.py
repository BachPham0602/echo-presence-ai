import unittest

from lumi.config import LumiConfig
from lumi.models import TTSResult
from lumi.mvp_pipeline import LumiMvpPipeline
from lumi.web_app import LumiSessionManager, _clean_session_id, _new_session_id, _normalize_session_id


class FakeResponseGenerator:
    def generate(self, user_text, history, bot_pronoun=None, user_pronoun=None, max_new_tokens=None, temperature=None):
        return f"Phản hồi cho: {user_text}"

    def generate_classification(self, prompt):
        return "Có"


class FakeTTS:
    def synthesize_text(self, text):
        return TTSResult(audio_path="outputs/fake.wav", sample_rate=48000, engine="fake-tts")


class WebSessionTest(unittest.TestCase):
    def test_sessions_have_separate_buffers_and_history(self):
        prototype = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
        )
        manager = LumiSessionManager(prototype)

        first = manager.get("visitor-one")
        second = manager.get("visitor-two")
        first.pipeline.handle_chat("xin chào")

        self.assertEqual(first.pipeline.user_buffer, ["xin chào"])
        self.assertEqual(second.pipeline.user_buffer, [])
        self.assertIs(first.pipeline.response_generator, second.pipeline.response_generator)

    def test_session_id_is_ascii_safe(self):
        self.assertEqual(_normalize_session_id(" abc/中文:1 "), "abc:1")
        self.assertEqual(_normalize_session_id("///"), "default")

    def test_missing_session_ids_do_not_share_default_memory(self):
        prototype = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
        )
        manager = LumiSessionManager(prototype)

        first = manager.get(None)
        second = manager.get(None)
        first.pipeline.handle_chat("xin chào")

        self.assertIsNot(first, second)
        self.assertEqual(first.pipeline.user_buffer, ["xin chào"])
        self.assertEqual(second.pipeline.user_buffer, [])

    def test_new_session_id_is_safe_and_unique(self):
        first = _new_session_id()
        second = _new_session_id()

        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("lumi_"))
        self.assertEqual(_clean_session_id(first), first)


if __name__ == "__main__":
    unittest.main()
