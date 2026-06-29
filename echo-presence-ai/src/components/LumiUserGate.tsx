import { useCallback, useEffect, useState, type RefObject } from "react";

import { loginLumiUser } from "@/ai/userMemory";
import { clearLumiUser, loadLumiUser, saveLumiUser, type LumiUserProfile } from "@/store/lumiUser";

interface LumiUserGateProps {
  children: React.ReactNode;
}

export function LumiUserGate({ children }: LumiUserGateProps) {
  const [profile, setProfile] = useState<LumiUserProfile | null>(() => loadLumiUser());
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const completeLogin = useCallback(async () => {
    const displayName = nameInput.trim();
    if (!displayName) {
      setError("Vui lòng nhập tên của bạn.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginLumiUser(displayName);
      const next: LumiUserProfile = {
        userId: result.user_id,
        displayName: result.display_name,
        preferences: result.preferences,
      };
      saveLumiUser(next);
      setProfile(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không đăng nhập được.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [nameInput]);

  if (!profile) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <h1 className="text-xl font-semibold text-slate-900">Chào bạn, Lumi đây</h1>
          <p className="mt-2 text-sm text-slate-600">
            Nhập tên để Lumi nhớ cách trò chuyện phù hợp với bạn. Dữ liệu được lưu trên máy chủ theo tên này.
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="lumi-user-name">
            Tên của bạn
          </label>
          <input
            id="lumi-user-name"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-sky-300 focus:ring"
            placeholder="Ví dụ: Uyên"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void completeLogin();
            }}
            autoFocus
          />
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            disabled={submitting}
            onClick={() => void completeLogin()}
          >
            {submitting ? "Đang vào..." : "Bắt đầu trò chuyện"}
          </button>
          <button
            type="button"
            className="mt-2 w-full text-xs text-slate-500 hover:text-slate-700"
            onClick={() => {
              clearLumiUser();
              setProfile({ userId: "guest", displayName: "Khách" });
              saveLumiUser({ userId: "guest", displayName: "Khách" });
            }}
          >
            Tiếp tục không lưu sở thích
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function useLumiSessionLifecycle(
  getSessionId: () => string,
  hasPendingVoiceFlushRef?: RefObject<boolean>,
) {
  useEffect(() => {
    let lastSentAt = 0;
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      if (hasPendingVoiceFlushRef?.current) {
        console.info("[Lumi] skip session/end — voice buffer chưa flush sang LLM");
        return;
      }
      const now = Date.now();
      if (now - lastSentAt < 8000) return;
      lastSentAt = now;
      void import("@/ai/userMemory").then(({ endLumiSession }) =>
        endLumiSession(getSessionId(), "close"),
      );
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [getSessionId, hasPendingVoiceFlushRef]);
}
