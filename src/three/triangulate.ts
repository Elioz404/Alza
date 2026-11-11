/**
 * Ear clipping: a simple polygon (no edge crossing another, wound either way, convex or not) cut
 * into triangles. What the 3D view fills a shaped outline with — a wall prism's top and its cut,
 * a mark over a shaped room — written here rather than taken from three.js's ShapeUtils, whose
 * general triangulator (holes and all) is far larger than these simple outlines need.
 *
 * Points are {x, y}; the triangles are index triples into them, wound as the polygon is.
 */

interface P {
  readonly x: number;
  readonly y: number;
}

const cross = (a: P, b: P, c: P): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether p lies inside triangle abc or on its edges (abc wound by `sign`). */
function inTriangle(p: P, a: P, b: P, c: P, sign: number): boolean {
  return sign * cross(a, b, p) >= 0 && sign * cross(b, c, p) >= 0 && sign * cross(c, a, p) >= 0;
}

/** The polygon's triangles, as index triples; none for fewer than three corners. */
export function triangulate(pts: readonly P[]): number[][] {
  const n = pts.length;
  if (n < 3) return [];
  const area = pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * p.y, 0);
  const sign = area >= 0 ? 1 : -1;
  const ring = pts.map((_, i) => i);
  const out: number[][] = [];
  while (ring.length > 3) {
    const m = ring.length;
    let clipped = false;
    for (let k = 0; k < m; k++) {
      const [ia, ib, ic] = [ring[(k - 1 + m) % m], ring[k], ring[(k + 1) % m]];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      // a reflex or flat corner is no ear
      if (sign * cross(a, b, c) <= 0) continue;
      // nor one whose triangle holds another corner (one at the same place as its own excepted)
      let blocked = false;
      for (const j of ring) {
        if (j === ia || j === ib || j === ic) continue;
        const q = pts[j];
        if ((q.x === a.x && q.y === a.y) || (q.x === b.x && q.y === b.y) || (q.x === c.x && q.y === c.y)) continue;
        if (inTriangle(q, a, b, c, sign)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([ia, ib, ic]);
      ring.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // no ear: a corner on a straight run (or a sliver) is dropped, it encloses nothing
      const flat = ring.findIndex((ib, k) => Math.abs(cross(pts[ring[(k - 1 + ring.length) % ring.length]], pts[ib], pts[ring[(k + 1) % ring.length]])) < 1e-12);
      if (flat < 0) break;
      ring.splice(flat, 1);
    }
  }
  if (ring.length === 3 && sign * cross(pts[ring[0]], pts[ring[1]], pts[ring[2]]) > 0) out.push([ring[0], ring[1], ring[2]]);
  return out;
}
