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
 */

import { actions, logActivity } from "../model/store";
import { callRemoteTool, discoverTools, type ModelContextLike, type RemoteTool } from "./registry";

/**
 * Where the partner lives. In production it is baked in at build time with
 * VITE_SUPPLIER_ORIGIN, because the two origins are deliberately hosted by different
 * providers and cannot be derived from this one. `?supplier=https://…` overrides it for
 * debugging. It MUST be https: `exposedTo` only accepts secure origins (localhost counts).
 */
export const SUPPLIER_ORIGIN: string = (() => {
  const q = new URLSearchParams(location.search).get("supplier");
  if (q) return q.replace(/\/$/, "");
  const baked = import.meta.env.VITE_SUPPLIER_ORIGIN;
  if (baked) return String(baked).replace(/\/$/, "");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return `${location.protocol}//${location.hostname}:5200`;
  }
  return `${location.protocol}//partner.${location.host.replace(/^www\./, "")}`;
})();

export const SUPPLIER_URL = `${SUPPLIER_ORIGIN}/partner/index.html`;

export type SupplierProduct = {
  sku: string;
  name: string;
  category: string;
  w: number;
  d: number;
  h: number;
  price: number;
  currency: string;
  color: string;
  stock: number;
};

let modelContext: ModelContextLike | null = null;
let remoteTools: RemoteTool[] = [];
let frame: Window | null = null;

/** postMessage fallback plumbing. */
let msgSeq = 0;
const pending = new Map<string, (payload: { ok: boolean; result?: unknown; error?: string }) => void>();

window.addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== SUPPLIER_ORIGIN) return;
  const data = e.data as { __alzaSupplierResult?: boolean; id?: string; ok?: boolean; result?: unknown; error?: string };
  if (!data?.__alzaSupplierResult || !data.id) return;
  pending.get(data.id)?.({ ok: !!data.ok, result: data.result, error: data.error });
  pending.delete(data.id);
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
  const reply = new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Supplier did not answer "${tool}" in time.`));
    }, 8000);
  });
  try {
    target.postMessage({ __alzaSupplier: true, id, tool, args }, SUPPLIER_ORIGIN);
  } catch (err) {
    pending.delete(id);
    throw new Error(`Could not reach ${SUPPLIER_ORIGIN}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const out = await reply;
  if (!out.ok) throw new Error(out.error ?? "Supplier call failed.");
  return out.result;
}

/**
 * Call one of the supplier's tools. Prefers the real WebMCP cross-origin path and states
 * which transport was used, because that distinction is the whole point of the feature.
 */
export async function callSupplier(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ data: unknown; transport: "webmcp" | "postmessage" }> {
  const attempt = async (): Promise<string | null> => {
    const remote = remoteTools.find((t) => t.name === tool);
    if (!remote || !modelContext?.executeTool) return null;
    return callRemoteTool(modelContext, remote, args);
  };
  try {
    const text = await attempt();
    if (text != null) return { data: JSON.parse(text), transport: "webmcp" };
  } catch (err) {
    // a descriptor can outlive its frame; refresh the list once before giving up on WebMCP
    console.warn("[webmcp] cross-origin call failed, re-discovering", err);
    await connectSupplier(modelContext);
    try {
      const retry = await attempt();
      if (retry != null) return { data: JSON.parse(retry), transport: "webmcp" };
    } catch {
      /* fall through to the postMessage transport */
    }
  }
  return { data: await viaPostMessage(tool, args), transport: "postmessage" };
}

export async function listProducts(filters: Record<string, unknown> = {}) {
  const { data, transport } = await callSupplier("nordika_list_products", filters);
  return { products: (data as { products: SupplierProduct[] }).products ?? [], transport };
}

export async function getProduct(sku: string) {
  const { data, transport } = await callSupplier("nordika_get_product", { sku });
  return { product: (data as { product: SupplierProduct | null }).product ?? null, transport };
}
