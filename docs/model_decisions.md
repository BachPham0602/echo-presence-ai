# Quyết định model

## VAD: Silero VAD

Nên dùng. Lý do:

- Nhẹ, chạy CPU tốt.
- Hỗ trợ 8 kHz và 16 kHz.
- License MIT.
- Phù hợp để cắt audio turn trước ASR.

Implementation note:

- Ưu tiên ONNX runtime nếu cần deploy nhẹ.
- Dùng 16 kHz mono để đồng bộ với ASR/speaker verification.

## Addressee detection: LLM over transcript

Dùng LLM prompt, không train model riêng.

Output nên bắt JSON:

```json
{
  "addressed": true,
  "confidence": 0.86,
  "reason": "Người dùng gọi Lumi bằng tên và hỏi trực tiếp."
}
```

Trong hackathon, heuristic là đủ để demo, sau đó thay bằng Qwen prompt.

## Semantic VAD / turn-taking

Dùng hybrid:

- Silero silence timer.
- Whisper/PhoWhisper punctuation.
- Text rule cho unfinished phrase.

Không nên chỉ dựa vào silence. Người nói tiếng Việt hay ngắt nhịp khi nghĩ, nếu chỉ dùng 1.5s silence sẽ dễ cắt ngang câu.

## ASR: PhoWhisper

Dùng PhoWhisper cho Vietnamese ASR. Model `vinai/PhoWhisper-large` có license BSD-3-Clause và được fine-tune cho tiếng Việt.

Rủi ro:

- Bản `large` có thể nặng cho laptop.
- Streaming không phải flow mặc định của Transformers pipeline.

Fallback:

- Bắt đầu với batch per-turn audio.
- Nếu latency cao, thử model nhỏ hơn trong family PhoWhisper.

## Speaker verification: ECAPA-TDNN vs Resemblyzer

Khuyến nghị: **ECAPA-TDNN SpeechBrain** cho demo nghiêm túc.

Lý do:

- Model card nêu rõ speaker verification/identification.
- API verification và embedding rõ.
- License Apache-2.0.
- Performance reference trên VoxCeleb1 cleaned EER 0.80%.

Dùng Resemblyzer nếu:

- Cần cài đặt nhanh và API rất đơn giản.
- Speaker verification chỉ là tính năng phụ trong demo.

Threshold plan:

- Enrollment: 3 mẫu giọng của chủ nhà, mỗi mẫu 5-10 giây.
- Runtime: cosine score với centroid.
- Ban đầu log score thay vì hard reject, sau đó chốt threshold bằng dữ liệu demo.

## Emotion recognition: LLM prompt

Dùng LLM prompt cho transcript. Không cần model riêng trong 5 ngày.

Output nên bắt JSON:

```json
{
  "label": "cô_đơn",
  "confidence": 0.78,
  "evidence": "Người dùng nói họ thấy cô đơn tối nay."
}
```

Giữ label nhỏ:

- `vui`
- `buồn`
- `mệt`
- `cô_đơn`
- `căng_thẳng`
- `bình_yên`
- `trung_tính`

## LLM response: Qwen2.5-7B-Instruct

Dùng nếu local hardware chịu được. Model card yêu cầu Transformers mới và có context window mặc định 32k tokens. Nếu thiếu GPU, dùng quantized runtime qua Ollama/llama.cpp/LM Studio.

Response style:

- 1-3 câu ngắn.
- Xác nhận cảm xúc trước.
- Hỏi một câu mở nhẹ nếu phù hợp.
- Không biến thành command assistant.

## TTS: VieNeu-TTS

Dùng VieNeu-TTS như ứng viên Vietnamese offline/free.

Lưu ý:

- v2 README nói high-quality 24 kHz.
- v3 Turbo preview nói 48 kHz, default voices, emotion/non-verbal cues experimental.
- Nếu demo cần ổn định, chốt một version trước ngày 5 và không đổi vào sát giờ.

Fallback:

- Nếu TTS setup chậm, dùng text output + pre-rendered wav cho 2-3 câu demo chính.
