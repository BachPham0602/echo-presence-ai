import type { UserEmotion } from "@/types/emotion";

interface EmotionIndicatorProps {
  emotion?: UserEmotion;
}

const LABELS: Record<UserEmotion, { label: string; emoji: string }> = {
  happy: { label: "Vui vẻ", emoji: "✨" },
  sad: { label: "Buồn", emoji: "🌧" },
  lonely: { label: "Cô đơn", emoji: "🌙" },
  stressed: { label: "Căng thẳng", emoji: "🌀" },
  tired: { label: "Mệt", emoji: "🌿" },
  neutral: { label: "Bình yên", emoji: "🍃" },
};

export function EmotionIndicator({ emotion }: EmotionIndicatorProps) {
  if (!emotion) return null;
  const { label, emoji } = LABELS[emotion];
  return (
    <div className="glass-pill flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-foreground/70">
      <span>{emoji}</span>
      <span>{label}</span>
    </div>
  );
}
