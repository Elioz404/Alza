/**
 * The 3D view's parts working together on the rebuilt furniture: the pieces (furniture.ts,
 * geometry shared per definition) inside the scene (planScene.ts) with its drawing aids (ink
 * edges, contact shadows) and the plan's marks (marks.ts). No WebGL: the scene graph, the rays
 * and the boxes are plain three.js.
 *
 *  - No builder emits a position or normal that is not a number: edges, picking and bounds all
 *    read them.
 *  - Every piece in the scene is inked, and its ink lies on the piece, inside its catalogue box.
 *  - A click on any piece selects that piece, through the shared geometry.
 *  - The selection's outline surrounds the piece as it is drawn.
 *  - Ink and pieces share their geometry safely: a second piece of a kind reuses the first one's
 *    creases, and removing one leaves the other drawn.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlanScene } from "../src/three/planScene";
import { buildFurniture } from "../src/three/furniture";
import { INK_EDGE, isAid } from "../src/three/edges";
import { CONTACT_SHADOW } from "../src/three/surfaces";
import { markBox } from "../src/three/marks";
import { disposeObject } from "../src/three/materials";
import { FLOOR_TOP, MARKS } from "../src/three/config";
import { riseOf } from "../src/three/furnitureStyle";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { emptyModel, type Item, type KindDef, type PlanModel } from "../src/model/types";

/** Room between two pieces laid out in a row, so a ray down on one never meets its neighbour. */
const GAP = 1;
const EPS = 1e-4;

/** An agent's piece made from its parts, in materials and without. */
const AGENT_KIND: KindDef = {
  kind: "agent_lamp_table",
  label: "Lamp table",
  w: 0.6,
  d: 0.5,
  h: 0.9,
  color: "#8a6a4a",
  category: "living",
  source: "custom",
  parts: [
    { shape: "box", x: 0, y: 0.5, z: 0, w: 0.6, h: 0.04, d: 0.5, material: "wood" },
    { shape: "cylinder", x: 0, y: 0, z: 0, w: 0.08, h: 0.5, d: 0.08, color: "#202020", material: "metal" },
    { shape: "sphere", x: 0, y: 0.54, z: 0, w: 0.3, h: 0.36, d: 0.3, material: "linen" },
  ],
} as KindDef;

const KINDS: readonly KindDef[] = [...BUILT_IN_KINDS, AGENT_KIND];

/** Every kind once, in a row along x, turned a little so the boxes are not square to the axes. */
function showroom(): { model: PlanModel; items: Item[] } {
  const items: Item[] = [];
  let x = 0;
  for (const def of KINDS) {
    x += def.w / 2;
    items.push({ id: `piece_${def.kind}`, kind: def.kind, x, y: 0, rotation: 30 });
    x += def.w / 2 + GAP;
  }
  return { model: { ...emptyModel(), kinds: [AGENT_KIND], items }, items };
}

const defOf = (kind: string) => KINDS.find((d) => d.kind === kind)!;

/** The meshes a piece is built from, its drawing aids left out. */
function bodyMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !isAid(o)) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

function inkOf(root: THREE.Object3D): THREE.LineSegments[] {
  const found: THREE.LineSegments[] = [];
  root.traverse((o) => o.name === INK_EDGE && found.push(o as THREE.LineSegments));
  return found;
}

const finite = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) => {
  if (!a) return true;
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < a.itemSize; c++) if (!Number.isFinite(a.getComponent(i, c))) return false;
  }
  return true;
};

describe("the furniture in the scene", () => {
  it.each(KINDS.map((d) => [d.kind, d] as const))("%s has no position or normal that is not a number", (_, def) => {
    const piece = buildFurniture(def);
    const meshes = bodyMeshes(piece);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(finite(mesh.geometry.getAttribute("position") as THREE.BufferAttribute), `${def.kind} positions`).toBe(true);
      expect(finite(mesh.geometry.getAttribute("normal") as THREE.BufferAttribute), `${def.kind} normals`).toBe(true);
      expect(finite(mesh.geometry.getAttribute("uv") as THREE.BufferAttribute), `${def.kind} texture coordinates`).toBe(true);
    }
    disposeObject(piece);
  });

  it("inks every piece, with lines on the piece inside its catalogue box", () => {
    const scene = new PlanScene();
    scene.setEdges(true);
    const { model, items } = showroom();
    scene.update(model);
    const inverse = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const item of items) {
      const def = defOf(item.kind);
      const piece = scene.objects.find((o) => o.userData.entity === `item:${item.id}`)!;
      const ink = inkOf(piece);
      expect(ink.length, item.kind).toBeGreaterThan(0);
      piece.updateMatrixWorld(true);
      inverse.copy(piece.matrixWorld).invert();
      let count = 0;
      for (const lines of ink) {
        const position = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
        expect(finite(position), item.kind).toBe(true);
        for (let i = 0; i < position.count; i++) {
          // in the piece's own frame: x in ±w/2, y in [0, h] (and its fittings' rise), z in ±d/2
          p.fromBufferAttribute(position, i).applyMatrix4(lines.matrixWorld).applyMatrix4(inverse);
          expect(Math.abs(p.x), item.kind).toBeLessThanOrEqual(def.w / 2 + EPS);
          expect(Math.abs(p.z), item.kind).toBeLessThanOrEqual(def.d / 2 + EPS);
          expect(p.y, item.kind).toBeGreaterThanOrEqual(-EPS);
          expect(p.y, item.kind).toBeLessThanOrEqual(def.h + riseOf(def) + EPS);
          count++;
        }
      }
      expect(count, item.kind).toBeGreaterThan(0);
      // the ink is a drawing aid: a click passes through it
      for (const lines of ink) expect(lines.raycast).not.toBe(THREE.LineSegments.prototype.raycast);
    }
    scene.dispose();
  });

  it("selects any piece a click lands on, and nothing where the click finds only the ground", () => {
    const scene = new PlanScene();
    scene.setEdges(true);
    const { model, items } = showroom();
    scene.update(model);
    scene.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (const item of items) {
      const def = defOf(item.kind);
      // a grid of clicks straight down over the piece's footprint: some meet the piece (an open
      // frame such as a towel rail is missed between its rungs), and every one that meets
      // anything but the ground names this piece
      const picked = new Set<string>();
      let hits = 0;
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const lx = (i / 8 - 0.5) * def.w * 0.95;
          const lz = (j / 8 - 0.5) * def.d * 0.95;
          const r = (item.rotation * Math.PI) / 180;
          const x = item.x + lx * Math.cos(r) + lz * Math.sin(r);
          const z = item.y - lx * Math.sin(r) + lz * Math.cos(r);
          ray.set(new THREE.Vector3(x, 10, z), down);
          const hit = ray.intersectObjects(scene.objects, true)[0];
          if (!hit) continue;
          const entity = scene.entityOf(hit.object);
          if (entity) picked.add(`${entity.type}:${entity.id}`);
          hits++;
        }
      }
      expect(hits, item.kind).toBeGreaterThan(0);
      expect([...picked], item.kind).toEqual([`item:${item.id}`]);
    }
    // between the pieces the ground is all there is: nothing to select
    ray.set(new THREE.Vector3(-5, 10, 5), down);
    const ground = ray.intersectObjects(scene.objects, true)[0];
    expect(ground ? scene.entityOf(ground.object) : null).toBeNull();
    scene.dispose();
  });

  it("outlines a selected piece around the piece as it is drawn", () => {
    const scene = new PlanScene();
    const { model, items } = showroom();
    scene.update(model);
    scene.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const item of items) {
      const b = markBox("item", item.id, model)!;
      expect(b, item.kind).not.toBeNull();
      const piece = scene.objects.find((o) => o.userData.entity === `item:${item.id}`)!;
      // the outline stands MARKS.outline off a box turned with the piece: every point the piece
      // draws is inside that box
      const toBox = new THREE.Matrix4().makeRotationY(-b.ry).multiply(new THREE.Matrix4().makeTranslation(-b.cx, 0, -b.cz));
      for (const mesh of bodyMeshes(piece)) {
        const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toBox);
          expect(Math.abs(p.x), item.kind).toBeLessThanOrEqual(b.w / 2 + MARKS.outline);
          expect(Math.abs(p.z), item.kind).toBeLessThanOrEqual(b.d / 2 + MARKS.outline);
          expect(p.y, item.kind).toBeGreaterThanOrEqual(b.y0 - FLOOR_TOP - MARKS.outline);
          expect(p.y, item.kind).toBeLessThanOrEqual(b.y1 + MARKS.outline);
        }
      }
    }
    scene.dispose();
  });

  it("shares a kind's geometry and creases between its pieces, and keeps one drawn when the other goes", () => {
    const scene = new PlanScene();
    scene.setEdges(true);
    const two = { ...emptyModel(), items: [
      { id: "a", kind: "dining_chair", x: 0, y: 0, rotation: 0 },
      { id: "b", kind: "dining_chair", x: 2, y: 0, rotation: 0 },
    ] };
    scene.update(two);
    const pieceOf = (id: string) => scene.objects.find((o) => o.userData.entity === `item:${id}`)!;
    const [a, b] = [pieceOf("a"), pieceOf("b")];
    const geometries = bodyMeshes(a).map((m) => m.geometry);
    expect(bodyMeshes(b).map((m) => m.geometry)).toEqual(geometries);
    // the same lines, each piece its own line set (which goes with its piece)
    const lineArray = (o: THREE.Object3D) => Array.from((inkOf(o)[0].geometry.getAttribute("position") as THREE.BufferAttribute).array);
    expect(lineArray(b)).toEqual(lineArray(a));
    expect(inkOf(b)[0].geometry).not.toBe(inkOf(a)[0].geometry);
    // each stands on its own contact shadow
    expect(a.getObjectByName(CONTACT_SHADOW)).toBeDefined();
    const gone: THREE.BufferGeometry[] = [];
    for (const g of geometries) g.addEventListener("dispose", () => gone.push(g));
    scene.update({ ...two, items: two.items.slice(1) });
    expect(gone).toEqual([]);
    expect(bodyMeshes(pieceOf("b")).map((m) => m.geometry)).toEqual(geometries);
    scene.update({ ...two, items: [] });
    expect(new Set(gone)).toEqual(new Set(geometries));
    scene.dispose();
  });
});
