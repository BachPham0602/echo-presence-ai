import unittest

from lumi.models import TranscriptSegment
from lumi.pipeline import LumiPipeline
from lumi.providers.addressee import HeuristicAddresseeDetector
from lumi.providers.turn_taking import HeuristicTurnTakingDetector


class LumiPipelineTest(unittest.TestCase):
    def test_addressee_detects_direct_lumi_call(self):
        detector = HeuristicAddresseeDetector()

        decision = detector.detect("Lumi ơi, nghe mình nói một chút được không?", [])

        self.assertTrue(decision.addressed)
        self.assertGreater(decision.confidence, 0.8)

    def test_addressee_ignores_explicit_self_talk(self):
        detector = HeuristicAddresseeDetector()

        decision = detector.detect("Mình chỉ đang tự nói một mình thôi.", [])

        self.assertFalse(decision.addressed)

    def test_turn_taking_waits_on_unfinished_connector(self):
        detector = HeuristicTurnTakingDetector(silence_seconds=1.5)

        result = detector.decide(
            segment=TranscriptSegment(text="Hôm nay mình muốn nói nhưng"),
            speech_gap_seconds=2.0,
        )

        self.assertFalse(result.is_complete)

    def test_turn_taking_completes_long_sentence(self):
        detector = HeuristicTurnTakingDetector(silence_seconds=1.5)

        result = detector.decide(
            segment=TranscriptSegment(text="Tôi đói quá và tôi muốn Lumi trả lời ngay vì tôi đã nói xong câu này rồi đó"),
            speech_gap_seconds=0.8,
        )

        self.assertTrue(result.is_complete)
        self.assertLessEqual(result.wait_ms, 400)

    def test_pipeline_responds_to_lonely_disclosure(self):
        pipeline = LumiPipeline()

        result = pipeline.process_transcript("Lumi ơi, tối nay mình thấy cô đơn.", speech_gap_seconds=1.5)

        self.assertEqual(result.action, "respond")
        self.assertIsNotNone(result.emotion)
        self.assertEqual(result.emotion.label, "cô_đơn")
        self.assertIsNotNone(result.response)

    def test_pipeline_responds_to_short_sad_sentence_without_punctuation(self):
        pipeline = LumiPipeline()

        result = pipeline.process_transcript("tôi buồn quá", speech_gap_seconds=1.5)

        self.assertEqual(result.action, "respond")
        self.assertIsNotNone(result.emotion)
        self.assertEqual(result.emotion.label, "buồn")


if __name__ == "__main__":
    unittest.main()
