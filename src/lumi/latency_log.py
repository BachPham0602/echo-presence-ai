from __future__ import annotations

import time
from datetime import datetime
from typing import Any


def format_wall_time(when: datetime | None = None) -> str:
    """Wall-clock timestamp with millisecond precision (HH:MM:SS.mmm)."""
    moment = when or datetime.now()
    return moment.strftime("%H:%M:%S.%f")[:-3]


class ModelTimer:
    """Log wall-clock start/end for one model inference call."""

    def __init__(self, model: str, method: str | None = None, detail: str | None = None):
        self.model = model
        self.method = method
        self.detail = detail
        self.start_ts = ""
        self.end_ts = ""
        self.duration_ms = 0.0
        self._t0 = 0.0

    @property
    def label(self) -> str:
        if self.method:
            return f"{self.model}/{self.method}"
        return self.model

    def __enter__(self) -> ModelTimer:
        self._t0 = time.perf_counter()
        self.start_ts = format_wall_time()
        extra = f" detail='{self.detail[:80]}'" if self.detail else ""
        print(f"[MODEL] {self.label} start={self.start_ts}{extra}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.end_ts = format_wall_time()
        self.duration_ms = (time.perf_counter() - self._t0) * 1000.0
        status = "error" if exc_type else "ok"
        print(
            f"[MODEL] {self.label} | {self.start_ts} → {self.end_ts} "
            f"({self.duration_ms:.0f}ms) status={status}"
        )
        return False

    def as_dict(self) -> dict[str, Any]:
        return {
            "model": self.label,
            "start": self.start_ts,
            "end": self.end_ts,
            "duration_ms": round(self.duration_ms, 1),
        }


class LatencyTimer:
    """Lightweight stage timer for pipeline latency breakdown."""

    def __init__(self, label: str):
        self.label = label
        self._t0 = time.perf_counter()
        self._last = self._t0
        self.stages: dict[str, float] = {}

    def mark(self, stage: str) -> float:
        now = time.perf_counter()
        delta_ms = (now - self._last) * 1000.0
        self.stages[stage] = delta_ms
        self._last = now
        return delta_ms

    @property
    def total_ms(self) -> float:
        return (time.perf_counter() - self._t0) * 1000.0

    def summary(self) -> dict[str, Any]:
        total = self.total_ms
        stages = dict(self.stages)
        accounted = sum(stages.values())
        return {
            "label": self.label,
            "total_ms": round(total, 1),
            "stages_ms": {k: round(v, 1) for k, v in stages.items()},
            "unaccounted_ms": round(max(0.0, total - accounted), 1),
        }

    def log(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = self.summary()
        if extra:
            payload.update(extra)
        parts = [f"{k}={v}ms" for k, v in payload.get("stages_ms", {}).items()]
        tail = " ".join(parts)
        print(
            f"[LATENCY] {payload['label']} total={payload['total_ms']:.0f}ms"
            + (f" | {tail}" if tail else "")
            + (f" | {extra}" if extra else "")
        )
        return payload
