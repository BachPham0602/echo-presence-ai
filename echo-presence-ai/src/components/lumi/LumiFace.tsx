import { useEffect, useState } from "react";

import type { LumiExpression } from "@/types/emotion";
import {
  KAWAII_PRESETS,
  kawaiiFromLumiExpression,
  type KawaiiExpression,
} from "./expressionPresets";
import { LumiEye } from "./LumiEye";
import { LumiEyebrow } from "./LumiEyebrow";
import { LumiMouth } from "./LumiMouth";
import { LumiBlush } from "./LumiBlush";

interface LumiFaceProps {
  expression: LumiExpression;
  /** Override automatic mapping with a direct kawaii preset name. */
  preset?: KawaiiExpression;
}

const SKIN = "#F8EDE3";
const SKIN_SHADOW = "#EBD9C5";

/**
 * Vector-style kawaii Lumi face. A clean round cream head sits at the
 * center of the viewBox; eyes, brows, mouth and blush are swapped per
 * expression with a smooth fade. Subtle auto-blink keeps it alive.
 */
export function LumiFace({ expression, preset }: LumiFaceProps) {
  const kawaii: KawaiiExpression = preset ?? kawaiiFromLumiExpression(expression);
  const p = KAWAII_PRESETS[kawaii];

  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      setBlink(true);
      window.setTimeout(() => !cancelled && setBlink(false), 130);
      window.setTimeout(loop, 2800 + Math.random() * 2400);
    };
    const t = window.setTimeout(loop, 1600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  // Geometry inside viewBox 800x1000 — face circle centered at (400, 520)
  const faceCx = 400;
  const faceCy = 520;
  const faceR = 280;

  const leftEyeCx = faceCx - 90;
  const rightEyeCx = faceCx + 90;
  const eyeCy = faceCy - 30;
  const browCy = eyeCy - 70;
  const mouthCy = faceCy + 90;
  const blushCy = faceCy + 40;

  const motionClass =
    kawaii === "excited"
      ? "kawaii-bounce"
      : kawaii === "playful"
        ? "kawaii-sway"
        : kawaii === "sleepy"
          ? "lumi-breathe"
          : "kawaii-bob";

  const isTalking = expression === "speaking";

  return (
    <div className="absolute inset-0 h-full w-full">
      <div className={`${motionClass} absolute inset-0`}>
        <svg
          viewBox="0 0 800 1000"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full drop-shadow-[0_25px_60px_rgba(120,80,200,0.35)]"
          role="img"
          aria-label={`Lumi kawaii — ${kawaii}`}
        >
          <defs>
            <radialGradient id="lumi-face-fill" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor={SKIN} />
              <stop offset="85%" stopColor={SKIN} />
              <stop offset="100%" stopColor={SKIN_SHADOW} />
            </radialGradient>
          </defs>

          <g style={{ transition: "transform 0.8s ease" }}>
            {/* Head */}
            <circle
              cx={faceCx}
              cy={faceCy}
              r={faceR}
              fill="url(#lumi-face-fill)"
              stroke={SKIN_SHADOW}
              strokeWidth={3}
            />

            {/* Blush */}
            <g className="kawaii-blush-pulse">
              <LumiBlush cx={leftEyeCx - 10} cy={blushCy} intensity={p.blush} />
            </g>
            <g className="kawaii-blush-pulse" style={{ animationDelay: "-1.3s" }}>
              <LumiBlush cx={rightEyeCx + 10} cy={blushCy} intensity={p.blush} />
            </g>

            {/* Eyebrows */}
            <g key={`brow-${p.brow}`} className="animate-fade-in">
              <LumiEyebrow side="left" cx={leftEyeCx} cy={browCy} shape={p.brow} />
              <LumiEyebrow side="right" cx={rightEyeCx} cy={browCy} shape={p.brow} />
            </g>

            {/* Eyes */}
            <g key={`eye-l-${p.leftEye}-${blink}`} className="animate-fade-in">
              <LumiEye cx={leftEyeCx} cy={eyeCy} shape={p.leftEye} side="left" blink={blink} />
            </g>
            <g key={`eye-r-${p.rightEye}-${blink}`} className="animate-fade-in">
              <LumiEye cx={rightEyeCx} cy={eyeCy} shape={p.rightEye} side="right" blink={blink} />
            </g>

            {/* Mouth */}
            <g
              key={`mouth-${p.mouth}-${isTalking}`}
              className={`animate-fade-in ${isTalking ? "kawaii-mouth-talk" : ""}`}
            >
              <LumiMouth cx={faceCx} cy={mouthCy} shape={p.mouth} />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
