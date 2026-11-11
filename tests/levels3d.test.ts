/**
 * Storeys and stairs in the 3D view: the stair the model builds is the one the plan works out
 * (its risers and treads at the heights stairGeometry gives), within its triangle budget; every
 * level stands at its elevation, the upper ones on a slab with the stairwell left open; the
 * levels shown can be chosen, and the cut slices the topmost of them; a level removed takes all
 * it held off the GPU; the walker climbs the stair from one floor to the next and cannot step
 * into the stairwell from its side. No WebGL is needed: the scene graph is plain three.js.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlanScene } from "../src/three/planScene";
import { buildStair, stairTriangleBudget, stairTriangles, STAIR_MATERIALS } from "../src/three/stairs";
import { regionPieces, regionRim, piecesArea, type Poly } from "../src/model/region";
import { slabOutline, stairwellPolys } from "../src/model/floors";
import { coveredByShown, shownLevels, setLevelsShown, levelsShown } from "../src/three/levelView";
import { surfaceAt, stride, walkLevelAt, walkWorld, type Walker } from "../src/three/walk";
import { markBox, roomLid, SceneMarks } from "../src/three/marks";
import { CUT_PLANE, STOREY_PLANE, cutLevel, setCut, setStoreyTop, storeyTop } from "../src/three/cutaway";
import { CUT_CAP } from "../src/three/cutaway";
import { INK_STAIR, NO_INK } from "../src/three/edges";
import { wallMaterial } from "../src/three/build";
import { RoomLabels, labelAnchor, placeLabel } from "../src/three/labels";
import { newPose, orbitPose } from "../src/three/transitions";
import { isStatic } from "../src/three/materials";
import { CAMERA, CAMERA_FRAMING, FLOOR_TOP, LABELS, STAIR_MODEL, WALK } from "../src/three/config";
import { FIRST_LEVEL_ID, seedLoft, seedTownhouse } from "../src/model/seed";
import { levelSlice, levelsOf, stairGeometryIn } from "../src/model/levels";
import { stairGeometry } from "../src/model/stairs";
import { GROUND_LEVEL_ID, SLAB_THICKNESS, STAIR } from "../src/model/limits";
import type { PlanModel, Stair } from "../src/model/types";

const G = GROUND_LEVEL_ID;
const straight = (over: Partial<Stair> = {}): Stair => ({ id: "s", levelId: G, shape: "straight", x: 1, y: 1, rotation: 0, width: 0.9, ...over });

/** The heights of the tops of a mesh's upward faces, rounded to the millimetre. */
function upwardTops(mesh: THREE.Mesh): number[] {
  const pos = mesh.geometry.getAttribute("position");
  const nor = mesh.geometry.getAttribute("normal");
  const tops = new Set<number>();
  for (let i = 0; i < pos.count; i++) if (nor.getY(i) > 0.99) tops.add(Math.round(pos.getY(i) * 1e5) / 1e5);
  return [...tops].sort((a, b) => a - b);
}

const part = (stair: THREE.Group, name: string) => stair.children.find((c) => c.name === `stair:${name}`) as THREE.Mesh;

/** What a ray straight down from high over (x, z) meets first, among the scene's shown entities. */
function downAt(scene: PlanScene, x: number, z: number): THREE.Intersection | undefined {
  scene.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObjects(scene.objects, true).find((h) => {
    for (let n: THREE.Object3D | null = h.object; n; n = n.parent) if (!n.visible) return false;
    return true;
  });
}

afterEach(() => {
  setCut(null);
  setLevelsShown("active");
});

describe("a stair in the model", () => {
  it("has a tread for every step and a riser for every riser, at the heights the plan works out", () => {
    for (const rise of [2.6, 2.9, 3.4]) {
      const s = straight();
      const g = stairGeometry(s, rise);
      const built = buildStair(s, g);
      // the treads' tops are the plan's step tops, on the level's floor
      const tops = upwardTops(part(built, "tread"));
      expect(tops).toHaveLength(g.steps.length);
      g.steps.forEach((st, i) => expect(tops[i]).toBeCloseTo(st.top, 4));
      // one riser board (a box: 12 triangles) per riser, the last one reaching the floor above
      expect(stairTriangles(part(built, "riser"))).toBe(12 * g.risers);
      expect(Math.max(...upwardTops(part(built, "riser")))).toBeCloseTo(rise, 6);
      expect(built.position.y).toBe(FLOOR_TOP);
    }
  });

  it("builds an L-shaped stair's landing at the height of its riser and turns the second flight", () => {
    const s: Stair = { ...straight(), shape: "l", turn: "right" };
    const g = stairGeometry(s, 2.9);
    const built = buildStair(s, g);
    const tops = upwardTops(part(built, "tread"));
    expect(tops.some((t) => Math.abs(t - g.landing!.top) < 1e-4)).toBe(true);
    expect(tops).toHaveLength(g.steps.length + 1);
    built.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built);
    // the model stands on the plan's footprint: within the nosing, and the guard's posts on the
    // floor above, which stand at the stairwell's rim on the floor's side
    const margin = Math.max(STAIR_MODEL.nosing, STAIR_MODEL.postSize) + 1e-6;
    expect(box.min.x).toBeGreaterThan(g.box.minX - margin);
    expect(box.max.x).toBeLessThan(g.box.maxX + margin);
    // its rail ends over the top riser, at the floor above
    expect(box.max.y).toBeCloseTo(FLOOR_TOP + g.rise + STAIR_MODEL.handrailHeight + STAIR_MODEL.handrailSize / 2, 3);
  });

  it("stays within its triangle budget, from the shortest stair to the tallest", () => {
    for (const shape of ["straight", "l"] as const) {
      for (const risers of [STAIR.risers.min, 3, 16, 30, STAIR.risers.max]) {
        const s: Stair = { ...straight(), shape, risers };
        const g = stairGeometry(s, 2.9);
        expect(stairTriangles(buildStair(s, g))).toBeLessThanOrEqual(stairTriangleBudget(g.risers));
      }
    }
  });

  it("draws in four static surfaces the cutaway slices, one mesh each", () => {
    const s = straight();
    const built = buildStair(s, stairGeometry(s, 2.9));
    expect(built.children).toHaveLength(4);
    for (const m of Object.values(STAIR_MATERIALS)) {
      expect(isStatic(m)).toBe(true);
      setCut(1);
      expect(m.clippingPlanes).not.toBeNull();
      setCut(null);
    }
  });
});

describe("regions with holes", () => {
  const square = (x0: number, y0: number, x1: number, y1: number): Poly => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it("cuts a rectangle less a turned hole into pieces of exactly its area", () => {
    const hole: Poly = [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
    ];
    expect(piecesArea(regionPieces([square(0, 0, 4, 4)], [hole]))).toBeCloseTo(16 - 2, 9);
    // two rooms that overlap count once
    expect(piecesArea(regionPieces([square(0, 0, 3, 2), square(2, 0, 5, 2)]))).toBeCloseTo(10, 9);
  });

  it("finds the rim: the outline and the hole's, each once, facing out of the region", () => {
    const rim = regionRim([square(0, 0, 4, 4)], [square(1, 1, 2, 3)]);
    const length = rim.reduce((s, e) => s + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 0);
    expect(length).toBeCloseTo(16 + 6, 9);
    // the hole's west edge faces east, into the hole
    const west = rim.find((e) => e.a.x === 1 && e.b.x === 1)!;
    expect(west.nx).toBeCloseTo(1);
    // a shared edge between two rooms is not rim
    const two = regionRim([square(0, 0, 2, 2), square(2, 0, 4, 2)]);
    expect(two.some((e) => e.a.x === 2 && e.b.x === 2)).toBe(false);
  });
});

describe("storeys in the scene", () => {
  it("stands every level at its elevation, with the upper floor on a slab open over the stair", () => {
    const m = seedTownhouse();
    const scene = new PlanScene();
    scene.update(m);
    const [ground, first] = levelsOf(m);
    expect(scene.levelGroups.get(ground.level.id)!.position.y).toBe(0);
    expect(scene.levelGroups.get(first.level.id)!.position.y).toBeCloseTo(first.elevation);
    expect(scene.counts).toEqual({ stairs: 1, slabs: 1, columns: 0 });
    const stair = m.stairs[0];
    const g = stairGeometryIn(m, stair)!;
    // beside the stairwell, the landing's floor; over the stairwell, down through the void to a tread
    const floorHit = downAt(scene, 1.6, 3)!;
    expect(scene.entityOf(floorHit.object)).toMatchObject({ type: "room", id: "f_room_hall", levelId: FIRST_LEVEL_ID });
    expect(floorHit.point.y).toBeCloseTo(first.elevation + FLOOR_TOP);
    const wellHit = downAt(scene, stair.x, 3)!;
    expect(scene.entityOf(wellHit.object)).toMatchObject({ type: "stair", id: stair.id, levelId: G });
    expect(wellHit.point.y).toBeLessThan(first.elevation - SLAB_THICKNESS);
    // the hall's floor finish is cut too: no ink on its pieced top, its rim inked by its sides
    const hall = scene.objects.find((o) => o.userData.entity === "floor:f_room_hall") as THREE.Mesh;
    expect(hall.userData[NO_INK]).toBe(true);
    // the opening is the stair's footprint, from the plan
    expect(stairwellPolys(m, FIRST_LEVEL_ID)).toHaveLength(g.footprint.length);
    scene.dispose();
  });

  it("covers the level's rooms and walls with its slab, corners closed", () => {
    const m = seedTownhouse();
    const area = piecesArea(regionPieces(slabOutline(levelSlice(m, FIRST_LEVEL_ID))));
    // the shell's outer faces: 8.15 × 6.15
    expect(area).toBeCloseTo(8.15 * 6.15, 6);
  });

  it("shows the levels up to the one asked for, and frames only those", () => {
    const m = seedTownhouse();
    expect(shownLevels(m, G, "active").map((l) => l.level.id)).toEqual([G]);
    expect(shownLevels(m, FIRST_LEVEL_ID, "active").map((l) => l.level.id)).toEqual([G, FIRST_LEVEL_ID]);
    expect(shownLevels(m, G, "all")).toHaveLength(2);
    expect(shownLevels(m, FIRST_LEVEL_ID, G)).toHaveLength(1);
    expect(shownLevels(m, G, "gone")).toHaveLength(1);
    expect(shownLevels(m, G, "active", true)).toHaveLength(2);
    const scene = new PlanScene();
    scene.update(m);
    const all = scene.bounds(new THREE.Box3()).max.y;
    expect(scene.setLevels(new Set([G]))).toBe(true);
    expect(scene.levelGroups.get(FIRST_LEVEL_ID)!.visible).toBe(false);
    expect(scene.bounds(new THREE.Box3()).max.y).toBeLessThan(all);
    // hidden walls and slabs hide no room's name
    expect(scene.occluders.every((o) => o.parent === scene.levelGroups.get(G))).toBe(true);
    expect(downAt(scene, 1.6, 3) && scene.entityOf(downAt(scene, 1.6, 3)!.object)?.levelId).toBe(G);
    expect(scene.setLevels(new Set([G]))).toBe(false);
    scene.dispose();
  });

  it("keeps the setting for the page's life, and tells who listens", () => {
    setLevelsShown("all");
    expect(levelsShown()).toBe("all");
  });

  it("caps the walls of the storey the cut passes through, and only those", () => {
    const m = seedTownhouse();
    const first = levelsOf(m)[1];
    const scene = new PlanScene();
    scene.update(m);
    setCut(1.2, first.elevation);
    scene.setCut(cutLevel());
    const capped = (prefix: string) => scene.walls.filter((w) => w.userData.entity.startsWith(`wall:${prefix}`) && w.getObjectByName(CUT_CAP));
    expect(capped("f_")).toHaveLength(5);
    expect(capped("g_")).toHaveLength(0);
    const cap = capped("f_")[0].getObjectByName(CUT_CAP) as THREE.Mesh;
    scene.root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(cap).max.y).toBeCloseTo(first.elevation + FLOOR_TOP + 1.2, 6);
    scene.dispose();
  });

  it("moves the storeys above a level whose height changes, and rebuilds nothing but the stair and slab", () => {
    const m = seedTownhouse();
    const scene = new PlanScene();
    scene.update(m);
    const taller: PlanModel = { ...m, levels: m.levels.map((l, i) => (i === 0 ? { ...l, height: 3.2 } : l)) };
    const r = scene.update(taller);
    expect(scene.levelGroups.get(FIRST_LEVEL_ID)!.position.y).toBeCloseTo(3.2);
    // the stair climbs further (rebuilt), the slab's opening follows it (rebuilt), and so does the
    // floor it crosses; the walls, rooms and pieces stay as they were
    expect(r.rebuilt).toBeLessThanOrEqual(3);
    expect(r).toMatchObject({ added: 0, removed: 0 });
    scene.dispose();
  });

  it("takes a removed level off the GPU, everything on it with it", () => {
    const m = seedTownhouse();
    const scene = new PlanScene();
    scene.update(m);
    const upstairs = scene.levelGroups.get(FIRST_LEVEL_ID)!;
    // what the level built for itself (a piece's geometries are its kind's, shared: see planScene.test.ts)
    const geometries: THREE.BufferGeometry[] = [];
    for (const o of upstairs.children) if (!o.userData.entity.startsWith("item:")) o.traverse((c) => (c as THREE.Mesh).geometry && geometries.push((c as THREE.Mesh).geometry));
    const disposed = new Set<THREE.BufferGeometry>();
    for (const g of geometries) g.addEventListener("dispose", () => disposed.add(g));
    const ground = levelSlice(m, G);
    const r = scene.update({ ...ground, levels: [m.levels[0]] });
    expect(r.removed).toBe(5 + 1 + 2 * 2 + 1); // walls, slab, floors and pendants, the bed
    expect(scene.levelGroups.has(FIRST_LEVEL_ID)).toBe(false);
    expect(upstairs.parent).toBeNull();
    expect(geometries.length).toBeGreaterThan(0);
    expect(geometries.every((g) => disposed.has(g))).toBe(true);
    expect(scene.counts.slabs).toBe(0);
    scene.dispose();
  });

  it("builds a one-storey plan as before: no slab, no stair", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    expect(scene.counts).toEqual({ stairs: 0, slabs: 0, columns: 0 });
    expect(scene.levelGroups.size).toBe(1);
    scene.dispose();
  });
});

describe("marks on every storey", () => {
  it("lifts a mark onto its entity's level, and the room's lid to its own ceiling or the cut", () => {
    const m = seedTownhouse();
    const first = levelsOf(m)[1];
    expect(markBox("wall", "f_wall_n", m)).toMatchObject({ y0: first.elevation, y1: first.elevation + 2.7 });
    expect(markBox("wall", "g_wall_n", m)).toMatchObject({ y0: 0, y1: 2.7 });
    expect(markBox("stair", "stair_main", m)!.y1).toBeCloseTo(FLOOR_TOP + first.elevation);
    expect(markBox("level", FIRST_LEVEL_ID, m)).toMatchObject({ y0: first.elevation });
    expect(roomLid(m, FIRST_LEVEL_ID, null)).toBeCloseTo(first.elevation + 2.7);
    expect(roomLid(m, FIRST_LEVEL_ID, first.elevation + 1)).toBeCloseTo(first.elevation + 1);
    expect(roomLid(m, G, first.elevation + 1)).toBeCloseTo(2.7);
  });

  it("marks nothing on a level the view hides", () => {
    const m = seedTownhouse();
    const marks = new SceneMarks();
    marks.update(m, { type: "item", id: "f_item_bed" }, [], 0, new Set([G]));
    expect(marks.counts.selection).toBe(0);
    marks.update(m, { type: "item", id: "f_item_bed" }, [], 0, null);
    expect(marks.counts.selection).toBe(1);
    marks.update(m, { type: "stair", id: "stair_main" }, [{ type: "level", id: FIRST_LEVEL_ID, label: "First floor" }], 0, new Set([G, FIRST_LEVEL_ID]));
    expect(marks.counts).toEqual({ selection: 1, pending: 1 });
    marks.dispose();
  });
});

describe("walking between storeys", () => {
  const m = seedTownhouse();
  const world = walkWorld(m);
  const first = levelsOf(m)[1];
  const stair = m.stairs[0];
  const g = stairGeometryIn(m, stair)!;
  const shut = () => 0;
  /** Stride from `w` by (dx, dz) a step at a time, `n` times; returns how many strides went. */
  const walkOn = (w: Walker, dx: number, dz: number, n: number) => {
    let went = 0;
    for (let i = 0; i < n; i++) if (stride(world, w, dx, dz, shut)) went++;
    return went;
  };

  it("climbs the stair a tread at a time to the floor above, and comes back down", () => {
    const w: Walker = { x: stair.x, z: stair.y + 0.6, height: 0 };
    const heights: number[] = [];
    // up the stair, north, onto the landing hall
    for (let i = 0; i < 100; i++) {
      stride(world, w, 0, -0.05, shut);
      heights.push(w.height);
    }
    expect(w.z).toBeLessThan(g.end.y);
    expect(w.height).toBeCloseTo(first.elevation);
    expect(world.levels[walkLevelAt(world, w.height)].id).toBe(FIRST_LEVEL_ID);
    // never more than one riser at a time, and every height a tread's (or a floor's)
    for (let i = 1; i < heights.length; i++) expect(Math.abs(heights[i] - heights[i - 1])).toBeLessThanOrEqual(g.riserHeight + 1e-9);
    const treads = new Set([0, ...g.steps.map((s) => s.top), first.elevation].map((h) => h.toFixed(6)));
    for (const h of heights) expect(treads.has(h.toFixed(6))).toBe(true);
    // and down again, into the stairwell from its top end
    walkOn(w, 0, 0.05, 100);
    expect(w.height).toBe(0);
    expect(w.z).toBeGreaterThan(stair.y);
  });

  it("cannot step into the stairwell from beside it, nor off the stair's side", () => {
    const up: Walker = { x: 1.4, z: 3, height: first.elevation };
    walkOn(up, -0.05, 0, 40);
    expect(up.x).toBeGreaterThan(g.box.maxX - 1e-5);
    expect(up.height).toBe(first.elevation);
    // halfway up, the side is a drop of more than a stride
    const mid = g.steps[7];
    const on: Walker = { x: mid.rect.cx, z: mid.rect.cy, height: mid.top };
    expect(surfaceAt(world, g.box.maxX + 0.1, mid.rect.cy, mid.top)).toBeNull();
    walkOn(on, 0.05, 0, 20);
    expect(on.x).toBeLessThan(g.box.maxX + 1e-5);
    expect(on.height).toBe(mid.top);
    expect(WALK.maxStep).toBeGreaterThan(STAIR.riser.max);
  });

  it("walks under nothing: the floor under a stair's high end is the stair's, not a floor to pass under", () => {
    // beside the top of the flight, on the ground, the stair's side is a wall of treads
    const w: Walker = { x: 1.5, z: g.end.y + 0.3, height: 0 };
    walkOn(w, -0.05, 0, 30);
    expect(w.x).toBeGreaterThan(g.box.maxX - 1e-9);
    expect(w.height).toBe(0);
  });
});

describe("the stairwell's balustrade", () => {
  it("stands its rail over the floor above round the void, but not across the way onto that floor", () => {
    const s = straight();
    const g = stairGeometry(s, 2.9);
    const rail = part(buildStair(s, g), "rail");
    const pos = rail.geometry.getAttribute("position");
    const top = g.rise + STAIR_MODEL.handrailHeight + STAIR_MODEL.handrailSize / 2;
    let behindStart = false;
    let pastArrival = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - top) > 1e-6) continue;
      // the stair climbs +y (plan) = +z from its bottom riser at z = s.y, arriving at g.end
      if (pos.getZ(i) < s.y) behindStart = true;
      if (pos.getZ(i) > g.end.y + STAIR_MODEL.postSize) pastArrival = true;
    }
    // the rail runs along the void's start edge, at guard height over the upper floor
    expect(behindStart).toBe(true);
    // and leaves the edge the stair arrives across open
    expect(pastArrival).toBe(false);
  });
});

describe("a stair under a storey not shown", () => {
  afterEach(() => setStoreyTop(null));

  it("stops at the ceiling of the topmost storey shown: its own surfaces and ink are clipped there, the walls' are not", () => {
    expect(setStoreyTop(2.7)).toBe(true);
    expect(storeyTop()).toBe(2.7);
    for (const m of Object.values(STAIR_MATERIALS)) expect(m.clippingPlanes).toContain(STOREY_PLANE);
    expect(INK_STAIR.clippingPlanes).toContain(STOREY_PLANE);
    expect(wallMaterial.clippingPlanes ?? []).not.toContain(STOREY_PLANE);
    // the cut comes on: a stair is clipped by both, a wall by the cut alone
    setCut(1.2);
    for (const m of Object.values(STAIR_MATERIALS)) expect(m.clippingPlanes).toEqual([CUT_PLANE, STOREY_PLANE]);
    expect(wallMaterial.clippingPlanes).toEqual([CUT_PLANE]);
    setCut(null);
    expect(setStoreyTop(2.7)).toBe(false);
    setStoreyTop(null);
    for (const m of Object.values(STAIR_MATERIALS)) expect(m.clippingPlanes ?? []).toHaveLength(0);
  });
});

describe("keeping what did not change", () => {
  afterEach(() => setCut(null));

  it("moves a stair to another level of the same height into that level's group", () => {
    const base = seedTownhouse();
    const m: PlanModel = { ...base, levels: [...base.levels, { id: "level_attic", name: "Attic", height: base.levels[1].height }] };
    const scene = new PlanScene();
    scene.update(m);
    const moved: PlanModel = { ...m, stairs: m.stairs.map((s) => ({ ...s, levelId: FIRST_LEVEL_ID })) };
    scene.update(moved);
    const stair = scene.objects.find((o) => o.userData.entity === "stair:stair_main")!;
    expect(stair.parent).toBe(scene.levelGroups.get(FIRST_LEVEL_ID));
    expect(scene.entityOf(stair)).toMatchObject({ type: "stair", levelId: FIRST_LEVEL_ID });
    scene.dispose();
  });

  it("with the cutaway on, keeps every wall's cap when nothing about it changed, and builds one again when its floor moves", () => {
    const m = seedLoft();
    const scene = new PlanScene();
    scene.update(m);
    setCut(1.2);
    scene.setCut(cutLevel());
    const caps = () => scene.walls.map((w) => (w.getObjectByName(CUT_CAP) as THREE.Mesh).geometry.id);
    const before = caps();
    expect(before).toHaveLength(m.walls.length);
    const r = scene.update({ ...m, items: m.items.map((it, i) => (i === 0 ? { ...it, x: it.x + 0.1 } : it)) });
    expect(r).toMatchObject({ moved: 1, rebuilt: 0 });
    expect(caps()).toEqual(before);
    scene.dispose();

    const t = seedTownhouse();
    const two = new PlanScene();
    two.update(t);
    setCut(1.2, levelsOf(t)[1].elevation);
    two.setCut(cutLevel());
    const upper = () => two.walls.filter((w) => w.userData.entity.startsWith("wall:f_")).map((w) => w.getObjectByName(CUT_CAP) as THREE.Mesh | undefined);
    const ids = upper().map((c) => c?.geometry.id);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    // the ground storey grows: the floor above rises under a cut that stays put, so its caps are built again lower
    two.update({ ...t, levels: t.levels.map((l, i) => (i === 0 ? { ...l, height: l.height + 0.3 } : l)) });
    expect(upper().map((c) => c?.geometry.id)).not.toEqual(ids);
    two.dispose();
  });
});

describe("room names under a storey shown", () => {
  it("hide the names of the rooms the floor above covers, from straight above, and keep the upper floor's", () => {
    const m = seedTownhouse();
    const scene = new PlanScene();
    scene.update(m);
    const shown = new Set([G, FIRST_LEVEL_ID]);
    scene.setLevels(shown);
    scene.root.updateMatrixWorld(true);
    const living = m.rooms.find((r) => r.id === "g_room_living")!;
    const at = labelAnchor(living);
    const cam = new THREE.PerspectiveCamera(50, 1280 / 800, 0.1, 200);
    cam.position.set(at.x, 18, at.z + 0.01);
    cam.lookAt(at.x, 0, at.z);
    cam.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    // the lid it used to fall back to lies inside the slab above, close enough under its top to pass for seen
    expect(placeLabel(living, cam, 1280, 800, 0, ray, scene.occluders, null, roomLid(m, G, null) + LABELS.lift).visible).toBe(true);
    expect(coveredByShown(m, shown, G)).toBe(true);
    expect(coveredByShown(m, shown, FIRST_LEVEL_ID)).toBe(false);
    expect(coveredByShown(m, new Set([G]), G)).toBe(false);

    const layer = document.createElement("div");
    const labels = new RoomLabels(layer);
    labels.setRooms(m, null, [], shown);
    labels.place(cam, 1280, 800, scene.occluders, null, (room) => (coveredByShown(m, shown, room.levelId) ? null : roomLid(m, room.levelId, null)));
    const label = (text: string) => [...layer.querySelectorAll(".scene-label")].find((el) => el.querySelector(".scene-label__name")?.textContent === text) as HTMLElement;
    expect(label("Living").hidden).toBe(true);
    expect(label("Bedroom").hidden).toBe(false);
    labels.dispose();
    scene.dispose();
  });
});

describe("framing the storeys shown", () => {
  it("keeps every corner of a stack of storeys in the Orbit frame, and a single storey framed as it was", () => {
    const corners = (w: number, d: number, roof: number) => [0, w].flatMap((x) => [0, d].flatMap((z) => [0, roof].map((y) => new THREE.Vector3(x, y, z))));
    for (const [w, d, n] of [
      [10, 8, 1],
      [10, 8, 2],
      [10, 8, 3],
      [8, 6, 2],
      [14, 10, 3],
      [6, 5, 4],
    ] as const) {
      const storey = 2.9;
      const top = (n - 1) * storey;
      const cam = new THREE.PerspectiveCamera(CAMERA.fov, 1.3, CAMERA.near, CAMERA.far);
      const pose = orbitPose(new THREE.Vector3(w / 2, 0, d / 2), Math.max(w, d, CAMERA.minFitRadius), 0, top, cam.aspect, newPose());
      cam.position.copy(pose.position);
      cam.up.copy(pose.up);
      cam.lookAt(pose.target);
      cam.updateMatrixWorld();
      for (const p of corners(w, d, top + 2.7)) {
        const ndc = p.clone().project(cam);
        expect(Math.abs(ndc.x), `${w}x${d}, ${n} storeys`).toBeLessThan(1);
        expect(Math.abs(ndc.y), `${w}x${d}, ${n} storeys`).toBeLessThan(1);
      }
    }
    // one storey: the plan's size alone sets the distance, the pivot a table top over its floor
    const one = orbitPose(new THREE.Vector3(5, 0, 4), 10, 0, 0, 1.3, newPose());
    const [east, up, south] = CAMERA_FRAMING.orbit.offset;
    expect(one.position.toArray()).toEqual([5 + 10 * east, 10 * up, 4 + 10 * south]);
    expect(one.target.y).toBe(CAMERA_FRAMING.orbit.targetHeight);
  });
});
