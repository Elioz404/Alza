/**
 * Flat regions with holes, as the floors between storeys need them: an upper level's slab is
 * the union of its rooms and walls with each stairwell from the level below cut out of it, and
 * a room whose floor a stairwell crosses is its rectangle with that opening. Every outline here
 * is a convex polygon on the plan (a room, a wall, a flight of stairs, its landing), turned any
 * way, so the region is cut into pieces without a general polygon library:
 *
 *  - regionPieces() cuts it into vertical strips at every corner and every crossing of two
 *    outlines. Inside one strip no two edges cross, so the region there is a stack of
 *    trapezoids, found at the strip's middle and measured at its two sides: exact, however the
 *    outlines overlap or turn.
 *  - regionRim() finds its rim: every stretch of an outline with the region on one side and not
 *    the other, with the side the region is not on. A slab's sides and a stairwell's lining are
 *    walls built along it.
 *
 * Plan coordinates (metres, y down the sheet), pure functions: the 3D view's floors and the IFC
 * export's slabs and finishes (src/export/ifc) are cut by the same code, so they cover the same.
 */

import type { Pt } from "./geometry";
import { REGION } from "./limits";

/** A convex outline on the plan, its corners in order (either way round). */
export type Poly = readonly Pt[];

/** One trapezoid of a region: from x0 to x1, between lo and hi (lo ≤ hi), measured at each side. */
export interface Piece {
  readonly x0: number;
  readonly x1: number;
  readonly lo0: number;
  readonly hi0: number;
  readonly lo1: number;
  readonly hi1: number;
}

/** A stretch of a region's rim, from a to b, and the unit normal pointing out of the region. */
export interface RimEdge {
  readonly a: Pt;
  readonly b: Pt;
  readonly nx: number;
  readonly ny: number;
}

const EPS = REGION.edgeTolerance;

/** y along the line through a and b (not vertical) at x. */
type Bound = (x: number) => number;
const lineThrough = (a: Pt, b: Pt): Bound => (x) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);

/** The edges of an outline, each from one corner to the next. */
function edgesOf(poly: Poly): [Pt, Pt][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Pt, Pt]);
}

/** Where a vertical line at x crosses a convex outline: its lower and upper edge there, or null. */
function crossing(poly: Poly, x: number): [Bound, Bound] | null {
  const found: Bound[] = [];
  for (const [a, b] of edgesOf(poly)) {
    if (Math.min(a.x, b.x) < x && Math.max(a.x, b.x) > x) found.push(lineThrough(a, b));
  }
  if (found.length < 2) return null;
  found.sort((p, q) => p(x) - q(x));
  return [found[0], found[found.length - 1]];
}

/** Where two segments meet, as x; null when they do not (or run along each other). */
function meetX(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS * EPS) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return a.x + t * rx;
}

type Interval = { lo: Bound; hi: Bound };

/** The union of intervals, all measured at x (they do not cross inside the strip). */
function union(intervals: Interval[], x: number): Interval[] {
  const sorted = [...intervals].sort((p, q) => p.lo(x) - q.lo(x));
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.lo(x) <= last.hi(x) + EPS) {
      if (iv.hi(x) > last.hi(x)) out[out.length - 1] = { lo: last.lo, hi: iv.hi };
    } else out.push(iv);
  }
  return out;
}

/** `from` with `cut` taken out of it, all measured at x. */
function subtract(from: Interval[], cut: Interval[], x: number): Interval[] {
  const out: Interval[] = [];
  for (const iv of from) {
    let lo: Bound = iv.lo;
    let open = true;
    for (const c of cut) {
      if (!open) break;
      if (c.hi(x) <= lo(x) + EPS || c.lo(x) >= iv.hi(x) - EPS) continue;
      if (c.lo(x) > lo(x) + EPS) out.push({ lo, hi: c.lo });
      if (c.hi(x) < iv.hi(x) - EPS) lo = c.hi;
      else open = false;
    }
    if (open && iv.hi(x) - lo(x) > EPS) out.push({ lo, hi: iv.hi });
  }
  return out;
}

/**
 * The region covered by any of `include` and none of `exclude`, as trapezoids. `splitX` and
 * `splitY` are lines every piece is also cut at (a floor's shaded rim, say), so a value that
 * changes across them can be given at the pieces' corners.
 */
export function regionPieces(include: readonly Poly[], exclude: readonly Poly[] = [], splitX: readonly number[] = [], splitY: readonly number[] = []): Piece[] {
  if (include.length === 0) return [];
  const xsOf = (polys: readonly Poly[]) => polys.flatMap((p) => p.map((q) => q.x));
  const minX = Math.min(...xsOf(include));
  const maxX = Math.max(...xsOf(include));
  const minY = Math.min(...include.flatMap((p) => p.map((q) => q.y)));
  const maxY = Math.max(...include.flatMap((p) => p.map((q) => q.y)));
  // every edge, and the split lines as edges across the whole region
  const edges: [Pt, Pt][] = [...include, ...exclude].flatMap(edgesOf);
  for (const y of splitY) edges.push([{ x: minX - 1, y }, { x: maxX + 1, y }]);
  const xs = [...xsOf(include), ...xsOf(exclude), ...splitX];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const x = meetX(edges[i][0], edges[i][1], edges[j][0], edges[j][1]);
      if (x !== null) xs.push(x);
    }
  }
  const cuts = [...new Set(xs.filter((x) => x >= minX && x <= maxX))].sort((p, q) => p - q);
  const splits = splitY.filter((y) => y > minY && y < maxY);
  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const x0 = cuts[i];
    const x1 = cuts[i + 1];
    if (x1 - x0 < EPS) continue;
    const xm = (x0 + x1) / 2;
    const at = (polys: readonly Poly[]) =>
      polys.flatMap((p): Interval[] => {
        const c = crossing(p, xm);
        return c ? [{ lo: c[0], hi: c[1] }] : [];
      });
    let region = subtract(union(at(include), xm), union(at(exclude), xm), xm);
    if (splits.length > 0) {
      const lines = splits.map((y): Interval => ({ lo: () => y, hi: () => y }));
      region = region.flatMap((iv) => {
        const inside = lines.filter((l) => l.lo(xm) > iv.lo(xm) + EPS && l.lo(xm) < iv.hi(xm) - EPS).sort((p, q) => p.lo(xm) - q.lo(xm));
        const bounds = [iv.lo, ...inside.map((l) => l.lo), iv.hi];
        return bounds.slice(1).map((hi, k) => ({ lo: bounds[k], hi }));
      });
    }
    for (const iv of region) pieces.push({ x0, x1, lo0: iv.lo(x0), hi0: iv.hi(x0), lo1: iv.lo(x1), hi1: iv.hi(x1) });
  }
  return pieces;
}

/** Is p strictly inside the convex outline? */
export function insidePoly(p: Pt, poly: Poly): boolean {
  let sign = 0;
  for (const [a, b] of edgesOf(poly)) {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < EPS * Math.hypot(b.x - a.x, b.y - a.y)) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Is p in the region: inside one of `include` and none of `exclude`? */
export const inRegion = (p: Pt, include: readonly Poly[], exclude: readonly Poly[] = []): boolean =>
  include.some((poly) => insidePoly(p, poly)) && !exclude.some((poly) => insidePoly(p, poly));

/**
 * The region's rim: each stretch of an outline that has the region on one side only, with the
 * normal pointing to the other. A stretch two outlines share is given once.
 */
export function regionRim(include: readonly Poly[], exclude: readonly Poly[] = []): RimEdge[] {
  const all = [...include, ...exclude];
  const edges = all.flatMap(edgesOf);
  const out: RimEdge[] = [];
  const seen = new Set<string>();
  const key = (p: Pt) => `${Math.round(p.x / REGION.probe)},${Math.round(p.y / REGION.probe)}`;
  for (const [a, b] of edges) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) continue;
    // where along a→b the other outlines meet or touch it
    const ts = [0, 1];
    for (const [c, d] of edges) {
      const den = dx * (d.y - c.y) - dy * (d.x - c.x);
      if (Math.abs(den) > EPS * EPS) {
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
        if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) ts.push(t);
      } else {
        // along the same line: its ends split this edge
        for (const p of [c, d]) {
          const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
          const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
          if (off < EPS && t > 0 && t < 1) ts.push(t);
        }
      }
    }
    ts.sort((p, q) => p - q);
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i + 1 < ts.length; i++) {
      if ((ts[i + 1] - ts[i]) * len < EPS) continue;
      const tm = (ts[i] + ts[i + 1]) / 2;
      const m = { x: a.x + dx * tm, y: a.y + dy * tm };
      const plus = inRegion({ x: m.x + nx * REGION.probe, y: m.y + ny * REGION.probe }, include, exclude);
      const minus = inRegion({ x: m.x - nx * REGION.probe, y: m.y - ny * REGION.probe }, include, exclude);
      if (plus === minus) continue;
      const p = { x: a.x + dx * ts[i], y: a.y + dy * ts[i] };
      const q = { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] };
      const id = [key(p), key(q)].sort().join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(plus ? { a: p, b: q, nx: -nx, ny: -ny } : { a: p, b: q, nx, ny });
    }
  }
  return out;
}

/** The area the pieces cover, square metres. */
export const piecesArea = (pieces: readonly Piece[]): number =>
  pieces.reduce((sum, p) => sum + ((p.hi0 - p.lo0 + (p.hi1 - p.lo1)) / 2) * (p.x1 - p.x0), 0);
