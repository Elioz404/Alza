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
import { rectCorners } from "./geometry";
import { levelBelow, levelSlice, stairwellsOf } from "./levels";
import { wallFootprint } from "./joints";
import { tessellateOutline } from "./shapes";
import type { Poly } from "./region";

/** The openings the stairs from the level below need in level `levelId`'s floor. */
export function stairwellPolys(model: PlanModel, levelId: string): Poly[] {
  return stairwellsOf(model, levelId).flatMap((w) => w.geometry.footprint.map(rectCorners));
}

/**
 * What a level's slab covers: its rooms' outlines, and its walls' footprints, mitred at their
 * joints (joints.ts), arcs cut into pieces (limits.ts ARC_TESSELLATION). `slice` is the level's
 * slice (levels.ts levelSlice).
 */
export function slabOutline(slice: Pick<PlanModel, "rooms" | "walls">): Poly[] {
  const rooms = slice.rooms.map((r): Poly => tessellateOutline(r.points));
  const walls = slice.walls.flatMap((w): Poly[] => (Math.hypot(w.bx - w.ax, w.by - w.ay) === 0 ? [] : [tessellateOutline(wallFootprint(w, slice.walls).outline)]));
  return [...rooms, ...walls];
}

/** A region of the plan: what `include` covers less what `exclude` does (region.ts). */
export interface SlabRegion {
  readonly include: readonly Poly[];
  readonly exclude: readonly Poly[];
}

/**
 * The slab under level `levelId`: its rooms' and walls' outline (slabOutline) less the stairwells
 * from the level below. The one region the 3D view's floors and the IFC export's slabs are cut
 * from. On the ground level it is the ground floor's own floor (there is no stair under it).
 */
export function slabRegion(model: PlanModel, levelId: string): SlabRegion {
  return { include: slabOutline(levelSlice(model, levelId)), exclude: stairwellPolys(model, levelId) };
}

/**
 * The part of level `levelId`'s slab that stands over open ground: over no enclosed room and no
 * wall of the level below — over an open room (a carport, a porch) or over nothing at all. Its
 * underside, the soffit, is seen from below there, and the slab's edge round it; the plan of the
 * level below draws its rim dashed, the convention for what is overhead. Empty for the ground
 * level, and for a floor every part of which stands over enclosed rooms.
 */
export function overhangOf(model: PlanModel, levelId: string): SlabRegion {
  const below = levelBelow(model, levelId);
  if (!below) return { include: [], exclude: [] };
  const under = levelSlice(model, below.level.id);
  const enclosed = slabOutline({ rooms: under.rooms.filter((r) => r.kind !== "open"), walls: under.walls });
  return { include: slabOutline(levelSlice(model, levelId)), exclude: [...stairwellPolys(model, levelId), ...enclosed] };
}
