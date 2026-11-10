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
import { catalogByKind, customKindCount, isBuiltInKind, isSupplierKind, registerCatalogEntry, supplierKind } from "./catalog";
import { defineCustomKind, FURNITURE_BUILDERS } from "../three/furniture";
import { describeIssues, partList, type PartInput } from "./schemas";
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
  UNDERLAY,
  UNDERLAY_PIXELS,
  UNDERLAY_SIZE,
  WALL_DEFAULTS,
  WALL_HEIGHT,
  WALL_MIN_LENGTH,
  WALL_THICKNESS,
  WINDOW_DEFAULTS,
  firstError,
  rangeError,
  type CameraMode,
  type Hinge,
  type ItemCategory,
  type NoteAuthor,
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

/** How many plan snapshots undo keeps; the oldest falls off beyond this. */
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
  catalogRev: 0,
}));

export const useAppStore = <T>(selector: (s: AppState) => T): T => useStore(store, selector);

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

function pushUndo() {
  store.setState((s) => ({ undoStack: [...s.undoStack.slice(-(UNDO_DEPTH - 1)), structuredClone(s.model)] }));
}

function setModel(model: PlanModel) {
  store.setState({ model, lastChangeAt: Date.now() });
}

/** id -> settle(granted); kept out of the store because promises are not serialisable state. */
const approvalResolvers = new Map<string, (granted: boolean) => void>();

const bumpCatalog = () => store.setState((s) => ({ catalogRev: s.catalogRev + 1 }));

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
  const { dataUrl } = u;
  return firstError(
    typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? null : "dataUrl must be a data:image/… URL.",
    typeof dataUrl === "string" && dataUrl.length > UNDERLAY.maxDataUrlChars
      ? `The underlay image is too large to keep (${dataUrl.length} characters, max ${UNDERLAY.maxDataUrlChars}).`
      : null,
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

/** A wall by exact id, or else by a fragment of one. Every tool that addresses a wall resolves it here. */
export function findWall(idOrHint: string): Wall | undefined {
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
    const wall = findWall(id);
    if (!wall) return fail(`Wall "${id}" not found.`);
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
    const wall = findWall(wallId);
    if (!wall) return fail(`Wall "${wallId}" not found.`);
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
    const { openings } = store.getState().model;
    const o = openings.find((x) => x.id === id) ?? openings.find((x) => x.id.includes(id));
    if (!o) return fail(`Opening "${id}" not found.`);
    if (o.kind !== "door") return fail(`${o.id} is a window — only doors swing.`);
    const next = {
      ...o,
      hinge: hinge ?? o.hinge ?? DOOR_SWING_DEFAULTS.hinge,
      side: side ?? o.side ?? DOOR_SWING_DEFAULTS.side,
    };
    pushUndo();
    setModel({
      ...store.getState().model,
      openings: openings.map((x) => (x.id === o.id ? next : x)),
    });
    return ok(`Door ${o.id} hinges on "${next.hinge}" and swings to the "${next.side}".`, { id: o.id });
  },

  moveOpening(id: string, t: number): ActionResult {
    const bad = firstError(textError("id", id, TEXT.ref), numbersError(["t", t, OPENING_T]));
    if (bad) return fail(bad);
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
    const bad = textError("id", id, TEXT.ref);
    if (bad) return fail(bad);
    const { openings } = store.getState().model;
    const o = openings.find((x) => x.id === id) ?? openings.find((x) => x.id.includes(id));
    if (!o) return fail(`Opening "${id}" not found.`);
    pushUndo();
    setModel({ ...store.getState().model, openings: openings.filter((x) => x.id !== o.id) });
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
    const room = findRoom(idOrLabel);
    if (!room) return fail(`Room "${idOrLabel}" not found.`);
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
    const room = findRoom(idOrLabel);
    if (!room) return fail(`Room "${idOrLabel}" not found.`);
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
    const cat = catalogByKind(kind);
    if (!cat) return fail(`Unknown furniture kind "${kind}". Use get_item_catalog.`);
    const item: Item = { id: uid("item"), kind: cat.kind, x: snap(x), y: snap(y), rotation };
    pushUndo();
    setModel({ ...store.getState().model, items: [...store.getState().model.items, item] });
    return ok(`${cat.label} placed at (${item.x.toFixed(2)}, ${item.y.toFixed(2)}).`, { id: item.id });
  },

  moveItem(idOrKind: string, x?: number, y?: number, rotation?: number): ActionResult {
    const bad = firstError(
      textError("id", idOrKind, TEXT.ref),
      numbersError(["x", x, COORD], ["y", y, COORD], ["rotation", rotation, ROTATION]),
    );
    if (bad) return fail(bad);
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
    const bad = textError("id", idOrKind, TEXT.ref);
    if (bad) return fail(bad);
    const item = findItem(idOrKind);
    if (!item) return fail(`Item "${idOrKind}" not found.`);
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

  // ---- collaboration ----
  leaveNote(author: NoteAuthor, text: string): ActionResult {
    const bad = firstError(memberError("author", author, NOTE_AUTHORS), textError("text", text, TEXT.note));
    if (bad) return fail(bad);
    if (store.getState().notes.length >= MAX_NOTES) {
      return fail(`The plan already holds ${MAX_NOTES} notes, the most it keeps — ask the human to clear some first.`);
    }
    const note: Note = { id: uid("note"), author, text, at: Date.now() };
    store.setState((s) => ({ notes: [...s.notes, note] }));
    return ok(`Note saved (${author}): "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`, { id: note.id });
  },

  // ---- underlay ----
  setUnderlay(underlay: Underlay | null): ActionResult {
    if (underlay !== null) {
      const bad = underlayError(underlay);
      if (bad) return fail(bad);
    }
    setModel({ ...store.getState().model, underlay });
    return ok(underlay ? "Underlay set." : "Underlay removed.");
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
    setModel({ ...m, underlay: next });
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
   * Park a destructive agent call until the human decides. Resolves "approved" or "rejected" —
   * or "queue_full" at once, without parking anything, when MAX_PENDING_APPROVALS requests are
   * already waiting: an agent must not be able to bury the page in prompts.
   * Honours the AbortSignal WebMCP hands to execute(), so an agent that gives up
   * releases the request instead of leaving it hanging on the page.
   */
  requestApproval(tool: string, request: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ApprovalOutcome> {
    if (store.getState().approvals.length >= MAX_PENDING_APPROVALS) return Promise.resolve("queue_full");
    const entry: PendingApproval = { id: uid("appr"), tool, request, args, at: Date.now() };
    store.setState((s) => ({ approvals: [...s.approvals, entry] }));
    logActivity("agent", tool, `Waiting for your approval: ${request}`, true);
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
   * The supplier boundary has already validated it; the checks here hold for any caller.
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
    const bad = firstError(
      typeof p.sku === "string" && SUPPLIER.sku.test(p.sku) ? null : "sku is not a valid supplier sku.",
      textError("name", p.name, TEXT.label),
      textError("category", p.category, TEXT.category),
      numbersError(["w", p.w, FURNITURE_DIM], ["d", p.d, FURNITURE_DIM], ["h", p.h, FURNITURE_DIM]),
      colorError("color", p.color),
    );
    if (bad) return fail(`Supplier product rejected: ${bad}`);
    const kind = supplierKind(p.sku);
    const category = isCategory(p.category) ? p.category : p.category === "dining" ? "kitchen" : "decor";
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
    parts?: PartInput[];
  }): ActionResult {
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
    if (isBuiltInKind(kind) || FURNITURE_BUILDERS[kind]) {
      return fail(`"${kind}" is a built-in kind — pick another id or use place_item.`);
    }
    // the supplier's namespace is the supplier's: an agent kind there would shadow a product
    if (isSupplierKind(kind)) {
      return fail(`"${kind}" is reserved for supplier products — pick another id, or use place_supplier_product.`);
    }
    const existing = catalogByKind(kind);
    if (!existing && customKindCount() >= MAX_CUSTOM_KINDS) {
      return fail(`The catalogue already holds ${MAX_CUSTOM_KINDS} custom kinds, the most it keeps — redefine one of them instead.`);
    }
    const category = isCategory(spec.category) ? spec.category : "decor";
    const color = spec.color ?? DEFAULT_ITEM_COLOR;
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
    const partCount = parts?.data.length ?? 0;
    if (parts && partCount > 0) defineCustomKind(kind, parts.data);
    bumpCatalog();
    return ok(
      `"${spec.label}" defined as ${kind} (${spec.w} × ${spec.d} × ${spec.h} m${partCount ? `, ${partCount} parts` : ", blocked out from its footprint"}). Place it with place_item.`,
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
