/**
 * Wake-word-free addressee detection.
 *
 * Goal: decide whether the user is talking to Lumi without requiring a wake word.
 *
 * Future candidates:
 *  - Diarization-based detection
 *  - Addressee classification models
 *  - Camera-assisted gaze / attention detection
 *
 * Must support realtime streaming input.
 */

export interface AddresseeSignal {
  /** Raw audio chunk (PCM/Float32) — placeholder type for now. */
  audio?: Float32Array;
  /** Optional camera frame for gaze detection. */
  videoFrame?: ImageBitmap;
  timestamp: number;
}

export interface AddresseeDecision {
  isAddressingLumi: boolean;
  confidence: number; // 0..1
}

export interface AddresseeDetector {
  detect(signal: AddresseeSignal): Promise<AddresseeDecision>;
}

/**
 * Mock implementation — always says "yes, talking to Lumi".
 * TODO: replace with a real diarization + addressee classifier.
 */
export const mockAddresseeDetector: AddresseeDetector = {
  async detect(_signal: AddresseeSignal): Promise<AddresseeDecision> {
    return { isAddressingLumi: true, confidence: 0.5 };
  },
};
