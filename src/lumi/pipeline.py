from __future__ import annotations

from lumi.config import LumiConfig
from lumi.models import PipelineResult, TranscriptSegment
from lumi.providers import (
    EmpatheticResponseGenerator,
    HeuristicAddresseeDetector,
    HeuristicEmotionClassifier,
    HeuristicTurnTakingDetector,
    RealSpeakerVerifier,
    StubTTS,
)


class LumiPipeline:
    def __init__(
        self,
        config: LumiConfig | None = None,
        turn_detector: HeuristicTurnTakingDetector | None = None,
        addressee_detector: HeuristicAddresseeDetector | None = None,
        speaker_verifier: RealSpeakerVerifier | None = None,
        emotion_classifier: HeuristicEmotionClassifier | None = None,
        response_generator: EmpatheticResponseGenerator | None = None,
        tts: StubTTS | None = None,
    ):
        self.config = config or LumiConfig.from_env()
        self.history: list[dict[str, str]] = []
        self.turn_detector = turn_detector or HeuristicTurnTakingDetector(self.config.silence_seconds)
        self.addressee_detector = addressee_detector or HeuristicAddresseeDetector()
        self.speaker_verifier = speaker_verifier or RealSpeakerVerifier()
        self.emotion_classifier = emotion_classifier or HeuristicEmotionClassifier()
        self.response_generator = response_generator or EmpatheticResponseGenerator(self.config)
        self.tts = tts or StubTTS()

    def process_transcript(self, text: str, speech_gap_seconds: float | None = None) -> PipelineResult:
        segment = TranscriptSegment(text=text)
        gap = self.config.silence_seconds if speech_gap_seconds is None else speech_gap_seconds
        turn = self.turn_detector.decide(segment, gap)
        if not turn.is_complete:
            return PipelineResult(action="wait", transcript=segment, turn=turn)

        speaker = self.speaker_verifier.verify(segment)
        addressee = self.addressee_detector.detect(text, self.history)
        if not addressee.addressed:
            self.history.append({"role": "user_observed", "content": text})
            return PipelineResult(
                action="ignore",
                transcript=segment,
                turn=turn,
                speaker=speaker,
                addressee=addressee,
            )

        emotion = self.emotion_classifier.classify(text)
        response = self.response_generator.generate(text, emotion, speaker, self.history)
        tts = self.tts.synthesize(response)

        self.history.append({"role": "user", "content": text})
        self.history.append({"role": "assistant", "content": response.text})

        return PipelineResult(
            action="respond",
            transcript=segment,
            turn=turn,
            speaker=speaker,
            addressee=addressee,
            emotion=emotion,
            response=response,
            tts=tts,
        )

