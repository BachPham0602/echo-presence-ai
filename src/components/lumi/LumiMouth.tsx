import type { MouthShape } from "./expressionPresets";

interface LumiMouthProps {
  cx: number;
  cy: number;
  shape: MouthShape;
}

const DARK = "#020617";
const TONGUE = "#f4849a";

/**
 * Vector kawaii mouth shapes matching the 9-expression reference sheet.
 */
export function LumiMouth({ cx, cy, shape }: LumiMouthProps) {
  switch (shape) {
    case "smile-small":
      return (
        <path
          d={`M ${cx - 22} ${cy} Q ${cx} ${cy + 14} ${cx + 22} ${cy}`}
          stroke={DARK}
          strokeWidth={6}
          strokeLinecap="round"
          fill="none"
        />
      );

    case "smile-double":
      return (
        <g stroke={DARK} strokeWidth={6} strokeLinecap="round" fill="none">
          <path d={`M ${cx - 50} ${cy} Q ${cx - 25} ${cy + 22} ${cx} ${cy}`} />
          <path d={`M ${cx} ${cy} Q ${cx + 25} ${cy + 22} ${cx + 50} ${cy}`} />
        </g>
      );

    case "smile-open": {
      const w = 46;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 4} Q ${cx} ${cy + 40} ${cx + w} ${cy - 4} Q ${cx} ${cy + 4} ${cx - w} ${cy - 4} Z`}
            fill={DARK}
            stroke={DARK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <ellipse cx={cx + 6} cy={cy + 22} rx={16} ry={9} fill={TONGUE} />
        </g>
      );
    }

    case "smile-big": {
      const w = 60;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 6} Q ${cx} ${cy + 60} ${cx + w} ${cy - 6} Q ${cx} ${cy + 2} ${cx - w} ${cy - 6} Z`}
            fill={DARK}
            stroke={DARK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <ellipse cx={cx} cy={cy + 30} rx={26} ry={14} fill={TONGUE} />
        </g>
      );
    }

    case "tongue": {
      const w = 44;
      return (
        <g>
          <path
            d={`M ${cx - w} ${cy - 2} Q ${cx} ${cy + 34} ${cx + w} ${cy - 2} Q ${cx} ${cy + 4} ${cx - w} ${cy - 2} Z`}
            fill={DARK}
            stroke={DARK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {/* tongue sticking out lower right */}
          <path
            d={`M ${cx + 6} ${cy + 18} Q ${cx + 30} ${cy + 50} ${cx + 38} ${cy + 28} Q ${cx + 24} ${cy + 16} ${cx + 6} ${cy + 18} Z`}
            fill={TONGUE}
            stroke={DARK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </g>
      );
    }

    case "ohh":
      return (
        <g>
          <ellipse
            cx={cx}
            cy={cy + 6}
            rx={20}
            ry={28}
            fill={DARK}
          />
          <ellipse cx={cx} cy={cy + 18} rx={12} ry={10} fill={TONGUE} opacity={0.85} />
        </g>
      );

    case "frown":
      return (
        <path
          d={`M ${cx - 30} ${cy + 16} Q ${cx} ${cy - 14} ${cx + 30} ${cy + 16}`}
          stroke={DARK}
          strokeWidth={6}
          strokeLinecap="round"
          fill="none"
        />
      );

    case "relaxed":
      return (
        <path
          d={`M ${cx - 22} ${cy + 2} Q ${cx} ${cy + 10} ${cx + 22} ${cy + 2}`}
          stroke={DARK}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
      );

    case "uncertain":
    case "wavy":
      return (
        <path
          d={`M ${cx - 34} ${cy + 4} q 11 -12 22 0 t 22 0 t 22 0`}
          stroke={DARK}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
      );

    default:
      return null;
  }
}
