/**
 * Two origins, one dist. The studio and the partner must be DIFFERENT origins for the
 * cross-origin WebMCP exchange to be real, and the browser only delegates the `tools`
 * feature when the headers say so — Netlify/Cloudflare read those from dist/_headers,
 * which a plain static server ignores. So this sets them itself.
 *
 *   npm run serve:local        # studio :5173, partner :5200   (or: node scripts/serve-local.mjs)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fromRoot } from "./paths.mjs";

const ROOT = fromRoot("dist");
// Each origin's port is written once; the URLs the headers name and the ports the servers
// bind are both derived from it, so the two cannot disagree.
const STUDIO_PORT = 5173;
const PARTNER_PORT = 5200;
const localOrigin = (port) => `http://localhost:${port}`;
const STUDIO = localOrigin(STUDIO_PORT);
const PARTNER = localOrigin(PARTNER_PORT);
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
      res.setHeader("Permissions-Policy", `tools=(self "${PARTNER}")`);
      res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${STUDIO}`);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  }).listen(port, () => console.log(`  ${localOrigin(port)}`));

serve(STUDIO_PORT);
serve(PARTNER_PORT);
console.log("sirviendo dist/ en dos origenes; Ctrl+C para parar");
