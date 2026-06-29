/**
 * Client-side latency + routing debug for Lumi voice pipeline.
 * Enabled in dev or when VITE_LUMI_DEBUG=1.
 */

export type SttSource = "web_speech" | "pho_whisper";

export interface SttRouteInfo {
  source: SttSource;
  webSpeechText: string;
  whisperText?: string;
  audioBytes?: number;
  fallbackReason?: string;
}

const DEBUG_ENABLED =
  import.meta.env.DEV || String(import.meta.env.VITE_LUMI_DEBUG ?? "") === "1";

export class TurnLatencyTimer {
  private readonly turnId: string;
  private readonly t0: number;
  private last: number;
  private readonly stages = new Map<string, number>();

  constructor(label = "voice-turn") {
    this.turnId = `${label}-${Date.now().toString(36)}`;
    this.t0 = performance.now();
    this.last = this.t0;
  }

  mark(stage: string): number {
    const now = performance.now();
    const delta = now - this.last;
    this.stages.set(stage, delta);
    this.last = now;
    return delta;
  }

  summary(extra?: Record<string, unknown>) {
    const total = performance.now() - this.t0;
    const stages: Record<string, number> = {};
    for (const [k, v] of this.stages) stages[k] = Math.round(v);
    const accounted = Object.values(stages).reduce((a, b) => a + b, 0);
    return {
      turnId: this.turnId,
      total_ms: Math.round(total),
      stages_ms: stages,
      unaccounted_ms: Math.round(Math.max(0, total - accounted)),
      ...extra,
    };
  }

  log(extra?: Record<string, unknown>) {
    if (!DEBUG_ENABLED) return;
    const payload = this.summary(extra);
    console.info("[Lumi LATENCY]", payload);
  }
}

export function logSttRoute(info: SttRouteInfo) {
  if (!DEBUG_ENABLED) return;
  console.info("[Lumi STT]", {
    source: info.source,
    web_speech: info.webSpeechText,
    pho_whisper: info.whisperText ?? null,
    audio_bytes: info.audioBytes ?? null,
    fallback_reason: info.fallbackReason ?? null,
  });
}

export function logApiTiming(
  endpoint: string,
  timings: { fetch_ms: number; ttfb_ms?: number; body_ms?: number },
) {
  if (!DEBUG_ENABLED) return;
  console.info("[Lumi API]", { endpoint, ...timings });
}

/** Luôn in ra console (F12) — thời gian xử lý từng model. */
export function logModelTiming(info: Record<string, unknown>) {
  console.info("[Lumi MODEL]", info);
}

export function isLumiDebugEnabled(): boolean {
  return DEBUG_ENABLED;
}
