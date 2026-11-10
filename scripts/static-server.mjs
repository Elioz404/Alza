/**
 * The request handling behind serve-local.mjs, kept apart from the listening so it can be
 * tested without opening a port.
 *
 * Two things a static server must get right, and the first version did not:
 *  - a malformed percent-escape (`/%E0%A4%A`) is the client's mistake, answered 400. It used
 *    to throw out of the async handler as an unhandled rejection, which ends the Node process.
 *  - a request may only ever reach files under the root. The check is `path.relative`: a
 *    target whose path relative to the root climbs out (`..`) or lands on another drive is
 *    refused, whatever mix of slashes, backslashes and escapes produced it. A string prefix
 *    test is not enough — `/srv/dist-old` starts with `/srv/dist`.
 */
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { INDEX_FILE } from "../config/sites.js";

export const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
});

/**
 * The part of http.ServerResponse the handler uses (static-server.d.mts declares the same).
 *
 * @typedef {{ statusCode: number, readonly headersSent: boolean,
 *   setHeader(name: string, value: string): unknown, end(body?: unknown): unknown }} ResponseLike
 */

/**
 * Map a raw request URL to a file under `root`.
 *
 * @param {string} root resolved against the working directory when relative
 * @param {string} rawUrl the request target, as it arrived
 * @returns {{ status: 200, file: string, path: string } | { status: 400 | 403, reason: string, path: string }}
 *   `path` is the request path header rules are matched against: decoded, or as it arrived
 *   when it cannot be decoded (a host still answers that request, and still sends headers)
 */
export function resolveRequestFile(root, rawUrl) {
  const base = resolve(root);
  let raw;
  try {
    // the base only gives a relative target something to resolve against; just the path is used
    raw = new URL(rawUrl, "http://request.invalid").pathname;
  } catch {
    return { status: 400, reason: "malformed request path", path: "/" };
  }
  let path;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return { status: 400, reason: "malformed request path", path: raw };
  }
  if (path.includes("\0")) return { status: 400, reason: "malformed request path", path: raw };
  const file = resolve(base, `.${path.endsWith("/") ? path + INDEX_FILE : path}`);
  const rel = relative(base, file);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { status: 403, reason: "outside the served root", path };
  return { status: 200, file, path };
}

/**
 * A request handler serving files under `root`, with `headersFor(path)` added to every
 * response — the files it serves and its 400/403/404/500 answers alike, since a host applies
 * its header rules to error responses too. It never rejects: anything unexpected becomes a
 * 500 for that one request.
 *
 * @param {{ root: string, headersFor: (path: string) => Record<string, string> }} options
 * @returns {(req: { url?: string }, res: ResponseLike) => Promise<void>}
 */
export function createStaticHandler({ root, headersFor }) {
  const base = resolve(root);
  /**
   * @param {ResponseLike} res
   * @param {string} path
   * @param {number} status
   * @param {string} type
   * @param {unknown} body
   */
  const send = (res, path, status, type, body) => {
    for (const [name, value] of Object.entries(headersFor(path))) res.setHeader(name, value);
    res.statusCode = status;
    res.setHeader("Content-Type", type);
    res.end(body);
  };
  /**
   * @param {ResponseLike} res
   * @param {string} path
   * @param {number} status
   * @param {string} text
   */
  const fail = (res, path, status, text) => send(res, path, status, CONTENT_TYPES[".txt"], text);
  return async (req, res) => {
    let path = "/";
    try {
      const target = resolveRequestFile(base, req.url ?? "/");
      path = target.path;
      if (target.status !== 200) return fail(res, path, target.status, target.reason);
      let body;
      try {
        if ((await stat(target.file)).isDirectory()) return fail(res, path, 404, "not found");
        body = await readFile(target.file);
      } catch {
        return fail(res, path, 404, "not found");
      }
      const type = CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extname(target.file))] ?? "application/octet-stream";
      send(res, path, 200, type, body);
    } catch (err) {
      console.error("[serve-local]", err);
      if (res.headersSent) return void res.end();
      try {
        fail(res, path, 500, "internal error");
      } catch {
        // headersFor itself is what failed: answer the 500 bare rather than not at all
        res.statusCode = 500;
        res.end();
      }
    }
  };
}
