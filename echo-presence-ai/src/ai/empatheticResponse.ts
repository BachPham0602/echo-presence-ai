/**
 * Empathetic response generation.
 *
 * Produces short, natural, emotionally warm Vietnamese responses.
 *
 * Future model candidates:
 *  - Qwen
 *  - Gemma
 *  - Llama
 *  - Vietnamese-tuned LLMs
 *
 * Architecture must support both local and API-hosted models behind one interface.
 */

import type { UserEmotion } from "@/types/emotion";

export interface EmpatheticRequest {
  userText: string;
  userEmotion?: UserEmotion;
  history?: Array<{ role: "user" | "lumi"; content: string }>;
}

export interface EmpatheticResponse {
  text: string;
  /** Suggested vocal tone for TTS, e.g. "warm", "gentle", "playful". */
  tone?: string;
}

export interface EmpatheticLLM {
  generate(request: EmpatheticRequest): Promise<EmpatheticResponse>;
}

const FALLBACKS: Record<UserEmotion, string> = {
  happy: "Nghe bạn vui mình cũng vui lây đó. Kể mình nghe thêm đi nha.",
  sad: "Mình ở đây với bạn. Cứ chậm rãi, không vội gì đâu.",
  lonely: "Có mình bên cạnh rồi. Mình lắng nghe bạn nè.",
  stressed: "Hít thở một hơi sâu nha. Mình ở đây, mọi chuyện sẽ ổn thôi.",
  tired: "Bạn nghỉ một chút đi. Mình sẽ ở đây khi bạn quay lại.",
  neutral: "Mình vẫn đang ở đây với bạn. Bạn muốn chia sẻ thêm điều gì không?",
};

/** Mock empathetic LLM — picks a warm Vietnamese phrase by detected emotion. */
export const mockEmpatheticLLM: EmpatheticLLM = {
  async generate({ userEmotion = "neutral" }): Promise<EmpatheticResponse> {
    // TODO: replace with real LLM call (Qwen / Gemma / Llama / VN model)
    return { text: FALLBACKS[userEmotion], tone: "warm" };
  },
};
