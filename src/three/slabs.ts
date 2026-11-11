/**
 * The floors between storeys. Every level above the ground stands on a slab SLAB_THICKNESS deep
 * (model/limits.ts), under that level's rooms and walls (each wall to its joints, so the corners
 * are closed), its underside the ceiling of the level below. Each stair climbing to the level
 * leaves its stairwell open, in the slab and in the floor finish of any room it crosses
 * (build.ts buildFloor), and the opening is lined: the stairwell reads as a hole in a solid floor.
 *
 * The slab's top and underside are flat pieces (region.ts) the ink leaves alone — they are cut
 * into strips that are no edge of anything — and its sides and linings are walls along its rim,
 * whose top and bottom rims are exactly the slab's outline and its openings' as the ink draws them.
 */

import * as THREE from "three";
import type { PlanModel } from "../model/types";
import { rectCorners, wallAsRect } from "../model/geometry";
import { stairwellsOf } from "../model/levels";
import { SLAB_THICKNESS } from "../model/limits";
import { regionPieces, regionRim, type Piece, type Poly, type RimEdge } from "./region";
import { jointExtensions } from "./build";
import { staticSurface } from "./surfaces";
import { NO_INK } from "./edges";
import { MATERIAL } from "../ui/theme/sceneTokens";

export { NO_INK };

/** The slab's plaster: the walls' own finish, unsliced (a slab is always under the cut). */
export const slabMaterial = staticSurface("plaster", MATERIAL.wall.hex);

/** The openings the stairs from the level below need in level `levelId`'s floor. */
export function stairwellPolys(model: PlanModel, levelId: string): Poly[] {
  return stairwellsOf(model, levelId).flatMap((w) => w.geometry.footprint.map(rectCorners));
}

/**
 * What a level's slab covers: its rooms, and its walls to their joints. `model` is the level's
 * slice (levels.ts levelSlice).
 */
export function slabOutline(slice: Pick<PlanModel, "rooms" | "walls">): Poly[] {
  const rooms = slice.rooms.map((r): Poly => [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]);
  const walls = slice.walls.flatMap((w): Poly[] => {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    if (len === 0) return [];
    const [extA, extB] = jointExtensions(w, slice.walls);
    const ux = (w.bx - w.ax) / len;
    const uy = (w.by - w.ay) / len;
    return [rectCorners(wallAsRect(w.ax - ux * extA, w.ay - uy * extA, w.bx + ux * extB, w.by + uy * extB, w.thickness))];
  });
  return [...rooms, ...walls];
}

/** Texture coordinates of a point on a flat face: plan metres. */
type FlatUV = (x: number, z: number) => readonly [number, number];
/** A vertex's shade (1 = none), for surfaces that read per-vertex shading. */
type Shade = (x: number, z: number) => number;

/**
 * The pieces as one flat face at height `y`, facing up (or down, `down`). `dx`, `dz` move the
 * plan's coordinates into the mesh's frame.
 */
export function piecesGeometry(pieces: readonly Piece[], y: number, down = false, uv: FlatUV = (x, z) => [x, z], shade?: Shade, dx = 0, dz = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const vertex = (x: number, z: number) => {
    positions.push(x + dx, y, z + dz);
    uvs.push(...uv(x, z));
    if (shade) {
      const s = shade(x, z);
      colors.push(s, s, s);
    }
  };
  for (const p of pieces) {
    // (x0,lo0) (x0,hi0) (x1,lo1), then (x1,lo1) (x0,hi0) (x1,hi1): both face +y (see ninePatch)
    const tris: [number, number][] = [
      [p.x0, p.lo0],
      [p.x0, p.hi0],
      [p.x1, p.lo1],
      [p.x1, p.lo1],
      [p.x0, p.hi0],
      [p.x1, p.hi1],
    ];
    if (down) for (let k = 0; k < tris.length; k += 3) [tris[k + 1], tris[k + 2]] = [tris[k + 2], tris[k + 1]];
    for (const [x, z] of tris) vertex(x, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const n = down ? -1 : 1;
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? n : 0)), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (shade) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * A wall along every stretch of the rim, from `y0` up to `y1`, facing out of the region (into a
 * stairwell, away from a slab's edge). With `shaded`, every vertex carries an unshaded colour
 * (for surfaces that read per-vertex shading).
 */
export function rimGeometry(rim: readonly RimEdge[], y0: number, y1: number, uv: (along: number, y: number) => readonly [number, number] = (a, y) => [a, y], shaded = false, dx = 0, dz = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const e of rim) {
    // facing (nx, ny): a → b runs with the region on the left, seen from outside it
    const [p, q] = (e.b.x - e.a.x) * e.ny - (e.b.y - e.a.y) * e.nx > 0 ? [e.a, e.b] : [e.b, e.a];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const along0 = p.x + p.y;
    const corners: [number, number, number, number][] = [
      [p.x, y0, p.y, along0],
      [q.x, y0, q.y, along0 + len],
      [p.x, y1, p.y, along0],
      [p.x, y1, p.y, along0],
      [q.x, y0, q.y, along0 + len],
      [q.x, y1, q.y, along0 + len],
    ];
    for (const [x, y, z, a] of corners) {
      positions.push(x + dx, y, z + dz);
      normals.push(e.nx, 0, e.ny);
      uvs.push(...uv(a, y));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (shaded) geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(positions.length).fill(1), 3));
  return geometry;
}

/**
 * An upper level's slab, in its level's frame (its floor at y = 0): the outline less the
 * stairwells, from -SLAB_THICKNESS up to 0. Null when the level has nothing to stand on one.
 */
export function buildSlab(outline: readonly Poly[], wells: readonly Poly[]): THREE.Group | null {
  const pieces = regionPieces(outline, wells);
  if (pieces.length === 0) return null;
  const g = new THREE.Group();
  const face = (geometry: THREE.BufferGeometry, ink: boolean) => {
    const mesh = new THREE.Mesh(geometry, slabMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (!ink) mesh.userData[NO_INK] = true;
    g.add(mesh);
  };
  face(piecesGeometry(pieces, 0), false);
  face(piecesGeometry(pieces, -SLAB_THICKNESS, true), false);
  face(rimGeometry(regionRim(outline, wells), -SLAB_THICKNESS, 0), true);
  return g;
}
