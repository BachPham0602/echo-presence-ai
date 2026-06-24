import type { PipelineState } from "@/types/pipeline";

interface StatusIndicatorProps {
  state: PipelineState;
  labelOverrides?: Partial<Record<PipelineState, string>>;
}


const LABELS: Record<PipelineState, string> = {
  idle: "Lumi đang ở đây với bạn",
  listening: "Đang lắng nghe…",
  detecting_addressee: "Đang lắng nghe…",
  transcribing: "Đang ghi lại lời bạn…",
  checking_speaker: "Đang nhận ra bạn…",
  detecting_emotion: "Đang cảm nhận…",
  thinking: "Đang suy nghĩ…",
  speaking: "Lumi đang trả lời",
  muted: "Đang tắt tiếng",
  error: "Có chút trục trặc nhỏ",
};

export function StatusIndicator({ state, labelOverrides }: StatusIndicatorProps) {
  const isActive =
    state === "listening" ||
    state === "detecting_addressee" ||
    state === "transcribing" ||
    state === "checking_speaker" ||
    state === "detecting_emotion" ||
    state === "thinking" ||
    state === "speaking";

  return (
    <div className="glass-pill flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-foreground/80">
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          state === "muted"
            ? "bg-muted-foreground/40"
            : state === "error"
              ? "bg-destructive"
              : "bg-primary"
        }`}
      >
        {isActive && <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />}
      </span>
      <span className="tracking-wide">{LABELS[state]}</span>
    </div>
  );
}
