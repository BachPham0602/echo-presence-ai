declare const __GIT_SHA__: string;
declare const __GIT_DATE__: string;
declare const __BUILD_TIME__: string;

export function SyncBadge() {
  const sha = (typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "unknown").slice(0, 7);
  const date = typeof __GIT_DATE__ !== "undefined" ? __GIT_DATE__ : "";
  const built = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "";

  const fmt = (iso: string) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div
      className="pointer-events-auto fixed bottom-2 right-2 z-50 rounded-md border border-white/15 bg-black/55 px-2 py-1 font-mono text-[10px] leading-tight text-white/80 backdrop-blur-md"
      title={`Commit: ${sha}\nCommit time: ${fmt(date)}\nBuilt: ${fmt(built)}`}
    >
      <div>
        <span className="opacity-60">sha </span>
        <span className="text-white">{sha}</span>
      </div>
      <div>
        <span className="opacity-60">sync </span>
        <span>{fmt(date)}</span>
      </div>
    </div>
  );
}
