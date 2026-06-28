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

export async function fetchAvailableVoices(): Promise<OwnerVoiceProfile[]> {
  const base = import.meta.env.VITE_LUMI_API_BASE ?? "";
  const res = await fetch(`${base}/api/speakers`);
  if (!res.ok) throw new Error(`/api/speakers ${res.status}`);
  const data = (await res.json()) as { speakers?: OwnerVoiceProfile[] };
  return data.speakers ?? [];
}
