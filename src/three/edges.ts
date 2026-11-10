/**
 * Ink edges: the architectural style's linework. The plan is a drawing in one ink; with edges
 * on, the model is drawn the same way — a line wherever two faces of a piece meet at a crease
 * (EDGES.crease), in the plan's ink (SCENE_MARK.ink).
 *
 * They are added to any built object, whatever builder made it (a wall, a floor, a catalogue
 * piece, an agent's piece from its parts), from its meshes alone. One piece's lines are merged
 * into one line set per rigid part of it, so a piece's linework is one draw call and not one per
 * mesh: the whole piece, except that what hangs from a door's hinge gets a line set of its own
 * under the hinge and swings with the leaf (and a wall's curtains one of their own, which goes
 * with them while the cutaway puts them away). The ink is drawn a hair nearer than its edge
 * (EDGES.depthPull), so a line on a face is never broken by it.
 *
 * The line sets are named INK_EDGE: they are not raycast, cast no shadow, and the OBJ export
 * leaves them out, as it does the other drawing aids (contact shadows, the cutaway's caps). Their geometry goes with the object (disposeObject); their materials are
 * static.
 */

import * as THREE from "three";
import { keepStatic } from "./materials";
import { CONTACT_SHADOW } from "./surfaces";
import { EDGES } from "./config";
import { CUT_CAP, clipToCut } from "./cutaway";
import { SCENE_MARK } from "../ui/theme/sceneTokens";

export const INK_EDGE = "ink-edge";

/**
 * The ink is drawn a hair nearer the camera than the edge it lies on (EDGES.depthPull of its
 * distance, along the line of sight, so it stays exactly where it was on screen): a line on a
 * face then wins the depth test against that face, and is drawn whole, never broken into dashes
 * where the two tie. The faces themselves keep their true depth, so nothing that stands behind
 * them shows through.
 */
const pullInk = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = shader.vertexShader.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
gl_Position = projectionMatrix * vec4(mvPosition.xyz * ${(1 - EDGES.depthPull).toFixed(8)}, mvPosition.w);`,
  );
};

function inkMaterial(clipped: boolean): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({
    color: SCENE_MARK.ink.hex,
    transparent: true,
    opacity: EDGES.opacity,
    depthWrite: false,
  });
  material.onBeforeCompile = pullInk;
  material.customProgramCacheKey = () => "ink-pulled";
  // a cut wall's lines stop at the cut with it
  if (clipped) clipToCut(material);
  return keepStatic(material);
}

/** The ink for loose pieces, and the ink for walls, which the cutaway slices. */
export const INK = inkMaterial(false);
export const INK_CLIPPED = inkMaterial(true);

/** Is this object part of what a piece is built from, rather than a drawing aid on it? */
export const isAid = (o: THREE.Object3D): boolean => o.name === INK_EDGE || o.name === CONTACT_SHADOW || o.name === CUT_CAP;

/** Does this mesh get edges of its own: drawn, opaque enough, and part of the piece? */
function edged(mesh: THREE.Mesh): boolean {
  if (isAid(mesh)) return false;
  const m = mesh.material as THREE.Material | THREE.Material[];
  if (Array.isArray(m)) return true;
  return !m.transparent || m.opacity >= EDGES.minOpacity;
}

/**
 * The node a mesh's lines are merged under: its nearest hinge (the lines swing with the leaf),
 * or a group drawn on its own (a wall's curtains, put away while the wall is cut), or the piece's
 * root.
 */
function anchorOf(mesh: THREE.Object3D, root: THREE.Object3D): THREE.Object3D {
  if (mesh === root) return root;
  for (let n: THREE.Object3D | null = mesh.parent; n && n !== root; n = n.parent) if (n.userData?.doorHinge || n.userData?.inkAnchor) return n;
  return root;
}

const scratch = { inverse: new THREE.Matrix4() };

const crease = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  ab: new THREE.Vector3(),
  ac: new THREE.Vector3(),
};

/**
 * Where a geometry's faces meet at more than EDGES.crease degrees, and its open edges: line end
 * points in its own frame. The same lines three.js's EdgesGeometry finds — corners welded at a
 * tenth of a millimetre, a fold kept where two faces' normals part by more than the crease, an
 * edge with one face kept — found with numeric keys instead of strings, several times faster:
 * the Library draws every kind's thumbnail in the plan's ink in one go.
 */
export function findCreases(geometry: THREE.BufferGeometry, angle: number = EDGES.crease): Float32Array {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const precision = EDGES.weldPrecision;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const min = geometry.boundingBox!.min;
  const size = geometry.boundingBox!.getSize(crease.ab);
  const nx = Math.round(size.x * precision) + 2;
  const ny = Math.round(size.y * precision) + 2;
  const nz = Math.round(size.z * precision) + 2;
  // a corner's key: its welded lattice point, as one number while the lattice fits in one
  const numeric = nx * ny * nz < Number.MAX_SAFE_INTEGER;
  const ids = new Map<number | string, number>();
  const vertexId = (v: THREE.Vector3): number => {
    const ix = Math.round((v.x - min.x) * precision);
    const iy = Math.round((v.y - min.y) * precision);
    const iz = Math.round((v.z - min.z) * precision);
    const key = numeric ? ix + nx * (iy + ny * iz) : `${ix},${iy},${iz}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const threshold = Math.cos(THREE.MathUtils.DEG2RAD * angle);
  const stride = count + 1;
  /** a directed edge seen once: its two corners (vertex indices) and its face's normal; null once paired */
  const open = new Map<number, { i0: number; i1: number; nx: number; ny: number; nz: number } | null>();
  const out: number[] = [];
  const corner = [0, 0, 0];
  const welded = [0, 0, 0];
  const points = [crease.a, crease.b, crease.c];
  for (let t = 0; t < count; t += 3) {
    for (let k = 0; k < 3; k++) {
      corner[k] = index ? index.getX(t + k) : t + k;
      points[k].fromBufferAttribute(position, corner[k]);
      welded[k] = vertexId(points[k]);
    }
    if (welded[0] === welded[1] || welded[1] === welded[2] || welded[2] === welded[0]) continue;
    const n = crease.ab.subVectors(crease.b, crease.a).cross(crease.ac.subVectors(crease.c, crease.a));
    const length = n.length();
    if (length > 0) n.divideScalar(length);
    for (let k = 0; k < 3; k++) {
      const next = (k + 1) % 3;
      const reverse = welded[next] * stride + welded[k];
      const sibling = open.get(reverse);
      if (sibling) {
        if (n.x * sibling.nx + n.y * sibling.ny + n.z * sibling.nz <= threshold) {
          const p = points[k];
          const q = points[next];
          out.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
        open.set(reverse, null);
      } else {
        const key = welded[k] * stride + welded[next];
        if (!open.has(key)) open.set(key, { i0: corner[k], i1: corner[next], nx: n.x, ny: n.y, nz: n.z });
      }
    }
  }
  // the edges no other face met: open rims, drawn whole
  for (const edge of open.values()) {
    if (!edge) continue;
    crease.a.fromBufferAttribute(position, edge.i0);
    crease.b.fromBufferAttribute(position, edge.i1);
    out.push(crease.a.x, crease.a.y, crease.a.z, crease.b.x, crease.b.y, crease.b.z);
  }
  return new Float32Array(out);
}

/**
 * A geometry's creases (findCreases), found once per geometry and kept with it until it is
 * disposed. Every piece of one furniture definition draws the same geometries (furniture.ts), so
 * the second sofa's ink costs no crease search at all.
 */
const creases = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();
function edgesOf(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  let lines = creases.get(geometry);
  if (lines) return lines;
  lines = new THREE.BufferAttribute(findCreases(geometry), 3);
  creases.set(geometry, lines);
  geometry.addEventListener("dispose", () => creases.delete(geometry));
  return lines;
}

/*
 * A `wall` is drawn in the ink the cutaway slices, and as the plan draws it, one solid: a wall
 * is built of boxes laid end to end and over each other (masonry, lintels, sills, the frames and
 * the skirting proud of it), all square to the wall, so an edge that lies inside or on another
 * of its boxes — or of a wall it runs into — is a seam between two of them, or hidden, and is
 * left out. addInkEdges returns how many line sets were added.
 */
interface Part {
  mesh: THREE.Mesh;
  anchor: THREE.Object3D;
  /** the mesh's frame in its anchor's */
  matrix: THREE.Matrix4;
  /** its bounds in its anchor's frame, a seam's width larger */
  box: THREE.Box3;
}

/** The parts a piece's edges are drawn from: its meshes, by the anchor each is lined under. */
function partsOf(root: THREE.Object3D): Part[] {
  root.updateMatrixWorld(true);
  const parts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !edged(mesh)) return;
    const anchor = anchorOf(mesh, root);
    scratch.inverse.copy(anchor.matrixWorld).invert();
    const matrix = new THREE.Matrix4().multiplyMatrices(scratch.inverse, mesh.matrixWorld);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(EDGES.seamTolerance);
    parts.push({ mesh, anchor, matrix, box });
  });
  return parts;
}

/**
 * Give `root` its ink edges (once: a piece that has them keeps them). See above for `wall`;
 * `neighbours` are the walls a wall's ends run into (at a corner or a T), whose boxes hide its
 * end faces' edges just as its own do.
 */
export function addInkEdges(root: THREE.Object3D, wall = false, neighbours: readonly THREE.Object3D[] = []): number {
  let has = false;
  root.traverse((o) => {
    if (o.name === INK_EDGE) has = true;
  });
  if (has) return 0;
  const parts = partsOf(root);
  // the other walls' boxes, in each one's own frame, and the way from this wall's frame into it
  const others = wall
    ? neighbours
        .filter((n) => n !== root)
        .map((n) => ({ toLocal: new THREE.Matrix4().copy(n.matrixWorld).invert().multiply(root.matrixWorld), boxes: partsOf(n).filter((p) => p.anchor === n).map((p) => p.box) }))
    : [];
  const local = new THREE.Vector3();
  // an edge on a neighbour's face is hidden by it; one along a neighbour's own edge (the outer
  // corner where two walls meet) is the corner, and is drawn
  const buried = (b: THREE.Box3, q: THREE.Vector3) => {
    if (!b.containsPoint(q)) return false;
    let onFaces = 0;
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.min(q[axis] - b.min[axis], b.max[axis] - q[axis]) < 2 * EDGES.seamTolerance) onFaces++;
    }
    return onFaces <= 1;
  };
  const hiddenByNeighbour = (p: THREE.Vector3) =>
    others.some((o) => {
      local.copy(p).applyMatrix4(o.toLocal);
      return o.boxes.some((b) => buried(b, local));
    });
  const groups = new Map<THREE.Object3D, number[]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (const part of parts) {
    const lines = edgesOf(part.mesh.geometry);
    let out = groups.get(part.anchor);
    if (!out) groups.set(part.anchor, (out = []));
    for (let i = 0; i + 1 < lines.count; i += 2) {
      a.fromBufferAttribute(lines, i).applyMatrix4(part.matrix);
      b.fromBufferAttribute(lines, i + 1).applyMatrix4(part.matrix);
      if (wall) {
        mid.addVectors(a, b).multiplyScalar(0.5);
        if (parts.some((p) => p !== part && p.anchor === part.anchor && p.box.containsPoint(mid))) continue;
        if (part.anchor === root && hiddenByNeighbour(mid)) continue;
      }
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  let added = 0;
  for (const [anchor, positions] of groups) {
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, wall ? INK_CLIPPED : INK);
    lines.name = INK_EDGE;
    lines.castShadow = false;
    lines.receiveShadow = false;
    lines.raycast = () => {};
    anchor.add(lines);
    added++;
  }
  return added;
}

/** Take a piece's ink edges off again, freeing their geometry. Returns how many went. */
export function removeInkEdges(root: THREE.Object3D): number {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === INK_EDGE) found.push(o);
  });
  for (const o of found) {
    (o as THREE.LineSegments).geometry.dispose();
    o.parent?.remove(o);
  }
  return found.length;
}
