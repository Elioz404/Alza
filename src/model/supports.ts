/**
 * What carries the floor of a level above: the walls and columns of the level below it that reach
 * the underside of its slab.
 *
 * A sanity check, not engineering: a slab spans at most SUPPORT.span metres between its supports,
 * so a point of an upper floor further than half of that from every wall and column under it is
 * unsupported. The floor is sampled on a grid of SUPPORT.sample metres (coarser on a floor too
 * large for SUPPORT.maxSamples of them); the unsupported samples, joined to their neighbours, are
 * the zones the checker reports (slab_unsupported) and the plan can shade. The floor sampled is
 * the level's rooms (its floor area), less the stairwells cut in it.
 *
 * Each sample only measures the supports near it (a bucket grid of their bounds, grown by the
 * span's half), so the work grows with the floor, not with the floor times the plan; and a floor's
 * zones are kept by what they depend on (its rooms, its stairwells, the supports under it), so an
 * edit elsewhere on the plan costs no sampling.
 *
 * In the first load with the checker, so kept to the plan's own geometry (shapes.ts, region.ts):
 * the mitred slab outline the 3D view and the IFC export build is in floors.ts, fetched with them.
 */

import type { Column, PlanModel, Room, Wall } from "./types";
import { SUPPORT } from "./limits";
import { boxOf, rectCorners, type Box, type Pt } from "./geometry";
import { closestOnEdge, edgeBox, pointInOutline, tessellateOutline, wallEdge } from "./shapes";
import { inRegion, type Poly } from "./region";
import { levelBelow, levelInfo, reachesSlab, stairwellsOf } from "./levels";
import { columnBox, columnDistance, columnHeight, columnsOn } from "./columns";

/** What stands under a level's floor and carries it: the walls and columns of the level below that reach its slab. */
export interface Supports {
  readonly walls: readonly Wall[];
  readonly columns: readonly Column[];
}

/**
 * The supports under level `levelId`'s floor: the walls and columns of the level below that reach
 * the underside of the slab over it (levels.ts reachesSlab; a low partition or a stub of a column
 * carries nothing). None for the ground level, which stands on the ground.
 */
export function supportsUnder(model: PlanModel, levelId: string): Supports | null {
  const below = levelBelow(model, levelId);
  if (!below) return null;
  const h = below.level.height;
  return {
    walls: model.walls.filter((w) => w.levelId === below.level.id && reachesSlab(w.height, h)),
    columns: columnsOn(model, below.level.id).filter((c) => reachesSlab(columnHeight(model, c) ?? 0, h)),
  };
}

/** One support as the sampling sees it: its bounds, and how far a point is from its face. */
interface Carrier {
  readonly box: Box;
  readonly reach: (p: Pt) => number;
}

const carriersOf = (supports: Supports): Carrier[] => [
  ...supports.walls.map((w): Carrier => {
    const edge = wallEdge(w);
    const b = edgeBox(edge);
    const t = w.thickness / 2;
    return { box: { minX: b.minX - t, minY: b.minY - t, maxX: b.maxX + t, maxY: b.maxY + t }, reach: (p) => Math.max(closestOnEdge(edge, p).distance - t, 0) };
  }),
  ...supports.columns.map((c): Carrier => ({ box: columnBox(c), reach: (p) => columnDistance(p, c) })),
];

const nearest = (p: Pt, carriers: readonly Carrier[]): number => {
  let best = Infinity;
  for (const c of carriers) best = Math.min(best, c.reach(p));
  return best;
};

/** How far `p` is from the nearest support's face (0 on or in one); Infinity when there is none. */
export function supportReach(p: Pt, supports: Supports): number {
  return nearest(p, carriersOf(supports));
}

/**
 * The supports near each square of side `size`: every one whose bounds, grown by `size`, touch
 * it. A point's own square then holds every support within `size` of it.
 */
function bucketGrid(carriers: readonly Carrier[], size: number): (p: Pt) => readonly Carrier[] {
  const buckets = new Map<string, Carrier[]>();
  const index = (v: number) => Math.floor(v / size);
  for (const c of carriers) {
    for (let i = index(c.box.minX - size); i <= index(c.box.maxX + size); i++) {
      for (let j = index(c.box.minY - size); j <= index(c.box.maxY + size); j++) {
        const key = `${i},${j}`;
        const list = buckets.get(key);
        if (list) list.push(c);
        else buckets.set(key, [c]);
      }
    }
  }
  return (p) => buckets.get(`${index(p.x)},${index(p.y)}`) ?? [];
}

/**
 * The step a floor whose rooms' bounds are `box` is sampled at: SUPPORT.sample, or coarser on a
 * floor so large that would take more than SUPPORT.maxSamples samples; and how many each way.
 */
export function sampleGrid(box: Box): { step: number; nx: number; ny: number } {
  const w = Math.max(box.maxX - box.minX, 0);
  const h = Math.max(box.maxY - box.minY, 0);
  let step = Math.max(SUPPORT.sample, Math.sqrt((w * h) / SUPPORT.maxSamples));
  const count = (s: number) => ({ nx: Math.max(1, Math.ceil(w / s)), ny: Math.max(1, Math.ceil(h / s)) });
  // ceil can add a row and a column each way; grow the step until they fit
  while (count(step).nx * count(step).ny > SUPPORT.maxSamples) step *= 1.01;
  return { step, ...count(step) };
}

/** A stretch of an upper floor with nothing under it near enough. */
export interface UnsupportedZone {
  /** the sample cells it is made of, each sampleGrid's step square */
  readonly cells: readonly Box[];
  /** its area, square metres, and bounds */
  readonly area: number;
  readonly box: Box;
  /** the middle of its cells */
  readonly centre: Pt;
  /**
   * how far its furthest sample stands from a support, metres (Infinity with nothing under the
   * floor at all); measured at up to SUPPORT.reachSamples of its samples, spread over it
   */
  readonly reach: number;
  /** the rooms of the level whose floor it is in */
  readonly rooms: readonly string[];
}

/** The zones of the last floors checked, by what they depend on (zoneKey), the newest last. */
const zonesMemo = new Map<string, readonly UnsupportedZone[]>();
/** The zones of each plan object, by level: a plan asked twice costs nothing. */
const zonesCache = new WeakMap<PlanModel, Map<string, readonly UnsupportedZone[]>>();

/**
 * The stretches of level `levelId`'s floor (its rooms, less the stairwells in it) that stand
 * further than SUPPORT.span / 2 from every wall and column of the level below that reaches its
 * slab, each at least SUPPORT.minArea. None on the ground level.
 */
export function unsupportedZones(model: PlanModel, levelId: string): readonly UnsupportedZone[] {
  let byLevel = zonesCache.get(model);
  const hit = byLevel?.get(levelId);
  if (hit) return hit;
  const zones = zonesOf(model, levelId);
  if (!byLevel) zonesCache.set(model, (byLevel = new Map()));
  byLevel.set(levelId, zones);
  return zones;
}

function zonesOf(model: PlanModel, levelId: string): readonly UnsupportedZone[] {
  const supports = supportsUnder(model, levelId);
  if (!supports || !levelInfo(model, levelId)) return NO_ZONES;
  const rooms = model.rooms.filter((r) => r.levelId === levelId);
  if (rooms.length === 0) return NO_ZONES;
  const wells: Poly[] = stairwellsOf(model, levelId).flatMap((w) => w.geometry.footprint.map(rectCorners));
  // everything the zones are made from, and nothing else: moving a chair, or a wall upstairs, keeps them
  const key = JSON.stringify([rooms.map((r) => [r.id, r.points]), wells, supports.walls.map((w) => [w.ax, w.ay, w.bx, w.by, w.bulge, w.thickness]), supports.columns.map((c) => [c.shape, c.x, c.y, c.w, c.d, c.rotation])]);
  const known = zonesMemo.get(key);
  if (known) {
    // the newest last, so the oldest goes first
    zonesMemo.delete(key);
    zonesMemo.set(key, known);
    return known;
  }
  const zones = Object.freeze(findZones(rooms, wells, supports));
  zonesMemo.set(key, zones);
  if (zonesMemo.size > SUPPORT.memo) zonesMemo.delete(zonesMemo.keys().next().value!);
  return zones;
}

const NO_ZONES: readonly UnsupportedZone[] = Object.freeze([]);

function findZones(rooms: readonly Room[], wells: readonly Poly[], supports: Supports): UnsupportedZone[] {
  const floors: { room: Room; poly: Poly; box: Box }[] = rooms.map((room) => {
    const poly = tessellateOutline(room.points);
    return { room, poly, box: boxOf(poly) };
  });
  const all = boxOf(floors.flatMap((f) => [{ x: f.box.minX, y: f.box.minY }, { x: f.box.maxX, y: f.box.maxY }]));
  const { step, nx, ny } = sampleGrid(all);
  const limit = SUPPORT.span / 2;
  const carriers = carriersOf(supports);
  const near = bucketGrid(carriers, limit);
  const at = (i: number, j: number): Pt => ({ x: all.minX + (i + 0.5) * step, y: all.minY + (j + 0.5) * step });
  /** the unsupported cells, by "i,j", and the room each is in */
  const lost = new Map<string, { i: number; j: number; room: string }>();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = at(i, j);
      const on = floors.find((f) => p.x >= f.box.minX && p.x <= f.box.maxX && p.y >= f.box.minY && p.y <= f.box.maxY && pointInOutline(p, f.room.points));
      if (!on || (wells.length > 0 && !inRegion(p, [on.poly], wells))) continue;
      // every support within the limit of p is among those near it
      if (!near(p).some((c) => c.reach(p) <= limit)) lost.set(`${i},${j}`, { i, j, room: on.room.id });
    }
  }
  const zones: UnsupportedZone[] = [];
  const seen = new Set<string>();
  for (const [key, start] of lost) {
    if (seen.has(key)) continue;
    // one zone: every unsupported cell reached from this one through a shared side
    const group = [start];
    seen.add(key);
    for (let k = 0; k < group.length; k++) {
      const { i, j } = group[k];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = `${i + di},${j + dj}`;
        const cell = lost.get(next);
        if (cell && !seen.has(next)) {
          seen.add(next);
          group.push(cell);
        }
      }
    }
    const area = group.length * step * step;
    if (area < SUPPORT.minArea) continue;
    const cells = group.map(({ i, j }): Box => ({ minX: all.minX + i * step, minY: all.minY + j * step, maxX: all.minX + (i + 1) * step, maxY: all.minY + (j + 1) * step }));
    const box = boxOf(cells.flatMap((c) => [{ x: c.minX, y: c.minY }, { x: c.maxX, y: c.maxY }]));
    const centre = { x: cells.reduce((s, c) => s + (c.minX + c.maxX) / 2, 0) / cells.length, y: cells.reduce((s, c) => s + (c.minY + c.maxY) / 2, 0) / cells.length };
    // its furthest sample, folded as it goes (a spread of every sample would overflow the stack)
    const every = Math.max(1, Math.ceil(group.length / SUPPORT.reachSamples));
    let reach = 0;
    for (let k = 0; k < group.length; k += every) reach = Math.max(reach, nearest(at(group[k].i, group[k].j), carriers));
    zones.push({ cells, area, box, centre, reach, rooms: [...new Set(group.map((g) => g.room))] });
  }
  return zones;
}
