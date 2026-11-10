import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_DEV_ORIGIN, STUDIO_DEV_PORT, resolveOrigins } from "./config/origins.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Emit a `_headers` file (read identically by Cloudflare Pages and Netlify) so the two
 * origins can find each other. The SAME dist/ is published to both hosts, so one file has to
 * serve both roles — which is fine, since each directive is harmless on the other side:
 *
 *  - `Permissions-Policy: tools=…` lets the studio delegate the `tools` feature to the partner
 *    frame. Without the feature, `allow="tools"` on the iframe has nothing to delegate and the
 *    embedded origin cannot register WebMCP tools at all.
 *  - `frame-ancestors` lets the studio embed the partner, and stops anyone else embedding
 *    either of them.
 */
function crossOriginHeaders(partnerOrigin: string, studioOrigin: string): Plugin {
  return {
    name: "alza-cross-origin-headers",
    apply: "build",
    generateBundle() {
      // both arrive validated and canonical from config/origins.js
      const lines = [
        "/*",
        "  X-Content-Type-Options: nosniff",
        "  Referrer-Policy: strict-origin-when-cross-origin",
        `  Permissions-Policy: tools=(self "${partnerOrigin}")`,
        `  Content-Security-Policy: frame-ancestors 'self' ${studioOrigin}`,
      ];
      this.emitFile({ type: "asset", fileName: "_headers", source: lines.join("\n") + "\n" });
    },
  };
}

// vitest's defineConfig types the `test` block, so the config is checked as a whole
// (tsconfig.node.json) instead of being cast past the compiler.
export default defineConfig(({ command, mode }) => {
  // loadEnv, not process.env: Vite injects .env into import.meta.env for the
  // bundle but leaves process.env alone, so the header plugin saw nothing.
  const env = loadEnv(mode, __dirname, "");
  // Every build ships, so every build must name both origins; resolveOrigins throws (and the
  // build stops) when one is missing or is not a bare https origin. The dev server and the
  // tests fall back to the local ports.
  const origins = resolveOrigins(env, { production: command === "build" });
  return {
    plugins: [react(), crossOriginHeaders(origins.supplier, origins.studio)],
    base: "./",
    // Pinned and strict: the partner only authorises the studio's dev port, and a silently
    // bumped port would be an origin nobody trusts.
    server: { port: STUDIO_DEV_PORT, strictPort: true },
    build: {
      // two entry points: the studio, and the partner catalogue that ships as its own origin
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          partner: resolve(__dirname, "partner/index.html"),
        },
      },
    },
    test: {
      // The store, registry and supplier read `window`, `document` and `location` as they
      // load, so the suite runs in a DOM instead of stubbing those globals by hand. The DOM
      // sits on the dev server's origin, so import-time reads see what `npm run dev` sees.
      environment: "happy-dom",
      environmentOptions: { happyDOM: { url: `${STUDIO_DEV_ORIGIN}/` } },
      include: ["tests/**/*.test.ts"],
    },
  };
});
