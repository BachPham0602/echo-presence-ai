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

export async function uploadOwnerVoiceSample(
  name: string,
  audioBlob: Blob,
  sampleIndex = 1,
  sampleText = ""
): Promise<{ status: string; error?: string }> {
  const base = import.meta.env.VITE_LUMI_API_BASE ?? "";
  try {
    const res = await fetch(`${base}/api/owner_voice_sample`, {
      method: "POST",
      headers: {
        "X-Owner-Name": encodeURIComponent(name),
        "X-Sample-Index": String(sampleIndex),
        "X-Sample-Text": encodeURIComponent(sampleText),
        "Content-Type": "audio/wav",
      },
      body: audioBlob,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { status: "error", error: errData.error || `Lỗi server: ${res.statusText}` };
    }
    return (await res.json()) as { status: string; error?: string };
  } catch (err: any) {
    return { status: "error", error: err.message || "Không thể kết nối tới máy chủ" };
  }
}

export async function deleteOwnerVoices(
  voices: string[]
): Promise<{ status: string; deleted?: string[]; errors?: string[]; error?: string }> {
  const base = import.meta.env.VITE_LUMI_API_BASE ?? "";
  try {
    const res = await fetch(`${base}/api/delete_voices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voices }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { status: "error", error: errData.error || `Lỗi server: ${res.statusText}` };
    }
    return (await res.json()) as { status: string; deleted?: string[]; errors?: string[] };
  } catch (err: any) {
    return { status: "error", error: err.message || "Không thể kết nối tới máy chủ" };
  }
}

