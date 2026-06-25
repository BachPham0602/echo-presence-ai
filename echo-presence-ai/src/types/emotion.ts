/**
 * Emotion types for Lumi's expression system and user emotion detection.
 */

export type LumiExpression =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "happy"
  | "sad"
  | "concerned"
  | "sleepy"
  | "excited"
  | "confused";

export type UserEmotion = "happy" | "sad" | "lonely" | "stressed" | "tired" | "neutral";

export interface EmotionReading {
  emotion: UserEmotion;
  confidence: number; // 0..1
  source: "speech" | "text" | "multimodal";
  timestamp: number;
}

/** Maps a user's detected emotion to the appropriate Lumi expression. */
export function expressionForUserEmotion(emotion: UserEmotion): LumiExpression {
  switch (emotion) {
    case "happy":
      return "happy";
    case "sad":
    case "lonely":
      return "concerned";
    case "stressed":
      return "concerned";
    case "tired":
      return "sleepy";
    case "neutral":
    default:
      return "idle";
  }
}
