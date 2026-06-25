import type { LumiExpression } from "@/types/emotion";

/**
 * Canonical expression names sourced from `kawaii_faces.svg`.
 * Each name corresponds to one face tile in the reference grid.
 */
export type ExpressionName =
  | "neutral"
  | "listening"
  | "speaking"
  | "thinking"
  | "happy"
  | "excited"
  | "laughing"
  | "playful"
  | "sad"
  | "angry"
  | "surprised";

let current: ExpressionName = "neutral";
const listeners = new Set<(name: ExpressionName) => void>();

export function setExpression(name: ExpressionName) {
  current = name;
  listeners.forEach((l) => l(name));
}

export function getExpression(): ExpressionName {
  return current;
}

export function subscribeExpression(listener: (name: ExpressionName) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Map Lumi's internal pipeline expression to a kawaii reference expression. */
export function expressionFromLumi(e: LumiExpression): ExpressionName {
  switch (e) {
    case "idle":
      return "neutral";
    case "listening":
      return "playful";
    case "speaking":
      return "speaking";
    case "thinking":
      return "thinking";
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "sad":
      return "sad";
    case "concerned":
      return "angry";
    case "confused":
      return "surprised";
    case "sleepy":
      return "neutral";
    default:
      return "neutral";
  }
}
