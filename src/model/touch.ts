/**
 * What a command touches: the entities of the plan that are there already and that it would
 * change or remove. A command that adds something new touches nothing that exists (a door
 * touches the wall it goes in); one that replaces the whole plan, or takes back the last change,
 * touches "all" of it.
 *
 * The shared session reads it twice: the agent's marker goes to what its call touched
 * (presence.ts), and an agent's change to something the person is editing right now waits for
 * them (mcp/registry.ts). Settings of the plan as a whole have ids of their own here
 * (PLAN_NAME, PLAN_UNDERLAY), so typing the plan's name holds it like dragging a piece does.
 */

import type { Command } from "./commands";
import type { PlanModel } from "./types";
import { levelContents } from "./levels";
import { lookupItem, lookupLevel, lookupOpening, lookupRoom, lookupStair, lookupWall, type Lookup } from "./resolve";

/** The id `ref` (an id or a name, as a tool takes it) resolves to; the ref itself when it names nothing. */
const idOf = (model: PlanModel, ref: string, lookup: (m: PlanModel, r: string) => Lookup<{ id: string }>): string => {
  const found = lookup(model, ref);
  return found.ok ? found.entity.id : ref;
};

/** The plan's name and its underlay, as a gesture holds them. */
export const PLAN_NAME = "plan:name";
export const PLAN_UNDERLAY = "plan:underlay";

export function touchedBy(command: Command, model: PlanModel): readonly string[] | "all" {
  switch (command.type) {
    case "add_door":
    case "add_window":
      return [idOf(model, command.wallId, lookupWall)];
    case "edit_wall":
      return [idOf(model, command.id, lookupWall)];
    case "remove_wall": {
      const id = idOf(model, command.id, lookupWall);
      return [id, ...model.openings.filter((o) => o.wallId === id).map((o) => o.id)];
    }
    case "set_door_swing":
    case "move_opening":
    case "remove_opening":
      return [idOf(model, command.id, lookupOpening)];
    case "update_room":
    case "remove_room":
      return [idOf(model, command.id, lookupRoom)];
    case "move_item":
    case "remove_item":
      return [idOf(model, command.id, lookupItem)];
    case "move_stair":
    case "update_stair":
    case "remove_stair":
      return [idOf(model, command.id, lookupStair)];
    case "update_level":
      return [idOf(model, command.id, lookupLevel)];
    case "remove_level": {
      const id = idOf(model, command.id, lookupLevel);
      const c = levelContents(model, id);
      return [id, ...[c.walls, c.openings, c.rooms, c.items, c.stairs].flat().map((e) => e.id)];
    }
    case "set_plan_name":
      return [PLAN_NAME];
    case "set_underlay":
    case "calibrate_underlay":
      return [PLAN_UNDERLAY];
    case "clear_model":
    case "load_model":
    case "sync_remote":
    case "undo":
      return "all";
    case "add_wall":
    case "add_room":
    case "place_item":
    case "define_item_kind":
    case "import_supplier_product":
    case "place_supplier_product":
    case "add_level":
    case "add_stair":
    case "leave_note":
      return [];
  }
}
