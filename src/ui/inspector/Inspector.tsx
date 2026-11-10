/**
 * The Properties tab: the editor for whatever is selected on the plan, or the plan itself when
 * nothing is. A selection whose entity has gone (an agent removed it, an undo took it back)
 * falls back to the plan rather than showing an empty editor.
 *
 * Every field changes the plan through dispatch(command, { actor: "human" }), the same
 * commands an agent's tools run, so each edit is one undo step and one line in Activity.
 */
import "./inspector.css";
import { useAppStore } from "../useAppStore";
import { PlanInspector } from "./PlanInspector";
import { deferred, regionPlaceholder } from "../deferred";

// Nothing is selected when the page opens, so only the plan's inspector is in the first chunk;
// the others arrive with the idle prefetch, well before the first click on the plan.
const WallInspector = deferred("the wall inspector", () => import("./WallInspector").then((m) => m.WallInspector), regionPlaceholder);
const RoomInspector = deferred("the room inspector", () => import("./RoomInspector").then((m) => m.RoomInspector), regionPlaceholder);
const ItemInspector = deferred("the item inspector", () => import("./ItemInspector").then((m) => m.ItemInspector), regionPlaceholder);

export function Inspector() {
  const wall = useAppStore((s) => (s.editor.selectedWallId ? s.model.walls.find((w) => w.id === s.editor.selectedWallId) : undefined));
  const room = useAppStore((s) => (s.editor.selectedRoomId ? s.model.rooms.find((r) => r.id === s.editor.selectedRoomId) : undefined));
  const item = useAppStore((s) => (s.editor.selectedItemId ? s.model.items.find((i) => i.id === s.editor.selectedItemId) : undefined));

  // keyed by the entity, so a half-typed field never carries over to the next selection
  if (wall) return <WallInspector key={wall.id} wall={wall} />;
  if (room) return <RoomInspector key={room.id} room={room} />;
  if (item) return <ItemInspector key={item.id} item={item} />;
  return <PlanInspector />;
}
