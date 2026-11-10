/**
 * Cross-origin tool exchange.
 *
 * The furniture supplier ("Nordika") is a SEPARATE ORIGIN that registers its own WebMCP
 * tools and shares them with this one via `registerTool(..., { exposedTo })`. Alza embeds it
 * in an iframe carrying `allow="tools"` (the `tools` Permissions Policy), then discovers its
 * tools with `getTools({ fromOrigins })` and calls them with `executeTool()`.
 *
 * The agent therefore stands on ONE page and composes TWO origins: the supplier's product
 * tools and Alza's geometry tools. Nothing is proxied through a server — the browser is the
 * integration layer.
 *
 * Where the runtime has no cross-origin support (or no WebMCP at all) the same protocol runs
 * over postMessage, so the feature degrades instead of disappearing.
 *
 * Everything the partner answers is untrusted input from another origin. Each answer is
 * validated here, at the boundary, against a schema built from the same domain limits the
 * tools use: a malformed product is dropped from a listing (and counted) or refused outright,
 * and never reaches the catalogue, the 3D builders or the agent.
 */

import { z } from "zod";
import { actions, logActivity } from "../model/store";
import { SUPPLIER, TEXT } from "../model/limits";
import { clip, describeIssues, furnitureDim, hexColor, inRange, label, supplierSku, text } from "../model/schemas";
import { callRemoteTool, discoverTools, type ModelContextLike, type RemoteTool } from "./registry";
import { isAllowedOrigin, resolveOrigins, supplierOriginFor } from "../../config/origins.js";
import { PARTNER_PAGE_PATH } from "../../config/sites.js";
import { MESSAGE_ID_MAX_LENGTH, REPLY_TIMEOUT_MS, REQUEST_TAG, RESULT_TAG } from "../../partner/protocol.js";

/**
 * The origins this build talks to, from config/origins.js: baked in at build time from
 * .env.production (and validated there, so a production bundle always has both), or the local
 * dev ports when running `npm run dev` / the tests.
 */
const ORIGINS = resolveOrigins(import.meta.env, { production: import.meta.env.PROD, devHost: location.hostname });

/**
 * Where the partner lives. This origin is framed with `allow="tools"`, named in the `tools`
 * Permissions-Policy and trusted for every answer, so in a shipped build it is exactly the
 * baked, validated one. Only a development build lets `?supplier=https://…` point it elsewhere
 * for debugging, and even then the override must be a valid origin or it is ignored. It MUST
 * be https: `exposedTo` only accepts secure origins (localhost counts).
 */
export const SUPPLIER_ORIGIN: string = supplierOriginFor({
  override: new URLSearchParams(location.search).get("supplier"),
  configured: ORIGINS.supplier,
  dev: import.meta.env.DEV,
});

export const SUPPLIER_URL = `${SUPPLIER_ORIGIN}${PARTNER_PAGE_PATH}`;

/**
 * The address of a partner frame. `display` renders the shop for the human without
 * registering tools (one frame per page owns them). In development the studio also tells the
 * partner where it is (`?host=`), so a studio on another local port or on 127.0.0.1 can pair
 * with it; a shipped partner ignores the hint and trusts only its built-in studio origin, so
 * a shipped studio does not send one.
 */
export function supplierFrameSrc({ display = false, dev = import.meta.env.DEV } = {}): string {
  const params = new URLSearchParams();
  if (dev) params.set("host", location.origin);
  if (display) params.set("display", "1");
  const query = params.toString();
  return query ? `${SUPPLIER_URL}?${query}` : SUPPLIER_URL;
}

/**
 * One product as the studio accepts it. Unknown fields are stripped rather than refused, so
 * the partner can grow its records without breaking the studio — but nothing unvetted passes.
 */
export const supplierProductSchema = z.object({
  sku: supplierSku,
  name: label,
  category: text(TEXT.category),
  w: furnitureDim,
  d: furnitureDim,
  h: furnitureDim,
  price: inRange(SUPPLIER.price),
  currency: z.string().regex(SUPPLIER.currency, "must be a three-letter currency code"),
  color: hexColor,
  stock: inRange(SUPPLIER.stock).int(),
});
export type SupplierProduct = z.output<typeof supplierProductSchema>;

/** The envelopes of the two answers; products inside are checked one by one. */
const listAnswer = z.object({ products: z.array(z.unknown()).max(SUPPLIER.maxProducts) });
const productAnswer = z.object({ product: z.unknown().nullable().optional() });

/** Raised when the partner answers with something the studio will not accept. */
export class SupplierDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierDataError";
  }
}

const issuesOf = (error: z.ZodError): string => describeIssues(error, { root: "answer" }).join("; ");

/**
 * A postMessage reply, as the studio accepts it. Only the envelope is checked here — `result`
 * is judged by the caller's schema like a WebMCP answer — but the error text is bounded and
 * typed, because it is relayed to the agent and shown on the page.
 */
const replyEnvelope = z.object({
  [RESULT_TAG]: z.literal(true),
  id: z.string().max(MESSAGE_ID_MAX_LENGTH),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z
    .string()
    .optional()
    .transform((e) => (e === undefined ? undefined : clip(e, TEXT.supplierError))),
});
type Reply = { ok: boolean; result?: unknown; error?: string };

/** Parse one raw answer: bounded in size, valid JSON, and matching `schema`. */
function parseAnswer<S extends z.ZodType>(tool: string, raw: unknown, schema: S): z.output<S> {
  let data = raw;
  if (typeof raw === "string") {
    if (raw.length > SUPPLIER.maxResponseChars) {
      throw new SupplierDataError(`${tool} answered ${raw.length} characters (max ${SUPPLIER.maxResponseChars}).`);
    }
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SupplierDataError(`${tool} did not answer with JSON.`);
    }
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new SupplierDataError(`${tool} answered in an unexpected shape (${issuesOf(parsed.error)}).`);
  return parsed.data;
}

let modelContext: ModelContextLike | null = null;
let remoteTools: RemoteTool[] = [];
let frame: Window | null = null;

/** postMessage fallback plumbing. */
let msgSeq = 0;
const pending = new Map<string, (payload: Reply) => void>();

window.addEventListener("message", (e: MessageEvent) => {
  if (!isAllowedOrigin(e.origin, [SUPPLIER_ORIGIN])) return;
  const data: unknown = e.data;
  // only a reply to a call still waiting is looked at; anything else is not addressed to us
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return;
  const settle = pending.get(id);
  if (!settle || (data as Record<string, unknown>)[RESULT_TAG] !== true) return;
  pending.delete(id);
  const reply = replyEnvelope.safeParse(data);
  settle(reply.success ? reply.data : { ok: false, error: `${SUPPLIER_ORIGIN} sent a malformed reply (${issuesOf(reply.error)}).` });
});

/** Called by the bridge component once its iframe is live. */
export function attachSupplierFrame(win: Window | null): void {
  frame = win;
}

/**
 * Resolve the partner frame at call time. Caching the Window is not safe: React remounts and
 * tab switches detach the element underneath it, and postMessage on a detached frame throws.
 * The live DOM is the source of truth; the cached handle is only a fallback.
 */
function supplierFrame(): Window | null {
  const el =
    document.querySelector<HTMLIFrameElement>("iframe.supplier-bridge") ??
    document.querySelector<HTMLIFrameElement>("iframe.supplier-frame");
  return el?.contentWindow ?? frame;
}

export function supplierToolNames(): string[] {
  return remoteTools.map((t) => t.name);
}

/** Discover the partner's tools. Runs once at bootstrap and again whenever tools change. */
export async function connectSupplier(mc: ModelContextLike | null): Promise<void> {
  modelContext = mc;
  if (!mc?.getTools) {
    actions.setSupplierTools([]);
    return;
  }
  let found = await discoverTools(mc, [SUPPLIER_ORIGIN]);
  if (found.length === 0) {
    // the partner iframe registers its tools on its own load; give it a beat and look again
    await new Promise((r) => setTimeout(r, 1200));
    found = await discoverTools(mc, [SUPPLIER_ORIGIN]);
  }
  remoteTools = found;
  actions.setSupplierTools(found.map((t) => t.name));
  if (found.length > 0) {
    logActivity(
      "system",
      "cross-origin",
      `Discovered ${found.length} tool(s) from ${SUPPLIER_ORIGIN}: ${found.map((t) => t.name).join(", ")}.`,
      true,
    );
  }
  mc.addEventListener?.("toolchange", () => {
    void discoverTools(mc, [SUPPLIER_ORIGIN]).then((t) => {
      remoteTools = t;
      actions.setSupplierTools(t.map((x) => x.name));
    });
  });
}

async function viaPostMessage(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const target = supplierFrame();
  if (!target) throw new Error(`The partner origin (${SUPPLIER_ORIGIN}) is not loaded on this page.`);
  const id = `sup_${++msgSeq}`;
  const reply = new Promise<Reply>((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Supplier did not answer "${tool}" within ${REPLY_TIMEOUT_MS} ms.`));
    }, REPLY_TIMEOUT_MS);
  });
  try {
    target.postMessage({ [REQUEST_TAG]: true, id, tool, args }, SUPPLIER_ORIGIN);
  } catch (err) {
    pending.delete(id);
    throw new Error(`Could not reach ${SUPPLIER_ORIGIN}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
  const out = await reply;
  if (!out.ok) throw new Error(out.error ?? "Supplier call failed.");
  return out.result;
}

/**
 * Call one of the supplier's tools and validate its answer against `schema`. Prefers the real
 * WebMCP cross-origin path and states which transport was used, because that distinction is
 * the whole point of the feature. A transport failure falls back; an answer that arrives but
 * fails validation does not — the partner said something, and it was not acceptable.
 */
export async function callSupplier<S extends z.ZodType>(
  tool: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<{ data: z.output<S>; transport: "webmcp" | "postmessage" }> {
  const attempt = async (): Promise<string | null> => {
    const remote = remoteTools.find((t) => t.name === tool);
    if (!remote || !modelContext?.executeTool) return null;
    return callRemoteTool(modelContext, remote, args);
  };
  let text: string | null = null;
  try {
    text = await attempt();
  } catch (err) {
    // a descriptor can outlive its frame; refresh the list once before giving up on WebMCP
    console.warn("[webmcp] cross-origin call failed, re-discovering", err);
    await connectSupplier(modelContext);
    try {
      text = await attempt();
    } catch {
      /* fall through to the postMessage transport */
    }
  }
  if (text != null) return { data: parseAnswer(tool, text, schema), transport: "webmcp" };
  return { data: parseAnswer(tool, await viaPostMessage(tool, args), schema), transport: "postmessage" };
}

export interface ProductFilters {
  category?: string;
  maxPrice?: number;
  maxWidth?: number;
  inStock?: boolean;
}

/** The partner's listing, keeping only products that pass validation; `rejected` counts the rest. */
export async function listProducts(filters: ProductFilters = {}) {
  const tool = "nordika_list_products";
  const { data, transport } = await callSupplier(tool, { ...filters }, listAnswer);
  const products: SupplierProduct[] = [];
  let rejected = 0;
  for (const raw of data.products) {
    const p = supplierProductSchema.safeParse(raw);
    if (p.success) products.push(p.data);
    else {
      rejected++;
      console.warn(`[supplier] dropped a malformed product from ${tool}: ${issuesOf(p.error)}`);
    }
  }
  if (rejected > 0) {
    logActivity("system", "cross-origin", `Dropped ${rejected} malformed product(s) from ${SUPPLIER_ORIGIN}.`, false);
  }
  return { products, rejected, transport };
}

/** One product by sku; a malformed record, or one for a different sku, is an error. */
export async function getProduct(sku: string) {
  const tool = "nordika_get_product";
  const { data, transport } = await callSupplier(tool, { sku }, productAnswer);
  if (data.product == null) return { product: null, transport };
  const p = supplierProductSchema.safeParse(data.product);
  if (!p.success) throw new SupplierDataError(`${SUPPLIER_ORIGIN} sent an invalid product for "${sku}" (${issuesOf(p.error)}).`);
  if (p.data.sku.toUpperCase() !== sku.toUpperCase()) {
    throw new SupplierDataError(`${SUPPLIER_ORIGIN} answered "${sku}" with a different product ("${p.data.sku}").`);
  }
  return { product: p.data, transport };
}
