from __future__ import annotations

from dataclasses import dataclass, field
from time import time


@dataclass(frozen=True)
class TranscriptSegment:
    text: str
    started_at: float = field(default_factory=time)
    ended_at: float = field(default_factory=time)
    audio_path: str | None = None


@dataclass(frozen=True)
class TurnDecision:
    is_complete: bool
    confidence: float
    reason: str
    wait_ms: int = 0


@dataclass(frozen=True)
class AddresseeDecision:
    addressed: bool
    confidence: float
    reason: str


@dataclass(frozen=True)
class SpeakerDecision:
    speaker_id: str
    verified: bool
    confidence: float
    reason: str


@dataclass(frozen=True)
class EmotionDecision:
    label: str
    confidence: float
    evidence: str


@dataclass(frozen=True)
class LumiResponse:
    text: str
    intent: str


@dataclass(frozen=True)
class TTSResult:
    audio_path: str | None
    sample_rate: int | None
    engine: str


@dataclass(frozen=True)
class PipelineResult:
    action: str
    transcript: TranscriptSegment
    turn: TurnDecision
    addressee: AddresseeDecision | None = None
    speaker: SpeakerDecision | None = None
    emotion: EmotionDecision | None = None
    response: LumiResponse | None = None
    tts: TTSResult | None = None


@dataclass(frozen=True)
class MvpPipelineResult:
    input_text: str
    response_text: str
    audio_path: str | None
    tts_engine: str
    input_audio_path: str | None = None
