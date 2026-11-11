/**
 * Columns on the plan: the section each one stands on, how tall it is, the walls it is part of,
 * where a column being placed is pulled to, and the grid add_column lays out.
 *
 * A column is a section (square, rectangle or circle) at a point, turned by its rotation with
 * place_item's convention, standing on its level from the floor to the underside of the slab over
 * it unless a height is set. Everything here is pure over the plan; the 2D plan, the 3D view, the
 * checker and the IFC export read a column's shape from these functions, so they agree on it.
 */

import type { Column, PlanModel, Wall } from "./types";
import { COLUMN, SNAP, type ColumnShape } from "./limits";
import { levelInfo, slabUnderside } from "./levels";
import { boxOf, rectCorners, satRectRect, snap, type Box, type ORect, type Pt } from "./geometry";
import { closestOnEdge, wallEdge } from "./shapes";

/** A column's section as an oriented rectangle: its own, or a circle's bounding square. */
export const columnRect = (c: Pick<Column, "x" | "y" | "w" | "d" | "rotation">): ORect => ({
  cx: c.x,
  cy: c.y,
  hw: c.w / 2,
  hd: c.d / 2,
  rot: (-c.rotation * Math.PI) / 180,
});

/** Whether a section is round. */
export const isRound = (c: Pick<Column, "shape">): boolean => c.shape === "circle";

/**
 * The column's footprint on the plan, as a polygon: a rectangle's four corners, or a circle cut
 * into COLUMN.circleSides sides (its corners on the circle). Wound the way rectCorners winds.
 */
export function columnFootprint(c: Pick<Column, "shape" | "x" | "y" | "w" | "d" | "rotation">): Pt[] {
  if (!isRound(c)) return rectCorners(columnRect(c));
  const r = c.w / 2;
  const n = COLUMN.circleSides;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** The bounds of a column's section. */
export const columnBox = (c: Pick<Column, "shape" | "x" | "y" | "w" | "d" | "rotation">): Box =>
  isRound(c) ? { minX: c.x - c.w / 2, minY: c.y - c.w / 2, maxX: c.x + c.w / 2, maxY: c.y + c.w / 2 } : boxOf(rectCorners(columnRect(c)));

/** The section's area, square metres. */
export const columnArea = (c: Pick<Column, "shape" | "w" | "d">): number => (isRound(c) ? (Math.PI * c.w * c.w) / 4 : c.w * c.d);

/** How far `p` is from an oriented rectangle: 0 inside it or on its edge. */
export function distanceToRect(p: Pt, r: ORect): number {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const dx = p.x - r.cx;
  const dy = p.y - r.cy;
  const lx = Math.max(Math.abs(dx * c + dy * s) - r.hw, 0);
  const ly = Math.max(Math.abs(-dx * s + dy * c) - r.hd, 0);
  return Math.hypot(lx, ly);
}

/** How far `p` is from the column's section: 0 inside it or on its edge. */
export function columnDistance(p: Pt, c: Pick<Column, "shape" | "x" | "y" | "w" | "d" | "rotation">): number {
  if (isRound(c)) return Math.max(Math.hypot(p.x - c.x, p.y - c.y) - c.w / 2, 0);
  return distanceToRect(p, columnRect(c));
}

/**
 * Whether the column's section overlaps an oriented rectangle by more than `eps` (touching is
 * not overlapping): SAT for a rectangle, the circle's distance to it for a round one.
 */
export function columnHitsRect(c: Pick<Column, "shape" | "x" | "y" | "w" | "d" | "rotation">, r: ORect, eps = 1e-9): boolean {
  if (isRound(c)) return distanceToRect(c, r) < c.w / 2 - eps;
  return satRectRect(columnRect(c), r, eps);
}

/** Whether two columns' sections overlap by more than `eps`. */
export function columnsHit(a: Column, b: Column, eps = 1e-9): boolean {
  if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) < (a.w + b.w) / 2 - eps;
  if (isRound(a)) return columnHitsRect(a, columnRect(b), eps);
  return columnHitsRect(b, columnRect(a), eps);
}

/**
 * How tall the column stands: its set height, or from its floor to the underside of the slab over
 * its level (slabUnderside of its floor-to-floor height). Undefined for a column on a level the
 * plan does not have.
 */
export function columnHeight(model: Pick<PlanModel, "levels">, c: Column): number | undefined {
  if (c.height !== undefined) return c.height;
  const level = levelInfo(model, c.levelId);
  return level ? slabUnderside(level.level.height) : undefined;
}

/** The columns standing on level `levelId`. */
export const columnsOn = (model: Pick<PlanModel, "columns">, levelId: string): Column[] => model.columns.filter((c) => c.levelId === levelId);

/**
 * The walls of the column's level it is part of: those whose centreline its centre stands within
 * COLUMN.inWall of the wall's thickness of (a column at a wall's end, a corner, is in it too). The
 * plan draws the column and those walls as one poché and the 3D view and the IFC export let the
 * wall run into it; the checker reads a column in a wall as standing on it.
 */
export function columnWalls(walls: readonly Wall[], c: Column): Wall[] {
  return walls.filter((w) => w.levelId === c.levelId && closestOnEdge(wallEdge(w), c).distance <= w.thickness * COLUMN.inWall + 1e-9);
}

const COLUMN_STEPS = Math.round(1 / COLUMN.precision);
/**
 * A column's coordinate kept to COLUMN.precision, as the decimal it is: divided by the steps per
 * metre rather than multiplied by the step, which would leave 5.6 as 5.6000000000000005.
 */
export const columnCoord = (v: number): number => Math.round(v * COLUMN_STEPS) / COLUMN_STEPS;

/** A column's section from its shape and sizes: a square's and a circle's depth is their width. */
export function sectionOf(shape: ColumnShape, w: number, d: number | undefined): { w: number; d: number } {
  return shape === "rectangle" ? { w, d: d ?? w } : { w, d: w };
}

// ---------------------------------------------------------------------------- placing

/** What a column being placed was pulled to. */
export type ColumnSnapTarget = "corner" | "wall" | "column" | "grid";

export interface ColumnSnap {
  x: number;
  y: number;
  /** what each axis was pulled to: a corner or a wall moves both, a column's axis one */
  to: ColumnSnapTarget;
  /** the wall or column it was pulled to, if any */
  ref?: string;
}

/**
 * Where a column placed at `p` on a level (`slice`, levels.ts levelSlice) is pulled to, within
 * `reach` metres (COLUMN.snap): onto a wall's corner (either end of it), else onto a wall's axis
 * (the nearest point of its centreline, curved or not), else, axis by axis, onto another column's
 * x or y (so a row lines up), else onto the plan's grid. `except` is the column being moved.
 */
export function snapColumnPoint(p: Pt, slice: Pick<PlanModel, "walls" | "columns">, reach: number = COLUMN.snap, except?: string): ColumnSnap {
  let best: { d: number; at: Pt; ref: string } | null = null;
  for (const w of slice.walls) {
    for (const end of [{ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }]) {
      const d = Math.hypot(p.x - end.x, p.y - end.y);
      if (d <= reach && (!best || d < best.d)) best = { d, at: end, ref: w.id };
    }
  }
  if (best) return { x: best.at.x, y: best.at.y, to: "corner", ref: best.ref };
  for (const w of slice.walls) {
    const near = closestOnEdge(wallEdge(w), p);
    if (near.distance <= reach && (!best || near.distance < best.d)) best = { d: near.distance, at: near.point, ref: w.id };
  }
  if (best) return { x: best.at.x, y: best.at.y, to: "wall", ref: best.ref };
  let x: { v: number; d: number; ref: string } | null = null;
  let y: { v: number; d: number; ref: string } | null = null;
  for (const c of slice.columns) {
    if (c.id === except) continue;
    const dx = Math.abs(p.x - c.x);
    const dy = Math.abs(p.y - c.y);
    if (dx <= reach && (!x || dx < x.d)) x = { v: c.x, d: dx, ref: c.id };
    if (dy <= reach && (!y || dy < y.d)) y = { v: c.y, d: dy, ref: c.id };
  }
  if (x || y) return { x: x ? x.v : snap(p.x, SNAP), y: y ? y.v : snap(p.y, SNAP), to: "column", ref: (x ?? y)?.ref };
  return { x: snap(p.x, SNAP), y: snap(p.y, SNAP), to: "grid" };
}

/** Where the column tool would put a column, and what it would stand in. */
export interface ColumnAim extends ColumnSnap {
  /** the column of the level it would stand in, if any (the checker's columns_overlap) */
  overlaps?: string;
}

/** The column the column tool adds at (x, y): the default section, square to the plan. */
export const defaultColumnAt = (x: number, y: number): Column => ({
  id: "",
  levelId: "",
  shape: COLUMN.defaults.shape,
  x,
  y,
  w: COLUMN.defaults.size,
  d: COLUMN.defaults.size,
  rotation: 0,
});

/**
 * The column tool's aim at `p` on a level (`slice`): where it snaps (snapColumnPoint) and the
 * column it would stand in there, if any. The one answer the tool's ghost, its lettered hint and
 * its click and Enter share, so what is drawn, what is said and what is put down agree.
 */
export function columnAim(p: Pt, slice: Pick<PlanModel, "walls" | "columns">): ColumnAim {
  const at = snapColumnPoint(p, slice);
  const ghost = defaultColumnAt(at.x, at.y);
  const hit = slice.columns.find((c) => columnsHit(c, ghost));
  return hit ? { ...at, overlaps: hit.id } : at;
}

/**
 * The centres of a grid of `rows` × `cols` columns `spacing` metres apart, centred on `centre`
 * and turned by `rotation` (degrees, place_item's convention): rows run along the turned y, columns
 * along the turned x. Row by row, from the turned top-left one.
 */
export function columnGrid(centre: Pt, rows: number, cols: number, spacing: number, rotation = 0): Pt[] {
  const a = (-rotation * Math.PI) / 180;
  const ux = { x: Math.cos(a), y: Math.sin(a) };
  const uy = { x: -Math.sin(a), y: Math.cos(a) };
  const out: Pt[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const lx = (k - (cols - 1) / 2) * spacing;
      const ly = (r - (rows - 1) / 2) * spacing;
      out.push({ x: centre.x + ux.x * lx + uy.x * ly, y: centre.y + ux.y * lx + uy.y * ly });
    }
  }
  return out;
}
