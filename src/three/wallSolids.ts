/**
 * Walls as solids: what build.ts extrudes a wall from, straight or curved, at any angle.
 *
 * A wall's solid is its footprint on the plan (model/joints.ts wallFootprint): its two faces —
 * lines, or arcs concentric with its centreline — mitred where they meet the faces of the walls
 * it joins, so the footprints of two walls that meet share their cap edge and tile the joint, at
 * a right angle, at 30 degrees, or where a curved wall meets a straight one. The skirting and the
 * band along the wall's top are the footprints of the wall grown by their proud (WALL_SOLID),
 * mitred against neighbours grown the same: they meet round every corner as the walls do.
 *
 * Along its length the wall is cut where its doors and windows are: square to its centreline at
 * t ± half the opening's width, which on an arc is a cut along the radius, so t and the width are
 * measured along the arc (types.ts Opening, shapes.ts openingSag). Each stretch between cuts, and
 * each lintel and sill over or under an opening, is one prism: its outline on the plan (a run of
 * one face, a cut or the footprint's cap, the other face back, a cut or cap) extruded between two
 * heights. A prism's ends (cuts and caps) are drawn a little deeper than they are, as a box's
 * ends were (CUTAWAY.endOffset); its faces are smooth along an arc, flat elsewhere.
 *
 * Coordinates: a wall's group stands at the middle of its chord A→B, its x axis along the chord,
 * its z axis to the chord's right (the side a door with `side: "right"` swings to); a plan point
 * (x, y) is the wall's local (x, z) by toLocal.
 */

import * as THREE from "three";
import type { Pt } from "../model/geometry";
import type { Wall } from "../model/types";
import { wallFootprint, type WallFootprint } from "../model/joints";
import { closestOnEdge, edgeArc, isCurved, pointOnEdge, subEdge, tangentOnEdge, tessellateEdge, wallEdge, wallLength, type Edge, type Tessellation } from "../model/shapes";
import { CUTAWAY, WALL_SOLID } from "./config";
import { PRISM_SOLID, type PrismSolid } from "./edges";
import { triangulate } from "./triangulate";

export { PRISM_SOLID };

/** Lengths closer than this are none. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------- frames

/** A wall's frame: the middle of its chord, the chord's unit direction, and that direction's angle on the plan. */
export interface WallFrame {
  readonly ox: number;
  readonly oy: number;
  readonly ux: number;
  readonly uy: number;
  readonly angle: number;
}

export function wallFrame(w: Pick<Wall, "ax" | "ay" | "bx" | "by">): WallFrame {
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
  const ux = len > EPS ? (w.bx - w.ax) / len : 1;
  const uy = len > EPS ? (w.by - w.ay) / len : 0;
  return { ox: (w.ax + w.bx) / 2, oy: (w.ay + w.by) / 2, ux, uy, angle: Math.atan2(uy, ux) };
}

/** A plan point in a wall's frame: x along its chord, and (as y) its z, to the chord's right. */
export const toLocal = (f: WallFrame, p: Pt): Pt => {
  const dx = p.x - f.ox;
  const dy = p.y - f.oy;
  return { x: dx * f.ux + dy * f.uy, y: -dx * f.uy + dy * f.ux };
};

/** A plan direction (an angle on the plan) in a wall's frame: its angle about the wall's y axis, as three.js turns it. */
export const localTurn = (f: WallFrame, d: Pt): number => -(Math.atan2(d.y, d.x) - f.angle);

// ---------------------------------------------------------------------------- bands

/** The three outlines a wall is built from: its body, its skirting and the band along its top. */
export interface WallBands {
  readonly body: WallFootprint;
  readonly skirting: WallFootprint;
  readonly cap: WallFootprint;
}

/** A wall's footprint grown by `by` on both faces, mitred against its neighbours grown the same. */
function grownFootprint(wall: Wall, levelWalls: readonly Wall[], by: number): WallFootprint {
  if (by === 0) return wallFootprint(wall, levelWalls);
  const grow = (w: Wall): Wall => ({ ...w, thickness: w.thickness + 2 * by });
  return wallFootprint(grow(wall), levelWalls.map(grow));
}

/** A wall's bands against the walls of its level (its own among them or not). */
export function wallBands(wall: Wall, levelWalls: readonly Wall[]): WallBands {
  return {
    body: grownFootprint(wall, levelWalls, 0),
    skirting: grownFootprint(wall, levelWalls, WALL_SOLID.skirtingProud),
    cap: grownFootprint(wall, levelWalls, WALL_SOLID.capProud),
  };
}

/** What a wall's bands are, as a signature: a wall is built again exactly when one changes. */
export const bandsSignature = (b: WallBands): string => JSON.stringify([b.body.outline, b.skirting.outline, b.cap.outline]);

// ---------------------------------------------------------------------------- pieces

/** A stretch of a prism's outline: from its first point up to the next run's first. */
export interface Run {
  readonly pts: readonly Pt[];
  /** a face of the wall (its left or right), rather than an end (a cut, or the footprint's cap) */
  readonly face: boolean;
  /** shaded smooth along its points (an arc), rather than flat */
  readonly smooth: boolean;
}

/** One prism of a wall: its outline on the plan as runs, between two heights. */
export interface WallPiece {
  readonly runs: readonly Run[];
  readonly y0: number;
  readonly y1: number;
}

/** The run of a footprint's cap from its first point (excluded: its last, the next run's first). */
function capRun(cap: readonly Pt[], bulge: number, tess: Tessellation): Run {
  if (cap.length === 2 && bulge !== 0) return { pts: tessellateEdge({ a: cap[0], b: cap[1], bulge }, tess), face: false, smooth: true };
  return { pts: cap.slice(0, -1), face: false, smooth: false };
}

/**
 * The outline of the part of a band from centreline parameter t0 to t1 (null: the footprint's own
 * end there, mitred), as runs; null when that part has no length on either face. `half` is half
 * the band's width: a cut at t meets a face at the centreline's point there, half the width along
 * its normal (on an arc, along its radius).
 */
export function bandRuns(band: WallFootprint, wall: Wall, half: number, t0: number | null, t1: number | null, tess: Tessellation): Run[] | null {
  const centre = wallEdge(wall);
  const onFace = (t: number, side: 1 | -1, face: Edge): number => {
    const p = pointOnEdge(centre, t);
    const u = tangentOnEdge(centre, t);
    return closestOnEdge(face, { x: p.x + u.y * half * side, y: p.y - u.x * half * side }).t;
  };
  const l0 = t0 === null ? 0 : onFace(t0, 1, band.left);
  const l1 = t1 === null ? 1 : onFace(t1, 1, band.left);
  const r0 = t0 === null ? 0 : onFace(t0, -1, band.right);
  const r1 = t1 === null ? 1 : onFace(t1, -1, band.right);
  if (l1 - l0 < EPS && r1 - r0 < EPS) return null;
  const left = subEdge(band.left, l0, Math.max(l0, l1));
  const right = subEdge(band.right, r0, Math.max(r0, r1));
  const smooth = isCurved(wall);
  return [
    { pts: tessellateEdge(left, tess), face: true, smooth },
    t1 === null ? capRun(band.capB, band.capBBulge, tess) : { pts: [left.b], face: false, smooth: false },
    { pts: tessellateEdge({ a: right.b, b: right.a, bulge: -right.bulge }, tess), face: true, smooth },
    t0 === null ? capRun(band.capA, band.capABulge, tess) : { pts: [right.a], face: false, smooth: false },
  ];
}

/**
 * Where along a wall a plan point is, metres from its A end measured along the centreline (past
 * either end, along the arc's circle on): a face's texture runs on round the wall with it.
 */
export function alongWall(wall: Wall, frame: WallFrame): (p: Pt) => number {
  const len = wallLength(wall);
  const arc = edgeArc(wallEdge(wall));
  if (!arc) return (p) => toLocal(frame, p).x + len / 2;
  return (p) => {
    const d = Math.atan2(p.y - arc.center.y, p.x - arc.center.x) - arc.start;
    // the turn nearest the arc's own middle, so a point a little past either end reads on from it
    const turn = d - 2 * Math.PI * Math.round((d - arc.sweep / 2) / (2 * Math.PI));
    return (turn / arc.sweep) * len;
  };
}

/** The extent along a wall a seam's width covers, as a share of its length: cuts reach this far on into the next piece. */
export const seamShare = (wall: Wall): number => CUTAWAY.seam / Math.max(wallLength(wall), EPS);

// ---------------------------------------------------------------------------- geometry

/** A prism's outline in a wall's frame, with each point's run, duplicates dropped. */
export function pieceRing(runs: readonly Run[], frame: WallFrame): { pts: Pt[]; run: number[] } {
  const pts: Pt[] = [];
  const run: number[] = [];
  runs.forEach((r, k) => {
    for (const p of r.pts) {
      const q = toLocal(frame, p);
      const last = pts[pts.length - 1];
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < EPS) continue;
      pts.push(q);
      run.push(k);
    }
  });
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < EPS) {
    pts.pop();
    run.pop();
  }
  return { pts, run };
}

/** Twice a ring's signed area on (x, z). */
const ringArea2 = (pts: readonly Pt[]): number => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p.x * q.y - q.x * p.y;
}, 0);

/** A ring's triangles (index triples), by ear clipping (triangulate.ts). */
export const ringTriangles = (pts: readonly Pt[]): number[][] => triangulate(pts);

/** A triangle's vertices, in the order whose face normal agrees with `n`. */
function oriented(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  return face.dot(n) >= 0 ? [a, b, c] : [a, c, b];
}

/**
 * A wall prism's geometry in its wall's frame: its sides (smooth along an arc's run, flat at its
 * corners), top and bottom. Two groups: its ends (cuts and caps) first, then the rest, for the
 * two materials a wall piece draws with. Texture coordinates are metres over `metres`: a face
 * along the wall (`along`) and up it, an end across and up, the top and bottom on the plan.
 */
export function prismGeometry(piece: WallPiece, frame: WallFrame, along: (p: Pt) => number, metres: readonly [number, number] = [1, 1]): THREE.BufferGeometry {
  const { pts, run } = pieceRing(piece.runs, frame);
  const n = pts.length;
  const sign = ringArea2(pts) >= 0 ? 1 : -1;
  const [mu, mv] = metres;
  const ends = { pos: [] as number[], nrm: [] as number[], uv: [] as number[] };
  const rest = { pos: [] as number[], nrm: [] as number[], uv: [] as number[] };
  const plan = (q: Pt): Pt => ({ x: frame.ox + q.x * frame.ux - q.y * frame.uy, y: frame.oy + q.x * frame.uy + q.y * frame.ux });
  /** each segment's outward normal on (x, z) */
  const normals = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (sign * (q.y - p.y)) / len, z: (-sign * (q.x - p.x)) / len };
  });
  /** the shading normal at the end of segment i that is point j (i's start or end) */
  const shading = (i: number, j: number): { x: number; z: number } => {
    const r = piece.runs[run[i]];
    if (!r.smooth) return normals[i];
    const other = j === i ? (i - 1 + n) % n : (i + 1) % n;
    if (run[other] !== run[i]) return normals[i];
    const x = normals[i].x + normals[other].x;
    const z = normals[i].z + normals[other].z;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len };
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = pts[i];
    const q = pts[j];
    if (Math.hypot(q.x - p.x, q.y - p.y) < EPS) continue;
    const face = piece.runs[run[i]].face;
    const out = face ? rest : ends;
    const np = shading(i, i);
    const nq = shading(i, j);
    const u = (v: Pt) => (face ? along(plan(v)) : v.y);
    const corners = [
      { v: new THREE.Vector3(p.x, piece.y0, p.y), nn: np, s: u(p) },
      { v: new THREE.Vector3(q.x, piece.y0, q.y), nn: nq, s: u(q) },
      { v: new THREE.Vector3(q.x, piece.y1, q.y), nn: nq, s: u(q) },
      { v: new THREE.Vector3(p.x, piece.y1, p.y), nn: np, s: u(p) },
    ];
    const flat = new THREE.Vector3(normals[i].x, 0, normals[i].z);
    for (const [a, b, c] of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      const tri = oriented(corners[a].v, corners[b].v, corners[c].v, flat);
      for (const v of tri) {
        const k = corners.find((cn) => cn.v === v)!;
        out.pos.push(v.x, v.y, v.z);
        out.nrm.push(k.nn.x, 0, k.nn.z);
        out.uv.push(k.s / mu, v.y / mv);
      }
    }
  }
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  for (const [a, b, c] of ringTriangles(pts)) {
    for (const [y, nn] of [
      [piece.y1, up],
      [piece.y0, down],
    ] as const) {
      const tri = oriented(new THREE.Vector3(pts[a].x, y, pts[a].y), new THREE.Vector3(pts[b].x, y, pts[b].y), new THREE.Vector3(pts[c].x, y, pts[c].y), nn);
      for (const v of tri) {
        rest.pos.push(v.x, v.y, v.z);
        rest.nrm.push(0, nn.y, 0);
        rest.uv.push(v.x / mu, v.z / mv);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...ends.pos, ...rest.pos], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([...ends.nrm, ...rest.nrm], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([...ends.uv, ...rest.uv], 2));
  const endCount = ends.pos.length / 3;
  geometry.addGroup(0, endCount, 0);
  geometry.addGroup(endCount, rest.pos.length / 3, 1);
  geometry.userData[PRISM_SOLID] = { ring: pts, y0: piece.y0, y1: piece.y1 } satisfies PrismSolid;
  return geometry;
}

/** A flat face over a ring at height y, facing up: triangle positions, appended to `out`. */
export function ringSection(pts: readonly Pt[], y: number, out: number[]): void {
  const up = new THREE.Vector3(0, 1, 0);
  for (const [a, b, c] of ringTriangles(pts)) {
    const tri = oriented(new THREE.Vector3(pts[a].x, y, pts[a].y), new THREE.Vector3(pts[b].x, y, pts[b].y), new THREE.Vector3(pts[c].x, y, pts[c].y), up);
    for (const v of tri) out.push(v.x, v.y, v.z);
  }
}
