/*
 * Walk collision. Walk mode used to be a free-flying point: it passed through walls, stood
 * inside the fridge, and left the building entirely. Here the camera is a disc of
 * WALK.personRadius that cannot enter a wall or a piece of furniture.
 *
 * Walls are solid except across a door's clear span, and only while that leaf is actually
 * open — a window is never walkable, since the wall under its sill is solid at hip height.
 * Rugs and anything ankle-low are ignored so you can walk over them. Blocked moves are retried
 * on each axis alone, which slides the camera along a wall instead of gluing it there.
 *
 * Plain numbers in, plain numbers out: the blockers are derived from the plan once per change,
 * and a step allocates nothing, because it runs every frame a key is held.
 *
 * Which keys are held is kept here too (WalkKeys), so what counts as a walk key — and when a
 * key belongs to a text field instead — is decided in one place.
 */

import type { Opening, PlanModel } from "../model/types";
import { catalogOf } from "../model/catalog";
import { openingsByWall } from "./build";
import { DOORS, WALK, WALK_ENTRY } from "./config";
import { isInsideOverlay, isTypingTarget } from "../ui/keys";

interface WallBlocker {
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  len: number;
  half: number;
  /** door spans along the wall, in metres from its A end */
  gaps: { s: number; e: number; id: string }[];
}

interface ItemBlocker {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  cos: number;
  sin: number;
}

export interface Blockers {
  readonly walls: readonly WallBlocker[];
  readonly items: readonly ItemBlocker[];
}

/**
 * The plan's walls and furniture as the walker meets them. `byWall` is the plan's openings
 * grouped by wall (build.ts): a caller that has already grouped them passes its map in, so a
 * wall's doors are a lookup rather than a scan of every opening.
 */
export function blockersFor(model: PlanModel, byWall: ReadonlyMap<string, readonly Opening[]> = openingsByWall(model)): Blockers {
  const catalog = catalogOf(model);
  const walls = model.walls.map((w): WallBlocker => {
    const dx = w.bx - w.ax;
    const dy = w.by - w.ay;
    const len = Math.hypot(dx, dy) || 1;
    return {
      ax: w.ax,
      ay: w.ay,
      ux: dx / len,
      uy: dy / len,
      len,
      half: w.thickness / 2,
      gaps: (byWall.get(w.id) ?? [])
        .filter((o) => o.kind === "door")
        .map((o) => ({ s: o.t * len - o.width / 2, e: o.t * len + o.width / 2, id: o.id })),
    };
  });
  const items = model.items.flatMap((it): ItemBlocker[] => {
    const c = catalog.get(it.kind);
    if (!c || c.isRug || c.h < WALK.stepOver) return [];
    const th = (it.rotation * Math.PI) / 180;
    return [{ cx: it.x, cy: it.y, hw: c.w / 2, hh: c.d / 2, cos: Math.cos(th), sin: Math.sin(th) }];
  });
  return { walls, items };
}

/** Would a walker standing at (x, z) be inside something? `openness` says how far each door is open, 0..1. */
export function blocked(b: Blockers, x: number, z: number, openness: (doorId: string) => number): boolean {
  const r = WALK.personRadius;
  for (const w of b.walls) {
    const px = x - w.ax;
    const pz = z - w.ay;
    const along = px * w.ux + pz * w.uy;
    const perp = Math.abs(px * -w.uy + pz * w.ux);
    if (perp > w.half + r) continue;
    if (along < -r || along > w.len + r) continue;
    // inside the wall band — unless this is an open doorway
    const gap = w.gaps.find((g) => along > g.s + r * 0.5 && along < g.e - r * 0.5);
    if (gap && openness(gap.id) > DOORS.walkableOpen) continue;
    return true;
  }
  for (const it of b.items) {
    const dx = x - it.cx;
    const dz = z - it.cy;
    const lx = dx * it.cos - dz * it.sin;
    const lz = dx * it.sin + dz * it.cos;
    if (Math.abs(lx) < it.hw + r && Math.abs(lz) < it.hh + r) return true;
  }
  return false;
}

/**
 * Where a walker at (x, z) trying to move by (dx, dz) actually goes: the full move if it is
 * free, else whichever single axis is, else nowhere. Written into `out` as [dx, dz].
 */
export function slide(
  b: Blockers,
  x: number,
  z: number,
  dx: number,
  dz: number,
  openness: (doorId: string) => number,
  out: [number, number],
): [number, number] {
  if (!blocked(b, x + dx, z + dz, openness)) {
    out[0] = dx;
    out[1] = dz;
  } else if (!blocked(b, x + dx, z, openness)) {
    out[0] = dx;
    out[1] = 0;
  } else if (!blocked(b, x, z + dz, openness)) {
    out[0] = 0;
    out[1] = dz;
  } else {
    out[0] = 0;
    out[1] = 0; // cornered
  }
  return out;
}

/** Where a walker is set down, in plan metres, and the way it faces (a unit vector on the plan). */
export interface WalkSpot {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/**
 * Where Walk puts the walker: inside the plan's largest room, toward one end of its longer
 * side (WALK_ENTRY.back of the way from the centre), facing into the room through its centre,
 * on a spot where nothing stands — preferably one at least WALK_ENTRY.pendantClear from the
 * centre, where the room's pendant hangs, so the first view is not of a lampshade at the top of
 * the frame. Null for a plan without rooms, or one whose rooms are full.
 */
export function walkEntry(model: PlanModel, b: Blockers, openness: (doorId: string) => number): WalkSpot | null {
  const room = model.rooms.reduce<PlanModel["rooms"][number] | null>((best, r) => (!best || r.w * r.h > best.w * best.h ? r : best), null);
  if (!room) return null;
  const cx = room.x + room.w / 2;
  const cz = room.y + room.h / 2;
  // stand toward the south end of a deep room, the east end of a wide one, and look across it
  const deep = room.h >= room.w;
  const ax = deep ? 0 : 1;
  const az = deep ? 1 : 0;
  const reach = ((deep ? room.h : room.w) / 2) * WALK_ENTRY.back;
  const side = deep ? room.w / 2 : room.h / 2;
  // first clear of the pendant if the room allows it, then anywhere free
  for (const clear of [WALK_ENTRY.pendantClear, 0]) {
    for (let i = 0; i <= WALK_ENTRY.tries; i++) {
      const back = reach * (1 - i / (WALK_ENTRY.tries + 1));
      for (const lateral of [0, 1, -1, 2, -2]) {
        const offset = lateral * WALK_ENTRY.sideStep;
        if (Math.abs(offset) > side - WALK.personRadius) continue;
        if (Math.hypot(back, offset) < clear) continue;
        const x = cx + ax * back + az * offset;
        const z = cz + az * back + ax * offset;
        if (blocked(b, x, z, openness)) continue;
        return { x, z, dirX: -ax || 0, dirZ: -az || 0 };
      }
    }
  }
  return null;
}

/** Keys that walk, by what KeyboardEvent.key reports (letters lower-cased, so Shift and Caps Lock walk too). */
export const WALK_KEYS = Object.freeze({
  forward: Object.freeze(["w", "ArrowUp"]),
  back: Object.freeze(["s", "ArrowDown"]),
  left: Object.freeze(["a", "ArrowLeft"]),
  right: Object.freeze(["d", "ArrowRight"]),
});
export type WalkDirection = keyof typeof WALK_KEYS;
const WALK_KEY_SET: ReadonlySet<string> = new Set(Object.values(WALK_KEYS).flat());

/**
 * The walk keys being held. The listener is on the window, so it hears every key on the page:
 * a key is taken for walking — and kept from the page — only while the walker is walking and
 * the key was not typed into a field. A key let go is forgotten whatever the mode or the
 * target, so a key pressed while walking never stays stuck down after a switch or a click
 * into a field.
 */
export class WalkKeys {
  private readonly keys = new Set<string>();

  /** A keydown. True when it was taken as a walk key (the caller has a frame to draw). */
  down(e: KeyboardEvent, walking: boolean): boolean {
    if (!walking || isTypingTarget(e.target) || isInsideOverlay(e.target)) return false;
    const key = walkKeyOf(e);
    if (!key) return false;
    this.keys.add(key);
    e.preventDefault();
    return true;
  }

  up(e: KeyboardEvent): void {
    const key = walkKeyOf(e);
    if (key) this.keys.delete(key);
  }

  /** A key released while the window is not focused never sends its keyup: forget them all. */
  clear(): void {
    this.keys.clear();
  }

  get any(): boolean {
    return this.keys.size > 0;
  }

  held(direction: WalkDirection): boolean {
    return WALK_KEYS[direction].some((k) => this.keys.has(k));
  }
}

function walkKeyOf(e: KeyboardEvent): string | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return WALK_KEY_SET.has(key) ? key : null;
}
