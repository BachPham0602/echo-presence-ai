import type { EyeShape } from "./expressionPresets";

interface LumiEyeProps {
  cx: number;
  cy: number;
  shape: EyeShape;
  side: "left" | "right";
  blink?: boolean;
}

/**
 * Kawaii eye — tall glossy oval pupil with two white highlights, plus
 * delicate eyelashes on top. Other shapes cover smile (^^), wink, sleepy
 * half-lid, surprised (extra wide), and worried (slanted slit).
 */
export function LumiEye({ cx, cy, shape, side, blink }: LumiEyeProps) {
  const effective: EyeShape = blink ? "smile" : shape;

  if (effective === "smile") {
    return <SmileArc cx={cx} cy={cy} />;
  }

  if (effective === "wink-left") {
    if (side === "left") return <SmileArc cx={cx} cy={cy} />;
    return <OvalEye cx={cx} cy={cy} side={side} sparkle={false} />;
  }

  if (effective === "half") {
    return (
      <g>
        <OvalEye cx={cx} cy={cy + 6} side={side} sparkle={false} variant="small" />
        <rect
          x={cx - 80}
          y={cy - 90}
          width={160}
          height={78}
          fill="oklch(0.12 0.08 265)"
        />
        <path
          d={`M ${cx - 62} ${cy - 6} q 62 26 124 0`}
          stroke="oklch(0.98 0.02 240)"
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
        <Eyelashes cx={cx} cy={cy - 8} side={side} />
      </g>
    );
  }

  if (effective === "worried") {
    // Slanted slit — left slants down-right, right slants down-left
    const slant = side === "left" ? 1 : -1;
    return (
      <g>
        <path
          d={`M ${cx - 38} ${cy - 10 * slant} L ${cx + 38} ${cy + 30 * slant} Q ${cx} ${cy + 36 * slant} ${cx - 38} ${cy - 10 * slant} Z`}
          fill="oklch(0.18 0.1 265)"
          stroke="oklch(1 0 0)"
          strokeWidth={3}
          filter="url(#kawaii-glow)"
        />
        <circle cx={cx + (side === "left" ? -4 : 4)} cy={cy + 6} r={6} fill="oklch(1 0 0)" />
      </g>
    );
  }

  if (effective === "wide") {
    return <OvalEye cx={cx} cy={cy} side={side} sparkle={false} variant="wide" />;
  }
  if (effective === "soft") {
    return <OvalEye cx={cx} cy={cy} side={side} sparkle={false} variant="small" />;
  }
  if (effective === "sparkle") {
    return <OvalEye cx={cx} cy={cy} side={side} sparkle />;
  }
  return <OvalEye cx={cx} cy={cy} side={side} sparkle={false} />;
}

function SmileArc({ cx, cy }: { cx: number; cy: number }) {
  return (
    <path
      d={`M ${cx - 58} ${cy + 10} q 58 -54 116 0`}
      stroke="oklch(0.98 0.02 240)"
      strokeWidth={13}
      strokeLinecap="round"
      fill="none"
      filter="url(#kawaii-glow)"
    />
  );
}

function Eyelashes({ cx, cy, side }: { cx: number; cy: number; side: "left" | "right" }) {
  const dir = side === "left" ? -1 : 1;
  const stroke = "oklch(0.18 0.08 265)";
  return (
    <g stroke={stroke} strokeWidth={5} strokeLinecap="round" fill="none">
      <path d={`M ${cx - 40} ${cy - 38} q ${-10 * dir} -12 ${-18 * dir} -22`} />
      <path d={`M ${cx} ${cy - 50} l 0 -14`} />
      <path d={`M ${cx + 40} ${cy - 38} q ${10 * dir} -12 ${18 * dir} -22`} />
    </g>
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
  sparkle: boolean;
  variant?: "small" | "wide";
}) {
  const rx = variant === "small" ? 36 : variant === "wide" ? 46 : 40;
  const ry = variant === "small" ? 52 : variant === "wide" ? 64 : 58;

  // Highlight positions reflect mirror-symmetrically between left/right eye
  const dir = side === "left" ? 1 : -1;
  const hl1x = cx - 12 * dir;
  const hl1y = cy - ry * 0.45;
  const hl2x = cx + 14 * dir;
  const hl2y = cy + ry * 0.35;

  return (
    <g>
      {/* soft glow halo */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx + 10}
        ry={ry + 10}
        fill="oklch(0.8 0.22 255 / 0.5)"
        filter="url(#kawaii-blur)"
      />
      {/* iris/pupil — deep navy with gradient feel */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="oklch(0.18 0.12 265)"
        stroke="oklch(1 0 0)"
        strokeWidth={3}
        filter="url(#kawaii-glow)"
      />
      {/* inner color ring */}
      <ellipse
        cx={cx}
        cy={cy + 2}
        rx={rx * 0.78}
        ry={ry * 0.82}
        fill="oklch(0.34 0.18 258)"
        opacity={0.85}
      />
      {/* big highlight */}
      <ellipse cx={hl1x} cy={hl1y} rx={rx * 0.35} ry={ry * 0.28} fill="oklch(1 0 0)" />
      {/* small highlight */}
      <circle cx={hl2x} cy={hl2y} r={rx * 0.18} fill="oklch(1 0 0)" />
      {sparkle && (
        <>
          <circle cx={cx + rx * 0.15} cy={cy + ry * 0.6} r={4} fill="oklch(1 0 0)" />
          <circle cx={cx - rx * 0.55} cy={cy + ry * 0.1} r={3} fill="oklch(1 0 0 / 0.85)" />
        </>
      )}
      {/* eyelashes */}
      <Eyelashes cx={cx} cy={cy - ry + 4} side={side} />
    </g>
  );
}
