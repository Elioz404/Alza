/**
 * How the page names and measures the things on a plan, for the panels that show them to the
 * person: "Wall 3", "Door 1", "Sofa", "between Bedroom and Bathroom", "1.20 m from the start".
 * Ids stay what the tools and the model use; a person reads names. Pure functions over the
 * plan, shared by the inspector and the issues list so both call a thing by the same name.
 */

import { outlineDistance, pointInOutline, roomArea, wallLength as alongWall, wallPointAt } from "../../model/shapes";
import { catalogOf } from "../../model/catalog";
import { activeLevelId, pageActions, store } from "../../model/store";
import { EVENTS } from "../../model/sceneBus";
import { levelIdOf } from "../../model/levels";
import type { Item, Opening, PlanModel, Room, Stair, Wall } from "../../model/types";

export type EntityType = "wall" | "door" | "window" | "room" | "item" | "stair";

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

/** A wall's length along it: a curved wall's arc, what its openings are placed and sized along. */
export const wallLength = (w: Wall): number => alongWall(w);

/** The straight distance between a wall's ends: its length when it is straight, its chord when it is curved. */
export const wallChord = (w: Wall): number => Math.hypot(w.bx - w.ax, w.by - w.ay);

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
const distanceToOutline = (r: Room, x: number, y: number): number => outlineDistance({ x, y }, r.points);

/**
 * The rooms of the wall's own level whose outline it runs along, by its middle (along its arc, on
 * a curved wall), named in plan order: a room straight above or below on another storey is not
 * along it.
 */
export function roomsAlong(model: Pick<PlanModel, "rooms">, w: Wall): Room[] {
  const { x: mx, y: my } = wallPointAt(w, 0.5);
  // half the wall's thickness either side of the outline, plus a hand's width of drawing slack
  const reach = w.thickness / 2 + w.thickness;
  return model.rooms.filter((r) => r.levelId === w.levelId && distanceToOutline(r, mx, my) <= reach);
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

export { roomArea };

/** The smallest room the point lies in (or on the edge of), if any. */
export function roomAt(model: Pick<PlanModel, "rooms">, x: number, y: number): Room | undefined {
  return model.rooms
    .filter((r) => pointInOutline({ x, y }, r.points) || outlineDistance({ x, y }, r.points) < 1e-9)
    .sort((a, b) => roomArea(a) - roomArea(b))[0];
}

export function itemName(model: Pick<PlanModel, "kinds">, item: Item): string {
  return catalogOf(model).get(item.kind)?.label ?? "Unknown piece";
}

// ---------------------------------------------------------------------------- stairs and levels

export const stairName = (model: Pick<PlanModel, "stairs">, s: Stair): string => `Stair ${model.stairs.indexOf(s) + 1}`;

/** "Straight stair", "L-shaped stair": what kind of stair it is, in words. */
export const stairKind = (s: Pick<Stair, "shape">): string => (s.shape === "l" ? "L-shaped stair" : "Straight stair");

/** A height above the ground floor as a section marks it: "+2.90 m", "±0.00 m". */
export const elevation = (m: number): string => (Math.abs(m) < 0.005 ? "±0.00 m" : `${m > 0 ? "+" : "−"}${Math.abs(m).toFixed(2)} m`);

/** The name of the level an entity stands on, for a plan with more than one; null for a one-storey plan. */
export function levelNameOf(model: PlanModel, id: string): string | null {
  if (model.levels.length < 2) return null;
  const levelId = levelIdOf(model, id);
  return model.levels.find((l) => l.id === levelId)?.name ?? null;
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
  const stair = model.stairs.find((x) => x.id === id);
  if (stair) return { type: "stair", id, name: stairName(model, stair) };
  return null;
}

/**
 * Select an entity on the plan, so the drawing marks it and Properties edits it. A door or a
 * window is edited from its wall, so selecting one selects the wall it is in. An entity on
 * another level brings that level up first: the plan shows one level at a time (and a level
 * itself is selected by working on it).
 */
export function selectEntity(model: PlanModel, ref: { type: EntityType | "level"; id: string }): void {
  const levelId = levelIdOf(model, ref.id);
  if (levelId && levelId !== activeLevelId(store.getState())) pageActions.setActiveLevel(levelId);
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
    case "stair":
      pageActions.selectStair(ref.id);
      return;
    case "level":
      // naming a level is going to it: done above
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
