# Kế hoạch 5 ngày

## Ngày 1 - Demo văn bản end-to-end

Mục tiêu: có một vòng hội thoại chạy được từ transcript đến response.

- Tạo pipeline interfaces.
- Làm addressee detection heuristic.
- Làm emotion heuristic.
- Làm response style của Lumi.
- CLI demo và test cơ bản.

Deliverable: `python -m lumi.demo_cli` chạy được.

## Ngày 2 - Audio input và VAD

Mục tiêu: thu được audio turn từ microphone.

- Thêm microphone capture.
- Gắn Silero VAD.
- Log speech start/end/silence.
- Lưu audio turn thành wav 16 kHz mono.

Deliverable: nói một câu, hệ thống cắt được audio segment ổn định.

## Ngày 3 - ASR tiếng Việt và turn-taking

Mục tiêu: transcript tiếng Việt đủ đúng để hội thoại.

- Gắn PhoWhisper batch trước, streaming sau nếu còn thời gian.
- Kết hợp punctuation + silence timer.
- Hiện debug: partial transcript, final transcript, turn decision.

Deliverable: user nói tiếng Việt, Lumi có transcript và biết đợi khi câu chưa xong.

## Ngày 4 - Speaker + emotion + LLM

Mục tiêu: Lumi phản hồi đúng người, đúng cảm xúc.

- Thử ECAPA-TDNN SpeechBrain cho speaker verification.
- Tạo enrollment flow: ghi 3 câu mẫu của chủ nhà.
- Thay emotion heuristic bằng LLM JSON prompt.
- Gắn Qwen2.5-7B-Instruct hoặc model nhẹ hơn nếu thiếu VRAM.

Deliverable: Lumi nhận ra chủ nhà và phản hồi đồng cảm theo cảm xúc.

## Ngày 5 - TTS, polish, fallback

Mục tiêu: demo có giọng nói và có fallback khi module thật lỗi.

- Gắn VieNeu-TTS.
- Thêm mode fallback: nếu TTS lỗi thì in text, nếu ASR lỗi thì cho nhập text.
- Chuẩn bị script demo 2-3 tình huống:
  - Gọi trực tiếp Lumi.
  - Nói một câu độc thoại và Lumi im lặng.
  - Người dùng nói mệt/cô đơn và Lumi đáp lại ấm áp.

Deliverable: demo 3 phút có audio output, log rõ ràng, và không sập khi model chậm.

## Stretch goals

- Ambient presence: Lumi có thể nói một câu ngắn sau khoảng im lặng dài, nếu người dùng đã opt-in.
- Memory nhẹ: ghi lại nickname, thói quen, chủ đề gần đây.
- Emotion smoothing: không đổi label quá nhanh sau một câu đơn lẻ.
