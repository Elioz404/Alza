/**
 * Where an entity of the plan is, and what it is, by its id alone: the plan's own answer to
 * "where is wall_n?". The shared session moves the agent's marker there (presence.ts), point_at
 * points there, and the feed's links bring it into view (ui/activity/entities.ts, centreOf).
 */

import type { PlanModel, TargetType } from "./types";
import { catalogOf, kindName } from "./catalog";
import { levelIdOf, stairGeometryIn } from "./levels";
import { SESSION } from "./limits";
import { outlineAnchor, outlineBox, wallPointAt } from "./shapes";

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
 * a room's anchor (its most interior point, where its name goes: shapes.ts outlineAnchor), a
 * piece's centre, the middle of a stair's footprint. Null when it names none.
 */
export function placeOf(model: PlanModel, id: string): Place | null {
  const at = (x: number, y: number): Place => ({ x, y, levelId: levelIdOf(model, id) });
  const w = model.walls.find((x) => x.id === id);
  if (w) {
    const mid = wallPointAt(w, 0.5);
    return at(mid.x, mid.y);
  }
  const o = model.openings.find((x) => x.id === id);
  if (o) {
    const host = model.walls.find((x) => x.id === o.wallId);
    const c = host ? wallPointAt(host, o.t) : null;
    return c ? at(c.x, c.y) : null;
  }
  const r = model.rooms.find((x) => x.id === id);
  if (r) {
    const anchor = outlineAnchor(r.points);
    return at(anchor.x, anchor.y);
  }
  const it = model.items.find((x) => x.id === id);
  if (it) return at(it.x, it.y);
  const st = model.stairs.find((x) => x.id === id);
  const g = st ? stairGeometryIn(model, st) : null;
  return g ? at((g.box.minX + g.box.maxX) / 2, (g.box.minY + g.box.maxY) / 2) : null;
}

/**
 * Where a marker on what `id` names stands (the agent's, point_at's ring, on the plan and over
 * the 3D view alike): where placeOf says, except in a room, whose anchor is its name and area —
 * there it stands in from the room's corner nearest its bounds' top-left (SESSION.markerInset),
 * toward its anchor, clear of them.
 */
export function markerOf(model: PlanModel, id: string): Place | null {
  const r = model.rooms.find((x) => x.id === id);
  if (!r) return placeOf(model, id);
  const { metres, share } = SESSION.markerInset;
  const box = outlineBox(r.points);
  const corner = r.points.reduce((best, p) => (p.x - box.minX + (p.y - box.minY) < best.x - box.minX + (best.y - box.minY) ? p : best));
  const anchor = outlineAnchor(r.points);
  const dx = anchor.x - corner.x;
  const dy = anchor.y - corner.y;
  const reach = Math.hypot(dx, dy);
  const step = reach === 0 ? 0 : Math.min(metres * Math.SQRT2, reach * share * 2) / reach;
  return { x: corner.x + dx * step, y: corner.y + dy * step, levelId: levelIdOf(model, id) };
}
