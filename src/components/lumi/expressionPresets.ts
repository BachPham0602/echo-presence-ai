import type { LumiExpression } from "@/types/emotion";

export type KawaiiExpression =
  | "neutral"
  | "happy"
  | "excited"
  | "playful"
  | "sad"
  | "worried"
  | "sleepy"
  | "thinking"
  | "surprised"
  | "wink";

export type EyeShape =
  | "round" // tall sparkly oval
  | "sparkle" // tall oval with extra shimmer
  | "wide" // surprised — extra tall + wide
  | "smile" // closed upward arc ^^
  | "wink-left" // left closed, right round
  | "half" // sleepy half-lid arc
  | "soft" // calm slightly smaller oval
  | "worried"; // angled slanted shape (\ /)

export type MouthShape =
  | "smile-small"
  | "smile-open"
  | "smile-big"
  | "smile-double" // two little arcs side by side (happy)
  | "tongue"
  | "frown"
  | "relaxed"
  | "uncertain"
  | "wavy" // worried squiggle
  | "ohh"; // surprised oval

export type BrowShape = "none" | "raised-left" | "soft-down" | "soft-up";

export interface ExpressionPreset {
  leftEye: EyeShape;
  rightEye: EyeShape;
  mouth: MouthShape;
  brow: BrowShape;
  blush: number; // 0..1
}

export const KAWAII_PRESETS: Record<KawaiiExpression, ExpressionPreset> = {
  neutral: { leftEye: "soft", rightEye: "soft", mouth: "smile-small", brow: "soft-up", blush: 0.5 },
  happy: { leftEye: "smile", rightEye: "smile", mouth: "smile-double", brow: "soft-up", blush: 0.9 },
  excited: { leftEye: "sparkle", rightEye: "sparkle", mouth: "smile-big", brow: "soft-up", blush: 0.95 },
  playful: { leftEye: "smile", rightEye: "round", mouth: "tongue", brow: "soft-up", blush: 0.9 },
  sad: { leftEye: "round", rightEye: "round", mouth: "frown", brow: "soft-down", blush: 0.45 },
  worried: { leftEye: "worried", rightEye: "worried", mouth: "wavy", brow: "soft-down", blush: 0.55 },
  sleepy: { leftEye: "half", rightEye: "half", mouth: "relaxed", brow: "soft-up", blush: 0.55 },
  thinking: { leftEye: "soft", rightEye: "round", mouth: "uncertain", brow: "raised-left", blush: 0.5 },
  surprised: { leftEye: "wide", rightEye: "wide", mouth: "ohh", brow: "soft-up", blush: 0.75 },
  wink: { leftEye: "round", rightEye: "smile", mouth: "smile-open", brow: "soft-up", blush: 0.85 },
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
      return "worried";
    case "sleepy":
      return "sleepy";
    case "thinking":
      return "thinking";
    case "confused":
      return "surprised";
    case "speaking":
      return "happy";
    case "listening":
      return "playful";
    case "idle":
    default:
      return "neutral";
  }
}
