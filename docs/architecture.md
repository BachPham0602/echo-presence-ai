# Kiến trúc Lumi

## Nguyên tắc thiết kế

Lumi không phải voice command assistant. Mỗi module nên tối ưu cho cảm giác tự nhiên:

- Không bắt buộc wake word.
- Không chen ngang khi người dùng còn đang nói.
- Phản hồi ngắn, ấm, và có ngữ cảnh cảm xúc.
- Có thể im lặng khi câu nói không hướng tới Lumi.

## Luồng runtime

```text
microphone
  -> Silero VAD
  -> streaming ASR / PhoWhisper
  -> semantic turn-taking
  -> addressee detection
  -> speaker verification
  -> emotion classification
  -> empathetic LLM response
  -> Vietnamese TTS
  -> speaker
```

Bản scaffold hiện tại demo bằng transcript văn bản:

```text
text input
  -> turn-taking heuristic
  -> addressee heuristic
  -> speaker stub
  -> emotion heuristic
  -> response stub
  -> TTS stub
```

## Module contracts

### 1. VAD

Input: audio chunks.

Output: speech start/end events, silence duration, audio buffer.

Demo adapter:

- `speech_gap_seconds` trong CLI mô phỏng khoảng lặng.

Production adapter:

- Silero VAD cho speech activity.
- Để sample rate 16 kHz cho VAD/ASR/speaker verification.
- Dùng hysteresis: cần 2-3 frame speech mới bắt đầu, cần silence liên tục mới kết thúc.

### 2. Semantic turn-taking

Input: partial/final transcript, silence duration, punctuation.

Output:

- `is_complete`: người dùng đã hết lượt nói hay chưa.
- `confidence`: độ tin cậy.
- `reason`: lý do để debug demo.

Rule demo hiện tại:

- Có dấu kết thúc `.`, `?`, `!` thì xem là complete.
- Silence >= 1.5s và câu có ít nhất 2 từ thì xem là complete, trừ khi kết thúc bằng từ nối.
- Câu kết thúc bằng từ nối như `nhưng`, `và`, `vì` thì tiếp tục chờ.

### 3. Addressee detection

Input: transcript + conversation history.

Output:

- `addressed`: người dùng đang nói với Lumi hay không.
- `confidence`.
- `reason`.

Production nên dùng LLM prompt bắt JSON, không cần train model riêng. Context cần có:

- Last Lumi message.
- Last user transcript.
- Acoustic cue nếu có: distance, volume, speaker id.
- App state: Lumi đang hỏi người dùng câu nào không.

### 4. Speaker verification

Input: audio turn.

Output:

- `speaker_id`.
- `verified`.
- `confidence`.

Khuyến nghị cho demo: ECAPA-TDNN SpeechBrain. Resemblyzer dễ dùng, nhưng ECAPA mạnh hơn cho verification và có API rõ hơn cho cosine scoring.

### 5. Emotion recognition

Input: transcript + recent context.

Output:

- label: `vui`, `buồn`, `mệt`, `cô_đơn`, `căng_thẳng`, `bình_yên`, `trung_tính`.
- confidence.
- short evidence.

Production nên dùng LLM prompt bắt JSON và chấp nhận multi-label khi cần.

### 6. Empathetic response LLM

Input:

- conversation history.
- emotion label.
- whether user addressed Lumi.
- optional speaker identity and memory snippets.

Output:

- text response.
- optional intent: `comfort`, `ask_followup`, `celebrate`, `grounding`, `silent`.

### 7. TTS

Input: response text.

Output: waveform path/bytes.

VieNeu-TTS là ứng viên tốt nếu cần miễn phí/offline. Lưu ý version v2 là 24 kHz, v3 Turbo đang preview có 48 kHz.

## Latency budget

Để demo nghe tự nhiên:

- VAD frame: 30-100 ms.
- ASR partial: 500-1200 ms.
- Turn-taking final wait: 700-1500 ms.
- LLM response: < 2500 ms với quantized local model.
- TTS: < 2000 ms cho câu ngắn.

Nếu latency vượt 5 giây, demo sẽ có cảm giác "máy đang xử lý" thay vì có người đang ở nhà.
