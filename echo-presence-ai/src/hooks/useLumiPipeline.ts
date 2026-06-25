import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  flushVoiceTurn,
  runLumiTurn,
  defaultPipelineDeps,
  submitVoiceTranscript,
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
  sendVoice: (text: string) => Promise<void>;
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

const INITIAL_GREETING = "Mình đang nghe đây. Bạn muốn kể mình nghe điều gì không?";

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

function isLikelyVoiceNoise(text: string): boolean {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length <= 2 && tokens.every((token) => VOICE_NOISE_TOKENS.has(token))) return true;
  if (tokens.length === 1 && tokens[0].length <= 3) return true;
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
  const voiceFlushInFlightRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const playLumiAudio = useCallback(async (audioUrl?: string) => {
    if (!audioUrl) return;
    currentAudioRef.current?.pause();
    setState("speaking");
    const audioEl = new Audio(audioUrl);
    currentAudioRef.current = audioEl;
    await new Promise<void>((resolve) => {
      audioEl.onended = () => resolve();
      audioEl.onerror = () => resolve();
      audioEl.play().catch(() => resolve());
    });
    if (currentAudioRef.current === audioEl) currentAudioRef.current = null;
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

    historyRef.current = [...historyRef.current, { role: "user", content: combined }];

    try {
      const result = await runLumiTurn(
        { textOverride: combined, enrolledProfiles, history: historyRef.current },
        defaultPipelineDeps,
        setState,
      );

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
      }, 1500); // Wait 1.5 seconds after last typing to send
    }
  }, [flushTextBuffer]);

  const flushVoiceBuffer = useCallback(async () => {
    if (voiceFlushTimerRef.current) {
      clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = null;
    }
    if (voiceFlushInFlightRef.current) return;
    voiceFlushInFlightRef.current = true;
    try {
      setState("thinking");
      const result = await flushVoiceTurn();
      if (result) await appendLumiResult(result);
      else setState("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      setSnapshotExtras((prev) => ({ ...prev, error: message }));
    } finally {
      voiceFlushInFlightRef.current = false;
    }
  }, [appendLumiResult]);

  const scheduleVoiceFlush = useCallback(
    (waitMs = 2500) => {
      if (voiceFlushTimerRef.current) clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = setTimeout(() => {
        void flushVoiceBuffer();
      }, waitMs);
    },
    [flushVoiceBuffer],
  );

  const sendVoice = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLikelyVoiceNoise(trimmed)) return;

      currentAudioRef.current?.pause();

      const userMessage: ChatMessage = {
        id: generateUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      onMessage?.(userMessage);
      historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];

      try {
        setState("listening");
        const data = await submitVoiceTranscript(trimmed);
        if (data.status === "buffered") {
          scheduleVoiceFlush(data.wait_ms ?? 2500);
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

      const userMessage: ChatMessage = {
        id: generateUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      onMessage?.(userMessage);

      textBufferRef.current.push(trimmed);
      notifyTyping();
    },
    [notifyTyping, onMessage],
  );

  // Speech recognition lives in useSpeechRecognition and is driven by the
  // mic button. The hook below just exposes setters for the interim text.

  const loadMessages = useCallback((next: ChatMessage[]) => {
    setMessages(next.length > 0 ? next : [makeGreeting()]);
    historyRef.current = next.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setSnapshotExtras({});
  }, []);

  const resetMessages = useCallback(() => {
    setMessages([makeGreeting()]);
    historyRef.current = [];
    setSnapshotExtras({});
  }, []);

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
