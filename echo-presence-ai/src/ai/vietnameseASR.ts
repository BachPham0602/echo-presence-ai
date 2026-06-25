/**
 * Vietnamese Automatic Speech Recognition.
 *
 * Future candidates:
 *  - Whisper / Faster-Whisper
 *  - PhoWhisper
 *  - Wav2Vec2 Vietnamese
 *  - Other Vietnamese ASR models
 *
 * The architecture must allow swapping implementations behind this interface.
 */

export interface ASRPartial {
  text: string;
  isFinal: false;
}

export interface ASRFinal {
  text: string;
  isFinal: true;
  language: string;
  durationMs: number;
}

export type ASRResult = ASRPartial | ASRFinal;

export interface VietnameseASR {
  transcribe(audio: Float32Array): Promise<ASRFinal>;
  /** Optional streaming interface for realtime partials. */
  stream?(audio: AsyncIterable<Float32Array>): AsyncIterable<ASRResult>;
}

/** Mock ASR — returns a fixed transcript. */
export const mockVietnameseASR: VietnameseASR = {
  async transcribe(audio: Float32Array): Promise<ASRFinal> {
    // TODO: call real ASR (PhoWhisper / Whisper / Wav2Vec2)
    return {
      text: "Xin chào Lumi, hôm nay mình hơi mệt một chút.",
      isFinal: true,
      language: "vi",
      durationMs: Math.round((audio.length / 16000) * 1000),
    };
  },
};
