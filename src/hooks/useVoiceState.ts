import { useCallback, useEffect, useRef, useState } from "react";

export type MicPermission = "unknown" | "prompt" | "granted" | "denied";

export interface VoiceState {
  permission: MicPermission;
  isMuted: boolean;
  isListening: boolean;
  requestMic: () => Promise<void>;
  toggleMute: () => void;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * Manages microphone permission + mute/listen flags.
 * Real audio capture wiring lives in useLumiPipeline; this hook keeps
 * permission + UI state isolated and reusable.
 */
export function useVoiceState(): VoiceState {
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status: PermissionStatus) => {
        if (cancelled) return;
        setPermission(status.state as MicPermission);
        status.onchange = () => setPermission(status.state as MicPermission);
      })
      .catch(() => {
        // permissions API not available — leave as "unknown"
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestMic = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setPermission("denied");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setPermission("granted");
      setIsListening(true);
    } catch {
      setPermission("denied");
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  const startListening = useCallback(() => setIsListening(true), []);
  const stopListening = useCallback(() => setIsListening(false), []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    permission,
    isMuted,
    isListening,
    requestMic,
    toggleMute,
    startListening,
    stopListening,
  };
}