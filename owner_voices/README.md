# Owner voice profiles

Mỗi thư mục con là một người nói có thể chọn trong Voice Chat. Tên thư mục chính là tên Lumi dùng để gọi người đó.

Ví dụ:

```text
owner_voices/
  Minh/
    01.wav
    02.wav
    03.wav
  An/
    01.wav
    02.wav
```

Nên dùng 4-6 file WAV cho mỗi người, mỗi file khoảng 3-5 giây nói rõ, gần microphone, ít nhiễu. Tránh dùng câu quá ngắn hoặc file thu nhầm tiếng loa của Lumi.

Sau khi thêm hoặc đổi file mẫu, refresh trình duyệt để dropdown người nói cập nhật. Nếu bạn đổi biến `LUMI_OWNER_VOICE_DIR` thì restart web server.
