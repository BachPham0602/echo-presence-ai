import type { BrowShape } from "./expressionPresets";

interface LumiEyebrowProps {
  side: "left" | "right";
  cx: number;
  cy: number; // baseline y above the eye
  shape: BrowShape;
}

/**
 * Expressive eyebrow. The "raised-left" shape lifts only the left brow
 * (used for the "thinking" preset); "soft-down" sad-tilts the inner end
 * up; "soft-up" gives a cheerful arched lift.
 */
export function LumiEyebrow({ side, cx, cy, shape }: LumiEyebrowProps) {
  if (shape === "none") return null;
  const stroke = "oklch(0.97 0.02 240)";

  const w = 80;
  let d = "";

  if (shape === "raised-left") {
    if (side === "left") {
      // arched up
      d = `M ${cx - w / 2} ${cy + 8} Q ${cx} ${cy - 26} ${cx + w / 2} ${cy + 4}`;
    } else {
      // flat soft curve
      d = `M ${cx - w / 2} ${cy + 4} Q ${cx} ${cy - 6} ${cx + w / 2} ${cy + 4}`;
    }
  } else if (shape === "soft-down") {
    // inner end up, outer end down — concerned/sad
    if (side === "left") {
      d = `M ${cx - w / 2} ${cy + 16} Q ${cx} ${cy + 4} ${cx + w / 2} ${cy - 8}`;
    } else {
      d = `M ${cx - w / 2} ${cy - 8} Q ${cx} ${cy + 4} ${cx + w / 2} ${cy + 16}`;
    }
  } else if (shape === "soft-up") {
    // cheerful arch up on both sides
    d = `M ${cx - w / 2} ${cy + 6} Q ${cx} ${cy - 16} ${cx + w / 2} ${cy + 6}`;
  }

  return (
    <path
      d={d}
      stroke={stroke}
      strokeWidth={10}
      strokeLinecap="round"
      fill="none"
      filter="url(#kawaii-glow)"
    />
  );
}
