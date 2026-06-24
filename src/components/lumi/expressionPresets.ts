import type { LumiExpression } from "@/types/emotion";

export type KawaiiExpression =
  | "neutral"
  | "happy"
  | "excited"
  | "playful"
  | "sad"
  | "sleepy"
  | "thinking";

export type EyeShape =
  | "round" // big shiny circle
  | "sparkle" // big with watery sparkle
  | "smile" // closed upward arc ^^
  | "wink-left" // left closed, right round
  | "half" // sleepy half-lid
  | "soft"; // calm slightly squinted

export type MouthShape =
  | "smile-small"
  | "smile-open"
  | "smile-big"
  | "tongue"
  | "frown"
  | "relaxed"
  | "uncertain";

export type BrowShape = "none" | "raised-left" | "soft-down" | "soft-up";

export interface ExpressionPreset {
  leftEye: EyeShape;
  rightEye: EyeShape;
  mouth: MouthShape;
  brow: BrowShape;
  blush: number; // 0..1 intensity
}

export const KAWAII_PRESETS: Record<KawaiiExpression, ExpressionPreset> = {
  neutral: { leftEye: "soft", rightEye: "soft", mouth: "smile-small", brow: "none", blush: 0.45 },
  happy: { leftEye: "smile", rightEye: "smile", mouth: "smile-open", brow: "none", blush: 0.85 },
  excited: { leftEye: "sparkle", rightEye: "sparkle", mouth: "smile-big", brow: "soft-up", blush: 0.9 },
  playful: { leftEye: "wink-left", rightEye: "round", mouth: "tongue", brow: "none", blush: 0.85 },
  sad: { leftEye: "sparkle", rightEye: "sparkle", mouth: "frown", brow: "soft-down", blush: 0.4 },
  sleepy: { leftEye: "half", rightEye: "half", mouth: "relaxed", brow: "none", blush: 0.5 },
  thinking: { leftEye: "soft", rightEye: "round", mouth: "uncertain", brow: "raised-left", blush: 0.45 },
};

export function kawaiiFromLumiExpression(e: LumiExpression): KawaiiExpression {
  switch (e) {
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "sad":
      return "sad";
    case "concerned":
      return "sad";
    case "sleepy":
      return "sleepy";
    case "thinking":
      return "thinking";
    case "confused":
      return "thinking";
    case "speaking":
      return "happy";
    case "listening":
      return "playful";
    case "idle":
    default:
      return "neutral";
  }
}
