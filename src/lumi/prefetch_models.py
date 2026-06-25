from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse
from pathlib import Path

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError


def main() -> None:
    parser = argparse.ArgumentParser(description="Tải trước model Lumi vào local cache.")
    parser.add_argument("--asr", action="store_true", help="Tải trước PhoWhisper ASR model.")
    parser.add_argument("--llm", action="store_true", help="Tải trước Qwen LLM model.")
    parser.add_argument("--tts", action="store_true", help="Khởi tạo VieNeu-TTS để SDK tự tải cache nếu cần.")
    parser.add_argument("--all", action="store_true", help="Tải trước ASR + LLM, và thử khởi tạo TTS.")
    parser.add_argument("--local-files-only", action="store_true", help="Chỉ kiểm tra cache local, không tải internet.")
    args = parser.parse_args()

    if not any([args.asr, args.llm, args.tts, args.all]):
        args.all = True

    config = LumiConfig.from_env()
    config.apply_cuda_visible_devices()

    if args.all or args.asr:
        _snapshot_download(config.asr_model, "ASR/PhoWhisper", args.local_files_only)

    if args.all or args.llm:
        _snapshot_download(config.llm_model, "LLM/Qwen", args.local_files_only)

    if args.all or args.tts:
        _warm_tts(config)

    print("Prefetch hoàn tất.")
    print("Cache Hugging Face mặc định nằm ở ~/.cache/huggingface/hub, trừ khi bạn đặt HF_HOME/HUGGINGFACE_HUB_CACHE.")


def _snapshot_download(repo_id: str, label: str, local_files_only: bool) -> None:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise MissingDependencyError(
            "Prefetch cần huggingface_hub. Cài bằng: pip install huggingface_hub hoặc pip install -e '.[llm,asr]'"
        ) from exc

    mode = "kiểm tra cache" if local_files_only else "tải/cache"
    print(f"[{label}] {mode}: {repo_id}")
    path = snapshot_download(repo_id=repo_id, local_files_only=local_files_only)
    print(f"[{label}] local path: {path}")


def _warm_tts(config: LumiConfig) -> None:
    print("[TTS/VieNeu] khởi tạo engine để SDK tự tải/cache nếu cần.")
    try:
        from lumi.providers.tts import VieNeuTTS

        VieNeuTTS(config)._load_engine()
    except MissingDependencyError:
        raise
    except Exception as exc:
        raise MissingDependencyError(
            "Không khởi tạo được VieNeu-TTS. Kiểm tra package vieneu và model TTS. "
            f"Lỗi gốc: {exc}"
        ) from exc
    print("[TTS/VieNeu] engine đã khởi tạo.")


if __name__ == "__main__":
    main()
