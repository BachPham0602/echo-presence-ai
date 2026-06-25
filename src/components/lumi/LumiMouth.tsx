import type { MouthShape } from "./expressionPresets";

interface LumiMouthProps {
  cx: number;
  cy: number;
  shape: MouthShape;
}

/**
 * Kawaii mouth shapes, mirroring the 9-expression reference sheet.
 * Open-mouth variants use a warm coral lip + bright tongue.
 */
export function LumiMouth({ cx, cy, shape }: LumiMouthProps) {
  const stroke = "oklch(0.98 0.02 240)";
  const lip = "oklch(0.32 0.16 18)"; // dark coral mouth interior
  const tongue = "oklch(0.68 0.24 18)";

  switch (shape) {
    case "smile-small":
      return (
        <path
          d={`M ${cx - 40} ${cy} q 40 30 80 0`}
          stroke={stroke}
          strokeWidth={10}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );

    case "smile-double":
      // two side-by-side cute arcs ⌣⌣
      return (
        <g stroke={stroke} strokeWidth={11} strokeLinecap="round" fill="none" filter="url(#kawaii-glow)">
          <path d={`M ${cx - 70} ${cy + 4} q 28 32 56 0`} />
          <path d={`M ${cx + 14} ${cy + 4} q 28 32 56 0`} />
        </g>
      );

    case "smile-open": {
      const w = 62;
      return (
        <path
          d={`M ${cx - w} ${cy - 6} Q ${cx} ${cy + 50} ${cx + w} ${cy - 6} Q ${cx} ${cy + 4} ${cx - w} ${cy - 6} Z`}
          fill={lip}
          stroke={stroke}
          strokeWidth={7}
          strokeLinejoin="round"
          filter="url(#kawaii-glow)"
        />
      );
    }

    case "smile-big": {
      const w = 82;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 8} Q ${cx} ${cy + 78} ${cx + w} ${cy - 8} Q ${cx} ${cy} ${cx - w} ${cy - 8} Z`}
            fill={lip}
            stroke={stroke}
            strokeWidth={8}
            strokeLinejoin="round"
            filter="url(#kawaii-glow)"
          />
          <ellipse cx={cx} cy={cy + 36} rx={32} ry={16} fill={tongue} opacity={0.95} />
        </g>
      );
    }

    case "tongue": {
      const w = 58;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 4} Q ${cx} ${cy + 40} ${cx + w} ${cy - 4} Q ${cx} ${cy + 2} ${cx - w} ${cy - 4} Z`}
            fill={lip}
            stroke={stroke}
            strokeWidth={7}
            strokeLinejoin="round"
            filter="url(#kawaii-glow)"
          />
          {/* tongue peeking out */}
          <path
            d={`M ${cx - 24} ${cy + 20} Q ${cx} ${cy + 78} ${cx + 24} ${cy + 20} Q ${cx} ${cy + 34} ${cx - 24} ${cy + 20} Z`}
            fill={tongue}
            stroke={stroke}
            strokeWidth={5}
            strokeLinejoin="round"
          />
        </g>
      );
    }

    case "ohh":
      // surprised vertical oval mouth
      return (
        <g>
          <ellipse
            cx={cx}
            cy={cy + 10}
            rx={30}
            ry={42}
            fill={lip}
            stroke={stroke}
            strokeWidth={7}
            filter="url(#kawaii-glow)"
          />
          <ellipse cx={cx} cy={cy + 26} rx={20} ry={16} fill={tongue} />
        </g>
      );

    case "frown":
      return (
        <path
          d={`M ${cx - 46} ${cy + 26} q 46 -50 92 0`}
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
          d={`M ${cx - 30} ${cy + 4} q 30 16 60 0`}
          stroke={stroke}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          filter="url(#kawaii-glow)"
        />
      );

    case "uncertain":
    case "wavy":
      return (
        <path
          d={`M ${cx - 44} ${cy + 6} q 14 -16 28 0 t 28 0 t 28 0`}
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
