import { useEffect, useState, type ReactElement } from "react";
import type { ExpressionName } from "./ExpressionManager";

/**
 * Calm Lumi face. Eyes / brows / mouth / cheeks are taken 1:1 from
 * `kawaii_faces.svg` (the user-provided reference). The blue glow and
 * theming come from the surrounding container — this component only
 * paints the facial features, fading smoothly between expressions.
 */

const FACES: Record<ExpressionName, JSX.Element> = {
  // Top-left of the reference grid
  happy: (
    <g>
      <ellipse cx="45" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="38" cy="48" rx="7" ry="9" fill="white" />
      <ellipse cx="36" cy="46" rx="3" ry="4" fill="white" opacity="0.8" />
      <ellipse cx="105" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="98" cy="48" rx="7" ry="9" fill="white" />
      <ellipse cx="96" cy="46" rx="3" ry="4" fill="white" opacity="0.8" />
      <ellipse cx="25" cy="80" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="125" cy="80" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M60 90 Q75 100 90 90" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  // Top-middle (steam → excited)
  excited: (
    <g>
      <path d="M45 18 Q50 8 45 0" stroke="#aaa" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M65 18 Q70 8 65 0" stroke="#aaa" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M85 18 Q90 8 85 0" stroke="#aaa" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M28 55 Q45 43 62 55" stroke="black" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M88 55 Q105 43 122 55" stroke="black" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="22" cy="74" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="128" cy="74" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M58 90 Q75 105 92 90" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  // Top-right → laughing (open mouth + happy tear)
  laughing: (
    <g>
      <ellipse cx="45" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="38" cy="48" rx="7" ry="9" fill="white" />
      <ellipse cx="105" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="98" cy="48" rx="7" ry="9" fill="white" />
      <path d="M115 72 Q120 82 115 92" stroke="#66aaff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="115" cy="94" rx="4" ry="5" fill="#66aaff" opacity="0.85" />
      <ellipse cx="22" cy="80" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="128" cy="80" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M52 88 Q75 110 98 88" stroke="black" strokeWidth="2.5" fill="white" />
      <line x1="52" y1="90" x2="98" y2="90" stroke="black" strokeWidth="1.5" />
    </g>
  ),
  // Middle-left → playful (brows + upturned mouth)
  playful: (
    <g>
      <ellipse cx="45" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="38" cy="48" rx="7" ry="9" fill="white" />
      <ellipse cx="105" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="98" cy="48" rx="7" ry="9" fill="white" />
      <path d="M28 36 Q45 28 58 38" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M92 38 Q105 28 122 36" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="25" cy="82" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="125" cy="82" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M60 97 Q75 87 90 97" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  // Middle-center → speaking (asymmetric wide eye + small "o")
  speaking: (
    <g>
      <ellipse cx="40" cy="60" rx="14" ry="15" fill="black" />
      <ellipse cx="34" cy="52" rx="5" ry="6" fill="white" />
      <ellipse cx="102" cy="57" rx="30" ry="31" fill="black" />
      <ellipse cx="92" cy="46" rx="10" ry="12" fill="white" />
      <ellipse cx="18" cy="85" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="132" cy="85" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="68" cy="100" rx="8" ry="6" fill="black" />
    </g>
  ),
  // Middle-right → neutral
  neutral: (
    <g>
      <ellipse cx="45" cy="55" rx="23" ry="25" fill="black" />
      <ellipse cx="37" cy="46" rx="7" ry="9" fill="white" />
      <ellipse cx="105" cy="55" rx="23" ry="25" fill="black" />
      <ellipse cx="97" cy="46" rx="7" ry="9" fill="white" />
      <ellipse cx="22" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="128" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <line x1="60" y1="94" x2="90" y2="94" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  // Bottom-left → sad
  sad: (
    <g>
      <path d="M26 52 Q45 37 64 52" stroke="black" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M86 52 Q105 37 124 52" stroke="black" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="72" rx="14" ry="9" fill="#FFB6C1" opacity="0.8" />
      <ellipse cx="130" cy="72" rx="14" ry="9" fill="#FFB6C1" opacity="0.8" />
      <path d="M60 95 Q75 85 90 95" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="75" cy="99" rx="10" ry="7" fill="#ff9999" />
    </g>
  ),
  // Bottom-middle → angry (slanted brows + downturned)
  angry: (
    <g>
      <path d="M22 32 L66 48" stroke="black" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M128 32 L84 48" stroke="black" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <ellipse cx="45" cy="60" rx="20" ry="22" fill="black" />
      <ellipse cx="40" cy="54" rx="6" ry="7" fill="white" />
      <ellipse cx="105" cy="60" rx="20" ry="22" fill="black" />
      <ellipse cx="100" cy="54" rx="6" ry="7" fill="white" />
      <ellipse cx="22" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.6" />
      <ellipse cx="128" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.6" />
      <path d="M58 100 Q75 90 92 100" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  // Bottom-right → surprised (huge round eyes, open "o" mouth)
  surprised: (
    <g>
      <ellipse cx="45" cy="55" rx="26" ry="28" fill="black" />
      <ellipse cx="36" cy="44" rx="9" ry="11" fill="white" />
      <ellipse cx="105" cy="55" rx="26" ry="28" fill="black" />
      <ellipse cx="96" cy="44" rx="9" ry="11" fill="white" />
      <ellipse cx="20" cy="86" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="130" cy="86" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="75" cy="100" rx="9" ry="11" fill="black" />
    </g>
  ),
  // listening reuses playful; thinking reuses neutral with a softer feel
  listening: (
    <g>
      <ellipse cx="45" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="38" cy="48" rx="7" ry="9" fill="white" />
      <ellipse cx="105" cy="55" rx="22" ry="24" fill="black" />
      <ellipse cx="98" cy="48" rx="7" ry="9" fill="white" />
      <path d="M28 36 Q45 28 58 38" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M92 38 Q105 28 122 36" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="25" cy="82" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="125" cy="82" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M60 97 Q75 87 90 97" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  thinking: (
    <g>
      <ellipse cx="45" cy="55" rx="23" ry="25" fill="black" />
      <ellipse cx="37" cy="46" rx="7" ry="9" fill="white" />
      <ellipse cx="105" cy="55" rx="23" ry="25" fill="black" />
      <ellipse cx="97" cy="46" rx="7" ry="9" fill="white" />
      <path d="M28 34 L60 32" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M90 32 L122 38" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="22" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <ellipse cx="128" cy="84" rx="12" ry="7" fill="#FFB6C1" opacity="0.7" />
      <path d="M58 95 Q75 92 92 95" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
};

interface Props {
  expression: ExpressionName;
}

export function LumiCalmFace({ expression }: Props) {
  // Track previous expression so we can cross-fade between the two layers.
  const [prev, setPrev] = useState<ExpressionName>(expression);
  const [curr, setCurr] = useState<ExpressionName>(expression);

  useEffect(() => {
    if (expression === curr) return;
    setPrev(curr);
    setCurr(expression);
  }, [expression, curr]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <svg
        viewBox="0 0 150 130"
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full drop-shadow-[0_25px_60px_rgba(80,140,255,0.45)]"
        role="img"
        aria-label={`Lumi expression — ${curr}`}
      >
        <g
          key={`prev-${prev}`}
          style={{ opacity: 0, transition: "opacity 300ms ease" }}
        >
          {FACES[prev]}
        </g>
        <g
          key={`curr-${curr}`}
          style={{ opacity: 1, transition: "opacity 300ms ease" }}
        >
          {FACES[curr]}
        </g>
      </svg>
    </div>
  );
}
