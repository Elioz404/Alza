/**
 * Nordika — a stand-alone furniture supplier on its OWN ORIGIN.
 *
 * It knows nothing about Alza's internals. It publishes its stock as WebMCP tools and shares
 * them with the host origin via `registerTool(descriptor, { exposedTo })`, which is what lets
 * an agent standing on Alza's page read this catalogue directly.
 *
 * The same two calls are also answered over postMessage, so the integration still works on
 * runtimes without cross-origin WebMCP.
 */

import { hostOriginsFor, resolveOrigins } from "../config/origins.js";
import { createRequestHandler, isPlainObject } from "./protocol.js";
import { renderProducts } from "./view.js";

const PRODUCTS = [
  { sku: "NK-SOF-3S", name: "Frejda 3-seat sofa", category: "living", w: 2.18, d: 0.92, h: 0.84, price: 749, currency: "EUR", color: "#8d8577", stock: 12 },
  { sku: "NK-ARM-01", name: "Frejda armchair", category: "living", w: 0.88, d: 0.86, h: 0.84, price: 329, currency: "EUR", color: "#96907f", stock: 20 },
  { sku: "NK-CFT-OAK", name: "Halden coffee table", category: "living", w: 1.15, d: 0.6, h: 0.4, price: 189, currency: "EUR", color: "#b08a58", stock: 8 },
  { sku: "NK-SBD-220", name: "Halden sideboard 220", category: "living", w: 2.2, d: 0.44, h: 0.76, price: 429, currency: "EUR", color: "#6f5c47", stock: 5 },
  { sku: "NK-BED-090", name: "Valby single bed 90", category: "bedroom", w: 0.92, d: 1.98, h: 0.5, price: 259, currency: "EUR", color: "#a6a396", stock: 30 },
  { sku: "NK-BED-160", name: "Valby double bed 160", category: "bedroom", w: 1.64, d: 2.06, h: 0.52, price: 449, currency: "EUR", color: "#a6a396", stock: 14 },
  { sku: "NK-WRD-150", name: "Valby wardrobe 150", category: "bedroom", w: 1.5, d: 0.62, h: 2.16, price: 519, currency: "EUR", color: "#6c5f52", stock: 0 },
  { sku: "NK-NST-045", name: "Valby nightstand", category: "bedroom", w: 0.46, d: 0.42, h: 0.54, price: 79, currency: "EUR", color: "#7d6a54", stock: 40 },
  { sku: "NK-DSK-130", name: "Studio desk 130", category: "office", w: 1.32, d: 0.68, h: 0.74, price: 219, currency: "EUR", color: "#a58a66", stock: 11 },
  { sku: "NK-CHR-ERG", name: "Studio task chair", category: "office", w: 0.62, d: 0.62, h: 1.05, price: 179, currency: "EUR", color: "#4a4f58", stock: 25 },
  { sku: "NK-DIN-OVL", name: "Sund oval table 190", category: "dining", w: 1.9, d: 1.02, h: 0.75, price: 559, currency: "EUR", color: "#b08d5f", stock: 6 },
  { sku: "NK-DCH-01", name: "Sund dining chair", category: "dining", w: 0.46, d: 0.47, h: 0.9, price: 89, currency: "EUR", color: "#96754e", stock: 48 },
];

// ---------------------------------------------------------------- tool logic
/** @param {Record<string, unknown>} [input] */
function listProducts(input = {}) {
  const { category, maxPrice, maxWidth, inStock } = input;
  let out = PRODUCTS.slice();
  if (category) out = out.filter((p) => p.category === String(category).toLowerCase());
  if (typeof maxPrice === "number") out = out.filter((p) => p.price <= maxPrice);
  if (typeof maxWidth === "number") out = out.filter((p) => p.w <= maxWidth);
  if (inStock) out = out.filter((p) => p.stock > 0);
  return { supplier: "Nordika", count: out.length, products: out };
}

/** @param {Record<string, unknown>} [input] */
function getProduct(input = {}) {
  const sku = String(input.sku ?? "").toUpperCase();
  const product = PRODUCTS.find((p) => p.sku === sku) ?? null;
  return product ? { supplier: "Nordika", product } : { supplier: "Nordika", product: null, error: `No product "${sku}".` };
}

const TOOLS = [
  {
    name: "nordika_list_products",
    title: "Nordika · list products",
    description:
      "List Nordika's furniture stock: sku, name, category (living | bedroom | office | dining), footprint width × depth and height in METRES, price in EUR, colour and units in stock. Filter with category, maxPrice, maxWidth (metres) or inStock. Dimensions are real, so they can be used directly as a floor-plan footprint.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        maxPrice: { type: "number" },
        maxWidth: { type: "number" },
        inStock: { type: "boolean" },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: listProducts,
  },
  {
    name: "nordika_get_product",
    title: "Nordika · product detail",
    description: "Full record for one Nordika product by sku (e.g. \"NK-SOF-3S\"): dimensions in metres, price, colour, stock.",
    inputSchema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: getProduct,
  },
];

// ------------------------------------------------- WebMCP registration
// Which studio origins may see these tools and talk to this frame. The list is built by
// config/origins.js — the same module the studio reads its partner origin from. A shipped
// build trusts only the studio origin it was built for; `?host=` and the referrer are chosen
// by whoever embeds this page, so they count in development builds only.
const ORIGINS = resolveOrigins(import.meta.env, { production: import.meta.env.PROD, devHost: location.hostname });
const HOST_ORIGINS = hostOriginsFor({
  configured: ORIGINS.studio,
  host: new URLSearchParams(location.search).get("host"),
  referrer: document.referrer,
  hostname: location.hostname,
  dev: import.meta.env.DEV,
});

/**
 * @typedef {{ registerTool?: (tool: object, options: { signal: AbortSignal, exposedTo: string[] }) => unknown }} ModelContext
 */
const mc = /** @type {ModelContext | null} */ (
  /** @type {{ modelContext?: ModelContext }} */ (document).modelContext ??
    /** @type {{ modelContext?: ModelContext }} */ (navigator).modelContext ??
    null
);

function registerTools() {
  if (!mc?.registerTool) return 0;
  const controller = new AbortController();
  let n = 0;
  for (const t of TOOLS) {
    const descriptor = {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      // the same rule as the postMessage path: arguments are an object or nothing
      execute: async (/** @type {unknown} */ input) => {
        if (input !== undefined && input !== null && !isPlainObject(input)) throw new TypeError(`Arguments for "${t.name}" must be an object.`);
        return JSON.stringify(t.run(input ?? {}));
      },
    };
    try {
      // exposedTo is what lets the host page's agent see this supplier's tools
      mc.registerTool(descriptor, { signal: controller.signal, exposedTo: HOST_ORIGINS });
      n++;
    } catch (err) {
      console.warn("[nordika] registration failed", t.name, err);
    }
  }
  return n;
}

// ------------------------------------------------- postMessage fallback
// Fail-closed: only HOST_ORIGINS are answered, an empty list answers nobody, and a request
// must name one of TOOLS with an object of arguments before anything runs (protocol.js).
window.addEventListener("message", createRequestHandler({ allowedOrigins: HOST_ORIGINS, tools: TOOLS }));

renderProducts(/** @type {HTMLElement} */ (document.getElementById("list")), PRODUCTS);
// ?display=1 renders the shop for a human to look at without registering anything: exactly one
// frame per page may own the tools, otherwise stale descriptors point at detached windows.
const displayOnly = new URLSearchParams(location.search).get("display") === "1";
const registered = displayOnly ? 0 : registerTools();
const pill = /** @type {HTMLElement} */ (document.getElementById("pill"));
pill.textContent = displayOnly ? "display only" : registered > 0 ? `${registered} tools shared` : "tools off";
pill.className = registered > 0 ? "pill" : "pill off";
