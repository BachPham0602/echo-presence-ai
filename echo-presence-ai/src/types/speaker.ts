/**
 * Speaker identity types for speaker verification.
 */

export type SpeakerIdentity = "main_user" | "stranger" | "unknown";

export interface SpeakerProfile {
  id: string;
  label: string;
  /** Placeholder embedding vector — real model fills this in. */
  embedding: number[];
  enrolledAt: number;
}

export interface SpeakerVerificationResult {
  identity: SpeakerIdentity;
  profileId?: string;
  similarity: number; // 0..1
}
