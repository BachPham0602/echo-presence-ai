import type { BrowShape } from "./expressionPresets";

interface LumiEyebrowProps {
  side: "left" | "right";
  cx: number;
  cy: number;
  shape: BrowShape;
}

const DARK = "#020617";

export function LumiEyebrow({ side, cx, cy, shape }: LumiEyebrowProps) {
  if (shape === "none") return null;
  const w = 46;
  let d = "";

  if (shape === "raised-left") {
    d = side === "left"
      ? `M ${cx - w / 2} ${cy + 4} Q ${cx} ${cy - 14} ${cx + w / 2} ${cy + 2}`
      : `M ${cx - w / 2} ${cy + 2} Q ${cx} ${cy - 4} ${cx + w / 2} ${cy + 2}`;
  } else if (shape === "soft-down") {
    // worried/sad: inner end up, outer end down
    d = side === "left"
      ? `M ${cx - w / 2} ${cy + 12} Q ${cx} ${cy + 2} ${cx + w / 2} ${cy - 6}`
      : `M ${cx - w / 2} ${cy - 6} Q ${cx} ${cy + 2} ${cx + w / 2} ${cy + 12}`;
  } else if (shape === "soft-up") {
    d = `M ${cx - w / 2} ${cy + 4} Q ${cx} ${cy - 10} ${cx + w / 2} ${cy + 4}`;
  }

  return (
    <path
      d={d}
      stroke={DARK}
      strokeWidth={6}
      strokeLinecap="round"
      fill="none"
    />
  );
}
