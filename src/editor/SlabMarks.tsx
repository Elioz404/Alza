/**
 * What the floors between storeys add to the plan of a level:
 *
 *  - Overhead: where the level above's slab stands out over open ground here (a studio on
 *    columns over a carport, a porch roof), its rim in long dashes, the convention for what is
 *    above the plan's cut. The region is floors.ts overhangOf, the same one the 3D view builds the
 *    slab's soffit and edge from, so the plan and the model agree on it.
 *  - Open rims: an open space (a carport, a porch) has no wall to close it off, so its floor's
 *    edge is drawn in a fine line wherever no wall's or column's poché runs along it; a walled side
 *    keeps its poché alone.
 *  - Unsupported: on an upper level, the stretches of its floor that no wall or column of the
 *    level below stands near enough to carry (supports.ts unsupportedZones, what the checker
 *    reports as slab_unsupported), hatched in the warning colour.
 *
 * Fetched after the first paint (Editor.tsx) with floors.ts and the joints it reads: until it is
 * here there is nothing to draw, and on a one-storey plan only the open rims.
 */

import { useMemo } from "react";
import type { PlanModel } from "../model/types";
import { levelAbove, levelSlice } from "../model/levels";
import { overhangOf } from "../model/floors";
import { wallFootprint } from "../model/joints";
import { isOpenRoom } from "../model/issues";
import { columnFootprint } from "../model/columns";
import { tessellateOutline } from "../model/shapes";
import { insidePoly, regionRim, type Poly, type RimEdge } from "../model/region";
import { unsupportedZones } from "../model/supports";

export interface SlabMarksProps {
  /** the whole plan */
  plan: PlanModel;
  /** the level shown */
  levelId: string;
  S: number;
  /** the warning hatch's fill, url(#…) */
  hatch: string;
  /** which of the marks to draw: they sit at different depths of the drawing */
  part: "open" | "overhead" | "unsupported";
}

/** How far past a rim edge, metres, its far side is probed: well inside any wall's poché. */
const RIM_PROBE = 1e-3;

/** A rim edge's far side, just past its middle, and whether it lies in any of `polys`. */
const farIn = (e: RimEdge, polys: readonly Poly[]): boolean => {
  const far = { x: (e.a.x + e.b.x) / 2 + e.nx * RIM_PROBE, y: (e.a.y + e.b.y) / 2 + e.ny * RIM_PROBE };
  return polys.some((poly) => insidePoly(far, poly));
};

const edgesPath = (edges: readonly RimEdge[], S: number): string => edges.map((e) => `M${e.a.x * S} ${e.a.y * S}L${e.b.x * S} ${e.b.y * S}`).join("");

/**
 * The open sides of level `levelId`'s open spaces, as path data: each one's floor outline less
 * the stretches where a wall's footprint (mitred, joints.ts) or a column's section of the level
 * runs along it on the outside. Those keep their poché, and nothing else marks the floor's edge.
 */
export function openRimPath(plan: PlanModel, levelId: string, S: number): string {
  const slice = levelSlice(plan, levelId);
  const open = slice.rooms.filter(isOpenRoom);
  if (open.length === 0) return "";
  const solid: Poly[] = [
    ...slice.walls.filter((w) => Math.hypot(w.bx - w.ax, w.by - w.ay) > 0).map((w) => tessellateOutline(wallFootprint(w, slice.walls).outline)),
    ...slice.columns.map((c) => columnFootprint(c)),
  ];
  // the rim of the floor less the poché: its own edges with nothing solid past them (the poché's
  // edges inside the floor have the poché past them, and go too)
  return edgesPath(
    open.flatMap((r) => regionRim([tessellateOutline(r.points)], solid).filter((e) => !farIn(e, solid))),
    S,
  );
}

/**
 * The edge of the level above's slab where it stands over open ground on level `levelId`, as path
 * data: the overhang's rim (floors.ts overhangOf), less the stretches where it meets the walls and
 * enclosed rooms under it — there the slab runs on over them, and no edge is seen from below.
 */
export function overheadPath(plan: PlanModel, levelId: string, S: number): string {
  const above = levelAbove(plan, levelId);
  if (!above) return "";
  const { include, exclude } = overhangOf(plan, above.level.id);
  if (include.length === 0) return "";
  return edgesPath(
    regionRim(include, exclude).filter((e) => !farIn(e, exclude)),
    S,
  );
}

/** The cells of level `levelId`'s unsupported floor, as one path's data. */
export function unsupportedPath(plan: PlanModel, levelId: string, S: number): string {
  return unsupportedZones(plan, levelId)
    .flatMap((z) => z.cells)
    .map((c) => `M${c.minX * S} ${c.minY * S}H${c.maxX * S}V${c.maxY * S}H${c.minX * S}Z`)
    .join("");
}

export function SlabMarks({ plan, levelId, S, hatch, part }: SlabMarksProps) {
  const d = useMemo(
    () => (part === "open" ? openRimPath(plan, levelId, S) : part === "overhead" ? overheadPath(plan, levelId, S) : unsupportedPath(plan, levelId, S)),
    [plan, levelId, S, part],
  );
  if (!d) return null;
  if (part === "open") {
    return (
      <g className="pl-open" aria-hidden="true" data-open-rim="">
        <path className="pl-open-rim" d={d} />
      </g>
    );
  }
  return part === "overhead" ? (
    <g className="pl-overhead" aria-hidden="true" data-level-above="">
      <path className="pl-overhead-rim" d={d} />
    </g>
  ) : (
    <g className="pl-unsupported" aria-hidden="true">
      <path className="pl-unsupported-area" d={d} />
      <path d={d} fill={hatch} />
    </g>
  );
}
