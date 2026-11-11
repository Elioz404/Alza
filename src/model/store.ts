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
  Column,
  Item,
  KindDef,
  Level,
  Note,
  Opening,
  OpeningKind,
  PendingApproval,
  PlanModel,
  Room,
  RoomVertex,
  Stair,
  Underlay,
  Wall,
} from "./types";
import { emptyModel } from "./types";
import { uid } from "./ids";
import { imageAssetError, letGoOfAsset, releaseUnreferencedAssets, type AssetId } from "./assets";
import { clampOpeningT, garageDoorFitError, openingArcError } from "./issues";
import { segLen, snap } from "./geometry";
import {
  closestOnEdge,
  curveBulge,
  edgeArc,
  edgeBulge,
  isStraight,
  normalizeOutline,
  outlineArea,
  outlineBounds,
  outlineEdges,
  outlineError,
  outlineRect,
  rectOutline,
  stretchOutline,
  subEdge,
  translateOutline,
  wallArcError,
  wallLength,
  type CurveInput,
} from "./shapes";
import {
  catalogOf,
  customKindCount,
  freezeKind,
  isSupplierKind,
  kindName,
  supplierKind,
  type SupplierProductData,
} from "./catalog";
import { lookupColumn, lookupItem, lookupLevel, lookupOpening, lookupRoom, lookupStair, lookupWall, type Lookup } from "./resolve";
import { columnCoord, columnGrid, columnHeight, sectionOf } from "./columns";
import { elevationOf, freeLevelName, levelContents, levelIdOf, levelInfo, levelNameTaken, meetsSlab, slabUnderside, levelRemovalError, rerouteText, stairGeometryIn, stairsRerouted } from "./levels";
import { migratePlan, type PlanInput } from "./planFormat";
import { clip, describeIssues, partList, type PartInput } from "./schemas";
import {
  CALIBRATION_METERS,
  CAMERA_MODES,
  COLUMN,
  COLUMN_GRID,
  COLUMN_SHAPES,
  COORD,
  CUT_HEIGHT,
  DEFAULT_FLOOR,
  DEFAULT_ITEM_COLOR,
  DOOR_DEFAULTS,
  DOOR_STYLES,
  DOOR_SWING_DEFAULTS,
  FLOOR_FINISHES,
  GARAGE_DOOR,
  FURNITURE_DIM,
  GROUND_LEVEL_ID,
  HEX_COLOR,
  HINGES,
  IMAGE_FRACTION,
  ITEM_CATEGORIES,
  LEVEL_DEFAULTS,
  LEVEL_HEIGHT,
  LEVEL_WALLS,
  MAX_COLUMNS,
  MAX_CUSTOM_KINDS,
  MAX_LEVELS,
  MAX_NOTES,
  MAX_PARTS,
  MAX_PENDING_APPROVALS,
  MAX_STAIRS,
  NOTE_AUTHORS,
  NOTE_EXCERPT_CHARS,
  OPACITY,
  OPEN_FLOOR,
  OPENING_HEIGHT,
  OPENING_SILL,
  OPENING_T,
  OPENING_WIDTH,
  BULGE,
  ROOM_KINDS,
  ROOM_SHAPE,
  ROOM_SIZE,
  ROTATION,
  SCENE_STYLE_DEFAULTS,
  SIGNED_LENGTH,
  STAIR,
  STAIR_DEFAULTS,
  STAIR_SHAPES,
  STAIR_TURNS,
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
  within,
  type Actor,
  type CameraMode,
  type ColumnShape,
  type DoorStyle,
  type Hinge,
  type ItemCategory,
  type Range,
  type SceneStyle,
  type StairShape,
  type StairTurn,
  type SwingSide,
} from "./limits";

export interface ActionResult {
  ok: boolean;
  summary: string;
  [key: string]: unknown;
}

export type { CameraMode, SceneStyle };
export type ViewMode = "2d" | "3d";

/**
 * One undo step: the plan and the notes as they were before a change. Both are replaced, never
 * edited in place, so a step holds the very objects the page had — kinds stay frozen, and an
 * entity an undo brings back is the same object a pending approval was shown.
 */
export interface UndoStep {
  /**
   * Which step it is. Another tab's change is folded into every step this tab keeps (the shared
   * session rebases them, src/session/), which replaces the step's plan but not the step: its
   * key stays, so a gesture still knows the step it records into.
   */
  readonly key: number;
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
  selectedStairId: string | null;
  selectedColumnId: string | null;
  /**
   * The level the human is working on: what the plan shows and where a new wall, room, piece or
   * stair goes when none is named. A view setting, never in the undo history; read it through
   * activeLevelId(), which falls back to the ground level when the plan no longer has this one.
   */
  activeLevelId: string;
  drawMode: "select" | "wall" | "room" | "place";
  placingKind: string | null;
  pendingWallStart: { x: number; y: number } | null;
  /** how the 3D view draws the model (edges, cutaway): the tab's view settings, not the plan's */
  scene: SceneStyle;
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

export { uid } from "./ids";

const initialEditor: EditorState = {
  view: "2d",
  camera: "orbit",
  selectedWallId: null,
  selectedItemId: null,
  selectedRoomId: null,
  selectedStairId: null,
  selectedColumnId: null,
  activeLevelId: GROUND_LEVEL_ID,
  drawMode: "select",
  placingKind: null,
  pendingWallStart: null,
  scene: SCENE_STYLE_DEFAULTS,
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
let undoKeys = 0;

function pushUndo() {
  if (undoMode === "none") return;
  if (undoMode === "once") undoMode = "none";
  const key = ++undoKeys;
  store.setState((s) => ({ undoStack: [...s.undoStack.slice(-(UNDO_DEPTH - 1)), { key, model: s.model, notes: s.notes }] }));
}

/** Whether `next` holds the same steps as `held`, in the same order (each perhaps rebased). */
const sameSteps = (held: readonly UndoStep[], next: readonly UndoStep[]): boolean =>
  held.length === next.length && held.every((step, i) => step.key === next[i].key);

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

/** The 3D view's drawing style as it stands. */
const currentSceneStyle = (): SceneStyle => store.getState().editor.scene;

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
/**
 * `levelId` (an id or a level's name) moves the entity to that level, keeping where it is on the
 * plan. A wall's `curve` bends it (or straightens it: a sagitta or bulge of 0), measured on its
 * endpoints as the patch leaves them; moving an endpoint of a curved wall keeps its bulge.
 */
export type WallPatch = Partial<Pick<Wall, (typeof WALL_PATCH_KEYS)[number]>> & { levelId?: string; curve?: CurveInput };
/**
 * A room's patch. Its shape changes in this order, each step on the last one's result: `points`
 * replaces the outline; `w`, `h` stretch it from its bounds' top-left corner to that size; `x`,
 * `y` move that corner there. On a rectangle they are its corner and size, as they always were.
 * (Fitting a room to its walls is an outline worked out before the change, by enclose.ts.)
 */
export interface RoomPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points?: RoomVertex[];
  label?: string;
  floor?: string;
  levelId?: string;
  /** "open" makes it an open space (a carport, a porch), "enclosed" a room its walls close off */
  kind?: string;
}

/**
 * A room as add_room describes it: one of a rectangle (x, y, w, h) or an outline (`points`, in
 * either winding, each corner with the bulge of the edge it starts). The space the walls close
 * off round a point (enclose.ts) is such an outline, worked out before the change.
 */
export interface RoomSpec {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points?: RoomVertex[];
  label: string;
  /** its finish; an open room's is OPEN_FLOOR unless one is given */
  floor?: string;
  level?: string;
  /** "open" for an open space; "enclosed" (the default) for a room its walls close off */
  kind?: string;
}

/** One change to a room's outline, as the plan's handles make it. */
export type RoomReshape =
  /** move corner `index` to (x, y) */
  | { op: "move_vertex"; index: number; x: number; y: number }
  /** a new corner at (x, y) on edge `edge` (from corner `edge` to the next): an arc edge splits into two arcs */
  | { op: "insert_vertex"; edge: number; x: number; y: number }
  /** remove corner `index`; the edge that replaces its two is straight */
  | { op: "remove_vertex"; index: number }
  /** bend edge `edge` (a positive sagitta or bulge bows it out of the room), or straighten it with 0 */
  | { op: "bend_edge"; edge: number; curve: CurveInput };

/** How near an arc edge a new corner must be to split the arc rather than two straight edges, metres. */
const ON_ARC = ROOM_SHAPE.onArc;

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
/** Why a level name is refused: another level already answers to it. */
const nameTaken = (name: string): string =>
  `Another level is already called ${JSON.stringify(clip(name, NOTE_EXCERPT_CHARS))}; give this one a name of its own, so a level's name always names one level.`;

const lookupFailed = (found: Extract<Lookup<unknown>, { ok: false }>): ActionResult =>
  fail(found.summary, found.candidates.length > 0 ? { candidates: found.candidates } : {});

/** The plan's kinds with `def` in place of the kind of the same id, or appended when it is new. */
const withKind = (kinds: readonly KindDef[], def: KindDef): KindDef[] =>
  kinds.some((k) => k.kind === def.kind) ? kinds.map((k) => (k.kind === def.kind ? def : k)) : [...kinds, def];

// ---------------------------------------------------------------------------
// Levels: which one is being worked on
// ---------------------------------------------------------------------------

/**
 * The id of the level being worked on. The editor's choice while the plan has that level;
 * otherwise (it was removed, or another plan was loaded) the ground level.
 */
export function activeLevelId(state: Pick<AppState, "model" | "editor">): string {
  const { levels } = state.model;
  return levels.some((l) => l.id === state.editor.activeLevelId) ? state.editor.activeLevelId : levels[0].id;
}

/** The level being worked on. */
export const activeLevel = (state: Pick<AppState, "model" | "editor">): Level => {
  const id = activeLevelId(state);
  return state.model.levels.find((l) => l.id === id) ?? state.model.levels[0];
};

/** The level `ref` names (id or name), or the level being worked on when it names none. */
const levelFor = (ref: string | undefined): Lookup<Level> => {
  const state = store.getState();
  if (ref === undefined) return { ok: true, entity: activeLevel(state) };
  const bad = textError("level", ref, TEXT.ref);
  if (bad) return { ok: false, summary: bad, candidates: [] };
  return lookupLevel(state.model, ref);
};

/** " on First floor" for a plan with several levels; nothing for a one-storey plan. */
const onLevel = (model: PlanModel, levelId: string): string => {
  if (model.levels.length < 2) return "";
  const level = model.levels.find((l) => l.id === levelId);
  return level ? ` on ${level.name}` : "";
};

/** A whole number inside a range, or the reason it is not one. */
const countError = (name: string, value: unknown, r: Range): string | null =>
  value === undefined ? null : Number.isInteger(value) ? rangeError(name, value, r) : `${name} must be a whole number.`;

/** Patchable fields of a level and a stair, listed once. */
const STAIR_PATCH_KEYS = ["x", "y", "rotation", "width", "shape", "turn", "split", "risers", "tread"] as const;
export type StairPatch = Partial<Pick<Stair, (typeof STAIR_PATCH_KEYS)[number]>> & { levelId?: string };
export interface LevelPatch {
  name?: string;
  height?: number;
  /** move the level to this place in the stack (0 = the ground level) */
  order?: number;
  /** with a new height: whether its walls that met the slab over it follow it ("follow", the default) */
  walls?: (typeof LEVEL_WALLS)[number];
}

/** A stair as add_stair describes it, before it is checked. */
export interface StairSpec {
  /** the level it stands on (id or name); the level being worked on by default */
  level?: string;
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  shape?: StairShape;
  turn?: StairTurn;
  split?: number;
  risers?: number;
  tread?: number;
}

/** Patchable fields of a column, listed once. */
const COLUMN_PATCH_KEYS = ["x", "y", "shape", "w", "d", "rotation"] as const;
/** A column's patch: `height` null goes back to reaching the slab over it; `levelId` moves it to that level. */
export type ColumnPatch = Partial<Pick<Column, (typeof COLUMN_PATCH_KEYS)[number]>> & { height?: number | null; levelId?: string };

/** A column as add_column describes it, before it is checked. `grid` lays out rows × cols of them centred on (x, y). */
export interface ColumnSpec {
  /** the level it stands on (id or name); the level being worked on by default */
  level?: string;
  x: number;
  y: number;
  shape?: ColumnShape;
  w?: number;
  d?: number;
  rotation?: number;
  height?: number;
  grid?: { rows: number; cols: number; spacing: number };
}

/** What is wrong with a column's own numbers, or null. Checked the same way for an add and an update. */
function columnError(c: Partial<Omit<Column, "height">> & { height?: number | null }): string | null {
  return firstError(
    numbersError(["x", c.x, COORD], ["y", c.y, COORD], ["w", c.w, COLUMN.size], ["d", c.d, COLUMN.size], ["rotation", c.rotation, ROTATION], ["height", c.height ?? undefined, COLUMN.height]),
    oneOfError("shape", c.shape, COLUMN_SHAPES),
  );
}


/** "0.30 m square", "0.40 × 0.25 m rectangle", "0.35 m round". */
const columnSection = (c: Pick<Column, "shape" | "w" | "d">): string =>
  c.shape === "rectangle" ? `${c.w.toFixed(2)} × ${c.d.toFixed(2)} m rectangle` : `${c.w.toFixed(2)} m ${c.shape === "circle" ? "round" : "square"}`;

/** Why a section's depth cannot be given as it is: a square's and a circle's depth is their width. */
const depthError = (shape: ColumnShape, w: number, d: number | undefined): string | null =>
  shape !== "rectangle" && d !== undefined && Math.abs(d - w) > 1e-9 ? `A ${shape} column's depth is its width (${w} m): give d only for a rectangle.` : null;

/** What is wrong with a stair's own numbers, or null. Checked the same way for an add and an update. */
function stairError(s: Partial<Stair>): string | null {
  return firstError(
    numbersError(["x", s.x, COORD], ["y", s.y, COORD], ["rotation", s.rotation, ROTATION], ["width", s.width, STAIR.width], ["tread", s.tread, STAIR.treadSet]),
    countError("risers", s.risers, STAIR.risers),
    countError("split", s.split, STAIR.risers),
    oneOfError("shape", s.shape, STAIR_SHAPES),
    oneOfError("turn", s.turn, STAIR_TURNS),
  );
}

/** The numbers a stair works out to, as a result reports them. */
function stairFacts(model: PlanModel, stair: Stair): Record<string, unknown> {
  const g = stairGeometryIn(model, stair);
  if (!g) return {};
  const round = (v: number) => Number(v.toFixed(3));
  return {
    risers: g.risers,
    riserHeight: round(g.riserHeight),
    going: round(g.going),
    stepRule: round(g.stepRule),
    run: round(g.flights.reduce((sum, f) => sum + 2 * f.hd, 0)),
  };
}

// ---------------------------------------------------------------------------
// Shapes: curved walls and room outlines
// ---------------------------------------------------------------------------

const round3 = (v: number): number => Number(v.toFixed(3));

/** Why a curve as given cannot be read, or null. */
function curveInputError(curve: CurveInput | undefined): string | null {
  if (curve === undefined) return null;
  if (typeof curve !== "object" || curve === null) return "curve must be { bulge }, { sagitta } or { through: { x, y } }.";
  if ("bulge" in curve) return rangeError("bulge", curve.bulge, BULGE);
  if ("sagitta" in curve) return rangeError("sagitta", curve.sagitta, SIGNED_LENGTH);
  if ("through" in curve) return numbersError(["through.x", curve.through?.x, COORD], ["through.y", curve.through?.y, COORD]) ?? (curve.through ? null : "curve.through must be a point.");
  return "curve must be { bulge }, { sagitta } or { through: { x, y } }.";
}

/** The wall bent as `curve` asks, measured on its endpoints; or why it cannot bend so. */
function bend(wall: Wall, curve: CurveInput | undefined): Wall | string {
  if (curve === undefined) return wall;
  const bulge = curveBulge({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, curve);
  if (bulge === null) return "the point the wall should pass through is one of its ends.";
  const range = rangeError("the bend's bulge", bulge, BULGE);
  if (range) return `${range} A wall bends at most to a half circle.`;
  const next: Wall = { ...wall, bulge };
  // a bow under STRAIGHT_SAGITTA is a straight wall, stored so
  if (edgeBulge({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, bulge) === 0) delete next.bulge;
  return wallArcError(next) ?? next;
}

const snapVertex = (p: RoomVertex): RoomVertex => (isStraight(p.bulge) ? { x: snap(p.x), y: snap(p.y) } : { x: snap(p.x), y: snap(p.y), bulge: p.bulge });

/** Why an outline as given cannot be read (its numbers, its size), or null; its shape is judged after. */
function outlineInputError(points: unknown): string | null {
  if (!Array.isArray(points)) return "points must be a list of corners.";
  const { min, max } = ROOM_SHAPE.vertices;
  if (points.length < min || points.length > max) return `A room's outline has from ${min} to ${max} corners (got ${points.length}).`;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Partial<RoomVertex> | null;
    const bad = numbersError([`points.${i}.x`, p?.x, COORD], [`points.${i}.y`, p?.y, COORD], [`points.${i}.bulge`, p?.bulge, BULGE]);
    if (bad || !p || p.x === undefined || p.y === undefined) return bad ?? `points.${i} must be a corner { x, y }.`;
  }
  return null;
}

/** The outline a room spec asks for, checked; or why there is none. */
function roomShape(spec: RoomSpec): RoomVertex[] | string {
  const rect = [spec.x, spec.y, spec.w, spec.h];
  const forms = [rect.some((v) => v !== undefined), spec.points !== undefined].filter(Boolean).length;
  if (forms !== 1) return "Give a room exactly one shape: a rectangle (x, y, w, h) or an outline (points).";
  let points: RoomVertex[];
  if (spec.points !== undefined) {
    const bad = outlineInputError(spec.points);
    if (bad) return bad;
    points = normalizeOutline(spec.points.map(snapVertex));
  } else {
    // The size is judged as given, the same rule the add_room schema and updateRoom apply;
    // snapping cannot then take it under the minimum (see ROOM_SIZE).
    const bad = firstError(
      numbersError(["x", spec.x, COORD], ["y", spec.y, COORD], ["w", spec.w, ROOM_SIZE], ["h", spec.h, ROOM_SIZE]),
      rect.every((v) => v !== undefined) ? null : "A rectangle needs all four of x, y, w and h.",
    );
    if (bad) return bad;
    points = rectOutline(snap(spec.x as number), snap(spec.y as number), snap(spec.w as number), snap(spec.h as number));
  }
  return outlineError(points, ROOM_SIZE.min) ?? points;
}

/** "4.85 × 5.85 m" for a rectangle, "12.40 m², 6 corners" for any other outline. */
function roomSize(points: readonly RoomVertex[]): string {
  const r = outlineRect(points);
  return r ? `${r.w.toFixed(2)} × ${r.h.toFixed(2)} m` : `${outlineArea(points).toFixed(2)} m², ${points.length} corners`;
}

/** What each reshape did, for its summary. */
const RESHAPED: Record<RoomReshape["op"], string> = {
  move_vertex: "a corner moved",
  insert_vertex: "a corner added",
  remove_vertex: "a corner removed",
  bend_edge: "an edge bent",
};

/** The outline with one reshape made (not yet normalised or judged), or why it cannot be made. */
function reshaped_(points: readonly RoomVertex[], change: RoomReshape): RoomVertex[] | string {
  const n = points.length;
  const index = (name: string, i: unknown): string | null => (Number.isInteger(i) && (i as number) >= 0 && (i as number) < n ? null : `${name} must be a whole number from 0 to ${n - 1}.`);
  switch (change?.op) {
    case "move_vertex": {
      const bad = firstError(index("index", change.index), numbersError(["x", change.x, COORD], ["y", change.y, COORD]));
      if (bad) return bad;
      return points.map((p, i) => (i === change.index ? { ...p, x: snap(change.x), y: snap(change.y) } : p));
    }
    case "insert_vertex": {
      const bad = firstError(index("edge", change.edge), numbersError(["x", change.x, COORD], ["y", change.y, COORD]));
      if (bad) return bad;
      if (n >= ROOM_SHAPE.vertices.max) return `A room's outline has at most ${ROOM_SHAPE.vertices.max} corners.`;
      const edge = outlineEdges(points)[change.edge];
      const at = { x: change.x, y: change.y };
      const near = closestOnEdge(edge, at);
      const p = points[change.edge];
      let first: RoomVertex;
      let added: RoomVertex;
      if (edgeArc(edge) && near.distance <= ON_ARC && near.t > 0 && near.t < 1) {
        // on the arc: the arc splits into two of the same circle, at the point of it nearest
        const head = subEdge(edge, 0, near.t);
        const tail = subEdge(edge, near.t, 1);
        first = { x: p.x, y: p.y, bulge: head.bulge };
        added = { x: near.point.x, y: near.point.y, bulge: tail.bulge };
      } else {
        first = { x: p.x, y: p.y };
        added = { x: snap(change.x), y: snap(change.y) };
      }
      return [...points.slice(0, change.edge), first, added, ...points.slice(change.edge + 1)];
    }
    case "remove_vertex": {
      const bad = index("index", change.index);
      if (bad) return bad;
      if (n <= ROOM_SHAPE.vertices.min) return `A room's outline has at least ${ROOM_SHAPE.vertices.min} corners.`;
      const before = (change.index - 1 + n) % n;
      return points.flatMap((p, i) => (i === change.index ? [] : i === before ? [{ x: p.x, y: p.y }] : [p]));
    }
    case "bend_edge": {
      const bad = firstError(index("edge", change.edge), curveInputError(change.curve) ?? (change.curve ? null : "curve is required."));
      if (bad) return bad;
      const a = points[change.edge];
      const b = points[(change.edge + 1) % n];
      const bulge = curveBulge(a, b, change.curve);
      if (bulge === null) return "the point the edge should pass through is one of its ends.";
      const range = rangeError("the bend's bulge", bulge, BULGE);
      if (range) return `${range} An edge bends at most to a half circle.`;
      return points.map((p, i) => (i === change.edge ? (edgeBulge(a, b, bulge) === 0 ? { x: p.x, y: p.y } : { x: p.x, y: p.y, bulge }) : p));
    }
    default:
      return "op must be one of move_vertex | insert_vertex | remove_vertex | bend_edge.";
  }
}

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
    level?: string,
    curve?: CurveInput,
  ): ActionResult {
    const bad = firstError(
      numbersError(
        ["ax", ax, COORD], ["ay", ay, COORD], ["bx", bx, COORD], ["by", by, COORD],
        ["thickness", thickness, WALL_THICKNESS], ["height", height, WALL_HEIGHT],
      ),
      curveInputError(curve),
    );
    if (bad) return fail(bad);
    const on = levelFor(level);
    if (!on.ok) return lookupFailed(on);
    ax = snap(ax); ay = snap(ay); bx = snap(bx); by = snap(by);
    const len = segLen(ax, ay, bx, by);
    if (len < WALL_MIN_LENGTH) {
      return fail(`Wall too short (${(len * 100).toFixed(0)} cm, min ${(WALL_MIN_LENGTH * 100).toFixed(0)} cm).`);
    }
    const wall: Wall = { id: uid("wall"), levelId: on.entity.id, ax, ay, bx, by, thickness, height };
    const bent = bend(wall, curve);
    if (typeof bent === "string") return fail(bent);
    pushUndo();
    const model = store.getState().model;
    setModel({ ...model, walls: [...model.walls, bent] });
    const along = wallLength(bent);
    return ok(`Wall added (${along.toFixed(2)} m${isStraight(bent.bulge) ? "" : " along its arc"})${onLevel(model, bent.levelId)}.`, { id: bent.id, length: along, levelId: bent.levelId });
  },

  editWall(id: string, patch: WallPatch): ActionResult {
    const bad = firstError(
      textError("id", id, TEXT.ref),
      numbersError(
        ["ax", patch.ax, COORD], ["ay", patch.ay, COORD], ["bx", patch.bx, COORD], ["by", patch.by, COORD],
        ["thickness", patch.thickness, WALL_THICKNESS], ["height", patch.height, WALL_HEIGHT],
      ),
      curveInputError(patch.curve),
    );
    if (bad) return fail(bad);
    const found = lookupWall(store.getState().model, id);
    if (!found.ok) return lookupFailed(found);
    const wall = found.entity;
    const on = patch.levelId === undefined ? null : levelFor(patch.levelId);
    if (on && !on.ok) return lookupFailed(on);
    // Built key by key from the allowed list, so nothing else in `patch` (an id, say) can land.
    const next: Wall = { ...wall, levelId: on ? on.entity.id : wall.levelId };
    for (const k of WALL_PATCH_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      next[k] = k === "thickness" || k === "height" ? v : snap(v);
    }
    if (segLen(next.ax, next.ay, next.bx, next.by) < WALL_MIN_LENGTH) {
      return fail(`Edit rejected: wall would be shorter than ${(WALL_MIN_LENGTH * 100).toFixed(0)} cm.`);
    }
    const bent = bend(next, patch.curve);
    if (typeof bent === "string") return fail(`Edit rejected: ${bent}`);
    pushUndo();
    setModel({
      ...store.getState().model,
      walls: store.getState().model.walls.map((w) => (w.id === wall.id ? bent : w)),
    });
    const moved = next.levelId !== wall.levelId ? ` and moved, with its openings, to ${on?.ok ? on.entity.name : next.levelId}` : "";
    return ok(`Wall ${wall.id} updated${moved}.`, { id: wall.id, levelId: next.levelId });
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
    swing?: { hinge?: Hinge; side?: SwingSide; style?: DoorStyle },
  ): ActionResult {
    if (kind !== "door" && kind !== "window") return fail(`Unknown opening kind "${String(kind)}". Use door | window.`);
    const styleBad = oneOfError("style", swing?.style, DOOR_STYLES);
    if (styleBad) return fail(styleBad);
    const garage = kind === "door" && swing?.style === "garage";
    if (kind === "window" && swing?.style !== undefined) return fail("Only a door has a style.");
    if (garage && (swing?.hinge !== undefined || swing?.side !== undefined)) return fail("A garage door rises overhead: it has no hinge or swing side.");
    const defaults = garage ? { ...GARAGE_DOOR.defaults, sill: DOOR_DEFAULTS.sill } : kind === "door" ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
    const w = width ?? defaults.width;
    const s = sill ?? defaults.sill;
    const h = height ?? defaults.height;
    const bad = firstError(
      textError("wallId", wallId, TEXT.ref),
      numbersError(["t", t, OPENING_T], ["width", w, OPENING_WIDTH], ["sill", s, OPENING_SILL], ["height", h, OPENING_HEIGHT]),
      garage ? numbersError(["width", w, GARAGE_DOOR.width], ["height", h, GARAGE_DOOR.height]) : null,
      oneOfError("hinge", swing?.hinge, HINGES),
      oneOfError("side", swing?.side, SWING_SIDES),
    );
    if (bad) return fail(garage ? `Garage door: ${bad}` : bad);
    const found = lookupWall(store.getState().model, wallId);
    if (!found.ok) return lookupFailed(found);
    const wall = found.entity;
    const clamped = clampOpeningT(wall, w, t);
    if (clamped === null) {
      const len = wallLength(wall);
      return fail(`Wall ${wall.id} is ${len.toFixed(2)} m long — a ${w.toFixed(2)} m ${kind} does not fit.`);
    }
    if (garage) {
      const room = garageDoorFitError(wall, w);
      if (room) return fail(room);
    }
    const tight = openingArcError(wall, w, kind);
    if (tight) return fail(tight);
    if (s + h > wall.height) return fail(`${kind} (sill ${s} + height ${h}) exceeds wall height ${wall.height} m.`);
    const opening: Opening = { id: uid(kind), kind, wallId: wall.id, t: clamped, width: w, sill: s, height: h };
    if (garage) opening.style = "garage";
    else if (kind === "door") {
      opening.hinge = swing?.hinge ?? DOOR_SWING_DEFAULTS.hinge;
      opening.side = swing?.side ?? DOOR_SWING_DEFAULTS.side;
    }
    pushUndo();
    setModel({ ...store.getState().model, openings: [...store.getState().model.openings, opening] });
    const moved = Math.abs(clamped - t) > 1e-6 ? ` (clamped to t=${clamped.toFixed(2)} to fit the vano)` : "";
    return ok(`${garage ? "Garage door" : kind === "door" ? "Door" : "Window"} added on wall ${wall.id} at t=${clamped.toFixed(2)}${moved}.`, {
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
    if (o.style === "garage") return fail(`${o.id} is a garage door: it rises overhead and has no hinge or swing side.`);
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

  /**
   * Resize a door or a window, or change how a door opens: `style` "garage" makes it a sectional
   * overhead door (its hinge and swing go, its size must be a garage door's), "swing" a hinged
   * leaf (on the default hinge and side). Its centre stays where it is, clamped to fit.
   */
  updateOpening(id: string, patch: { width?: number; height?: number; sill?: number; style?: string }): ActionResult {
    const bad = firstError(
      textError("id", id, TEXT.ref),
      numbersError(["width", patch.width, OPENING_WIDTH], ["height", patch.height, OPENING_HEIGHT], ["sill", patch.sill, OPENING_SILL]),
      oneOfError("style", patch.style, DOOR_STYLES),
    );
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupOpening(model, id);
    if (!found.ok) return lookupFailed(found);
    const o = found.entity;
    if (o.kind === "window" && patch.style !== undefined) return fail(`${o.id} is a window: only a door has a style.`);
    const wall = model.walls.find((x) => x.id === o.wallId);
    if (!wall) return fail(`${o.kind} ${o.id} is on wall ${o.wallId}, which no longer exists.`);
    const style = (patch.style as DoorStyle | undefined) ?? o.style;
    const garage = o.kind === "door" && style === "garage";
    const width = patch.width ?? o.width;
    const height = patch.height ?? o.height;
    const sill = patch.sill ?? o.sill;
    if (garage) {
      const size = numbersError(["width", width, GARAGE_DOOR.width], ["height", height, GARAGE_DOOR.height]) ?? garageDoorFitError(wall, width);
      if (size) return fail(`Garage door: ${size}`);
    }
    const clamped = clampOpeningT(wall, width, o.t);
    if (clamped === null) return fail(`Wall ${wall.id} is ${wallLength(wall).toFixed(2)} m long — a ${width.toFixed(2)} m ${o.kind} does not fit.`);
    const tight = openingArcError(wall, width, o.kind);
    if (tight) return fail(tight);
    if (sill + height > wall.height) return fail(`${o.kind} (sill ${sill} + height ${height}) exceeds wall height ${wall.height} m.`);
    const next: Opening = { ...o, width, height, sill, t: clamped };
    if (garage) {
      next.style = "garage";
      delete next.hinge;
      delete next.side;
    } else if (o.kind === "door") {
      delete next.style;
      next.hinge = o.hinge ?? DOOR_SWING_DEFAULTS.hinge;
      next.side = o.side ?? DOOR_SWING_DEFAULTS.side;
    }
    pushUndo();
    setModel({ ...model, openings: model.openings.map((x) => (x.id === o.id ? next : x)) });
    return ok(`${garage ? "Garage door" : o.kind === "door" ? "Door" : "Window"} ${o.id} updated: ${width.toFixed(2)} × ${height.toFixed(2)} m.`, { id: o.id, t: clamped });
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
  addRoom(spec: RoomSpec): ActionResult {
    const { label, level } = spec;
    const open = spec.kind === "open";
    const floor = spec.floor ?? (open ? OPEN_FLOOR : DEFAULT_FLOOR);
    const bad = firstError(textError("label", label, TEXT.label), oneOfError("floor", floor, FLOOR_FINISHES), oneOfError("kind", spec.kind, ROOM_KINDS));
    if (bad) return fail(bad);
    const on = levelFor(level);
    if (!on.ok) return lookupFailed(on);
    const shape = roomShape(spec);
    if (typeof shape === "string") return fail(shape);
    const room: Room = { id: uid("room"), levelId: on.entity.id, points: shape, label, floor: floor as Room["floor"], ...(open ? { kind: "open" as const } : {}) };
    pushUndo();
    const model = store.getState().model;
    setModel({ ...model, rooms: [...model.rooms, room] });
    return ok(`${open ? "Open space" : "Room"} "${label}" added (${roomSize(room.points)})${onLevel(model, room.levelId)}.`, { id: room.id, levelId: room.levelId, area: round3(outlineArea(room.points)) });
  },

  updateRoom(idOrLabel: string, patch: RoomPatch): ActionResult {
    const bad = firstError(
      textError("id", idOrLabel, TEXT.ref),
      numbersError(["x", patch.x, COORD], ["y", patch.y, COORD], ["w", patch.w, ROOM_SIZE], ["h", patch.h, ROOM_SIZE]),
      patch.label === undefined ? null : textError("label", patch.label, TEXT.label),
      oneOfError("floor", patch.floor, FLOOR_FINISHES),
      oneOfError("kind", patch.kind, ROOM_KINDS),
    );
    if (bad) return fail(bad);
    const found = lookupRoom(store.getState().model, idOrLabel);
    if (!found.ok) return lookupFailed(found);
    const room = found.entity;
    const on = patch.levelId === undefined ? null : levelFor(patch.levelId);
    if (on && !on.ok) return lookupFailed(on);
    const levelId = on ? on.entity.id : room.levelId;
    // Only the room's own fields are copied. Spreading the whole patch let the lookup key in
    // it replace the room's real id: update_room { id: "bedroom" } renamed the id to "bedroom".
    let points = room.points;
    if (patch.points !== undefined) {
      const given = outlineInputError(patch.points);
      if (given) return fail(given);
      points = normalizeOutline(patch.points.map(snapVertex));
    }
    if (patch.w !== undefined || patch.h !== undefined) {
      const box = outlineBounds(points);
      points = stretchOutline(points, patch.w ?? box.w, patch.h ?? box.h);
    }
    if (patch.x !== undefined || patch.y !== undefined) {
      const box = outlineBounds(points);
      points = translateOutline(points, (patch.x ?? box.x) - box.x, (patch.y ?? box.y) - box.y);
    }
    if (points !== room.points) {
      const wrong = outlineError(points, ROOM_SIZE.min);
      if (wrong) return fail(`Room "${room.label}" was not reshaped: ${wrong}`);
    }
    const next: Room = {
      ...room,
      levelId,
      points,
      label: patch.label ?? room.label,
      floor: (patch.floor as Room["floor"] | undefined) ?? room.floor,
    };
    // the kind is stored only when the room is open
    if (patch.kind === "open") next.kind = "open";
    else if (patch.kind === "enclosed") delete next.kind;
    pushUndo();
    setModel({
      ...store.getState().model,
      rooms: store.getState().model.rooms.map((r) => (r.id === room.id ? next : r)),
    });
    const moved = next.levelId !== room.levelId && on?.ok ? ` and moved to ${on.entity.name}` : "";
    return ok(`Room "${next.label}" updated${moved}.`, { id: room.id, levelId: next.levelId, area: round3(outlineArea(next.points)) });
  },

  /** Move, add or remove one corner of a room, or bend or straighten one of its edges. */
  reshapeRoom(idOrLabel: string, change: RoomReshape): ActionResult {
    const bad = textError("id", idOrLabel, TEXT.ref);
    if (bad) return fail(bad);
    const found = lookupRoom(store.getState().model, idOrLabel);
    if (!found.ok) return lookupFailed(found);
    const room = found.entity;
    const reshaped = reshaped_(room.points, change);
    if (typeof reshaped === "string") return fail(reshaped);
    const points = normalizeOutline(reshaped);
    const wrong = outlineError(points, ROOM_SIZE.min);
    if (wrong) return fail(`Room "${room.label}" was not reshaped: ${wrong}`);
    pushUndo();
    const model = store.getState().model;
    setModel({ ...model, rooms: model.rooms.map((r) => (r.id === room.id ? { ...r, points } : r)) });
    return ok(`Room "${room.label}" reshaped: ${RESHAPED[change.op]} (${roomSize(points)}).`, { id: room.id, area: round3(outlineArea(points)), corners: points.length });
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
  placeItem(kind: string, x: number, y: number, rotation = 0, level?: string): ActionResult {
    const bad = firstError(
      textError("kind", kind, TEXT.kind),
      numbersError(["x", x, COORD], ["y", y, COORD], ["rotation", rotation, ROTATION]),
    );
    if (bad) return fail(bad);
    const model = store.getState().model;
    const cat = catalogOf(model).get(kind);
    if (!cat) return fail(`Unknown furniture kind ${JSON.stringify(kind)}. Use get_item_catalog.`);
    const on = levelFor(level);
    if (!on.ok) return lookupFailed(on);
    const item: Item = { id: uid("item"), levelId: on.entity.id, kind: cat.kind, x: snap(x), y: snap(y), rotation };
    pushUndo();
    setModel({ ...model, items: [...model.items, item] });
    return ok(`${kindName(cat)} placed at (${item.x.toFixed(2)}, ${item.y.toFixed(2)})${onLevel(model, item.levelId)}.`, { id: item.id, levelId: item.levelId });
  },

  moveItem(idOrKind: string, x?: number, y?: number, rotation?: number, level?: string): ActionResult {
    const bad = firstError(
      textError("id", idOrKind, TEXT.ref),
      numbersError(["x", x, COORD], ["y", y, COORD], ["rotation", rotation, ROTATION]),
    );
    if (bad) return fail(bad);
    const found = lookupItem(store.getState().model, idOrKind);
    if (!found.ok) return lookupFailed(found);
    const item = found.entity;
    const on = level === undefined ? null : levelFor(level);
    if (on && !on.ok) return lookupFailed(on);
    const next: Item = {
      ...item,
      levelId: on ? on.entity.id : item.levelId,
      x: x !== undefined ? snap(x) : item.x,
      y: y !== undefined ? snap(y) : item.y,
      rotation: rotation !== undefined ? rotation : item.rotation,
    };
    pushUndo();
    setModel({
      ...store.getState().model,
      items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)),
    });
    const moved = next.levelId !== item.levelId && on?.ok ? ` on ${on.entity.name}` : "";
    return ok(`Item ${item.id} moved to (${next.x.toFixed(2)}, ${next.y.toFixed(2)})${moved}.`, { id: item.id, levelId: next.levelId });
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
  loadModel(input: PlanInput): ActionResult {
    // a plan in an older format is brought up to date first (model/planFormat.ts)
    const migrated = migratePlan(input);
    if (!migrated.ok) return fail(migrated.summary);
    const model = migrated.model;
    const underlay = model.underlay && !underlayError(model.underlay) ? model.underlay : null;
    pushUndo();
    setModel({ ...model, kinds: model.kinds.map(freezeKind), underlay });
    const storeys = model.levels.length > 1 ? `${model.levels.length} levels, ` : "";
    const stairs = model.stairs.length > 0 ? `, ${model.stairs.length} stairs` : "";
    const columns = model.columns.length > 0 ? `, ${model.columns.length} columns` : "";
    return ok(
      `Plan "${model.name}" loaded: ${storeys}${model.walls.length} walls, ${model.rooms.length} rooms, ${model.items.length} items${stairs}${columns}.`,
      migrated.from < model.version ? { migratedFrom: migrated.from } : {},
    );
  },

  /**
   * The plan as the shared session has it (src/session/): another tab's change merged into this
   * one's, or the plan this tab takes up as it joins the others. It is not this tab's change, so
   * it records no undo step here: Undo takes back what this tab did, never another tab's work.
   * `history` is this tab's own steps with that change folded into each (the session rebases
   * them), so undoing one afterwards puts back only what that step changed; a history that is not
   * this tab's steps is not taken. The plan is checked as a loaded one is (migratePlan); the
   * underlay stays this tab's own, as its image is.
   */
  applySync(input: PlanModel, notes: Note[], summary: string, history: readonly UndoStep[] | null = null): ActionResult {
    const migrated = migratePlan(input);
    if (!migrated.ok) return fail(migrated.summary);
    if (!Array.isArray(notes) || notes.length > MAX_NOTES) return fail(`A plan holds at most ${MAX_NOTES} notes.`);
    const bad = textError("summary", summary, TEXT.note, true);
    if (bad) return fail(bad);
    const { model: current, undoStack } = store.getState();
    const model: PlanModel = {
      ...migrated.model,
      kinds: migrated.model.kinds.map((k) => (Object.isFrozen(k) ? k : freezeKind(k))),
      underlay: current.underlay,
    };
    const rebased = history && sameSteps(undoStack, history) ? [...history] : undoStack;
    store.setState({ model, notes, lastChangeAt: Date.now(), undoStack: rebased });
    return ok(summary);
  },

  // ---- levels ----
  /** Add a level on top of the others. Unnamed, it is called by its place ("First floor"). */
  addLevel(name?: string, height: number = LEVEL_DEFAULTS.height): ActionResult {
    const bad = firstError(name === undefined ? null : textError("name", name, TEXT.label), numbersError(["height", height, LEVEL_HEIGHT]));
    if (bad) return fail(bad);
    const model = store.getState().model;
    if (model.levels.length >= MAX_LEVELS) return fail(`The plan already has ${MAX_LEVELS} levels, the most it holds.`);
    if (name !== undefined && levelNameTaken(model, name)) return fail(nameTaken(name));
    const level: Level = { id: uid("level"), name: name ?? freeLevelName(model), height };
    pushUndo();
    setModel({ ...model, levels: [...model.levels, level] });
    const below = model.levels[model.levels.length - 1];
    return ok(`Level "${level.name}" added on top, ${(levelInfo(model, below.id)?.top ?? 0).toFixed(2)} m up.`, { id: level.id });
  },

  /** Rename a level, change its floor-to-floor height, or move it to another place in the stack. */
  updateLevel(ref: string, patch: LevelPatch): ActionResult {
    const bad = firstError(
      textError("id", ref, TEXT.ref),
      patch.name === undefined ? null : textError("name", patch.name, TEXT.label),
      numbersError(["height", patch.height, LEVEL_HEIGHT]),
      countError("order", patch.order, { min: 0, max: MAX_LEVELS - 1, unit: "" }),
      patch.walls === undefined || isOneOf(patch.walls, LEVEL_WALLS) ? null : notOneOf("walls", LEVEL_WALLS),
    );
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupLevel(model, ref);
    if (!found.ok) return lookupFailed(found);
    const level = found.entity;
    if (patch.name !== undefined && levelNameTaken(model, patch.name, level.id)) return fail(nameTaken(patch.name));
    const next: Level = { ...level, name: patch.name ?? level.name, height: patch.height ?? level.height };
    const others = model.levels.filter((l) => l.id !== level.id);
    const at = patch.order === undefined ? model.levels.indexOf(level) : Math.min(patch.order, others.length);
    // the walls that met the slab over the level meet it at its new height too: same undo step
    const follow = (patch.walls ?? LEVEL_WALLS[0]) === "follow" && next.height !== level.height;
    const underside = slabUnderside(next.height);
    let carried = 0;
    const walls = follow
      ? model.walls.map((w) => {
          if (w.levelId !== level.id || !meetsSlab(w.height, level.height)) return w;
          carried++;
          return { ...w, height: underside };
        })
      : model.walls;
    pushUndo();
    setModel({ ...model, levels: [...others.slice(0, at), next, ...others.slice(at)], walls });
    const raised = carried > 0 ? ` ${carried} walls that met the slab over it now stand ${underside.toFixed(2)} m tall, meeting it again.` : "";
    return ok(
      `Level "${next.name}" updated: ${next.height.toFixed(2)} m floor to floor, ${at === 0 ? "the ground level" : `level ${at} from the ground`}.${raised}`,
      { id: level.id, wallsCarried: carried },
    );
  },

  /**
   * Remove a level and everything on it: its walls (their openings with them), rooms, items and
   * the stairs that start on it. A stair from the level below then climbs to whatever is next
   * above it, or to nothing, which the checker reports. The last level cannot go.
   */
  removeLevel(ref: string): ActionResult {
    const bad = textError("id", ref, TEXT.ref);
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupLevel(model, ref);
    if (!found.ok) return lookupFailed(found);
    const level = found.entity;
    const refused = levelRemovalError(model, level);
    if (refused) return fail(refused);
    const gone = levelContents(model, level.id);
    const rerouted = stairsRerouted(model, level.id);
    const wallIds = new Set(gone.walls.map((w) => w.id));
    pushUndo();
    setModel({
      ...model,
      levels: model.levels.filter((l) => l.id !== level.id),
      walls: model.walls.filter((w) => w.levelId !== level.id),
      openings: model.openings.filter((o) => !wallIds.has(o.wallId)),
      rooms: model.rooms.filter((r) => r.levelId !== level.id),
      items: model.items.filter((i) => i.levelId !== level.id),
      stairs: model.stairs.filter((s) => s.levelId !== level.id),
      columns: model.columns.filter((c) => c.levelId !== level.id),
    });
    return ok(
      `Level "${level.name}" removed with ${gone.walls.length} walls, ${gone.openings.length} openings, ${gone.rooms.length} rooms, ${gone.items.length} items, ${gone.stairs.length} stairs and ${gone.columns.length} columns.` +
        rerouted.map((r) => ` ${rerouteText(model, r, "done")}.`).join(""),
      { id: level.id },
    );
  },

  // ---- stairs ----
  addStair(spec: StairSpec): ActionResult {
    const shape = spec.shape ?? STAIR_DEFAULTS.shape;
    const draft: Partial<Stair> = {
      x: spec.x,
      y: spec.y,
      rotation: spec.rotation ?? 0,
      width: spec.width ?? STAIR.defaultWidth,
      shape,
      turn: spec.turn,
      split: spec.split,
      risers: spec.risers,
      tread: spec.tread,
    };
    // where it starts is required: rangeError refuses a missing number, where stairError skips it
    const bad = firstError(rangeError("x", spec.x, COORD), rangeError("y", spec.y, COORD), stairError(draft));
    if (bad) return fail(bad);
    const on = levelFor(spec.level);
    if (!on.ok) return lookupFailed(on);
    const model = store.getState().model;
    if (model.stairs.length >= MAX_STAIRS) return fail(`The plan already has ${MAX_STAIRS} stairs, the most it holds.`);
    const stair: Stair = {
      id: uid("stair"),
      levelId: on.entity.id,
      shape,
      x: snap(spec.x),
      y: snap(spec.y),
      rotation: draft.rotation ?? 0,
      width: draft.width ?? STAIR.defaultWidth,
      ...(shape === "l" ? { turn: spec.turn ?? STAIR_DEFAULTS.turn } : {}),
      ...(shape === "l" && spec.split !== undefined ? { split: spec.split } : {}),
      ...(spec.risers !== undefined ? { risers: spec.risers } : {}),
      ...(spec.tread !== undefined ? { tread: spec.tread } : {}),
    };
    pushUndo();
    setModel({ ...model, stairs: [...model.stairs, stair] });
    const facts = stairFacts(model, stair);
    return ok(
      `Stair ${stair.id} added${onLevel(model, stair.levelId)} at (${stair.x.toFixed(2)}, ${stair.y.toFixed(2)}): ${String(facts.risers)} risers of ${Number(facts.riserHeight).toFixed(3)} m, going ${Number(facts.going).toFixed(3)} m.`,
      { id: stair.id, levelId: stair.levelId, ...facts },
    );
  },

  /** Move, turn, resize or reshape a stair, or move it to another level. */
  updateStair(ref: string, patch: StairPatch): ActionResult {
    const bad = firstError(textError("id", ref, TEXT.ref), stairError(patch));
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupStair(model, ref);
    if (!found.ok) return lookupFailed(found);
    const stair = found.entity;
    const on = patch.levelId === undefined ? null : levelFor(patch.levelId);
    if (on && !on.ok) return lookupFailed(on);
    const next: Stair = { ...stair, levelId: on ? on.entity.id : stair.levelId };
    for (const k of STAIR_PATCH_KEYS) {
      const v = patch[k];
      if (v !== undefined) (next as Record<(typeof STAIR_PATCH_KEYS)[number], unknown>)[k] = k === "x" || k === "y" ? snap(v as number) : v;
    }
    // a straight stair has no turn or split to keep
    if (next.shape === "straight") {
      delete next.turn;
      delete next.split;
    } else next.turn ??= STAIR_DEFAULTS.turn;
    pushUndo();
    setModel({ ...model, stairs: model.stairs.map((s) => (s.id === stair.id ? next : s)) });
    return ok(`Stair ${stair.id} updated${onLevel(model, next.levelId)}.`, { id: stair.id, levelId: next.levelId, ...stairFacts(model, next) });
  },

  removeStair(ref: string): ActionResult {
    const bad = textError("id", ref, TEXT.ref);
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupStair(model, ref);
    if (!found.ok) return lookupFailed(found);
    const stair = found.entity;
    pushUndo();
    setModel({ ...model, stairs: model.stairs.filter((s) => s.id !== stair.id) });
    return ok(`Stair ${stair.id} removed.`, { id: stair.id });
  },

  // ---- columns ----
  /** Add a column, or a grid of them (`grid`: rows × cols, `spacing` apart, centred on x, y), as one change. */
  addColumns(spec: ColumnSpec): ActionResult {
    const shape = spec.shape ?? COLUMN.defaults.shape;
    const w = spec.w ?? COLUMN.defaults.size;
    const grid = spec.grid;
    const bad = firstError(
      rangeError("x", spec.x, COORD),
      rangeError("y", spec.y, COORD),
      columnError({ shape, w, d: spec.d, rotation: spec.rotation, height: spec.height }),
      isOneOf(shape, COLUMN_SHAPES) ? depthError(shape, w, spec.d) : null,
      grid === undefined
        ? null
        : firstError(
            countError("grid.rows", grid.rows, COLUMN_GRID.count) ?? (grid.rows === undefined ? "grid.rows is required." : null),
            countError("grid.cols", grid.cols, COLUMN_GRID.count) ?? (grid.cols === undefined ? "grid.cols is required." : null),
            rangeError("grid.spacing", grid.spacing, COLUMN_GRID.spacing),
          ),
    );
    if (bad) return fail(bad);
    const on = levelFor(spec.level);
    if (!on.ok) return lookupFailed(on);
    const model = store.getState().model;
    const rotation = spec.rotation ?? 0;
    const centres = grid ? columnGrid({ x: spec.x, y: spec.y }, grid.rows, grid.cols, grid.spacing, rotation) : [{ x: spec.x, y: spec.y }];
    if (model.columns.length + centres.length > MAX_COLUMNS) return fail(`A plan holds at most ${MAX_COLUMNS} columns (it has ${model.columns.length}; this adds ${centres.length}).`);
    const off = centres.find((p) => !within(p.x, COORD) || !within(p.y, COORD));
    if (off) return fail(`The grid runs off the plan at (${off.x.toFixed(2)}, ${off.y.toFixed(2)}): coordinates stay within ${COORD.min} to ${COORD.max} m.`);
    const section = sectionOf(shape, w, spec.d);
    const columns: Column[] = centres.map((p) => ({
      id: uid("column"),
      levelId: on.entity.id,
      shape,
      x: columnCoord(p.x),
      y: columnCoord(p.y),
      ...section,
      rotation,
      ...(spec.height !== undefined ? { height: spec.height } : {}),
    }));
    pushUndo();
    setModel({ ...model, columns: [...model.columns, ...columns] });
    const first = columns[0];
    const derived = columnHeight(model, first);
    // as get_model reports it: to the millimetre, without float noise (2.9 - 0.2 is 2.6999999999999997)
    const tall = derived === undefined ? undefined : round3(derived);
    const height = tall === undefined ? "" : `, ${tall.toFixed(2)} m tall`;
    const ids = columns.map((c) => c.id);
    if (!grid) {
      return ok(`Column ${first.id} added (${columnSection(first)}${height}) at (${first.x.toFixed(2)}, ${first.y.toFixed(2)})${onLevel(model, first.levelId)}.`, { id: first.id, ids, levelId: first.levelId, height: tall });
    }
    return ok(`${columns.length} columns added in a ${grid.rows} × ${grid.cols} grid ${grid.spacing.toFixed(2)} m apart (${columnSection(first)}${height})${onLevel(model, first.levelId)}: ${ids.join(", ")}.`, { id: first.id, ids, levelId: first.levelId, height: tall });
  },

  /** Move, turn, resize or reshape a column, set or clear its height, or move it to another level. */
  updateColumn(ref: string, patch: ColumnPatch): ActionResult {
    const bad = firstError(textError("id", ref, TEXT.ref), columnError(patch));
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupColumn(model, ref);
    if (!found.ok) return lookupFailed(found);
    const column = found.entity;
    const on = patch.levelId === undefined ? null : levelFor(patch.levelId);
    if (on && !on.ok) return lookupFailed(on);
    const next: Column = { ...column, levelId: on ? on.entity.id : column.levelId };
    for (const k of COLUMN_PATCH_KEYS) {
      const v = patch[k];
      if (v !== undefined) (next as Record<(typeof COLUMN_PATCH_KEYS)[number], unknown>)[k] = k === "x" || k === "y" ? columnCoord(v as number) : v;
    }
    const depth = depthError(next.shape, next.w, patch.d);
    if (depth) return fail(depth);
    // a square's and a circle's depth follow their width; a rectangle made of one keeps its own
    Object.assign(next, sectionOf(next.shape, next.w, next.shape === "rectangle" ? (patch.d ?? (column.shape === "rectangle" ? column.d : next.w)) : undefined));
    if (patch.height === null) delete next.height;
    else if (patch.height !== undefined) next.height = patch.height;
    pushUndo();
    setModel({ ...model, columns: model.columns.map((c) => (c.id === column.id ? next : c)) });
    const derived = columnHeight(model, next);
    const tall = derived === undefined ? undefined : round3(derived);
    return ok(`Column ${column.id} updated (${columnSection(next)}${tall === undefined ? "" : `, ${tall.toFixed(2)} m tall`})${onLevel(model, next.levelId)}.`, { id: column.id, levelId: next.levelId, height: tall });
  },

  removeColumn(ref: string): ActionResult {
    const bad = textError("id", ref, TEXT.ref);
    if (bad) return fail(bad);
    const model = store.getState().model;
    const found = lookupColumn(model, ref);
    if (!found.ok) return lookupFailed(found);
    const column = found.entity;
    pushUndo();
    setModel({ ...model, columns: model.columns.filter((c) => c.id !== column.id) });
    return ok(`Column ${column.id} removed.`, { id: column.id });
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
    if (!u) return fail("No underlay loaded — ask the human to upload the plan image first (Properties → Blueprint underlay, with nothing selected).");
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

/** The editor with nothing selected. */
const NOTHING_SELECTED = { selectedWallId: null, selectedItemId: null, selectedRoomId: null, selectedStairId: null, selectedColumnId: null } as const;

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

  /** Change how the 3D view draws the model; what is left out stays as it is. */
  setSceneStyle(patch: Partial<SceneStyle>): ActionResult {
    const bad = patch.cutHeight === undefined ? null : rangeError("cutHeight", patch.cutHeight, CUT_HEIGHT);
    if (bad) return fail(bad);
    if ([patch.edges, patch.cutaway].some((v) => v !== undefined && typeof v !== "boolean")) return fail("edges and cutaway must be true or false.");
    const { edges = currentSceneStyle().edges, cutaway = currentSceneStyle().cutaway, cutHeight = currentSceneStyle().cutHeight } = patch;
    const scene: SceneStyle = { edges, cutaway, cutHeight };
    store.setState((s) => ({ editor: { ...s.editor, scene } }));
    return ok(`3D style: edges ${edges ? "on" : "off"}, ${cutaway ? `cut at ${cutHeight} m` : "no cutaway"}.`, { scene });
  },

  setView(view: ViewMode) {
    store.setState((s) => ({ editor: { ...s.editor, view } }));
  },

  selectWall(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...NOTHING_SELECTED, selectedWallId: id } }));
  },
  selectItem(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...NOTHING_SELECTED, selectedItemId: id } }));
  },
  selectRoom(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...NOTHING_SELECTED, selectedRoomId: id } }));
  },
  selectStair(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...NOTHING_SELECTED, selectedStairId: id } }));
  },
  selectColumn(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...NOTHING_SELECTED, selectedColumnId: id } }));
  },

  /**
   * Work on another level: the plan shows it, and what is drawn next goes on it. A view setting
   * — no undo step. What was selected stays selected only if it is on that level.
   */
  setActiveLevel(ref: string): ActionResult {
    const bad = textError("level", ref, TEXT.ref);
    if (bad) return fail(bad);
    const state = store.getState();
    const found = lookupLevel(state.model, ref);
    if (!found.ok) return lookupFailed(found);
    const level = found.entity;
    const e = state.editor;
    const selected = e.selectedWallId ?? e.selectedRoomId ?? e.selectedItemId ?? e.selectedStairId ?? e.selectedColumnId;
    const keep = selected !== null && levelIdOf(state.model, selected) === level.id;
    store.setState((s) => ({
      editor: { ...s.editor, ...(keep ? {} : NOTHING_SELECTED), activeLevelId: level.id, pendingWallStart: null },
    }));
    return ok(`Working on "${level.name}" (floor at ${elevationOf(state.model, level.id).toFixed(2)} m).`, { id: level.id });
  },

  /** The level below or above the one being worked on (PageDown / PageUp); refused at either end. */
  stepActiveLevel(by: -1 | 1): ActionResult {
    const state = store.getState();
    const at = state.model.levels.findIndex((l) => l.id === activeLevelId(state));
    const next = state.model.levels[at + by];
    if (!next) return fail(by > 0 ? "This is the top level." : "This is the ground level.");
    return pageActions.setActiveLevel(next.id);
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
