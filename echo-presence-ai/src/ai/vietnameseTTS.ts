/**
 * Vietnamese Text-to-Speech.
 *
 * Future candidates:
 *  - XTTS
 *  - Piper
 *  - Vietnamese TTS models
 *  - API-based TTS
 *
 * Architecture must support voice swapping later.
 */

export interface TTSRequest {
  text: string;
  voiceId?: string;
  tone?: string;
  speedRatio?: number;
}

export interface TTSResult {
  audio: Float32Array | null;
  durationMs: number;
  voiceId: string;
}

export interface VietnameseTTS {
  synthesize(request: TTSRequest): Promise<TTSResult>;
  listVoices(): Promise<Array<{ id: string; label: string }>>;
}

/** Mock TTS — uses the browser's SpeechSynthesis API when available. */
export const mockVietnameseTTS: VietnameseTTS = {
  async synthesize({ text, voiceId = "lumi-default" }) {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = "vi-VN";
        utter.rate = 0.95;
        utter.pitch = 1.05;
        window.speechSynthesis.speak(utter);
      } catch {
        // ignore — placeholder only
      }
    }
    // TODO: integrate XTTS / Piper / API TTS and return real audio samples
    return {
      audio: null,
      durationMs: Math.max(1200, text.length * 60),
      voiceId,
    };
  },
  async listVoices() {
    return [
      { id: "lumi-default", label: "Lumi · Ấm áp" },
      { id: "lumi-soft", label: "Lumi · Dịu dàng" },
    ];
  },
};
