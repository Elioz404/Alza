/**
 * The room the walls enclose around a point: "fit room to walls". The walls' centrelines, cut
 * wherever one ends on or crosses another, are the edges of a plane graph; its faces are the
 * spaces the walls close off. The face round the point (the smallest one that holds it), drawn
 * in by half of each wall's thickness on its inside, is the room: its outline runs along the
 * walls' faces, an arc wherever the wall is one, so a room behind a curved facade has the
 * facade's curve.
 *
 * Plan coordinates, pure functions (shapes.ts for the arcs).
 */

import type { Pt } from "./geometry";
import type { RoomVertex, Wall } from "./types";
import { WALL_JOINT_REACH, WALL_MITRE_LIMIT } from "./limits";
import { closestOnEdge, concentricBulge, edgeArc, edgeIntersections, edgeLength, intersectCurves, isStraight, normalizeOutline, outlineArea, pointInOutline, pointOnEdge, subEdge, wallEdge, type Curve, type Edge } from "./shapes";

/** A piece of a wall between two nodes, in one direction. */
interface HalfEdge {
  readonly from: number;
  readonly to: number;
  readonly edge: Edge;
  readonly thickness: number;
  twin: HalfEdge | null;
  /** the angle it leaves its node at */
  readonly angle: number;
}

/** Parameters along a wall closer than this (as a share of it) are one cut. */
const SAME_T = 1e-6;

/** The plane graph of the walls' centrelines: nodes, and the half-edges leaving each node. */
function wallGraph(walls: readonly Wall[]): { nodes: Pt[]; out: HalfEdge[][] } {
  const edges = walls.filter((w) => Math.hypot(w.bx - w.ax, w.by - w.ay) > 0).map((w) => ({ wall: w, edge: wallEdge(w), cuts: [0, 1] }));
  // a wall is cut where another ends on its span, and where two cross
  for (const e of edges) {
    for (const o of edges) {
      if (o === e) continue;
      for (const p of [o.edge.a, o.edge.b]) {
        const c = closestOnEdge(e.edge, p);
        if (c.distance < WALL_JOINT_REACH && c.t > SAME_T && c.t < 1 - SAME_T) e.cuts.push(c.t);
      }
      for (const hit of edgeIntersections(e.edge, o.edge)) if (hit.t1 > SAME_T && hit.t1 < 1 - SAME_T) e.cuts.push(hit.t1);
    }
  }
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt): number => {
    const at = nodes.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < WALL_JOINT_REACH);
    if (at >= 0) return at;
    nodes.push(p);
    return nodes.length - 1;
  };
  const pieces: { from: number; to: number; edge: Edge; thickness: number }[] = [];
  for (const { wall, edge, cuts } of edges) {
    const ts = [...cuts].sort((p, q) => p - q).filter((t, i, all) => i === 0 || t - all[i - 1] > SAME_T);
    for (let i = 0; i + 1 < ts.length; i++) {
      const piece = subEdge(edge, ts[i], ts[i + 1]);
      const from = nodeOf(piece.a);
      const to = nodeOf(piece.b);
      if (from !== to) pieces.push({ from, to, edge: { a: nodes[from], b: nodes[to], bulge: piece.bulge }, thickness: wall.thickness });
    }
  }
  // a wall that ends in a room, touching nothing, closes nothing off: leave it out, and whatever
  // that leaves hanging, until every node joins two pieces at least
  let alive = pieces;
  for (;;) {
    const degree = new Map<number, number>();
    for (const p of alive) {
      degree.set(p.from, (degree.get(p.from) ?? 0) + 1);
      degree.set(p.to, (degree.get(p.to) ?? 0) + 1);
    }
    const kept = alive.filter((p) => (degree.get(p.from) ?? 0) > 1 && (degree.get(p.to) ?? 0) > 1);
    if (kept.length === alive.length) break;
    alive = kept;
  }
  const out: HalfEdge[][] = nodes.map(() => []);
  const leaving = (from: number, edge: Edge): number => {
    const step = Math.min(0.01 / Math.max(edgeLength(edge), 1e-9), 0.1);
    const q = pointOnEdge(edge, step);
    return Math.atan2(q.y - nodes[from].y, q.x - nodes[from].x);
  };
  for (const p of alive) {
    const back: Edge = { a: p.edge.b, b: p.edge.a, bulge: -p.edge.bulge };
    const h1: HalfEdge = { from: p.from, to: p.to, edge: p.edge, thickness: p.thickness, twin: null, angle: leaving(p.from, p.edge) };
    const h2: HalfEdge = { from: p.to, to: p.from, edge: back, thickness: p.thickness, twin: h1, angle: leaving(p.to, back) };
    h1.twin = h2;
    out[p.from].push(h1);
    out[p.to].push(h2);
  }
  for (const list of out) list.sort((p, q) => p.angle - q.angle);
  return { nodes, out };
}

/**
 * The graph's faces, each as the cycle of half-edges round it. Taking, at every node, the piece
 * just before the one it came in by (in the order they leave the node) walks each bounded face
 * with positive area (shapes.ts's winding) and the outside of each group of walls with negative.
 */
function faces(out: HalfEdge[][]): HalfEdge[][] {
  const seen = new Set<HalfEdge>();
  const found: HalfEdge[][] = [];
  for (const list of out) {
    for (const start of list) {
      if (seen.has(start)) continue;
      const cycle: HalfEdge[] = [];
      let h: HalfEdge = start;
      while (!seen.has(h)) {
        seen.add(h);
        cycle.push(h);
        const at = out[h.to];
        const k = at.indexOf(h.twin as HalfEdge);
        h = at[(k - 1 + at.length) % at.length];
      }
      if (h === start) found.push(cycle);
    }
  }
  return found;
}

/** A half-edge's curve drawn in to its face's side by half its wall's thickness. */
function insetCurve(h: HalfEdge): Curve {
  const arc = edgeArc(h.edge);
  const half = h.thickness / 2;
  if (arc) return { kind: "circle", c: arc.center, r: arc.radius - Math.sign(h.edge.bulge) * half };
  const { a, b } = h.edge;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // the face lies to the right of the walk (away from the chord's positive normal)
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  return { kind: "line", p: { x: a.x + n.x * half, y: a.y + n.y * half }, d: { x: b.x - a.x, y: b.y - a.y } };
}

/** Where a half-edge's inset curve is at one of its ends: the end moved in, at right angles to it. */
function insetEnd(h: HalfEdge, t: 0 | 1): Pt {
  const p = t === 0 ? h.edge.a : h.edge.b;
  const q = pointOnEdge(h.edge, t === 0 ? 1e-6 : 1 - 1e-6);
  const dx = (q.x - p.x) * (t === 0 ? 1 : -1);
  const dy = (q.y - p.y) * (t === 0 ? 1 : -1);
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x - (dy / len) * (h.thickness / 2), y: p.y + (dx / len) * (h.thickness / 2) };
}

/** The face as a room's outline: each wall's piece moved in by half its thickness, corners where they meet. */
function insetOutline(cycle: readonly HalfEdge[]): RoomVertex[] {
  const n = cycle.length;
  const curves = cycle.map(insetCurve);
  // corners[i] is where piece i starts: where it meets the piece before it
  const starts: Pt[][] = cycle.map((h, i) => {
    const prev = (i - 1 + n) % n;
    const node = h.edge.a;
    // the room's corner is where the two inset curves meet: at a corner the room turns in at,
    // beside both pieces (half each one's thickness off it, within its span), however sharp the
    // corner and however far from the node that is; at one it turns out at (the corner lies past
    // the pieces' ends), within the mitre's reach of the node, WALL_MITRE_LIMIT thicknesses, as
    // the walls' own faces are. Two pieces nearly in line meet only far past both, and are a jog
    const beside = (piece: HalfEdge, q: Pt) => Math.abs(closestOnEdge(piece.edge, q).distance - piece.thickness / 2) < INSET_TOLERANCE;
    const reach = WALL_MITRE_LIMIT * Math.max(h.thickness, cycle[prev].thickness);
    const hits = intersectCurves(curves[prev], curves[i]).filter((q) => (beside(cycle[prev], q) && beside(h, q)) || Math.hypot(q.x - node.x, q.y - node.y) <= reach);
    if (hits.length > 0) return [hits.reduce((best, q) => (Math.hypot(q.x - node.x, q.y - node.y) < Math.hypot(best.x - node.x, best.y - node.y) ? q : best))];
    // in line: the two meet at the node, each at its own depth (one point when they are as thick)
    const a = insetEnd(cycle[prev], 1);
    const b = insetEnd(h, 0);
    return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 ? [b] : [a, b];
  });
  const outline: RoomVertex[] = [];
  for (let i = 0; i < n; i++) {
    const own = starts[i];
    const end = starts[(i + 1) % n][0];
    // a jog's first point closes the piece before it, straight
    for (let k = 0; k + 1 < own.length; k++) outline.push({ x: own[k].x, y: own[k].y });
    const p = own[own.length - 1];
    const bulge = concentricBulge(cycle[i].edge, p, end);
    outline.push(bulge === 0 ? { x: p.x, y: p.y } : { x: p.x, y: p.y, bulge });
  }
  return normalizeOutline(withoutStraightThroughCorners(outline));
}

/** How near half a piece's thickness off it a corner of the inset outline must lie, metres. */
const INSET_TOLERANCE = 1e-6;

/** Sines of the turn smaller than this, between two straight edges, are no turn. */
const NO_TURN = 1e-9;

/**
 * The outline without the corners it runs straight through. A wall that meets the room's side
 * from outside (a wing leaving the house, a partition on the floor above's landing) cuts its
 * centreline there, and the inset pieces on either side meet in line: a corner nobody drew,
 * which would only give the room a handle with nothing to shape.
 */
function withoutStraightThroughCorners(outline: readonly RoomVertex[]): RoomVertex[] {
  const kept = [...outline];
  for (let i = 0; kept.length > 3 && i < kept.length; ) {
    const prev = kept[(i - 1 + kept.length) % kept.length];
    const here = kept[i];
    const next = kept[(i + 1) % kept.length];
    const ax = here.x - prev.x;
    const ay = here.y - prev.y;
    const bx = next.x - here.x;
    const by = next.y - here.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const straight = isStraight(prev.bulge) && isStraight(here.bulge);
    if (straight && la > 0 && lb > 0 && Math.abs(ax * by - ay * bx) / (la * lb) < NO_TURN && ax * bx + ay * by > 0) kept.splice(i, 1);
    else i++;
  }
  return kept;
}

/**
 * The outline of the room the walls close off around `p`, or null when no walls close one off
 * there. `walls` are one level's.
 */
export function enclosedOutline(walls: readonly Wall[], p: Pt): RoomVertex[] | null {
  const { out } = wallGraph(walls);
  const around = faces(out)
    .map((cycle) => ({ cycle, outline: cycle.map((h): RoomVertex => ({ x: h.edge.a.x, y: h.edge.a.y, bulge: h.edge.bulge })) }))
    .map((f) => ({ ...f, area: outlineArea(f.outline) }))
    .filter((f) => f.area > 0 && pointInOutline(p, f.outline))
    .sort((a, b) => a.area - b.area);
  return around.length === 0 ? null : insetOutline(around[0].cycle);
}
