interface LumiBlushProps {
  cx: number;
  cy: number;
  intensity?: number; // 0..1
}

/** Soft pink kawaii blush — flat oval with gentle glow. */
export function LumiBlush({ cx, cy, intensity = 0.7 }: LumiBlushProps) {
  const opacity = Math.max(0.15, Math.min(1, intensity));
  return (
    <g style={{ transition: "opacity 0.6s ease" }} opacity={opacity}>
      <ellipse
        cx={cx}
        cy={cy}
        rx={56}
        ry={20}
        fill="oklch(0.78 0.15 20)"
        filter="url(#kawaii-blur)"
      />
      <ellipse cx={cx} cy={cy} rx={48} ry={16} fill="oklch(0.82 0.14 18 / 0.9)" />
    </g>
  );
}
