/**
 * A stair in the model, built from the one shape the plan works out for it (src/model/stairs.ts
 * stairGeometry): the 2D symbol, the checker, the walker and this model all read the same
 * treads, so the boards stand exactly where the plan draws its lines and the walker climbs them.
 *
 * Each tread is a board standing STAIR_MODEL.nosing proud of the riser board under it; the last
 * riser rises to the floor above. Each flight has a closed stringer up both sides and a handrail
 * over each on two posts; an L-shaped stair's landing is a solid block with a board on top and a
 * rail round its two open sides. Everything is built straight into one geometry per surface —
 * oak treads, lacquered risers, plaster stringers, dark wood rails — so a stair is four draw
 * calls and STAIR_MODEL.triangles holds it to a budget, whatever its number of risers.
 *
 * Its surfaces are static and sliced by the cutaway, like the walls': a stair in the storey the
 * cut passes through stops at the cut. Coordinates: plan metres (x, y → three.js x, z); heights
 * from the floor of the stair's level, which the group stands on (FLOOR_TOP).
 */

import * as THREE from "three";
import type { Stair } from "../model/types";
import type { ORect } from "../model/geometry";
import type { StairGeometry } from "../model/stairs";
import { stairGuard } from "../model/stairGuard";
import { STAIR_DEFAULTS } from "../model/limits";
import { keepStatic } from "./materials";
import { clipToStoreyTop } from "./cutaway";
import { createSurfaceMaterial, projectSurfaceUVs } from "./surfaces";
import { frameMaterial, skirtingMaterial, wallMaterial } from "./build";
import { FLOOR_TOP, STAIR_MODEL } from "./config";

/**
 * A stair's own copy of a surface: sliced by the cut as the walls are, and stopped at the top
 * of the storeys shown, so a stair climbing into a storey not shown ends at its own ceiling.
 */
const stairSurface = <M extends THREE.Material>(material: M): M => keepStatic(clipToStoreyTop(material));

/** A copy of one of the walls' finishes for the stair alone. */
const stairCopy = (material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
  const own = material.clone();
  own.name = `${material.name}:stair`;
  return stairSurface(own);
};

/** The treads' oak. */
export const treadMaterial = stairSurface(createSurfaceMaterial("oak"));

/** What each part of a stair is drawn in: the walls' finishes, in the stair's own copies. */
export const STAIR_MATERIALS = Object.freeze({
  tread: treadMaterial,
  riser: stairCopy(skirtingMaterial),
  stringer: stairCopy(wallMaterial),
  rail: stairCopy(frameMaterial),
});
type Part = keyof typeof STAIR_MATERIALS;

type V3 = readonly [number, number, number];

/** Triangles with flat normals, one list per part. */
class Builder {
  readonly positions: Record<Part, number[]> = { tread: [], riser: [], stringer: [], rail: [] };
  readonly normals: Record<Part, number[]> = { tread: [], riser: [], stringer: [], rail: [] };

  /** A planar face (its corners in order), turned to face away from `inside`. */
  face(part: Part, corners: readonly V3[], inside: V3): void {
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) return;
    n = n.map((x) => x / len);
    const centre = corners.reduce((s, p) => [s[0] + p[0] / corners.length, s[1] + p[1] / corners.length, s[2] + p[2] / corners.length], [0, 0, 0]);
    const out = (centre[0] - inside[0]) * n[0] + (centre[1] - inside[1]) * n[1] + (centre[2] - inside[2]) * n[2];
    const ordered = out < 0 ? [...corners].reverse() : corners;
    if (out < 0) n = n.map((x) => -x);
    for (let k = 1; k + 1 < ordered.length; k++) {
      for (const p of [ordered[0], ordered[k], ordered[k + 1]]) {
        this.positions[part].push(p[0], p[1], p[2]);
        this.normals[part].push(n[0], n[1], n[2]);
      }
    }
  }

  /** A six-faced solid given by its eight corners, corner(i, j, k) for i, j, k in {0, 1}. */
  solid(part: Part, corner: (i: 0 | 1, j: 0 | 1, k: 0 | 1) => V3): void {
    const c = (i: 0 | 1, j: 0 | 1, k: 0 | 1) => corner(i, j, k);
    const all = [c(0, 0, 0), c(1, 0, 0), c(0, 1, 0), c(1, 1, 0), c(0, 0, 1), c(1, 0, 1), c(0, 1, 1), c(1, 1, 1)];
    const inside = all.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8] as V3, [0, 0, 0] as V3);
    this.face(part, [c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)], inside);
    this.face(part, [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], inside);
    this.face(part, [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], inside);
    this.face(part, [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)], inside);
    this.face(part, [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], inside);
    this.face(part, [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], inside);
  }

  /** A convex profile in a flight's (along, up) plane, `x0` to `x1` across it. */
  prism(part: Part, frame: Frame, profile: readonly (readonly [number, number])[], x0: number, x1: number): void {
    const at = (x: number, [z, y]: readonly [number, number]) => frame.at(x, y, z);
    const mid = profile.reduce((s, p) => [s[0] + p[0] / profile.length, s[1] + p[1] / profile.length], [0, 0]);
    const inside = frame.at((x0 + x1) / 2, mid[1], mid[0]);
    this.face(part, profile.map((p) => at(x0, p)), inside);
    this.face(part, profile.map((p) => at(x1, p)), inside);
    profile.forEach((p, i) => {
      const q = profile[(i + 1) % profile.length];
      this.face(part, [at(x0, p), at(x1, p), at(x1, q), at(x0, q)], inside);
    });
  }
}

/** A flight's frame: x across it (from its centre line), z along it from its first riser, y up. */
interface Frame {
  at(x: number, y: number, z: number): V3;
}

/** The frame of an oriented rectangle whose depth axis is the climb (model/stairs.ts rectAlong). */
function frameOf(r: ORect): Frame {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  // local x along (c, s), local depth along (-s, c); z = 0 at the rectangle's near edge
  const ox = r.cx + s * r.hd;
  const oy = r.cy - c * r.hd;
  return { at: (x, y, z) => [ox + x * c - z * s, y, oy + x * s + z * c] };
}

/** An axis-aligned box in a frame: x0..x1 across, y0..y1 up, z0..z1 along. */
function box(b: Builder, part: Part, f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
  b.solid(part, (i, j, k) => f.at(i ? x1 : x0, j ? y1 : y0, k ? z1 : z0));
}

/** The most triangles a stair of `risers` risers may be built with. */
export const stairTriangleBudget = (risers: number): number => STAIR_MODEL.triangles.fixed + STAIR_MODEL.triangles.perRiser * risers;

/**
 * Build `stair` as `g` shapes it, in its level's frame. The group carries the stair's id
 * (userData.stairId) for picking.
 */
export function buildStair(stair: Stair, g: StairGeometry): THREE.Group {
  const m = STAIR_MODEL;
  const b = new Builder();
  const rh = g.riserHeight;
  const hw = stair.width / 2;
  // the flights that have treads, each with its rectangle and the height it starts from
  const flights = ([0, 1] as const)
    .map((f) => g.steps.filter((s) => s.flight === f))
    .filter((steps) => steps.length > 0)
    .map((steps, i) => ({ steps, rect: g.flights[i], base: steps[0].top - rh }));

  for (const { steps, rect, base } of flights) {
    const f = frameOf(rect);
    const run = rect.hd * 2;
    const count = steps.length;
    const end = base + (count + 1) * rh;
    steps.forEach((step, k) => {
      const z0 = k * g.going;
      // the tread, its nosing over the riser, and the riser under its front edge
      box(b, "tread", f, -hw, hw, step.top - m.treadThickness, step.top, z0 - m.nosing, z0 + g.going);
      box(b, "riser", f, -hw, hw, step.top - rh, step.top - m.treadThickness, z0, z0 + m.riserThickness);
    });
    // the riser up to what the flight arrives on: the next floor, or the landing (its own face)
    if (Math.abs(end - g.rise) < 1e-9) box(b, "riser", f, -hw, hw, end - rh, end, run - m.riserThickness, run);
    // a stringer up each side: from the floor at the first riser to the far end, flush there
    const st = m.stringerThickness;
    const top0 = base + rh + m.stringerAbove;
    const slope = (end - top0) / run;
    const reach = (m.stringerDepth - (top0 - base)) / slope;
    const profile: (readonly [number, number])[] =
      reach > 0 && reach < run
        ? [
            [0, base],
            [0, top0],
            [run, end],
            [run, end - m.stringerDepth],
            [reach, base],
          ]
        : [
            [0, base],
            [0, top0],
            [run, end],
            [run, base],
          ];
    for (const side of [-1, 1] as const) {
      const x = side * (hw - st / 2);
      b.prism("stringer", f, profile, x - st / 2, x + st / 2);
    }
    // the handrails: along the nosings' line, on a post at each end of the flight
    const rs = m.handrailSize;
    const line = (z: number) => base + rh + (z / g.going) * rh + m.handrailHeight;
    for (const side of [-1, 1] as const) {
      const x = side * (hw - st / 2);
      b.solid("rail", (i, j, k) => {
        const z = k ? run : 0;
        return f.at(x + (i - 0.5) * rs, line(z) + (j - 0.5) * rs, z);
      });
      const posts = count > 1 ? [g.going / 2, run - g.going / 2] : [run / 2];
      for (const z of posts) {
        const foot = base + rh * (1 + Math.min(count - 1, Math.floor(z / g.going)));
        box(b, "rail", f, x - m.postSize / 2, x + m.postSize / 2, foot, line(z), z - m.postSize / 2, z + m.postSize / 2);
      }
    }
  }

  if (g.landing) {
    const L = g.landing;
    const f = frameOf(L.rect);
    const s = L.rect.hw;
    const depth = L.rect.hd * 2;
    // a solid block, its top a board in the treads' oak
    box(b, "stringer", f, -s, s, 0, L.top - m.treadThickness, 0, depth);
    box(b, "tread", f, -s, s, L.top - m.treadThickness, L.top, 0, depth);
    // rails round the two open sides: the far one, and the one away from the turn
    const turn = stair.turn ?? STAIR_DEFAULTS.turn;
    const outer = (turn === "left" ? -1 : 1) * (s - m.stringerThickness / 2);
    const rail = L.top + m.handrailHeight;
    const rs = m.handrailSize;
    const far = depth - m.stringerThickness / 2;
    box(b, "rail", f, -s, s, rail - rs / 2, rail + rs / 2, far - rs / 2, far + rs / 2);
    box(b, "rail", f, outer - rs / 2, outer + rs / 2, rail - rs / 2, rail + rs / 2, 0, depth);
    box(b, "rail", f, outer - m.postSize / 2, outer + m.postSize / 2, L.top, rail, far - m.postSize / 2, far + m.postSize / 2);
    // a second flight with no treads: the landing's last riser rises straight to the floor above
    if (!g.steps.some((x) => x.flight === 1)) {
      const exit = -Math.sign(outer) * s;
      box(b, "riser", f, Math.min(exit, exit - Math.sign(exit) * m.riserThickness), Math.max(exit, exit - Math.sign(exit) * m.riserThickness), L.top, g.rise, 0, depth);
    }
  }

  guard(b, g);

  const group = new THREE.Group();
  for (const part of Object.keys(STAIR_MATERIALS) as Part[]) {
    if (b.positions[part].length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(b.positions[part], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals[part], 3));
    const mesh = new THREE.Mesh(geometry, STAIR_MATERIALS[part]);
    mesh.name = `stair:${part}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // the oak's grain in metres, along the plan
  projectSurfaceUVs(group);
  group.position.y = FLOOR_TOP;
  group.userData.stairId = stair.id;
  return group;
}

/**
 * The balustrade round the stairwell on the floor above (stairGuard: its rim less the edge the stair
 * arrives across): a rail handrailHeight over that floor along every edge, on posts at the
 * corners and at most guardPostSpacing apart, standing at the rim on the floor's side.
 */
function guard(b: Builder, g: StairGeometry): void {
  const m = STAIR_MODEL;
  const floor = g.rise;
  const rail = floor + m.handrailHeight;
  const posts = new Map<string, { x: number; z: number; out: { x: number; y: number } }>();
  for (const { a, b: e, out } of stairGuard(g)) {
    const len = Math.hypot(e.x - a.x, e.y - a.y);
    const at = (t: number, across: number): readonly [number, number] => [a.x + (e.x - a.x) * t + out.x * across, a.y + (e.y - a.y) * t + out.y * across];
    const centre = m.postSize / 2;
    b.solid("rail", (i, j, k) => {
      const [x, z] = at(k, centre + (i - 0.5) * m.handrailSize);
      return [x, rail + (j - 0.5) * m.handrailSize, z];
    });
    const spans = Math.max(1, Math.ceil(len / m.guardPostSpacing - 1e-9));
    for (let n = 0; n <= spans; n++) {
      const p = at(n / spans, centre);
      // a corner's post is shared by the two edges meeting there
      posts.set(`${p[0].toFixed(4)},${p[1].toFixed(4)}`, { x: p[0], z: p[1], out });
    }
  }
  // each post square to the edge it was set on: across it along `out`, along it at right angles
  const s = m.postSize;
  for (const { x, z, out } of posts.values()) {
    b.solid("rail", (i, j, k) => [x + out.x * (i - 0.5) * s - out.y * (k - 0.5) * s, j ? rail : floor, z + out.y * (i - 0.5) * s + out.x * (k - 0.5) * s]);
  }
}

/** How many triangles a built stair holds. */
export function stairTriangles(group: THREE.Object3D): number {
  let count = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) count += (mesh.geometry.getAttribute("position").count / 3) | 0;
  });
  return count;
}
