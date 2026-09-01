/**
 * Single source of truth. The UI buttons and the WebMCP tools call THE SAME actions,
 * so human and agent truly co-edit one model. Vanilla zustand store (usable outside React).
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type {
  ActivityEntry,
  Item,
  Note,
  Opening,
  OpeningKind,
  PendingApproval,
  PlanModel,
  Room,
  Underlay,
  Wall,
} from "./types";
import { emptyModel } from "./types";
import { clampOpeningT, checkModel } from "./issues";
import { segLen, snap } from "./geometry";
import { catalogByKind, registerCatalogEntry, type CatalogEntry } from "./catalog";
import { defineCustomKind, FURNITURE_BUILDERS, type PartSpec } from "../three/furniture";

export interface ActionResult {
  ok: boolean;
  summary: string;
  [key: string]: unknown;
}

export type CameraMode = "orbit" | "top" | "walk";
export type ViewMode = "2d" | "3d";

export interface EditorState {
  view: ViewMode;
  camera: CameraMode;
  selectedWallId: string | null;
  selectedItemId: string | null;
  selectedRoomId: string | null;
  drawMode: "select" | "wall" | "room" | "place";
  placingKind: string | null;
  pendingWallStart: { x: number; y: number } | null;
}

export interface AppState {
  model: PlanModel;
  notes: Note[];
  activity: ActivityEntry[];
  editor: EditorState;
  undoStack: PlanModel[];
  webmcpStatus: "off" | "live";
  lastChangeAt: number;
  /** destructive agent calls waiting for a human decision */
  approvals: PendingApproval[];
  /** when true, destructive tool calls are parked until the human approves them */
  requireApproval: boolean;
  /** cross-origin tools discovered on partner origins, by tool name */
  supplierTools: string[];
  /** bumped whenever a kind is added to the catalogue at runtime, so the UI re-renders */
  catalogRev: number;
}

let idCounter = 0;
export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

const initialEditor: EditorState = {
  view: "2d",
  camera: "orbit",
  selectedWallId: null,
  selectedItemId: null,
  selectedRoomId: null,
  drawMode: "select",
  placingKind: null,
  pendingWallStart: null,
};

export const store = createStore<AppState>(() => ({
  model: emptyModel(),
  notes: [],
  activity: [],
  editor: initialEditor,
  undoStack: [],
  webmcpStatus: "off",
  lastChangeAt: Date.now(),
  approvals: [],
  requireApproval: true,
  supplierTools: [],
  catalogRev: 0,
}));

export const useAppStore = <T>(selector: (s: AppState) => T): T => useStore(store, selector);

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export function logActivity(source: ActivityEntry["source"], tool: string, summary: string, ok = true) {
  const entry: ActivityEntry = { id: uid("act"), at: Date.now(), source, tool, summary, ok };
  store.setState((s) => ({ activity: [...s.activity.slice(-199), entry] }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pushUndo() {
  store.setState((s) => ({ undoStack: [...s.undoStack.slice(-49), structuredClone(s.model)] }));
}

function setModel(model: PlanModel) {
  store.setState({ model, lastChangeAt: Date.now() });
}

/** id -> settle(granted); kept out of the store because promises are not serialisable state. */
const approvalResolvers = new Map<string, (granted: boolean) => void>();

const bumpCatalog = () => store.setState((s) => ({ catalogRev: s.catalogRev + 1 }));

const ok = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: false, summary, ...extra });

function findWall(idOrHint: string): Wall | undefined {
  const { walls } = store.getState().model;
  return walls.find((w) => w.id === idOrHint) ?? walls.find((w) => w.id.includes(idOrHint));
}

function findRoom(idOrLabel: string): Room | undefined {
  const { rooms } = store.getState().model;
  const q = idOrLabel.toLowerCase();
  return rooms.find((r) => r.id === idOrLabel) ?? rooms.find((r) => r.label.toLowerCase().includes(q));
}

function findItem(idOrKind: string): Item | undefined {
  const { items } = store.getState().model;
  const q = idOrKind.toLowerCase();
  return (
    items.find((i) => i.id === idOrKind) ??
    items.find((i) => i.kind.toLowerCase().includes(q) || (catalogByKind(i.kind)?.label.toLowerCase().includes(q) ?? false))
  );
}

// ---------------------------------------------------------------------------
// Shared actions (UI + WebMCP tools)
// ---------------------------------------------------------------------------

export const actions = {
  // ---- structure ----
  addWall(ax: number, ay: number, bx: number, by: number, thickness = 0.15, height = 2.7): ActionResult {
    ax = snap(ax); ay = snap(ay); bx = snap(bx); by = snap(by);
    const len = segLen(ax, ay, bx, by);
    if (len < 0.2) return fail(`Wall too short (${(len * 100).toFixed(0)} cm, min 20 cm).`);
    const wall: Wall = { id: uid("wall"), ax, ay, bx, by, thickness, height };
    pushUndo();
    setModel({ ...store.getState().model, walls: [...store.getState().model.walls, wall] });
    return ok(`Wall added (${len.toFixed(2)} m).`, { id: wall.id, length: len });
  },

  editWall(id: string, patch: Partial<Pick<Wall, "ax" | "ay" | "bx" | "by" | "thickness" | "height">>): ActionResult {
    const wall = findWall(id);
    if (!wall) return fail(`Wall "${id}" not found.`);
    const next: Wall = { ...wall };
    for (const k of ["ax", "ay", "bx", "by"] as const) {
      if (patch[k] !== undefined) next[k] = snap(patch[k]!);
    }
    if (patch.thickness !== undefined) next.thickness = patch.thickness;
    if (patch.height !== undefined) next.height = patch.height;
    if (segLen(next.ax, next.ay, next.bx, next.by) < 0.2) return fail("Edit rejected: wall would be shorter than 20 cm.");
    pushUndo();
    setModel({
      ...store.getState().model,
      walls: store.getState().model.walls.map((w) => (w.id === wall.id ? next : w)),
    });
    return ok(`Wall ${wall.id} updated.`, { id: wall.id });
  },

  removeWall(id: string): ActionResult {
    const wall = findWall(id);
    if (!wall) return fail(`Wall "${id}" not found.`);
    pushUndo();
    const model = store.getState().model;
    setModel({
      ...model,
      walls: model.walls.filter((w) => w.id !== wall.id),
      openings: model.openings.filter((o) => o.wallId !== wall.id),
    });
    return ok(`Wall ${wall.id} removed (its openings were removed too).`, { id: wall.id });
  },

  // ---- openings ----
  addOpening(
    kind: OpeningKind,
    wallId: string,
    t: number,
    width?: number,
    sill?: number,
    height?: number,
    swing?: { hinge?: "a" | "b"; side?: "left" | "right" },
  ): ActionResult {
    const wall = findWall(wallId);
    if (!wall) return fail(`Wall "${wallId}" not found.`);
    const w = width ?? (kind === "door" ? 0.9 : 1.2);
    const s = sill ?? (kind === "door" ? 0 : 0.9);
    const h = height ?? (kind === "door" ? 2.1 : 1.2);
    const clamped = clampOpeningT(wall, w, t);
    if (clamped === null) {
      const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
      return fail(`Wall ${wall.id} is ${len.toFixed(2)} m long — a ${w.toFixed(2)} m ${kind} does not fit.`);
    }
    if (s + h > wall.height) return fail(`${kind} (sill ${s} + height ${h}) exceeds wall height ${wall.height} m.`);
    const opening: Opening = { id: uid(kind), kind, wallId: wall.id, t: clamped, width: w, sill: s, height: h };
    if (kind === "door") {
      opening.hinge = swing?.hinge ?? "a";
      opening.side = swing?.side ?? "right";
    }
    pushUndo();
    setModel({ ...store.getState().model, openings: [...store.getState().model.openings, opening] });
    const moved = Math.abs(clamped - t) > 1e-6 ? ` (clamped to t=${clamped.toFixed(2)} to fit the vano)` : "";
    return ok(`${kind === "door" ? "Door" : "Window"} added on wall ${wall.id} at t=${clamped.toFixed(2)}${moved}.`, {
      id: opening.id,
      t: clamped,
    });
  },

  /** Flip which jamb a door hinges on and/or which way it swings. */
  setDoorSwing(id: string, hinge?: "a" | "b", side?: "left" | "right"): ActionResult {
    const { openings } = store.getState().model;
    const o = openings.find((x) => x.id === id) ?? openings.find((x) => x.id.includes(id));
    if (!o) return fail(`Opening "${id}" not found.`);
    if (o.kind !== "door") return fail(`${o.id} is a window — only doors swing.`);
    const next = { ...o, hinge: hinge ?? o.hinge ?? "a", side: side ?? o.side ?? "right" };
    pushUndo();
    setModel({
      ...store.getState().model,
      openings: openings.map((x) => (x.id === o.id ? next : x)),
    });
    return ok(`Door ${o.id} hinges on "${next.hinge}" and swings to the "${next.side}".`, { id: o.id });
  },

  moveOpening(id: string, t: number): ActionResult {
    const { openings } = store.getState().model;
    const o = openings.find((x) => x.id === id) ?? openings.find((x) => x.id.includes(id));
    if (!o) return fail(`Opening "${id}" not found.`);
    const wall = findWall(o.wallId)!;
    const clamped = clampOpeningT(wall, o.width, t);
    if (clamped === null) return fail("Opening does not fit on its wall.");
    pushUndo();
    setModel({
      ...store.getState().model,
      openings: openings.map((x) => (x.id === o.id ? { ...x, t: clamped } : x)),
    });
    return ok(`${o.kind} ${o.id} moved to t=${clamped.toFixed(2)}.`, { id: o.id, t: clamped });
  },

  removeOpening(id: string): ActionResult {
    const { openings } = store.getState().model;
    const o = openings.find((x) => x.id === id) ?? openings.find((x) => x.id.includes(id));
    if (!o) return fail(`Opening "${id}" not found.`);
    pushUndo();
    setModel({ ...store.getState().model, openings: openings.filter((x) => x.id !== o.id) });
    return ok(`${o.kind} ${o.id} removed.`, { id: o.id });
  },

  // ---- rooms ----
  addRoom(x: number, y: number, w: number, h: number, label: string, floor = "oak"): ActionResult {
    x = snap(x); y = snap(y); w = snap(w); h = snap(h);
    if (w < 0.5 || h < 0.5) return fail("Room must be at least 0.5 × 0.5 m.");
    const room: Room = { id: uid("room"), x, y, w, h, label, floor };
    pushUndo();
    setModel({ ...store.getState().model, rooms: [...store.getState().model.rooms, room] });
    return ok(`Room "${label}" added (${w.toFixed(2)} × ${h.toFixed(2)} m).`, { id: room.id });
  },

  updateRoom(idOrLabel: string, patch: Partial<Pick<Room, "x" | "y" | "w" | "h" | "label" | "floor">>): ActionResult {
    const room = findRoom(idOrLabel);
    if (!room) return fail(`Room "${idOrLabel}" not found.`);
    const next: Room = { ...room, ...patch };
    if (next.w < 0.5 || next.h < 0.5) return fail("Room must be at least 0.5 × 0.5 m.");
    pushUndo();
    setModel({
      ...store.getState().model,
      rooms: store.getState().model.rooms.map((r) => (r.id === room.id ? next : r)),
    });
    return ok(`Room "${next.label}" updated.`, { id: room.id });
  },

  removeRoom(idOrLabel: string): ActionResult {
    const room = findRoom(idOrLabel);
    if (!room) return fail(`Room "${idOrLabel}" not found.`);
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.filter((r) => r.id !== room.id) });
    return ok(`Room "${room.label}" removed.`, { id: room.id });
  },

  // ---- furniture ----
  placeItem(kind: string, x: number, y: number, rotation = 0): ActionResult {
    const cat = catalogByKind(kind);
    if (!cat) return fail(`Unknown furniture kind "${kind}". Use get_item_catalog.`);
    const item: Item = { id: uid("item"), kind: cat.kind, x: snap(x), y: snap(y), rotation };
    pushUndo();
    setModel({ ...store.getState().model, items: [...store.getState().model.items, item] });
    return ok(`${cat.label} placed at (${item.x.toFixed(2)}, ${item.y.toFixed(2)}).`, { id: item.id });
  },

  moveItem(idOrKind: string, x?: number, y?: number, rotation?: number): ActionResult {
    const item = findItem(idOrKind);
    if (!item) return fail(`Item "${idOrKind}" not found.`);
    const next: Item = {
      ...item,
      x: x !== undefined ? snap(x) : item.x,
      y: y !== undefined ? snap(y) : item.y,
      rotation: rotation !== undefined ? rotation : item.rotation,
    };
    pushUndo();
    setModel({
      ...store.getState().model,
      items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)),
    });
    return ok(`Item ${item.id} moved to (${next.x.toFixed(2)}, ${next.y.toFixed(2)}).`, { id: item.id });
  },

  removeItem(idOrKind: string): ActionResult {
    const item = findItem(idOrKind);
    if (!item) return fail(`Item "${idOrKind}" not found.`);
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.filter((i) => i.id !== item.id) });
    return ok(`Item ${item.id} removed.`, { id: item.id });
  },

  // ---- model / view ----
  setPlanName(name: string): ActionResult {
    pushUndo();
    setModel({ ...store.getState().model, name });
    return ok(`Plan renamed to "${name}".`);
  },

  clearModel(): ActionResult {
    pushUndo();
    setModel(emptyModel());
    store.setState({ notes: [] });
    return ok("Model cleared. Blank canvas ready.");
  },

  build3d(): ActionResult {
    const m = store.getState().model;
    if (m.walls.length === 0) return fail("Nothing to build: the plan has no walls yet.");
    store.setState((s) => ({ editor: { ...s.editor, view: "3d" } }));
    return ok(`3D model built: ${m.walls.length} walls, ${m.openings.length} openings, ${m.items.length} items.`);
  },

  setCamera(mode: CameraMode): ActionResult {
    if (!["orbit", "top", "walk"].includes(mode)) return fail(`Unknown camera "${mode}". Use orbit | top | walk.`);
    store.setState((s) => ({ editor: { ...s.editor, view: "3d", camera: mode } }));
    return ok(`Camera set to ${mode}.`);
  },

  setView(view: ViewMode) {
    store.setState((s) => ({ editor: { ...s.editor, view } }));
  },

  // ---- collaboration ----
  leaveNote(author: "human" | "agent", text: string): ActionResult {
    const note: Note = { id: uid("note"), author, text, at: Date.now() };
    store.setState((s) => ({ notes: [...s.notes, note] }));
    return ok(`Note saved (${author}): "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`, { id: note.id });
  },

  // ---- underlay ----
  setUnderlay(underlay: Underlay | null) {
    setModel({ ...store.getState().model, underlay });
  },

  calibrateUnderlay(u1: number, v1: number, u2: number, v2: number, meters: number, opacity?: number): ActionResult {
    const m = store.getState().model;
    const u = m.underlay;
    if (!u) return fail("No underlay loaded — ask the human to upload the plan image first (sidebar → Blueprint underlay).");
    // world distance between the two fractional image points at the CURRENT scale
    const frac = Math.hypot((u2 - u1) * u.w, (v2 - v1) * u.h);
    if (frac < 1e-6) return fail("The two calibration points coincide.");
    if (!(meters > 0)) return fail("meters must be positive.");
    const scale = meters / frac;
    const newW = u.w * scale;
    const newH = u.h * scale;
    // keep image point 1 fixed in world space
    const p1x = u.x + u1 * u.w;
    const p1y = u.y + v1 * u.h;
    setModel({
      ...m,
      underlay: { ...u, x: p1x - u1 * newW, y: p1y - v1 * newH, w: newW, h: newH, opacity: opacity ?? u.opacity },
    });
    return ok(
      `Underlay calibrated: ${u.w.toFixed(2)} → ${newW.toFixed(2)} m wide (×${scale.toFixed(3)}). Image point (${u1}, ${v1}) stays at world (${p1x.toFixed(2)}, ${p1y.toFixed(2)}).`,
      { w: newW, h: newH, scale },
    );
  },

  // ---- human-in-the-loop approval ----
  setRequireApproval(on: boolean) {
    store.setState({ requireApproval: on });
    logActivity("human", "approval_policy", on ? "Destructive agent actions now need your approval." : "Approval gate switched off.", true);
  },

  /**
   * Park a destructive agent call until the human approves it. Resolves true/false.
   * Honours the AbortSignal WebMCP hands to execute(), so an agent that gives up
   * releases the request instead of leaving it hanging on the page.
   */
  requestApproval(tool: string, request: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    const entry: PendingApproval = { id: uid("appr"), tool, request, args, at: Date.now() };
    store.setState((s) => ({ approvals: [...s.approvals, entry] }));
    logActivity("agent", tool, `Waiting for your approval: ${request}`, true);
    return new Promise<boolean>((resolve) => {
      const settle = (granted: boolean) => {
        if (!approvalResolvers.has(entry.id)) return;
        approvalResolvers.delete(entry.id);
        store.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== entry.id) }));
        resolve(granted);
      };
      approvalResolvers.set(entry.id, settle);
      signal?.addEventListener("abort", () => settle(false), { once: true });
    });
  },

  resolveApproval(id: string, granted: boolean): ActionResult {
    const entry = store.getState().approvals.find((a) => a.id === id);
    const settle = approvalResolvers.get(id);
    if (!entry || !settle) return fail("That request is no longer pending.");
    settle(granted);
    logActivity("human", entry.tool, granted ? `Approved: ${entry.request}` : `Rejected: ${entry.request}`, granted);
    return ok(granted ? "Approved." : "Rejected.");
  },

  /**
   * Adopt a product from the partner origin into this plan's catalogue, keeping the
   * supplier's real dimensions so the constraint checker judges it like anything else.
   */
  importSupplierProduct(p: {
    sku: string;
    name: string;
    category: string;
    w: number;
    d: number;
    h: number;
    color: string;
  }): ActionResult {
    const kind = `nordika:${p.sku}`;
    const known: CatalogEntry["category"][] = ["living", "bedroom", "kitchen", "bath", "office", "decor"];
    const category = known.includes(p.category as CatalogEntry["category"])
      ? (p.category as CatalogEntry["category"])
      : p.category === "dining"
        ? "kitchen"
        : "decor";
    registerCatalogEntry({ kind, label: p.name, w: p.w, d: p.d, h: p.h, color: p.color, category });
    bumpCatalog();
    return ok(`${p.name} imported from the supplier (${p.w} × ${p.d} m).`, { kind });
  },

  /**
   * Register a piece of furniture that is not in the catalogue — the escape hatch that lets an
   * agent match what a plan actually draws instead of approximating with the nearest stock item.
   * `parts` is optional: without it the piece is blocked out from its footprint.
   */
  defineItemKind(spec: {
    kind: string;
    label: string;
    w: number;
    d: number;
    h: number;
    color?: string;
    category?: string;
    parts?: PartSpec[];
  }): ActionResult {
    const kind = spec.kind.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
    if (!kind) return fail("A kind id is required.");
    if (FURNITURE_BUILDERS[kind]) return fail(`"${kind}" is a built-in kind — pick another id or use place_item.`);
    if (!(spec.w > 0 && spec.d > 0 && spec.h > 0)) return fail("w, d and h must all be positive metres.");
    const known: CatalogEntry["category"][] = ["living", "bedroom", "kitchen", "bath", "office", "decor"];
    const category = known.includes(spec.category as CatalogEntry["category"])
      ? (spec.category as CatalogEntry["category"])
      : "decor";
    const color = spec.color ?? "#9a9186";
    const existing = catalogByKind(kind);
    if (existing) {
      existing.label = spec.label;
      existing.w = spec.w;
      existing.d = spec.d;
      existing.h = spec.h;
      existing.color = color;
      existing.category = category;
    } else {
      registerCatalogEntry({ kind, label: spec.label, w: spec.w, d: spec.d, h: spec.h, color, category });
    }
    if (spec.parts?.length) defineCustomKind(kind, spec.parts);
    bumpCatalog();
    return ok(
      `"${spec.label}" defined as ${kind} (${spec.w} × ${spec.d} × ${spec.h} m${spec.parts?.length ? `, ${spec.parts.length} parts` : ", blocked out from its footprint"}). Place it with place_item.`,
      { kind },
    );
  },

  setSupplierTools(names: string[]) {
    store.setState({ supplierTools: names });
  },

  // ---- selection / editor ----
  selectWall(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, selectedWallId: id, selectedItemId: null, selectedRoomId: null } }));
  },
  selectItem(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, selectedItemId: id, selectedWallId: null, selectedRoomId: null } }));
  },
  selectRoom(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, selectedRoomId: id, selectedWallId: null, selectedItemId: null } }));
  },
  setDrawMode(mode: EditorState["drawMode"], placingKind: string | null = null) {
    store.setState((s) => ({ editor: { ...s.editor, drawMode: mode, placingKind, pendingWallStart: null } }));
  },
  setPendingWallStart(p: { x: number; y: number } | null) {
    store.setState((s) => ({ editor: { ...s.editor, pendingWallStart: p } }));
  },

  undo(): ActionResult {
    const { undoStack } = store.getState();
    if (undoStack.length === 0) return fail("Nothing to undo.");
    const prev = undoStack[undoStack.length - 1];
    store.setState({ undoStack: undoStack.slice(0, -1) });
    setModel(prev);
    return ok("Undone.");
  },

  loadModel(model: PlanModel) {
    pushUndo();
    setModel(model);
  },

  setWebmcpStatus(status: "off" | "live") {
    store.setState({ webmcpStatus: status });
  },
};

// Convenience re-exports for tools
export { checkModel };
export const getModel = (): PlanModel => store.getState().model;
