import type { MouthShape } from "./expressionPresets";

interface LumiMouthProps {
  cx: number;
  cy: number;
  shape: MouthShape;
}

/**
 * Kawaii mouth shapes. Centered on (cx, cy). Uses soft pink/red fills for
 * open-mouth variants and a glowing white stroke for line shapes.
 */
export function LumiMouth({ cx, cy, shape }: LumiMouthProps) {
  const stroke = "oklch(0.97 0.02 240)";
  const lip = "oklch(0.65 0.22 25)"; // warm coral
  const tongue = "oklch(0.7 0.24 20)";

  switch (shape) {
    case "smile-small":
      return (
        <path
          d={`M ${cx - 38} ${cy} q 38 28 76 0`}
          stroke={stroke}
          strokeWidth={10}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );
    case "smile-open": {
      // small open smile with rounded "D" shape
      const w = 60;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 6} Q ${cx} ${cy + 48} ${cx + w} ${cy - 6} Q ${cx} ${cy + 4} ${cx - w} ${cy - 6} Z`}
            fill={lip}
            stroke={stroke}
            strokeWidth={7}
            strokeLinejoin="round"
            filter="url(#kawaii-glow)"
          />
        </g>
      );
    }
    case "smile-big": {
      const w = 78;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 8} Q ${cx} ${cy + 70} ${cx + w} ${cy - 8} Q ${cx} ${cy} ${cx - w} ${cy - 8} Z`}
            fill={lip}
            stroke={stroke}
            strokeWidth={8}
            strokeLinejoin="round"
            filter="url(#kawaii-glow)"
          />
          {/* little inner tongue hint */}
          <ellipse cx={cx} cy={cy + 30} rx={28} ry={14} fill={tongue} opacity={0.85} />
        </g>
      );
    }
    case "tongue": {
      const w = 55;
      return (
        <g>
          {/* mouth */}
          <path
            d={`M ${cx - w} ${cy - 4} Q ${cx} ${cy + 36} ${cx + w} ${cy - 4} Q ${cx} ${cy + 2} ${cx - w} ${cy - 4} Z`}
            fill={lip}
            stroke={stroke}
            strokeWidth={7}
            strokeLinejoin="round"
            filter="url(#kawaii-glow)"
          />
          {/* tongue sticking down */}
          <path
            d={`M ${cx - 22} ${cy + 18} Q ${cx} ${cy + 70} ${cx + 22} ${cy + 18} Q ${cx} ${cy + 30} ${cx - 22} ${cy + 18} Z`}
            fill={tongue}
            stroke={stroke}
            strokeWidth={5}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    case "frown":
      return (
        <path
          d={`M ${cx - 44} ${cy + 22} q 44 -42 88 0`}
          stroke={stroke}
          strokeWidth={11}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );
    case "relaxed":
      return (
        <path
          d={`M ${cx - 28} ${cy + 4} q 28 14 56 0`}
          stroke={stroke}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );
    case "uncertain":
      // small wavy line
      return (
        <path
          d={`M ${cx - 40} ${cy + 6} q 20 -14 40 0 t 40 0`}
          stroke={stroke}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );
    default:
      return null;
  }
}
