/** Precision geometry helpers — snapping, segment math, oriented-rectangle SAT. */

export const SNAP = 0.05; // 5 cm

export const snap = (v: number, step = SNAP): number => Math.round(v / step) * step;

export const nearly = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export const segLen = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

/** Distance from point p to segment ab. */
export function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Parametric point on segment ab at t (0..1). */
export const segPoint = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper segment intersection (crossing at non-endpoint counts; touching endpoints does not). */
export function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt, eps = 1e-9): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
      ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
    return true;
  }
  return false;
}

/** True when segments are (nearly) collinear. */
export function areCollinear(a1: Pt, a2: Pt, b1: Pt, b2: Pt, eps = 1e-6): boolean {
  const la = segLen(a1.x, a1.y, a2.x, a2.y);
  const lb = segLen(b1.x, b1.y, b2.x, b2.y);
  if (la < eps || lb < eps) return false;
  return (
    Math.abs(cross(a1, a2, b1)) / la < eps * 10 &&
    Math.abs(cross(a1, a2, b2)) / la < eps * 10
  );
}

/**
 * Collinear overlap length between segments a and b (projected on the dominant axis).
 * Returns 0 when they merely touch at an endpoint or are not collinear.
 */
export function collinearOverlap(a1: Pt, a2: Pt, b1: Pt, b2: Pt, eps = 1e-6): number {
  if (!areCollinear(a1, a2, b1, b2, eps)) return 0;
  const useX = Math.abs(a2.x - a1.x) >= Math.abs(a2.y - a1.y);
  const key = (p: Pt) => (useX ? p.x : p.y);
  const aMin = Math.min(key(a1), key(a2));
  const aMax = Math.max(key(a1), key(a2));
  const bMin = Math.min(key(b1), key(b2));
  const bMax = Math.max(key(b1), key(b2));
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return overlap > eps ? overlap : 0;
}

/** Point lies on segment (within eps), including endpoints. */
export function pointOnSeg(p: Pt, a: Pt, b: Pt, eps = 1e-6): boolean {
  return pointSegDist(p, a, b) <= eps;
}

// ---------------------------------------------------------------------------
// Oriented rectangles (for furniture vs walls SAT)
// ---------------------------------------------------------------------------

export interface ORect {
  cx: number;
  cy: number;
  hw: number; // half width  (local x)
  hd: number; // half depth  (local y)
  rot: number; // radians, counterclockwise
}

export function rectCorners(r: ORect): Pt[] {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const pts: Pt[] = [];
  for (const [lx, ly] of [
    [r.hw, r.hd],
    [-r.hw, r.hd],
    [-r.hw, -r.hd],
    [r.hw, -r.hd],
  ] as const) {
    pts.push({ x: r.cx + lx * c - ly * s, y: r.cy + lx * s + ly * c });
  }
  return pts;
}

function project(pts: Pt[], ax: Pt): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p.x * ax.x + p.y * ax.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** SAT intersection test between two oriented rectangles. Touching edges = NOT intersecting. */
export function satRectRect(a: ORect, b: ORect, eps = 1e-9): boolean {
  const pa = rectCorners(a);
  const pb = rectCorners(b);
  const axes: Pt[] = [];
  for (const pts of [pa, pb]) {
    for (let i = 0; i < 2; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % 4];
      const len = dist(p1, p2) || 1;
      axes.push({ x: (-(p2.y - p1.y)) / len, y: (p2.x - p1.x) / len });
    }
  }
  for (const ax of axes) {
    const [aMin, aMax] = project(pa, ax);
    const [bMin, bMax] = project(pb, ax);
    if (aMax <= bMin + eps || bMax <= aMin + eps) return false;
  }
  return true;
}

/** SAT between an oriented rect and a thick wall segment (wall as a rotated rect). */
export function wallAsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
): ORect {
  const len = segLen(ax, ay, bx, by);
  return {
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    hw: len / 2,
    hd: thickness / 2,
    rot: Math.atan2(by - ay, bx - ax),
  };
}

export const satRectWall = (
  r: ORect,
  wall: { ax: number; ay: number; bx: number; by: number; thickness: number },
  eps = 1e-9,
): boolean => satRectRect(r, wallAsRect(wall.ax, wall.ay, wall.bx, wall.by, wall.thickness), eps);

/** Axis-aligned rect overlap (rooms). Touching edges = not overlapping. */
export function aabbOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  eps = 1e-9,
): boolean {
  return (
    a.x + a.w > b.x + eps &&
    b.x + b.w > a.x + eps &&
    a.y + a.h > b.y + eps &&
    b.y + b.h > a.y + eps
  );
}

export const pointInAabb = (
  p: Pt,
  r: { x: number; y: number; w: number; h: number },
): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
