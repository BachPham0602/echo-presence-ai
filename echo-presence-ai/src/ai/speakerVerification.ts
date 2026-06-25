/**
 * Speaker verification — tells main user from strangers.
 *
 * Future candidates:
 *  - ECAPA-TDNN
 *  - SpeechBrain
 *  - Resemblyzer
 *  - Pyannote
 *
 * Enrollment-based: the main user enrolls once, future audio is matched.
 */

import type { SpeakerProfile, SpeakerVerificationResult } from "@/types/speaker";

export interface SpeakerVerifier {
  enroll(audio: Float32Array, label: string): Promise<SpeakerProfile>;
  verify(audio: Float32Array, profiles: SpeakerProfile[]): Promise<SpeakerVerificationResult>;
}

/** Mock speaker verifier — always claims it's the main user. */
export const mockSpeakerVerifier: SpeakerVerifier = {
  async enroll(_audio, label) {
    // TODO: extract real embeddings via ECAPA-TDNN / Resemblyzer
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `spk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      id,
      label,
      embedding: [],
      enrolledAt: Date.now(),
    };
  },
  async verify(_audio, profiles) {
    if (profiles.length === 0) {
      return { identity: "unknown", similarity: 0 };
    }
    return {
      identity: "main_user",
      profileId: profiles[0].id,
      similarity: 0.92,
    };
  },
};
