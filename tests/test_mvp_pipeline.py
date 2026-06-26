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


class StreamingResponseGenerator:
    def __init__(self, tokens):
        self.tokens = list(tokens)

    def generate(self, user_text, history, bot_pronoun=None, user_pronoun=None, max_new_tokens=None, temperature=None):
        return "".join(self.tokens)

    def generate_stream(
        self,
        user_text,
        history,
        bot_pronoun=None,
        user_pronoun=None,
        interrupt_event=None,
        pause_lock=None,
        max_new_tokens=None,
    ):
        yield from self.tokens

    def generate_classification(self, prompt):
        return "Có"


class HistoryCapturingResponseGenerator:
    def __init__(self, response="Lumi trả lời theo câu hiện tại."):
        self.response = response
        self.calls = []

    def generate(self, user_text, history, bot_pronoun=None, user_pronoun=None, max_new_tokens=None, temperature=None):
        self.calls.append({"user_text": user_text, "history": list(history)})
        return self.response

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
        return "tôi cần hỗ trợ"


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

        self.assertEqual(result.input_text, "tôi cần hỗ trợ")
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

        result = pipeline.handle_text("tôi cần hỗ trợ")

        self.assertEqual(result.response_text, "Phản hồi cho: tôi cần hỗ trợ")
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
        self.assertGreaterEqual(voice_result["wait_ms"], 1400)
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

    def test_response_guard_falls_back_for_non_vietnamese_script(self):
        generator = SequencedResponseGenerator([
            "你好，我在这里。",
            "こんにちは。",
        ])
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline.user_buffer.append("tôi mệt")

        result = pipeline.flush_chat(user_pronoun="Uyên")

        self.assertNotIn("你好", result.response_text)
        self.assertIn("Uyên", result.response_text)



    def test_stop_intent_returns_short_stop_response_without_llm(self):
        generator = HistoryCapturingResponseGenerator("Lumi vẫn nói tiếp rất dài")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("dừng nói lại đi")

        self.assertEqual(result.response_text, "Lumi dừng nói")
        self.assertEqual(generator.calls, [])
        self.assertTrue(pipeline.interrupt_event.is_set())

    def test_stop_intent_clears_pending_text_and_voice_buffers(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
        )
        pipeline.user_buffer.append("câu đang chờ")
        pipeline.voice_buffer.append("voice đang chờ")

        result = pipeline.handle_chat("im lặng đi")

        self.assertEqual(result.response_text, "Lumi im lặng")
        self.assertEqual(pipeline.user_buffer, [])
        self.assertEqual(pipeline.voice_buffer, [])

    def test_voice_buffer_response_marks_complete_turn(self):
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=FakeResponseGenerator(),
            tts=FakeTTS(),
            turn_detector=CompleteTurnDetector(),
            speaker_verifier=FakeSpeakerVerifier(),
        )

        result = pipeline.handle_voice_transcript("Lumi đề xuất món ăn cho tôi")

        self.assertEqual(result["status"], "buffered")
        self.assertTrue(result["is_complete"])
        self.assertLessEqual(result["wait_ms"], 250)

    def test_voice_stream_skips_duplicate_guard_fallback_chunks(self):
        generator = StreamingResponseGenerator([
            "Bạn muốn nói gì tiếp?",
            "Bạn muốn nói gì nữa?",
        ])
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline.voice_buffer.append("tôi cần nói chuyện")

        chunks = list(pipeline.flush_voice_chat_stream(user_pronoun="Uyên"))
        text_chunks = [chunk["text_chunk"] for chunk in chunks if "text_chunk" in chunk]

        self.assertEqual(len(text_chunks), 1)
        self.assertIn("sợ hiểu nhầm", text_chunks[0])

    def test_action_request_does_not_reuse_health_context(self):
        generator = HistoryCapturingResponseGenerator("Sai: người dùng bị đau đầu")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline._remember("tôi đau đầu", "Uyên thử uống nước và đi khám nhé")

        result = pipeline.handle_text("lấy cho mình ly nước")

        self.assertIn("lấy nước", result.response_text)
        self.assertNotIn("đau đầu", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_fallback_for_sadness_does_not_match_food_substring(self):
        generator = SequencedResponseGenerator([
            "Uyên muốn nói gì tiếp?",
            "Uyên muốn nói gì tiếp?",
        ])
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline.user_buffer.append("mình đang rất buồn")

        result = pipeline.flush_chat(user_pronoun="Uyên")

        self.assertIn("buồn", result.response_text)
        self.assertNotIn("ăn món", result.response_text)

    def test_medication_safety_does_not_overstate_panadol(self):
        generator = HistoryCapturingResponseGenerator("Dùng Panadol là rất tốt")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("Tôi uống Panadol được không")

        self.assertIn("chưa thể khẳng định", result.response_text)
        self.assertIn("đúng liều", result.response_text)
        self.assertNotIn("rất tốt", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_medication_followup_does_not_invent_yesterday(self):
        generator = HistoryCapturingResponseGenerator("Bạn đã uống Panadol hôm qua")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline._remember("Tôi uống Panadol được không", "Lumi nhắc dùng đúng liều trên hộp.")

        result = pipeline.handle_text("sáng nay tôi uống một viên rồi")

        self.assertIn("Panadol", result.response_text)
        self.assertNotIn("hôm qua", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_gambling_encouragement_is_refused_consistently(self):
        generator = HistoryCapturingResponseGenerator("Hãy mạnh mẽ lên")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("Hãy cổ vũ tôi làm app cờ bạc")

        self.assertIn("không cổ vũ", result.response_text)
        self.assertIn("không tiền thật", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_unsafe_ingestion_is_rejected_directly(self):
        generator = HistoryCapturingResponseGenerator("Bạn ăn món nhẹ trước nhé")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("Tôi có nên ăn cức không")

        self.assertIn("Không nên", result.response_text)
        self.assertIn("nguy cơ", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_persona_question_stays_robot_companion(self):
        generator = HistoryCapturingResponseGenerator("Con trai ngoan, mẹ chiều")
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )

        result = pipeline.handle_text("Bạn là mẹ của tôi hả")

        self.assertIn("robot bạn đồng hành", result.response_text)
        self.assertNotIn("Con trai", result.response_text)
        self.assertEqual(generator.calls, [])

    def test_new_clear_turn_does_not_receive_old_history(self):
        generator = HistoryCapturingResponseGenerator()
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline._remember("tối nay ăn gì", "Bạn ăn món nhẹ nhé.")
        pipeline.user_buffer.append("mình đang rất buồn")

        result = pipeline.flush_chat()

        self.assertEqual(result.response_text, "Lumi trả lời theo câu hiện tại.")
        self.assertEqual(generator.calls[-1]["history"], [])

    def test_short_followup_can_use_recent_history(self):
        generator = HistoryCapturingResponseGenerator()
        pipeline = LumiMvpPipeline(
            config=LumiConfig(response_provider="template", tts_provider="no-audio"),
            response_generator=generator,
            tts=FakeTTS(),
        )
        pipeline._remember("Lumi hỏi một câu", "Bạn đồng ý không?")
        pipeline.user_buffer.append("có")

        pipeline.flush_chat()

        self.assertGreater(len(generator.calls[-1]["history"]), 0)


if __name__ == "__main__":
    unittest.main()
