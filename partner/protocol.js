/**
 * The partner's postMessage contract — the fallback transport for runtimes without
 * cross-origin WebMCP. The studio imports the same names to build its requests and read the
 * replies, so the two sides cannot drift apart on a tag or a limit.
 *
 * A request is { [REQUEST_TAG]: true, id, tool, args } and is answered with
 * { [RESULT_TAG]: true, id, ok, result | error }, sent back to the requesting origin only.
 */

import { isAllowedOrigin } from "../config/origins.js";

export const REQUEST_TAG = "__alzaSupplier";
export const RESULT_TAG = "__alzaSupplierResult";
/** Longest request id either side accepts; ids are short counters ("sup_12"). */
export const MESSAGE_ID_MAX_LENGTH = 64;
/**
 * Most of an unknown tool name the partner echoes back in its error. The name is whatever the
 * requester sent, so the echo is capped on its own terms, not tied to the id limit above.
 */
export const ECHOED_TOOL_NAME_MAX_LENGTH = 64;
/**
 * How long the studio waits for an answer before giving the request up. The partner's tools
 * answer synchronously, so a reply that has not arrived by then is not coming.
 */
export const REPLY_TIMEOUT_MS = 8000;

/**
 * @typedef {{ name: string, run: (input: Record<string, unknown>) => unknown }} PartnerTool
 * @typedef {{ kind: "ignore" }
 *   | { kind: "reject", id: string, error: string }
 *   | { kind: "run", id: string, tool: PartnerTool, args: Record<string, unknown> }} ParsedRequest
 */

/**
 * A plain JSON-like object: what structured clone produces from an object literal. Arrays,
 * null and class instances are not arguments.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Classify one incoming message. Anything that is not a well-formed request envelope is
 * ignored without a reply (it may not even be meant for us); a well-formed one naming an
 * unknown tool or carrying arguments that are not an object is answered with an error, and
 * only a request that passes both reaches a tool.
 *
 * @param {unknown} data
 * @param {ReadonlyMap<string, PartnerTool>} tools
 * @returns {ParsedRequest}
 */
export function parseRequest(data, tools) {
  if (!isPlainObject(data) || data[REQUEST_TAG] !== true) return { kind: "ignore" };
  const { id, tool, args } = data;
  if (typeof id !== "string" || id === "" || id.length > MESSAGE_ID_MAX_LENGTH) return { kind: "ignore" };
  const found = typeof tool === "string" ? tools.get(tool) : undefined;
  if (!found) return { kind: "reject", id, error: `Unknown tool "${String(tool).slice(0, ECHOED_TOOL_NAME_MAX_LENGTH)}".` };
  if (args !== undefined && !isPlainObject(args)) return { kind: "reject", id, error: `Arguments for "${found.name}" must be an object.` };
  return { kind: "run", id, tool: found, args: args ?? {} };
}

/**
 * The partner's `message` listener. Messages from any origin outside `allowedOrigins` are
 * dropped before they are even parsed, and an empty list drops everything.
 *
 * @param {{ allowedOrigins: readonly string[], tools: readonly PartnerTool[] }} config
 * @returns {(e: { origin: string, data: unknown, source: unknown }) => void}
 */
export function createRequestHandler({ allowedOrigins, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return (e) => {
    if (!isAllowedOrigin(e.origin, allowedOrigins)) return;
    const req = parseRequest(e.data, byName);
    if (req.kind === "ignore") return;
    /** @type {Record<string, unknown>} */
    let reply;
    if (req.kind === "reject") reply = { [RESULT_TAG]: true, id: req.id, ok: false, error: req.error };
    else {
      try {
        reply = { [RESULT_TAG]: true, id: req.id, ok: true, result: req.tool.run(req.args) };
      } catch (err) {
        reply = { [RESULT_TAG]: true, id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const source = /** @type {{ postMessage?: (m: unknown, o: string) => void } | null} */ (e.source);
    source?.postMessage?.(reply, e.origin);
  };
}
