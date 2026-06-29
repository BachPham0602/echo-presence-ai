const STORAGE_KEY = "lumi.user.v1";

export interface LumiUserPreferences {
  response_length?: string;
  tone?: string;
  ask_followup?: boolean;
  likes_examples?: boolean;
  notes?: string[];
  session_count?: number;
}

export interface LumiUserProfile {
  userId: string;
  displayName: string;
  preferences?: LumiUserPreferences;
}

export function loadLumiUser(): LumiUserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LumiUserProfile;
    if (!parsed.userId || !parsed.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLumiUser(profile: LumiUserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function clearLumiUser(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getLumiUserId(): string | null {
  return loadLumiUser()?.userId ?? null;
}
