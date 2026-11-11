/**
 * Free shapes: arcs, and simple polygons whose edges may be arcs. Plan coordinates (metres, y
 * down the sheet), pure functions, no state.
 *
 * An arc is stored the way a wall and a room's edge store it: its two ends and a bulge, tan(θ/4)
 * for its included angle θ (limits.ts, BULGE). A positive bulge bows to the side of (dy, −dx) for
 * the chord's direction (dx, dy). A point on an arc is found by its parameter t, 0 at its start
 * and 1 at its end, which is proportional to the length along it: an opening's `t` on a curved
 * wall is a share of the arc's length, as it is of a straight wall's.
 *
 * A room's outline (RoomVertex[]) is a polygon whose vertex i carries the bulge of the edge from
 * it to vertex i + 1. normalizeOutline keeps it wound so its shoelace area is positive on plan
 * coordinates (clockwise on the sheet), and so a positive bulge always bows out of the room.
 */

import type { Box, ORect, Pt } from "./geometry";
import type { RoomVertex, Wall } from "./types";
import { ARC_TESSELLATION, BULGE, ROOM_SHAPE, STRAIGHT_BULGE, STRAIGHT_SAGITTA, WALL_ARC_MIN_RADIUS } from "./limits";

const TAU = 2 * Math.PI;
/** Lengths closer than this are equal, points closer than this the same point. */
const EPS = 1e-9;

/** One edge: from a to b, straight (bulge 0) or an arc of that bulge. */
export interface Edge {
  readonly a: Pt;
  readonly b: Pt;
  readonly bulge: number;
}

/** An arc's circle and the part of it the arc runs along. */
export interface Arc {
  readonly center: Pt;
  readonly radius: number;
  /** the angle of the arc's start, seen from its centre (atan2 on plan coordinates) */
  readonly start: number;
  /** signed, radians: the angle turned from start to end, 4·atan(bulge) */
  readonly sweep: number;
  readonly length: number;
}

/** How a wall or an edge is bent, as a tool or a gesture says it. */
export type CurveInput =
  /** the bulge itself (BULGE) */
  | { bulge: number }
  /** how far the arc's middle stands off its chord, metres; positive toward the bulge's positive side */
  | { sagitta: number }
  /** a point the arc passes through */
  | { through: Pt };

/** How finely to cut an arc into straight pieces (limits.ts, ARC_TESSELLATION). */
export interface Tessellation {
  readonly maxSegment: number;
  /** degrees */
  readonly maxAngle: number;
}

export const isStraight = (bulge: number | undefined): boolean => bulge === undefined || Math.abs(bulge) < STRAIGHT_BULGE;

/**
 * The bulge of the edge from a to b, 0 when it is straight: by its bulge (float noise), or by its
 * middle standing off its chord by less than STRAIGHT_SAGITTA. What every edge is read with.
 */
export function edgeBulge(a: Pt, b: Pt, bulge: number | undefined): number {
  if (isStraight(bulge)) return 0;
  const k = bulge as number;
  return Math.abs(k) * Math.hypot(b.x - a.x, b.y - a.y) < 2 * STRAIGHT_SAGITTA ? 0 : k;
}

// ---------------------------------------------------------------------------- one arc

/** The arc from a to b of this bulge; null when it is straight (or a and b coincide). */
export function arcOf(a: Pt, b: Pt, bulge: number | undefined): Arc | null {
  const k = edgeBulge(a, b, bulge);
  if (k === 0) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = Math.hypot(dx, dy);
  if (c < EPS) return null;
  const nx = dy / c;
  const ny = -dx / c;
  const sagitta = (k * c) / 2;
  const radius = (c * (1 + k * k)) / (4 * Math.abs(k));
  const off = sagitta - Math.sign(k) * radius;
  const center = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
  const sweep = 4 * Math.atan(k);
  return { center, radius, start: Math.atan2(a.y - center.y, a.x - center.x), sweep, length: radius * Math.abs(sweep) };
}

/** The unit normal an edge's positive bulge bows toward: (dy, −dx) for its chord. */
export function chordNormal(a: Pt, b: Pt): Pt {
  const c = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.y - a.y) / c, y: -(b.x - a.x) / c };
}

export const edgeArc = (e: Edge): Arc | null => arcOf(e.a, e.b, e.bulge);

/** An edge's length along it: the arc's, or the chord's. */
export function edgeLength(e: Edge): number {
  const arc = edgeArc(e);
  return arc ? arc.length : Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
}

/** The point at parameter t (0..1, by length) along an edge. */
export function pointOnEdge(e: Edge, t: number): Pt {
  const arc = edgeArc(e);
  if (!arc) return { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t };
  const phi = arc.start + arc.sweep * t;
  return { x: arc.center.x + arc.radius * Math.cos(phi), y: arc.center.y + arc.radius * Math.sin(phi) };
}

/** The unit direction an edge runs in at parameter t (from a toward b). */
export function tangentOnEdge(e: Edge, t: number): Pt {
  const arc = edgeArc(e);
  if (!arc) {
    const c = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
    return { x: (e.b.x - e.a.x) / c, y: (e.b.y - e.a.y) / c };
  }
  const phi = arc.start + arc.sweep * t;
  const s = Math.sign(arc.sweep);
  return { x: -Math.sin(phi) * s, y: Math.cos(phi) * s };
}

/** How far an edge's middle stands off its chord, metres (signed like its bulge). */
export const sagittaOf = (e: Edge): number => (edgeBulge(e.a, e.b, e.bulge) * Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)) / 2;

/** The bulge of the arc from a to b whose middle stands `sagitta` off the chord. */
export function bulgeFromSagitta(a: Pt, b: Pt, sagitta: number): number {
  const c = Math.hypot(b.x - a.x, b.y - a.y);
  return c < EPS ? 0 : (2 * sagitta) / c;
}

/** The bulge of the arc from a to b through p; null when p is a or b. A p on the chord is 0. */
export function bulgeThrough(a: Pt, b: Pt, p: Pt): number | null {
  const v1 = { x: a.x - p.x, y: a.y - p.y };
  const v2 = { x: b.x - p.x, y: b.y - p.y };
  if (Math.hypot(v1.x, v1.y) < EPS || Math.hypot(v2.x, v2.y) < EPS) return null;
  const angle = Math.atan2(Math.abs(v1.x * v2.y - v1.y * v2.x), v1.x * v2.x + v1.y * v2.y);
  const n = chordNormal(a, b);
  const side = n.x * (p.x - (a.x + b.x) / 2) + n.y * (p.y - (a.y + b.y) / 2);
  const magnitude = Math.tan((Math.PI - angle) / 2);
  return Math.abs(side) < EPS ? 0 : Math.sign(side) * magnitude;
}

/** The bulge `curve` asks for on the edge from a to b; null when it names no arc (a through-point on an end). */
export function curveBulge(a: Pt, b: Pt, curve: CurveInput): number | null {
  if ("bulge" in curve) return curve.bulge;
  if ("sagitta" in curve) return bulgeFromSagitta(a, b, curve.sagitta);
  return bulgeThrough(a, b, curve.through);
}

/** The angle from `start`, seen from the arc's centre, measured the way the arc turns. */
function sweepTo(arc: Arc, p: Pt): number {
  const d = Math.atan2(p.y - arc.center.y, p.x - arc.center.x) - arc.start;
  return arc.sweep > 0 ? ((d % TAU) + TAU) % TAU : -((((-d) % TAU) + TAU) % TAU);
}

/** The nearest point of an edge to p: its parameter, the point, and the distance. */
export function closestOnEdge(e: Edge, p: Pt): { t: number; point: Pt; distance: number } {
  const arc = edgeArc(e);
  if (!arc) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / l2));
    const point = { x: e.a.x + dx * t, y: e.a.y + dy * t };
    return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
  }
  const t = sweepTo(arc, p) / arc.sweep;
  if (t >= 0 && t <= 1 && Math.hypot(p.x - arc.center.x, p.y - arc.center.y) > EPS) {
    const point = pointOnEdge(e, t);
    return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
  }
  const da = Math.hypot(p.x - e.a.x, p.y - e.a.y);
  const db = Math.hypot(p.x - e.b.x, p.y - e.b.y);
  return da <= db ? { t: 0, point: e.a, distance: da } : { t: 1, point: e.b, distance: db };
}

/** The bounds of an edge, an arc's outermost points included. */
export function edgeBox(e: Edge): Box {
  const xs = [e.a.x, e.b.x];
  const ys = [e.a.y, e.b.y];
  const arc = edgeArc(e);
  if (arc) {
    for (let k = 0; k < 4; k++) {
      const phi = (k * Math.PI) / 2;
      const p = { x: arc.center.x + arc.radius * Math.cos(phi), y: arc.center.y + arc.radius * Math.sin(phi) };
      const t = sweepTo(arc, p) / arc.sweep;
      if (t > 0 && t < 1) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** How many straight pieces an edge is cut into. */
export function piecesOf(e: Edge, tess: Tessellation = ARC_TESSELLATION): number {
  const arc = edgeArc(e);
  if (!arc) return 1;
  const byLength = Math.ceil(arc.length / tess.maxSegment);
  const byAngle = Math.ceil(Math.abs(arc.sweep) / ((tess.maxAngle * Math.PI) / 180));
  return Math.max(1, byLength, byAngle);
}

/** An edge as straight pieces: its points from a (included) up to b (left out). */
export function tessellateEdge(e: Edge, tess: Tessellation = ARC_TESSELLATION): Pt[] {
  const n = piecesOf(e, tess);
  if (n === 1) return [e.a];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(i === 0 ? e.a : pointOnEdge(e, i / n));
  return out;
}

/** The arc of the same circle as `e` from p to q, turning the way `e` turns: its bulge. */
export function concentricBulge(e: Edge, p: Pt, q: Pt): number {
  const arc = edgeArc(e);
  if (!arc) return 0;
  const raw = Math.atan2(q.y - arc.center.y, q.x - arc.center.x) - Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  // of the turns from p to q, the one nearest the edge's own
  const candidates = [raw - TAU, raw, raw + TAU];
  const sweep = candidates.reduce((best, s) => (Math.abs(s - arc.sweep) < Math.abs(best - arc.sweep) ? s : best));
  return Math.tan(sweep / 4);
}

/** The part of an edge from parameter t0 to t1, as an edge of its own. */
export function subEdge(e: Edge, t0: number, t1: number): Edge {
  const a = pointOnEdge(e, t0);
  const b = pointOnEdge(e, t1);
  const arc = edgeArc(e);
  return { a, b, bulge: arc ? Math.tan((arc.sweep * (t1 - t0)) / 4) : 0 };
}

// ---------------------------------------------------------------------------- curves and where they meet

/** A whole line or a whole circle: what an edge, or a wall's face, runs along. */
export type Curve = { readonly kind: "line"; readonly p: Pt; readonly d: Pt } | { readonly kind: "circle"; readonly c: Pt; readonly r: number };

export function curveOfEdge(e: Edge): Curve {
  const arc = edgeArc(e);
  return arc ? { kind: "circle", c: arc.center, r: arc.radius } : { kind: "line", p: e.a, d: { x: e.b.x - e.a.x, y: e.b.y - e.a.y } };
}

function lineCircle(p: Pt, d: Pt, c: Pt, r: number): Pt[] {
  const len = Math.hypot(d.x, d.y);
  if (len < EPS) return [];
  const ux = d.x / len;
  const uy = d.y / len;
  const fx = p.x - c.x;
  const fy = p.y - c.y;
  const b = fx * ux + fy * uy;
  // |f|² − r² as a product: on a circle of huge radius the two squares cancel and lose millimetres
  const f = Math.hypot(fx, fy);
  const disc = b * b - (f - r) * (f + r);
  if (disc < -EPS) return [];
  if (disc <= EPS) return [{ x: p.x - b * ux, y: p.y - b * uy }];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s].map((k) => ({ x: p.x + k * ux, y: p.y + k * uy }));
}

/** Where two curves meet: none, one or two points (a line along another, or a circle on itself, meets it nowhere here). */
export function intersectCurves(c1: Curve, c2: Curve): Pt[] {
  if (c1.kind === "line" && c2.kind === "line") {
    const den = c1.d.x * c2.d.y - c1.d.y * c2.d.x;
    const scale = Math.hypot(c1.d.x, c1.d.y) * Math.hypot(c2.d.x, c2.d.y);
    if (scale < EPS || Math.abs(den) / scale < 1e-12) return [];
    const t = ((c2.p.x - c1.p.x) * c2.d.y - (c2.p.y - c1.p.y) * c2.d.x) / den;
    return [{ x: c1.p.x + c1.d.x * t, y: c1.p.y + c1.d.y * t }];
  }
  if (c1.kind === "line" && c2.kind === "circle") return lineCircle(c1.p, c1.d, c2.c, c2.r);
  if (c1.kind === "circle" && c2.kind === "line") return lineCircle(c2.p, c2.d, c1.c, c1.r);
  const a = c1 as Extract<Curve, { kind: "circle" }>;
  const b = c2 as Extract<Curve, { kind: "circle" }>;
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > a.r + b.r + EPS || d < Math.abs(a.r - b.r) - EPS) return [];
  // measured from the smaller circle, its differences of squares as products: a nearly straight
  // edge's circle is kilometres across, and the plain formula's squares cancel to millimetres
  const small = a.r <= b.r ? a : b;
  const large = small === a ? b : a;
  const toLarge = small === a ? 1 : -1;
  const alongSmall = ((d - large.r) * (d + large.r) + small.r * small.r) / (2 * d);
  const h2 = (small.r - alongSmall) * (small.r + alongSmall);
  const mx = small.c.x + (toLarge * dx * alongSmall) / d;
  const my = small.c.y + (toLarge * dy * alongSmall) / d;
  if (h2 <= EPS) return [{ x: mx, y: my }];
  const h = Math.sqrt(h2);
  return [
    { x: mx + (dy * h) / d, y: my - (dx * h) / d },
    { x: mx - (dy * h) / d, y: my + (dx * h) / d },
  ];
}

/** The parameter of a point of an edge's curve along the edge (it may fall outside 0..1). */
function paramOn(e: Edge, p: Pt): number {
  const arc = edgeArc(e);
  if (!arc) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const l2 = dx * dx + dy * dy;
    return l2 === 0 ? 0 : ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / l2;
  }
  const t = sweepTo(arc, p) / arc.sweep;
  // past its end, a point just before its start reads as just under 0, not just under 1/|sweep|·2π
  const back = t - TAU / Math.abs(arc.sweep);
  return t > 1 && Math.abs(back) < t - 1 ? back : t;
}

/** Where two edges cross or touch: each point, with its parameter along both. */
export function edgeIntersections(e1: Edge, e2: Edge, eps = 1e-9): { p: Pt; t1: number; t2: number }[] {
  return intersectCurves(curveOfEdge(e1), curveOfEdge(e2))
    .map((p) => ({ p, t1: paramOn(e1, p), t2: paramOn(e2, p) }))
    .filter(({ t1, t2 }) => t1 >= -eps && t1 <= 1 + eps && t2 >= -eps && t2 <= 1 + eps);
}

/** Do two edges run along each other for a stretch (on one line, or one circle)? */
export function edgesOverlap(e1: Edge, e2: Edge, eps = 1e-7): boolean {
  const c1 = curveOfEdge(e1);
  const c2 = curveOfEdge(e2);
  const onBoth = (e: Edge, p: Pt) => closestOnEdge(e, p).distance < eps;
  if (c1.kind !== c2.kind) return false;
  if (c1.kind === "line" && c2.kind === "line") {
    if (!onLine(c1, e2.a, eps) || !onLine(c1, e2.b, eps)) return false;
  } else if (c1.kind === "circle" && c2.kind === "circle") {
    if (Math.hypot(c1.c.x - c2.c.x, c1.c.y - c2.c.y) > eps || Math.abs(c1.r - c2.r) > eps) return false;
  }
  // on one curve: they share a stretch when an end, or the middle, of one lies inside the other
  const inside = (e: Edge, p: Pt) => {
    const c = closestOnEdge(e, p);
    return c.distance < eps && c.t > 1e-6 && c.t < 1 - 1e-6;
  };
  const m1 = pointOnEdge(e1, 0.5);
  const m2 = pointOnEdge(e2, 0.5);
  return inside(e1, e2.a) || inside(e1, e2.b) || inside(e2, e1.a) || inside(e2, e1.b) || (onBoth(e1, m2) && onBoth(e2, m1));
}

function onLine(l: Extract<Curve, { kind: "line" }>, p: Pt, eps: number): boolean {
  const len = Math.hypot(l.d.x, l.d.y) || 1;
  return Math.abs((p.x - l.p.x) * l.d.y - (p.y - l.p.y) * l.d.x) / len < eps;
}

// ---------------------------------------------------------------------------- outlines

/** A rectangle's outline: its four corners, clockwise on the sheet from the top-left one. */
export const rectOutline = (x: number, y: number, w: number, h: number): RoomVertex[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** An outline's edges, each from a corner to the next, with the first corner's bulge on the first. */
export const outlineEdges = (points: readonly RoomVertex[]): Edge[] =>
  points.map((p, i) => {
    const b = points[(i + 1) % points.length];
    return { a: p, b, bulge: edgeBulge(p, b, p.bulge) };
  });

/** The area between an arc and its chord. */
function segmentArea(e: Edge): number {
  const arc = edgeArc(e);
  if (!arc) return 0;
  const th = Math.abs(arc.sweep);
  return ((arc.radius * arc.radius) / 2) * (th - Math.sin(th)) * Math.sign(e.bulge);
}

/** An outline's signed area: positive wound the way normalizeOutline keeps it. */
export function outlineArea(points: readonly RoomVertex[]): number {
  let sum = 0;
  for (const e of outlineEdges(points)) sum += (e.a.x * e.b.y - e.b.x * e.a.y) / 2 + segmentArea(e);
  return sum;
}

/** A room's floor area, square metres. */
export const roomArea = (r: { readonly points: readonly RoomVertex[] }): number => Math.abs(outlineArea(r.points));

export const outlinePerimeter = (points: readonly RoomVertex[]): number => outlineEdges(points).reduce((s, e) => s + edgeLength(e), 0);

/**
 * The same outline, kept one way: no corner twice in a row, wound so its area is positive (a
 * positive bulge then bows out of it). Reversing it reverses every edge, so each bulge moves to
 * the edge's other end and changes sign. Fresh objects; a straight edge carries no bulge.
 */
export function normalizeOutline(points: readonly RoomVertex[]): RoomVertex[] {
  const kept: RoomVertex[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < EPS) {
      // the edge that remains is the one leaving the later copy
      kept[kept.length - 1] = vertex(last.x, last.y, p.bulge);
    } else kept.push(vertex(p.x, p.y, p.bulge));
  }
  while (kept.length > 1 && Math.hypot(kept[0].x - kept[kept.length - 1].x, kept[0].y - kept[kept.length - 1].y) < EPS) kept.pop();
  // an edge bowed less than STRAIGHT_SAGITTA is kept straight
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i];
    if (p.bulge !== undefined && edgeBulge(p, kept[(i + 1) % kept.length], p.bulge) === 0) kept[i] = { x: p.x, y: p.y };
  }
  if (outlineArea(kept) >= 0) return kept;
  const n = kept.length;
  return kept.map((_, k) => {
    const p = kept[n - 1 - k];
    const b = kept[(((n - 2 - k) % n) + n) % n].bulge;
    return vertex(p.x, p.y, b === undefined ? undefined : -b);
  });
}

const vertex = (x: number, y: number, bulge: number | undefined): RoomVertex => (isStraight(bulge) ? { x, y } : { x, y, bulge });

/**
 * The first two edges of an outline that cross, touch or run along each other anywhere but at
 * the corner they share: their indices, or null when the outline is a simple one.
 */
export function outlineSelfIntersection(points: readonly RoomVertex[], eps = 1e-7): [number, number] | null {
  const edges = outlineEdges(points);
  const n = edges.length;
  const boxes = edges.map(edgeBox);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = boxes[i];
      const bj = boxes[j];
      if (bi.maxX < bj.minX - eps || bj.maxX < bi.minX - eps || bi.maxY < bj.minY - eps || bj.maxY < bi.minY - eps) continue;
      if (edgesOverlap(edges[i], edges[j], eps)) return [i, j];
      const next = j === i + 1;
      const wrap = i === 0 && j === n - 1;
      // the corner adjacent edges share is where they are meant to meet: whether they meet again
      // is read off where their curves meet besides it, found from it exactly (not as one of two
      // intersections, which on a nearly straight arc's huge circle lands millimetres off it)
      const shared = next ? edges[j].a : wrap ? edges[i].a : null;
      const hits = shared ? meetsAgain(edges[i], edges[j], shared, eps) : edgeIntersections(edges[i], edges[j], 1e-9).length > 0;
      if (hits) return [i, j];
    }
  }
  return null;
}

/**
 * Whether two edges that share the corner `shared` meet anywhere else: the second point their
 * curves meet at (a line's other crossing of a circle, the reflection of the corner across the
 * line of two circles' centres; two lines meet only there), when it lies on both edges and
 * farther than eps from the corner.
 */
function meetsAgain(e1: Edge, e2: Edge, shared: Pt, eps: number): boolean {
  const c1 = curveOfEdge(e1);
  const c2 = curveOfEdge(e2);
  let other: Pt;
  if (c1.kind === "line" && c2.kind === "line") return false;
  if (c1.kind === "circle" && c2.kind === "circle") {
    const small = c1.r <= c2.r ? c1 : c2;
    const large = small === c1 ? c2 : c1;
    const d = Math.hypot(large.c.x - small.c.x, large.c.y - small.c.y);
    if (d < EPS) return false;
    const ux = (large.c.x - small.c.x) / d;
    const uy = (large.c.y - small.c.y) / d;
    const vx = shared.x - small.c.x;
    const vy = shared.y - small.c.y;
    const k = 2 * (vx * ux + vy * uy);
    other = { x: small.c.x + k * ux - vx, y: small.c.y + k * uy - vy };
  } else {
    const line = (c1.kind === "line" ? c1 : c2) as Extract<Curve, { kind: "line" }>;
    const circle = (c1.kind === "circle" ? c1 : c2) as Extract<Curve, { kind: "circle" }>;
    const len = Math.hypot(line.d.x, line.d.y);
    if (len < EPS) return false;
    const ux = line.d.x / len;
    const uy = line.d.y / len;
    const k = -2 * ((shared.x - circle.c.x) * ux + (shared.y - circle.c.y) * uy);
    other = { x: shared.x + k * ux, y: shared.y + k * uy };
  }
  if (Math.hypot(other.x - shared.x, other.y - shared.y) <= eps) return false;
  const t1 = paramOn(e1, other);
  const t2 = paramOn(e2, other);
  const tol = 1e-9;
  return t1 >= -tol && t1 <= 1 + tol && t2 >= -tol && t2 <= 1 + tol;
}

/** Is p inside the outline (strictly inside or on it: undecided — test against a distance)? */
export function pointInOutline(p: Pt, points: readonly RoomVertex[]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  // the region between each arc and its chord turns the answer over (mod 2, the chord polygon
  // and those segments add up to the outline)
  for (const e of outlineEdges(points)) {
    const arc = edgeArc(e);
    if (!arc) continue;
    const n2 = chordNormal(e.a, e.b);
    const side = (n2.x * (p.x - e.a.x) + n2.y * (p.y - e.a.y)) * Math.sign(e.bulge);
    if (side > 0 && Math.hypot(p.x - arc.center.x, p.y - arc.center.y) < arc.radius) inside = !inside;
  }
  return inside;
}

/** How far p is from the outline's edge. */
export const outlineDistance = (p: Pt, points: readonly RoomVertex[]): number =>
  outlineEdges(points).reduce((best, e) => Math.min(best, closestOnEdge(e, p).distance), Infinity);

/** The bounds of an outline, its arcs' bulges included. */
export function outlineBox(points: readonly RoomVertex[]): Box {
  const boxes = outlineEdges(points).map(edgeBox);
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

/** The rectangle around an outline: its top-left corner and size. */
export function outlineBounds(points: readonly RoomVertex[]): { x: number; y: number; w: number; h: number } {
  const b = outlineBox(points);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/** The rectangle an outline is, when it is one with sides along the axes; null for any other shape. */
export function outlineRect(points: readonly RoomVertex[]): { x: number; y: number; w: number; h: number } | null {
  if (points.length !== 4 || points.some((p) => !isStraight(p.bulge))) return null;
  const r = outlineBounds(points);
  const corners = rectOutline(r.x, r.y, r.w, r.h);
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  return points.every((p) => corners.some((c) => near(p, c))) && corners.every((c) => points.some((p) => near(p, c))) ? r : null;
}

/** An outline as a polygon of straight edges, arcs cut into pieces. */
export const tessellateOutline = (points: readonly RoomVertex[], tess: Tessellation = ARC_TESSELLATION): Pt[] =>
  outlineEdges(points).flatMap((e) => tessellateEdge(e, tess));

/** The area centroid of a polygon of straight edges. */
export function polygonCentroid(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < EPS) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export const translateOutline = (points: readonly RoomVertex[], dx: number, dy: number): RoomVertex[] =>
  points.map((p) => vertex(p.x + dx, p.y + dy, p.bulge));

/**
 * The outline stretched, from its bounds' top-left corner, to bounds w × h. Every corner moves;
 * an arc edge keeps its bulge, so it stays an arc between its corners' new places.
 */
export function stretchOutline(points: readonly RoomVertex[], w: number, h: number): RoomVertex[] {
  const r = outlineBounds(points);
  const sx = r.w > EPS ? w / r.w : 1;
  const sy = r.h > EPS ? h / r.h : 1;
  return normalizeOutline(points.map((p) => vertex(r.x + (p.x - r.x) * sx, r.y + (p.y - r.y) * sy, p.bulge)));
}

// ---------------------------------------------------------------------------- the most interior point

/** A small binary max-heap on `key`. */
class Heap<T> {
  private readonly items: T[] = [];
  constructor(private readonly key: (t: T) => number) {}
  get size(): number {
    return this.items.length;
  }
  push(t: T): void {
    const a = this.items;
    a.push(t);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.key(a[up]) >= this.key(a[i])) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]) > this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) > this.key(a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A point inside the outline as far from its edge as can be found, and that distance. */
export interface Anchor extends Pt {
  /** the distance to the nearest edge: the radius of the widest circle inside the room there */
  readonly clearance: number;
}

/** The most cells the search for an anchor looks at; far more than a room of 100 corners needs. */
const ANCHOR_CELLS = 20_000;
const anchors = new WeakMap<readonly RoomVertex[], Anchor>();

/**
 * The outline's pole of inaccessibility: the point inside it farthest from its edge, found to
 * within ROOM_SHAPE.anchorPrecision (a quadtree search over the bounds, cells taken in the order
 * of the best they could hold). Where a room's name goes: inside an L, never at the corner the
 * centroid of an L falls near. Kept per outline array, which a room never changes in place.
 */
export function outlineAnchor(points: readonly RoomVertex[], precision: number = ROOM_SHAPE.anchorPrecision): Anchor {
  const cached = anchors.get(points);
  if (cached) return cached;
  const signed = (p: Pt) => (pointInOutline(p, points) ? 1 : -1) * outlineDistance(p, points);
  const box = outlineBox(points);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const size = Math.min(w, h);
  if (!(size > EPS)) {
    const p = points[0] ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y, clearance: 0 };
  }
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, half: number): Cell => {
    const d = signed({ x, y });
    return { x, y, h: half, d, max: d + half * Math.SQRT2 };
  };
  const queue = new Heap<Cell>((c) => c.max);
  const half = size / 2;
  for (let x = box.minX; x < box.maxX; x += size) for (let y = box.minY; y < box.maxY; y += size) queue.push(cell(x + half, y + half, half));
  const centroid = polygonCentroid(tessellateOutline(points));
  let best = cell(centroid.x, centroid.y, 0);
  const middle = cell(box.minX + w / 2, box.minY + h / 2, 0);
  if (middle.d > best.d) best = middle;
  let seen = 0;
  while (queue.size > 0 && seen < ANCHOR_CELLS) {
    const c = queue.pop() as Cell;
    seen++;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const q = c.h / 2;
    queue.push(cell(c.x - q, c.y - q, q));
    queue.push(cell(c.x + q, c.y - q, q));
    queue.push(cell(c.x - q, c.y + q, q));
    queue.push(cell(c.x + q, c.y + q, q));
  }
  const found: Anchor = Object.freeze({ x: best.x, y: best.y, clearance: Math.max(0, best.d) });
  anchors.set(points, found);
  return found;
}

// ---------------------------------------------------------------------------- what a room outline must be

/**
 * Why `points` cannot be a room's outline, or null when it can: its corners (ROOM_SHAPE.vertices),
 * its bulges (BULGE), no edge shorter than ROOM_SHAPE.minEdge, no edge crossing another, at least
 * ROOM_SHAPE.minArea, never narrower than ROOM_SIZE.min. Judged on the outline as normalizeOutline
 * keeps it. Written for an agent to act on.
 */
export function outlineError(points: readonly RoomVertex[], minWidth: number): string | null {
  return outlineFault(points, minWidth)?.message ?? null;
}

/**
 * What is wrong with an outline (outlineError), as data: which rule, the edges it is about (by
 * index, edge i from corner i to corner i + 1, in the order the points are given), the measure
 * that broke it, and the message an agent reads (edges numbered from 0, as the tools take them).
 * The person's surfaces word it themselves, numbering edges from 1.
 */
export type OutlineFault =
  | { kind: "corners"; edges: []; message: string }
  | { kind: "bulge"; edges: [number]; message: string }
  | { kind: "short"; edges: [number]; length: number; message: string }
  | { kind: "crossing"; edges: [number, number]; message: string }
  | { kind: "area"; edges: []; area: number; message: string }
  | { kind: "narrow"; edges: []; width: number; message: string };

/** outlineError's finding with its edges and measure, judged on the points in the order given. */
export function outlineFault(points: readonly RoomVertex[], minWidth: number): OutlineFault | null {
  const { vertices, minEdge, minArea, anchorPrecision } = ROOM_SHAPE;
  if (points.length < vertices.min || points.length > vertices.max) {
    return { kind: "corners", edges: [], message: `A room's outline has from ${vertices.min} to ${vertices.max} corners (got ${points.length}).` };
  }
  const badBulge = points.findIndex((p) => p.bulge !== undefined && !(p.bulge >= BULGE.min && p.bulge <= BULGE.max));
  if (badBulge >= 0) return { kind: "bulge", edges: [badBulge], message: `Edge ${badBulge} bends past a half circle (bulge ${String(points[badBulge].bulge)}; allowed ${BULGE.min} to ${BULGE.max}).` };
  const edges = outlineEdges(points);
  const short = edges.findIndex((e) => edgeLength(e) < minEdge - 1e-9);
  if (short >= 0) {
    const length = edgeLength(edges[short]);
    return { kind: "short", edges: [short], length, message: `Edge ${short} of the outline is ${(length * 100).toFixed(1)} cm long (min ${(minEdge * 100).toFixed(0)} cm).` };
  }
  const crossing = outlineSelfIntersection(points);
  if (crossing) return { kind: "crossing", edges: crossing, message: `Edges ${crossing[0]} and ${crossing[1]} of the outline cross or touch: a room's outline must not cross itself.` };
  const area = Math.abs(outlineArea(points));
  if (area < minArea - 1e-9) return { kind: "area", edges: [], area, message: `The outline encloses ${area.toFixed(3)} m² (min ${minArea} m²).` };
  const width = outlineAnchor(points).clearance * 2;
  if (width < minWidth - anchorPrecision) return { kind: "narrow", edges: [], width, message: `The outline is at most ${width.toFixed(2)} m wide anywhere (min ${minWidth} m).` };
  return null;
}

/** An arc asked for on one edge of a room as a tool takes it: by its sagitta (out of the room), or a point it passes. */
export type ArcInput = { edge: number; sagitta: number } | { edge: number; through: Pt };

/**
 * A room's outline from corners as given (in either winding) and the arcs asked for on some of
 * its edges, edge i running from corner i to corner i + 1: a positive sagitta bows the edge out of
 * the room, whichever way the corners were listed. Normalised; or the reason it cannot be read.
 */
export function outlineFromInput(points: readonly Pt[], arcs: readonly ArcInput[] = []): { ok: true; points: RoomVertex[] } | { ok: false; error: string } {
  const n = points.length;
  const chordArea = points.reduce((s, p, i) => s + (p.x * points[(i + 1) % n].y - points[(i + 1) % n].x * p.y), 0);
  const winding = chordArea < 0 ? -1 : 1;
  const bulges: (number | undefined)[] = points.map(() => undefined);
  for (const arc of arcs) {
    if (!Number.isInteger(arc.edge) || arc.edge < 0 || arc.edge >= n) return { ok: false, error: `arcs: edge ${arc.edge} is not one of the outline's ${n} edges (0 to ${n - 1}).` };
    if (bulges[arc.edge] !== undefined) return { ok: false, error: `arcs: edge ${arc.edge} is given twice.` };
    const a = points[arc.edge];
    const b = points[(arc.edge + 1) % n];
    const bulge = "sagitta" in arc ? winding * bulgeFromSagitta(a, b, arc.sagitta) : bulgeThrough(a, b, arc.through);
    if (bulge === null) return { ok: false, error: `arcs: the point edge ${arc.edge} should pass through is one of its ends.` };
    bulges[arc.edge] = bulge;
  }
  return { ok: true, points: normalizeOutline(points.map((p, i) => vertex(p.x, p.y, bulges[i]))) };
}

// ---------------------------------------------------------------------------- walls

/** A wall's centreline as an edge, from A to B. */
export const wallEdge = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">): Edge => ({ a: { x: w.ax, y: w.ay }, b: { x: w.bx, y: w.by }, bulge: edgeBulge({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, w.bulge) });

export const isCurved = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">): boolean => wallEdge(w).bulge !== 0;

/** A curved wall's centreline arc; null for a straight wall. */
export const wallArc = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">): Arc | null => edgeArc(wallEdge(w));

/** A wall's length along its centreline: what an opening's t and width are measured along. */
export const wallLength = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">): number => edgeLength(wallEdge(w));

/** The point at parameter t (0..1, by length) of a wall's centreline. */
export const wallPointAt = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">, t: number): Pt => pointOnEdge(wallEdge(w), t);

/** The unit direction of a wall's centreline at t, from A toward B. */
export const wallTangentAt = (w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">, t: number): Pt => tangentOnEdge(wallEdge(w), t);

/** The distance from p to a wall's centreline. */
export const wallDistance = (p: Pt, w: Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge">): number => closestOnEdge(wallEdge(w), p).distance;

/**
 * A wall as oriented rectangles, for the tests that take one (furniture against walls, stairs
 * against walls): a straight wall is one; a curved wall is one per piece of its arc, each as long
 * as its chord and thick enough to hold the arc's band over it.
 */
export function wallPieces(w: Wall, tess: Tessellation = ARC_TESSELLATION): ORect[] {
  const e = wallEdge(w);
  const n = piecesOf(e, tess);
  const out: ORect[] = [];
  for (let i = 0; i < n; i++) {
    const a = pointOnEdge(e, i / n);
    const b = pointOnEdge(e, (i + 1) / n);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const arc = edgeArc(e);
    const sag = arc ? arc.radius * (1 - Math.cos(arc.sweep / n / 2)) : 0;
    out.push({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, hw: chord / 2, hd: w.thickness / 2 + sag, rot: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  return out;
}

/** Why a curved wall's arc cannot be built at its thickness (its radius under WALL_ARC_MIN_RADIUS × thickness), or null. */
export function wallArcError(w: Wall): string | null {
  if (w.bulge !== undefined && !(w.bulge >= BULGE.min && w.bulge <= BULGE.max)) {
    return `Wall ${w.id} bends past a half circle (bulge ${String(w.bulge)}; allowed ${BULGE.min} to ${BULGE.max}).`;
  }
  const arc = wallArc(w);
  if (!arc) return null;
  const min = WALL_ARC_MIN_RADIUS * w.thickness;
  return arc.radius < min - 1e-9 ? `Wall ${w.id} bends to a ${arc.radius.toFixed(2)} m radius, tighter than its ${w.thickness} m thickness allows (min ${min.toFixed(2)} m).` : null;
}

/**
 * How far the chord of an opening `width` long (along the centreline) on this wall stands off
 * the arc at its middle: 0 on a straight wall. A straight leaf or pane across a curved wall's
 * vano stays inside the wall only while this is under half the wall's thickness.
 */
export function openingSag(w: Wall, width: number): number {
  const arc = wallArc(w);
  if (!arc) return 0;
  return arc.radius * (1 - Math.cos(Math.min(width / (2 * arc.radius), Math.PI / 2)));
}

/**
 * The wall with end `end` moved `meters` on along it (back, when negative): a straight wall along
 * its line, a curved one along its circle, so it stays the same arc. Null when the result would
 * be no wall (shorter than nothing) or bend past a half circle.
 */
export function extendedWall(w: Wall, end: "a" | "b", meters: number): Pick<Wall, "ax" | "ay" | "bx" | "by" | "bulge"> | null {
  const arc = wallArc(w);
  const len = wallLength(w);
  if (len + meters <= EPS) return null;
  if (!arc) {
    const ux = (w.bx - w.ax) / len;
    const uy = (w.by - w.ay) / len;
    return end === "b"
      ? { ax: w.ax, ay: w.ay, bx: w.bx + ux * meters, by: w.by + uy * meters }
      : { ax: w.ax - ux * meters, ay: w.ay - uy * meters, bx: w.bx, by: w.by };
  }
  const sweep = (arc.sweep * (len + meters)) / len;
  if (Math.abs(sweep) > 4 * Math.atan(BULGE.max) + 1e-12) return null;
  const at = (phi: number) => ({ x: arc.center.x + arc.radius * Math.cos(phi), y: arc.center.y + arc.radius * Math.sin(phi) });
  if (end === "b") {
    const b = at(arc.start + sweep);
    return { ax: w.ax, ay: w.ay, bx: b.x, by: b.y, bulge: Math.tan(sweep / 4) };
  }
  const a = at(arc.start + arc.sweep - sweep);
  return { ax: a.x, ay: a.y, bx: w.bx, by: w.by, bulge: Math.tan(sweep / 4) };
}

// ---------------------------------------------------------------------------- drawing

const num = (v: number): string => String(Number(v.toFixed(3)));

/**
 * An outline as SVG path data at `scale` pixels per metre: straight edges as lines, arcs as SVG
 * arcs (plan coordinates and SVG's both run y down the sheet, so a positive sweep is SVG's
 * sweep-flag 1). Closed.
 */
export function outlinePath(points: readonly RoomVertex[], scale = 1): string {
  if (points.length === 0) return "";
  const parts = [`M${num(points[0].x * scale)} ${num(points[0].y * scale)}`];
  for (const e of outlineEdges(points)) parts.push(edgePathTo(e, scale));
  return `${parts.join("")}Z`;
}

/** One edge as the path command that draws it from wherever the path is (its start). */
export function edgePathTo(e: Edge, scale = 1): string {
  const arc = edgeArc(e);
  const to = `${num(e.b.x * scale)} ${num(e.b.y * scale)}`;
  if (!arc) return `L${to}`;
  const r = num(arc.radius * scale);
  return `A${r} ${r} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 1 : 0} ${to}`;
}
