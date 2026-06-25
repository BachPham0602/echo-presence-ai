/**
 * Lumi end-to-end voice pipeline.
 *
 * Coordinates: addressee detection → semantic VAD → ASR → speaker verification
 * → emotion recognition → empathetic LLM → TTS.
 *
 * Currently wired to mock stages — swap in real models behind the same interfaces.
 */

import type { PipelineState } from "@/types/pipeline";
import type { SpeakerProfile } from "@/types/speaker";
import type { EmotionReading } from "@/types/emotion";

import { mockAddresseeDetector } from "./addresseeDetection";
import { mockSemanticVAD } from "./semanticVAD";
import { mockVietnameseASR } from "./vietnameseASR";
import { mockSpeakerVerifier } from "./speakerVerification";
import { mockEmotionRecognizer } from "./emotionRecognition";
import { mockEmpatheticLLM } from "./empatheticResponse";
import { mockVietnameseTTS } from "./vietnameseTTS";

export interface PipelineDependencies {
  addressee: typeof mockAddresseeDetector;
  vad: typeof mockSemanticVAD;
  asr: typeof mockVietnameseASR;
  speaker: typeof mockSpeakerVerifier;
  emotion: typeof mockEmotionRecognizer;
  llm: typeof mockEmpatheticLLM;
  tts: typeof mockVietnameseTTS;
}

export const defaultPipelineDeps: PipelineDependencies = {
  addressee: mockAddresseeDetector,
  vad: mockSemanticVAD,
  asr: mockVietnameseASR,
  speaker: mockSpeakerVerifier,
  emotion: mockEmotionRecognizer,
  llm: mockEmpatheticLLM,
  tts: mockVietnameseTTS,
};

export interface PipelineRunInput {
  audio?: Float32Array;
  /** Used when the user types instead of speaks. */
  textOverride?: string;
  enrolledProfiles?: SpeakerProfile[];
  history?: Array<{ role: "user" | "lumi"; content: string }>;
}

export interface PipelineRunOutput {
  transcript: string;
  emotion: EmotionReading;
  response: string;
  tone?: string;
  audio_url?: string;
}

export interface VoiceBufferResult {
  status: "buffered" | "ignored" | "empty" | string;
  input_text?: string;
  buffered_text?: string;
  reason?: string;
  wait_ms?: number;
}

const LUMI_API_BASE = "http://127.0.0.1:8765";

function absoluteAudioUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? `${LUMI_API_BASE}${url}` : url;
}

type LumiApiPayload = {
  input_text?: string;
  response_text?: string;
  audio_url?: string;
};

function outputFromApi(data: LumiApiPayload | null, fallbackTranscript = ""): PipelineRunOutput {
  return {
    transcript: data?.input_text || fallbackTranscript,
    emotion: {
      emotion: "neutral" as const,
      confidence: 1.0,
      source: "text" as const,
      timestamp: Date.now(),
    },
    response: data?.response_text || "Xin lỗi, mình đang gặp sự cố kết nối.",
    tone: "neutral",
    audio_url: absoluteAudioUrl(data?.audio_url),
  };
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${LUMI_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Lumi API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export type PipelineProgress = (state: PipelineState) => void;

/**
 * Run a single user turn through the pipeline.
 *
 * The `onProgress` callback receives each state transition so the UI / face
 * can react in realtime.
 */
export async function runLumiTurn(
  input: PipelineRunInput,
  deps: PipelineDependencies = defaultPipelineDeps,
  onProgress: PipelineProgress = () => {},
): Promise<PipelineRunOutput> {
  const { audio, textOverride, enrolledProfiles = [], history = [] } = input;

  onProgress("transcribing");
  const transcript = textOverride
    ? textOverride
    : audio
      ? (await deps.asr.transcribe(audio)).text
      : "";

  onProgress("thinking");

  let data: LumiApiPayload | null = null;
  try {
    data = await postJson<LumiApiPayload>("/api/text", {
      text: transcript,
      bot_pronoun: "Lumi",
      user_pronoun: "bạn",
    });
  } catch (error) {
    console.error("Error calling Lumi API:", error);
    throw error;
  }

  onProgress("idle");
  return outputFromApi(data, transcript);
}

export async function submitVoiceTranscript(text: string): Promise<VoiceBufferResult> {
  return postJson<VoiceBufferResult>("/api/voice_text", {
    text,
    bot_pronoun: "Lumi",
    user_pronoun: "bạn",
    owner_name: "bạn",
  });
}

export async function flushVoiceTurn(): Promise<PipelineRunOutput | null> {
  const data = await postJson<LumiApiPayload>("/api/flush", {
    mode: "voice",
    bot_pronoun: "Lumi",
    user_pronoun: "bạn",
  });

  if (!data?.response_text) return null;
  return outputFromApi(data, data?.input_text || "");
}
