/**
 * Where walls meet. A wall's centreline stops at its endpoints, but a solid built from it must
 * reach on into the wall it joins, or every corner shows a notch. Two answers, for two kinds of
 * solid:
 *  - jointExtensions: what the 3D view's walls and the floors' outlines (floors.ts) use. Every
 *    end reaches into its joint, so the meshes close it however they overlap there.
 *  - buttJointExtensions: what the IFC export's wall bodies use. A building model's solids are
 *    checked for clashes and measured for volume, so at every joint exactly one wall fills the
 *    corner and every other one stops at its face: the walls meet, and none overlaps another.
 * Both find a wall's partners the same way (an end within WALL_JOINT_REACH of another wall).
 *
 * Its own module, apart from geometry.ts, because only those lazily loaded builders read it:
 * the first load never carries it.
 */

import type { Wall } from "./types";
import { WALL_IN_LINE_SINE, WALL_JOINT_REACH } from "./limits";

/**
 * How far a wall's two ends reach past its endpoints: an end that touches another wall is
 * extended by half the partner's thickness, for a clean joint. This is the one thing a wall's
 * shape takes from its neighbours, so a neighbour that moves changes a wall exactly when it
 * changes these two numbers.
 */
export function jointExtensions(wall: Wall, walls: readonly Wall[]): [number, number] {
  const a = { x: wall.ax, y: wall.ay };
  const b = { x: wall.bx, y: wall.by };
  let extA = 0;
  let extB = 0;
  for (const o of walls) {
    if (o.id === wall.id) continue;
    const ends = [
      { x: o.ax, y: o.ay },
      { x: o.bx, y: o.by },
    ];
    for (const e of ends) {
      // extend just up to the partner's OUTER face — extending further pokes past the corner (X artifact)
      if (Math.hypot(e.x - a.x, e.y - a.y) < WALL_JOINT_REACH) extA = Math.max(extA, o.thickness / 2);
      if (Math.hypot(e.x - b.x, e.y - b.y) < WALL_JOINT_REACH) extB = Math.max(extB, o.thickness / 2);
    }
    // T-junction: our endpoint lands mid-span of the partner
    const pSeg = (p: { x: number; y: number }) => {
      const dx = o.bx - o.ax;
      const dy = o.by - o.ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Infinity;
      const t = Math.max(0, Math.min(1, ((p.x - o.ax) * dx + (p.y - o.ay) * dy) / l2));
      return Math.hypot(p.x - (o.ax + t * dx), p.y - (o.ay + t * dy));
    };
    // ...reaching on to the partner's middle, not through it: an end at its far face would lie in
    // that face's plane, and its sides would show through it as a seam on the far side
    const dA = pSeg(a);
    const dB = pSeg(b);
    if (dA < WALL_JOINT_REACH) extA = Math.max(extA, dA);
    if (dB < WALL_JOINT_REACH) extB = Math.max(extB, dB);
  }
  return [extA, extB];
}

type P = { x: number; y: number };

/** The distance from p to the segment a→b. */
function toSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const ends = (w: Wall): [P, P] => [
  { x: w.ax, y: w.ay },
  { x: w.bx, y: w.by },
];

/** A wall's unit direction, A to B; null for a wall of no length. */
function direction(w: Wall): P | null {
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
  return len === 0 ? null : { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len };
}

const inLine = (u: P, v: P): boolean => Math.abs(u.x * v.y - u.y * v.x) < WALL_IN_LINE_SINE;

/** Whether wall `w` runs on, in line, into another wall at its end `p`: that end is no corner. */
function continuesAt(w: Wall, p: P, walls: readonly Wall[]): boolean {
  const u = direction(w);
  if (!u) return false;
  return walls.some((o) => {
    if (o.id === w.id) return false;
    const v = direction(o);
    return !!v && inLine(u, v) && ends(o).some((e) => Math.hypot(e.x - p.x, e.y - p.y) < WALL_JOINT_REACH);
  });
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
 */
export function buttJointExtensions(wall: Wall, walls: readonly Wall[]): [number, number] {
  const u = direction(wall);
  if (!u) return [0, 0];
  const [a, b] = ends(wall);
  const reach = (p: P, outward: P): number => {
    if (continuesAt(wall, p, walls)) return 0;
    const trims: number[] = [];
    const extensions: number[] = [];
    for (const o of walls) {
      if (o.id === wall.id) continue;
      const v = direction(o);
      if (!v || inLine(u, v)) continue;
      const [oa, ob] = ends(o);
      if (toSegment(p, oa, ob) >= WALL_JOINT_REACH) continue;
      // o's centreline as n·(q − oa) = 0, n its unit normal; this wall's body lies on the side
      // opposite `outward`, so its near face is at n·(q − oa) = side × thickness/2
      const n = { x: -v.y, y: v.x };
      const along = n.x * outward.x + n.y * outward.y;
      const side = -Math.sign(along);
      const offset = n.x * (p.x - oa.x) + n.y * (p.y - oa.y);
      // the extension that brings this end to the face at signed offset f
      const toFace = (f: number) => (f - offset) / along;
      const oEnd = [oa, ob].find((e) => Math.hypot(e.x - p.x, e.y - p.y) < WALL_JOINT_REACH);
      const corner = oEnd !== undefined && !continuesAt(o, oEnd, walls);
      if (corner && wall.id < o.id) extensions.push(toFace((-side * o.thickness) / 2));
      else trims.push(toFace((side * o.thickness) / 2));
    }
    if (trims.length > 0) return Math.min(...trims);
    return extensions.length > 0 ? Math.max(...extensions) : 0;
  };
  return [reach(a, { x: -u.x, y: -u.y }), reach(b, u)];
}
