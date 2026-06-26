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

/**
 * Web Speech API wrapper tuned for Vietnamese voice companion use.
 *
 * - continuous + interimResults
 * - auto-restarts on benign onend / no-speech
 * - keeps user-friendly Vietnamese status messages
 * - logs every state transition to console for debugging
 */
export function useSpeechRecognition({
  lang = "vi-VN",
  onFinal,
  onInterim,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [status, setStatus] = useState<RecognitionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  // Stable refs so the recognition instance doesn't restart when callers re-render.
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimBufferRef = useRef("");
  const lastFinalRef = useRef("");
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSinkRef = useRef<GainNode | null>(null);
  const audioBuffersRef = useRef<Float32Array[]>([]);
  const audioSampleRateRef = useRef(16000);

  const consumeRecentAudio = useCallback((): Blob | undefined => {
    const buffers = audioBuffersRef.current;
    audioBuffersRef.current = [];
    if (buffers.length === 0) return undefined;
    return encodeWav(buffers, audioSampleRateRef.current);
  }, []);

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

      if (newPart) {
        onFinalRef.current(newPart, consumeRecentAudio());
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

  const cleanupAudioCapture = useCallback(() => {
    try {
      audioProcessorRef.current?.disconnect();
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
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => undefined);
    micStreamRef.current = null;
    audioContextRef.current = null;
    audioSourceRef.current = null;
    audioProcessorRef.current = null;
    audioSinkRef.current = null;
    audioBuffersRef.current = [];
  }, []);

  const startAudioCapture = useCallback(async () => {
    cleanupAudioCapture();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const sink = audioContext.createGain();
    sink.gain.value = 0;
    audioSampleRateRef.current = audioContext.sampleRate;
    audioBuffersRef.current = [];

    processor.onaudioprocess = (event) => {
      audioBuffersRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      const maxBuffers = Math.ceil((audioSampleRateRef.current * 12) / 4096);
      if (audioBuffersRef.current.length > maxBuffers) {
        audioBuffersRef.current.splice(0, audioBuffersRef.current.length - maxBuffers);
      }
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioContext.destination);

    micStreamRef.current = stream;
    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    audioSinkRef.current = sink;
  }, [cleanupAudioCapture]);

  const buildRecognition = useCallback(() => {
    if (!SpeechRecognitionCtor) return null;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // Build interim/final from ALL results in this event so we never
      // double-count across onresult firings.
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
        interimBufferRef.current = interimTrim;
        onInterimRef.current?.(interimTrim);
        setStatus("listening");

        // Soft auto-commit only if interim text doesn't change for a while.
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
        setError("Tôi chưa nghe rõ, bạn có thể nói lại được không?");
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
          recognition.start();
          console.log("[Lumi STT] auto-restarted");
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
    };

    return recognition;
  }, [SpeechRecognitionCtor, emitFinal, lang]);

  const start = useCallback(async () => {
    if (!SpeechRecognitionCtor) {
      setStatus("unsupported");
      setError("Trình duyệt này chưa hỗ trợ nhận diện giọng nói. Bạn có thể gõ chữ nhé.");
      console.warn("[Lumi STT] Web Speech API not supported");
      return;
    }
    setStatus("checking_permissions");
    setError(null);

    // Pre-flight: request mic so the browser surfaces a permission prompt
    // inside the user gesture. This dramatically improves reliability on
    // Chromium and gives clear errors when blocked.
    try {
      await startAudioCapture();
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      console.error("[Lumi STT] getUserMedia failed:", name, err);
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
      return;
    }

    // Replace any existing recognizer.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* noop */
      }
    }
    const recognition = buildRecognition();
    if (!recognition) return;

    // Clear the dedup ref because Web Speech API resets its history on a new session.
    lastFinalRef.current = "";

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    setStatus("starting");
    try {
      recognition.start();
    } catch (e) {
      console.warn("[Lumi STT] start() threw — likely already started", e);
    }
  }, [SpeechRecognitionCtor, buildRecognition, startAudioCapture]);

  const stop = useCallback(() => {
    console.log("[Lumi STT] stop requested");
    shouldRestartRef.current = false;
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

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      clearSilenceTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
      cleanupAudioCapture();
    };
  }, [cleanupAudioCapture]);

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
