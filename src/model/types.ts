/** Domain model — all units are meters, plan lives on the XY plane (y grows downward in 2D view). */

import type { Actor, FloorFinish, Hinge, ItemCategory, NoteAuthor, SwingSide } from "./limits";
import type { PartInput } from "./schemas";

export interface Wall {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thickness: number; // meters, e.g. 0.15
  height: number; // meters, e.g. 2.7
}

export type OpeningKind = "door" | "window";

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
}

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  floor: FloorFinish;
}

export interface Item {
  id: string;
  kind: string; // catalog key
  x: number; // center
  y: number;
  rotation: number; // degrees, counterclockwise
}

/**
 * One primitive of an agent-authored piece of furniture, in the piece's own frame: width along
 * +x, depth along +z, y measured up from the floor to the part's BOTTOM, front facing +z.
 * Plain data, so a piece's 3D shape travels with the plan that defines it. Its fields are the
 * partSpec schema's (model/schemas.ts), so the shape is declared once and the type follows it.
 */
export type PartSpec = Readonly<PartInput>;

/**
 * Where a kind comes from. "builtin" kinds ship with the app and have hand-modelled 3D
 * builders; "custom" kinds were defined by an agent with define_item_kind; "supplier" kinds
 * were adopted from the partner origin, so their text is third-party content.
 */
export type KindSource = "builtin" | "custom" | "supplier";

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
  /** custom kinds only: the primitives it is modelled from; without them it is blocked out */
  readonly parts?: readonly PartSpec[];
}

export interface Underlay {
  dataUrl: string;
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

/** The kinds of thing an approval can be about. */
export type TargetType = "wall" | "door" | "window" | "room" | "item" | "plan";

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
  name: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  /**
   * The kinds this plan adds to the built-in catalogue: agent-defined pieces (with their 3D
   * parts) and adopted supplier products. They live in the plan so it is self-contained — a
   * plan that places "nordika:NK-SOF-3S" carries that kind with it — and so undo reverts a
   * definition like any other edit.
   */
  kinds: KindDef[];
  underlay: Underlay | null;
}

/** Who a change or a feed line comes from: one of the two actors, or the page itself. */
export type ActivitySource = Actor | "system";

export interface ActivityEntry {
  id: string;
  at: number;
  source: ActivitySource;
  tool: string;
  summary: string;
  ok: boolean;
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  refs: string[]; // entity ids involved
}

export const emptyModel = (): PlanModel => ({
  name: "Untitled plan",
  walls: [],
  openings: [],
  rooms: [],
  items: [],
  kinds: [],
  underlay: null,
});
