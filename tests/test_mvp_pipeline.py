import unittest

from lumi.config import LumiConfig
from lumi.models import AddresseeDecision, SpeakerDecision, TTSResult, TurnDecision
from lumi.mvp_pipeline import LumiMvpPipeline


class FakeResponseGenerator:
    def generate(self, user_text, history, bot_pronoun=None, user_pronoun=None):
        return f"Phản hồi cho: {user_text}"

    def generate_classification(self, prompt):
        return "Có"


class SequencedResponseGenerator:
    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    def generate(self, user_text, history, bot_pronoun=None, user_pronoun=None, max_new_tokens=None, temperature=None):
        self.prompts.append(user_text)
        if self.responses:
            return self.responses.pop(0)
        return "Lumi nghe rồi. Lumi trả lời ngắn gọn hơn."

    def generate_classification(self, prompt):
        return "Có"



class CompleteTurnDetector:
    def decide(self, segment, speech_gap_seconds):
        return TurnDecision(True, 0.95, "complete")


class VoicePartWaitsTurnDetector:
    def decide(self, segment, speech_gap_seconds):
        if segment.text == "voice part":
            return TurnDecision(False, 0.95, "waiting for more voice")
        return TurnDecision(True, 0.95, "complete")


class RejectingAddresseeDetector:
    def detect(self, text, history):
        return AddresseeDecision(False, 1.0, "test rejects everything")


class FakeSpeakerVerifier:
    def verify(self, segment):
        return SpeakerDecision("owner", True, 1.0, "test speaker")


class FakeTTS:
    def synthesize_text(self, text):
        return TTSResult(audio_path="outputs/fake.wav", sample_rate=48000, engine="fake-tts")


class FakeASR:
    def transcribe_file(self, audio_path):
        return "xin chào Lumi"


class LumiMvpPipelineTest(unittest.TestCase):
    def test_text_input_returns_text_and_audio_path(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("tôi buồn quá")

        self.assertEqual(result.input_text, "tôi buồn quá")
        self.assertEqual(result.response_text, "Phản hồi cho: tôi buồn quá")
        self.assertEqual(result.audio_path, "outputs/fake.wav")

    def test_audio_file_uses_asr_then_generates_response(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            asr=FakeASR(),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
        )

        result = pipeline.handle_audio_file("input.wav")

        self.assertEqual(result.input_text, "xin chào Lumi")
        self.assertEqual(result.input_audio_path, "input.wav")
        self.assertEqual(result.audio_path, "outputs/fake.wav")

    def test_future_hooks_are_reserved_but_not_called(self):
        sentinel = object()
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=sentinel,
            addressee_detector=sentinel,
            speaker_verifier=sentinel,
            emotion_classifier=sentinel,
        )

        result = pipeline.handle_text("hello")

        self.assertEqual(result.response_text, "Phản hồi cho: hello")
        self.assertIs(pipeline.turn_detector, sentinel)
        self.assertIs(pipeline.addressee_detector, sentinel)
        self.assertIs(pipeline.speaker_verifier, sentinel)
        self.assertIs(pipeline.emotion_classifier, sentinel)

    def test_text_chat_buffers_until_flush_even_if_addressee_classifier_rejects(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=CompleteTurnDetector(),
            addressee_detector=RejectingAddresseeDetector(),
        )

        buffered = pipeline.handle_chat("gợi ý món ăn cho tôi")
        result = pipeline.flush_chat()

        self.assertEqual(buffered["status"], "buffered")
        self.assertEqual(buffered["buffered_text"], "gợi ý món ăn cho tôi")
        self.assertEqual(result.response_text, "Phản hồi cho: gợi ý món ăn cho tôi")

    def test_response_guard_regenerates_empty_followup_before_tts(self):
        generator = SequencedResponseGenerator([
            "Uyên muốn nói gì tiếp?",
            "Lumi nghe rồi. Uyên nghỉ một chút nhé.",
        ])
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline.user_buffer.append("tôi đau đầu")

        result = pipeline.flush_chat(user_pronoun="Uyên")

        self.assertEqual(result.response_text, "Lumi nghe rồi. Uyên nghỉ một chút nhé.")
        self.assertIn("Câu trả lời trước bị loại", generator.prompts[-1])

    def test_response_guard_falls_back_for_repeated_recent_question(self):
        generator = SequencedResponseGenerator([
            "Hồi nãy Uyên nói mệt, giờ đỡ chưa?",
            "Hồi nãy Uyên nói mệt, giờ đỡ chưa?",
        ])
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline._remember("tôi mệt", "Hồi nãy Uyên nói mệt, giờ đỡ chưa?")
        pipeline.user_buffer.append("tôi đau đầu")

        result = pipeline.flush_chat(user_pronoun="Uyên")

        self.assertNotIn("Hồi nãy", result.response_text)
        self.assertIn("đi khám", result.response_text)

    def test_response_guard_keeps_only_one_question_after_answer(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=SequencedResponseGenerator([
                "Lumi nghe rồi. Uyên thử uống nước nhé. Đau lâu chưa? Có chóng mặt không?",
            ]),
            tts=FakeTTS(),
        )
        pipeline.user_buffer.append("tôi đau đầu")

        result = pipeline.flush_chat(user_pronoun="Uyên")

        self.assertEqual(result.response_text.count("?"), 1)
        self.assertNotIn("Có chóng mặt không", result.response_text)

    def test_voice_buffers_multiple_complete_sentences_until_flush(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=CompleteTurnDetector(),
            speaker_verifier=FakeSpeakerVerifier(),
        )

        first = pipeline.handle_voice_transcript("Lumi ơi hôm nay mình mệt")
        second = pipeline.handle_voice_transcript("kể tiếp đi")
        result = pipeline.flush_voice_chat(user_pronoun="Uyên")

        self.assertEqual(first["status"], "buffered")
        self.assertEqual(second["status"], "buffered")
        self.assertEqual(second["buffered_text"], "Lumi ơi hôm nay mình mệt kể tiếp đi")
        self.assertEqual(result.input_text, "Lumi ơi hôm nay mình mệt kể tiếp đi")
        self.assertEqual(result.response_text, "Phản hồi cho: Lumi ơi hôm nay mình mệt kể tiếp đi")

    def test_text_chat_does_not_flush_voice_buffer(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=VoicePartWaitsTurnDetector(),
            speaker_verifier=FakeSpeakerVerifier(),
        )

        voice_result = pipeline.handle_voice_transcript("voice part")
        text_result = pipeline.handle_chat("text only")
        flushed_text = pipeline.flush_chat()
        flushed_voice = pipeline.flush_voice_chat()

        self.assertEqual(voice_result["status"], "buffered")
        self.assertGreaterEqual(voice_result["wait_ms"], 2500)
        self.assertEqual(text_result["status"], "buffered")
        self.assertEqual(flushed_text.response_text, "Phản hồi cho: text only")
        self.assertEqual(flushed_voice.response_text, "Phản hồi cho: voice part")


    def test_voice_ignores_short_fillers(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=CompleteTurnDetector(),
            speaker_verifier=FakeSpeakerVerifier(),
        )

        result = pipeline.handle_voice_transcript("ừm")

        self.assertEqual(result["status"], "ignored")

    def test_voice_ignores_assistant_echo(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=CompleteTurnDetector(),
            speaker_verifier=FakeSpeakerVerifier(),
        )
        pipeline._remember("ngủ sớm được không", "Lumi nghĩ bạn nên ngủ sớm tối nay nhé")

        result = pipeline.handle_voice_transcript("Lumi nghĩ bạn nên ngủ sớm tối nay nhé")

        self.assertEqual(result["status"], "ignored")


if __name__ == "__main__":
    unittest.main()
