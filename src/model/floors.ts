/**
 * What the floors between storeys cover, on the plan: a level's slab is under its rooms and
 * its walls (each wall to its joints, so the corners are closed), less the stairwell of every
 * stair that climbs to it from below. The 3D view builds its slabs from these outlines
 * (src/three/slabs.ts) and the IFC export writes its floor slabs from the same ones
 * (src/export/ifc), so the model a CAD tool reads has the floor the view shows, with no gap
 * under a wall at any floor line.
 *
 * Its own module, beside joints.ts and region.ts, because only lazily loaded builders read it.
 */

import type { PlanModel } from "./types";
import { rectCorners, wallAsRect } from "./geometry";
import { stairwellsOf } from "./levels";
import { jointExtensions } from "./joints";
import type { Poly } from "./region";

/** The openings the stairs from the level below need in level `levelId`'s floor. */
export function stairwellPolys(model: PlanModel, levelId: string): Poly[] {
  return stairwellsOf(model, levelId).flatMap((w) => w.geometry.footprint.map(rectCorners));
}

/**
 * What a level's slab covers: its rooms, and its walls to their joints. `slice` is the level's
 * slice (levels.ts levelSlice).
 */
export function slabOutline(slice: Pick<PlanModel, "rooms" | "walls">): Poly[] {
  const rooms = slice.rooms.map((r): Poly => [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]);
  const walls = slice.walls.flatMap((w): Poly[] => {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    if (len === 0) return [];
    const [extA, extB] = jointExtensions(w, slice.walls);
    const ux = (w.bx - w.ax) / len;
    const uy = (w.by - w.ay) / len;
    return [rectCorners(wallAsRect(w.ax - ux * extA, w.ay - uy * extA, w.bx + ux * extB, w.by + uy * extB, w.thickness))];
  });
  return [...rooms, ...walls];
}
