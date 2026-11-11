/** Domain model — all units are meters, plan lives on the XY plane (y grows downward in 2D view). */

import type { Actor, ColumnShape, DoorStyle, FloorFinish, Hinge, ItemCategory, KindSource, NoteAuthor, OpeningKind, RoomKind, StairShape, StairTurn, SwingSide } from "./limits";
import { GROUND_LEVEL_ID, LEVEL_DEFAULTS, LEVEL_NAMES, PLAN_FORMAT_VERSION } from "./limits";
import type { PartInput } from "./schemas";
import { newPlanId } from "./ids";

/**
 * One storey of the plan. Levels stack in the order the plan lists them, from the ground up:
 * a level's floor stands at the sum of the floor-to-floor heights of the levels below it
 * (model/levels.ts, levelsOf), so the elevation is derived and can never disagree with them.
 */
export interface Level {
  id: string;
  name: string;
  /** floor-to-floor height, metres: from this level's floor to the floor of the level above */
  height: number;
}

export interface Wall {
  id: string;
  /** the level the wall stands on; its openings are on the same level */
  levelId: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thickness: number; // meters, e.g. 0.15
  height: number; // meters, e.g. 2.7
  /**
   * A curved wall's bend: the bulge of its centreline arc from A to B (limits.ts, BULGE —
   * tan of a quarter of the arc's included angle; positive bows to the wall's left walking A to
   * B). Absent or 0, the wall is straight. Its faces are concentric arcs, thickness/2 to either
   * side, with the same bulge; an opening's `t` and `width` are measured along the centreline
   * arc (model/shapes.ts).
   */
  bulge?: number;
}

export type { OpeningKind } from "./limits";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  /** position along the wall, 0..1, measured to the CENTER of the opening */
  t: number;
  width: number; // meters (the clear span of the vano)
  sill: number; // height of the bottom edge (0 for doors, ~0.9 for windows)
  height: number; // clear height of the opening
  /** doors only — which jamb carries the hinges (default "a", the wall's A end) */
  hinge?: Hinge;
  /**
   * doors only — which side of the wall the leaf swings to, walking from the wall's
   * A endpoint to its B endpoint on the plan (default "right").
   */
  side?: SwingSide;
  /**
   * doors only — how it opens: absent (or "swing") for a hinged leaf, "garage" for a sectional
   * overhead door, which has no hinge or swing side and sweeps no floor (limits.ts, GARAGE_DOOR).
   */
  style?: DoorStyle;
}

/**
 * A corner of a room's outline, and the edge from it to the next corner: straight, or an arc of
 * that bulge (limits.ts, BULGE). The outline is kept wound one way (positive shoelace area on the
 * plan's coordinates, model/shapes.ts normalizeOutline), so a positive bulge always bows out of
 * the room and a negative one into it.
 */
export interface RoomVertex {
  x: number;
  y: number;
  bulge?: number;
}

/**
 * A room: a simple polygon whose edges may be arcs (ROOM_SHAPE in limits.ts). A rectangle is
 * its four corners, clockwise on the sheet from the top-left one (shapes.ts, rectOutline).
 */
export interface Room {
  id: string;
  levelId: string;
  points: RoomVertex[];
  label: string;
  floor: FloorFinish;
  /**
   * absent (or "enclosed") for a room its walls close off; "open" for an open space — a carport,
   * a porch — whose sides need no walls (limits.ts, ROOM_KINDS). Stored only when open.
   */
  kind?: RoomKind;
}

/**
 * A structural column: a square, rectangular or circular section standing on its level, from its
 * floor up to the underside of the slab over it unless a height is set (model/columns.ts,
 * columnHeight). It carries the floor above it, as a wall does (model/supports.ts). A column
 * standing in a wall is part of that wall (columnWalls): one poché, the wall's joints round it.
 */
export interface Column {
  id: string;
  levelId: string;
  shape: ColumnShape;
  /** centre, on the plan */
  x: number;
  y: number;
  /** section width along its own x (a circle's diameter), metres */
  w: number;
  /** section depth along its own y; equal to `w` for a square or a circle */
  d: number;
  /** degrees counterclockwise, place_item's convention; a circle's is kept as given */
  rotation: number;
  /** a set height, metres; absent, it reaches the underside of the slab over its level */
  height?: number;
}

export interface Item {
  id: string;
  levelId: string;
  kind: string; // catalog key
  x: number; // center
  y: number;
  rotation: number; // degrees, counterclockwise
}

/**
 * A stair from the level it stands on (its bottom) to the level above it. Only where it starts,
 * which way it climbs and how wide it is are stored: its risers, goings, flights, landing and
 * the stairwell it opens in the floor above all follow from those and from the floor-to-floor
 * height it climbs (model/stairs.ts, stairGeometry), so they stay right when a level changes.
 */
export interface Stair {
  id: string;
  /** the level the stair starts on; it arrives on the next level up */
  levelId: string;
  shape: StairShape;
  /** centre of the bottom riser, on the plan */
  x: number;
  y: number;
  /**
   * The direction it climbs, degrees counterclockwise, with place_item's convention:
   * 0 = toward +y (down the sheet), 90 = +x, 180 = -y, 270 = -x. For an L-shaped stair this is
   * the first flight's direction.
   */
  rotation: number;
  /** clear width of each flight, metres */
  width: number;
  /** L-shaped only: which way the second flight turns, as seen climbing (default "left") */
  turn?: StairTurn;
  /** L-shaped only: risers in the first flight, up to the landing (default: half of them) */
  split?: number;
  /** a set number of risers; by default the fewest that keep each under STAIR.riser.max */
  risers?: number;
  /** a set going (tread depth), metres; by default the one the step rule asks for */
  tread?: number;
}

/**
 * One primitive of an agent-authored piece of furniture, in the piece's own frame: width along
 * +x, depth along +z, y measured up from the floor to the part's BOTTOM, front facing +z.
 * Plain data, so a piece's 3D shape travels with the plan that defines it. Its fields are the
 * partSpec schema's (model/schemas.ts), so the shape is declared once and the type follows it.
 */
export type PartSpec = Readonly<PartInput>;

export type { KindSource } from "./limits";

/** A kind of furniture: its footprint (metres), display metadata and, optionally, its 3D parts. */
export interface KindDef {
  readonly kind: string;
  readonly label: string;
  readonly w: number; // footprint width  (local x)
  readonly d: number; // footprint depth  (local y)
  readonly h: number; // approximate height (3D)
  readonly color: string;
  readonly category: ItemCategory;
  readonly source: KindSource;
  /** rugs may overlap other furniture */
  readonly isRug?: boolean;
  /**
   * a vehicle, placed to check that it fits: it needs PARKING's clear floor round it, and no
   * column may stand there (limits.ts). Exported as a furniture-like reference object.
   */
  readonly parking?: boolean;
  /** custom kinds only: the primitives it is modelled from; without them it is blocked out */
  readonly parts?: readonly PartSpec[];
}

export interface Underlay {
  /**
   * The image, by id in the asset store (model/assets.ts). The bytes are not part of the plan:
   * every plan the undo history keeps, and every get_model answer, would otherwise carry them.
   */
  assetId: string;
  opacity: number; // 0..1
  /** world-rect the image covers */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Pixel size of the copy THIS PAGE holds. The upload re-encodes to ≤1600 px, so it
   * rarely matches the file the human also pasted into their agent's conversation —
   * which is why get_underlay tells the agent to work in fractions, not pixels.
   */
  pw?: number;
  ph?: number;
}

/**
 * The kinds of thing an approval can be about: an entity of the plan, the whole plan, or a file
 * the call would hand the person (its id and label are the file's name).
 */
export type TargetType = "wall" | "door" | "window" | "room" | "item" | "stair" | "column" | "level" | "plan" | "file";

/**
 * One entity a parked call would act on, as the page found it in the model — never as the
 * caller described it. `label` is the entity's own name (a room label, a catalogue label).
 */
export interface ApprovalTarget {
  type: TargetType;
  id: string;
  label: string;
}

/**
 * A destructive tool call, parked until the human decides.
 * The WebMCP explainer flags user confirmation as an open question
 * (webmachinelearning/webmcp — "a way for a tool to prompt the user for confirmation");
 * this is Alza's answer to it.
 *
 * Every field is written by the page from the entities the call resolved to. The caller's own
 * arguments are not kept, so nothing it typed can reach the human's screen as the request.
 */
export interface PendingApproval {
  id: string;
  tool: string;
  /** who asked: an agent over WebMCP, or the human through the on-page tool runner */
  actor: Actor;
  /** plain-language sentence shown to the human, built from types and ids only */
  request: string;
  targets: ApprovalTarget[];
  /** what else the call does, e.g. the openings that go with a wall */
  effects: string[];
  at: number;
}

export interface Note {
  id: string;
  author: NoteAuthor;
  text: string;
  at: number; // epoch ms
}

export interface PlanModel {
  /** the data format the plan is written in (PLAN_FORMAT_VERSION); older ones migrate on load */
  version: typeof PLAN_FORMAT_VERSION;
  /**
   * The plan's identity, apart from every other plan's: random when the plan is started
   * (ids.ts newPlanId), kept through every edit and every save. What a plan exports keeps its
   * identity from it (the IFC GlobalIds), so two plans never share one and the same plan,
   * exported again, is recognised as itself.
   */
  id: string;
  name: string;
  /** the storeys, from the ground up; a plan always has at least one */
  levels: Level[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  stairs: Stair[];
  /** the structural columns, every level's */
  columns: Column[];
  /**
   * The kinds this plan adds to the built-in catalogue: agent-defined pieces (with their 3D
   * parts) and adopted supplier products. They live in the plan so it is self-contained — a
   * plan that places "nordika:NK-SOF-3S" carries that kind with it — and so undo reverts a
   * definition like any other edit.
   */
  kinds: KindDef[];
  underlay: Underlay | null;
}

/**
 * Who a change or a feed line comes from: one of the two actors, the page itself, or another tab
 * of this browser working on the same plan (the shared session, src/session/).
 */
export type ActivitySource = Actor | "system" | "peer";

export interface ActivityEntry {
  id: string;
  at: number;
  source: ActivitySource;
  tool: string;
  summary: string;
  ok: boolean;
}

export type IssueSeverity = "error" | "warning";

/** A finding is read-only once made: every reader shares the one frozen list (issuesOf). */
export interface Issue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly refs: readonly string[]; // entity ids involved
}

/** The single level a fresh plan stands on. */
export const groundLevel = (): Level => ({ id: GROUND_LEVEL_ID, name: LEVEL_NAMES[0], height: LEVEL_DEFAULTS.height });

export const emptyModel = (): PlanModel => ({
  version: PLAN_FORMAT_VERSION,
  id: newPlanId(),
  name: "Untitled plan",
  levels: [groundLevel()],
  walls: [],
  openings: [],
  rooms: [],
  items: [],
  stairs: [],
  columns: [],
  kinds: [],
  underlay: null,
});
