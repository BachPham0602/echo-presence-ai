import { useCallback, useEffect, useRef, useState } from "react";

export type RecognitionStatus =
  | "idle"
  | "checking_permissions"
  | "starting"
  | "listening"
  | "speech_detected"
  | "processing"
  | "no_speech"
  | "denied"
  | "unsupported"
  | "failed";

export interface UseSpeechRecognitionOptions {
  lang?: string;
  /** Called with each final transcript chunk and the matching recent audio when available. */
  onFinal: (text: string, audio?: Blob) => void;
  /** Called continuously with the latest interim transcript. */
  onInterim?: (text: string) => void;
  /**
   * Fallback when mic captured speech but Web Speech API produced no text
   * (common on remote / strict networks). Sends WAV to PhoWhisper on server.
   */
  onServerTranscribe?: (audio: Blob) => void;
  /** Enable silence-based server ASR fallback (recommended for Live Chat). */
  enableServerFallback?: boolean;
  /** Không ghi audio / không VAD fallback khi Lumi đang nghĩ hoặc đang nói (chống echo). */
  pauseMicCapture?: boolean;
  /** Chặn PhoWhisper VAD khi Web Speech đã buffer và đang chờ LLM. */
  blockServerFallbackRef?: React.RefObject<boolean>;
}

export interface UseSpeechRecognitionResult {
  status: RecognitionStatus;
  error: string | null;
  isListening: boolean;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

function nextFinalTranscriptChunk(cleaned: string, previous: string): string {
  const currentLower = cleaned.toLowerCase();
  const previousLower = previous.toLowerCase();

  if (!previousLower || currentLower === previousLower) return cleaned;
  if (!currentLower.startsWith(previousLower)) return cleaned;

  const cutAt = previous.length;
  const previousChar = cleaned.charAt(cutAt - 1);
  const nextChar = cleaned.charAt(cutAt);
  const cutsAtWordBoundary = !nextChar || /\s/.test(nextChar) || /\s/.test(previousChar);

  return cutsAtWordBoundary ? cleaned.substring(cutAt).trim() : cleaned;
}

const MIN_SERVER_AUDIO_BYTES = 800;
const SILENCE_MS_FOR_SERVER_FALLBACK = 2600;
const VAD_RMS_THRESHOLD = 0.012;
/** Giữ tối đa ~6s trong ring buffer; chỉ gửi ~4s lên PhoWhisper. */
const MAX_MIC_RING_SECONDS = 6;
const MAX_ASR_AUDIO_SECONDS = 4;
const SERVER_FALLBACK_COOLDOWN_MS = 2000;

/**
 * Web Speech API wrapper tuned for Vietnamese voice companion use.
 *
 * - continuous + interimResults
 * - auto-restarts on benign onend / no-speech
 * - optional server ASR fallback when browser STT is silent
 */
export function useSpeechRecognition({
  lang = "vi-VN",
  onFinal,
  onInterim,
  onServerTranscribe,
  enableServerFallback = true,
  pauseMicCapture = false,
  blockServerFallbackRef,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [status, setStatus] = useState<RecognitionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  const onServerTranscribeRef = useRef(onServerTranscribe);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);
  useEffect(() => {
    onServerTranscribeRef.current = onServerTranscribe;
  }, [onServerTranscribe]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const startingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimBufferRef = useRef("");
  const lastFinalRef = useRef("");
  const segmentHadWebSpeechRef = useRef(false);
  const voiceActiveRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSinkRef = useRef<GainNode | null>(null);
  const audioBuffersRef = useRef<Float32Array[]>([]);
  const audioSampleRateRef = useRef(16000);
  const pauseMicCaptureRef = useRef(pauseMicCapture);
  const lastServerFallbackAtRef = useRef(0);

  useEffect(() => {
    pauseMicCaptureRef.current = pauseMicCapture;
  }, [pauseMicCapture]);

  const consumeRecentAudio = useCallback((): Blob | undefined => {
    const buffers = audioBuffersRef.current;
    audioBuffersRef.current = [];
    if (buffers.length === 0) return undefined;
    const sampleRate = audioSampleRateRef.current;
    const maxBuffers = Math.max(1, Math.ceil((sampleRate * MAX_ASR_AUDIO_SECONDS) / 4096));
    const trimmed =
      buffers.length > maxBuffers ? buffers.slice(buffers.length - maxBuffers) : buffers;
    const blob = encodeWav(trimmed, sampleRate);
    if (buffers.length > maxBuffers) {
      console.info(
        "[Lumi STT] audio trimmed for ASR:",
        blob.size,
        "bytes (~",
        MAX_ASR_AUDIO_SECONDS,
        "s)",
      );
    }
    return blob;
  }, []);

  const clearVadTimer = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  const tryServerFallback = useCallback(() => {
    if (!enableServerFallback || !onServerTranscribeRef.current) return;
    if (segmentHadWebSpeechRef.current) return;
    if (pauseMicCaptureRef.current) return;
    if (blockServerFallbackRef?.current) return;

    const now = Date.now();
    if (now - lastServerFallbackAtRef.current < SERVER_FALLBACK_COOLDOWN_MS) {
      return;
    }

    const blob = consumeRecentAudio();
    if (!blob || blob.size < MIN_SERVER_AUDIO_BYTES) {
      console.warn("[Lumi STT] server fallback skipped: audio too small", blob?.size ?? 0);
      return;
    }

    lastServerFallbackAtRef.current = now;
    segmentHadWebSpeechRef.current = true;
    console.info("[Lumi STT] server fallback → PhoWhisper", blob.size, "bytes");
    onServerTranscribeRef.current(blob);
  }, [consumeRecentAudio, enableServerFallback, blockServerFallbackRef]);

  const emitFinal = useCallback(
    (text: string) => {
      const cleaned = text.trim().replace(/\s+/g, " ");
      if (!cleaned) return;

      const currentLower = cleaned.toLowerCase();
      const lastLower = lastFinalRef.current.toLowerCase();

      if (currentLower === lastLower) {
        console.log("[Lumi STT] dedup, skipping:", cleaned);
        return;
      }

      const newPart = nextFinalTranscriptChunk(cleaned, lastFinalRef.current);
      lastFinalRef.current = cleaned;
      segmentHadWebSpeechRef.current = true;

      if (newPart) {
        const wordCount = newPart.split(/\s+/).filter(Boolean).length;
        const audio = wordCount >= 2 ? undefined : consumeRecentAudio();
        console.info("[Lumi STT] web_speech final → pipeline:", newPart, audio ? `${audio.size}B` : "text-only");
        onFinalRef.current(newPart, audio);
      } else {
        console.warn("[Lumi STT] empty chunk after dedup, raw:", cleaned);
      }
    },
    [consumeRecentAudio],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognitionCtor: any =
    typeof window !== "undefined"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
  const supported = Boolean(SpeechRecognitionCtor);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopAudioCapture = useCallback(() => {
    clearVadTimer();
    try {
      audioProcessorRef.current?.disconnect();
    } catch {
      /* noop */
    }
    try {
      audioAnalyserRef.current?.disconnect();
    } catch {
      /* noop */
    }
    try {
      audioSourceRef.current?.disconnect();
    } catch {
      /* noop */
    }
    try {
      audioSinkRef.current?.disconnect();
    } catch {
      /* noop */
    }
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    audioSourceRef.current = null;
    audioProcessorRef.current = null;
    audioAnalyserRef.current = null;
    audioSinkRef.current = null;
    audioBuffersRef.current = [];
  }, [clearVadTimer]);

  const cleanupAudioCapture = useCallback(() => {
    stopAudioCapture();
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, [stopAudioCapture]);

  const attachAudioCapture = useCallback(
    (stream: MediaStream) => {
      stopAudioCapture();

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const sink = audioContext.createGain();
      sink.gain.value = 0;
      audioSampleRateRef.current = audioContext.sampleRate;
      audioBuffersRef.current = [];

      processor.onaudioprocess = (event) => {
        if (pauseMicCaptureRef.current) return;
        audioBuffersRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        const maxBuffers = Math.ceil((audioSampleRateRef.current * MAX_MIC_RING_SECONDS) / 4096);
        if (audioBuffersRef.current.length > maxBuffers) {
          audioBuffersRef.current.splice(0, audioBuffersRef.current.length - maxBuffers);
        }
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(sink);
      sink.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioAnalyserRef.current = analyser;
      audioProcessorRef.current = processor;
      audioSinkRef.current = sink;

      if (enableServerFallback && onServerTranscribeRef.current) {
        const timeDomain = new Uint8Array(analyser.fftSize);
        vadTimerRef.current = setInterval(() => {
          if (!audioAnalyserRef.current || pauseMicCaptureRef.current) return;
          if (blockServerFallbackRef?.current) return;
          audioAnalyserRef.current.getByteTimeDomainData(timeDomain);
          let sum = 0;
          for (let i = 0; i < timeDomain.length; i += 1) {
            const v = (timeDomain[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeDomain.length);
          const now = Date.now();
          if (rms >= VAD_RMS_THRESHOLD) {
            voiceActiveRef.current = true;
            lastVoiceAtRef.current = now;
            return;
          }
          if (
            voiceActiveRef.current &&
            !segmentHadWebSpeechRef.current &&
            now - lastVoiceAtRef.current >= SILENCE_MS_FOR_SERVER_FALLBACK
          ) {
            voiceActiveRef.current = false;
            tryServerFallback();
          }
        }, 200);
      }
    },
    [enableServerFallback, blockServerFallbackRef, stopAudioCapture, tryServerFallback],
  );

  const buildRecognition = useCallback(() => {
    if (!SpeechRecognitionCtor) return null;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text + " ";
        else interim += text + " ";
      }

      const finalTrim = final.trim();
      const interimTrim = interim.trim();

      if (finalTrim) {
        segmentHadWebSpeechRef.current = true;
        console.log("[Lumi STT] final:", finalTrim);
        clearSilenceTimer();
        interimBufferRef.current = "";
        onInterimRef.current?.("");
        setStatus("speech_detected");
        emitFinal(finalTrim);
        setStatus("listening");
        return;
      }

      if (interimTrim) {
        segmentHadWebSpeechRef.current = true;
        console.log("[Lumi STT] interim:", interimTrim);
        interimBufferRef.current = interimTrim;
        onInterimRef.current?.(interimTrim);
        setStatus("listening");

        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          const pending = interimBufferRef.current.trim();
          if (pending) {
            console.log("[Lumi STT] silence-commit:", pending);
            interimBufferRef.current = "";
            onInterimRef.current?.("");
            emitFinal(pending);
          }
        }, 1100);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error("[Lumi STT] error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRestartRef.current = false;
        setError("Quyền truy cập micro bị từ chối. Hãy mở lại trong cài đặt trình duyệt.");
        setStatus("denied");
        setIsListening(false);
      } else if (event.error === "no-speech") {
        setStatus("no_speech");
        setError("Web Speech chưa nghe thấy giọng — Lumi sẽ thử PhoWhisper nếu có audio.");
        tryServerFallback();
      } else if (event.error === "network") {
        setError(
          "Web Speech cần mạng tới Google. Lumi vẫn có thể dùng PhoWhisper trên server khi bạn nói.",
        );
        setStatus("failed");
        tryServerFallback();
      } else if (event.error === "audio-capture") {
        shouldRestartRef.current = false;
        setError("Không tìm thấy micro. Bạn kiểm tra giúp Lumi nhé.");
        setStatus("failed");
        setIsListening(false);
      } else if (event.error === "aborted") {
        // benign
      } else {
        setError(`Lỗi nhận diện giọng nói: ${event.error}`);
        setStatus("failed");
      }
    };

    recognition.onend = () => {
      console.log("[Lumi STT] ended");
      clearSilenceTimer();
      const pending = interimBufferRef.current.trim();
      if (pending) {
        interimBufferRef.current = "";
        onInterimRef.current?.("");
        emitFinal(pending);
      }
      if (shouldRestartRef.current) {
        try {
          lastFinalRef.current = "";
          segmentHadWebSpeechRef.current = false;
          voiceActiveRef.current = false;
          recognition.start();
          console.log("[Lumi STT] auto-restarted");
          setIsListening(true);
          setStatus("listening");
        } catch (e) {
          console.warn("[Lumi STT] auto-restart failed", e);
          setIsListening(false);
          setStatus("idle");
        }
      } else {
        setIsListening(false);
        setStatus("idle");
      }
    };

    recognition.onstart = () => {
      console.log("[Lumi STT] started (lang=", lang, ")");
      setIsListening(true);
      setError(null);
      setStatus("listening");
      segmentHadWebSpeechRef.current = false;
      voiceActiveRef.current = false;
      if (micStreamRef.current) {
        attachAudioCapture(micStreamRef.current);
      }
    };

    return recognition;
  }, [SpeechRecognitionCtor, attachAudioCapture, emitFinal, lang, tryServerFallback]);

  const start = useCallback(async () => {
    if (startingRef.current) {
      console.warn("[Lumi STT] start() ignored — already starting");
      return;
    }
    if (!SpeechRecognitionCtor) {
      setStatus("unsupported");
      setError("Trình duyệt này chưa hỗ trợ nhận diện giọng nói. Bạn có thể gõ chữ nhé.");
      return;
    }

    startingRef.current = true;
    setStatus("checking_permissions");
    setError(null);

    try {
      if (!micStreamRef.current) {
        console.info("[Lumi STT] getUserMedia...");
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* noop */
        }
      }

      const recognition = buildRecognition();
      if (!recognition) return;

      lastFinalRef.current = "";
      segmentHadWebSpeechRef.current = false;
      recognitionRef.current = recognition;
      shouldRestartRef.current = true;
      setStatus("starting");

      recognition.start();
      console.info("[Lumi STT] recognition.start() called");
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      console.error("[Lumi STT] start failed:", name, err);
      if (name === "NotAllowedError") {
        setError("Quyền truy cập micro bị từ chối. Hãy bật lại trong cài đặt.");
        setStatus("denied");
      } else if (name === "NotFoundError") {
        setError("Không tìm thấy micro trên thiết bị này.");
        setStatus("failed");
      } else if (name === "NotReadableError") {
        setError("Micro đang được ứng dụng khác sử dụng.");
        setStatus("failed");
      } else {
        setError("Không thể bật micro. Bạn thử lại giúp Lumi nhé.");
        setStatus("failed");
      }
    } finally {
      startingRef.current = false;
    }
  }, [SpeechRecognitionCtor, buildRecognition]);

  const stop = useCallback(() => {
    console.log("[Lumi STT] stop requested");
    shouldRestartRef.current = false;
    startingRef.current = false;
    clearSilenceTimer();
    interimBufferRef.current = "";
    onInterimRef.current?.("");
    setStatus("processing");
    try {
      recognitionRef.current?.stop();
    } catch (e) {
      console.warn("[Lumi STT] stop() failed", e);
    }
    setIsListening(false);
    setStatus("idle");
    cleanupAudioCapture();
  }, [cleanupAudioCapture]);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      startingRef.current = false;
      clearSilenceTimer();
      clearVadTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
      cleanupAudioCapture();
    };
  }, [cleanupAudioCapture, clearVadTimer]);

  return { status, error, isListening, supported, start, stop };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function encodeWav(buffers: Float32Array[], sampleRate: number): Blob {
  const samples = mergeBuffers(buffers);
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function mergeBuffers(buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
