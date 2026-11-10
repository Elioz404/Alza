/**
 * The shapes the furniture is modelled from (furniture.ts): soft boxes with rounded edges and an
 * optional sag (cushions, mattresses, pillows), turned profiles (legs, lamps, bowls), extruded
 * outlines (an oval table top, a bath's rim), and the merge that bakes a piece's parts into one
 * mesh per material so a piece costs a handful of draw calls, not one per part.
 *
 * Pure geometry: no materials, no colours, no state.
 */

import * as THREE from "three";
import { FURNITURE_STYLE as S, type Profile } from "./furnitureStyle";

// ============================================================================ soft boxes

/** Grid lines across one side of a box: a band over each rounded edge, an even run between. */
function axisLines(half: number, r: number, edgeSegments: number, inner: number): number[] {
  const lines: number[] = [];
  if (r > 0) for (let i = 0; i < edgeSegments; i++) lines.push(-half + (r * i) / edgeSegments);
  for (let i = 0; i <= inner; i++) lines.push(-half + r + (2 * (half - r) * i) / inner);
  if (r > 0) for (let i = edgeSegments - 1; i >= 0; i--) lines.push(half - (r * i) / edgeSegments);
  return lines;
}

export interface SoftBoxOptions {
  /** edge radius; 0 for sharp edges */
  radius?: number;
  /** how far the top's middle sinks (a cushion sat in, a pillow's dip) */
  sag?: number;
  /** grid lines across each rounded edge */
  edgeSegments?: number;
  /** flat faces: grid steps per metre, and at most */
  perMetre?: number;
  maxSegments?: number;
}

/**
 * A box w × h × d centred at the origin, its edges and corners rounded to `radius`, its top
 * optionally sagging toward the middle. Normals are exact: the rounding's, tilted by the sag.
 */
export function softBox(w: number, h: number, d: number, options: SoftBoxOptions = {}): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.min(options.radius ?? 0, ...half.map((x) => x * 0.999));
  const edge = r > 0 ? (options.edgeSegments ?? S.bevel.edgeSegments) : 0;
  const sag = options.sag ?? 0;
  const perMetre = options.perMetre ?? 0;
  const maxSegments = options.maxSegments ?? S.bevel.softMaxSegments;
  const inner = half.map((x) => Math.max(1, Math.min(maxSegments, Math.round(2 * x * perMetre))));
  const lines = half.map((x, a) => axisLines(x, r, edge, inner[a]));
  const core = half.map((x) => x - r);

  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const p = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const sign of [1, -1]) {
      const base = positions.length / 3;
      const lu = lines[u];
      const lv = lines[v];
      for (let j = 0; j < lv.length; j++) {
        for (let i = 0; i < lu.length; i++) {
          p[a] = sign * half[a];
          p[u] = lu[i];
          p[v] = lv[j];
          // project onto the rounded box: the nearest point of the core, pushed out by r
          const c = p.map((x, k) => Math.max(-core[k], Math.min(core[k], x)));
          const diff = p.map((x, k) => x - c[k]);
          const len = Math.hypot(diff[0], diff[1], diff[2]);
          const n = len > 1e-9 ? diff.map((x) => x / len) : [a === 0 ? sign : 0, a === 1 ? sign : 0, a === 2 ? sign : 0];
          const q = len > 1e-9 ? c.map((x, k) => x + n[k] * r) : [...p];
          if (sag > 0 && n[1] > 0) {
            const fx = 1 - (q[0] / half[0]) ** 2;
            const fz = 1 - (q[2] / half[2]) ** 2;
            const f = Math.max(0, fx) * Math.max(0, fz);
            q[1] -= sag * f * n[1];
            // the sunk top's slope tilts its normal
            const dx = (sag * n[1] * -2 * q[0] * Math.max(0, fz)) / half[0] ** 2;
            const dz = (sag * n[1] * -2 * q[2] * Math.max(0, fx)) / half[2] ** 2;
            n[0] += dx * n[1];
            n[2] += dz * n[1];
            const nl = Math.hypot(n[0], n[1], n[2]);
            for (let k = 0; k < 3; k++) n[k] /= nl;
          }
          positions.push(q[0], q[1], q[2]);
          normals.push(n[0], n[1], n[2]);
        }
      }
      const row = lu.length;
      for (let j = 0; j < lv.length - 1; j++) {
        for (let i = 0; i < row - 1; i++) {
          const k = base + j * row + i;
          if (sign > 0) index.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
          else index.push(k, k + row, k + 1, k + 1, k + row, k + row + 1);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A box w × h × d centred at the origin with every edge chamfered by `r`: six flat faces, a strip
 * along each edge and a triangle at each corner (44 triangles). Each vertex carries its face's
 * normal, so a strip's shading turns from one face to the next like a rounded edge.
 */
export function chamferBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  /** the vertex of face (axis a, side s) nearest the box corner with signs `corner` */
  const vertexAt = new Map<string, number>();
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      for (const sb of [-1, 1]) {
        for (const sc of [-1, 1]) {
          const corner = [0, 0, 0];
          corner[a] = s;
          corner[(a + 1) % 3] = sb;
          corner[(a + 2) % 3] = sc;
          const p = corner.map((c, k) => (k === a ? c * half[k] : c * (half[k] - r)));
          vertexAt.set(`${a}|${corner.join(",")}`, positions.length / 3);
          positions.push(...p);
          normals.push(...corner.map((c, k) => (k === a ? c : 0)));
        }
      }
    }
  }
  const v = (a: number, corner: number[]) => vertexAt.get(`${a}|${corner.join(",")}`)!;
  const p = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  /** a triangle wound to face `out` */
  const tri = (i: number, j: number, k: number, out: THREE.Vector3) => {
    const n = new THREE.Vector3().crossVectors(p(j).sub(p(i)), p(k).sub(p(i)));
    if (n.dot(out) >= 0) index.push(i, j, k);
    else index.push(i, k, j);
  };
  const quad = (q: number[], out: THREE.Vector3) => {
    tri(q[0], q[1], q[2], out);
    tri(q[0], q[2], q[3], out);
  };
  const signs = [-1, 1];
  // the faces
  for (let a = 0; a < 3; a++) {
    for (const s of signs) {
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      const at = (sb: number, sc: number) => {
        const corner = [0, 0, 0];
        corner[a] = s;
        corner[b] = sb;
        corner[c] = sc;
        return v(a, corner);
      };
      const out = new THREE.Vector3().setComponent(a, s);
      quad([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], out);
    }
  }
  // the edge strips: along axis e, between the faces of the other two axes
  for (let e = 0; e < 3; e++) {
    const f = (e + 1) % 3;
    const g = (e + 2) % 3;
    for (const sf of signs) {
      for (const sg of signs) {
        const corner = (se: number) => {
          const c = [0, 0, 0];
          c[e] = se;
          c[f] = sf;
          c[g] = sg;
          return c;
        };
        const out = new THREE.Vector3().setComponent(f, sf).setComponent(g, sg);
        quad([v(f, corner(-1)), v(f, corner(1)), v(g, corner(1)), v(g, corner(-1))], out);
      }
    }
  }
  // the corners
  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const corner = [sx, sy, sz];
        tri(v(0, corner), v(1, corner), v(2, corner), new THREE.Vector3(sx, sy, sz));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

/** A hard part's box: a small chamfer, or sharp edges for a slab too thin to carry one. */
export function hardBox(w: number, h: number, d: number, radius: number = S.bevel.hard): THREE.BufferGeometry {
  const thinnest = Math.min(w, h, d);
  if (thinnest < S.bevel.sharpBelow || radius <= 0) return softBox(w, h, d);
  return chamferBox(w, h, d, Math.min(radius, thinnest * S.bevel.maxFraction));
}

/** A soft part's box: rounded edges, its flat faces gridded so a sag can show. */
export function cushion(w: number, h: number, d: number, radius: number, sag = 0): THREE.BufferGeometry {
  return softBox(w, h, d, {
    radius,
    sag,
    edgeSegments: S.bevel.softEdgeSegments,
    perMetre: S.bevel.softPerMetre,
  });
}

// ============================================================================ turned

/**
 * A turned part: `profile` is [radius, height] pairs bottom up, in metres; the ends are closed
 * when they come to the axis (give them radius 0).
 */
export function lathe(profile: readonly (readonly [number, number])[], segments: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    segments,
  );
}

/** A turned profile (fractions, furnitureStyle) at a radius and a length, closed at both ends. */
export function turned(profile: Profile, radius: number, length: number, segments: number): THREE.BufferGeometry {
  const points: [number, number][] = [[0, 0]];
  for (const [r, y] of profile) points.push([r * radius, y * length]);
  points.push([0, length]);
  return lathe(points, segments);
}

// ============================================================================ outlines and plates

/** An outline in the piece's plan: [x, z] points round a convex shape. */
export type Outline = readonly (readonly [number, number])[];

/** A rectangle w × d with rounded corners, centred on (cx, cz). */
export function rectOutline(w: number, d: number, r: number, cx = 0, cz = 0, cornerSegments: number = S.segments.corner): Outline {
  const c = Math.max(0, Math.min(r, w / 2, d / 2));
  const points: [number, number][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - c, d / 2 - c, 0],
    [-w / 2 + c, d / 2 - c, Math.PI / 2],
    [-w / 2 + c, -d / 2 + c, Math.PI],
    [w / 2 - c, -d / 2 + c, (3 * Math.PI) / 2],
  ];
  for (const [x, z, start] of corners) {
    const steps = c > 0 ? cornerSegments : 0;
    for (let i = 0; i <= steps; i++) {
      const a = start + (steps ? (i / steps) * (Math.PI / 2) : 0);
      points.push([cx + x + c * Math.cos(a), cz + z + c * Math.sin(a)]);
    }
  }
  return points;
}

/** An ellipse rx × rz centred on (cx, cz). */
export function ellipseOutline(rx: number, rz: number, cx = 0, cz = 0, segments: number = S.segments.outline): Outline {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cz + rz * Math.sin(a)] as const;
  });
}

/** A quarter disc of radius r round the corner (0, 0), reaching toward +x and +z, its two straight sides inset by `inset`. */
export function quarterOutline(r: number, inset: number, segments: number = S.segments.outline / 4): Outline {
  const a = Math.asin(Math.min(1, inset / r));
  const points: [number, number][] = [[inset, inset]];
  for (let i = 0; i <= segments; i++) {
    const t = a + (i / segments) * (Math.PI / 2 - 2 * a);
    points.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return points;
}

/** Where a ray from c at angle `a` leaves a convex outline that contains c. */
function rayExit(outline: Outline, c: readonly [number, number], a: number): [number, number] {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [px, pz] = outline[i];
    const [qx, qz] = outline[(i + 1) % outline.length];
    const ex = qx - px;
    const ez = qz - pz;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - c[0]) * ez - (pz - c[1]) * ex) / den;
    const s = ((px - c[0]) * dz - (pz - c[1]) * dx) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return [c[0] + dx * best, c[1] + dz * best];
}

/**
 * A plate `height` thick standing on y = 0, the shape of a convex outline: a table top, a worktop,
 * a bath's shell. With a `hole` (a convex outline inside it, around `centre`), it is a ring: the
 * hole's wall faces inward, so a sink or a tub reads as a recess. Walls are smooth round a curve
 * and sharp at a corner.
 */
export function plate(outer: Outline, height: number, hole?: Outline, centre: readonly [number, number] = [0, 0]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const vertex = (x: number, y: number, z: number, n: readonly number[]) => {
    positions.push(x, y, z);
    normals.push(n[0], n[1], n[2]);
    return positions.length / 3 - 1;
  };
  const at = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const tri = (i: number, j: number, k: number, out: THREE.Vector3) => {
    const n = new THREE.Vector3().crossVectors(at(j).sub(at(i)), at(k).sub(at(i)));
    if (n.dot(out) >= 0) index.push(i, j, k);
    else index.push(i, k, j);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);

  /** a wall round a closed loop of points, facing away from `c` (or toward it, for a hole) */
  const wall = (loop: Outline, c: readonly [number, number], inward: boolean) => {
    const n = loop.length;
    const edgeNormal = (i: number) => {
      const [px, pz] = loop[i];
      const [qx, qz] = loop[(i + 1) % n];
      const len = Math.hypot(qx - px, qz - pz) || 1;
      let nx = (qz - pz) / len;
      let nz = -(qx - px) / len;
      const mx = (px + qx) / 2 - c[0];
      const mz = (pz + qz) / 2 - c[1];
      if (nx * mx + nz * mz < 0 !== inward) [nx, nz] = [-nx, -nz];
      return [nx, 0, nz];
    };
    const edges = Array.from({ length: n }, (_, i) => edgeNormal(i));
    // a vertex between two edges that turn gently takes their average: the wall reads as curved
    const smoothAt = (i: number, own: number[]) => {
      const prev = edges[(i - 1 + n) % n];
      const next = edges[i % n];
      if (prev[0] * next[0] + prev[2] * next[2] < Math.cos(S.segments.smoothTurn)) return own;
      const sx = prev[0] + next[0];
      const sz = prev[2] + next[2];
      const l = Math.hypot(sx, sz) || 1;
      return [sx / l, 0, sz / l];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const own = edges[i];
      const ni = smoothAt(i, own);
      const nj = smoothAt(j, own);
      const a = vertex(loop[i][0], 0, loop[i][1], ni);
      const b = vertex(loop[j][0], 0, loop[j][1], nj);
      const top = vertex(loop[j][0], height, loop[j][1], nj);
      const d = vertex(loop[i][0], height, loop[i][1], ni);
      const out = new THREE.Vector3(own[0], 0, own[2]);
      tri(a, b, top, out);
      tri(a, top, d, out);
    }
  };

  if (!hole) {
    // caps: a fan from the middle of the (convex) outline
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
    const cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    for (const [y, normal, out] of [
      [height, [0, 1, 0], up],
      [0, [0, -1, 0], down],
    ] as const) {
      const mid = vertex(cx, y, cz, normal);
      const ring = outer.map(([x, z]) => vertex(x, y, z, normal));
      for (let i = 0; i < ring.length; i++) tri(mid, ring[i], ring[(i + 1) % ring.length], out);
    }
    wall(outer, [cx, cz], false);
  } else {
    // a ring: both outlines sampled along the same rays from the hole's centre, every corner of either kept
    const angle = ([x, z]: readonly [number, number]) => Math.atan2(z - centre[1], x - centre[0]);
    const angles = [...outer, ...hole].map(angle).sort((a, b) => a - b);
    const rays = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-6);
    const o = rays.map((a) => rayExit(outer, centre, a));
    const h = rays.map((a) => rayExit(hole, centre, a));
    for (const [y, normal, out] of [
      [height, [0, 1, 0], up],
      [0, [0, -1, 0], down],
    ] as const) {
      const ro = o.map(([x, z]) => vertex(x, y, z, normal));
      const rh = h.map(([x, z]) => vertex(x, y, z, normal));
      for (let i = 0; i < rays.length; i++) {
        const j = (i + 1) % rays.length;
        tri(ro[i], ro[j], rh[j], out);
        tri(ro[i], rh[j], rh[i], out);
      }
    }
    wall(o, centre, false);
    wall(h, centre, true);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A round or oval disc rx × rz, `height` thick, standing on y = 0, its top and bottom edges
 * rounded over by `edge`: a table top, a lid, a foot.
 */
export function disc(rx: number, rz: number, height: number, edge: number, segments: number = S.segments.outline): THREE.BufferGeometry {
  const e = Math.min(edge, height / 2, rx / 2);
  const steps = S.segments.edge;
  const profile: [number, number][] = [[0, 0]];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    profile.push([rx - e + e * Math.cos(a), e + e * Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    profile.push([rx - e + e * Math.cos(a), height - e + e * Math.sin(a)]);
  }
  profile.push([0, height]);
  const geometry = lathe(profile, segments);
  geometry.scale(1, 1, rz / rx);
  return geometry;
}

// ============================================================================ merging and fitting

/** One part of a piece: its geometry and where it sits in the piece's frame. */
export interface PlacedGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
}

/**
 * Bake parts into one geometry in the piece's frame: positions and normals transformed, one
 * index over all of them. Texture coordinates are not kept (the surfaces project their own).
 */
export function mergePlaced(parts: readonly PlacedGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const { geometry } of parts) {
    const count = geometry.getAttribute("position").count;
    vertexCount += count;
    indexCount += geometry.index ? geometry.index.count : count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  for (const { geometry, matrix } of parts) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      positions.set([p.x, p.y, p.z], (vo + i) * 3);
      normals.set([n.x, n.y, n.z], (vo + i) * 3);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) index[io++] = geometry.index.getX(i) + vo;
    else for (let i = 0; i < position.count; i++) index[io++] = i + vo;
    vo += position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

/**
 * Fit geometries (one piece, in its frame) to the box [-w/2, w/2] × [0, h] × [-d/2, d/2]: scale
 * each axis and move, normals corrected for the scale. `bounds` is the box that is fitted (by
 * default the geometries' own); what stands outside it (a fitting over a piece's height) is
 * scaled and moved with the rest. Returns the scale each axis took.
 */
export function fitToBox(geometries: readonly THREE.BufferGeometry[], w: number, h: number, d: number, bounds?: THREE.Box3): [number, number, number] {
  const box = new THREE.Box3();
  if (bounds) box.copy(bounds);
  else {
    for (const g of geometries) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const scale: [number, number, number] = [w / size.x, h / size.y, d / size.z];
  const centre = box.getCenter(new THREE.Vector3());
  for (const g of geometries) {
    // (scale() carries the normals through the inverse transpose, so they stay true)
    g.translate(-centre.x, -box.min.y, -centre.z);
    g.scale(...scale);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return scale;
}

/** Triangles a geometry draws. */
export const triangleCount = (geometry: THREE.BufferGeometry): number =>
  (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
