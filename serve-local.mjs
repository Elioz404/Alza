/**
 * Two origins, one dist. The studio and the partner must be DIFFERENT origins for the
 * cross-origin WebMCP exchange to be real, and the browser only delegates the `tools`
 * feature when the headers say so — Netlify/Cloudflare read those from dist/_headers,
 * which a plain static server ignores. So this sets them itself.
 *
 *   node serve-local.mjs        # studio :5173, partner :5200
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const STUDIO = "http://localhost:5173";
const PARTNER = "http://localhost:5200";
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
  }).listen(port, () => console.log(`  http://localhost:${port}`));

serve(5173);
serve(5200);
console.log("sirviendo dist/ en dos origenes; Ctrl+C para parar");
