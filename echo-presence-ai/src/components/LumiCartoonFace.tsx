import { useEffect, useState } from "react";
import type { LumiExpression } from "@/types/emotion";

/**
 * Lumi cartoon-emoji face — 8 expressions reproduced 1:1 from the supplied
 * SVG sheet (Normal/Happy, Love, Surprised, Sleepy, Star, Wink, Sad, Crying).
 * Each tile from the source is centered inside a round cream head with a
 * crisp dark outline. Smooth cross-fade between moods + random blink.
 */

type Mood =
  | "normal"
  | "love"
  | "surprised"
  | "sleepy"
  | "star"
  | "wink"
  | "sad"
  | "crying";

const MOODS: Mood[] = [
  "normal",
  "love",
  "surprised",
  "sleepy",
  "star",
  "wink",
  "sad",
  "crying",
];

function toMood(expr: LumiExpression): Mood {
  switch (expr) {
    case "happy":
      return "normal";
    case "excited":
      return "star";
    case "sad":
      return "sad";
    case "concerned":
      return "crying";
    case "sleepy":
      return "sleepy";
    case "confused":
    case "thinking":
      return "surprised";
    case "speaking":
      return "normal";
    case "listening":
      return "wink";
    case "idle":
    default:
      return "normal";
  }
}

interface Props {
  expression: LumiExpression;
}

const SKIN = "#FFFDF7";
const SKIN_STROKE = "#1a1a1a";
const INK = "#1a1a1a";

export function LumiCartoonFace({ expression }: Props) {
  const mood = toMood(expression);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      setBlink(true);
      window.setTimeout(() => !cancelled && setBlink(false), 130);
      window.setTimeout(loop, 2400 + Math.random() * 2600);
    };
    const t = window.setTimeout(loop, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const wiggle =
    mood === "star" || mood === "love" || mood === "normal"
      ? "lumi-wiggle"
      : "lumi-breathe";

  return (
    <div className="absolute inset-0 h-full w-full">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 50% 38%, oklch(0.78 0.18 320 / 0.45), transparent 70%)",
        }}
      />
      <div className={`absolute inset-0 ${wiggle}`}>
        <svg
          viewBox="0 0 300 340"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full drop-shadow-[0_20px_55px_rgba(120,80,200,0.4)]"
          role="img"
          aria-label={`Lumi — ${mood}`}
        >
          {/* Features only — no head, no blush. Tile is 90x90, scaled & centered. */}
          <g transform="translate(37.5 57.5) scale(2.5)">
            {MOODS.map((m) => (
              <g
                key={m}
                style={{
                  opacity: m === mood ? 1 : 0,
                  transition: "opacity 0.35s ease",
                }}
              >
                <Face mood={m} blink={m === mood && blink} />
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Per-mood feature layers — coords match the reference sheet   */
/* ============================================================ */

function Face({ mood, blink }: { mood: Mood; blink: boolean }) {
  // While blinking, replace open eyes with a small upward arc, but keep
  // intentionally-closed expressions (sleepy/wink/sad) as designed.
  const blinking = blink && mood !== "sleepy" && mood !== "wink" && mood !== "sad";

  switch (mood) {
    case "normal":
      return (
        <>
          {blinking ? <ClosedEyes /> : <RoundEyes />}
          <BrowsCurvedUp />
          <path
            d="M 30 78 Q 45 88 60 78"
            fill="none"
            stroke={INK}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </>
      );

    case "love":
      return (
        <>
          {/* Left & right eye whites with heart pupils */}
          <ellipse cx={22} cy={40} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
          <path
            d="M 22 52 C 14 44 6 36 14 28 C 18 24 22 26 22 30 C 22 26 26 24 30 28 C 38 36 30 44 22 52 Z"
            fill="#e63939"
          />
          <ellipse cx={68} cy={40} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
          <path
            d="M 68 52 C 60 44 52 36 60 28 C 64 24 68 26 68 30 C 68 26 72 24 76 28 C 84 36 76 44 68 52 Z"
            fill="#e63939"
          />
          <BrowsCurvedUp />
          {/* small open mouth */}
          <ellipse cx={45} cy={80} rx={7} ry={5} fill={INK} />
        </>
      );

    case "surprised":
      return (
        <>
          {blinking ? (
            <ClosedEyes wide />
          ) : (
            <>
              <ellipse cx={22} cy={38} rx={22} ry={25} fill="white" stroke={INK} strokeWidth={3.5} />
              <ellipse cx={22} cy={42} rx={13} ry={15} fill="#7ec8e3" />
              <ellipse cx={22} cy={42} rx={8} ry={9} fill={INK} />
              <ellipse cx={18} cy={38} rx={3.5} ry={4} fill="white" />
              <ellipse cx={70} cy={38} rx={22} ry={25} fill="white" stroke={INK} strokeWidth={3.5} />
              <ellipse cx={70} cy={42} rx={13} ry={15} fill="#7ec8e3" />
              <ellipse cx={70} cy={42} rx={8} ry={9} fill={INK} />
              <ellipse cx={66} cy={38} rx={3.5} ry={4} fill="white" />
            </>
          )}
          {/* raised brows */}
          <path d="M 2 10 Q 22 2 42 10" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          <path d="M 50 10 Q 70 2 90 10" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          {/* small O mouth */}
          <ellipse cx={46} cy={80} rx={8} ry={6} fill={INK} />
        </>
      );

    case "sleepy":
      return (
        <>
          {/* both eyes half-closed */}
          <HalfEye cx={22} />
          <HalfEye cx={68} />
          {/* droopy brows */}
          <path d="M 4 16 Q 22 22 40 16" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          <path d="M 50 16 Q 68 22 86 16" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          {/* flat mouth */}
          <path d="M 28 80 Q 45 78 62 80" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );

    case "star":
      return (
        <>
          <ellipse cx={22} cy={38} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
          <polygon
            points="22,26 24.5,34 33,34 26.2,39 28.7,47 22,42 15.3,47 17.8,39 11,34 19.5,34"
            fill="#f5c518"
          />
          <ellipse cx={68} cy={38} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
          <polygon
            points="68,26 70.5,34 79,34 72.2,39 74.7,47 68,42 61.3,47 63.8,39 57,34 65.5,34"
            fill="#f5c518"
          />
          <BrowsCurvedUp />
          <path d="M 25 78 Q 45 92 65 78" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );

    case "wink":
      return (
        <>
          {/* open left, closed right arc */}
          <ellipse cx={22} cy={38} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
          <ellipse cx={22} cy={42} rx={12} ry={14} fill={INK} />
          <ellipse cx={18} cy={38} rx={4} ry={4.5} fill="white" />
          <path d="M 48 42 Q 68 26 88 42" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <path d="M 4 14 Q 22 6 40 14" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          <path d="M 50 18 Q 68 10 86 18" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          {/* smirk */}
          <path d="M 28 80 Q 50 94 66 82" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );

    case "sad":
      return (
        <>
          {/* half-lid left, normal right (mirrors source) */}
          <HalfEye cx={22} />
          <ellipse cx={70} cy={38} rx={22} ry={25} fill="white" stroke={INK} strokeWidth={3.5} />
          <ellipse cx={70} cy={42} rx={12} ry={14} fill={INK} />
          <ellipse cx={66} cy={38} rx={4} ry={4.5} fill="white" />
          {/* sad brows */}
          <path d="M 6 18 Q 22 24 38 18" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          <path d="M 52 18 Q 70 24 88 18" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
          {/* sad mouth */}
          <path d="M 30 82 Q 46 74 62 82" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );

    case "crying":
      return (
        <>
          {blinking ? <ClosedEyes /> : <RoundEyes asymmetric />}
          {/* tear */}
          <g className="lumi-tear">
            <ellipse cx={82} cy={66} rx={5} ry={7} fill="#7ec8e3" />
            <path d="M 79 64 Q 82 58 85 64" fill="#7ec8e3" />
          </g>
          <BrowsCurvedUp />
          <path d="M 28 82 Q 46 74 64 82" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );
  }
}

/* ============================ Helpers ============================ */

function RoundEyes({ asymmetric }: { asymmetric?: boolean }) {
  const rRx = asymmetric ? 22 : 20;
  const rRy = asymmetric ? 25 : 23;
  const pRx = asymmetric ? 13 : 12;
  const pRy = asymmetric ? 15 : 14;
  return (
    <>
      <ellipse cx={22} cy={38} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
      <ellipse cx={22} cy={42} rx={12} ry={14} fill={INK} />
      <ellipse cx={18} cy={38} rx={4} ry={4.5} fill="white" />
      <ellipse cx={68} cy={38} rx={rRx} ry={rRy} fill="white" stroke={INK} strokeWidth={3.5} />
      <ellipse cx={68} cy={42} rx={pRx} ry={pRy} fill={INK} />
      <ellipse cx={64} cy={38} rx={asymmetric ? 4.5 : 4} ry={asymmetric ? 5 : 4.5} fill="white" />
    </>
  );
}

function ClosedEyes({ wide }: { wide?: boolean }) {
  const span = wide ? 24 : 20;
  return (
    <>
      <path
        d={`M ${22 - span} 40 Q 22 28 ${22 + span} 40`}
        fill="none"
        stroke={INK}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d={`M ${68 - span} 40 Q 68 28 ${68 + span} 40`}
        fill="none"
        stroke={INK}
        strokeWidth={4}
        strokeLinecap="round"
      />
    </>
  );
}

function HalfEye({ cx }: { cx: number }) {
  // Half-lidded eye: clip eye whites/pupil to the lower half, then draw
  // the curved upper lid as a stroked path. No solid skin fill needed.
  const clipId = `lumi-halflid-${cx}`;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={`M ${cx - 22} 38 Q ${cx} 50 ${cx + 22} 38 L ${cx + 22} 64 L ${cx - 22} 64 Z`} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx={cx} cy={38} rx={20} ry={23} fill="white" stroke={INK} strokeWidth={3.5} />
        <ellipse cx={cx} cy={44} rx={12} ry={14} fill={INK} />
        <ellipse cx={cx - 4} cy={40} rx={4} ry={4.5} fill="white" />
      </g>
      {/* curved upper lid */}
      <path
        d={`M ${cx - 20} 38 Q ${cx} 28 ${cx + 20} 38`}
        fill="none"
        stroke={INK}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
    </>
  );
}

function BrowsCurvedUp() {
  return (
    <>
      <path d="M 4 14 Q 22 6 40 14" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M 50 14 Q 68 6 86 14" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
    </>
  );
}
