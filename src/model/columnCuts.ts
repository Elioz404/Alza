/**
 * Where a column stands in a wall and takes the whole of its thickness: the stretch of the wall it
 * replaces, and how high. The 3D view stops the wall at the column's faces there (three/build.ts)
 * and the IFC export takes the column out of the wall's body and its quantities (export/ifc), so
 * the two cut a wall the same way. Pure over the plan; fetched with those two, not in first load.
 */

import type { Column, PlanModel, Wall } from "./types";
import type { Pt } from "./geometry";
import { closestOnEdge, wallEdge, wallLength, wallTangentAt } from "./shapes";
import { columnFootprint, columnHeight, columnWalls } from "./columns";

/**
 * A stretch of a wall a column takes the whole thickness of, as shares of its centreline's length:
 * the wall stops at the column's faces either side and the column stands in the gap, so the two
 * read as one solid, as the plan draws them in one poché. Either share may lie past an end of the
 * wall, where the column stands over the wall's end. `top`, when the column stops under the
 * wall's top: the wall runs on over it from there, as over a doorway.
 */
export interface WallPost {
  readonly t0: number;
  readonly t1: number;
  readonly top?: number;
}

/** Where the line p + u·s (s any length) runs inside a convex polygon: its s from and to, or null. */
function lineThrough(poly: readonly Pt[], p: Pt, u: Pt): [number, number] | null {
  const hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = u.x * ey - u.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    // p + u s = a + e r, for r in [0, 1]
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    const r = (dx * u.y - dy * u.x) / den;
    if (r < -1e-12 || r > 1 + 1e-12) continue;
    hits.push((dx * ey - dy * ex) / den);
  }
  if (hits.length < 2) return null;
  return [Math.min(...hits), Math.max(...hits)];
}

/**
 * The columns that take a wall's whole thickness where they stand in it (model/columns.ts
 * columnWalls), as the stretches of it they take: each from where both of the wall's faces enter
 * the column's section to where both leave it, so the wall's cut ends lie inside the column. A
 * column narrower than the wall stands inside it, and takes nothing. With the plan's `levels`, a
 * column shorter than the wall (columnHeight) takes the stretch only up to its own top.
 */
export function wallPosts(wall: Wall, columns: readonly Column[], levels?: Pick<PlanModel, "levels">): WallPost[] {
  const len = wallLength(wall);
  if (len === 0) return [];
  const half = wall.thickness / 2;
  const posts: WallPost[] = [];
  for (const c of columns) {
    if (columnWalls([wall], c).length === 0) continue;
    const near = closestOnEdge(wallEdge(wall), c);
    const u = wallTangentAt(wall, near.t);
    const poly = columnFootprint(c);
    const faces = [1, -1].map((side) => lineThrough(poly, { x: near.point.x - u.y * half * side, y: near.point.y + u.x * half * side }, u));
    if (faces.some((f) => f === null)) continue;
    const lo = Math.max(...faces.map((f) => f![0]));
    const hi = Math.min(...faces.map((f) => f![1]));
    if (hi - lo < 1e-6) continue;
    const height = levels ? columnHeight(levels, c) : undefined;
    const short = height !== undefined && height < wall.height - 1e-9;
    posts.push({ t0: near.t + lo / len, t1: near.t + hi / len, ...(short ? { top: height } : {}) });
  }
  return posts.sort((a, b) => a.t0 - b.t0);
}

/** How high a post takes its wall: to the column's top, or the wall's whole height. */
export const postTop = (wall: Wall, post: WallPost): number => Math.min(post.top ?? wall.height, wall.height);
