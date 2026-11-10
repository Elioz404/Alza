/**
 * The 3D scene's content is reconciled with the plan entity by entity, instead of thrown away
 * and rebuilt on every change. No WebGL is needed for any of this: the scene graph, the
 * geometries, materials and textures are plain three.js objects, and what a renderer would hold
 * on the GPU is exactly what is reachable from the scene and not yet disposed — which is what
 * the tracker below counts, the way renderer.info.memory does.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlanScene } from "../src/three/planScene";
import { MaterialCache, disposeObject, isStatic, materialsOf, texturesOf } from "../src/three/materials";
import { buildFurniture } from "../src/three/furniture";
import { PATTERN_NAMES } from "../src/three/surfaces";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { seedLoft } from "../src/model/seed";
import { emptyModel, type Item, type PlanModel } from "../src/model/types";

// No canvas is needed either: the surfaces' patterns are computed texel by texel (surfaces.ts),
// so the textures (and what is and is not disposed) are real here.

/**
 * GPU memory as renderer.info.memory would count it: every geometry and texture that has been
 * reachable from the scene (so would have been uploaded) and has not been disposed since.
 * Static resources are left out — they are made once per page and shared by every scene.
 */
function gpuTracker(root: THREE.Object3D) {
  const live = { geometries: new Set<THREE.BufferGeometry>(), textures: new Set<THREE.Texture>(), materials: new Set<THREE.Material>() };
  const track = <T extends { addEventListener(type: "dispose", fn: () => void): void }>(set: Set<T>, r: T) => {
    if (set.has(r)) return;
    set.add(r);
    r.addEventListener("dispose", () => set.delete(r));
  };
  return {
    sample() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) track(live.geometries, mesh.geometry);
      });
      for (const m of materialsOf(root)) {
        if (!isStatic(m)) track(live.materials, m);
        for (const t of texturesOf(m)) if (!isStatic(t)) track(live.textures, t);
      }
      return { geometries: live.geometries.size, textures: live.textures.size, materials: live.materials.size };
    },
  };
}

const sofa = (id: string, x: number): Item => ({ id, kind: "sofa", x, y: 1, rotation: 0 });

describe("PlanScene.update", () => {
  it("builds every entity once and keeps them all when nothing changed", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    const first = scene.update(m);
    expect(first.added).toBe(m.walls.length + 2 * m.rooms.length + m.items.length);
    const again = scene.update({ ...m });
    expect(again).toEqual({ added: 0, rebuilt: 0, moved: 0, removed: 0, kept: first.added });
    scene.dispose();
  });

  it("moves a piece of furniture that only moved, without building it again", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    const piece = scene.root.children.find((o) => o.position.x === m.items[0].x && o.position.z === m.items[0].y)!;
    const moved = { ...m, items: m.items.map((it, i) => (i === 0 ? { ...it, x: it.x + 0.5 } : it)) };
    const r = scene.update(moved);
    expect(r).toMatchObject({ added: 0, rebuilt: 0, removed: 0, moved: 1 });
    expect(scene.root.children).toContain(piece);
    expect(piece.position.x).toBeCloseTo(m.items[0].x + 0.5);
    scene.dispose();
  });

  it("rebuilds only the wall that gained a door", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    const wall = m.walls.find((w) => !m.openings.some((o) => o.wallId === w.id)) ?? m.walls[0];
    const withDoor: PlanModel = {
      ...m,
      openings: [...m.openings, { id: "door_new", kind: "door", wallId: wall.id, t: 0.5, width: 0.8, sill: 0, height: 2.1, hinge: "a", side: "right" }],
    };
    expect(scene.update(withDoor)).toMatchObject({ added: 0, rebuilt: 1, removed: 0 });
    expect(scene.doors.some((d) => d.doorId === "door_new")).toBe(true);
    scene.dispose();
  });

  it("moving a wall rebuilds it and the neighbours its joints touch, and nothing else", () => {
    const walls = [
      { id: "a", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
      { id: "b", ax: 4, ay: 0, bx: 4, by: 3, thickness: 0.15, height: 2.7 },
      { id: "far", ax: 10, ay: 0, bx: 14, by: 0, thickness: 0.15, height: 2.7 },
    ];
    const scene = new PlanScene();
    scene.update({ ...emptyModel(), walls });
    // a thicker "b" changes how far "a" reaches into the corner, and nothing about "far"
    const r = scene.update({ ...emptyModel(), walls: walls.map((w) => (w.id === "b" ? { ...w, thickness: 0.3 } : w)) });
    expect(r).toMatchObject({ rebuilt: 2, kept: 1, added: 0, removed: 0 });
    scene.dispose();
  });

  it("removes what the plan no longer has", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    const r = scene.update({ ...m, items: [], rooms: [] });
    expect(r.removed).toBe(m.items.length + 2 * m.rooms.length);
    expect(scene.size).toBe(m.walls.length);
    scene.dispose();
  });

  it("keeps a door open across a rebuild of its wall", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    const door = m.openings.find((o) => o.kind === "door")!;
    scene.setDoors({ state: "open", id: door.id });
    for (let i = 0; i < 200; i++) scene.stepDoors(0.05);
    expect(scene.openness(door.id)).toBeCloseTo(1);
    // the wall is rebuilt: a window is added beside the door
    const host = m.walls.find((w) => w.id === door.wallId)!;
    const t = door.t > 0.5 ? 0.15 : 0.85;
    const r = scene.update({ ...m, openings: [...m.openings, { id: "win_new", kind: "window", wallId: host.id, t, width: 0.4, sill: 0.9, height: 1 }] });
    expect(r.rebuilt).toBeGreaterThanOrEqual(1);
    const leaf = scene.doors.find((d) => d.doorId === door.id)!;
    expect(leaf.hinge.rotation.y).toBeCloseTo(leaf.swing);
    scene.dispose();
  });

  it("stops asking for frames once every door has arrived", () => {
    const scene = new PlanScene();
    scene.update(seedLoft());
    expect(scene.stepDoors(0.016)).toBe(false);
    expect(scene.setDoors({ state: "toggle" })).toBe(true);
    let frames = 0;
    while (scene.stepDoors(0.016)) frames++;
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(200);
    expect(scene.stepDoors(0.016)).toBe(false);
    scene.dispose();
  });

  it("puts a door where it is going at once under reduced motion, with no swing to draw", () => {
    const scene = new PlanScene();
    scene.update(seedLoft());
    expect(scene.setDoors({ state: "open" }, true)).toBe(true);
    for (const leaf of scene.doors) expect(leaf.hinge.rotation.y).toBeCloseTo(leaf.swing);
    expect(scene.stepDoors(0.016)).toBe(false);
    for (const leaf of scene.doors) expect(scene.openness(leaf.doorId)).toBe(1);
    expect(scene.setDoors({ state: "toggle" }, true)).toBe(true);
    for (const leaf of scene.doors) expect(leaf.hinge.rotation.y).toBeCloseTo(0);
    expect(scene.stepDoors(0.016)).toBe(false);
    scene.dispose();
  });
});

describe("GPU resources", () => {
  it("return to the baseline after many add / remove cycles", () => {
    const scene = new PlanScene();
    const tracker = gpuTracker(scene.root);
    scene.update(emptyModel());
    const baseline = tracker.sample();
    const seed = seedLoft();
    let loaded = { geometries: 0, textures: 0, materials: 0 };
    const sampled = new Set<THREE.Texture>();
    for (let cycle = 0; cycle < 5; cycle++) {
      scene.update(seed);
      loaded = tracker.sample();
      for (const m of materialsOf(scene.root)) for (const t of texturesOf(m)) sampled.add(t);
      // move every piece and re-floor every room: rebuilds and moves, not just adds
      scene.update({
        ...seed,
        items: seed.items.map((it) => ({ ...it, x: it.x + 0.05 })),
        rooms: seed.rooms.map((r) => ({ ...r, floor: r.floor === "oak" ? "tile" : "oak" })),
      });
      tracker.sample();
      scene.update(emptyModel());
      expect(tracker.sample()).toEqual(baseline);
      expect(scene.materials.size).toBe(0);
    }
    expect(loaded.geometries).toBeGreaterThan(baseline.geometries + 100);
    // textures are the shared patterns (surfaces.ts): drawn with, but never made per entity
    expect(loaded.textures).toBe(baseline.textures);
    expect(sampled.size).toBeGreaterThan(0);
    expect(sampled.size).toBeLessThanOrEqual(PATTERN_NAMES.length + 1); // + the contact shadow's
    expect([...sampled].every(isStatic)).toBe(true);
    scene.dispose();
    expect(tracker.sample()).toEqual({ geometries: 0, textures: 0, materials: 0 });
  });

  it("frees a removed floor's geometries and its shared material, never the shared pattern", () => {
    const scene = new PlanScene();
    const room = { id: "r", x: 0, y: 0, w: 3, h: 3, label: "R", floor: "oak" as const };
    scene.update({ ...emptyModel(), rooms: [room] });
    const floor = scene.root.children.find((o) => (o as THREE.Mesh).isMesh && o.name !== "ground") as THREE.Mesh;
    const material = floor.material as THREE.MeshStandardMaterial;
    const disposed = { geometry: false, material: false, texture: false };
    floor.geometry.addEventListener("dispose", () => (disposed.geometry = true));
    material.addEventListener("dispose", () => (disposed.material = true));
    material.map!.addEventListener("dispose", () => (disposed.texture = true));
    scene.update(emptyModel());
    expect(disposed).toEqual({ geometry: true, material: true, texture: false });
    // the next oak floor samples the very same texture
    scene.update({ ...emptyModel(), rooms: [{ ...room, id: "r2" }] });
    const next = scene.root.children.find((o) => (o as THREE.Mesh).isMesh && o.name !== "ground") as THREE.Mesh;
    expect((next.material as THREE.MeshStandardMaterial).map).toBe(material.map);
    scene.dispose();
  });
});

describe("shared materials", () => {
  it("two pieces of the same kind draw with the same materials", () => {
    const scene = new PlanScene();
    scene.update({ ...emptyModel(), items: [sofa("s1", 0), sofa("s2", 3)] });
    const pieces = scene.root.children.filter((o) => o.name !== "ground");
    const [a, b] = pieces.map((p) => materialsOf(p));
    expect([...a]).toEqual([...b]);
    const sizeForTwo = scene.materials.size;
    scene.update({ ...emptyModel(), items: [sofa("s1", 0), sofa("s2", 3), sofa("s3", 6)] });
    expect(scene.materials.size).toBe(sizeForTwo);
    scene.dispose();
  });

  it("a material stays while any piece holds it and goes with the last one", () => {
    const scene = new PlanScene();
    scene.update({ ...emptyModel(), items: [sofa("s1", 0), sofa("s2", 3)] });
    const shared = [...materialsOf(scene.root.children.find((o) => o.name !== "ground")!)].find((m) => scene.materials.owns(m))!;
    let disposed = false;
    shared.addEventListener("dispose", () => (disposed = true));
    scene.update({ ...emptyModel(), items: [sofa("s2", 3)] });
    expect(disposed).toBe(false);
    scene.update(emptyModel());
    expect(disposed).toBe(true);
  });

  it("counts by piece, however many meshes share a material or how often the builder asked", () => {
    const cache = new MaterialCache();
    const pieces = BUILT_IN_KINDS.map((def) => buildFurniture(def, cache));
    for (const p of pieces) cache.retain(p);
    expect(cache.sweep()).toBe(0);
    for (const p of pieces) {
      cache.release(p);
      disposeObject(p, cache);
    }
    expect(cache.sweep()).toBeGreaterThan(0);
    expect(cache.size).toBe(0);
  });

  it("never disposes a static material with a piece", () => {
    const def = BUILT_IN_KINDS.find((k) => k.kind === "sofa")!;
    const piece = buildFurniture(def); // no cache: the piece owns its materials
    const statics = [...materialsOf(piece)].filter(isStatic);
    expect(statics.length).toBeGreaterThan(0); // the sofa's feet are the shared dark finish
    const disposed: THREE.Material[] = [];
    for (const m of materialsOf(piece)) m.addEventListener("dispose", () => disposed.push(m));
    disposeObject(piece);
    for (const m of statics) expect(disposed).not.toContain(m);
    expect(disposed.length).toBe(materialsOf(piece).size - statics.length);
  });
});
