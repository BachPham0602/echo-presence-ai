import { getLumiUserId } from "@/store/lumiUser";

const LUMI_API_BASE = import.meta.env.VITE_LUMI_API_BASE ?? "";

function apiUrl(path: string): string {
  return `${LUMI_API_BASE}${path}`;
}

export interface LumiLoginResult {
  user_id: string;
  display_name: string;
  preferences?: Record<string, unknown>;
  preference_prompt_ready?: boolean;
}

export async function loginLumiUser(displayName: string): Promise<LumiLoginResult> {
  const res = await fetch(apiUrl("/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Login failed: ${res.status}`);
  }
  return res.json() as Promise<LumiLoginResult>;
}

export async function endLumiSession(
  sessionId: string | undefined,
  reason: "new_chat" | "close" | "idle" | "switch" | "session_end" = "session_end",
): Promise<void> {
  const userId = getLumiUserId();
  if (!userId) return;

  const payload = JSON.stringify({
    user_id: userId,
    session_id: sessionId ?? "",
    reason,
  });

  const url = apiUrl("/api/session/end");
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": userId,
      ...(sessionId ? { "X-Session-Id": sessionId } : {}),
    },
    body: payload,
    keepalive: true,
  });
}

export function withLumiUserId<T extends Record<string, unknown>>(body: T): T & { user_id?: string } {
  const userId = getLumiUserId();
  if (!userId) return body;
  return { ...body, user_id: userId };
}
