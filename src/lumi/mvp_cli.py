from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse

from lumi.config import LumiConfig
from lumi.errors import LumiProviderError
from lumi.mvp_pipeline import LumiMvpPipeline
from lumi.providers.asr import MicrophoneRecorder


def main() -> None:
    parser = argparse.ArgumentParser(description="Lumi MVP: nghe/nhập text -> phản hồi text + audio.")
    parser.add_argument("--input", choices=["text", "audio-file", "mic", "stream"], default="text")
    parser.add_argument("--audio", help="Đường dẫn audio khi --input audio-file.")
    parser.add_argument("--seconds", type=float, default=6.0, help="Số giây ghi âm khi --input mic.")
    parser.add_argument("--chunk-seconds", type=float, default=5.0, help="Độ dài mỗi chunk khi --input stream.")
    parser.add_argument("--max-chunks", type=int, default=None, help="Giới hạn số chunk stream, bỏ trống để chạy đến Ctrl+C.")
    parser.add_argument("--device", default=None, help="Input audio device index/name cho microphone, ví dụ --device 0.")
    parser.add_argument("--list-audio-devices", action="store_true", help="Liệt kê input audio devices rồi thoát.")
    parser.add_argument("--response-provider", choices=["qwen", "template"], default=None)
    parser.add_argument("--tts-provider", choices=["vieneu", "no-audio"], default=None)
    parser.add_argument("--asr-provider", choices=["phowhisper"], default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--cuda-visible-devices", default=None, help="GPU vật lý mà Lumi được phép thấy, mặc định 1. Ví dụ: 1 hoặc 1,2.")
    parser.add_argument("--once", help="Một câu text để chạy một lượt rồi thoát.")
    args = parser.parse_args()

    if args.list_audio_devices:
        try:
            print(MicrophoneRecorder.list_input_devices())
        except LumiProviderError as exc:
            raise SystemExit(f"Lỗi audio device: {exc}") from exc
        return

    config = _config_from_args(args)
    pipeline = LumiMvpPipeline(config)

    try:
        if args.input == "audio-file":
            if not args.audio:
                raise SystemExit("Thiếu --audio khi dùng --input audio-file.")
            _print_result(pipeline.handle_audio_file(args.audio))
            return

        if args.input == "mic":
            recorder = MicrophoneRecorder(config.output_path, device=_parse_audio_device(args.device))
            print(f"Đang ghi âm {args.seconds:.1f}s...")
            audio_path = recorder.record(args.seconds)
            print(f"Đã lưu input audio: {audio_path}")
            _print_result(pipeline.handle_audio_file(audio_path))
            return

        if args.input == "stream":
            _run_streaming_loop(pipeline, config, args.chunk_seconds, args.max_chunks, _parse_audio_device(args.device))
            return

        if args.once:
            _print_result(pipeline.handle_text(args.once))
            return

        print("Lumi MVP. Gõ :q để thoát.")
        while True:
            text = input("\nBạn: ").strip()
            if text == ":q":
                print("Lumi: Hẹn gặp lại bạn.")
                return
            if not text:
                continue
            _print_result(pipeline.handle_text(text))
    except LumiProviderError as exc:
        raise SystemExit(f"Lỗi provider model: {exc}") from exc


def _run_streaming_loop(
    pipeline: LumiMvpPipeline,
    config: LumiConfig,
    chunk_seconds: float,
    max_chunks: int | None,
    device: int | str | None,
) -> None:
    recorder = MicrophoneRecorder(config.output_path, device=device)
    print(
        "Streaming microphone theo chunk "
        f"{chunk_seconds:.1f}s. Nhấn Ctrl+C để dừng."
    )
    try:
        for index, audio_path in enumerate(recorder.stream_chunks(chunk_seconds, max_chunks), start=1):
            print()
            print(f"[chunk {index}] Đã lưu input audio: {audio_path}")
            result = pipeline.handle_audio_file(audio_path)
            if not result.input_text:
                print("Transcript rỗng, bỏ qua chunk này.")
                continue
            _print_result(result)
    except KeyboardInterrupt:
        print()
        print("Lumi: Đã dừng streaming. Hẹn gặp lại bạn.")


def _parse_audio_device(value: str | None) -> int | str | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return value


def _config_from_args(args) -> LumiConfig:
    base = LumiConfig.from_env()
    return LumiConfig(
        owner_name=base.owner_name,
        silence_seconds=base.silence_seconds,
        debug=base.debug,
        asr_model=base.asr_model,
        llm_model=base.llm_model,
        speaker_model=base.speaker_model,
        asr_provider=args.asr_provider or base.asr_provider,
        response_provider=args.response_provider or base.response_provider,
        tts_provider=args.tts_provider or base.tts_provider,
        tts_mode=base.tts_mode,
        tts_voice=base.tts_voice,
        llm_max_new_tokens=base.llm_max_new_tokens,
        llm_voice_max_new_tokens=base.llm_voice_max_new_tokens,
        llm_temperature=base.llm_temperature,
        llm_repetition_penalty=base.llm_repetition_penalty,
        llm_no_repeat_ngram_size=base.llm_no_repeat_ngram_size,
        output_dir=args.output_dir or base.output_dir,
        cuda_visible_devices=args.cuda_visible_devices if args.cuda_visible_devices is not None else base.cuda_visible_devices,
    )


def _print_result(result) -> None:
    if result.input_audio_path:
        print(f"Transcript: {result.input_text}")
    print(f"Lumi: {result.response_text}")
    if result.audio_path:
        print(f"Audio: {result.audio_path} ({result.tts_engine})")
    else:
        print(f"Audio: chưa sinh audio ({result.tts_engine})")


if __name__ == "__main__":
    main()
