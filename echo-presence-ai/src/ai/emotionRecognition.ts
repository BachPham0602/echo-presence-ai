/**
 * Emotion recognition — detects how the user is feeling.
 *
 * Supports:
 *  - speech emotion (acoustic)
 *  - text emotion (semantic)
 *  - multimodal fusion
 *
 * Future integration only — mock implementation for now.
 */

import type { EmotionReading, UserEmotion } from "@/types/emotion";

export interface EmotionRecognizer {
  fromSpeech(audio: Float32Array): Promise<EmotionReading>;
  fromText(text: string): Promise<EmotionReading>;
  fuse(readings: EmotionReading[]): Promise<EmotionReading>;
}

const HEURISTICS: Array<{ keyword: RegExp; emotion: UserEmotion }> = [
  { keyword: /(buồn|cô đơn|một mình|lonely|sad)/i, emotion: "lonely" },
  { keyword: /(mệt|tired|kiệt sức)/i, emotion: "tired" },
  { keyword: /(căng thẳng|stress|áp lực)/i, emotion: "stressed" },
  { keyword: /(vui|hạnh phúc|happy|tuyệt)/i, emotion: "happy" },
];

/** Mock recognizer — text path uses tiny keyword heuristics. */
export const mockEmotionRecognizer: EmotionRecognizer = {
  async fromSpeech(_audio): Promise<EmotionReading> {
    // TODO: integrate real speech emotion model
    return {
      emotion: "neutral",
      confidence: 0.4,
      source: "speech",
      timestamp: Date.now(),
    };
  },
  async fromText(text): Promise<EmotionReading> {
    const match = HEURISTICS.find((h) => h.keyword.test(text));
    return {
      emotion: match?.emotion ?? "neutral",
      confidence: match ? 0.7 : 0.5,
      source: "text",
      timestamp: Date.now(),
    };
  },
  async fuse(readings): Promise<EmotionReading> {
    // TODO: real multimodal fusion
    const best = [...readings].sort((a, b) => b.confidence - a.confidence)[0];
    return { ...best, source: "multimodal" };
  },
};
