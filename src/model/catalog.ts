/**
 * The furniture catalogue: the built-in kinds the app ships with, plus whatever a plan adds.
 *
 * The built-in list is a frozen constant. Everything added at runtime — agent-defined pieces
 * and adopted supplier products — lives in the plan (PlanModel.kinds), so it is undone, saved
 * and carried with the plan like any other edit. A lookup is always over both, through
 * catalogOf(model), which indexes them by kind once per kinds list.
 *
 * 3D builders live in three/furniture.ts and read this data; nothing here knows about them.
 */

import type { KindDef, PartSpec, PlanModel } from "./types";

export type { KindDef } from "./types";

type BuiltInRow = Omit<KindDef, "source" | "parts">;

const BUILT_IN_ROWS: readonly BuiltInRow[] = [
  { kind: "sofa", label: "Sofa", w: 2.1, d: 0.9, h: 0.85, color: "#7a8ba0", category: "living" },
  { kind: "sofa_3", label: "Sofa (3-seat)", w: 2.6, d: 0.95, h: 0.82, color: "#6f8095", category: "living" },
  { kind: "armchair", label: "Armchair", w: 0.85, d: 0.85, h: 0.85, color: "#8a9bb0", category: "living" },
  { kind: "coffee_table", label: "Coffee table", w: 1.1, d: 0.55, h: 0.42, color: "#a08050", category: "living" },
  { kind: "side_table", label: "Side table", w: 0.5, d: 0.5, h: 0.5, color: "#9a7b52", category: "living" },
  { kind: "sideboard", label: "Sideboard", w: 2.2, d: 0.42, h: 0.75, color: "#7d6a54", category: "living" },
  { kind: "tv_sideboard", label: "Sideboard + TV", w: 2.2, d: 0.42, h: 1.42, color: "#6c5c49", category: "living" },
  { kind: "tv_stand", label: "TV stand", w: 1.6, d: 0.4, h: 0.5, color: "#5c5148", category: "living" },
  { kind: "bookshelf", label: "Bookshelf", w: 0.9, d: 0.32, h: 1.9, color: "#8b6f4e", category: "living" },
  { kind: "rug", label: "Rug", w: 2.4, d: 1.7, h: 0.02, color: "#b0987f", category: "living", isRug: true },
  { kind: "bed_double", label: "Double bed", w: 1.6, d: 2.05, h: 0.55, color: "#9aa5b5", category: "bedroom" },
  { kind: "bed_single", label: "Single bed", w: 0.9, d: 1.9, h: 0.5, color: "#a3adbb", category: "bedroom" },
  { kind: "nightstand", label: "Nightstand", w: 0.45, d: 0.4, h: 0.55, color: "#7c6a54", category: "bedroom" },
  { kind: "wardrobe", label: "Wardrobe", w: 1.5, d: 0.6, h: 2.1, color: "#6f6156", category: "bedroom" },
  { kind: "desk", label: "Desk", w: 1.3, d: 0.65, h: 0.75, color: "#a58a66", category: "office" },
  { kind: "office_chair", label: "Office chair", w: 0.6, d: 0.6, h: 1.0, color: "#4a4f58", category: "office" },
  { kind: "dining_table", label: "Dining table", w: 1.6, d: 0.9, h: 0.75, color: "#b08d5f", category: "kitchen" },
  { kind: "dining_table_oval", label: "Oval dining table", w: 1.9, d: 1.0, h: 0.75, color: "#b08d5f", category: "kitchen" },
  { kind: "dining_chair", label: "Dining chair", w: 0.45, d: 0.45, h: 0.9, color: "#96754e", category: "kitchen" },
  { kind: "kitchen_counter", label: "Kitchen counter", w: 2.4, d: 0.62, h: 0.9, color: "#c9c2b8", category: "kitchen" },
  { kind: "counter_unit", label: "Counter unit", w: 1.2, d: 0.62, h: 0.9, color: "#c9c2b8", category: "kitchen" },
  { kind: "kitchen_sink_unit", label: "Sink unit", w: 1.2, d: 0.62, h: 0.9, color: "#c4cdd2", category: "kitchen" },
  { kind: "kitchen_hob_unit", label: "Hob + oven unit", w: 1.2, d: 0.62, h: 0.9, color: "#b6b2ab", category: "kitchen" },
  { kind: "fridge", label: "Fridge", w: 0.7, d: 0.7, h: 1.85, color: "#d8dde2", category: "kitchen" },
  { kind: "bathtub", label: "Bathtub", w: 1.7, d: 0.75, h: 0.55, color: "#e2e8ec", category: "bath" },
  { kind: "corner_bath", label: "Corner bath", w: 1.4, d: 1.4, h: 0.55, color: "#e2e8ec", category: "bath" },
  { kind: "shower", label: "Shower", w: 0.9, d: 0.9, h: 2.0, color: "#cfdde6", category: "bath" },
  { kind: "toilet", label: "Toilet", w: 0.38, d: 0.65, h: 0.78, color: "#eef1f3", category: "bath" },
  { kind: "sink", label: "Washbasin", w: 0.55, d: 0.42, h: 0.85, color: "#e7ebee", category: "bath" },
  { kind: "towel_rail", label: "Towel rail", w: 0.6, d: 0.12, h: 1.1, color: "#c8ccd0", category: "bath" },
  { kind: "plant", label: "Plant", w: 0.4, d: 0.4, h: 1.1, color: "#5d8a54", category: "decor" },
  { kind: "floor_lamp", label: "Floor lamp", w: 0.45, d: 0.45, h: 1.6, color: "#d8cdb8", category: "decor" },
];

/** The kinds the app ships with. Frozen: no caller can add to it or edit a row in place. */
export const BUILT_IN_KINDS: readonly KindDef[] = Object.freeze(
  BUILT_IN_ROWS.map((row) => Object.freeze<KindDef>({ ...row, source: "builtin" })),
);

/** A kind definition frozen all the way down, so a definition held by a plan never changes under it. */
export function freezeKind(def: KindDef): KindDef {
  const parts = def.parts?.map((p) => Object.freeze<PartSpec>({ ...p }));
  return Object.freeze<KindDef>({ ...def, ...(parts ? { parts: Object.freeze(parts) } : {}) });
}

/** The catalogue a plan sees: the built-ins, then the plan's own kinds, indexed by kind. */
export interface Catalog {
  /** built-ins first, in their shipped order, then the plan's kinds in the order they were added */
  readonly entries: readonly KindDef[];
  get(kind: string): KindDef | undefined;
}

/** One index per kinds list. Plans are immutable, so the list only changes when its kinds do. */
const catalogs = new WeakMap<readonly KindDef[], Catalog>();

/**
 * The catalogue over the built-ins and `kinds`. A plan kind can never replace a built-in one —
 * define_item_kind refuses those ids, and a loaded plan that carries one anyway does not get
 * to redefine a sofa for everybody else's checker and 3D view.
 */
export function catalogFor(kinds: readonly KindDef[]): Catalog {
  const cached = catalogs.get(kinds);
  if (cached) return cached;
  const index = new Map<string, KindDef>();
  for (const def of BUILT_IN_KINDS) index.set(def.kind, def);
  for (const def of kinds) if (!index.has(def.kind)) index.set(def.kind, def);
  const catalog: Catalog = { entries: Object.freeze([...index.values()]), get: (kind) => index.get(kind) };
  catalogs.set(kinds, catalog);
  return catalog;
}

/** The catalogue of a plan. */
export const catalogOf = (model: Pick<PlanModel, "kinds">): Catalog => catalogFor(model.kinds);

/**
 * Products adopted from the partner origin live in the catalogue under this prefix, so a
 * supplier sku can never collide with a built-in or agent-defined kind: define_item_kind
 * refuses ids in this namespace. Skus match case-insensitively (SUPPLIER.sku), so the kind is
 * built from one case and "nk-sof-3s" and "NK-SOF-3S" are the same product.
 */
export const SUPPLIER_KIND_PREFIX = "nordika:";
export const supplierKind = (sku: string): string => `${SUPPLIER_KIND_PREFIX}${sku.toUpperCase()}`;
export const isSupplierKind = (kind: string): boolean => kind.toLowerCase().startsWith(SUPPLIER_KIND_PREFIX);

/** How many kinds agents have added to this plan with define_item_kind. */
export const customKindCount = (model: Pick<PlanModel, "kinds">): number =>
  model.kinds.filter((k) => k.source === "custom").length;

/**
 * The name the page uses for a kind in sentences it writes itself — tool summaries, checker
 * messages, approval requests. A supplier product's label is the partner's text, so it is
 * named by its kind id (built from a validated sku) instead; the label itself only ever
 * travels to an agent inside a result's `untrusted` field.
 */
export const kindName = (def: KindDef): string => (def.source === "supplier" ? def.kind : def.label);

/** A product as the plan adopts it from the partner (already validated at the supplier boundary). */
export interface SupplierProductData {
  sku: string;
  name: string;
  category: string;
  w: number;
  d: number;
  h: number;
  color: string;
}
