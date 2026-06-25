from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse

from lumi.config import LumiConfig
from lumi.pipeline import LumiPipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="Chạy demo pipeline văn bản của Lumi.")
    parser.add_argument("--gap", type=float, default=None, help="Khoảng lặng mô phỏng, tính bằng giây.")
    args = parser.parse_args()

    config = LumiConfig.from_env()
    pipeline = LumiPipeline(config)

    print("Demo văn bản Lumi. Gõ :q để thoát, :history để xem lịch sử gần đây.")
    print("Mẹo: thử 'Lumi ơi, hôm nay mình thấy hơi cô đơn.'")

    while True:
        try:
            text = input("\nBạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nLumi: Hẹn gặp lại bạn.")
            return

        if text == ":q":
            print("Lumi: Hẹn gặp lại bạn.")
            return

        if text == ":history":
            _print_history(pipeline.history)
            continue

        result = pipeline.process_transcript(text, speech_gap_seconds=args.gap)
        _print_result(result, debug=config.debug)


def _print_history(history: list[dict[str, str]]) -> None:
    if not history:
        print("Lịch sử đang trống.")
        return
    for item in history[-8:]:
        print(f"{item['role']}: {item['content']}")


def _print_result(result, debug: bool) -> None:
    if debug:
        print(f"[turn] complete={result.turn.is_complete} confidence={result.turn.confidence:.2f} reason={result.turn.reason}")
        if result.addressee:
            print(
                "[addressee] "
                f"addressed={result.addressee.addressed} "
                f"confidence={result.addressee.confidence:.2f} "
                f"reason={result.addressee.reason}"
            )
        if result.emotion:
            print(
                "[emotion] "
                f"label={result.emotion.label} "
                f"confidence={result.emotion.confidence:.2f} "
                f"evidence={result.emotion.evidence}"
            )

    if result.action == "wait":
        print("Lumi: ...")
    elif result.action == "ignore":
        print("Lumi: (im lặng)")
    elif result.response:
        print(f"Lumi: {result.response.text}")


if __name__ == "__main__":
    main()
