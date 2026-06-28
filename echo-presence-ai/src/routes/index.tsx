import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Radio, Mic, Heart, Zap, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumi – Chọn người bạn đồng hành" },
      {
        name: "description",
        content:
          "Chọn cách trò chuyện với Lumi: Message Chat với Lumi điềm tĩnh, hoặc Live Chat với Lumi nhí nhảnh.",
      },
      { property: "og:title", content: "Lumi – Chọn người bạn đồng hành" },
      {
        property: "og:description",
        content: "Hai phong cách Lumi, một trái tim ấm áp lắng nghe bạn.",
      },
    ],
  }),
  component: LumiLanding,
});

function LumiLanding() {
  return (
    <main
      className="lumi-landing fixed inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 20% 10%, oklch(0.78 0.18 280 / 0.9), transparent 55%), radial-gradient(ellipse at 80% 90%, oklch(0.72 0.2 330 / 0.7), transparent 55%), linear-gradient(160deg, oklch(0.42 0.16 270), oklch(0.32 0.14 260) 50%, oklch(0.28 0.12 285))",
      }}
    >
      {/* Animated floating gradient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="lumi-blob"
          style={{
            top: "-10%",
            left: "-8%",
            width: "520px",
            height: "520px",
            background: "radial-gradient(circle, oklch(0.78 0.2 250 / 0.55), transparent 70%)",
            animation: "lumi-blob-float 18s ease-in-out infinite",
          }}
        />
        <div
          className="lumi-blob"
          style={{
            bottom: "-15%",
            right: "-10%",
            width: "600px",
            height: "600px",
            background: "radial-gradient(circle, oklch(0.74 0.22 330 / 0.5), transparent 70%)",
            animation: "lumi-blob-float 22s ease-in-out infinite reverse",
          }}
        />
        <div
          className="lumi-blob"
          style={{
            top: "40%",
            left: "55%",
            width: "380px",
            height: "380px",
            background: "radial-gradient(circle, oklch(0.8 0.18 210 / 0.4), transparent 70%)",
            animation: "lumi-blob-float 26s ease-in-out infinite",
            animationDelay: "-8s",
          }}
        />

        {/* Sparkle particles */}
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="lumi-particle"
            style={{
              left: `${(i * 53) % 100}%`,
              top: `${(i * 37) % 100}%`,
              animationDelay: `${(i % 9) * 0.7}s`,
              animationDuration: `${5 + (i % 5)}s`,
            }}
          />
        ))}
      </div>

      {/* Glass overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent, oklch(0.2 0.08 270 / 0.18) 70%, oklch(0.18 0.08 270 / 0.35))",
          backdropFilter: "blur(2px)",
        }}
      />

      <div className="lumi-fade-in relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col items-center justify-center overflow-y-auto px-5 py-8">
        {/* Floating avatar */}
        <div
          className="lumi-float relative mb-5 flex h-20 w-20 items-center justify-center rounded-full sm:h-24 sm:w-24"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, oklch(0.92 0.12 240), oklch(0.62 0.2 270) 70%)",
            boxShadow:
              "0 0 60px oklch(0.7 0.22 260 / 0.7), 0 0 120px oklch(0.7 0.22 290 / 0.45), inset 0 -10px 20px oklch(0.3 0.1 270 / 0.4)",
          }}
        >
          <Sparkles className="h-9 w-9 text-white drop-shadow-lg sm:h-11 sm:w-11" strokeWidth={1.8} />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: "inset 0 0 30px oklch(1 0 0 / 0.25)",
            }}
          />
        </div>

        {/* Title */}
        <h1
          className="text-center text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl"
          style={{
            textShadow: "0 6px 30px oklch(0.4 0.18 270 / 0.7)",
            background:
              "linear-gradient(180deg, #ffffff, oklch(0.88 0.08 260))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Chào mừng đến với Lumi
        </h1>
        <p className="mt-3 max-w-lg text-center text-sm text-white/85 sm:text-base md:text-lg">
          Người bạn đồng hành luôn sẵn sàng lắng nghe bạn.
        </p>

        {/* Main chat cards */}
        <div className="mt-8 grid w-full max-w-4xl gap-5 sm:mt-10 sm:grid-cols-2">
          <ChatCard
            to="/calm"
            icon={<MessageCircle className="h-9 w-9 text-white" strokeWidth={1.8} />}
            title="Message Chat"
            subtitle={
              <>
                Trò chuyện cùng <strong>Lumi điềm tĩnh</strong>
                <br />
                — dịu dàng, sâu lắng.
              </>
            }
            gradient="linear-gradient(140deg, oklch(0.72 0.18 240 / 0.55), oklch(0.55 0.2 270 / 0.55))"
            glow="oklch(0.7 0.2 250 / 0.7)"
            delay="0.15s"
          />
          <ChatCard
            to="/playful"
            icon={<Radio className="h-9 w-9 text-white" strokeWidth={1.8} />}
            title="Live Chat"
            subtitle={
              <>
                Trò chuyện cùng <strong>Lumi nhí nhảnh</strong>
                <br />
                — vui tươi, năng động.
              </>
            }
            gradient="linear-gradient(140deg, oklch(0.78 0.2 50 / 0.55), oklch(0.68 0.22 340 / 0.55))"
            glow="oklch(0.78 0.22 340 / 0.7)"
            delay="0.3s"
          />
        </div>

        {/* Feature cards */}
        <div className="mt-8 grid w-full max-w-4xl gap-3 sm:grid-cols-3">
          <FeatureCard
            icon={<Mic className="h-5 w-5 text-white" />}
            title="Voice-first Conversation"
            desc="Trò chuyện tự nhiên với Lumi bằng giọng nói."
            delay="0.45s"
          />
          <FeatureCard
            icon={<Heart className="h-5 w-5 text-white" />}
            title="Emotional Companion"
            desc="Lumi lắng nghe, đồng cảm và luôn bên bạn."
            delay="0.55s"
          />
          <FeatureCard
            icon={<Zap className="h-5 w-5 text-white" />}
            title="Fast AI Response"
            desc="Phản hồi nhanh, mượt và rất tự nhiên."
            delay="0.65s"
          />
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-xs tracking-wide text-white/45">
          Lumi • AI Companion Demo
        </footer>
      </div>

      <style>{landingStyles}</style>
    </main>
  );
}

function ChatCard({
  to,
  icon,
  title,
  subtitle,
  gradient,
  glow,
  delay,
}: {
  to: "/calm" | "/playful";
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  gradient: string;
  glow: string;
  delay: string;
}) {
  return (
    <Link
      to={to}
      className="lumi-card-in group relative flex flex-col items-center gap-4 overflow-hidden rounded-[28px] px-6 py-9 text-center"
      style={
        {
          background: gradient,
          backdropFilter: "blur(22px) saturate(160%)",
          border: "1px solid oklch(1 0 0 / 0.22)",
          boxShadow:
            "0 20px 60px -20px oklch(0.15 0.1 270 / 0.65), inset 0 1px 0 oklch(1 0 0 / 0.25)",
          animationDelay: delay,
          ["--glow" as string]: glow,
        } as React.CSSProperties
      }
    >
      <span aria-hidden className="lumi-card-border" />

      <div
        className="lumi-icon-circle relative grid h-20 w-20 place-items-center rounded-full"
        style={{
          background: "oklch(1 0 0 / 0.18)",
          boxShadow: `0 0 0 1px oklch(1 0 0 / 0.25), 0 0 40px var(--glow)`,
        }}
      >
        <span aria-hidden className="lumi-icon-pulse" style={{ background: glow }} />
        {icon}
      </div>
      <h2 className="text-2xl font-semibold text-white drop-shadow">{title}</h2>
      <p className="text-sm leading-relaxed text-white/90 sm:text-[15px]">{subtitle}</p>
    </Link>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  delay: string;
}) {
  return (
    <div
      className="lumi-card-in flex items-start gap-3 rounded-2xl px-4 py-4 text-left"
      style={{
        background: "oklch(1 0 0 / 0.08)",
        backdropFilter: "blur(18px) saturate(140%)",
        border: "1px solid oklch(1 0 0 / 0.15)",
        boxShadow: "0 10px 30px -18px oklch(0.1 0.08 270 / 0.6)",
        animationDelay: delay,
      }}
    >
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.75 0.2 260 / 0.9), oklch(0.7 0.22 320 / 0.9))",
          boxShadow: "0 0 18px oklch(0.7 0.2 270 / 0.55)",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-white">{title}</h3>
        <p className="mt-0.5 text-xs leading-snug text-white/75">{desc}</p>
      </div>
    </div>
  );
}

const landingStyles = `
@keyframes lumi-blob-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(40px, -30px) scale(1.08); }
  66%      { transform: translate(-30px, 40px) scale(0.95); }
}
.lumi-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(60px);
  will-change: transform;
}
@keyframes lumi-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-10px); }
}
.lumi-float { animation: lumi-float 4.5s ease-in-out infinite; }

@keyframes lumi-particle {
  0%   { transform: translateY(0) scale(0.6); opacity: 0; }
  20%  { opacity: 0.9; }
  100% { transform: translateY(-60px) scale(1); opacity: 0; }
}
.lumi-particle {
  position: absolute;
  width: 4px; height: 4px;
  border-radius: 9999px;
  background: oklch(1 0 0 / 0.9);
  box-shadow: 0 0 10px oklch(0.9 0.1 260 / 0.9);
  animation: lumi-particle 6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes lumi-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.lumi-fade-in { animation: lumi-fade-in 0.8s ease-out both; }

@keyframes lumi-card-in {
  from { opacity: 0; transform: translateY(18px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.lumi-card-in {
  animation: lumi-card-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition: transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease;
}
.lumi-card-in:hover {
  transform: translateY(-6px) scale(1.03);
  box-shadow: 0 30px 70px -20px oklch(0.1 0.1 270 / 0.75), 0 0 0 1px oklch(1 0 0 / 0.35);
}

.lumi-card-border {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.5px;
  background: conic-gradient(from 0deg, transparent, var(--glow), transparent 40%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.4s ease;
  animation: lumi-rotate 6s linear infinite;
  pointer-events: none;
}
.group:hover .lumi-card-border { opacity: 1; }
@keyframes lumi-rotate {
  to { transform: rotate(360deg); }
}

.lumi-icon-pulse {
  position: absolute;
  inset: -4px;
  border-radius: 9999px;
  opacity: 0.4;
  filter: blur(12px);
  animation: lumi-icon-pulse 2.6s ease-in-out infinite;
}
@keyframes lumi-icon-pulse {
  0%, 100% { transform: scale(1);    opacity: 0.35; }
  50%      { transform: scale(1.15); opacity: 0.7; }
}

@media (prefers-reduced-motion: reduce) {
  .lumi-blob, .lumi-float, .lumi-particle, .lumi-card-in, .lumi-fade-in,
  .lumi-card-border, .lumi-icon-pulse {
    animation: none !important;
  }
  .lumi-card-in:hover { transform: none; }
}
`;
