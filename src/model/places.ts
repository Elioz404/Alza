/**
 * Where an entity of the plan is, and what it is, by its id alone: the plan's own answer to
 * "where is wall_n?". The shared session moves the agent's marker there (presence.ts), point_at
 * points there, and the feed's links bring it into view (ui/activity/entities.ts, centreOf).
 */

import type { PlanModel, TargetType } from "./types";
import { catalogOf, kindName } from "./catalog";
import { levelIdOf, stairGeometryIn } from "./levels";
import { SESSION } from "./limits";

/** A point on the plan, metres, and the level it is on (none for the plan as a whole). */
export interface Place {
  x: number;
  y: number;
  levelId: string | undefined;
}

/** The kinds of entity that stand somewhere on the plan. */
export type PlacedType = Exclude<TargetType, "level" | "plan" | "file">;

/** What an id names: its type, and the name a person knows it by where it has one of its own. */
export interface EntityInfo {
  type: PlacedType;
  id: string;
  /** a room's label, a piece's catalogue name; none for walls, openings and stairs */
  label?: string;
}

/** What `id` names on the plan, or null when it names nothing that stands somewhere. */
export function entityInfo(model: PlanModel, id: string): EntityInfo | null {
  if (model.walls.some((w) => w.id === id)) return { type: "wall", id };
  const opening = model.openings.find((o) => o.id === id);
  if (opening) return { type: opening.kind, id };
  const room = model.rooms.find((r) => r.id === id);
  if (room) return { type: "room", id, label: room.label };
  const item = model.items.find((i) => i.id === id);
  if (item) {
    const def = catalogOf(model).get(item.kind);
    return { type: "item", id, label: def ? kindName(def) : item.kind };
  }
  if (model.stairs.some((s) => s.id === id)) return { type: "stair", id };
  return null;
}

/**
 * The middle of what `id` names on the plan: a wall's midpoint, an opening's centre on its wall,
 * a room's centre, a piece's centre, the middle of a stair's footprint. Null when it names none.
 */
export function placeOf(model: PlanModel, id: string): Place | null {
  const at = (x: number, y: number): Place => ({ x, y, levelId: levelIdOf(model, id) });
  const w = model.walls.find((x) => x.id === id);
  if (w) return at((w.ax + w.bx) / 2, (w.ay + w.by) / 2);
  const o = model.openings.find((x) => x.id === id);
  if (o) {
    const host = model.walls.find((x) => x.id === o.wallId);
    return host ? at(host.ax + (host.bx - host.ax) * o.t, host.ay + (host.by - host.ay) * o.t) : null;
  }
  const r = model.rooms.find((x) => x.id === id);
  if (r) return at(r.x + r.w / 2, r.y + r.h / 2);
  const it = model.items.find((x) => x.id === id);
  if (it) return at(it.x, it.y);
  const st = model.stairs.find((x) => x.id === id);
  const g = st ? stairGeometryIn(model, st) : null;
  return g ? at((g.box.minX + g.box.maxX) / 2, (g.box.minY + g.box.maxY) / 2) : null;
}

/**
 * Where a marker on what `id` names stands (the agent's, point_at's ring, on the plan and over
 * the 3D view alike): where placeOf says, except in a room, whose middle is its name and area —
 * there it stands in from the room's corner (SESSION.markerInset), clear of them.
 */
export function markerOf(model: PlanModel, id: string): Place | null {
  const r = model.rooms.find((x) => x.id === id);
  if (!r) return placeOf(model, id);
  const { metres, share } = SESSION.markerInset;
  return { x: r.x + Math.min(metres, r.w * share), y: r.y + Math.min(metres, r.h * share), levelId: levelIdOf(model, id) };
}
