/**
 * How the page names and measures the things on a plan, for the panels that show them to the
 * person: "Wall 3", "Door 1", "Sofa", "between Bedroom and Bathroom", "1.20 m from the start".
 * Ids stay what the tools and the model use; a person reads names. Pure functions over the
 * plan, shared by the inspector and the issues list so both call a thing by the same name.
 */

import { catalogOf } from "../../model/catalog";
import { pageActions } from "../../model/store";
import { EVENTS } from "../../model/sceneBus";
import type { Item, Opening, PlanModel, Room, Wall } from "../../model/types";

export type EntityType = "wall" | "door" | "window" | "room" | "item";

/** One thing on the plan, as the person sees it. */
export interface EntityRef {
  type: EntityType;
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------- numbers

/** A length in metres as the page writes it: two decimals, always metres. */
export const metres = (m: number): string => `${m.toFixed(2)} m`;

/** An area in square metres. */
export const squareMetres = (m2: number): string => `${m2.toFixed(2)} m²`;

/** Up to one decimal, without a trailing ".0". */
export const degrees = (deg: number): string => `${Number(deg.toFixed(1))}°`;

// ---------------------------------------------------------------------------- walls

export const wallLength = (w: Wall): number => Math.hypot(w.bx - w.ax, w.by - w.ay);

/**
 * The wall's direction from its start to its end, in degrees counterclockwise from east as
 * the plan is drawn (y grows downward on the sheet), in [0, 360).
 */
export function wallAngle(w: Wall): number {
  const deg = (Math.atan2(-(w.by - w.ay), w.bx - w.ax) * 180) / Math.PI;
  const norm = ((deg % 360) + 360) % 360;
  return Math.abs(norm - 360) < 1e-9 ? 0 : norm;
}

/** The end point a wall of `length` at `angle` (as wallAngle measures it) reaches from its start. */
export function wallEndFor(w: Wall, length: number, angle: number): { bx: number; by: number } {
  const rad = (angle * Math.PI) / 180;
  return { bx: w.ax + Math.cos(rad) * length, by: w.ay - Math.sin(rad) * length };
}

export const wallName = (model: Pick<PlanModel, "walls">, w: Wall): string => `Wall ${model.walls.indexOf(w) + 1}`;

/** How far a point is from a room's outline (0 on it, positive inside or outside). */
function distanceToOutline(r: Room, x: number, y: number): number {
  const inside = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside) return Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** The rooms whose outline this wall runs along, by its midpoint, named in plan order. */
export function roomsAlong(model: Pick<PlanModel, "rooms">, w: Wall): Room[] {
  const mx = (w.ax + w.bx) / 2;
  const my = (w.ay + w.by) / 2;
  // half the wall's thickness either side of the outline, plus a hand's width of drawing slack
  const reach = w.thickness / 2 + w.thickness;
  return model.rooms.filter((r) => distanceToOutline(r, mx, my) <= reach);
}

/** "Between Bedroom and Bathroom", "Along Bedroom", or null when it bounds no room. */
export function wallPlace(model: Pick<PlanModel, "rooms">, w: Wall): string | null {
  const rooms = roomsAlong(model, w).map((r) => r.label);
  if (rooms.length === 0) return null;
  if (rooms.length === 1) return `Along ${rooms[0]}`;
  return `Between ${listOf(rooms, "and")}`;
}

// ---------------------------------------------------------------------------- openings

export const openingKindName = (o: Pick<Opening, "kind">): string => (o.kind === "door" ? "Door" : "Window");

export function openingName(model: Pick<PlanModel, "openings">, o: Opening): string {
  const same = model.openings.filter((x) => x.kind === o.kind);
  return `${openingKindName(o)} ${same.indexOf(o) + 1}`;
}

/** Distance from the wall's start to the opening's near edge, in metres. */
export const openingOffset = (wall: Wall, o: Opening): number => o.t * wallLength(wall) - o.width / 2;

/** The opening's position parameter for a near edge `offset` metres from the wall's start. */
export const openingTFor = (wall: Wall, o: Opening, offset: number): number => (offset + o.width / 2) / wallLength(wall);

// ---------------------------------------------------------------------------- rooms and items

export const roomArea = (r: Room): number => r.w * r.h;

/** The smallest room the point lies in, if any. */
export function roomAt(model: Pick<PlanModel, "rooms">, x: number, y: number): Room | undefined {
  return model.rooms
    .filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    .sort((a, b) => roomArea(a) - roomArea(b))[0];
}

export function itemName(model: Pick<PlanModel, "kinds">, item: Item): string {
  return catalogOf(model).get(item.kind)?.label ?? "Unknown piece";
}

// ---------------------------------------------------------------------------- any entity

/** The entity with this id, named, or null when the plan has nothing by that id. */
export function entityById(model: PlanModel, id: string): EntityRef | null {
  const wall = model.walls.find((w) => w.id === id);
  if (wall) return { type: "wall", id, name: wallName(model, wall) };
  const opening = model.openings.find((o) => o.id === id);
  if (opening) return { type: opening.kind, id, name: openingName(model, opening) };
  const room = model.rooms.find((r) => r.id === id);
  if (room) return { type: "room", id, name: room.label };
  const item = model.items.find((i) => i.id === id);
  if (item) return { type: "item", id, name: itemName(model, item) };
  return null;
}

/**
 * Select an entity on the plan, so the drawing marks it and Properties edits it. A door or a
 * window is edited from its wall, so selecting one selects the wall it is in.
 */
export function selectEntity(model: PlanModel, ref: Pick<EntityRef, "type" | "id">): void {
  switch (ref.type) {
    case "wall":
      pageActions.selectWall(ref.id);
      return;
    case "door":
    case "window": {
      const o = model.openings.find((x) => x.id === ref.id);
      if (o && model.walls.some((w) => w.id === o.wallId)) pageActions.selectWall(o.wallId);
      return;
    }
    case "room":
      pageActions.selectRoom(ref.id);
      return;
    case "item":
      pageActions.selectItem(ref.id);
      return;
  }
}

/**
 * Asked of whatever draws the plan when a panel locates an entity: bring it into view. The
 * payload is an EntityRef; the plan's view listens (src/editor/canvasState.ts).
 */
export const FOCUS_ENTITY_EVENT = EVENTS.FOCUS_ENTITY;

// ---------------------------------------------------------------------------- words

/** "a", "a and b", "a, b, and c" (or with "or"); the serial comma keeps "door or window" whole. */
export function listOf(words: readonly string[], conjunction: "and" | "or"): string {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return `${words[0]} ${conjunction} ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, ${conjunction} ${words[words.length - 1]}`;
}

/** The sentence's first letter in capitals. */
export const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
