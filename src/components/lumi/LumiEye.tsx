import type { EyeShape } from "./expressionPresets";

interface LumiEyeProps {
  cx: number;
  cy: number;
  shape: EyeShape;
  side: "left" | "right";
  blink?: boolean;
}

/**
 * Kawaii eye — big shiny pupil with two white highlights, or a closed
 * upward arc (^^) for smile/wink shapes. Uses the Lumi blue glow theme.
 */
export function LumiEye({ cx, cy, shape, side, blink }: LumiEyeProps) {
  const effective: EyeShape = blink ? "smile" : shape;

  // Closed smiling arc — used for "smile" and the closed side of "wink-left"
  if (effective === "smile") {
    return (
      <path
        d={`M ${cx - 55} ${cy + 8} q 55 -50 110 0`}
        stroke="oklch(0.97 0.02 240)"
        strokeWidth={12}
        strokeLinecap="round"
        fill="none"
        filter="url(#kawaii-glow)"
      />
    );
  }

  if (effective === "wink-left") {
    // Wink uses the same closed arc, only applied to the left side
    if (side === "left") {
      return (
        <path
          d={`M ${cx - 55} ${cy + 8} q 55 -50 110 0`}
          stroke="oklch(0.97 0.02 240)"
          strokeWidth={12}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );
    }
    // Right side stays round
    return <RoundEye cx={cx} cy={cy} side={side} sparkle={false} />;
  }

  if (effective === "half") {
    // Sleepy half-lid: top half of the round eye
    return (
      <g>
        <RoundEye cx={cx} cy={cy} side={side} sparkle={false} small />
        <rect
          x={cx - 70}
          y={cy - 80}
          width={140}
          height={70}
          fill="var(--lumi-bg, oklch(0.1 0.05 260))"
        />
        <path
          d={`M ${cx - 58} ${cy - 8} q 58 28 116 0`}
          stroke="oklch(0.97 0.02 240)"
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      </g>
    );
  }

  if (effective === "soft") {
    return <RoundEye cx={cx} cy={cy} side={side} sparkle={false} small />;
  }

  if (effective === "sparkle") {
    return <RoundEye cx={cx} cy={cy} side={side} sparkle />;
  }

  // round
  return <RoundEye cx={cx} cy={cy} side={side} sparkle={false} />;
}

function RoundEye({
  cx,
  cy,
  side,
  sparkle,
  small,
}: {
  cx: number;
  cy: number;
  side: "left" | "right";
  sparkle: boolean;
  small?: boolean;
}) {
  const r = small ? 48 : 62;
  const hl1x = side === "left" ? cx - 18 : cx + 22;
  const hl1y = cy - 22;
  const hl2x = side === "left" ? cx + 16 : cx - 14;
  const hl2y = cy + 18;
  return (
    <g>
      {/* glow halo */}
      <circle cx={cx} cy={cy} r={r + 6} fill="oklch(0.8 0.22 255 / 0.55)" filter="url(#kawaii-blur)" />
      {/* main pupil */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="oklch(0.22 0.14 260)"
        stroke="oklch(1 0 0)"
        strokeWidth={4}
        filter="url(#kawaii-glow)"
      />
      {/* big highlight */}
      <ellipse cx={hl1x} cy={hl1y} rx={r * 0.28} ry={r * 0.34} fill="oklch(1 0 0)" />
      {/* small highlight */}
      <circle cx={hl2x} cy={hl2y} r={r * 0.14} fill="oklch(1 0 0)" />
      {sparkle && (
        <>
          {/* watery shimmer along bottom */}
          <ellipse
            cx={cx}
            cy={cy + r * 0.55}
            rx={r * 0.7}
            ry={r * 0.18}
            fill="oklch(0.85 0.12 240 / 0.55)"
          />
          <circle cx={cx + r * 0.3} cy={cy + r * 0.35} r={4} fill="oklch(1 0 0)" />
        </>
      )}
    </g>
  );
}
