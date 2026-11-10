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
  type ItemKindSpec,
  type RoomPatch,
  type UndoStep,
  type WallPatch,
} from "./store";
import type { SupplierProductData } from "./catalog";
import type { ActivitySource, PlanModel, Underlay } from "./types";
import type { Actor, Hinge, SwingSide } from "./limits";

export type { Actor };

export type Command =
  | { type: "add_wall"; ax: number; ay: number; bx: number; by: number; thickness?: number; height?: number }
  | { type: "edit_wall"; id: string; patch: WallPatch }
  | { type: "remove_wall"; id: string }
  | { type: "add_door"; wallId: string; t: number; width?: number; height?: number; hinge?: Hinge; side?: SwingSide }
  | { type: "add_window"; wallId: string; t: number; width?: number; sill?: number; height?: number }
  | { type: "set_door_swing"; id: string; hinge?: Hinge; side?: SwingSide }
  | { type: "move_opening"; id: string; t: number }
  | { type: "remove_opening"; id: string }
  | { type: "add_room"; x: number; y: number; w: number; h: number; label: string; floor?: string }
  | { type: "update_room"; id: string; patch: RoomPatch }
  | { type: "remove_room"; id: string }
  | { type: "place_item"; kind: string; x: number; y: number; rotation?: number }
  | { type: "move_item"; id: string; x?: number; y?: number; rotation?: number }
  | { type: "remove_item"; id: string }
  | { type: "define_item_kind"; spec: ItemKindSpec }
  | { type: "import_supplier_product"; product: SupplierProductData }
  | { type: "place_supplier_product"; product: SupplierProductData; x: number; y: number; rotation?: number }
  | { type: "set_plan_name"; name: string }
  | { type: "clear_model" }
  | { type: "load_model"; model: PlanModel }
  | { type: "set_underlay"; underlay: Underlay | null }
  | { type: "calibrate_underlay"; u1: number; v1: number; u2: number; v2: number; meters: number; opacity?: number }
  | { type: "leave_note"; text: string }
  | { type: "undo" };

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
  add_wall: (c) => actions.addWall(c.ax, c.ay, c.bx, c.by, c.thickness, c.height),
  edit_wall: (c) => actions.editWall(c.id, c.patch),
  remove_wall: (c) => actions.removeWall(c.id),
  add_door: (c) => actions.addOpening("door", c.wallId, c.t, c.width, undefined, c.height, { hinge: c.hinge, side: c.side }),
  add_window: (c) => actions.addOpening("window", c.wallId, c.t, c.width, c.sill, c.height),
  set_door_swing: (c) => actions.setDoorSwing(c.id, c.hinge, c.side),
  move_opening: (c) => actions.moveOpening(c.id, c.t),
  remove_opening: (c) => actions.removeOpening(c.id),
  add_room: (c) => actions.addRoom(c.x, c.y, c.w, c.h, c.label, c.floor),
  update_room: (c) => actions.updateRoom(c.id, c.patch),
  remove_room: (c) => actions.removeRoom(c.id),
  place_item: (c) => actions.placeItem(c.kind, c.x, c.y, c.rotation),
  move_item: (c) => actions.moveItem(c.id, c.x, c.y, c.rotation),
  remove_item: (c) => actions.removeItem(c.id),
  define_item_kind: (c) => actions.defineItemKind(c.spec),
  import_supplier_product: (c) => actions.importSupplierProduct(c.product),
  place_supplier_product: (c) => {
    // adopting the kind and placing the piece are one change: one undo step takes both back
    const { model, undoStack } = store.getState();
    const imported = actions.importSupplierProduct(c.product);
    if (!imported.ok) return imported;
    const placed = actions.placeItem(String(imported.kind), c.x, c.y, c.rotation);
    if (!placed.ok) {
      // the kind is only worth keeping with the piece it came in for: a refused placement
      // leaves the plan, and its undo history, exactly as they were
      store.setState({ model, undoStack });
      return placed;
    }
    return { ...placed, kind: imported.kind };
  },
  set_plan_name: (c) => actions.setPlanName(c.name),
  clear_model: () => actions.clearModel(),
  load_model: (c) => actions.loadModel(c.model),
  set_underlay: (c) => actions.setUnderlay(c.underlay),
  calibrate_underlay: (c) => actions.calibrateUnderlay(c.u1, c.v1, c.u2, c.v2, c.meters, c.opacity),
  // a note is signed by whoever wrote it, never by what the caller claims (and the page itself
  // signs none: leaveNote refuses a "system" author)
  leave_note: (c, ctx) => actions.leaveNote(ctx.actor, c.text),
  undo: () => actions.undo(),
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

/** Change the plan: one checked action, one undo step, one line in the activity feed. */
export function dispatch(command: Command, ctx: DispatchContext): ActionResult {
  const result = withUndo(ctx.undoable !== false, () => apply(command, ctx));
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
      if (step && newest() !== step) close();
      const before = store.getState().undoStack;
      const result = withUndo(step === null, () => apply(command, ctx));
      if (step === null && store.getState().undoStack !== before) step = newest() ?? null;
      last = { command, result };
      return result;
    },
    end: close,
  };
}
