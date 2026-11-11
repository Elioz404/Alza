/**
 * A stair's shape, worked out from the little the plan stores about it.
 *
 * The plan keeps where a stair starts, which way it climbs, how wide it is and (optionally) a
 * set number of risers or a set going. Everything else — how many risers, how tall each is,
 * how deep each tread is, where every tread, flight and landing sits, the line someone walks
 * up, the floor that must stay clear at each end, the stairwell it opens in the floor above —
 * follows from that and from the height it climbs, here, once. The 2D symbol, the 3D model,
 * the walk camera and the checker all read this one answer, so they cannot disagree.
 *
 * Plan coordinates: metres, y grows down the sheet. Heights are metres above the floor of the
 * level the stair stands on.
 */

import type { Stair } from "./types";
import { boxOf, pointInORect, rectCorners, type Box, type ORect, type Pt } from "./geometry";
import { SLAB_THICKNESS, STAIR, STAIR_DEFAULTS } from "./limits";

/** One tread: its footprint on the plan and the height of its top. */
export interface StairStep {
  /** 0 for the lowest tread, in climbing order across both flights */
  readonly index: number;
  /** 0 for the first flight, 1 for an L-shaped stair's second */
  readonly flight: 0 | 1;
  /** the tread's footprint; its local depth axis (hd) points the way the flight climbs */
  readonly rect: ORect;
  /** height of the tread's top above the stair's floor */
  readonly top: number;
}

export interface StairLanding {
  readonly rect: ORect;
  readonly top: number;
}

export interface StairGeometry {
  /** the height it climbs: the floor-to-floor height of its level */
  readonly rise: number;
  readonly risers: number;
  /** height of one riser */
  readonly riserHeight: number;
  /** going: depth of one tread */
  readonly going: number;
  /** 2 × riser + going, the comfort rule's measure */
  readonly stepRule: number;
  /** every tread, in climbing order (an L-shaped stair's landing is not one of them) */
  readonly steps: readonly StairStep[];
  /** an L-shaped stair's landing; null for a straight one */
  readonly landing: StairLanding | null;
  /** each flight's footprint, from its first riser to its last */
  readonly flights: readonly ORect[];
  /**
   * The stair's whole footprint: its flights and its landing. Furniture and walls must keep out
   * of it on the stair's own level, and it is the stairwell the floor above is opened over.
   */
  readonly footprint: readonly ORect[];
  /** centre of the bottom riser, and the direction the first flight climbs (unit vector) */
  readonly start: Pt;
  readonly startDir: Pt;
  /** centre of the top riser, where the stair meets the floor above, and the last flight's direction */
  readonly end: Pt;
  readonly endDir: Pt;
  /** the walking line, from the bottom riser to the top one (through the landing's middle) */
  readonly walkLine: readonly Pt[];
  /** the floor that must stay clear in front of the bottom riser (on the stair's level) */
  readonly bottomExit: ORect;
  /** the floor that must stay clear past the top riser (on the level above) */
  readonly topExit: ORect;
  /** clear height above the first tread to the underside of the slab above, at the stairwell's edge */
  readonly headroom: number;
  /** bounds of the footprint */
  readonly box: Box;
}

const DEG = Math.PI / 180;

/** The unit vector a stair rotated `deg` climbs along: 0 = +y, 90 = +x (place_item's convention). */
export const climbDirection = (deg: number): Pt => ({ x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) });

/** A rectangle `width` across and `depth` along `deg`'s direction, centred on `c`. */
const rectAlong = (c: Pt, deg: number, width: number, depth: number): ORect => ({
  cx: c.x,
  cy: c.y,
  hw: width / 2,
  hd: depth / 2,
  // the rectangle's local depth axis is (-sin rot, cos rot): equal to the climb direction
  rot: -deg * DEG,
});

const along = (p: Pt, d: Pt, by: number): Pt => ({ x: p.x + d.x * by, y: p.y + d.y * by });

/** The risers a stair climbing `rise` has: the ones set on it, or the fewest that keep each under the maximum. */
export const stairRisers = (stair: Pick<Stair, "risers">, rise: number): number =>
  stair.risers ?? Math.max(STAIR.risers.min, Math.ceil(rise / STAIR.riser.max - 1e-9));

/** The going a stair with risers of `riserHeight` has: the one set on it, or the step rule's, held to the range. */
export function stairGoing(stair: Pick<Stair, "tread">, riserHeight: number): number {
  if (stair.tread !== undefined) return stair.tread;
  const ideal = STAIR.stepRule.target - 2 * riserHeight;
  return Math.min(STAIR.tread.max, Math.max(STAIR.tread.min, ideal));
}

/** Risers in an L-shaped stair's first flight: the split set on it, or half, always leaving one for each flight. */
export const stairSplit = (stair: Pick<Stair, "split">, risers: number): number =>
  Math.min(risers - 1, Math.max(1, stair.split ?? Math.floor(risers / 2)));

const cache = new WeakMap<Stair, Map<number, StairGeometry>>();

/**
 * The stair's geometry when it climbs `rise` metres. Stairs are immutable, so the answer is
 * kept per stair object and height: the 2D, the 3D and the checker share one.
 */
export function stairGeometry(stair: Stair, rise: number): StairGeometry {
  let byRise = cache.get(stair);
  const hit = byRise?.get(rise);
  if (hit) return hit;
  const geometry = computeGeometry(stair, rise);
  if (!byRise) cache.set(stair, (byRise = new Map()));
  byRise.set(rise, geometry);
  return geometry;
}

function computeGeometry(stair: Stair, rise: number): StairGeometry {
  const risers = stairRisers(stair, rise);
  const riserHeight = rise / risers;
  const going = stairGoing(stair, riserHeight);
  const w = stair.width;
  const start: Pt = { x: stair.x, y: stair.y };
  const deg1 = stair.rotation;
  const d1 = climbDirection(deg1);

  const steps: StairStep[] = [];
  const flights: ORect[] = [];
  /** lay `count` treads from `from` along `deg`, the first at height index `base` + 1 */
  const flight = (from: Pt, deg: number, count: number, base: number, which: 0 | 1): Pt => {
    const d = climbDirection(deg);
    for (let k = 0; k < count; k++) {
      steps.push({ index: steps.length, flight: which, rect: rectAlong(along(from, d, going * (k + 0.5)), deg, w, going), top: (base + k + 1) * riserHeight });
    }
    const run = count * going;
    if (run > 0) flights.push(rectAlong(along(from, d, run / 2), deg, w, run));
    return along(from, d, run);
  };

  let landing: StairLanding | null = null;
  let end: Pt;
  let deg2 = deg1;
  const walkLine: Pt[] = [start];
  if (stair.shape === "l") {
    const first = stairSplit(stair, risers);
    // the first flight's last riser lands on the landing, so it has one tread fewer than risers
    const top1 = flight(start, deg1, first - 1, 0, 0);
    const centre = along(top1, d1, w / 2);
    landing = { rect: rectAlong(centre, deg1, w, w), top: first * riserHeight };
    deg2 = deg1 + ((stair.turn ?? STAIR_DEFAULTS.turn) === "left" ? 90 : -90);
    const from2 = along(centre, climbDirection(deg2), w / 2);
    walkLine.push(centre);
    end = flight(from2, deg2, risers - first - 1, first, 1);
  } else {
    end = flight(start, deg1, risers - 1, 0, 0);
  }
  walkLine.push(end);
  const endDir = climbDirection(deg2);
  const footprint = landing ? [...flights, landing.rect] : [...flights];
  const exit = STAIR.exitDepth;
  return Object.freeze({
    rise,
    risers,
    riserHeight,
    going,
    stepRule: 2 * riserHeight + going,
    steps: Object.freeze(steps),
    landing,
    flights: Object.freeze(flights),
    footprint: Object.freeze(footprint),
    start,
    startDir: d1,
    end,
    endDir,
    walkLine: Object.freeze(walkLine),
    bottomExit: rectAlong(along(start, d1, -exit / 2), deg1, w, exit),
    topExit: rectAlong(along(end, endDir, exit / 2), deg2, w, exit),
    headroom: rise - SLAB_THICKNESS - riserHeight,
    box: boxOf(footprint.flatMap(rectCorners)),
  });
}

/**
 * The height of the stair's surface under `p`: the top of the tread or landing it stands on,
 * or null when `p` is not over the stair. What the walk camera climbs by.
 */
export function stairHeightAt(geometry: StairGeometry, p: Pt): number | null {
  if (p.x < geometry.box.minX || p.x > geometry.box.maxX || p.y < geometry.box.minY || p.y > geometry.box.maxY) return null;
  let best: number | null = null;
  for (const s of geometry.steps) if (pointInORect(p, s.rect) && (best === null || s.top > best)) best = s.top;
  if (geometry.landing && pointInORect(p, geometry.landing.rect) && (best === null || geometry.landing.top > best)) best = geometry.landing.top;
  return best;
}
