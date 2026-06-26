import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  flushVoiceTurnStream,
  interruptLumiTurn,
  runLumiTurn,
  defaultPipelineDeps,
  submitVoiceAudioFallback,
  submitVoiceTranscript,
  type VoiceBufferResult,
  type VoiceStreamChunk,
} from "@/ai/pipeline";
import {
  expressionForState,
  type ChatMessage,
  type PipelineSnapshot,
  type PipelineState,
} from "@/types/pipeline";
import type { SpeakerProfile } from "@/types/speaker";

export interface UseLumiPipelineOptions {
  initialState?: PipelineState;
  onMessage?: (message: ChatMessage) => void;
}

export interface UseLumiPipelineResult {
  snapshot: PipelineSnapshot;
  messages: ChatMessage[];
  sendText: (text: string) => Promise<void>;
  sendVoice: (text: string, audio?: Blob) => Promise<void>;
  notifyTyping: () => void;
  setMuted: (muted: boolean) => void;
  setListening: (listening: boolean) => void;
  /** Replace in-memory history (e.g. when loading a saved conversation). */
  loadMessages: (messages: ChatMessage[]) => void;
  /** Clear local history (used when starting a new conversation). */
  resetMessages: () => void;
  /** Setters for enrolled speaker profiles — wired by future enrollment UI. */
  enrolledProfiles: SpeakerProfile[];
  setEnrolledProfiles: (profiles: SpeakerProfile[]) => void;
  interimTranscript: string;
  setInterimTranscript: (text: string) => void;
}

function generateUUID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const INITIAL_GREETING = "Lumi đang nghe đây. Bạn muốn kể Lumi nghe điều gì không?";
const VOICE_MAX_BUFFER_MS = 2200;
const VOICE_MIN_FLUSH_MS = 100;
const VOICE_COMPLETE_FLUSH_MS = 250;

const STOP_INTENT_PATTERNS = [
  /(^|\s)(dung|ngung|thoi)\s+(noi|tra loi|lai|di|thoi)(\s|$)/,
  /(^|\s)(dung|ngung)\s+noi\s+(nua|lai|di)(\s|$)/,
  /(^|\s)(im lang|im di|giu im lang)(\s|$)/,
  /(^|\s)(stop|cancel|huy)(\s|$)/,
];

const VOICE_FALLBACK_SAFE_TERMS = new Set([
  "dau",
  "met",
  "buon",
  "sot",
  "ho",
  "doi",
  "khoc",
  "lumi",
  // Các phản hồi ngắn có ngữ cảnh (Web Speech API nhận đúng, không cần PhoWhisper)
  "co",
  "khong",
  "chua",
  "roi",
  "dung",
  "vang",
  "ok",
  "oke",
  "u",
]);

// Các từ ngắn có nghĩa ngữ cảnh — đồng ý / từ chối / xác nhận ngắn.
// Web Speech API nhận tốt, không được lọc như tiếng ồn.
const VOICE_CONTEXTUAL_TOKENS = new Set([
  "co",    // có
  "khong", // không
  "chua",  // chưa
  "roi",   // rồi
  "dung",  // đúng
  "vang",  // vâng
  "ok",
  "oke",
  "u",     // ư
]);

const VOICE_SUSPICIOUS_TOKENS = new Set(["milo", "nay", "này", "h", "n", "sự"]);

const VOICE_NOISE_TOKENS = new Set([
  "a",
  "ah",
  "alo",
  "anh",
  "e",
  "ha",
  "hm",
  "hmm",
  "milo",
  "nay",
  "này",
  "oh",
  "uh",
  "um",
]);

function normalizeVoiceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStopIntentText(text: string): boolean {
  const normalized = normalizeVoiceText(text);
  return STOP_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLikelyVoiceNoise(text: string): boolean {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length <= 2 && tokens.every((token) => VOICE_NOISE_TOKENS.has(token))) return true;
  // Từ ngắn có nghĩa ngữ cảnh (co/khong/roi/dung...) không phải tiếng ồn
  if (tokens.length === 1 && VOICE_CONTEXTUAL_TOKENS.has(tokens[0])) return false;
  if (tokens.length === 1 && tokens[0].length <= 3) return true;
  return false;
}

function shouldUsePhoWhisperFallback(text: string, audio?: Blob): boolean {
  if (!audio || audio.size < 2000) return false;
  const normalized = normalizeVoiceText(text);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.some((token) => VOICE_SUSPICIOUS_TOKENS.has(token))) return true;
  if (tokens.some((token) => VOICE_FALLBACK_SAFE_TERMS.has(token))) return false;
  if (tokens.length === 1 && normalized.length <= 8) return true;
  if (tokens.length <= 2 && normalized.length <= 10) return true;
  return false;
}

function makeGreeting(): ChatMessage {
  return {
    id: generateUUID(),
    role: "lumi",
    content: INITIAL_GREETING,
    timestamp: Date.now(),
  };
}

/**
 * High-level hook that owns the Lumi pipeline state machine.
 *
 * Real audio capture / streaming will be added here later; today it exposes
 * a sendText() entry point and progress-driven state transitions so the rest
 * of the UI can be built and tested.
 */
export function useLumiPipeline(options: UseLumiPipelineOptions = {}): UseLumiPipelineResult {
  const { initialState = "idle", onMessage } = options;
  const [state, setState] = useState<PipelineState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [makeGreeting()]);
  const [snapshotExtras, setSnapshotExtras] = useState<{
    lastUserEmotion?: PipelineSnapshot["lastUserEmotion"];
    lastTranscript?: string;
    lastResponse?: string;
    error?: string;
  }>({});
  const [enrolledProfiles, setEnrolledProfiles] = useState<SpeakerProfile[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");

  const historyRef = useRef<Array<{ role: "user" | "lumi"; content: string }>>([]);
  const apiSessionIdRef = useRef(generateUUID());

  const rotateApiSession = useCallback(() => {
    apiSessionIdRef.current = generateUUID();
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setState((prev) => (muted ? "muted" : prev === "muted" ? "idle" : prev));
  }, []);

  const setListening = useCallback((listening: boolean) => {
    setState((prev) => {
      if (listening) return "listening";
      if (prev === "listening") return "idle";
      return prev;
    });
  }, []);

  const textBufferRef = useRef<string[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceBufferStartedAtRef = useRef<number | null>(null);
  const textTurnGenerationRef = useRef(0);
  const voiceFlushInFlightRef = useRef(false);
  const voiceFlushQueuedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamAudioChainRef = useRef<Promise<void>>(Promise.resolve());
  const streamGenerationRef = useRef(0);

  const playLumiAudio = useCallback(async (audioUrl?: string) => {
    if (!audioUrl) return;
    currentAudioRef.current?.pause();
    setState("speaking");
    const audioEl = new Audio(audioUrl);
    currentAudioRef.current = audioEl;
    await new Promise<void>((resolve) => {
      audioEl.onended = () => resolve();
      audioEl.onerror = () => resolve();
      audioEl.onpause = () => resolve();
      audioEl.play().catch(() => resolve());
    });
    if (currentAudioRef.current === audioEl) currentAudioRef.current = null;
  }, []);

  const playLumiAudioBase64 = useCallback((audioBase64: string, streamId: number) => {
    streamAudioChainRef.current = streamAudioChainRef.current.then(
      () =>
        new Promise<void>((resolve) => {
          if (streamGenerationRef.current !== streamId) {
            resolve();
            return;
          }

          setState("speaking");
          const audioEl = new Audio(`data:audio/wav;base64,${audioBase64}`);
          currentAudioRef.current = audioEl;
          audioEl.onended = () => resolve();
          audioEl.onerror = () => resolve();
          audioEl.onpause = () => resolve();
          audioEl.play().catch(() => resolve());
        }),
    );
    return streamAudioChainRef.current;
  }, []);

  const appendLumiResult = useCallback(
    async (result: Awaited<ReturnType<typeof runLumiTurn>>) => {
      const lumiMessage: ChatMessage = {
        id: generateUUID(),
        role: "lumi",
        content: result.response,
        timestamp: Date.now(),
      };

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "lumi" && last.content === result.response) return prev;
        return [...prev, lumiMessage];
      });

      const last = historyRef.current[historyRef.current.length - 1];
      if (!(last && last.role === "lumi" && last.content === result.response)) {
        onMessage?.(lumiMessage);
        historyRef.current = [...historyRef.current, { role: "lumi", content: result.response }];
      }

      setSnapshotExtras({
        lastUserEmotion: result.emotion.emotion,
        lastTranscript: result.transcript,
        lastResponse: result.response,
      });

      await playLumiAudio(result.audio_url);
      setState("idle");
    },
    [onMessage, playLumiAudio],
  );

  const flushTextBuffer = useCallback(async () => {
    if (textBufferRef.current.length === 0) return;
    const combined = textBufferRef.current.join(" ");
    textBufferRef.current = [];
    const turnId = textTurnGenerationRef.current;

    historyRef.current = [...historyRef.current, { role: "user", content: combined }];

    try {
      const result = await runLumiTurn(
        {
          textOverride: combined,
          enrolledProfiles,
          history: historyRef.current,
          sessionId: apiSessionIdRef.current,
        },
        defaultPipelineDeps,
        (nextState) => {
          if (turnId === textTurnGenerationRef.current) setState(nextState);
        },
      );

      if (turnId !== textTurnGenerationRef.current) return;
      await appendLumiResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      setSnapshotExtras((prev) => ({ ...prev, error: message }));
    }
  }, [appendLumiResult, enrolledProfiles]);

  const notifyTyping = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (textBufferRef.current.length > 0) {
      setState("idle"); // UI could be idle or waiting
      typingTimerRef.current = setTimeout(() => {
        void flushTextBuffer();
      }, 800); // Wait briefly after the last keystroke before sending
    }
  }, [flushTextBuffer]);

  const flushVoiceBuffer = useCallback(async () => {
    if (voiceFlushTimerRef.current) {
      clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = null;
    }
    if (voiceFlushInFlightRef.current) {
      voiceFlushQueuedRef.current = true;
      return;
    }
    voiceBufferStartedAtRef.current = null;
    voiceFlushInFlightRef.current = true;

    const streamId = streamGenerationRef.current + 1;
    streamGenerationRef.current = streamId;
    streamAudioChainRef.current = Promise.resolve();

    let streamedMessageId: string | null = null;
    let lastStreamedChunkText = "";
    let streamedTimestamp = Date.now();
    let streamedResponse = "";

    const upsertStreamedMessage = (content: string) => {
      if (!streamedMessageId) {
        streamedMessageId = generateUUID();
        streamedTimestamp = Date.now();
        const message: ChatMessage = {
          id: streamedMessageId,
          role: "lumi",
          content,
          timestamp: streamedTimestamp,
        };
        setMessages((prev) => [...prev, message]);
        return;
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === streamedMessageId ? { ...message, content } : message,
        ),
      );
    };

    const handleChunk = (chunk: VoiceStreamChunk) => {
      if (streamGenerationRef.current !== streamId) return;

      if (chunk.text_chunk) {
        const normalizedChunk = normalizeVoiceText(chunk.text_chunk);
        if (normalizedChunk && normalizedChunk === normalizeVoiceText(lastStreamedChunkText)) {
          return;
        }
        lastStreamedChunkText = chunk.text_chunk;
        streamedResponse += chunk.text_chunk;
        upsertStreamedMessage(streamedResponse);
        setSnapshotExtras((prev) => ({ ...prev, lastResponse: streamedResponse }));
      }

      if (chunk.audio_base64) {
        void playLumiAudioBase64(chunk.audio_base64, streamId);
      }
    };

    try {
      setState("thinking");
      const result = await flushVoiceTurnStream(apiSessionIdRef.current, handleChunk);
      const finalResponse = (streamedResponse || result?.response || "").trim();

      if (!finalResponse) {
        setState("idle");
        return;
      }

      if (!streamedMessageId) {
        streamedMessageId = generateUUID();
        streamedTimestamp = Date.now();
        setMessages((prev) => [
          ...prev,
          {
            id: streamedMessageId!,
            role: "lumi",
            content: finalResponse,
            timestamp: streamedTimestamp,
          },
        ]);
      }

      const lumiMessage: ChatMessage = {
        id: streamedMessageId,
        role: "lumi",
        content: finalResponse,
        timestamp: streamedTimestamp,
      };
      onMessage?.(lumiMessage);
      historyRef.current = [...historyRef.current, { role: "lumi", content: finalResponse }];
      setSnapshotExtras({
        lastUserEmotion: result?.emotion.emotion ?? "neutral",
        lastTranscript: result?.transcript ?? "",
        lastResponse: finalResponse,
      });

      // Wait for audio to finish, but cap at 3s to prevent permanent hang
      // when sendVoice pauses audio before the promise can resolve.
      await Promise.race([
        streamAudioChainRef.current.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      // Don't clobber state if a newer flush/sendVoice has taken over
      if (streamGenerationRef.current === streamId) {
        setState("idle");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      setSnapshotExtras((prev) => ({ ...prev, error: message }));
    } finally {
      voiceFlushInFlightRef.current = false;
      if (voiceFlushQueuedRef.current) {
        voiceFlushQueuedRef.current = false;
        voiceBufferStartedAtRef.current = Date.now();
        voiceFlushTimerRef.current = setTimeout(() => {
          void flushVoiceBuffer();
        }, VOICE_MIN_FLUSH_MS);
      }
    }
  }, [onMessage, playLumiAudioBase64]);

  const scheduleVoiceFlush = useCallback(
    (waitMs = 1700) => {
      if (voiceFlushTimerRef.current) clearTimeout(voiceFlushTimerRef.current);
      const startedAt = voiceBufferStartedAtRef.current ?? Date.now();
      voiceBufferStartedAtRef.current = startedAt;
      const elapsedMs = Date.now() - startedAt;
      const forcedRemainingMs = Math.max(VOICE_MIN_FLUSH_MS, VOICE_MAX_BUFFER_MS - elapsedMs);
      const effectiveWaitMs = Math.min(waitMs, forcedRemainingMs);
      voiceFlushTimerRef.current = setTimeout(() => {
        void flushVoiceBuffer();
      }, effectiveWaitMs);
    },
    [flushVoiceBuffer],
  );

  const sendVoice = useCallback(
    async (text: string, audio?: Blob) => {
      const trimmed = text.trim();
      if (!trimmed || isLikelyVoiceNoise(trimmed)) return;

      currentAudioRef.current?.pause();
      streamGenerationRef.current += 1;
      streamAudioChainRef.current = Promise.resolve();
      // Force-release any stuck flush so the next scheduleVoiceFlush can proceed.
      // The old flush's finally block will also set these to false (harmless dup).
      voiceFlushInFlightRef.current = false;
      voiceFlushQueuedRef.current = false;
      void interruptLumiTurn(apiSessionIdRef.current).catch(() => undefined);

      const appendUserMessage = (content: string) => {
        const userMessage: ChatMessage = {
          id: generateUUID(),
          role: "user",
          content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        onMessage?.(userMessage);
        historyRef.current = [...historyRef.current, { role: "user", content }];
      };

      try {
        setState("listening");
        let data: VoiceBufferResult;
        let displayedTranscript = trimmed;

        if (shouldUsePhoWhisperFallback(trimmed, audio)) {
          setState("transcribing");
          data = await submitVoiceAudioFallback(audio!, apiSessionIdRef.current);
          displayedTranscript = data.input_text?.trim() || trimmed;
        } else {
          appendUserMessage(trimmed);
          data = await submitVoiceTranscript(trimmed, apiSessionIdRef.current);
        }

        if (data.status === "buffered") {
          if (displayedTranscript !== trimmed || shouldUsePhoWhisperFallback(trimmed, audio)) {
            appendUserMessage(displayedTranscript);
          }
          const waitMs = data.is_complete
            ? Math.min(data.wait_ms ?? VOICE_COMPLETE_FLUSH_MS, VOICE_COMPLETE_FLUSH_MS)
            : (data.wait_ms ?? 1700);
          scheduleVoiceFlush(waitMs);
        } else if (data.status === "ignored") {
          setState("idle");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState("error");
        setSnapshotExtras((prev) => ({ ...prev, error: message }));
      }
    },
    [onMessage, scheduleVoiceFlush],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      textTurnGenerationRef.current += 1;
      currentAudioRef.current?.pause();
      streamGenerationRef.current += 1;
      streamAudioChainRef.current = Promise.resolve();
      if (voiceFlushTimerRef.current) {
        clearTimeout(voiceFlushTimerRef.current);
        voiceFlushTimerRef.current = null;
      }
      voiceBufferStartedAtRef.current = null;
      void interruptLumiTurn(apiSessionIdRef.current).catch(() => undefined);

      const isStopIntent = isStopIntentText(trimmed);

      const userMessage: ChatMessage = {
        id: generateUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      onMessage?.(userMessage);

      textBufferRef.current.push(trimmed);
      if (isStopIntent) {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        void flushTextBuffer();
        return;
      }
      notifyTyping();
    },
    [flushTextBuffer, notifyTyping, onMessage],
  );

  // Speech recognition lives in useSpeechRecognition and is driven by the
  // mic button. The hook below just exposes setters for the interim text.

  const loadMessages = useCallback(
    (next: ChatMessage[]) => {
      rotateApiSession();
      setMessages(next.length > 0 ? next : [makeGreeting()]);
      historyRef.current = next.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      textBufferRef.current = [];
      textTurnGenerationRef.current += 1;
      voiceBufferStartedAtRef.current = null;
      setSnapshotExtras({});
    },
    [rotateApiSession],
  );

  const resetMessages = useCallback(() => {
    rotateApiSession();
    setMessages([makeGreeting()]);
    historyRef.current = [];
    textBufferRef.current = [];
    textTurnGenerationRef.current += 1;
    voiceBufferStartedAtRef.current = null;
    setSnapshotExtras({});
  }, [rotateApiSession]);

  const snapshot = useMemo<PipelineSnapshot>(
    () => ({
      state,
      expression: expressionForState(state),
      ...snapshotExtras,
    }),
    [state, snapshotExtras],
  );

  return {
    snapshot,
    messages,
    sendText,
    sendVoice,
    notifyTyping,
    setMuted,
    setListening,
    loadMessages,
    resetMessages,
    enrolledProfiles,
    setEnrolledProfiles,
    interimTranscript,
    setInterimTranscript,
  };
}
