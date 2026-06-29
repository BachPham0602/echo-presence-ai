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
import { withLumiUserId } from "./userMemory";
import { loadLumiUser, getLumiUserId } from "@/store/lumiUser";

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
  sessionId?: string;
}

export interface PipelineRunOutput {
  transcript: string;
  emotion: EmotionReading;
  response: string;
  tone?: string;
  audio_url?: string;
}

export interface VoiceBufferResult {
  status: "buffered" | "ignored" | "stopped" | "empty" | string;
  input_text?: string;
  buffered_text?: string;
  response_text?: string;
  audio_url?: string;
  reason?: string;
  wait_ms?: number;
  is_complete?: boolean;
}

export interface VoiceStreamChunk {
  status?: "done" | "empty" | "interrupted" | "stopped" | string;
  text_chunk?: string;
  audio_base64?: string;
  audio_mime?: string;
}

export type VoiceStreamChunkHandler = (chunk: VoiceStreamChunk) => void | Promise<void>;

import { logApiTiming } from "@/lib/lumiDebug";

const LUMI_API_BASE = import.meta.env.VITE_LUMI_API_BASE ?? "";

function voiceIdentity() {
  const user = loadLumiUser();
  const name = user?.displayName?.trim() || "bạn";
  return {
    bot_pronoun: "Lumi",
    user_pronoun: name,
    owner_name: name,
  };
}

function absoluteAudioUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") && LUMI_API_BASE ? LUMI_API_BASE + url : url;
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

async function readApiError(res: Response): Promise<string> {
  const errorText = await res.text();
  try {
    const parsed = JSON.parse(errorText) as { error?: string; message?: string };
    return parsed.error || parsed.message || errorText;
  } catch {
    return errorText;
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const userId = getLumiUserId();
  if (userId) headers["X-User-Id"] = userId;

  const t0 = performance.now();
  const res = await fetch(`${LUMI_API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(withLumiUserId(body)),
  });
  const ttfb = performance.now() - t0;

  if (!res.ok) {
    const detail = await readApiError(res);
    logApiTiming(path, { fetch_ms: Math.round(performance.now() - t0), ttfb_ms: Math.round(ttfb) });
    throw new Error(
      detail ? "Lumi API error: " + res.status + " - " + detail : "Lumi API error: " + res.status,
    );
  }

  const data = (await res.json()) as T;
  logApiTiming(path, {
    fetch_ms: Math.round(performance.now() - t0),
    ttfb_ms: Math.round(ttfb),
    body_ms: Math.round(performance.now() - t0 - ttfb),
  });
  return data;
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
  const { audio, textOverride, enrolledProfiles = [], history = [], sessionId } = input;

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
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Error calling Lumi API:", error);
    throw error;
  }

  onProgress("idle");
  return outputFromApi(data, transcript);
}

export function voiceResultFromApi(
  data: VoiceBufferResult,
  fallbackTranscript = "",
): PipelineRunOutput | null {
  if (!data.response_text?.trim()) return null;
  return outputFromApi(data, data.input_text || fallbackTranscript);
}

export async function submitVoiceTranscript(
  text: string,
  sessionId?: string,
): Promise<VoiceBufferResult> {
  const who = voiceIdentity();
  return postJson<VoiceBufferResult>("/api/voice_text", {
    text,
    ...who,
    session_id: sessionId,
  });
}

export async function submitVoiceAudioFallback(
  audio: Blob,
  sessionId?: string,
): Promise<VoiceBufferResult> {
  const who = voiceIdentity();
  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "X-Bot-Pronoun": encodeURIComponent(who.bot_pronoun),
    "X-User-Pronoun": encodeURIComponent(who.user_pronoun),
    "X-Owner-Name": encodeURIComponent(who.owner_name),
    "X-Session-Id": encodeURIComponent(sessionId ?? ""),
  };
  const userId = getLumiUserId();
  if (userId) headers["X-User-Id"] = userId;

  const res = await fetch(`${LUMI_API_BASE}/api/voice_chat`, {
    method: "POST",
    headers,
    body: audio,
  });

  if (!res.ok) {
    const detail = await readApiError(res);
    throw new Error(
      detail ? "Lumi API error: " + res.status + " - " + detail : "Lumi API error: " + res.status,
    );
  }

  return res.json() as Promise<VoiceBufferResult>;
}

export async function flushVoiceTurn(sessionId?: string): Promise<PipelineRunOutput | null> {
  const data = await postJson<LumiApiPayload>("/api/flush", {
    mode: "voice",
    bot_pronoun: "Lumi",
    user_pronoun: "bạn",
    session_id: sessionId,
  });

  if (!data?.response_text) return null;
  return outputFromApi(data, data?.input_text || "");
}

export async function flushVoiceTurnStream(
  sessionId: string | undefined,
  onChunk: VoiceStreamChunkHandler,
): Promise<PipelineRunOutput | null> {
  const t0 = performance.now();
  let ttfbMs: number | undefined;
  let firstChunkMs: number | undefined;
  let chunkCount = 0;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let res: Response;
  try {
    res = await fetch(`${LUMI_API_BASE}/api/voice_stream`, {
      method: "POST",
      signal: controller.signal,
      headers: (() => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const userId = getLumiUserId();
        if (userId) headers["X-User-Id"] = userId;
        return headers;
      })(),
      body: JSON.stringify(
        withLumiUserId({
          ...voiceIdentity(),
          session_id: sessionId,
          is_timeout: false,
        }),
      ),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Lumi API timeout: voice_stream quá 120s — kiểm tra backend còn chạy không.");
    }
    throw err;
  }

  if (!res.ok) {
    const detail = await readApiError(res);
    logApiTiming("/api/voice_stream", { fetch_ms: Math.round(performance.now() - t0) });
    throw new Error(
      detail ? "Lumi API error: " + res.status + " - " + detail : "Lumi API error: " + res.status,
    );
  }
  if (!res.body) throw new Error("Lumi API error: streaming body is empty");
  ttfbMs = performance.now() - t0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullResponse = "";
  let terminalStatus = "";

  async function handleFrame(frame: string) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;

    const chunk = JSON.parse(data) as VoiceStreamChunk;
    if (chunk.text_chunk) fullResponse += chunk.text_chunk;
    if (chunk.status) terminalStatus = chunk.status;
    chunkCount += 1;
    if (firstChunkMs === undefined) firstChunkMs = performance.now() - t0;
    await onChunk(chunk);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      await handleFrame(frame);
    }
  }

  if (buffer.trim()) await handleFrame(buffer);
  clearTimeout(timeoutId);
  logApiTiming("/api/voice_stream", {
    fetch_ms: Math.round(performance.now() - t0),
    ttfb_ms: Math.round(ttfbMs ?? 0),
    body_ms: Math.round(performance.now() - t0 - (ttfbMs ?? 0)),
  });
  console.info("[Lumi STREAM]", {
    chunks: chunkCount,
    first_chunk_ms: firstChunkMs ? Math.round(firstChunkMs) : null,
    terminal_status: terminalStatus || null,
  });
  if (terminalStatus === "empty" || !fullResponse.trim()) return null;
  return outputFromApi({ response_text: fullResponse.trim() });
}

export async function interruptLumiTurn(sessionId?: string): Promise<void> {
  await postJson<{ status: string }>("/api/interrupt", { session_id: sessionId });
}
