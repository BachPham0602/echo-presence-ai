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

/**
 * Kawaii/anime-style full-screen Lumi face for the "playful" variant.
 *
 * Modular: each feature (eye, brow, mouth, blush) is its own component and
 * is keyed by expression so React swaps them through a smooth fade. The
 * whole face also gently breathes and blinks for life.
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

  // Eye / brow / mouth / blush coordinates (viewBox 800x1000)
  const leftEyeCx = 270;
  const rightEyeCx = 530;
  const eyeCy = 400;
  const browCy = 280;
  const mouthCy = 580;
  const blushCy = 510;

  return (
    <div className="absolute inset-0 h-full w-full">
      {/* Soft ambient halo behind the face */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, oklch(0.55 0.2 250 / 0.45), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="lumi-breathe absolute inset-0">
        <svg
          viewBox="0 0 800 1000"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full drop-shadow-[0_30px_90px_rgba(120,160,255,0.4)]"
          role="img"
          aria-label={`Lumi kawaii — ${kawaii}`}
        >
          <defs>
            <filter id="kawaii-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="kawaii-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          <g
            transform="translate(400, 500) scale(1.15) translate(-400, -500)"
            style={{ transition: "transform 0.8s ease" }}
          >
            {/* Eyebrows */}
            <g style={{ transition: "opacity 0.35s ease" }} key={`brow-${p.brow}`}>
              <LumiEyebrow side="left" cx={leftEyeCx} cy={browCy} shape={p.brow} />
              <LumiEyebrow side="right" cx={rightEyeCx} cy={browCy} shape={p.brow} />
            </g>

            {/* Blush */}
            <LumiBlush cx={leftEyeCx - 20} cy={blushCy} intensity={p.blush} />
            <LumiBlush cx={rightEyeCx + 20} cy={blushCy} intensity={p.blush} />

            {/* Eyes — keyed by shape so swaps animate */}
            <g key={`eye-l-${p.leftEye}-${blink}`} className="animate-fade-in">
              <LumiEye cx={leftEyeCx} cy={eyeCy} shape={p.leftEye} side="left" blink={blink} />
            </g>
            <g key={`eye-r-${p.rightEye}-${blink}`} className="animate-fade-in">
              <LumiEye cx={rightEyeCx} cy={eyeCy} shape={p.rightEye} side="right" blink={blink} />
            </g>

            {/* Mouth */}
            <g key={`mouth-${p.mouth}`} className="animate-fade-in">
              <LumiMouth cx={400} cy={mouthCy} shape={p.mouth} />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
