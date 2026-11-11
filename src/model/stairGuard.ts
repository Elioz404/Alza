/**
 * Where a stair's stairwell needs a guard, worked out from its geometry (stairs.ts).
 *
 * On the floor above, the stairwell is a hole: every stretch of its rim is a drop, except the
 * edge the stair arrives across, which is the way onto that floor. That rim, less the arrival
 * edge, is what the 3D model stands a balustrade along and the upper plan draws a guard line
 * inside. Only those views read it, and both load after the first paint, so it lives here
 * rather than in the geometry the checker works out for every stair.
 *
 * Pure, and kept per geometry object: geometries are immutable and shared (stairGeometry).
 */

import { pointInORect, rectCorners, type ORect, type Pt } from "./geometry";
import type { StairGeometry } from "./stairs";

/**
 * One stretch of the stairwell's rim that needs a guard: from `a` to `b`, with `out` the unit
 * normal pointing away from the void, onto the floor.
 */
export interface StairGuardEdge {
  readonly a: Pt;
  readonly b: Pt;
  readonly out: Pt;
}

/** How far past an edge a point is probed to tell the void's rim from an edge inside it, metres. */
const RIM_PROBE = 1e-4;

const cache = new WeakMap<StairGeometry, readonly StairGuardEdge[]>();

/**
 * The stairwell's rim less the edge the top riser arrives across. The footprint's rectangles
 * meet edge to edge (a flight's end is exactly the landing's side), so an edge another of them
 * carries on past is inside the void, and every other edge is its rim.
 */
export function stairGuard(geometry: StairGeometry): readonly StairGuardEdge[] {
  const hit = cache.get(geometry);
  if (hit) return hit;
  const { footprint, end: arrival } = geometry;
  const edges: StairGuardEdge[] = [];
  for (const rect of footprint) edges.push(...rimEdgesOf(rect, footprint, arrival));
  const frozen = Object.freeze(edges);
  cache.set(geometry, frozen);
  return frozen;
}

function rimEdgesOf(rect: ORect, footprint: readonly ORect[], arrival: Pt): StairGuardEdge[] {
  const corners = rectCorners(rect);
  const edges: StairGuardEdge[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    if ((mid.x - rect.cx) * out.x + (mid.y - rect.cy) * out.y < 0) out = { x: -out.x, y: -out.y };
    const past = { x: mid.x + out.x * RIM_PROBE, y: mid.y + out.y * RIM_PROBE };
    if (footprint.some((r) => r !== rect && pointInORect(past, r))) return;
    // the edge the stair arrives across is open: it is the way onto the floor
    if (Math.hypot(mid.x - arrival.x, mid.y - arrival.y) < RIM_PROBE) return;
    edges.push(Object.freeze({ a, b, out }));
  });
  return edges;
}
