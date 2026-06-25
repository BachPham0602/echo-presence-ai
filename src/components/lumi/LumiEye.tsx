import type { EyeShape } from "./expressionPresets";

interface LumiEyeProps {
  cx: number;
  cy: number;
  shape: EyeShape;
  side: "left" | "right";
  blink?: boolean;
}

const DARK = "#020617";

/**
 * Vector-style kawaii eye. Filled dark shapes (#020617) with crisp white
 * highlights — matches the reference SVG sheet (round / sparkle / wide /
 * smile / wink / half / soft / worried).
 */
export function LumiEye({ cx, cy, shape, side, blink }: LumiEyeProps) {
  const effective: EyeShape = blink ? "smile" : shape;

  switch (effective) {
    case "smile":
      return <ArcEye cx={cx} cy={cy} direction="up" />;
    case "half":
      return <ArcEye cx={cx} cy={cy + 4} direction="down" />;
    case "wink-left":
      return side === "left" ? (
        <ArcEye cx={cx} cy={cy} direction="up" />
      ) : (
        <OvalEye cx={cx} cy={cy} side={side} />
      );
    case "worried":
      return <WorriedEye cx={cx} cy={cy} side={side} />;
    case "wide":
      return <OvalEye cx={cx} cy={cy} side={side} variant="wide" />;
    case "soft":
      return <OvalEye cx={cx} cy={cy} side={side} variant="soft" />;
    case "sparkle":
      return <OvalEye cx={cx} cy={cy} side={side} sparkle />;
    case "round":
    default:
      return <OvalEye cx={cx} cy={cy} side={side} />;
  }
}

function ArcEye({ cx, cy, direction }: { cx: number; cy: number; direction: "up" | "down" }) {
  // direction "up" = ⌣ (happy closed-eye smile), "down" = ⌢ (sleepy droop)
  const dy = direction === "up" ? -42 : 42;
  return (
    <path
      d={`M ${cx - 42} ${cy} Q ${cx} ${cy + dy} ${cx + 42} ${cy}`}
      stroke={DARK}
      strokeWidth={10}
      strokeLinecap="round"
      fill="none"
    />
  );
}

function OvalEye({
  cx,
  cy,
  side,
  sparkle,
  variant,
}: {
  cx: number;
  cy: number;
  side: "left" | "right";
  sparkle?: boolean;
  variant?: "soft" | "wide";
}) {
  const rx = variant === "wide" ? 38 : variant === "soft" ? 28 : 32;
  const ry = variant === "wide" ? 50 : variant === "soft" ? 38 : 44;
  const dir = side === "left" ? 1 : -1;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={DARK} />
      {/* primary highlight */}
      <ellipse
        cx={cx + 9 * dir}
        cy={cy - ry * 0.42}
        rx={rx * 0.34}
        ry={ry * 0.28}
        fill="#ffffff"
      />
      {/* secondary highlight */}
      <circle cx={cx - 10 * dir} cy={cy + ry * 0.35} r={rx * 0.2} fill="#ffffff" />
      {sparkle && (
        <>
          <Sparkle cx={cx + rx + 10} cy={cy - ry * 0.2} size={8} />
          <Sparkle cx={cx - rx - 6} cy={cy + ry * 0.5} size={5} />
        </>
      )}
    </g>
  );
}

function WorriedEye({ cx, cy, side }: { cx: number; cy: number; side: "left" | "right" }) {
  // Slanted squinted shape — small triangle-ish eye with single highlight
  const dir = side === "left" ? 1 : -1;
  const tilt = 12 * dir;
  return (
    <g transform={`rotate(${tilt} ${cx} ${cy})`}>
      <ellipse cx={cx} cy={cy} rx={26} ry={18} fill={DARK} />
      <circle cx={cx - 6 * dir} cy={cy - 4} r={5} fill="#ffffff" />
    </g>
  );
}

function Sparkle({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const s = size;
  return (
    <path
      d={`M ${cx} ${cy - s} L ${cx + s * 0.35} ${cy - s * 0.35} L ${cx + s} ${cy} L ${cx + s * 0.35} ${cy + s * 0.35} L ${cx} ${cy + s} L ${cx - s * 0.35} ${cy + s * 0.35} L ${cx - s} ${cy} L ${cx - s * 0.35} ${cy - s * 0.35} Z`}
      fill="#ffffff"
    />
  );
}
