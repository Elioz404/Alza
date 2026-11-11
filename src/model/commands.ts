/**
 * The one way the plan changes.
 *
 * Every change — a wall the human draws, a sofa an agent places, an undo — is a Command, and
 * every command goes through dispatch(command, { actor }). That single path is what makes the
 * two actors equal: the same action checks the arguments, the change is recorded as exactly
 * one undo step, and the activity feed attributes it to whoever asked. The WebMCP tools reach
 * it through the tool adapter (mcp/registry.ts → executeWrapped), the UI calls it directly.
 *
 * A command is plain data. Its `type` is the name the activity feed shows, and matches the
 * tool of the same name where there is one.
 */

import {
  actions,
  logActivity,
  store,
  withUndo,
  type ActionResult,
  type ColumnPatch,
  type ColumnSpec,
  type ItemKindSpec,
  type LevelPatch,
  type RoomPatch,
  type RoomReshape,
  type RoomSpec,
  type StairPatch,
  type StairSpec,
  type UndoStep,
  type WallPatch,
} from "./store";
import type { PlanInput } from "./planFormat";
import type { SupplierProductData } from "./catalog";
import type { ActivitySource, Note, PlanModel, Underlay } from "./types";
import type { CurveInput } from "./shapes";
import type { Actor, DoorStyle, Hinge, SwingSide } from "./limits";
import { touchedBy } from "./touch";
import { agentTouched, holdEditing, releaseEditing } from "./presence";

export type { Actor };

export type Command =
  // `level` (a level's id or name) says which level a new thing goes on: the active one by default
  // `curve` bends a new wall: its bulge, its sagitta (positive to its left, walking A to B) or a point it passes through
  | { type: "add_wall"; ax: number; ay: number; bx: number; by: number; thickness?: number; height?: number; level?: string; curve?: CurveInput }
  | { type: "edit_wall"; id: string; patch: WallPatch }
  | { type: "remove_wall"; id: string }
  // `style` "garage" adds a sectional overhead garage door, sized from GARAGE_DOOR (limits.ts)
  | { type: "add_door"; wallId: string; t: number; width?: number; height?: number; hinge?: Hinge; side?: SwingSide; style?: DoorStyle }
  | { type: "add_window"; wallId: string; t: number; width?: number; sill?: number; height?: number }
  | { type: "set_door_swing"; id: string; hinge?: Hinge; side?: SwingSide }
  | { type: "move_opening"; id: string; t: number }
  // resize a door or window, or change how a door opens (style)
  | { type: "update_opening"; id: string; patch: { width?: number; height?: number; sill?: number; style?: DoorStyle } }
  | { type: "remove_opening"; id: string }
  // a rectangle (x, y, w, h), an outline (points) or the walls round a point (fit): store.ts, RoomSpec
  | ({ type: "add_room" } & RoomSpec)
  | { type: "update_room"; id: string; patch: RoomPatch }
  | { type: "reshape_room"; id: string; change: RoomReshape }
  | { type: "remove_room"; id: string }
  | { type: "place_item"; kind: string; x: number; y: number; rotation?: number; level?: string }
  | { type: "move_item"; id: string; x?: number; y?: number; rotation?: number; level?: string }
  | { type: "remove_item"; id: string }
  | { type: "define_item_kind"; spec: ItemKindSpec }
  | { type: "import_supplier_product"; product: SupplierProductData }
  | { type: "place_supplier_product"; product: SupplierProductData; x: number; y: number; rotation?: number; level?: string }
  | { type: "add_level"; name?: string; height?: number }
  | { type: "update_level"; id: string; patch: LevelPatch }
  | { type: "remove_level"; id: string }
  | { type: "add_stair"; spec: StairSpec }
  | { type: "move_stair"; id: string; x?: number; y?: number; rotation?: number }
  | { type: "update_stair"; id: string; patch: StairPatch }
  | { type: "remove_stair"; id: string }
  // a column, or a grid of them (spec.grid), on a level: store.ts, ColumnSpec
  | { type: "add_column"; spec: ColumnSpec }
  // the drag's command: where the column is and how it is turned, nothing else
  | { type: "move_column"; id: string; x?: number; y?: number; rotation?: number }
  | { type: "update_column"; id: string; patch: ColumnPatch }
  | { type: "remove_column"; id: string }
  | { type: "set_plan_name"; name: string }
  | { type: "clear_model" }
  | { type: "load_model"; model: PlanInput }
  | { type: "set_underlay"; underlay: Underlay | null }
  | { type: "calibrate_underlay"; u1: number; v1: number; u2: number; v2: number; meters: number; opacity?: number }
  | { type: "leave_note"; text: string }
  | { type: "undo" }
  /**
   * The plan as the shared session has it (src/session/): another tab's change, merged, or the
   * plan a tab takes up as it joins the others. `summary` is what that change was; `history` is
   * this tab's undo steps with the change folded into them (store.ts, applySync).
   */
  | { type: "sync_remote"; model: PlanModel; notes: Note[]; summary: string; history?: readonly UndoStep[] };

export type CommandType = Command["type"];

export interface DispatchContext {
  /** who asked: the human, an agent, or the page itself (the plan it opens with) */
  actor: ActivitySource;
  /**
   * false for a change there is nothing to go back from — the plan the page opens with — so it
   * records no undo step, and the first Undo cannot blank the page. True by default.
   */
  undoable?: boolean;
  /**
   * The name the activity feed shows for this change; the command's type by default. The tool
   * adapter passes the tool's name, so the feed names the tool the agent actually called.
   */
  as?: string;
}

type Handlers = { [K in CommandType]: (command: Extract<Command, { type: K }>, ctx: DispatchContext) => ActionResult };

const HANDLERS: Handlers = {
  add_wall: (c) => actions.addWall(c.ax, c.ay, c.bx, c.by, c.thickness, c.height, c.level, c.curve),
  edit_wall: (c) => actions.editWall(c.id, c.patch),
  remove_wall: (c) => actions.removeWall(c.id),
  add_door: (c) => actions.addOpening("door", c.wallId, c.t, c.width, undefined, c.height, { hinge: c.hinge, side: c.side, style: c.style }),
  add_window: (c) => actions.addOpening("window", c.wallId, c.t, c.width, c.sill, c.height),
  set_door_swing: (c) => actions.setDoorSwing(c.id, c.hinge, c.side),
  move_opening: (c) => actions.moveOpening(c.id, c.t),
  update_opening: (c) => actions.updateOpening(c.id, c.patch),
  remove_opening: (c) => actions.removeOpening(c.id),
  add_room: (c) => actions.addRoom(c),
  update_room: (c) => actions.updateRoom(c.id, c.patch),
  reshape_room: (c) => actions.reshapeRoom(c.id, c.change),
  remove_room: (c) => actions.removeRoom(c.id),
  place_item: (c) => actions.placeItem(c.kind, c.x, c.y, c.rotation, c.level),
  move_item: (c) => actions.moveItem(c.id, c.x, c.y, c.rotation, c.level),
  remove_item: (c) => actions.removeItem(c.id),
  define_item_kind: (c) => actions.defineItemKind(c.spec),
  import_supplier_product: (c) => actions.importSupplierProduct(c.product),
  place_supplier_product: (c) => {
    // adopting the kind and placing the piece are one change: one undo step takes both back
    const { model, undoStack } = store.getState();
    const imported = actions.importSupplierProduct(c.product);
    if (!imported.ok) return imported;
    const placed = actions.placeItem(String(imported.kind), c.x, c.y, c.rotation, c.level);
    if (!placed.ok) {
      // the kind is only worth keeping with the piece it came in for: a refused placement
      // leaves the plan, and its undo history, exactly as they were
      store.setState({ model, undoStack });
      return placed;
    }
    return { ...placed, kind: imported.kind };
  },
  add_level: (c) => actions.addLevel(c.name, c.height),
  update_level: (c) => actions.updateLevel(c.id, c.patch),
  remove_level: (c) => actions.removeLevel(c.id),
  add_stair: (c) => actions.addStair(c.spec),
  // the drag's command: where the stair is and which way it climbs, nothing else
  move_stair: (c) => actions.updateStair(c.id, { x: c.x, y: c.y, rotation: c.rotation }),
  update_stair: (c) => actions.updateStair(c.id, c.patch),
  remove_stair: (c) => actions.removeStair(c.id),
  add_column: (c) => actions.addColumns(c.spec),
  move_column: (c) => actions.updateColumn(c.id, { x: c.x, y: c.y, rotation: c.rotation }),
  update_column: (c) => actions.updateColumn(c.id, c.patch),
  remove_column: (c) => actions.removeColumn(c.id),
  set_plan_name: (c) => actions.setPlanName(c.name),
  clear_model: () => actions.clearModel(),
  load_model: (c) => actions.loadModel(c.model),
  set_underlay: (c) => actions.setUnderlay(c.underlay),
  calibrate_underlay: (c) => actions.calibrateUnderlay(c.u1, c.v1, c.u2, c.v2, c.meters, c.opacity),
  // a note is signed by whoever wrote it, never by what the caller claims (and the page itself
  // signs none: leaveNote refuses a "system" author)
  leave_note: (c, ctx) => actions.leaveNote(ctx.actor, c.text),
  undo: () => actions.undo(),
  sync_remote: (c) => actions.applySync(c.model, c.notes, c.summary, c.history ?? null),
};

/** Run one command's action, turning a throw into a failed result like any other refusal. */
function apply(command: Command, ctx: DispatchContext): ActionResult {
  const handler = HANDLERS[command.type] as (c: Command, ctx: DispatchContext) => ActionResult;
  try {
    return handler(command, ctx);
  } catch (err) {
    return { ok: false, summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const record = (command: Command, ctx: DispatchContext, result: ActionResult): void =>
  logActivity(ctx.actor, ctx.as ?? command.type, result.summary, result.ok);

/** One command applied, whatever its outcome: what the shared session hears of every change. */
export interface Applied {
  command: Command;
  ctx: DispatchContext;
  result: ActionResult;
  /** the gesture it is a frame of, if any: the same object for every frame of one gesture */
  gesture: object | null;
}

const appliedListeners = new Set<(applied: Applied) => void>();

/** Hear every command as it is applied (the shared session, src/session/). Returns the way to stop. */
export function onApplied(listener: (applied: Applied) => void): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

/**
 * Run a command and tell whoever listens. The agent's presence follows from here: what its
 * change touched is where its marker goes (model/presence.ts), with no work for the tool.
 */
function applyAndTell(command: Command, ctx: DispatchContext, record: boolean, gesture: object | null): ActionResult {
  const before = store.getState().model;
  const result = withUndo(record, () => apply(command, ctx));
  if (ctx.actor === "agent" && result.ok) {
    const touched = touchedBy(command, before);
    agentTouched(ctx.as ?? command.type, [...new Set([...(touched === "all" ? [] : touched), ...(typeof result.id === "string" ? [result.id] : [])])], before);
  }
  for (const listener of appliedListeners) listener({ command, ctx, result, gesture });
  return result;
}

/** Change the plan: one checked action, one undo step, one line in the activity feed. */
export function dispatch(command: Command, ctx: DispatchContext): ActionResult {
  const result = applyAndTell(command, ctx, ctx.undoable !== false, null);
  record(command, ctx, result);
  return result;
}

/**
 * A continuous edit — dragging a piece, typing the plan's name, sliding the underlay's
 * opacity. Each frame is applied at once so the page follows the hand, but the whole gesture
 * is ONE undo step and ONE line in the activity feed (its last outcome, written on end()).
 *
 * The other actor does not wait for the hand to let go: an agent's tool call can land between
 * two frames. Its change is its own step, so the gesture never folds frames into it. Once the
 * step the gesture recorded is no longer the newest one, the frames so far are closed off with
 * their feed line, and the next frame starts a new step. Undo then takes back the latest
 * frames, then the agent's change, then the frames before it — each exactly once.
 */
export interface Gesture {
  update(command: Command): ActionResult;
  end(): void;
}

export function beginGesture(ctx: DispatchContext): Gesture {
  /** the undo step this gesture's frames fold into, once a frame has recorded one */
  let step: UndoStep | null = null;
  /** this gesture, as the person's presence holds what it edits and the session tells its frames apart */
  const self = Symbol("gesture");
  const token = {};
  let last: { command: Command; result: ActionResult } | null = null;
  const newest = (): UndoStep | undefined => store.getState().undoStack.at(-1);
  const close = () => {
    if (last) record(last.command, ctx, last.result);
    last = null;
    step = null;
  };
  return {
    update(command) {
      // someone else recorded (or undid) a step since our last frame: theirs is not ours to join
      // (a step rebased under another tab's change is still ours: it keeps its key)
      if (step && newest()?.key !== step.key) close();
      const before = store.getState().undoStack;
      // what the hand holds, so an agent's change to it waits until it lets go (mcp/registry.ts)
      if (ctx.actor === "human") {
        const touched = touchedBy(command, store.getState().model);
        if (touched !== "all") holdEditing(self, touched);
      }
      // a gesture that is not undoable (another tab's drag, src/session/) records no step at all
      const recording = ctx.undoable !== false;
      const result = applyAndTell(command, ctx, recording && step === null, token);
      if (recording && step === null && store.getState().undoStack !== before) step = newest() ?? null;
      last = { command, result };
      return result;
    },
    end() {
      releaseEditing(self);
      close();
    },
  };
}
