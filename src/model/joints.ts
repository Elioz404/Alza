/**
 * Where walls meet. A wall's centreline stops at its endpoints, but a solid built from it must
 * reach on into the wall it joins, or every corner shows a notch. Three answers, for three kinds
 * of solid, straight and curved walls alike, at any angle:
 *  - wallFootprint: the wall's exact outline on the plan, its two faces (concentric arcs on a
 *    curved wall) mitred where they meet their neighbours' faces: at an L corner both faces run
 *    on to where they meet the other wall's, at a T the stem's faces stop at the face it meets,
 *    at a node of three or more walls each face meets the next wall's round the node. Two walls
 *    that meet share their cap edge exactly, so the footprints tile the joint: no notch, no
 *    overlap. What the floors' outlines use (floors.ts), and what the plan's poché and the 3D
 *    view's wall solids are drawn from.
 *  - jointExtensions: how far each end reaches on along the wall, for a solid built as a straight
 *    (or tangent-extended) band: every end reaches into its joint, so bands close it however they
 *    overlap there.
 *  - buttJointExtensions: what the IFC export's wall bodies use. A building model's solids are
 *    checked for clashes and measured for volume, so at every joint exactly one wall fills the
 *    corner and every other one stops at its face: the walls meet, and none overlaps another.
 * All find a wall's partners the same way: an end within WALL_JOINT_REACH of another wall's end,
 * or of a point of its span.
 *
 * Its own module, apart from geometry.ts, because only the builders read it.
 */

import type { RoomVertex, Wall } from "./types";
import type { Pt } from "./geometry";
import { WALL_IN_LINE_SINE, WALL_JOINT_REACH, WALL_MITRE_LIMIT } from "./limits";
import { closestOnEdge, concentricBulge, intersectCurves, isCurved, normalizeOutline, wallArc, wallDistance, wallEdge, wallTangentAt, type Curve, type Edge } from "./shapes";

type P = Pt;
type End = "a" | "b";

const endPoint = (w: Wall, end: End): P => (end === "a" ? { x: w.ax, y: w.ay } : { x: w.bx, y: w.by });
const near = (p: P, q: P): boolean => Math.hypot(p.x - q.x, p.y - q.y) < WALL_JOINT_REACH;

/** The unit direction from an end of a wall into it: along its tangent there. */
function into(w: Wall, end: End): P {
  const u = wallTangentAt(w, end === "a" ? 0 : 1);
  return end === "a" ? u : { x: -u.x, y: -u.y };
}

const hasLength = (w: Wall): boolean => Math.hypot(w.bx - w.ax, w.by - w.ay) > 0;
const inLine = (u: P, v: P): boolean => Math.abs(u.x * v.y - u.y * v.x) < WALL_IN_LINE_SINE;

/**
 * How far a wall's two ends reach past its endpoints: an end that touches another wall is
 * extended by half the partner's thickness, for a clean joint. This is the one thing a wall's
 * band takes from its neighbours, so a neighbour that moves changes a wall exactly when it
 * changes these two numbers. A curved wall's end reaches on along its tangent there.
 */
export function jointExtensions(wall: Wall, walls: readonly Wall[]): [number, number] {
  const a = endPoint(wall, "a");
  const b = endPoint(wall, "b");
  let extA = 0;
  let extB = 0;
  for (const o of walls) {
    if (o.id === wall.id) continue;
    for (const e of [endPoint(o, "a"), endPoint(o, "b")]) {
      // extend just up to the partner's OUTER face — extending further pokes past the corner (X artifact)
      if (near(e, a)) extA = Math.max(extA, o.thickness / 2);
      if (near(e, b)) extB = Math.max(extB, o.thickness / 2);
    }
    // T-junction: our endpoint lands mid-span of the partner, reaching on to the partner's
    // middle, not through it: an end at its far face would lie in that face's plane, and its
    // sides would show through it as a seam on the far side
    const dA = wallDistance(a, o);
    const dB = wallDistance(b, o);
    if (dA < WALL_JOINT_REACH) extA = Math.max(extA, dA);
    if (dB < WALL_JOINT_REACH) extB = Math.max(extB, dB);
  }
  return [extA, extB];
}

/** The direction of a wall at the point of it nearest p (for a wall another one ends against). */
function tangentNear(o: Wall, p: P): P {
  return wallTangentAt(o, closestOnEdge(wallEdge(o), p).t);
}

/** Whether wall `w` runs on, in line, into another wall at its end `end`: that end is no corner. */
function continuesAt(w: Wall, end: End, walls: readonly Wall[]): boolean {
  if (!hasLength(w)) return false;
  const p = endPoint(w, end);
  const u = into(w, end);
  return walls.some((o) => {
    if (o.id === w.id || !hasLength(o)) return false;
    return (["a", "b"] as const).some((oe) => near(endPoint(o, oe), p) && inLine(u, into(o, oe)));
  });
}

/** The distances e along the ray p + e·d (d a unit vector) at which it meets a face. */
function rayToFace(p: P, d: P, face: Curve): number[] {
  if (face.kind === "line") {
    const len = Math.hypot(face.d.x, face.d.y) || 1;
    const n = { x: -face.d.y / len, y: face.d.x / len };
    const along = n.x * d.x + n.y * d.y;
    if (Math.abs(along) < 1e-12) return [];
    return [(n.x * (face.p.x - p.x) + n.y * (face.p.y - p.y)) / along];
  }
  const fx = p.x - face.c.x;
  const fy = p.y - face.c.y;
  const b = fx * d.x + fy * d.y;
  const disc = b * b - (fx * fx + fy * fy - face.r * face.r);
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/**
 * A wall's face as a whole curve: its centreline offset `offset` to its left (negative to its
 * right) — a line beside a straight wall, a concentric circle beside a curved one.
 */
export function offsetCurve(w: Wall, offset: number): Curve {
  const arc = wallArc(w);
  if (arc) return { kind: "circle", c: arc.center, r: arc.radius + Math.sign(w.bulge ?? 0) * offset };
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay) || 1;
  const n = { x: (w.by - w.ay) / len, y: -(w.bx - w.ax) / len };
  return { kind: "line", p: { x: w.ax + n.x * offset, y: w.ay + n.y * offset }, d: { x: w.bx - w.ax, y: w.by - w.ay } };
}

/**
 * How far a wall's two ends reach past its endpoints in a building model, where no two walls
 * may overlap; negative where an end is cut back. At each end, against every wall it meets:
 *  - a wall running on in line: the two butt at the shared point (nothing added);
 *  - a wall it ends against mid-span, or one running through the joint (it continues in line on
 *    the far side): this end stops at that wall's near face;
 *  - an L corner, two walls ending at the same point: the wall whose id sorts first reaches on
 *    to the other's far face and fills the corner; the other stops at its near face.
 * An end in line with another is never cut back or extended, since every other wall meeting
 * there stops at it. Met by several walls it cuts back to the nearest face, so it overlaps none.
 * Measured along the wall's tangent at the end, to the partner's face, a line or a concentric
 * circle.
 */
export function buttJointExtensions(wall: Wall, walls: readonly Wall[]): [number, number] {
  if (!hasLength(wall)) return [0, 0];
  const reach = (end: End): number => {
    if (continuesAt(wall, end, walls)) return 0;
    const p = endPoint(wall, end);
    const inward = into(wall, end);
    const outward = { x: -inward.x, y: -inward.y };
    const trims: number[] = [];
    const extensions: number[] = [];
    for (const o of walls) {
      if (o.id === wall.id || !hasLength(o)) continue;
      if (wallDistance(p, o) >= WALL_JOINT_REACH) continue;
      const v = tangentNear(o, p);
      if (inLine(inward, v)) continue;
      // which side of o this wall's body lies on: opposite `outward`, read off o's left normal
      // where it meets o (for a curved o, its radial direction there)
      const left = { x: v.y, y: -v.x };
      const side = -Math.sign(left.x * outward.x + left.y * outward.y);
      const toFace = (offset: number): number | null => {
        const hits = rayToFace(p, outward, offsetCurve(o, offset));
        return hits.length === 0 ? null : hits.reduce((best, e) => (Math.abs(e) < Math.abs(best) ? e : best));
      };
      const oEnd = (["a", "b"] as const).find((e) => near(endPoint(o, e), p));
      const corner = oEnd !== undefined && !continuesAt(o, oEnd, walls);
      if (corner && wall.id < o.id) {
        const e = toFace((-side * o.thickness) / 2);
        if (e !== null) extensions.push(e);
      } else {
        const e = toFace((side * o.thickness) / 2);
        if (e !== null) trims.push(e);
      }
    }
    if (trims.length > 0) return Math.min(...trims);
    return extensions.length > 0 ? Math.max(...extensions) : 0;
  };
  return [reach("a"), reach("b")];
}

// ---------------------------------------------------------------------------- footprints

/**
 * A wall's exact outline on the plan. `left` and `right` are its two faces, each from its A end
 * to its B end (straight, or an arc concentric with the centreline, by its bulge). The caps close
 * them: `capA` from right.a to left.a, `capB` from left.b to right.b, through the joint's point
 * where three or more walls meet there (or where a straight cap would cut across a curved face at a
 * sharp L), and through the corner a face runs on straight to when its circle bends away from the
 * face it meets. `outline` is all of it as one closed outline (shapes.ts),
 * wound with positive area, the faces' arcs as bulges: what a renderer fills, or tessellates.
 */
export interface WallFootprint {
  readonly left: Edge;
  readonly right: Edge;
  readonly capA: readonly Pt[];
  readonly capB: readonly Pt[];
  /**
   * The bulge of each cap where it is one edge: 0, except where the wall stops against a curved
   * wall's face (a T on an arc), where the cap follows that face's arc.
   */
  readonly capABulge: number;
  readonly capBBulge: number;
  readonly outline: readonly RoomVertex[];
}

/** One wall leaving a joint: which wall, which way (unit, away from the joint) and how its faces lie. */
interface Arm {
  readonly wall: Wall;
  /** where the wall is at the joint: its end there, or the point of its span nearest it */
  readonly at: P;
  readonly d: P;
  /** a wall the joint is in the middle of (a T's top), rather than one ending there */
  readonly through: boolean;
}

/** The face of an arm on the side d turns to when rotated a quarter turn positively, or negatively. */
function armFace(arm: Arm, plus: boolean): Curve {
  const u = tangentNear(arm.wall, arm.at);
  // heading toward B, the positive side is the wall's right; heading toward A, its left
  const towardB = u.x * arm.d.x + u.y * arm.d.y > 0;
  const leftSide = towardB ? !plus : plus;
  return offsetCurve(arm.wall, ((leftSide ? 1 : -1) * arm.wall.thickness) / 2);
}

/** Every wall at the joint p (the wall `self` ending there among them), sorted by the angle they leave at. */
function armsAt(self: Wall, end: End, walls: readonly Wall[]): Arm[] {
  const p = endPoint(self, end);
  const arms: Arm[] = [{ wall: self, at: p, d: into(self, end), through: false }];
  for (const o of walls) {
    if (o.id === self.id || !hasLength(o)) continue;
    const oEnd = (["a", "b"] as const).find((e) => near(endPoint(o, e), p));
    if (oEnd) {
      arms.push({ wall: o, at: endPoint(o, oEnd), d: into(o, oEnd), through: false });
      continue;
    }
    const c = closestOnEdge(wallEdge(o), p);
    if (c.distance >= WALL_JOINT_REACH) continue;
    const u = wallTangentAt(o, c.t);
    arms.push({ wall: o, at: c.point, d: u, through: true }, { wall: o, at: c.point, d: { x: -u.x, y: -u.y }, through: true });
  }
  const angle = (a: Arm) => Math.atan2(a.d.y, a.d.x);
  return arms.sort((x, y) => angle(x) - angle(y));
}

/** Where an arm's face is at the joint: the point of the face beside the arm's own point there, and the unit direction along the face away from the joint. */
function faceAtJoint(arm: Arm, face: Curve): { at: P; d: P } {
  if (face.kind === "line") {
    const len = Math.hypot(face.d.x, face.d.y) || 1;
    const u = { x: face.d.x / len, y: face.d.y / len };
    const k = (arm.at.x - face.p.x) * u.x + (arm.at.y - face.p.y) * u.y;
    const s = Math.sign(u.x * arm.d.x + u.y * arm.d.y) || 1;
    return { at: { x: face.p.x + u.x * k, y: face.p.y + u.y * k }, d: { x: u.x * s, y: u.y * s } };
  }
  const rx = arm.at.x - face.c.x;
  const ry = arm.at.y - face.c.y;
  const rl = Math.hypot(rx, ry) || 1;
  const at = { x: face.c.x + (rx / rl) * face.r, y: face.c.y + (ry / rl) * face.r };
  const t = { x: -ry / rl, y: rx / rl };
  const s = Math.sign(t.x * arm.d.x + t.y * arm.d.y) || 1;
  return { at, d: { x: t.x * s, y: t.y * s } };
}

/** How far q lies along a face from its point at the joint, positive into the arm's wall, negative on past its end (round the circle, the short way, on a curved face). */
function alongFace(face: Curve, from: { at: P; d: P }, q: P): number {
  if (face.kind === "line") return (q.x - from.at.x) * from.d.x + (q.y - from.at.y) * from.d.y;
  const ux = from.at.x - face.c.x;
  const uy = from.at.y - face.c.y;
  const vx = q.x - face.c.x;
  const vy = q.y - face.c.y;
  const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  // the direction of growing angle at `at` is (−uy, ux): the arm runs that way, or against it
  const s = Math.sign(-uy * from.d.x + ux * from.d.y) || 1;
  return s * angle * face.r;
}

/** The point of a face nearest q. */
function onFace(face: Curve, q: P): P {
  if (face.kind === "line") {
    const len2 = face.d.x * face.d.x + face.d.y * face.d.y || 1;
    const k = ((q.x - face.p.x) * face.d.x + (q.y - face.p.y) * face.d.y) / len2;
    return { x: face.p.x + face.d.x * k, y: face.p.y + face.d.y * k };
  }
  const rx = q.x - face.c.x;
  const ry = q.y - face.c.y;
  const rl = Math.hypot(rx, ry) || 1;
  return { x: face.c.x + (rx / rl) * face.r, y: face.c.y + (ry / rl) * face.r };
}

/**
 * Where two faces meet at a joint: the corner the two walls' footprints share, and where each
 * face stops on its own line or circle on the way to it (the corner itself, unless a face had to
 * be carried on straight).
 */
interface Mitre {
  readonly corner: P;
  readonly aEnd: P;
  readonly bEnd: P;
}

/**
 * Where the face of arm `a` on its `plus` side meets the facing face of arm `b` (its other side).
 * Read by where a point lies along each face, not by how far it is from the joint: a face circle
 * can meet the other face round the circle past the wall's end, or on its far branch, and neither
 * is the corner. Of the faces' meeting points within WALL_MITRE_LIMIT thicknesses along both
 * faces, the one nearest the mitre of their tangents at the joint (where two straight walls'
 * faces would meet). Failing any — a face circle bending away from the other face — the corner is
 * that tangents' mitre, within the same reach, and each face stops at its point nearest it and
 * runs on straight to it, so neither face leaves its own circle. Null when neither is (the walls
 * run too nearly along each other: square ends). The same answer whichever of the two arms asks,
 * so the two walls share the cap.
 */
function mitre(a: Arm, plus: boolean, b: Arm, tangentsOnly = false): Mitre | null {
  const fa = armFace(a, plus);
  const fb = armFace(b, !plus);
  const ja = faceAtJoint(a, fa);
  const jb = faceAtJoint(b, fb);
  const limit = WALL_MITRE_LIMIT * Math.max(a.wall.thickness, b.wall.thickness);
  const m0 = intersectCurves({ kind: "line", p: ja.at, d: ja.d }, { kind: "line", p: jb.at, d: jb.d })[0] ?? null;
  if (!m0) return null;
  const straightA = (m0.x - ja.at.x) * ja.d.x + (m0.y - ja.at.y) * ja.d.y;
  const straightB = (m0.x - jb.at.x) * jb.d.x + (m0.y - jb.at.y) * jb.d.y;
  if (Math.abs(straightA) > limit || Math.abs(straightB) > limit) return null;
  // a corner lies on the side of the joint the tangents' mitre does along each face: past the
  // walls' ends round the outside of the turn, short of them inside it
  const side = (along: number, straight: number) => Math.abs(along) <= limit && along * straight >= 0;
  const hits = intersectCurves(fa, fb)
    .map((q) => ({ q, a: alongFace(fa, ja, q), b: alongFace(fb, jb, q) }))
    .filter((h) => side(h.a, straightA) && side(h.b, straightB));
  if (hits.length > 0 && !tangentsOnly) {
    // the first the two faces reach coming in along the walls: past it, a face would run on
    // across the other wall's
    const corner = hits.reduce((best, h) => (h.a + h.b > best.a + best.b ? h : best)).q;
    return { corner, aEnd: corner, bEnd: corner };
  }
  return { corner: m0, aEnd: onFace(fa, m0), bEnd: onFace(fb, m0) };
}

/** Two points closer than this are one (a face that stops at the corner it meets). */
const SAME_POINT = 1e-9;
const same = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y) < SAME_POINT;
/** How far in from its ends (a share of its length) a face must cross a cap to cut across it, not just meet it at its corners. */
const CAP_INTERIOR = 1e-6;

/**
 * One end of a wall's footprint: where its positive and negative faces stop, the corners of the
 * cap between them (from the positive face's end round to the negative's: a corner a face runs
 * on straight to, the joint's point where three or more walls meet), and the bulge of a cap that
 * is one arc.
 */
function footEnd(wall: Wall, end: End, walls: readonly Wall[]): { plus: P; minus: P; between: P[]; bulge: number } {
  const p = endPoint(wall, end);
  const d = into(wall, end);
  const half = wall.thickness / 2;
  const square = (plus: boolean): P => {
    const s = plus ? 1 : -1;
    return { x: p.x - d.y * half * s, y: p.y + d.x * half * s };
  };
  const arms = armsAt(wall, end, walls);
  const k = arms.findIndex((a) => a.wall.id === wall.id && !a.through);
  const n = arms.length;
  if (n === 1) return { plus: square(true), minus: square(false), between: [], bulge: 0 };
  const self = arms[k];
  const next = arms[(k + 1) % n];
  const prev = arms[(k - 1 + n) % n];
  // a T's stem stops along the face it meets; where three or more walls end at one point, each
  // cap runs through it, so the walls round the point tile it
  const tee = next.through && prev.through && next.wall.id === prev.wall.id;
  let mPlus = mitre(self, true, next);
  let mMinus = mitre(self, false, prev);
  let viaJoint = n >= 3 && !tee;
  // at an L the cap runs straight from corner to corner, but where a curved face meets the other
  // at a shallow angle that line can cut across a face: the cap then runs through the joint's
  // point, and failing that both corners are the tangents' mitres. Both walls of the L judge the
  // same caps against the same four faces, so they agree.
  if (n === 2 && !next.through && mPlus && mMinus) {
    // a face crosses a cap where it runs on from where it stops into its wall: past that stop the
    // face's circle is no part of the footprint
    const crossesFace = (from: P, to: P, cp: Mitre, cm: Mitre) =>
      [
        { arm: self, side: true, stop: cp.aEnd },
        { arm: self, side: false, stop: cm.aEnd },
        { arm: next, side: false, stop: cp.bEnd },
        { arm: next, side: true, stop: cm.bEnd },
      ].some(({ arm, side, stop }) => {
        const face = armFace(arm, side);
        const j = faceAtJoint(arm, face);
        const from0 = alongFace(face, j, stop);
        return intersectCurves({ kind: "line", p: from, d: { x: to.x - from.x, y: to.y - from.y } }, face).some((q) => {
          const len2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 || 1;
          const s = ((q.x - from.x) * (to.x - from.x) + (q.y - from.y) * (to.y - from.y)) / len2;
          return s > CAP_INTERIOR && s < 1 - CAP_INTERIOR && alongFace(face, j, q) > from0 + SAME_POINT;
        });
      });
    const crosses = (cp: Mitre, cm: Mitre, via: boolean) => (via ? crossesFace(cp.corner, p, cp, cm) || crossesFace(p, cm.corner, cp, cm) : crossesFace(cp.corner, cm.corner, cp, cm));
    if (crosses(mPlus, mMinus, false)) {
      viaJoint = true;
      if (crosses(mPlus, mMinus, true)) {
        const tPlus = mitre(self, true, next, true);
        const tMinus = mitre(self, false, prev, true);
        if (tPlus && tMinus) {
          mPlus = tPlus;
          mMinus = tMinus;
          viaJoint = crosses(tPlus, tMinus, false);
        }
      }
    }
  }
  const plus = mPlus ? mPlus.aEnd : square(true);
  const minus = mMinus ? mMinus.aEnd : square(false);
  const between: P[] = [];
  if (mPlus && !same(mPlus.corner, plus)) between.push(mPlus.corner);
  if (viaJoint) between.push(p);
  if (mMinus && !same(mMinus.corner, minus)) between.push(mMinus.corner);
  // stopping against a curved wall, the cap runs along that wall's face, an arc of it
  const face = tee && between.length === 0 ? armFace(next, false) : null;
  let bulge = 0;
  if (face?.kind === "circle") {
    const from = Math.atan2(plus.y - face.c.y, plus.x - face.c.x);
    const to = Math.atan2(minus.y - face.c.y, minus.x - face.c.x);
    const sweep = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    bulge = Math.tan(sweep / 4);
  }
  return { plus, minus, between, bulge };
}

/** A wall's footprint (see WallFootprint), mitred against the other walls of its level. */
export function wallFootprint(wall: Wall, walls: readonly Wall[]): WallFootprint {
  const a = footEnd(wall, "a", walls);
  const b = footEnd(wall, "b", walls);
  // at A, heading in toward B: the positive side is the wall's right; at B, heading back, its left
  const centre = wallEdge(wall);
  const leftA = a.minus;
  const rightA = a.plus;
  const leftB = b.plus;
  const rightB = b.minus;
  const curved = isCurved(wall);
  const left: Edge = { a: leftA, b: leftB, bulge: curved ? concentricBulge(centre, leftA, leftB) : 0 };
  const right: Edge = { a: rightA, b: rightB, bulge: curved ? concentricBulge(centre, rightA, rightB) : 0 };
  const capA = [rightA, ...a.between, leftA];
  const capB = [leftB, ...b.between, rightB];
  const corner = (q: P, bulge = 0): RoomVertex => (bulge === 0 ? { x: q.x, y: q.y } : { x: q.x, y: q.y, bulge });
  const outline = normalizeOutline([
    corner(leftA, left.bulge),
    ...capB.slice(0, -1).map((q, i) => corner(q, i === 0 ? b.bulge : 0)),
    corner(rightB, -right.bulge),
    ...capA.slice(0, -1).map((q, i) => corner(q, i === 0 ? a.bulge : 0)),
  ]);
  return { left, right, capA, capB, capABulge: a.bulge, capBBulge: b.bulge, outline };
}
