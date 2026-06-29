import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  flushVoiceTurnStream,
  interruptLumiTurn,
  runLumiTurn,
  defaultPipelineDeps,
  submitVoiceAudioFallback,
  submitVoiceTranscript,
  voiceResultFromApi,
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
import { setCurrentApiSessionId } from "@/store/lumiSessionRegistry";
import { TurnLatencyTimer, logModelTiming, logSttRoute } from "@/lib/lumiDebug";

export interface UseLumiPipelineOptions {
  initialState?: PipelineState;
  onMessage?: (message: ChatMessage) => void;
  /** Live Chat: ưu tiên gửi audio lên PhoWhisper thay vì chỉ tin Web Speech text. */
  preferServerAsr?: boolean;
}

export interface UseLumiPipelineResult {
  snapshot: PipelineSnapshot;
  messages: ChatMessage[];
  sendText: (text: string) => Promise<void>;
  sendVoice: (text: string, audio?: Blob) => Promise<void>;
  /** Chỉ gửi audio WAV — dùng khi Web Speech im lặng. */
  sendVoiceFromAudio: (audio: Blob) => Promise<void>;
  notifyTyping: () => void;
  setMuted: (muted: boolean) => void;
  setListening: (listening: boolean) => void;
  /** Replace in-memory history when switching conversations. */
  loadMessages: (messages: ChatMessage[], sessionId: string) => void;
  /** Clear local history when starting a new conversation. */
  resetMessages: (sessionId?: string) => void;
  /** Align backend session id with conversation id (must match registry). */
  setApiSessionId: (sessionId: string) => void;
  /** Call when user presses mic — unlocks browser audio playback. */
  unlockAudioOnMicStart: () => void;
  /** True while chờ voice_stream — chặn PhoWhisper VAD (tránh echo / chạy song song). */
  blockServerFallbackRef: RefObject<boolean>;
  /** True khi buffer voice chưa flush sang LLM — dùng để không gọi session/end sớm. */
  hasPendingVoiceFlushRef: RefObject<boolean>;
  /** Setters for enrolled speaker profiles — wired by future enrollment UI. */
  enrolledProfiles: SpeakerProfile[];
  setEnrolledProfiles: (profiles: SpeakerProfile[]) => void;
  interimTranscript: string;
  setInterimTranscript: (text: string) => void;
}

/** Fallback stream flush nếu server vẫn trả buffered (hiếm sau auto-flush). */
const VOICE_STREAM_FALLBACK_MS = 150;
const VOICE_STREAM_WATCHDOG_MS = 4000;

function generateUUID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const INITIAL_GREETING = "Lumi đang nghe đây. Bạn muốn kể Lumi nghe điều gì không?";

const STOP_INTENT_PATTERNS = [
  /(^|\s)(dung|ngung|thoi)\s+(noi|tra loi|lai|di|thoi)(\s|$)/,
  /(^|\s)(dung|ngung)\s+noi\s+(nua|lai|di)(\s|$)/,
  /(^|\s)(im lang|im di|giu im lang)(\s|$)/,
  /(^|\s)(stop|cancel)(\s|$)/,
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
  "chao",
  "xin",
  "hello",
  "hi",
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
  const tokens = normalized.split(" ").filter(Boolean);
  // "huy" = hủy chỉ khi nói một mình; tránh nhầm tên riêng trong câu dài (vd. "trào lưu Huy").
  if (tokens.length === 1 && tokens[0] === "huy") {
    return true;
  }
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

function looksLikeGarbledWebSpeech(text: string): boolean {
  const normalized = normalizeVoiceText(text);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 6) return false;
  const unique = new Set(tokens);
  if (unique.size / tokens.length < 0.5) return true;
  if (tokens.length >= 8) {
    const counts = new Map<string, number>();
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const bg = `${tokens[i]} ${tokens[i + 1]}`;
      counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
    for (const n of counts.values()) {
      if (n >= 3) return true;
    }
  }
  return false;
}

function phoWhisperFallbackDecision(
  text: string,
  audio?: Blob,
): { use: boolean; reason?: string } {
  if (!audio || audio.size < 800) {
    return { use: false, reason: "audio_missing_or_too_short" };
  }
  if (looksLikeGarbledWebSpeech(text)) {
    return { use: true, reason: "garbled_web_speech_repetition" };
  }
  const normalized = normalizeVoiceText(text);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return { use: true, reason: "empty_web_speech_transcript" };
  if (tokens.some((token) => VOICE_SUSPICIOUS_TOKENS.has(token))) {
    return { use: true, reason: "suspicious_token" };
  }
  if (tokens.some((token) => VOICE_FALLBACK_SAFE_TERMS.has(token))) {
    return { use: false, reason: "safe_short_term" };
  }
  if (/\b(chao|hello|hi|xin)\b/.test(normalized) && /\blumi\b/.test(normalized)) {
    return { use: false, reason: "greeting_with_lumi" };
  }
  if (/\bxin\s+chao\b/.test(normalized) || /\bchao\s+lumi\b/.test(normalized)) {
    return { use: false, reason: "greeting_phrase" };
  }
  if (tokens.length >= 2) {
    return { use: false, reason: "web_speech_trusted_multiword" };
  }
  if (tokens.length === 1 && tokens[0].length > 8) {
    return { use: false, reason: "single_long_token_trusted" };
  }
  if (tokens.length === 1) {
    return { use: true, reason: "single_short_token_verify" };
  }
  return { use: false, reason: "web_speech_trusted" };
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
  const { initialState = "idle", onMessage, preferServerAsr = false } = options;
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
  setCurrentApiSessionId(apiSessionIdRef.current);

  const setApiSessionId = useCallback((sessionId: string) => {
    if (!sessionId || apiSessionIdRef.current === sessionId) return;
    apiSessionIdRef.current = sessionId;
    setCurrentApiSessionId(sessionId);
    voiceBufferStartedAtRef.current = null;
    if (voiceFlushTimerRef.current) {
      clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = null;
    }
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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamAudioChainRef = useRef<Promise<void>>(Promise.resolve());
  const streamGenerationRef = useRef(0);
  const voiceTurnTimerRef = useRef<TurnLatencyTimer | null>(null);
  const voiceIngestChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastVoiceIngestAtRef = useRef(0);
  const lastTrustedWebSpeechAtRef = useRef(0);
  const awaitingVoiceStreamRef = useRef(false);
  const blockServerFallbackRef = useRef(false);
  const hasPendingVoiceFlushRef = useRef(false);
  const pendingFlushAfterInterruptRef = useRef(false);
  const lastVoiceBufferTextRef = useRef("");
  const emptyFlushRetryRef = useRef(false);
  const voiceStreamWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioUnlockedRef = useRef(false);

  const unlockAudioPlayback = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      const silent = new Audio(
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
      );
      silent.volume = 0.001;
      void silent.play().then(() => {
        audioUnlockedRef.current = true;
      }).catch(() => undefined);
    } catch {
      // ignore
    }
  }, []);

  const hardStopAudio = useCallback(() => {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    streamAudioChainRef.current = Promise.resolve();
  }, []);

  const interruptActiveLumiTurn = useCallback(() => {
    streamGenerationRef.current += 1;
    hardStopAudio();
    void interruptLumiTurn(apiSessionIdRef.current).catch(() => undefined);
  }, [hardStopAudio]);

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

  const playLumiAudioBase64 = useCallback((audioBase64: string, streamId: number, mime = "audio/wav") => {
    streamAudioChainRef.current = streamAudioChainRef.current.then(
      () =>
        new Promise<void>((resolve) => {
          if (streamGenerationRef.current !== streamId) {
            resolve();
            return;
          }

          setState("speaking");
          const audioEl = new Audio(`data:${mime};base64,${audioBase64}`);
          currentAudioRef.current = audioEl;
          audioEl.onended = () => resolve();
          audioEl.onerror = (event) => {
            console.warn("[Lumi AUDIO] decode/play error:", event, { mime });
            resolve();
          };
          audioEl.onpause = () => resolve();
          audioEl.play().catch((err) => {
            console.warn("[Lumi AUDIO] autoplay blocked — bấm mic lại để mở tiếng:", err);
            resolve();
          });
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

  const clearVoiceStreamWatchdog = useCallback(() => {
    if (voiceStreamWatchdogRef.current) {
      clearTimeout(voiceStreamWatchdogRef.current);
      voiceStreamWatchdogRef.current = null;
    }
  }, []);

  const clearVoiceFlushState = useCallback(() => {
    if (voiceFlushTimerRef.current) {
      clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = null;
    }
    hasPendingVoiceFlushRef.current = false;
    awaitingVoiceStreamRef.current = false;
    lastVoiceBufferTextRef.current = "";
    voiceBufferStartedAtRef.current = null;
    clearVoiceStreamWatchdog();
  }, [clearVoiceStreamWatchdog]);

  const presentSyncedVoiceReply = useCallback(
    async (data: VoiceBufferResult, transcript: string) => {
      const result = voiceResultFromApi(data, transcript);
      if (!result) return false;
      clearVoiceFlushState();
      voiceFlushInFlightRef.current = false;
      pendingFlushAfterInterruptRef.current = false;
      setState("speaking");
      await appendLumiResult(result);
      blockServerFallbackRef.current = false;
      return true;
    },
    [appendLumiResult, clearVoiceFlushState],
  );

  const flushVoiceBuffer = useCallback(async () => {
    if (voiceFlushTimerRef.current) {
      clearTimeout(voiceFlushTimerRef.current);
      voiceFlushTimerRef.current = null;
    }
    if (voiceFlushInFlightRef.current) {
      pendingFlushAfterInterruptRef.current = true;
      interruptActiveLumiTurn();
      return;
    }
    hasPendingVoiceFlushRef.current = false;
    pendingFlushAfterInterruptRef.current = false;
    voiceBufferStartedAtRef.current = null;
    voiceFlushInFlightRef.current = true;
    blockServerFallbackRef.current = true;
    hardStopAudio();

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

      if (chunk.status === "interrupted" || chunk.status === "stopped") {
        hardStopAudio();
        voiceTurnTimerRef.current?.mark("stream_interrupted");
        return;
      }

      if (chunk.text_chunk) {
        const normalizedChunk = normalizeVoiceText(chunk.text_chunk);
        if (normalizedChunk && normalizedChunk === normalizeVoiceText(lastStreamedChunkText)) {
          return;
        }
        lastStreamedChunkText = chunk.text_chunk;
        if (streamedResponse && !streamedResponse.endsWith(" ") && !chunk.text_chunk.startsWith(" ")) {
          streamedResponse += " ";
        }
        streamedResponse += chunk.text_chunk;
        upsertStreamedMessage(streamedResponse);
        setSnapshotExtras((prev) => ({ ...prev, lastResponse: streamedResponse }));
      }

      if (chunk.audio_base64) {
        voiceTurnTimerRef.current?.mark("first_audio_playback");
        logModelTiming({
          stage: "tts_playback",
          mime: chunk.audio_mime ?? "audio/wav",
          bytes: chunk.audio_base64.length,
        });
        void playLumiAudioBase64(chunk.audio_base64, streamId, chunk.audio_mime ?? "audio/wav");
      }
    };

    try {
      setState("thinking");
      voiceTurnTimerRef.current?.mark("stream_request_start");
      console.info("[Lumi STREAM] POST /api/voice_stream …");
      const result = await flushVoiceTurnStream(apiSessionIdRef.current, handleChunk);
      voiceTurnTimerRef.current?.mark("stream_complete");
      const finalResponse = (streamedResponse || result?.response || "").trim();

      // Giải phóng sớm — không chặn lượt voice tiếp theo trong lúc chờ phát audio.
      voiceFlushInFlightRef.current = false;
      if (pendingFlushAfterInterruptRef.current) {
        pendingFlushAfterInterruptRef.current = false;
        queueMicrotask(() => {
          void flushVoiceBuffer();
        });
      }

      logModelTiming({
        stage: "voice_stream_complete",
        ...(voiceTurnTimerRef.current?.summary() ?? {}),
      });
      awaitingVoiceStreamRef.current = false;
      blockServerFallbackRef.current = false;
      clearVoiceStreamWatchdog();

      if (!finalResponse) {
        const retryText = lastVoiceBufferTextRef.current.trim();
        if (retryText && !emptyFlushRetryRef.current) {
          emptyFlushRetryRef.current = true;
          console.warn("[Lumi STREAM] buffer trống — gửi lại voice_text rồi flush:", retryText);
          voiceFlushInFlightRef.current = false;
          try {
            const retryData = await submitVoiceTranscript(retryText, apiSessionIdRef.current);
            if (retryData.status === "buffered") {
              lastVoiceBufferTextRef.current = retryData.buffered_text?.trim() || retryText;
              hasPendingVoiceFlushRef.current = true;
              emptyFlushRetryRef.current = false;
              queueMicrotask(() => {
                void flushVoiceBuffer();
              });
              return;
            }
          } catch (retryErr) {
            console.error("[Lumi STREAM] retry voice_text failed:", retryErr);
          }
          emptyFlushRetryRef.current = false;
        }
        setState("idle");
        return;
      }
      emptyFlushRetryRef.current = false;

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
      voiceTurnTimerRef.current?.log({
        path: "voice_stream",
        note: "buffer_ms xem scheduleVoiceFlush; API ms xem [Lumi API]",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState("error");
      setSnapshotExtras((prev) => ({ ...prev, error: message }));
    } finally {
      voiceFlushInFlightRef.current = false;
      if (pendingFlushAfterInterruptRef.current) {
        pendingFlushAfterInterruptRef.current = false;
        queueMicrotask(() => {
          void flushVoiceBuffer();
        });
      }
    }
  }, [clearVoiceStreamWatchdog, hardStopAudio, interruptActiveLumiTurn, onMessage, playLumiAudioBase64]);

  const deliverVoiceTurn = useCallback(
    async (data: VoiceBufferResult, displayedTranscript: string) => {
      if (await presentSyncedVoiceReply(data, displayedTranscript)) {
        return;
      }
      if (data.status === "buffered") {
        lastVoiceBufferTextRef.current = data.buffered_text?.trim() || displayedTranscript;
        hasPendingVoiceFlushRef.current = true;
        awaitingVoiceStreamRef.current = true;
        blockServerFallbackRef.current = true;
        setState("thinking");
        console.info("[Lumi] server buffered — fallback voice_stream sau", VOICE_STREAM_FALLBACK_MS, "ms");
        if (voiceFlushTimerRef.current) clearTimeout(voiceFlushTimerRef.current);
        voiceFlushTimerRef.current = setTimeout(() => {
          voiceFlushTimerRef.current = null;
          void flushVoiceBuffer();
        }, VOICE_STREAM_FALLBACK_MS);
        clearVoiceStreamWatchdog();
        voiceStreamWatchdogRef.current = setTimeout(() => {
          if (!awaitingVoiceStreamRef.current || voiceFlushInFlightRef.current) return;
          console.warn("[Lumi STREAM] watchdog ép voice_stream");
          void flushVoiceBuffer();
        }, VOICE_STREAM_WATCHDOG_MS);
        return;
      }
      blockServerFallbackRef.current = false;
      setState("idle");
    },
    [clearVoiceStreamWatchdog, flushVoiceBuffer, presentSyncedVoiceReply],
  );

  const runVoiceIngest = useCallback((task: () => Promise<void>) => {
    const run = voiceIngestChainRef.current
      .then(task)
      .catch((err) => {
        console.error("[Lumi voice] ingest error:", err);
      });
    voiceIngestChainRef.current = run;
    return run;
  }, []);

  const sendVoice = useCallback(
    (text: string, audio?: Blob) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isLikelyVoiceNoise(trimmed)) {
        console.warn("[Lumi STT] dropped as noise:", trimmed);
        return;
      }

      void runVoiceIngest(async () => {
      const turnTimer = new TurnLatencyTimer("voice-turn");
      voiceTurnTimerRef.current = turnTimer;
      turnTimer.mark("stt_final_received");
      lastVoiceIngestAtRef.current = Date.now();
      unlockAudioPlayback();

      const isStopIntent = isStopIntentText(trimmed);
      const streamActive = voiceFlushInFlightRef.current;
      const ttsPlaying = Boolean(
        currentAudioRef.current && !currentAudioRef.current.paused && !currentAudioRef.current.ended,
      );

      if (streamActive && !isStopIntent) {
        console.info("[Lumi] barge-in — dừng stream đang chạy, sẽ flush lại sau buffer");
        pendingFlushAfterInterruptRef.current = true;
        interruptActiveLumiTurn();
      } else if (isStopIntent) {
        if (voiceFlushTimerRef.current) {
          clearTimeout(voiceFlushTimerRef.current);
          voiceFlushTimerRef.current = null;
        }
        hasPendingVoiceFlushRef.current = false;
        awaitingVoiceStreamRef.current = false;
        clearVoiceStreamWatchdog();
        interruptActiveLumiTurn();
      } else if (ttsPlaying) {
        hardStopAudio();
        void interruptLumiTurn(apiSessionIdRef.current).catch(() => undefined);
      }

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
        const fallback = phoWhisperFallbackDecision(trimmed, audio);
        const tokenCount = normalizeVoiceText(trimmed).split(" ").filter(Boolean).length;
        // Tin Web Speech từ 2 từ trở lên — không gửi audio lên PhoWhisper (tránh ghi đè + chậm).
        const usePhoWhisper =
          Boolean(audio && audio.size >= 800) && fallback.use && tokenCount < 2;

        if (!usePhoWhisper) {
          blockServerFallbackRef.current = true;
        }

        if (isStopIntent) {
          logSttRoute({
            source: "web_speech",
            webSpeechText: trimmed,
            audioBytes: audio?.size,
            fallbackReason: "stop_intent_skip_whisper",
          });
          appendUserMessage(trimmed);
          turnTimer.mark("stop_interrupt_sent");
          data = await submitVoiceTranscript(trimmed, apiSessionIdRef.current);
          turnTimer.mark("stop_api_done");
          if (data.response_text) {
            await presentSyncedVoiceReply(data, trimmed);
          }
          blockServerFallbackRef.current = false;
          turnTimer.log({ stt_source: "web_speech", stop: true });
          return;
        }

        if (usePhoWhisper) {
          logSttRoute({
            source: "pho_whisper",
            webSpeechText: trimmed,
            audioBytes: audio?.size,
            fallbackReason: fallback.reason,
          });
          setState("transcribing");
          turnTimer.mark("pho_whisper_request");
          data = await submitVoiceAudioFallback(audio!, apiSessionIdRef.current);
          turnTimer.mark("pho_whisper_done");
          displayedTranscript = data.input_text?.trim() || trimmed;
          if (isLikelyVoiceNoise(displayedTranscript)) {
            console.warn("[Lumi STT] PhoWhisper dropped as noise:", displayedTranscript);
            blockServerFallbackRef.current = false;
            turnTimer.log({ stt_source: "pho_whisper", noise: true });
            setState("idle");
            return;
          }
          logSttRoute({
            source: "pho_whisper",
            webSpeechText: trimmed,
            whisperText: displayedTranscript,
            audioBytes: audio?.size,
            fallbackReason: fallback.reason,
          });
        } else {
          logSttRoute({
            source: "web_speech",
            webSpeechText: trimmed,
            audioBytes: audio?.size,
            fallbackReason: fallback.reason,
          });
          appendUserMessage(trimmed);
          lastTrustedWebSpeechAtRef.current = Date.now();
          turnTimer.mark("web_speech_submit");
          data = await submitVoiceTranscript(trimmed, apiSessionIdRef.current);
          turnTimer.mark("web_speech_done");
        }

        if (data.status === "stopped") {
          if (data.response_text) {
            await presentSyncedVoiceReply(data, displayedTranscript);
          }
          blockServerFallbackRef.current = false;
          turnTimer.log({ stt_source: usePhoWhisper ? "pho_whisper" : "web_speech", stop: true });
          return;
        }

        if (data.response_text?.trim()) {
          if (displayedTranscript !== trimmed || usePhoWhisper) {
            appendUserMessage(displayedTranscript);
          }
          await presentSyncedVoiceReply(data, displayedTranscript);
          turnTimer.log({
            stt_source: usePhoWhisper ? "pho_whisper" : "web_speech",
            auto_flushed: true,
          });
          return;
        }

        if (data.status === "buffered") {
          if (displayedTranscript !== trimmed || usePhoWhisper) {
            appendUserMessage(displayedTranscript);
          }
          await deliverVoiceTurn(data, displayedTranscript);
          turnTimer.log({
            stt_source: usePhoWhisper ? "pho_whisper" : "web_speech",
            buffered: true,
          });
        } else if (data.status === "ignored") {
          blockServerFallbackRef.current = false;
          hasPendingVoiceFlushRef.current = false;
          turnTimer.log({ ignored: true, reason: data.reason });
          setState("idle");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        blockServerFallbackRef.current = false;
        setState("error");
        setSnapshotExtras((prev) => ({ ...prev, error: message }));
        turnTimer.log({ error: message });
      }
      });
    },
    [clearVoiceStreamWatchdog, deliverVoiceTurn, hardStopAudio, interruptActiveLumiTurn, onMessage, presentSyncedVoiceReply, runVoiceIngest, unlockAudioPlayback],
  );

  const sendVoiceFromAudio = useCallback(
    (audio: Blob) => {
      if (!audio || audio.size < 800) {
        console.warn("[Lumi STT] sendVoiceFromAudio skipped: audio too small", audio?.size ?? 0);
        return;
      }

      if (
        blockServerFallbackRef.current ||
        awaitingVoiceStreamRef.current ||
        hasPendingVoiceFlushRef.current
      ) {
        console.info("[Lumi STT] sendVoiceFromAudio skipped: đang buffer / chờ LLM");
        return;
      }

      const sinceLastIngest = Date.now() - lastVoiceIngestAtRef.current;
      const sinceTrustedWebSpeech = Date.now() - lastTrustedWebSpeechAtRef.current;
      if (sinceLastIngest < 3000 || sinceTrustedWebSpeech < 5000) {
        console.info(
          "[Lumi STT] sendVoiceFromAudio skipped: ưu tiên Web Speech",
          { sinceLastIngest, sinceTrustedWebSpeech },
        );
        return;
      }

      void runVoiceIngest(async () => {
      const turnTimer = new TurnLatencyTimer("voice-turn-audio");
      voiceTurnTimerRef.current = turnTimer;
      turnTimer.mark("server_asr_only");
      lastVoiceIngestAtRef.current = Date.now();
      unlockAudioPlayback();
      blockServerFallbackRef.current = true;

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
        setState("transcribing");
        logSttRoute({
          source: "pho_whisper",
          webSpeechText: "",
          audioBytes: audio.size,
          fallbackReason: "server_asr_only_no_web_speech",
        });
        const data = await submitVoiceAudioFallback(audio, apiSessionIdRef.current);
        turnTimer.mark("pho_whisper_done");
        const displayedTranscript = data.input_text?.trim() || "";

        if (!displayedTranscript || isLikelyVoiceNoise(displayedTranscript)) {
          console.warn("[Lumi STT] PhoWhisper-only dropped as noise:", displayedTranscript);
          blockServerFallbackRef.current = false;
          setState("idle");
          return;
        }

        if (voiceFlushInFlightRef.current) {
          pendingFlushAfterInterruptRef.current = true;
          interruptActiveLumiTurn();
        } else if (isStopIntentText(displayedTranscript)) {
          if (voiceFlushTimerRef.current) {
            clearTimeout(voiceFlushTimerRef.current);
            voiceFlushTimerRef.current = null;
          }
          hasPendingVoiceFlushRef.current = false;
          interruptActiveLumiTurn();
        }

        if (data.status === "stopped") {
          if (data.response_text) {
            await presentSyncedVoiceReply(data, displayedTranscript);
          }
          blockServerFallbackRef.current = false;
          hasPendingVoiceFlushRef.current = false;
          turnTimer.log({ stt_source: "pho_whisper", stop: true });
          return;
        }

        appendUserMessage(displayedTranscript);

        if (data.response_text?.trim()) {
          await presentSyncedVoiceReply(data, displayedTranscript);
          turnTimer.log({ stt_source: "pho_whisper", auto_flushed: true });
          return;
        }

        if (data.status === "buffered") {
          await deliverVoiceTurn(data, displayedTranscript);
          turnTimer.log({ stt_source: "pho_whisper", buffered: true });
        } else if (data.status === "ignored") {
          blockServerFallbackRef.current = false;
          hasPendingVoiceFlushRef.current = false;
          turnTimer.log({ ignored: true, reason: data.reason });
          setState("idle");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        blockServerFallbackRef.current = false;
        setState("error");
        setSnapshotExtras((prev) => ({ ...prev, error: message }));
        turnTimer.log({ error: message });
      }
      });
    },
    [clearVoiceStreamWatchdog, deliverVoiceTurn, interruptActiveLumiTurn, onMessage, preferServerAsr, presentSyncedVoiceReply, runVoiceIngest],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      textTurnGenerationRef.current += 1;
      hardStopAudio();
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
    (next: ChatMessage[], sessionId: string) => {
      setApiSessionId(sessionId);
      setMessages(next.length > 0 ? next : [makeGreeting()]);
      historyRef.current = next.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      textBufferRef.current = [];
      textTurnGenerationRef.current += 1;
      voiceBufferStartedAtRef.current = null;
      voiceFlushInFlightRef.current = false;
      pendingFlushAfterInterruptRef.current = false;
      hasPendingVoiceFlushRef.current = false;
      setSnapshotExtras({});
    },
    [setApiSessionId],
  );

  const resetMessages = useCallback(
    (sessionId?: string) => {
      const sid = sessionId ?? generateUUID();
      setApiSessionId(sid);
      setMessages([makeGreeting()]);
      historyRef.current = [];
      textBufferRef.current = [];
      textTurnGenerationRef.current += 1;
      voiceBufferStartedAtRef.current = null;
      voiceFlushInFlightRef.current = false;
      pendingFlushAfterInterruptRef.current = false;
      hasPendingVoiceFlushRef.current = false;
      setSnapshotExtras({});
    },
    [setApiSessionId],
  );

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
    sendVoiceFromAudio,
    notifyTyping,
    setMuted,
    setListening,
    loadMessages,
    resetMessages,
    setApiSessionId,
    unlockAudioOnMicStart: unlockAudioPlayback,
    blockServerFallbackRef,
    hasPendingVoiceFlushRef,
    enrolledProfiles,
    setEnrolledProfiles,
    interimTranscript,
    setInterimTranscript,
  };
}
