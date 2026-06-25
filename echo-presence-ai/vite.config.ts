// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execSync } from "node:child_process";

function gitInfo() {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const date = execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim();
    return { sha, date };
  } catch {
    return { sha: "unknown", date: new Date().toISOString() };
  }
}
const { sha: __GIT_SHA__, date: __GIT_DATE__ } = gitInfo();

export default defineConfig({
  define: {
    __GIT_SHA__: JSON.stringify(__GIT_SHA__),
    __GIT_DATE__: JSON.stringify(__GIT_DATE__),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/outputs": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
