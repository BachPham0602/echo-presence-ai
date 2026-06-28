/**
 * Selected Lumi owner voice (profile from backend `owner_voices/<name>`).
 * Persisted to localStorage and broadcast to subscribers.
 */

const STORAGE_KEY = "lumi.owner_voice";
const DEFAULT_VOICE = "Uyên";
const EVENT = "lumi:voice-changed";

export function getSelectedVoice(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function setSelectedVoice(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: name }));
  } catch {
    /* ignore */
  }
}

export function subscribeSelectedVoice(cb: (name: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export interface OwnerVoiceProfile {
  name: string;
  sample_count: number;
}

const FALLBACK: OwnerVoiceProfile[] = [{ name: DEFAULT_VOICE, sample_count: 0 }];

export interface VoicesResult {
  voices: OwnerVoiceProfile[];
  error?: string;
  usingFallback: boolean;
}

export async function fetchAvailableVoices(): Promise<VoicesResult> {
  const base = import.meta.env.VITE_LUMI_API_BASE ?? "";
  const endpoints = ["/api/speakers", "/api/voices", "/api/owner_voices"];
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}${ep}`);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        speakers?: OwnerVoiceProfile[];
        voices?: OwnerVoiceProfile[];
      };
      const list = data.speakers ?? data.voices ?? [];
      if (list.length > 0) return { voices: list, usingFallback: false };
    } catch {
      /* try next */
    }
  }
  return {
    voices: FALLBACK,
    usingFallback: true,
    error: "Không kết nối được backend giọng nói — đang dùng danh sách mặc định.",
  };
}
