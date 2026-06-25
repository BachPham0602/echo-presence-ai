import type { LumiExpression, UserEmotion } from "./emotion";

/**
 * Centralized pipeline states for the Lumi voice companion.
 * UI and face expressions react automatically to these states.
 */
export type PipelineState =
  | "idle"
  | "listening"
  | "detecting_addressee"
  | "transcribing"
  | "checking_speaker"
  | "detecting_emotion"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";

export interface PipelineSnapshot {
  state: PipelineState;
  expression: LumiExpression;
  lastUserEmotion?: UserEmotion;
  lastTranscript?: string;
  lastResponse?: string;
  error?: string;
}

/** Default mapping from pipeline state to face expression. */
export function expressionForState(state: PipelineState): LumiExpression {
  switch (state) {
    case "idle":
      return "idle";
    case "listening":
    case "detecting_addressee":
    case "checking_speaker":
      return "listening";
    case "transcribing":
    case "detecting_emotion":
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "muted":
      return "sleepy";
    case "error":
      return "confused";
    default:
      return "idle";
  }
}

export interface ChatMessage {
  id: string;
  role: "user" | "lumi";
  content: string;
  timestamp: number;
}
