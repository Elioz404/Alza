/**
 * Two origins, one dist. The studio and the partner must be DIFFERENT origins for the
 * cross-origin WebMCP exchange to be real, and the browser only delegates the `tools`
 * feature when the headers say so — Netlify/Cloudflare read those from dist/_headers,
 * which a plain static server ignores. So this sets them itself.
 *
 *   npm run serve:local        # studio and partner on their dev ports   (or: node scripts/serve-local.mjs)
 *
 * The ports are the dev ports from config/origins.js, so the studio here sits on the origin
 * the partner already authorises. dist/ carries whatever origins it was built with; to point
 * a build at these two servers, run `npm run build` with VITE_STUDIO_ORIGIN and
 * VITE_SUPPLIER_ORIGIN set to the two origins this prints (process env beats .env.production).
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fromRoot } from "./paths.mjs";
import { PARTNER_DEV_ORIGIN, PARTNER_DEV_PORT, STUDIO_DEV_ORIGIN, STUDIO_DEV_PORT, devOrigin } from "../config/origins.js";

const ROOT = fromRoot("dist");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const serve = (port) =>
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = resolve(join(ROOT, normalize(p)));
    if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end("forbidden"); return; }
    try {
      if ((await stat(file)).isDirectory()) throw new Error("dir");
      const body = await readFile(file);
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      // the two headers dist/_headers carries in production
      res.setHeader("Permissions-Policy", `tools=(self "${PARTNER_DEV_ORIGIN}")`);
      res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${STUDIO_DEV_ORIGIN}`);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  }).listen(port, () => console.log(`  ${devOrigin(port)}`));

serve(STUDIO_DEV_PORT);
serve(PARTNER_DEV_PORT);
console.log("sirviendo dist/ en dos origenes; Ctrl+C para parar");
