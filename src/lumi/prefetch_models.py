from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse
from pathlib import Path

from lumi.config import DEFAULT_EMOTION_LOCAL_DIR, DEFAULT_EMOTION_REPO_ID, LumiConfig
from lumi.errors import MissingDependencyError
from lumi.providers.tts import create_tts_provider


def main() -> None:
    parser = argparse.ArgumentParser(description="Tải trước model Lumi vào local cache.")
    parser.add_argument("--asr", action="store_true", help="Tải trước PhoWhisper ASR model.")
    parser.add_argument("--llm", action="store_true", help="Tải trước Qwen LLM model.")
    parser.add_argument("--tts", action="store_true", help="Khởi tạo provider TTS hiện tại để SDK tự tải cache nếu cần.")
    parser.add_argument("--emotion", action="store_true", help="Tải trước emotion classifier HuggingFace.")
    parser.add_argument("--all", action="store_true", help="Tải trước ASR + LLM + emotion, và thử khởi tạo TTS.")
    parser.add_argument("--local-files-only", action="store_true", help="Chỉ kiểm tra cache local, không tải internet.")
    parser.add_argument(
        "--emotion-local-dir",
        default=str(DEFAULT_EMOTION_LOCAL_DIR),
        help="Tải/copy emotion model vào thư mục cố định. Mặc định là models/emotion/tabularisai-multilingual-emotion-classification.",
    )
    args = parser.parse_args()

    if not any([args.asr, args.llm, args.tts, args.emotion, args.all]):
        args.all = True

    config = LumiConfig.from_env()
    config.apply_cuda_visible_devices()

    if args.all or args.asr:
        _snapshot_download(config.asr_model, "ASR/PhoWhisper", args.local_files_only)

    if args.all or args.llm:
        _snapshot_download(config.llm_model, "LLM/Qwen", args.local_files_only)

    if args.all or args.tts:
        _warm_tts(config)

    if args.all or args.emotion:
        emotion_source = config.emotion_model
        if Path(emotion_source).expanduser().exists():
            emotion_source = DEFAULT_EMOTION_REPO_ID
        emotion_path = _snapshot_download(
            emotion_source,
            "Emotion/HF",
            args.local_files_only,
            local_dir=args.emotion_local_dir,
        )
        print(f"Emotion model local sẵn sàng tại: {emotion_path}")

    print("Prefetch hoàn tất.")
    print("Cache Hugging Face mặc định nằm ở ~/.cache/huggingface/hub, trừ khi bạn đặt HF_HOME/HUGGINGFACE_HUB_CACHE.")


def _snapshot_download(repo_id: str, label: str, local_files_only: bool, local_dir: str | None = None) -> str:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise MissingDependencyError(
            "Prefetch cần huggingface_hub. Cài bằng: pip install huggingface_hub hoặc pip install -e '.[llm,asr]'"
        ) from exc

    repo_path = Path(repo_id).expanduser()
    if repo_path.exists():
        print(f"[{label}] local path đã tồn tại: {repo_path}")
        return str(repo_path)

    mode = "kiểm tra cache" if local_files_only else "tải/cache"
    target = f" -> {local_dir}" if local_dir else ""
    print(f"[{label}] {mode}: {repo_id}{target}")
    kwargs = {"repo_id": repo_id, "local_files_only": local_files_only}
    if local_dir:
        kwargs["local_dir"] = str(Path(local_dir))
    path = snapshot_download(**kwargs)
    print(f"[{label}] local path: {path}")
    return str(path)


def _warm_tts(config: LumiConfig) -> None:
    provider = create_tts_provider(config)
    provider_name = getattr(provider, 'provider_name', config.tts_provider)
    print(f"[TTS/{provider_name}] khởi tạo provider để kiểm tra dependency/cache nếu cần.")

    load_engine = getattr(provider, '_load_engine', None)
    if callable(load_engine):
        try:
            load_engine()
        except MissingDependencyError:
            raise
        except Exception as exc:
            raise MissingDependencyError(
                f"Không khởi tạo được provider TTS '{provider_name}'. Lỗi gốc: {exc}"
            ) from exc
        print(f"[TTS/{provider_name}] engine đã khởi tạo.")
        return

    print(f"[TTS/{provider_name}] provider này không cần warm-up model riêng.")


if __name__ == "__main__":
    main()
