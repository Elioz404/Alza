/** Furniture catalog — footprints (meters) and display metadata. 3D builders live in three/furniture.ts. */

export interface CatalogEntry {
  kind: string;
  label: string;
  w: number; // footprint width  (local x)
  d: number; // footprint depth  (local y)
  h: number; // approximate height (3D)
  color: string;
  category: "living" | "bedroom" | "kitchen" | "bath" | "office" | "decor";
  /** rugs may overlap other furniture */
  isRug?: boolean;
}

export const CATALOG: CatalogEntry[] = [
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
];

export const catalogByKind = (kind: string): CatalogEntry | undefined =>
  CATALOG.find((c) => c.kind === kind);

/**
 * Add a catalogue entry at runtime — used for products imported from a partner origin's
 * own WebMCP tools, so a supplier's real dimensions drive the geometry and the checker.
 * Returns the entry that ends up in the catalogue (existing one wins, keeping ids stable).
 */
export function registerCatalogEntry(entry: CatalogEntry): CatalogEntry {
  const existing = catalogByKind(entry.kind);
  if (existing) return existing;
  CATALOG.push(entry);
  return entry;
}
