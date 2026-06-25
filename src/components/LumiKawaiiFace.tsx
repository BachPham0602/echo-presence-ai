import { useEffect, useState } from "react";
import type { LumiExpression } from "@/types/emotion";

/**
 * Lumi face — inline SVG reproductions of the 9 reference kawaii expressions
 * (Happy, Excited, Playful, Neutral, Sad, Worried, Sleepy, Surprised, Wink).
 * Coordinates match the source 300x200 viewBox tile so each mood is faithful
 * to the supplied sheet. Smooth CSS transitions cross-fade between moods and
 * a random blink overlays the open-eyed expressions.
 */

type Kawaii =
  | "happy"
  | "excited"
  | "playful"
  | "neutral"
  | "sad"
  | "worried"
  | "sleepy"
  | "surprised"
  | "wink"
  | "angry";

const KAWAII_LIST: Kawaii[] = [
  "happy",
  "excited",
  "playful",
  "neutral",
  "sad",
  "worried",
  "sleepy",
  "surprised",
  "wink",
  "angry",
];

function toKawaii(expr: LumiExpression): Kawaii {
  switch (expr) {
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "playful":
      return "playful";
    case "sad":
      return "sad";
    case "concerned":
    case "worried":
    case "thinking":
      return "worried";
    case "sleepy":
      return "sleepy";
    case "surprised":
    case "confused":
      return "surprised";
    case "wink":
      return "wink";
    case "angry":
      return "angry";
    case "speaking":
      return "happy";
    case "listening":
    case "idle":
    default:
      return "neutral";
  }
}

interface Props {
  expression: LumiExpression;
}

export function LumiKawaiiFace({ expression }: Props) {
  const mood = toKawaii(expression);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      setBlink(true);
      window.setTimeout(() => !cancelled && setBlink(false), 130);
      window.setTimeout(loop, 2400 + Math.random() * 2800);
    };
    const t = window.setTimeout(loop, 1600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const wiggle =
    mood === "excited" || mood === "happy" || mood === "playful"
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
          viewBox="0 0 300 200"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full drop-shadow-[0_20px_60px_rgba(180,120,255,0.4)]"
          role="img"
          aria-label={`Lumi — ${mood}`}
        >
          {/* Cross-fade between every expression — only the active mood has
              opacity 1; React still keeps the others mounted so the CSS
              opacity transition handles the morph smoothly. */}
          {KAWAII_LIST.map((m) => (
            <g
              key={m}
              style={{
                opacity: m === mood ? 1 : 0,
                transition: "opacity 0.35s ease",
              }}
            >
              <ExpressionLayer mood={m} blink={m === mood && blink} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* ===== Per-expression layer — matches the reference SVG paths 1:1 ===== */

const EYE = "#020617";
const SHINE = "#ffffff";
const BLUSH = "#f4a3b5";
const TONGUE = "#ff4d5a";
const STROKE = 14;

function Mouth({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={EYE}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Blush({ dim = false }: { dim?: boolean }) {
  const opacity = dim ? 0.45 : 0.75;
  return (
    <g>
      <ellipse cx={55} cy={125} rx={38} ry={14} fill={BLUSH} opacity={opacity} />
      <ellipse cx={245} cy={125} rx={38} ry={14} fill={BLUSH} opacity={opacity} />
    </g>
  );
}

/** Open round eye with two shines, exactly like the reference. */
function OpenEye({
  cx,
  cy,
  rx = 30,
  ry = 42,
  blink,
}: {
  cx: number;
  cy: number;
  rx?: number;
  ry?: number;
  blink: boolean;
}) {
  if (blink) {
    return (
      <path
        d={`M ${cx - rx} ${cy} Q ${cx} ${cy + 8} ${cx + rx} ${cy}`}
        fill="none"
        stroke={EYE}
        strokeWidth={8}
        strokeLinecap="round"
      />
    );
  }
  return (
    <g>
      {/* soft iris glow */}
      <ellipse cx={cx} cy={cy + 2} rx={rx + 3} ry={ry + 3} fill="#1a1240" opacity={0.35} />
      {/* main eye */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={EYE} />
      {/* iris color hint */}
      <ellipse cx={cx} cy={cy + 4} rx={rx - 6} ry={ry - 8} fill="#3b2a78" opacity={0.85} />
      {/* big sparkle */}
      <ellipse cx={cx - 9} cy={cy - 16} rx={11} ry={13} fill={SHINE} />
      {/* small sparkle */}
      <circle cx={cx + 11} cy={cy + 16} r={6} fill={SHINE} />
      {/* tiny accent */}
      <circle cx={cx + 6} cy={cy - 22} r={3} fill={SHINE} opacity={0.85} />
      <Lashes cx={cx} cy={cy} rx={rx} ry={ry} />
    </g>
  );
}

/** Anime-style upper lashes — full curved lid + elegant radiating strands. */
function Lashes({
  cx,
  cy,
  rx,
  ry,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}) {
  const top = cy - ry;
  return (
    <g fill="none" stroke={EYE} strokeLinecap="round">
      {/* soft, smooth upper lid — single elegant sweep that flicks outward */}
      <path
        d={`M ${cx - rx} ${top + 8} C ${cx - rx * 0.4} ${top - 4}, ${cx + rx * 0.4} ${top - 4}, ${cx + rx + 10} ${top - 4}`}
        strokeWidth={6}
      />
      {/* one clean outer flick tail */}
      <path
        d={`M ${cx + rx + 4} ${top - 1} q 8 -6 14 -12`}
        strokeWidth={3}
      />
    </g>
  );
}

function ExpressionLayer({ mood, blink }: { mood: Kawaii; blink: boolean }) {
  switch (mood) {
    case "happy":
      return (
        <g>
          {/* arched closed eyes */}
          <Mouth d="M55 85 Q95 35 135 85" />
          <Mouth d="M165 85 Q205 35 245 85" />
          <Blush />
          {/* big smile + tongue */}
          <path d="M120 115 Q150 180 180 115 Z" fill={EYE} />
          <path d="M138 152 Q150 172 162 152 Z" fill={TONGUE} />
        </g>
      );
    case "excited":
      return (
        <g>
          <OpenEye cx={85} cy={85} rx={30} ry={45} blink={blink} />
          <OpenEye cx={215} cy={85} rx={30} ry={45} blink={blink} />
          <Blush />
          <path d="M125 120 Q150 175 175 120 Z" fill={EYE} />
          <path d="M138 150 Q150 168 162 150 Z" fill={TONGUE} />
        </g>
      );
    case "playful":
      return (
        <g>
          {/* left winked arch, right open eye */}
          <Mouth d="M55 80 Q85 45 115 80" />
          <OpenEye cx={215} cy={80} blink={blink} />
          <Blush />
          <path
            d="M115 112 Q150 175 185 112"
            fill="none"
            stroke={EYE}
            strokeWidth={14}
            strokeLinecap="round"
          />
          <path d="M136 142 Q150 185 164 142 Z" fill={TONGUE} />
        </g>
      );
    case "neutral":
      return (
        <g>
          <OpenEye cx={85} cy={75} blink={blink} />
          <OpenEye cx={215} cy={75} blink={blink} />
          <Blush />
          <Mouth d="M110 140 Q150 170 190 140" />
        </g>
      );
    case "sad":
      return (
        <g>
          <OpenEye cx={85} cy={75} blink={blink} />
          <OpenEye cx={215} cy={75} blink={blink} />
          <Blush dim />
          <Mouth d="M110 170 Q150 125 190 170" />
        </g>
      );
    case "worried":
      return (
        <g>
          {/* slanted lash shapes */}
          <path d="M55 50 L115 85 Q75 95 55 50" fill={EYE} />
          <path d="M245 50 L185 85 Q225 95 245 50" fill={EYE} />
          <circle cx={88} cy={70} r={8} fill={SHINE} />
          <circle cx={212} cy={70} r={8} fill={SHINE} />
          <Blush />
          <Mouth d="M115 145 Q130 130 145 145 T175 145" />
        </g>
      );
    case "sleepy":
      return (
        <g>
          <Mouth d="M55 80 Q85 100 115 80" />
          <Mouth d="M185 80 Q215 100 245 80" />
          <Blush dim />
          <Mouth d="M120 150 Q150 165 180 150" />
        </g>
      );
    case "surprised":
      return (
        <g>
          <ellipse cx={85} cy={75} rx={32} ry={45} fill={EYE} />
          <ellipse cx={215} cy={75} rx={32} ry={45} fill={EYE} />
          <circle cx={75} cy={58} r={10} fill={SHINE} />
          <circle cx={205} cy={58} r={10} fill={SHINE} />
          <Lashes cx={85} cy={75} rx={32} ry={45} />
          <Lashes cx={215} cy={75} rx={32} ry={45} />
          <Blush />
          {/* O mouth */}
          <ellipse cx={150} cy={145} rx={28} ry={38} fill={EYE} />
          <ellipse cx={150} cy={162} rx={18} ry={14} fill={TONGUE} />
        </g>
      );
    case "wink":
      return (
        <g>
          <OpenEye cx={85} cy={75} blink={blink} />
          {/* right winked arch */}
          <Mouth d="M185 80 Q215 55 245 80" />
          <Blush />
          <path d="M125 118 Q150 172 175 118 Z" fill={EYE} />
          <path d="M138 150 Q150 168 162 150 Z" fill={TONGUE} />
        </g>
      );
    case "angry":
      return (
        <g>
          {/* angled angry brows */}
          <path
            d="M50 40 L130 70"
            stroke={EYE}
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M250 40 L170 70"
            stroke={EYE}
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
          />
          {/* narrowed glaring eyes */}
          <ellipse cx={85} cy={92} rx={26} ry={20} fill={EYE} />
          <ellipse cx={215} cy={92} rx={26} ry={20} fill={EYE} />
          <circle cx={78} cy={86} r={6} fill={SHINE} />
          <circle cx={208} cy={86} r={6} fill={SHINE} />
          {/* flushed angry blush */}
          <ellipse cx={55} cy={130} rx={40} ry={15} fill="#ff6b6b" opacity={0.7} />
          <ellipse cx={245} cy={130} rx={40} ry={15} fill="#ff6b6b" opacity={0.7} />
          {/* pouty frown */}
          <Mouth d="M115 165 Q150 130 185 165" />
          {/* anger vein */}
          <path
            d="M235 30 L245 40 L235 45 L250 55 M250 35 L260 45"
            stroke="#ff3b3b"
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );
  }
}