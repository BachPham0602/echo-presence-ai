import { useEffect, useState } from "react";
import type { LumiExpression } from "@/types/emotion";

interface LumiFaceProps {
  expression: LumiExpression;
}

/**
 * Lumi's face — a bodyless, anime-style emotional companion.
 *
 * Only the features float in the dark blue void: two large glossy eyes with a
 * glowing outline, curved brows, a small expressive mouth, and emotion marks
 * (anger / sweat / sparkle). No mascot body. No avatar circle.
 *
 * Animations: breathing scale, idle blink, slow gaze drift, per-expression
 * brows / eye shape / mouth / accent.
 */
export function LumiFace({ expression }: LumiFaceProps) {
  const [blink, setBlink] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      setBlink(true);
      window.setTimeout(() => !cancelled && setBlink(false), 140);
      window.setTimeout(loop, 2800 + Math.random() * 2600);
    };
    const t = window.setTimeout(loop, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const drift = () => {
      if (cancelled) return;
      setGaze({
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 6,
      });
      window.setTimeout(drift, 2400 + Math.random() * 2200);
    };
    const t = window.setTimeout(drift, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const eyeShape = eyeShapeFor(expression, blink);
  const mouth = mouthPathFor(expression);
  const brows = browPathsFor(expression);
  const showAnger =
    expression === "concerned" ||
    expression === "sad" ||
    expression === "confused";

  // SVG canvas — wide so the features can spread out like the reference.
  // viewBox: 800 x 600. Eyes centered around y=290, large.
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Soft ambient halo behind the face */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 45%, oklch(0.55 0.22 250 / 0.45), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="lumi-breathe relative w-full">
        <svg
          viewBox="0 0 800 600"
          className="mx-auto block h-[88vh] w-full max-w-[1100px] drop-shadow-[0_30px_90px_rgba(80,140,255,0.45)]"
          role="img"
          aria-label={`Lumi — ${expression}`}
        >
          <defs>
            {/* Glossy eye gradient — soft blue version of the reference */}
            <radialGradient id="eye-fill" cx="50%" cy="35%" r="80%">
              <stop offset="0%" stopColor="oklch(0.55 0.14 250)" />
              <stop offset="55%" stopColor="oklch(0.3 0.1 255)" />
              <stop offset="100%" stopColor="oklch(0.16 0.07 260)" />
            </radialGradient>
            {/* Bottom inner glow — mimics the bright lower rim in the ref */}
            <radialGradient id="eye-rim" cx="50%" cy="100%" r="65%">
              <stop offset="0%" stopColor="oklch(0.9 0.08 240 / 0.55)" />
              <stop offset="60%" stopColor="oklch(0.9 0.08 240 / 0)" />
            </radialGradient>
            {/* Outline glow filter */}
            <filter
              id="outline-glow"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="strong-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>

            {/* Eye shape clipping paths for glossy highlight inside the eye */}
            <clipPath id="eye-clip-left">
              <path d={eyePath(260, 290, eyeShape)} />
            </clipPath>
            <clipPath id="eye-clip-right">
              <path d={eyePath(540, 290, eyeShape)} />
            </clipPath>
          </defs>

          {/* ===== EYES ===== */}
          <g
            transform={`translate(${gaze.x}, ${gaze.y})`}
            style={{
              transition: "transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {/* outer soft glow under each eye */}
            <ellipse
              cx={260}
              cy={310}
              rx={140}
              ry={150}
              fill="oklch(0.7 0.18 250 / 0.18)"
              filter="url(#strong-glow)"
            />
            <ellipse
              cx={540}
              cy={310}
              rx={140}
              ry={150}
              fill="oklch(0.7 0.18 250 / 0.18)"
              filter="url(#strong-glow)"
            />

            <Eye cx={260} cy={290} shape={eyeShape} side="left" />
            <Eye cx={540} cy={290} shape={eyeShape} side="right" />
          </g>

          {/* ===== EYEBROWS ===== */}
          {brows.map((b, i) => (
            <path
              key={i}
              d={b}
              stroke="oklch(0.97 0.02 240)"
              strokeWidth={9}
              strokeLinecap="round"
              fill="none"
              filter="url(#outline-glow)"
              style={{ transition: "d 0.4s ease" }}
            />
          ))}

          {/* ===== MOUTH ===== */}
          <path
            d={mouth}
            stroke="oklch(0.97 0.02 240)"
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
            filter="url(#outline-glow)"
          />

          {/* ===== ANGER / EMOTION MARK ===== */}
          {showAnger && <AngerMark x={690} y={120} />}
        </svg>
      </div>
    </div>
  );
}

/* ============================================================
 * EYES
 * ============================================================ */

type EyeShape = "open" | "closed" | "soft" | "wide" | "squint" | "down";

/** Returns the rounded "fishbowl"-style eye outline path used in the reference. */
function eyePath(cx: number, cy: number, shape: EyeShape): string {
  // base sizes
  const w = shape === "wide" ? 130 : 120;
  const h = shape === "wide" ? 150 : shape === "soft" ? 130 : 140;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const left = cx - w / 2;
  const right = cx + w / 2;
  // rounded bowl: flat-ish top corners, very round bottom
  return [
    `M ${left} ${top + 18}`,
    `Q ${left} ${top} ${left + 24} ${top}`,
    `L ${right - 24} ${top}`,
    `Q ${right} ${top} ${right} ${top + 18}`,
    `L ${right} ${cy + 10}`,
    `Q ${right} ${bottom} ${cx} ${bottom}`,
    `Q ${left} ${bottom} ${left} ${cy + 10}`,
    "Z",
  ].join(" ");
}

function Eye({
  cx,
  cy,
  shape,
  side,
}: {
  cx: number;
  cy: number;
  shape: EyeShape;
  side: "left" | "right";
}) {
  // Closed / squint — just a curved arc, no body
  if (shape === "closed") {
    return (
      <path
        d={`M ${cx - 60} ${cy} q 60 38 120 0`}
        stroke="oklch(0.97 0.02 240)"
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
        filter="url(#outline-glow)"
      />
    );
  }
  if (shape === "squint") {
    return (
      <path
        d={`M ${cx - 60} ${cy + 8} q 60 -40 120 0`}
        stroke="oklch(0.97 0.02 240)"
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
        filter="url(#outline-glow)"
      />
    );
  }

  const path = eyePath(cx, cy, shape);
  // pupil highlight position depends on side and gaze
  const pupilCx = side === "left" ? cx - 22 : cx + 22;
  const pupilCy = cy - 32;
  const clipId = side === "left" ? "eye-clip-left" : "eye-clip-right";

  return (
    <g>
      {/* glowing white outline */}
      <path
        d={path}
        fill="url(#eye-fill)"
        stroke="oklch(1 0 0)"
        strokeWidth={5}
        filter="url(#outline-glow)"
      />
      {/* bright bottom inner rim */}
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx={cx} cy={cy + 50} rx={70} ry={50} fill="url(#eye-rim)" />
        {/* subtle internal shadow rim */}
        <ellipse
          cx={cx}
          cy={cy + 15}
          rx={48}
          ry={10}
          fill="oklch(1 0 0 / 0.15)"
        />
      </g>
      {/* big glossy pupil highlight (the reference's white drop shape) */}
      <ellipse
        cx={pupilCx}
        cy={pupilCy}
        rx={28}
        ry={36}
        fill="oklch(1 0 0)"
      />
      {/* small secondary sparkle */}
      <circle
        cx={pupilCx + 18}
        cy={pupilCy + 14}
        r={6}
        fill="oklch(1 0 0 / 0.9)"
      />
    </g>
  );
}

/* ============================================================
 * BROWS / MOUTH / EXPRESSION MAPPING
 * ============================================================ */

function eyeShapeFor(expression: LumiExpression, blink: boolean): EyeShape {
  if (blink) return "closed";
  switch (expression) {
    case "sleepy":
      return "closed";
    case "happy":
    case "excited":
      return "squint";
    case "sad":
    case "concerned":
      return "down";
    case "thinking":
      return "soft";
    case "speaking":
    case "listening":
      return "wide";
    case "confused":
      return "soft";
    default:
      return "open";
  }
}

/**
 * Returns left + right brow paths. The reference shows curved brows that
 * slope inward (concerned/angry). Other expressions use softer curves.
 */
function browPathsFor(expression: LumiExpression): [string, string] {
  // baseline y for brows (just above the eyes)
  switch (expression) {
    case "concerned":
    case "sad":
      // inner ends raised → worried look
      return [
        "M 195 220 Q 260 195 325 215",
        "M 475 215 Q 540 195 605 220",
      ];
    case "confused":
      return [
        "M 195 215 Q 260 200 325 220",
        "M 475 225 Q 540 205 605 215",
      ];
    case "happy":
    case "excited":
      return [
        "M 200 215 Q 260 195 320 215",
        "M 480 215 Q 540 195 600 215",
      ];
    case "thinking":
      return [
        "M 200 220 Q 260 210 325 218",
        "M 475 218 Q 540 210 600 220",
      ];
    case "sleepy":
      return [
        "M 200 230 Q 260 225 325 232",
        "M 475 232 Q 540 225 600 230",
      ];
    default:
      return [
        "M 200 220 Q 260 205 325 218",
        "M 475 218 Q 540 205 600 220",
      ];
  }
}

function mouthPathFor(expression: LumiExpression): string {
  // Mouth centered around (400, 470)
  switch (expression) {
    case "happy":
      return "M 350 460 Q 400 510 450 460";
    case "excited":
      return "M 340 455 Q 400 520 460 455";
    case "sad":
      return "M 350 485 Q 400 445 450 485";
    case "concerned":
      // small downward arc like the reference
      return "M 365 475 Q 400 455 435 475";
    case "speaking":
      return "M 365 465 Q 400 490 435 465 Q 400 455 365 465 Z";
    case "thinking":
      return "M 370 470 Q 400 465 430 470";
    case "sleepy":
      return "M 370 470 Q 400 478 430 470";
    case "confused":
      return "M 365 472 Q 385 462 405 478 Q 420 466 435 470";
    case "listening":
      return "M 365 468 Q 400 478 435 468";
    default:
      return "M 370 470 Q 400 478 430 470";
  }
}

/* ============================================================
 * ANGER MARK — the small red "stress" cross from the reference
 * ============================================================ */

function AngerMark({ x, y }: { x: number; y: number }) {
  const stroke = "oklch(0.62 0.22 25)";
  return (
    <g
      transform={`translate(${x}, ${y})`}
      filter="url(#outline-glow)"
      style={{
        transformOrigin: `${x}px ${y}px`,
        animation: "lumi-anger-pulse 1.6s ease-in-out infinite",
      }}
    >
      <path
        d="M -22 0 Q -10 6 0 0 Q 10 -6 22 0"
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 0 -22 Q 6 -10 0 0 Q -6 10 0 22"
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M -16 -16 Q -8 -8 0 -2"
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 16 16 Q 8 8 2 2"
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}