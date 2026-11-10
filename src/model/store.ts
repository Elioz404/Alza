/**
 * Single source of truth. The UI and the WebMCP tools change the plan through THE SAME actions,
 * so human and agent truly co-edit one model. Vanilla zustand store: React reads it through
 * ui/useAppStore.ts, and nothing here depends on React.
 *
 * Plan changes are reached through dispatch() in commands.ts, which attributes each one to its
 * actor in the activity feed and records it as one undo step; `actions` holds the operations
 * dispatch runs, each of which checks its own arguments. `pageActions` is the part of the
 * surface that only moves the page around the plan — view, selection, draw mode, the approval
 * bar — and is what the UI may call directly.
 */

import { createStore } from "zustand/vanilla";
import type {
  ActivityEntry,
  ActivitySource,
  ApprovalTarget,
  Item,
  KindDef,
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
import { imageAssetError, letGoOfAsset, releaseUnreferencedAssets, type AssetId } from "./assets";
import { clampOpeningT } from "./issues";
import { segLen, snap } from "./geometry";
import {
  catalogOf,
  customKindCount,
  freezeKind,
  isSupplierKind,
  kindName,
  supplierKind,
  type SupplierProductData,
} from "./catalog";
import { lookupItem, lookupOpening, lookupRoom, lookupWall, type Lookup } from "./resolve";
import { clip, describeIssues, partList, type PartInput } from "./schemas";
import {
  CALIBRATION_METERS,
  CAMERA_MODES,
  COORD,
  DEFAULT_FLOOR,
  DEFAULT_ITEM_COLOR,
  DOOR_DEFAULTS,
  DOOR_SWING_DEFAULTS,
  FLOOR_FINISHES,
  FURNITURE_DIM,
  HEX_COLOR,
  HINGES,
  IMAGE_FRACTION,
  ITEM_CATEGORIES,
  MAX_CUSTOM_KINDS,
  MAX_NOTES,
  MAX_PARTS,
  MAX_PENDING_APPROVALS,
  NOTE_AUTHORS,
  NOTE_EXCERPT_CHARS,
  OPACITY,
  OPENING_HEIGHT,
  OPENING_SILL,
  OPENING_T,
  OPENING_WIDTH,
  ROOM_SIZE,
  ROTATION,
  SUPPLIER,
  SWING_SIDES,
  TEXT,
  UNDERLAY_PIXELS,
  UNDERLAY_SIZE,
  WALL_DEFAULTS,
  WALL_HEIGHT,
  WALL_MIN_LENGTH,
  WALL_THICKNESS,
  WINDOW_DEFAULTS,
  firstError,
  rangeError,
  type Actor,
  type CameraMode,
  type Hinge,
  type ItemCategory,
  type Range,
  type SwingSide,
} from "./limits";

export interface ActionResult {
  ok: boolean;
  summary: string;
  [key: string]: unknown;
}

export type { CameraMode };
export type ViewMode = "2d" | "3d";

/**
 * One undo step: the plan and the notes as they were before a change. Both are replaced, never
 * edited in place, so a step holds the very objects the page had — kinds stay frozen, and an
 * entity an undo brings back is the same object a pending approval was shown.
 */
export interface UndoStep {
  readonly model: PlanModel;
  readonly notes: Note[];
}

/** How a parked destructive call ended. "queue_full" means it was never parked at all. */
export type ApprovalOutcome = "approved" | "rejected" | "queue_full";

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
  undoStack: UndoStep[];
  webmcpStatus: "off" | "live";
  lastChangeAt: number;
  /** destructive agent calls waiting for a human decision */
  approvals: PendingApproval[];
  /** when true, destructive tool calls are parked until the human approves them */
  requireApproval: boolean;
  /** cross-origin tools discovered on partner origins, by tool name */
  supplierTools: string[];
}

/** How many undo steps are kept; the oldest falls off beyond this. */
export const UNDO_DEPTH = 50;
/** How many entries the on-page activity feed keeps. */
export const ACTIVITY_LIMIT = 200;

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
}));

// ---------------------------------------------------------------------------
// Assets: an image is kept while the plan or its undo history refers to it
// ---------------------------------------------------------------------------

/** The assets `state` refers to: its plan's, and those of every plan its undo history keeps. */
export function referencedAssets(state: Pick<AppState, "model" | "undoStack">): Set<AssetId> {
  const ids = new Set<AssetId>();
  if (state.model.underlay) ids.add(state.model.underlay.assetId);
  for (const step of state.undoStack) if (step.model.underlay) ids.add(step.model.underlay.assetId);
  return ids;
}

/** Release every asset that is not held and that neither the plan nor its undo history refers to. */
export const collectAssets = (): number => releaseUnreferencedAssets(referencedAssets(store.getState()));

/**
 * Let go of an asset put for a change (an upload, once its set_underlay has been dispatched):
 * from now on the plans that refer to it keep it, and if none does — the change was refused —
 * it is released at once.
 */
export function releaseHeldAsset(id: AssetId): void {
  letGoOfAsset(id);
  collectAssets();
}

// After every change to the plan or the history, whatever neither refers to any more is
// released — an image leaves memory with the last undo step that held it.
store.subscribe((s, prev) => {
  if (s.model !== prev.model || s.undoStack !== prev.undoStack) releaseUnreferencedAssets(referencedAssets(s));
});

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export function logActivity(source: ActivityEntry["source"], tool: string, summary: string, ok = true) {
  const entry: ActivityEntry = { id: uid("act"), at: Date.now(), source, tool, summary, ok };
  store.setState((s) => ({ activity: [...s.activity.slice(-(ACTIVITY_LIMIT - 1)), entry] }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * How snapshot requests are treated right now: "each" (an action called on its own records its
 * step), "once" (the first request inside withUndo records, the rest fold into it) or "none".
 */
let undoMode: "each" | "once" | "none" = "each";

function pushUndo() {
  if (undoMode === "none") return;
  if (undoMode === "once") undoMode = "none";
  store.setState((s) => ({ undoStack: [...s.undoStack.slice(-(UNDO_DEPTH - 1)), { model: s.model, notes: s.notes }] }));
}

/**
 * Run `fn` recording at most one undo step for everything it changes — or none, when `record`
 * is false. This is how a command that runs several actions (place a supplier product: adopt
 * its kind, then place it) and a gesture that runs one per frame (a drag) each come out as a
 * single step. Synchronous on purpose: nothing else can run while the mode is changed.
 */
export function withUndo<T>(record: boolean, fn: () => T): T {
  const previous = undoMode;
  undoMode = record ? "once" : "none";
  try {
    return fn();
  } finally {
    undoMode = previous;
  }
}

function setModel(model: PlanModel) {
  store.setState({ model, lastChangeAt: Date.now() });
}

/** id -> settle(granted); kept out of the store because promises are not serialisable state. */
const approvalResolvers = new Map<string, (granted: boolean) => void>();

const ok = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: false, summary, ...extra });

// ---------------------------------------------------------------------------
// Invariants. The tool schemas already refuse bad agent input, but the UI (and anything
// else holding `actions`) calls these directly, so each action checks its own arguments
// against limits.ts before it touches the model. A failure here never mutates anything.
// ---------------------------------------------------------------------------

/** A range to check, as [name, value, range]; an undefined value (an omitted option) is skipped. */
type RangeCheck = [name: string, value: unknown, range: Range];

const numbersError = (...checks: RangeCheck[]): string | null =>
  firstError(...checks.filter(([, v]) => v !== undefined).map(([n, v, r]) => rangeError(n, v, r)));

/** Text that must be a string of at most `max` characters (and not blank, unless allowed). */
function textError(name: string, value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return `${name} must be a string.`;
  if (!allowEmpty && value.trim() === "") return `${name} must not be empty.`;
  if (value.length > max) return `${name} is ${value.length} characters long (max ${max}).`;
  return null;
}

const colorError = (name: string, value: unknown): string | null =>
  typeof value === "string" && HEX_COLOR.test(value) ? null : `${name} must be a #rrggbb hex colour.`;

/** True when `value` is one of `allowed`; narrows it to that union. */
const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => allowed.includes(value as T);

const notOneOf = (name: string, allowed: readonly string[]): string => `${name} must be one of ${allowed.join(" | ")}.`;

/** A value that must be one of `allowed`. */
const memberError = (name: string, value: unknown, allowed: readonly string[]): string | null =>
  isOneOf(value, allowed) ? null : notOneOf(name, allowed);

/** An optional value that, when given, must be one of `allowed`. */
const oneOfError = (name: string, value: unknown, allowed: readonly string[]): string | null =>
  value === undefined ? null : memberError(name, value, allowed);

const isCategory = (c: unknown): c is ItemCategory => isOneOf(c, ITEM_CATEGORIES);

/**
 * Everything an underlay must satisfy to be held by the model. setUnderlay and
 * calibrateUnderlay both judge their result with this, so calibration can never produce an
 * underlay that setUnderlay (and so the opacity slider, which goes through it) would refuse.
 */
function underlayError(u: Underlay): string | null {
  return firstError(
    imageAssetError(u.assetId),
    numbersError(
      ["opacity", u.opacity, OPACITY],
      ["x", u.x, COORD], ["y", u.y, COORD],
      ["w", u.w, UNDERLAY_SIZE], ["h", u.h, UNDERLAY_SIZE],
      ["pw", u.pw, UNDERLAY_PIXELS], ["ph", u.ph, UNDERLAY_PIXELS],
    ),
  );
}

/** Patchable fields, listed once: a patch is built from these keys and nothing else. */
const WALL_PATCH_KEYS = ["ax", "ay", "bx", "by", "thickness", "height"] as const;
const ROOM_PATCH_KEYS = ["x", "y", "w", "h", "label", "floor"] as const;
export type WallPatch = Partial<Pick<Wall, (typeof WALL_PATCH_KEYS)[number]>>;
export type RoomPatch = Partial<Pick<Room, (typeof ROOM_PATCH_KEYS)[number]>>;

/** A piece of furniture as define_item_kind describes it, before it is checked and frozen. */
export interface ItemKindSpec {
  kind: string;
  label: string;
  w: number;
  d: number;
  h: number;
  color?: string;
  category?: string;
  parts?: PartInput[];
}

/** A failed lookup as an action result: nothing changed, and the candidates travel with it. */
const lookupFailed = (found: Extract<Lookup<unknown>, { ok: false }>): ActionResult =>
  fail(found.summary, found.candidates.length > 0 ? { candidates: found.candidates } : {});

/** The plan's kinds with `def` in place of the kind of the same id, or appended when it is new. */
const withKind = (kinds: readonly KindDef[], def: KindDef): KindDef[] =>
  kinds.some((k) => k.kind === def.kind) ? kinds.map((k) => (k.kind === def.kind ? def : k)) : [...kinds, def];

// ---------------------------------------------------------------------------
// Plan actions — what dispatch() runs, for either actor
// ---------------------------------------------------------------------------

const planActions = {
  // ---- structure ----
  addWall(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height,
  ): ActionResult {
    const bad = numbersError(
      ["ax", ax, COORD], ["ay", ay, COORD], ["bx", bx, COORD], ["by", by, COORD],
      ["thickness", thickness, WALL_THICKNESS], ["height", height, WALL_HEIGHT],
    );
    if (bad) return fail(bad);
    ax = snap(ax); ay = snap(ay); bx = snap(bx); by = snap(by);
    const len = segLen(ax, ay, bx, by);
    if (len < WALL_MIN_LENGTH) {
      return fail(`Wall too short (${(len * 100).toFixed(0)} cm, min ${(WALL_MIN_LENGTH * 100).toFixed(0)} cm).`);
    }
    const wall: Wall = { id: uid("wall"), ax, ay, bx, by, thickness, height };
    pushUndo();
    setModel({ ...store.getState().model, walls: [...store.getState().model.walls, wall] });
    return ok(`Wall added (${len.toFixed(2)} m).`, { id: wall.id, length: len });
  },

  editWall(id: string, patch: WallPatch): ActionResult {
    const bad = firstError(
      textError("id", id, TEXT.ref),
      numbersError(
        ["ax", patch.ax, COORD], ["ay", patch.ay, COORD], ["bx", patch.bx, COORD], ["by", patch.by, COORD],
        ["thickness", patch.thickness, WALL_THICKNESS], ["height", patch.height, WALL_HEIGHT],
      ),
    );
    if (bad) return fail(bad);
    const found = lookupWall(store.getState().model, id);
    if (!found.ok) return lookupFailed(found);
    const wall = found.entity;
    // Built key by key from the allowed list, so nothing else in `patch` (an id, say) can land.
    const next: Wall = { ...wall };
    for (const k of WALL_PATCH_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      next[k] = k === "thickness" || k === "height" ? v : snap(v);
    }
    if (segLen(next.ax, next.ay, next.bx, next.by) < WALL_MIN_LENGTH) {
      return fail(`Edit rejected: wall would be shorter than ${(WALL_MIN_LENGTH * 100).toFixed(0)} cm.`);
    }
    pushUndo();
    setModel({
      ...store.getState().model,
      walls: store.getState().model.walls.map((w) => (w.id === wall.id ? next : w)),
    });
    return ok(`Wall ${wall.id} updated.`, { id: wall.id });
  },

  removeWall(id: string): ActionResult {
    const bad = textError("id", id, TEXT.ref);
    if (bad) return fail(bad);
    const found = lookupWall(store.getState().model, id);
    if (!found.ok) return lookupFailed(found);
    const wall = found.entity;
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
    swing?: { hinge?: Hinge; side?: SwingSide },
  ): ActionResult {
    if (kind !== "door" && kind !== "window") return fail(`Unknown opening kind "${String(kind)}". Use door | window.`);
    const defaults = kind === "door" ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
    const w = width ?? defaults.width;
    const s = sill ?? defaults.sill;
    const h = height ?? defaults.height;
    const bad = firstError(
      textError("wallId", wallId, TEXT.ref),
      numbersError(["t", t, OPENING_T], ["width", w, OPENING_WIDTH], ["sill", s, OPENING_SILL], ["height", h, OPENING_HEIGHT]),
      oneOfError("hinge", swing?.hinge, HINGES),
      oneOfError("side", swing?.side, SWING_SIDES),
    );
    if (bad) return fail(bad);
    const found = lookupWall(store.getState().model, wallId);
    if (!found.ok) return lookupFailed(found);
    const wall = found.entity;
    const clamped = clampOpeningT(wall, w, t);
    if (clamped === null) {
      const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
      return fail(`Wall ${wall.id} is ${len.toFixed(2)} m long — a ${w.toFixed(2)} m ${kind} does not fit.`);
    }
    if (s + h > wall.height) return fail(`${kind} (sill ${s} + height ${h}) exceeds wall height ${wall.height} m.`);
    const opening: Opening = { id: uid(kind), kind, wallId: wall.id, t: clamped, width: w, sill: s, height: h };
    if (kind === "door") {
      opening.hinge = swing?.hinge ?? DOOR_SWING_DEFAULTS.hinge;
      opening.side = swing?.side ?? DOOR_SWING_DEFAULTS.side;
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
  setDoorSwing(id: string, hinge?: Hinge, side?: SwingSide): ActionResult {
    const bad = firstError(textError("id", id, TEXT.ref), oneOfError("hinge", hinge, HINGES), oneOfError("side", side, SWING_SIDES));
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupOpening(model, id);
    if (!found.ok) return lookupFailed(found);
    const o = found.entity;
    if (o.kind !== "door") return fail(`${o.id} is a window — only doors swing.`);
    const next = {
      ...o,
      hinge: hinge ?? o.hinge ?? DOOR_SWING_DEFAULTS.hinge,
      side: side ?? o.side ?? DOOR_SWING_DEFAULTS.side,
    };
    pushUndo();
    setModel({ ...model, openings: model.openings.map((x) => (x.id === o.id ? next : x)) });
    return ok(`Door ${o.id} hinges on "${next.hinge}" and swings to the "${next.side}".`, { id: o.id });
  },

  moveOpening(id: string, t: number): ActionResult {
    const bad = firstError(textError("id", id, TEXT.ref), numbersError(["t", t, OPENING_T]));
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupOpening(model, id);
    if (!found.ok) return lookupFailed(found);
    const o = found.entity;
    // the host by its exact id: an opening's wallId is a reference the model holds, not a name
    const wall = model.walls.find((w) => w.id === o.wallId);
    if (!wall) return fail(`${o.kind} ${o.id} is on wall ${o.wallId}, which no longer exists.`);
    const clamped = clampOpeningT(wall, o.width, t);
    if (clamped === null) return fail("Opening does not fit on its wall.");
    pushUndo();
    setModel({ ...model, openings: model.openings.map((x) => (x.id === o.id ? { ...x, t: clamped } : x)) });
    return ok(`${o.kind} ${o.id} moved to t=${clamped.toFixed(2)}.`, { id: o.id, t: clamped });
  },

  removeOpening(id: string): ActionResult {
    const bad = textError("id", id, TEXT.ref);
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupOpening(model, id);
    if (!found.ok) return lookupFailed(found);
    const o = found.entity;
    pushUndo();
    setModel({ ...model, openings: model.openings.filter((x) => x.id !== o.id) });
    return ok(`${o.kind} ${o.id} removed.`, { id: o.id });
  },

  // ---- rooms ----
  addRoom(x: number, y: number, w: number, h: number, label: string, floor: string = DEFAULT_FLOOR): ActionResult {
    // The size is judged as given, the same rule the add_room schema and updateRoom apply;
    // snapping cannot then take it under the minimum (see ROOM_SIZE).
    const bad = firstError(
      numbersError(["x", x, COORD], ["y", y, COORD], ["w", w, ROOM_SIZE], ["h", h, ROOM_SIZE]),
      textError("label", label, TEXT.label),
    );
    if (bad) return fail(bad);
    if (!isOneOf(floor, FLOOR_FINISHES)) return fail(notOneOf("floor", FLOOR_FINISHES));
    x = snap(x); y = snap(y); w = snap(w); h = snap(h);
    const room: Room = { id: uid("room"), x, y, w, h, label, floor };
    pushUndo();
    setModel({ ...store.getState().model, rooms: [...store.getState().model.rooms, room] });
    return ok(`Room "${label}" added (${w.toFixed(2)} × ${h.toFixed(2)} m).`, { id: room.id });
  },

  updateRoom(idOrLabel: string, patch: RoomPatch): ActionResult {
    const bad = firstError(
      textError("id", idOrLabel, TEXT.ref),
      numbersError(["x", patch.x, COORD], ["y", patch.y, COORD], ["w", patch.w, ROOM_SIZE], ["h", patch.h, ROOM_SIZE]),
      patch.label === undefined ? null : textError("label", patch.label, TEXT.label),
      oneOfError("floor", patch.floor, FLOOR_FINISHES),
    );
    if (bad) return fail(bad);
    const found = lookupRoom(store.getState().model, idOrLabel);
    if (!found.ok) return lookupFailed(found);
    const room = found.entity;
    // Only the patchable fields are copied. Spreading the whole patch let the lookup key in
    // it replace the room's real id: update_room { id: "bedroom" } renamed the id to "bedroom".
    const next: Room = { ...room };
    for (const k of ROOM_PATCH_KEYS) {
      const v = patch[k];
      if (v !== undefined) (next as Record<(typeof ROOM_PATCH_KEYS)[number], unknown>)[k] = v;
    }
    pushUndo();
    setModel({
      ...store.getState().model,
      rooms: store.getState().model.rooms.map((r) => (r.id === room.id ? next : r)),
    });
    return ok(`Room "${next.label}" updated.`, { id: room.id });
  },

  removeRoom(idOrLabel: string): ActionResult {
    const bad = textError("id", idOrLabel, TEXT.ref);
    if (bad) return fail(bad);
    const found = lookupRoom(store.getState().model, idOrLabel);
    if (!found.ok) return lookupFailed(found);
    const room = found.entity;
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.filter((r) => r.id !== room.id) });
    return ok(`Room "${room.label}" removed.`, { id: room.id });
  },

  // ---- furniture ----
  placeItem(kind: string, x: number, y: number, rotation = 0): ActionResult {
    const bad = firstError(
      textError("kind", kind, TEXT.kind),
      numbersError(["x", x, COORD], ["y", y, COORD], ["rotation", rotation, ROTATION]),
    );
    if (bad) return fail(bad);
    const model = store.getState().model;
    const cat = catalogOf(model).get(kind);
    if (!cat) return fail(`Unknown furniture kind ${JSON.stringify(kind)}. Use get_item_catalog.`);
    const item: Item = { id: uid("item"), kind: cat.kind, x: snap(x), y: snap(y), rotation };
    pushUndo();
    setModel({ ...model, items: [...model.items, item] });
    return ok(`${kindName(cat)} placed at (${item.x.toFixed(2)}, ${item.y.toFixed(2)}).`, { id: item.id });
  },

  moveItem(idOrKind: string, x?: number, y?: number, rotation?: number): ActionResult {
    const bad = firstError(
      textError("id", idOrKind, TEXT.ref),
      numbersError(["x", x, COORD], ["y", y, COORD], ["rotation", rotation, ROTATION]),
    );
    if (bad) return fail(bad);
    const found = lookupItem(store.getState().model, idOrKind);
    if (!found.ok) return lookupFailed(found);
    const item = found.entity;
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
    const bad = textError("id", idOrKind, TEXT.ref);
    if (bad) return fail(bad);
    const found = lookupItem(store.getState().model, idOrKind);
    if (!found.ok) return lookupFailed(found);
    const item = found.entity;
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.filter((i) => i.id !== item.id) });
    return ok(`Item ${item.id} removed.`, { id: item.id });
  },

  // ---- model / view ----
  setPlanName(name: string): ActionResult {
    // empty is allowed: it is what the name field holds mid-edit
    const bad = textError("name", name, TEXT.planName, true);
    if (bad) return fail(bad);
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

  /**
   * Replace the whole plan, e.g. with the demo loft. Undoable like any other edit. A plan that
   * arrives as data (parsed JSON) has its kinds frozen on the way in, like every kind it holds.
   * Its underlay is kept only if it is one setUnderlay would accept: a plan saved in another
   * session names an image by an id this page does not hold, and the bytes do not travel with it.
   */
  loadModel(model: PlanModel): ActionResult {
    const underlay = model.underlay && !underlayError(model.underlay) ? model.underlay : null;
    pushUndo();
    setModel({ ...model, kinds: model.kinds.map(freezeKind), underlay });
    return ok(`Plan "${model.name}" loaded: ${model.walls.length} walls, ${model.rooms.length} rooms, ${model.items.length} items.`);
  },

  // ---- collaboration ----
  /** Notes are signed by one of the two actors; the page itself does not write them. */
  leaveNote(author: ActivitySource, text: string): ActionResult {
    if (!isOneOf(author, NOTE_AUTHORS)) return fail(notOneOf("author", NOTE_AUTHORS));
    const bad = textError("text", text, TEXT.note);
    if (bad) return fail(bad);
    if (store.getState().notes.length >= MAX_NOTES) {
      return fail(`The plan already holds ${MAX_NOTES} notes, the most it keeps — ask the human to clear some first.`);
    }
    const note: Note = { id: uid("note"), author, text, at: Date.now() };
    pushUndo();
    store.setState((s) => ({ notes: [...s.notes, note] }));
    return ok(`Note saved (${author}): "${clip(text, NOTE_EXCERPT_CHARS)}"`, { id: note.id });
  },

  // ---- underlay ----
  setUnderlay(underlay: Underlay | null): ActionResult {
    if (underlay !== null) {
      const bad = underlayError(underlay);
      if (bad) return fail(bad);
    }
    pushUndo();
    setModel({ ...store.getState().model, underlay });
    if (!underlay) return ok("Underlay removed.");
    const size = underlay.pw && underlay.ph ? ` (${underlay.pw}×${underlay.ph})` : "";
    return ok(`Blueprint set${size}, opacity ${Math.round(underlay.opacity * 100)}%. Trace walls over it.`);
  },

  calibrateUnderlay(u1: number, v1: number, u2: number, v2: number, meters: number, opacity?: number): ActionResult {
    const bad = numbersError(
      ["u1", u1, IMAGE_FRACTION], ["v1", v1, IMAGE_FRACTION], ["u2", u2, IMAGE_FRACTION], ["v2", v2, IMAGE_FRACTION],
      ["meters", meters, CALIBRATION_METERS], ["opacity", opacity, OPACITY],
    );
    if (bad) return fail(bad);
    const m = store.getState().model;
    const u = m.underlay;
    if (!u) return fail("No underlay loaded — ask the human to upload the plan image first (sidebar → Blueprint underlay).");
    // world distance between the two fractional image points at the CURRENT scale
    const frac = Math.hypot((u2 - u1) * u.w, (v2 - v1) * u.h);
    if (frac < 1e-6) return fail("The two calibration points coincide.");
    const scale = meters / frac;
    const newW = u.w * scale;
    const newH = u.h * scale;
    // keep image point 1 fixed in world space
    const p1x = u.x + u1 * u.w;
    const p1y = u.y + v1 * u.h;
    const next: Underlay = { ...u, x: p1x - u1 * newW, y: p1y - v1 * newH, w: newW, h: newH, opacity: opacity ?? u.opacity };
    // The result is judged like any other underlay. A scale that pushes the rect's corner off
    // the plan is refused here, rather than stored and found later when every setUnderlay on
    // it (the opacity slider's included) is refused.
    const badNext = underlayError(next);
    if (badNext) return fail(`Calibration rejected: the calibrated underlay would be invalid (${badNext})`);
    pushUndo();
    setModel({ ...m, underlay: next });
    return ok(
      `Underlay calibrated: ${u.w.toFixed(2)} → ${newW.toFixed(2)} m wide (×${scale.toFixed(3)}). Image point (${u1}, ${v1}) stays at world (${p1x.toFixed(2)}, ${p1y.toFixed(2)}).`,
      { w: newW, h: newH, scale },
    );
  },

  // ---- catalogue (the plan's own kinds) ----

  /**
   * Adopt a product from the partner origin into this plan's catalogue, keeping the
   * supplier's real dimensions so the constraint checker judges it like anything else.
   * The supplier boundary has already validated it; the checks here hold for any caller.
   * A product the plan already holds keeps its first definition, so its kind stays stable.
   *
   * The summary names the product by sku: its name is the partner's text, not the page's.
   */
  importSupplierProduct(p: SupplierProductData): ActionResult {
    const bad = firstError(
      typeof p.sku === "string" && SUPPLIER.sku.test(p.sku) ? null : "sku is not a valid supplier sku.",
      textError("name", p.name, TEXT.label),
      textError("category", p.category, TEXT.category),
      numbersError(["w", p.w, FURNITURE_DIM], ["d", p.d, FURNITURE_DIM], ["h", p.h, FURNITURE_DIM]),
      colorError("color", p.color),
    );
    if (bad) return fail(`Supplier product rejected: ${bad}`);
    const kind = supplierKind(p.sku);
    const model = store.getState().model;
    if (catalogOf(model).get(kind)) return ok(`Supplier product ${kind} is already in this plan's catalogue.`, { kind });
    const category = isCategory(p.category) ? p.category : p.category === "dining" ? "kitchen" : "decor";
    const def = freezeKind({ kind, label: p.name, w: p.w, d: p.d, h: p.h, color: p.color, category, source: "supplier" });
    pushUndo();
    setModel({ ...model, kinds: withKind(model.kinds, def) });
    return ok(`Supplier product ${kind} added to this plan's catalogue (${p.w} × ${p.d} m).`, { kind });
  },

  /**
   * Register a piece of furniture that is not in the catalogue — the escape hatch that lets an
   * agent match what a plan actually draws instead of approximating with the nearest stock item.
   * `parts` is optional: without it the piece is blocked out from its footprint. Redefining a
   * kind replaces its whole definition, parts included.
   */
  defineItemKind(spec: ItemKindSpec): ActionResult {
    const bad = firstError(
      textError("kind", spec.kind, TEXT.kind),
      textError("label", spec.label, TEXT.label),
      numbersError(["w", spec.w, FURNITURE_DIM], ["d", spec.d, FURNITURE_DIM], ["h", spec.h, FURNITURE_DIM]),
      spec.color === undefined ? null : colorError("color", spec.color),
      spec.parts !== undefined && (!Array.isArray(spec.parts) || spec.parts.length > MAX_PARTS)
        ? `parts must be a list of at most ${MAX_PARTS} primitives.`
        : null,
    );
    if (bad) return fail(bad);
    // each part is a mesh in every 3D build, so its numbers are held to the same ranges
    const parts = spec.parts === undefined ? undefined : partList.safeParse(spec.parts);
    if (parts && !parts.success) return fail(describeIssues(parts.error, { under: "parts" }).join("; "));
    const kind = spec.kind.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
    if (!kind) return fail("A kind id is required.");
    const model = store.getState().model;
    const existing = catalogOf(model).get(kind);
    if (existing?.source === "builtin") {
      return fail(`"${kind}" is a built-in kind — pick another id or use place_item.`);
    }
    // the supplier's namespace is the supplier's: an agent kind there would shadow a product
    if (isSupplierKind(kind)) {
      return fail(`"${kind}" is reserved for supplier products — pick another id, or use place_supplier_product.`);
    }
    if (!existing && customKindCount(model) >= MAX_CUSTOM_KINDS) {
      return fail(`The catalogue already holds ${MAX_CUSTOM_KINDS} custom kinds, the most it keeps — redefine one of them instead.`);
    }
    const partCount = parts?.data.length ?? 0;
    const def = freezeKind({
      kind,
      label: spec.label,
      w: spec.w,
      d: spec.d,
      h: spec.h,
      color: spec.color ?? DEFAULT_ITEM_COLOR,
      category: isCategory(spec.category) ? spec.category : "decor",
      source: "custom",
      ...(parts && partCount > 0 ? { parts: parts.data } : {}),
    });
    pushUndo();
    setModel({ ...model, kinds: withKind(model.kinds, def) });
    return ok(
      `"${spec.label}" defined as ${kind} (${spec.w} × ${spec.d} × ${spec.h} m${partCount ? `, ${partCount} parts` : ", blocked out from its footprint"}). Place it with place_item.`,
      { kind },
    );
  },

  undo(): ActionResult {
    const { undoStack } = store.getState();
    if (undoStack.length === 0) return fail("Nothing to undo.");
    const prev = undoStack[undoStack.length - 1];
    // one update: between popping the step and restoring its plan, nothing would refer to that
    // plan's image, and the asset collection would release it
    store.setState({ undoStack: undoStack.slice(0, -1), notes: prev.notes, model: prev.model, lastChangeAt: Date.now() });
    return ok("Undone.");
  },
};

// ---------------------------------------------------------------------------
// Page actions — the view, the selection and the approval bar. None of them changes the plan,
// so the UI calls them directly.
// ---------------------------------------------------------------------------

/** What a destructive call asks the human, written by the page from the entities it resolved. */
export interface ApprovalRequest {
  tool: string;
  actor: Actor;
  request: string;
  targets: ApprovalTarget[];
  effects: string[];
}

export const pageActions = {
  build3d(): ActionResult {
    const m = store.getState().model;
    if (m.walls.length === 0) return fail("Nothing to build: the plan has no walls yet.");
    store.setState((s) => ({ editor: { ...s.editor, view: "3d" } }));
    return ok(`3D model built: ${m.walls.length} walls, ${m.openings.length} openings, ${m.items.length} items.`);
  },

  setCamera(mode: CameraMode): ActionResult {
    if (!isOneOf(mode, CAMERA_MODES)) return fail(`Unknown camera "${String(mode)}". Use ${CAMERA_MODES.join(" | ")}.`);
    store.setState((s) => ({ editor: { ...s.editor, view: "3d", camera: mode } }));
    return ok(`Camera set to ${mode}.`);
  },

  setView(view: ViewMode) {
    store.setState((s) => ({ editor: { ...s.editor, view } }));
  },

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

  // ---- human-in-the-loop approval ----
  setRequireApproval(on: boolean) {
    store.setState({ requireApproval: on });
    logActivity("human", "approval_policy", on ? "Destructive agent actions now need your approval." : "Approval gate switched off.", true);
  },

  resolveApproval(id: string, granted: boolean): ActionResult {
    const entry = store.getState().approvals.find((a) => a.id === id);
    const settle = approvalResolvers.get(id);
    if (!entry || !settle) return fail("That request is no longer pending.");
    settle(granted);
    logActivity("human", entry.tool, granted ? `Approved: ${entry.request}` : `Rejected: ${entry.request}`, granted);
    return ok(granted ? "Approved." : "Rejected.");
  },
};

/**
 * Park a destructive call until the human decides. Resolves "approved" or "rejected" — or
 * "queue_full" at once, without parking anything, when MAX_PENDING_APPROVALS requests are
 * already waiting: an agent must not be able to bury the page in prompts.
 * Honours the AbortSignal WebMCP hands to execute(), so an agent that gives up
 * releases the request instead of leaving it hanging on the page.
 */
function requestApproval(ask: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalOutcome> {
  if (store.getState().approvals.length >= MAX_PENDING_APPROVALS) return Promise.resolve("queue_full");
  const entry: PendingApproval = { id: uid("appr"), ...ask, at: Date.now() };
  store.setState((s) => ({ approvals: [...s.approvals, entry] }));
  logActivity(ask.actor, ask.tool, `Waiting for your approval: ${ask.request}`, true);
  return new Promise<ApprovalOutcome>((resolve) => {
    const settle = (granted: boolean) => {
      if (!approvalResolvers.has(entry.id)) return;
      approvalResolvers.delete(entry.id);
      store.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== entry.id) }));
      resolve(granted ? "approved" : "rejected");
    };
    approvalResolvers.set(entry.id, settle);
    signal?.addEventListener("abort", () => settle(false), { once: true });
  });
}

/**
 * Every action. The tool layer, the command dispatcher and the scripts' test hook hold this;
 * the UI holds pageActions and changes the plan through dispatch (eslint.config.js enforces it).
 */
export const actions = {
  ...planActions,
  ...pageActions,
  requestApproval,
  setSupplierTools(names: string[]) {
    store.setState({ supplierTools: names });
  },
  setWebmcpStatus(status: "off" | "live") {
    store.setState({ webmcpStatus: status });
  },
};
