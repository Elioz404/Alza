import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
      const partner = partnerOrigin.replace(/\/$/, "");
      const studio = studioOrigin.replace(/\/$/, "");
      const lines = [
        "/*",
        "  X-Content-Type-Options: nosniff",
        "  Referrer-Policy: strict-origin-when-cross-origin",
      ];
      lines.push(`  Permissions-Policy: tools=(self${partner ? ` "${partner}"` : ""})`);
      lines.push(`  Content-Security-Policy: frame-ancestors 'self'${studio ? ` ${studio}` : ""}`);
      this.emitFile({ type: "asset", fileName: "_headers", source: lines.join("\n") + "\n" });
    },
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv, not process.env: Vite injects .env into import.meta.env for the
  // bundle but leaves process.env alone, so the header plugin saw nothing.
  const env = loadEnv(mode, __dirname, "");
  return {
  plugins: [react(), crossOriginHeaders(env.VITE_SUPPLIER_ORIGIN ?? "", env.VITE_STUDIO_ORIGIN ?? "")],
  base: "./",
  // Pinned: the README, e2e-full.mjs's default BASE and the partner script all assume
  // 5199 for the studio and 5200 for the shop. Without this Vite picks 5173 and the
  // documented commands quietly fail to connect.
  server: { port: 5199, strictPort: true },
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
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  } as never;
});
