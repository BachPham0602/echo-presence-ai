interface LumiBlushProps {
  cx: number;
  cy: number;
  intensity?: number;
}

/** Soft pink kawaii blush — flat oval matching the vector reference. */
export function LumiBlush({ cx, cy, intensity = 0.8 }: LumiBlushProps) {
  const opacity = Math.max(0.2, Math.min(1, intensity));
  return (
    <g style={{ transition: "opacity 0.6s ease" }} opacity={opacity}>
      <ellipse cx={cx} cy={cy} rx={28} ry={12} fill="#f4a3b5" />
    </g>
  );
}
