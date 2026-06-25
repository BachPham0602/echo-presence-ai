/**
 * Semantic Voice Activity Detection / turn taking.
 *
 * Decides whether the user has finished their turn, is still speaking,
 * or is producing a backchannel ("uh-huh", "mmm").
 *
 * Future implementations should be easily swappable.
 */

export type TurnState = "complete" | "incomplete" | "backchannel" | "wait";

export interface TurnDecision {
  state: TurnState;
  confidence: number;
}

export interface SemanticVAD {
  evaluate(input: {
    audio?: Float32Array;
    partialTranscript?: string;
    silenceMs?: number;
  }): Promise<TurnDecision>;
}

/** Mock VAD — assumes the turn completes after ~800ms silence. */
export const mockSemanticVAD: SemanticVAD = {
  async evaluate({ silenceMs = 0 }) {
    if (silenceMs > 800) return { state: "complete", confidence: 0.7 };
    return { state: "incomplete", confidence: 0.6 };
  },
};
