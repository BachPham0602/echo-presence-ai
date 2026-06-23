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
  /** Called with each final transcript chunk. */
  onFinal: (text: string) => void;
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

  const emitFinal = (text: string) => {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) return;
    if (cleaned.toLowerCase() === lastFinalRef.current.toLowerCase()) {
      console.log("[Lumi STT] dedup, skipping:", cleaned);
      return;
    }
    lastFinalRef.current = cleaned;
    onFinalRef.current(cleaned);
  };

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
        }, 1800);
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
  }, [SpeechRecognitionCtor, lang]);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We don't need the stream itself — release it immediately so the
      // recognizer can claim the microphone.
      stream.getTracks().forEach((t) => t.stop());
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
    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    setStatus("starting");
    try {
      recognition.start();
    } catch (e) {
      console.warn("[Lumi STT] start() threw — likely already started", e);
    }
  }, [SpeechRecognitionCtor, buildRecognition]);

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
  }, []);

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
    };
  }, []);

  return { status, error, isListening, supported, start, stop };
}