/**
 * The 3D view's continuity with the plan and its architectural style, without WebGL: the scene
 * graph, the clipping plane, the marks and the camera moves are plain three.js objects and maths.
 *
 *  - Selection is shared: a click's hit on a mesh names the plan entity the store selects, and
 *    the store's selection is outlined in the accent; a pending removal is hatched in the error
 *    colour until it is answered.
 *  - The cutaway slices the walls' materials, and only theirs, at the height asked, and closes
 *    each cut wall in the plan's poché, open across the doorways and windows it passes through.
 *  - Ink edges are added to any built piece, one line set per rigid part, and come off again.
 *  - Camera moves ease, finish at once when interrupted, and take no time under reduced motion.
 *  - Walk sets the walker down inside a room, on a free spot, facing into it.
 *  - The 3D style is a view setting: a schema-first tool sets it, and it never enters the undo
 *    history.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlanScene } from "../src/three/planScene";
import { buildFurniture } from "../src/three/furniture";
import {
  buildWall,
  curtainedWindows,
  doorLeafMaterial,
  frameMaterial,
  glassMaterial,
  jointExtensions,
  openingsByWall,
  wallCutCap,
  wallMaterial,
} from "../src/three/build";
import { CUT_CAP, CUT_PLANE, POCHE, cutLevel, setCut } from "../src/three/cutaway";
import { INK, INK_CLIPPED, INK_EDGE, INK_STAIR, addInkEdges, findCreases, removeInkEdges } from "../src/three/edges";
import { SceneMarks, markBox, hatch, hatchGeometry, hatchImage } from "../src/three/marks";
import { labelAnchor, placeLabel } from "../src/three/labels";
import { ScreenLineMaterial, screenLines } from "../src/three/screenLines";
import { riseOf } from "../src/three/furnitureStyle";
import { contrast } from "../src/ui/theme/color";
import { CameraMove, EASINGS, framedRadius, moveSeconds, newPose } from "../src/three/transitions";
import { blocked, blockersFor, walkEntry } from "../src/three/walk";
import { disposeObject, materialsOf } from "../src/three/materials";
import { CAMERA, CAMERA_FRAMING, CUTAWAY, EDGES, FLOOR_TOP, LABELS, MARKS, TRANSITIONS, WALK, WALK_ENTRY } from "../src/three/config";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { seedLoft } from "../src/model/seed";
import { CUT_HEIGHT, GROUND_LEVEL_ID, SCENE_STYLE_DEFAULTS } from "../src/model/limits";
import { MATERIAL, SCENE_MARK } from "../src/ui/theme/sceneTokens";
import { actions, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { TOOLS, runToolManually } from "../src/mcp/tools";
import { inputSchemaOf } from "../src/mcp/registry";
import { resetStore } from "./support/store";

const kind = (k: string) => BUILT_IN_KINDS.find((d) => d.kind === k)!;
const lines = (root: THREE.Object3D) => {
  const found: THREE.LineSegments[] = [];
  root.traverse((o) => o.name === INK_EDGE && found.push(o as THREE.LineSegments));
  return found;
};

afterEach(() => {
  setCut(null);
});

// ---------------------------------------------------------------------------- selection

describe("selection shared between the plan and the model", () => {
  /** What a click straight down on (x, z) of the plan hits, as the viewport asks. */
  function clickDown(scene: PlanScene, x: number, z: number) {
    scene.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(scene.objects, true)[0];
    return hit ? scene.entityOf(hit.object) : null;
  }

  it("names the piece, the room or the wall a click on the model hit, as the store selects them", () => {
    const scene = new PlanScene();
    scene.update(seedLoft());
    // the dining table's top, a bare stretch of the living room's floor, the north wall's top
    expect(clickDown(scene, 1.2, 2.6)).toEqual({ type: "item", id: "item_dining", levelId: GROUND_LEVEL_ID });
    expect(clickDown(scene, 3.6, 2.6)).toEqual({ type: "room", id: "room_living", levelId: GROUND_LEVEL_ID });
    expect(clickDown(scene, 6.5, 0)).toEqual({ type: "wall", id: "wall_n", levelId: GROUND_LEVEL_ID });
    // outside the plan there is only the ground, which is nothing to select
    expect(clickDown(scene, 20, 20)).toBeNull();
    scene.dispose();
  });

  it("outlines the store's selection in the accent over a paper casing, and the hidden stretch of it dashed", () => {
    const marks = new SceneMarks();
    const m = seedLoft();
    expect(marks.update(m, { type: "item", id: "item_sofa" }, [])).toBe(true);
    expect(marks.counts).toEqual({ selection: 1, pending: 0 });
    const outline = marks.root.children[0];
    const materials = [...materialsOf(outline)] as ScreenLineMaterial[];
    expect(materials.every((x) => x instanceof ScreenLineMaterial)).toBe(true);
    const hex = (x: ScreenLineMaterial) => `#${x.color.getHexString()}`;
    const [casing, line, hidden] = [
      materials.find((x) => hex(x) === SCENE_MARK.casing.hex)!,
      materials.find((x) => hex(x) === SCENE_MARK.selection.hex && x.depthTest)!,
      materials.find((x) => hex(x) === SCENE_MARK.selection.hex && !x.depthTest)!,
    ];
    // wider than a GPU line, over a wider casing in the paper, and drawn after it
    expect(line.linewidth).toBe(MARKS.width);
    expect(line.linewidth).toBeGreaterThan(1);
    expect(casing.linewidth).toBe(MARKS.casing);
    expect(casing.linewidth).toBeGreaterThan(line.linewidth);
    // the stretch something hides: dashed, fainter, drawn through what hides it
    expect(hidden.dashed).toBe(true);
    expect(hidden.opacity).toBe(MARKS.hiddenOpacity);
    expect(materials.every((x) => !x.toneMapped)).toBe(true);
    // where the piece stands and how it is turned: the item's own frame
    const sofa = m.items.find((i) => i.id === "item_sofa")!;
    expect(outline.position.x).toBeCloseTo(sofa.x);
    expect(outline.position.z).toBeCloseTo(sofa.y);
    expect(outline.rotation.y).toBeCloseTo(Math.PI);
    // the same selection again draws nothing new; clearing it takes the outline away
    expect(marks.update(m, { type: "item", id: "item_sofa" }, [])).toBe(false);
    expect(marks.update(m, null, [])).toBe(true);
    expect(marks.counts).toEqual({ selection: 0, pending: 0 });
    marks.dispose();
  });

  it("draws an outline's segments as quads of a set width on screen, in the token's exact colour", () => {
    const material = new ScreenLineMaterial({ color: SCENE_MARK.selection.hex, linewidth: MARKS.width, dashed: true, dashSize: MARKS.dash, gapSize: MARKS.gap });
    const set = screenLines([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0], material);
    const geometry = set.geometry as THREE.InstancedBufferGeometry;
    // one instance a segment, each knowing its length (the dashes run along it in metres)
    expect(geometry.instanceCount).toBe(2);
    expect(Array.from((geometry.getAttribute("instanceLength") as THREE.BufferAttribute).array)).toEqual([1, 2]);
    expect(set.frustumCulled).toBe(false);
    expect(set.raycast).not.toBe(THREE.Mesh.prototype.raycast);
    // not tone-mapped, not fogged: the mark is the token on screen
    expect(material.toneMapped).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.dashed).toBe(true);
    expect(material.fragmentShader).toContain("colorspace_fragment");
    expect(new ScreenLineMaterial({ color: "#000000", linewidth: 1 }).dashed).toBe(false);
    geometry.dispose();
  });

  it("follows a selected piece that moves", () => {
    const marks = new SceneMarks();
    const m = seedLoft();
    marks.update(m, { type: "item", id: "item_plant" }, []);
    const moved = { ...m, items: m.items.map((i) => (i.id === "item_plant" ? { ...i, x: 7 } : i)) };
    expect(marks.update(moved, { type: "item", id: "item_plant" }, [])).toBe(true);
    expect(marks.root.children[0].position.x).toBeCloseTo(7);
    marks.dispose();
  });

  it("boxes each kind of target as the model holds it", () => {
    const m = seedLoft();
    const wall = markBox("wall", "wall_n", m)!;
    expect(wall).toMatchObject({ cx: 4, cz: 0, w: 8, d: 0.15, y0: 0, y1: 2.7 });
    const window = markBox("window", "win_living", m)!;
    expect(window.w).toBeCloseTo(1.5);
    expect(window.y0).toBeCloseTo(0.9);
    expect(window.y1).toBeCloseTo(2.1);
    const room = markBox("room", "room_bed", m)!;
    expect(room).toMatchObject({ w: 2.85, d: 3.25, y0: FLOOR_TOP, y1: FLOOR_TOP });
    // a piece's box reaches over its height by its fittings' rise (the bed's headboard)
    const item = markBox("item", "item_bed", m)!;
    expect(item.y1 - item.y0).toBeCloseTo(kind("bed_double").h + riseOf(kind("bed_double")));
    expect(riseOf(kind("bed_double"))).toBeGreaterThan(0);
    expect(markBox("plan", "plan", m)).toMatchObject({ w: 8, d: 6, y1: 2.7 });
    expect(markBox("item", "nope", m)).toBeNull();
  });
});

// ---------------------------------------------------------------------------- pending removal

describe("a pending removal in 3D", () => {
  beforeEach(resetStore);

  it("hatches and outlines the target in the plan's error colours, and clears when answered", async () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    const marks = new SceneMarks();
    const targets = () => store.getState().approvals.flatMap((a) => a.targets);
    const answer = runToolManually("remove_room", { id: "room_bed" });
    await Promise.resolve();
    expect(store.getState().approvals).toHaveLength(1);
    const lid = 2.7;
    marks.update(store.getState().model, null, targets(), lid);
    expect(marks.counts.pending).toBe(1);
    const mark = marks.root.children[0];
    const mats = [...materialsOf(mark)];
    const fills = mats.filter((x): x is THREE.MeshBasicMaterial => x instanceof THREE.MeshBasicMaterial);
    const hatches = fills.filter((x) => x.alphaMap instanceof THREE.DataTexture);
    expect(hatches.length).toBeGreaterThan(0);
    for (const h of hatches) expect(`#${h.color.getHexString()}`).toBe(SCENE_MARK.destructiveInk.hex);
    const lines = mats.filter((x): x is ScreenLineMaterial => x instanceof ScreenLineMaterial);
    expect(lines.some((x) => `#${x.color.getHexString()}` === SCENE_MARK.destructive.hex)).toBe(true);
    // a room is marked over its walls too — a wash, the hatch and the outline at the lid, over
    // everything — and nothing of its outline is projected through its walls onto the next room
    const meshes: THREE.Mesh[] = [];
    mark.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    const atLid = meshes.filter((o) => {
      const geometry = o.geometry as THREE.BufferGeometry;
      geometry.computeBoundingBox();
      const y = (geometry.boundingBox!.min.y + geometry.boundingBox!.max.y) / 2;
      return Number.isFinite(y) && Math.abs(y - lid - MARKS.lift) < 1e-6;
    });
    expect(atLid.length).toBeGreaterThanOrEqual(2);
    for (const o of atLid) expect((o.material as THREE.Material).depthTest).toBe(false);
    expect(fills.some((x) => `#${x.color.getHexString()}` === SCENE_MARK.destructive.hex && x.opacity === MARKS.lidFill && !x.depthTest)).toBe(true);
    expect(lines.filter((x) => x.dashed)).toHaveLength(0);
    // the cut moves the lid down to it
    expect(marks.update(store.getState().model, null, targets(), 1.2)).toBe(true);

    // kept: the request goes, and the hatch with it
    pageActions.resolveApproval(store.getState().approvals[0].id, false);
    await answer;
    marks.update(store.getState().model, null, targets());
    expect(marks.counts.pending).toBe(0);
    expect(marks.root.children).toHaveLength(0);
    marks.dispose();
  });

  it("is the plan's own red: the same tokens PlanMarks and the editor draw with", () => {
    expect(SCENE_MARK.destructive.css).toBe("oklch(51% 0.175 27)");
    expect(SCENE_MARK.destructiveHatch.css).toBe("oklch(80% 0.07 27)");
  });

  it("stands 3:1 off what it is drawn over: the hatch against every floor, every outline against its casing", () => {
    // the hatch is the error colour deepened for the model's finishes, not the sheet's light pink
    expect(hatch().seen.color.getHexString()).toBe(SCENE_MARK.destructiveInk.hex.slice(1));
    for (const [finish, swatch] of Object.entries(MATERIAL.floor)) {
      expect(contrast(SCENE_MARK.destructiveInk.hex, swatch.hex), finish).toBeGreaterThanOrEqual(3);
    }
    // the sheet's hatch would not: that is why the model does not use it
    expect(contrast(SCENE_MARK.destructiveHatch.hex, MATERIAL.floor.oak.hex)).toBeLessThan(3);
    // an outline lies on a paper casing, whatever the floor under it
    for (const mark of [SCENE_MARK.selection, SCENE_MARK.destructive]) expect(contrast(mark.hex, SCENE_MARK.casing.hex)).toBeGreaterThanOrEqual(3);
    expect(MARKS.hatchOpacity).toBe(1);
  });

  it("draws the hatch at one size on every face, whatever the target's size", () => {
    const small = hatchGeometry({ cx: 0, cz: 0, w: 0.5, d: 0.5, y0: 0, y1: 0.5, ry: 0 }, 0);
    const big = hatchGeometry({ cx: 0, cz: 0, w: 4, d: 0.5, y0: 0, y1: 0.5, ry: 0 }, 0);
    const span = (g: THREE.BufferGeometry, face: number) => {
      const uv = g.getAttribute("uv");
      const us = [0, 1, 2, 3].map((k) => uv.getX(face * 4 + k));
      return Math.max(...us) - Math.min(...us);
    };
    // the +z face is w wide: eight times as wide, eight times as many periods
    expect(span(big, 4) / span(small, 4)).toBeCloseTo(8);
    expect(span(small, 4)).toBeCloseTo(0.5 / MARKS.hatchPeriod);
    // and the texture is diagonal lines on a clear ground, seamless across its edge
    const img = hatchImage(8);
    const on = (x: number, y: number) => img[(y * 8 + x) * 4] > 0;
    expect(on(0, 0)).toBe(on(1, 7));
    expect([...Array(8).keys()].some((x) => on(x, 0)) && [...Array(8).keys()].some((x) => !on(x, 0))).toBe(true);
  });
});

// ---------------------------------------------------------------------------- cutaway

describe("the cutaway", () => {
  it("slices every wall material at the height asked, and nothing while off", () => {
    expect(cutLevel()).toBeNull();
    const above = new THREE.Vector3(1, 2, 1);
    expect(CUT_PLANE.distanceToPoint(above)).toBeGreaterThan(0); // kept
    expect(setCut(1.2)).toBe(true);
    expect(cutLevel()).toBeCloseTo(FLOOR_TOP + 1.2);
    expect(CUT_PLANE.distanceToPoint(above)).toBeLessThan(0); // clipped: above the cut
    expect(CUT_PLANE.distanceToPoint(new THREE.Vector3(1, 1, 1))).toBeGreaterThan(0); // below it, kept
    expect(setCut(1.2)).toBe(false);
    setCut(null);
    expect(CUT_PLANE.constant).toBe(CUTAWAY.off);
  });

  it("clips the walls and their openings, shadows included, and leaves the furniture whole", () => {
    const m = seedLoft();
    const byWall = openingsByWall(m);
    const w = m.walls[2];
    const wall = buildWall(w, byWall.get(w.id) ?? [], jointExtensions(w, m.walls), curtainedWindows(m, byWall));
    // no cut, no plane in the shaders: the walls draw with the programs the furniture does
    for (const mat of materialsOf(wall)) expect(mat.clippingPlanes ?? [], mat.name).toHaveLength(0);
    setCut(1.2);
    for (const mat of materialsOf(wall)) {
      expect(mat.clippingPlanes, mat.name).toContain(CUT_PLANE);
      expect(mat.clipShadows).toBe(true);
    }
    // the walls' materials are their own: a piece in the same finish is never sliced with them
    for (const mat of [wallMaterial, frameMaterial, doorLeafMaterial, glassMaterial]) expect(mat.clippingPlanes).toContain(CUT_PLANE);
    // and the plane leaves them with the cut
    setCut(null);
    for (const mat of [wallMaterial, frameMaterial, doorLeafMaterial, glassMaterial]) expect(mat.clippingPlanes ?? []).toHaveLength(0);
    setCut(1.2);
    for (const k of BUILT_IN_KINDS) {
      for (const mat of materialsOf(buildFurniture(k))) expect(mat.clippingPlanes ?? [], `${k.kind}: ${mat.name}`).not.toContain(CUT_PLANE);
    }
  });

  /** The stretches of a wall's length a cap covers, in its own frame, merged and sorted. */
  const covered = (cap: THREE.Mesh) => {
    const p = cap.geometry.getAttribute("position");
    const spans: [number, number][] = [];
    for (let i = 0; i < p.count; i += 6) {
      const xs = [0, 1, 2, 3, 4, 5].map((k) => p.getX(i + k));
      spans.push([Math.min(...xs), Math.max(...xs)]);
    }
    return spans.sort((x, y) => x[0] - y[0]);
  };
  const capOf = (id: string, level: number) => {
    const m = seedLoft();
    const byWall = openingsByWall(m);
    const w = m.walls.find((x) => x.id === id)!;
    return wallCutCap(w, byWall.get(w.id) ?? [], jointExtensions(w, m.walls), level);
  };

  it("closes a cut wall in the plan's poché, open across a doorway or a window the cut passes through", () => {
    // the north wall's living-room window runs from 0.9 to 2.1 m
    const through = capOf("wall_n", 1.2)!;
    expect(through.name).toBe(CUT_CAP);
    expect(through.material).toBe(POCHE);
    expect(`#${(POCHE.color as THREE.Color).getHexString()}`).toBe(SCENE_MARK.poche.hex);
    expect(POCHE.toneMapped).toBe(false);
    // flat, facing up, at the cut
    const p = through.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(1.2, 6);
    const n = through.geometry.getAttribute("normal");
    for (let i = 0; i < n.count; i++) expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 1, 0]);
    // masonry either side of the window and its two jambs: a gap where the glass is
    const spans = covered(through);
    const gaps = spans.slice(1).map((s, i) => s[0] - spans[i][1]).filter((g) => g > 0.01);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeCloseTo(1.5 - 2 * 0.05, 2);
    // under the sill, the wall is solid all along
    const below = covered(capOf("wall_n", 0.5)!);
    expect(below.slice(1).every((s, i) => s[0] <= below[i][1] + 1e-6)).toBe(true);
    // over the wall, nothing to close
    expect(capOf("wall_n", 3)).toBeNull();
  });

  it("caps every wall when the cut is on, follows it, and takes the caps away when it is off", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    const caps = () => scene.walls.map((w) => w.getObjectByName(CUT_CAP) as THREE.Mesh | undefined);
    const at = (level: number) => caps().every((c) => c !== undefined && Math.abs(c.geometry.getAttribute("position").getY(0) - level) < 1e-6);
    expect(caps().every((c) => c === undefined)).toBe(true);
    expect(scene.setCut(1.24)).toBe(true);
    expect(at(1.24)).toBe(true);
    scene.setCut(0.64);
    expect(at(0.64)).toBe(true);
    // a wall rebuilt while cut is capped too
    scene.update({ ...m, walls: m.walls.map((w) => (w.id === "wall_n" ? { ...w, height: 2.9 } : w)) });
    expect(caps().every((c) => c !== undefined)).toBe(true);
    // a click on a cap selects its wall
    const cap = caps()[0]!;
    expect(scene.entityOf(cap)?.type).toBe("wall");
    scene.setCut(null);
    expect(caps().every((c) => c === undefined)).toBe(true);
    scene.dispose();
  });

  it("shows the pendants' fixtures only from inside, never while cut, and always keeps their light", () => {
    const scene = new PlanScene();
    scene.update(seedLoft());
    const pendants = scene.objects.filter((o) => o.userData.entity.startsWith("pendant:"));
    expect(pendants.length).toBeGreaterThan(0);
    const shown = () => pendants.flatMap((p) => p.children.filter((c) => !(c as THREE.Light).isLight && c.visible));
    const lights = () => pendants.flatMap((p) => p.children.filter((c) => (c as THREE.Light).isLight && c.visible));
    const lit = lights().length;
    expect(lit).toBe(pendants.length);
    // from outside (orbit, top) a cord hanging from no ceiling is not drawn
    expect(shown()).toHaveLength(0);
    expect(scene.setFixtures(true)).toBe(true);
    expect(shown().length).toBeGreaterThan(0);
    expect(scene.setCut(1.24)).toBe(true);
    expect(shown()).toHaveLength(0);
    expect(lights()).toHaveLength(lit);
    scene.setCut(null);
    expect(shown().length).toBeGreaterThan(0);
    scene.setFixtures(false);
    expect(shown()).toHaveLength(0);
    expect(lights()).toHaveLength(lit);
    scene.dispose();
  });

  it("puts a cut wall's curtains away, with their ink, and brings them back with the wall", () => {
    const scene = new PlanScene();
    scene.setEdges(true);
    scene.update(seedLoft());
    const curtains = scene.walls.flatMap((w) => {
      const c = w.getObjectByName("curtains");
      return c ? [c] : [];
    });
    expect(curtains.length).toBeGreaterThan(0);
    // their lines hang in their own group, so they go with it
    for (const c of curtains) expect(lines(c).length).toBeGreaterThan(0);
    expect(curtains.every((c) => c.visible)).toBe(true);
    scene.setCut(1.24);
    expect(curtains.every((c) => !c.visible)).toBe(true);
    scene.setCut(null);
    expect(curtains.every((c) => c.visible)).toBe(true);
    scene.dispose();
  });
});

// ---------------------------------------------------------------------------- ink edges

describe("ink edges", () => {
  /** A line set's segments, each as a sorted pair of welded end points, as a set. */
  const segments = (positions: ArrayLike<number>) => {
    const key = (i: number) => [0, 1, 2].map((k) => Math.round(positions[i + k] * 1e4)).join(",");
    const out = new Set<string>();
    for (let i = 0; i + 5 < positions.length; i += 6) out.add([key(i), key(i + 3)].sort().join("|"));
    return out;
  };

  it("finds the very creases three.js's EdgesGeometry does, for every built-in piece", () => {
    for (const def of BUILT_IN_KINDS) {
      const piece = buildFurniture(def);
      piece.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const reference = new THREE.EdgesGeometry(mesh.geometry, EDGES.crease);
        expect(segments(findCreases(mesh.geometry)), def.kind).toEqual(segments(reference.getAttribute("position").array));
        reference.dispose();
      });
      disposeObject(piece);
    }
    // and for the walls, the floors and a pendant
    const scene = new PlanScene();
    scene.update(seedLoft());
    for (const o of scene.objects) {
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const reference = new THREE.EdgesGeometry(mesh.geometry, EDGES.crease);
        expect(segments(findCreases(mesh.geometry))).toEqual(segments(reference.getAttribute("position").array));
        reference.dispose();
      });
    }
    scene.dispose();
  });

  it("are drawn a hair nearer than their edge, so a face never breaks them, and the faces keep their depth", () => {
    for (const ink of [INK, INK_CLIPPED, INK_STAIR]) {
      const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: "", uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      ink.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
      // pulled along the line of sight: the same place on screen, a little nearer
      expect(shader.vertexShader).toContain(`mvPosition.xyz * ${(1 - EDGES.depthPull).toFixed(8)}`);
      expect(ink.customProgramCacheKey()).not.toBe(new THREE.LineBasicMaterial().customProgramCacheKey());
    }
    // no surface is pushed back for the ink's sake: what stands behind a face stays behind it
    const m = seedLoft();
    const byWall = openingsByWall(m);
    const w = m.walls[2];
    const wall = buildWall(w, byWall.get(w.id) ?? [], jointExtensions(w, m.walls), curtainedWindows(m, byWall));
    for (const piece of [wall, buildFurniture(kind("sofa"))]) {
      piece.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const [face] = Array.isArray(mesh.material) ? mesh.material.slice(1) : [mesh.material];
        if (face.name.startsWith("surface:")) expect(face.polygonOffset, face.name).toBe(false);
      });
    }
    // but a wall box's ends are: where a lintel overlaps the stretch beside it, an end never shows through
    const boxes: THREE.Mesh[] = [];
    wall.traverse((o) => Array.isArray((o as THREE.Mesh).material) && boxes.push(o as THREE.Mesh));
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      // two runs, two draws: the box's ends (+x, -x), then its four other faces
      expect(b.material).toHaveLength(2);
      expect(b.geometry.groups.map((gr) => [gr.start, gr.count, gr.materialIndex])).toEqual([
        [0, 12, 0],
        [12, 24, 1],
      ]);
      const [end, face] = b.material as THREE.Material[];
      expect(end.polygonOffset && end.polygonOffsetFactor > 0 && end.polygonOffsetUnits > 0).toBe(true);
      expect(face.polygonOffset).toBe(false);
      expect(end.clippingPlanes === face.clippingPlanes || (end.clippingPlanes ?? []).length === (face.clippingPlanes ?? []).length).toBe(true);
    }
  });

  it("line any piece, whatever built it, in one line set per rigid part, unpickable", () => {
    const sofa = buildFurniture(kind("sofa"));
    expect(addInkEdges(sofa)).toBe(1);
    const [set] = lines(sofa);
    expect(set.material).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(`#${(set.material as THREE.LineBasicMaterial).color.getHexString()}`).toBe(SCENE_MARK.ink.hex);
    expect(set.geometry.getAttribute("position").count).toBeGreaterThan(24);
    const hits: THREE.Intersection[] = [];
    set.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    // a piece that has them keeps them: asking again adds nothing
    expect(addInkEdges(sofa)).toBe(0);
    expect(removeInkEdges(sofa)).toBe(1);
    expect(lines(sofa)).toHaveLength(0);
  });

  it("swing with a door's leaf: what hangs from a hinge is lined under the hinge", () => {
    const m = seedLoft();
    const byWall = openingsByWall(m);
    const w = m.walls.find((x) => x.id === "wall_bed_w")!;
    const wall = buildWall(w, byWall.get(w.id) ?? [], jointExtensions(w, m.walls), curtainedWindows(m, byWall));
    addInkEdges(wall, true);
    const sets = lines(wall);
    const hinges = sets.filter((s) => s.parent?.userData.doorHinge);
    expect(hinges).toHaveLength(1);
    expect(sets).toHaveLength(2);
    // the wall's ink stops at the cut with the wall
    setCut(1.2);
    for (const s of sets) expect((s.material as THREE.Material).clippingPlanes).toContain(CUT_PLANE);
  });

  it("are put on every entity of the scene, and on what is built afterwards, and come off", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    expect(scene.setEdges(true)).toBe(true);
    // every wall, floor and pendant, and the pieces (one built here, a sofa)
    for (const o of scene.objects) {
      const key = o.userData.entity as string;
      if (!key.startsWith("item:") || key === "item:item_sofa") expect(lines(o).length, key).toBeGreaterThan(0);
    }
    scene.update({ ...m, items: [...m.items, { id: "late", levelId: "level_ground", kind: "armchair", x: 3, y: 3, rotation: 0 }] });
    const late = scene.objects.find((o) => o.userData.entity === "item:late")!;
    expect(lines(late)).toHaveLength(1);
    // furniture ink is never sliced by the cut
    setCut(1.2);
    expect((lines(late)[0].material as THREE.Material).clippingPlanes ?? []).not.toContain(CUT_PLANE);
    scene.setEdges(false);
    for (const o of scene.objects) expect(lines(o)).toHaveLength(0);
    scene.dispose();
  });
});

// ---------------------------------------------------------------------------- room names

describe("room names over the model", () => {
  const room = { id: "r", levelId: "level_ground", x: 0, y: 0, w: 4, h: 4, label: "Studio", floor: "oak" as const };
  const camera = (x: number, y: number, z: number) => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(x, y, z);
    cam.lookAt(2, 0, 2);
    cam.updateMatrixWorld();
    return cam;
  };
  const ray = new THREE.Raycaster();

  it("sits on the room's floor, clear of the pendant at its centre, where the camera sees it", () => {
    const cam = camera(2, 8, 2.01);
    const spot = placeLabel(room, cam, 800, 800, 60, ray, [], null);
    expect(spot.visible).toBe(true);
    const at = labelAnchor(room);
    // along the room's longer side, by the clearance, inside the room
    expect(Math.hypot(at.x - 2, at.z - 2)).toBeCloseTo(LABELS.pendantClear);
    const p = new THREE.Vector3(at.x, FLOOR_TOP + LABELS.lift, at.z).project(cam);
    expect(spot.x).toBeCloseTo(((p.x + 1) / 2) * 800, 0);
    expect(spot.y).toBeCloseTo(((1 - p.y) / 2) * 800, 0);
    // a small room keeps its name inside it
    const closet = { ...room, w: 0.8, h: 0.6 };
    expect(labelAnchor(closet).x - 0.4).toBeLessThanOrEqual(0.4 * LABELS.maxShift + 1e-9);
  });

  it("hides a name that would hang over the edge of the view", () => {
    const cam = camera(2, 8, 2.01);
    const spot = placeLabel(room, cam, 800, 800, 60, ray, [], null);
    expect(spot.visible).toBe(true);
    // the same name, too wide to fit beside its anchor inside the canvas, is not cut off: it hides
    const half = Math.min(spot.x, 800 - spot.x);
    expect(placeLabel(room, cam, 800, 800, 2 * half + 2, ray, [], null).visible).toBe(false);
    expect(placeLabel(room, cam, 800, 800, 60, ray, [], null, FLOOR_TOP + LABELS.lift, 2 * Math.min(spot.y, 800 - spot.y) + 2).visible).toBe(false);
  });

  it("hides behind a wall, unless the cut has taken that wall away", () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 0.2));
    wall.position.set(2, 1.5, 6);
    wall.updateMatrixWorld();
    const low = camera(2, 1.5, 9);
    expect(placeLabel(room, low, 800, 800, 60, ray, [wall], null).visible).toBe(false);
    // seen from above the cut, over a wall cut at 1 m
    const high = camera(2, 2.6, 8);
    expect(placeLabel(room, high, 800, 800, 60, ray, [wall], null).visible).toBe(false);
    expect(placeLabel(room, high, 800, 800, 60, ray, [wall], 1).visible).toBe(true);
  });

  it("can stand over the room at the top of its walls, where the walls hide its floor", () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 2.7, 0.2));
    wall.position.set(2, 1.35, 5);
    wall.updateMatrixWorld();
    const orbit = camera(2, 6, 12);
    expect(placeLabel(room, orbit, 800, 800, 60, ray, [wall], null).visible).toBe(false);
    expect(placeLabel(room, orbit, 800, 800, 60, ray, [wall], null, 2.75).visible).toBe(true);
  });

  it("hides when the room shows smaller than its name, and when it is behind the camera", () => {
    expect(placeLabel(room, camera(2, 30, 2.01), 800, 800, 300, ray, [], null).visible).toBe(false);
    const away = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    away.position.set(2, 1.6, 10);
    away.lookAt(2, 1.6, 20);
    away.updateMatrixWorld();
    expect(placeLabel(room, away, 800, 800, 60, ray, [], null).visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------- camera moves

describe("camera moves between modes", () => {
  const from = () => {
    const p = newPose();
    p.position.set(10, 8, 10);
    p.target.set(0, 0.8, 0);
    return p;
  };
  const to = () => {
    const p = newPose();
    p.position.set(0, 12, 0.01);
    p.target.set(0, 0, 0);
    p.up.set(0, 0, -1);
    return p;
  };

  it("eases from one pose to the other over the configured time, and settles there", () => {
    const move = new CameraMove();
    const out = newPose();
    expect(move.start(from(), to(), moveSeconds(false))).toBe(true);
    expect(moveSeconds(false)).toBe(TRANSITIONS.seconds);
    let steps = 0;
    let last = Infinity;
    while (move.step(1 / 60, out)) {
      const left = out.position.distanceTo(to().position);
      expect(left).toBeLessThanOrEqual(last + 1e-9);
      last = left;
      expect(out.up.length()).toBeCloseTo(1);
      steps++;
    }
    expect(steps).toBeGreaterThan(30);
    expect(out.position.distanceTo(to().position)).toBeLessThan(1e-9);
    expect(out.up.distanceTo(to().up)).toBeLessThan(1e-9);
    expect(move.active).toBe(false);
  });

  it("is half-way through its ease at half time, slow at both ends", () => {
    const ease = EASINGS[TRANSITIONS.easing];
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.1)).toBeLessThan(0.1);
  });

  it("finishes at once when the person does anything", () => {
    const move = new CameraMove();
    const out = newPose();
    move.start(from(), to(), moveSeconds(false));
    move.step(0.05, out);
    expect(move.active).toBe(true);
    move.finish(out);
    expect(move.active).toBe(false);
    expect(out.position.distanceTo(to().position)).toBe(0);
  });

  it("takes no time at all under prefers-reduced-motion", () => {
    const move = new CameraMove();
    expect(moveSeconds(true)).toBe(0);
    expect(move.start(from(), to(), moveSeconds(true))).toBe(false);
    const out = newPose();
    expect(move.step(0, out)).toBe(false);
    expect(out.position.distanceTo(to().position)).toBe(0);
  });

  it("does not move a camera that is already there", () => {
    expect(new CameraMove().start(to(), to(), TRANSITIONS.seconds)).toBe(false);
  });

  /** Every stretch of a move's path, frame by frame: does any pass through a wall of the scene? */
  function throughWalls(start: ReturnType<typeof newPose>, end: ReturnType<typeof newPose>, walls: number, scene: PlanScene): boolean {
    const move = new CameraMove();
    move.start(start, end, TRANSITIONS.seconds, walls);
    const out = newPose();
    const before = start.position.clone();
    const ray = new THREE.Raycaster();
    let hit = false;
    while (move.step(1 / 240, out)) {
      const step = out.position.clone().sub(before);
      if (step.length() > 0) {
        ray.set(before, step.clone().normalize());
        ray.far = step.length();
        if (ray.intersectObjects(scene.walls, true).length > 0) hit = true;
      }
      before.copy(out.position);
    }
    return hit;
  }

  it("arcs over the walls into Walk, and out of it, instead of passing through them", () => {
    const scene = new PlanScene();
    const m = seedLoft();
    scene.update(m);
    scene.root.updateMatrixWorld(true);
    const top = Math.max(...m.walls.map((w) => w.height));
    // the default orbit over the loft, and the walker inside the largest room facing into it
    const orbit = newPose();
    orbit.position.set(11.34, 6.93, 11.97);
    orbit.target.set(4, 0.8, 3);
    const spot = walkEntry(m, blockersFor(m), () => 0)!;
    const walk = newPose();
    walk.position.set(spot.x, 1.6, spot.z);
    walk.target.set(spot.x + spot.dirX * WALK.lookAhead, 1.5, spot.z + spot.dirZ * WALK.lookAhead);
    // a straight line from there to the walker's eye goes through the south wall
    expect(throughWalls(orbit, walk, 0, scene)).toBe(true);
    // the arc clears it, going in and coming out, and from a low orbit behind another wall too
    expect(throughWalls(orbit, walk, top, scene)).toBe(false);
    expect(throughWalls(walk, orbit, top, scene)).toBe(false);
    const low = newPose();
    low.position.set(4, 1.2, -6);
    low.target.set(4, 0.8, 3);
    expect(throughWalls(low, walk, top, scene)).toBe(false);
    scene.dispose();
  });

  it("turns the view as one rotation, never swinging back, and arrives exactly", () => {
    const move = new CameraMove();
    const out = newPose();
    const start = from();
    const end = to();
    move.start(start, end, TRANSITIONS.seconds, 2.7);
    const final = end.target.clone().sub(end.position).normalize();
    let last = Infinity;
    while (move.step(1 / 60, out)) {
      const angle = out.target.clone().sub(out.position).normalize().angleTo(final);
      expect(angle).toBeLessThanOrEqual(last + 1e-6);
      last = angle;
      expect(out.up.length()).toBeCloseTo(1);
    }
    expect(out.position.distanceTo(end.position)).toBe(0);
    expect(out.target.distanceTo(end.target)).toBe(0);
    expect(out.up.distanceTo(end.up)).toBe(0);
  });
});

describe("framing a narrow view", () => {
  it("keeps the radius in a landscape view, and stands back in proportion in a portrait one", () => {
    expect(framedRadius(5, 16 / 9)).toBe(5);
    expect(framedRadius(5, CAMERA_FRAMING.fitAspect)).toBe(5);
    // a view with no size yet (0/0, x/0) keeps the radius rather than framing from nowhere
    expect(framedRadius(5, Number.NaN)).toBe(5);
    expect(framedRadius(5, 0)).toBe(5);
    const phone = 390 / 700;
    expect(framedRadius(5, phone)).toBeCloseTo((5 * CAMERA_FRAMING.fitAspect) / phone, 9);
  });

  it("fits the plan's width in a phone held upright as it fits in the narrowest view framed as is", () => {
    // the half-width a camera at distance d sees: d * tan(hfov/2), with tan(hfov/2) = aspect * tan(vfov/2)
    const halfWidth = (radius: number, aspect: number) =>
      framedRadius(radius, aspect) * aspect * Math.tan(THREE.MathUtils.degToRad(CAMERA.fov) / 2);
    const wide = halfWidth(6, CAMERA_FRAMING.fitAspect);
    for (const aspect of [390 / 844, 390 / 700, 0.75, 1]) expect(halfWidth(6, aspect)).toBeCloseTo(wide, 9);
  });
});

describe("where Walk sets the walker down", () => {
  it("inside the largest room, on a free spot, facing into the room", () => {
    const m = seedLoft();
    const b = blockersFor(m);
    const shut = () => 0;
    const spot = walkEntry(m, b, shut)!;
    const living = m.rooms.find((r) => r.id === "room_living")!;
    expect(spot.x).toBeGreaterThan(living.x + WALK.personRadius);
    expect(spot.x).toBeLessThan(living.x + living.w - WALK.personRadius);
    expect(spot.z).toBeGreaterThan(living.y + living.h / 2); // toward its south end
    expect(spot.z).toBeLessThan(living.y + living.h);
    expect(blocked(b, spot.x, spot.z, shut)).toBe(false);
    // facing through the room's centre
    expect(spot.dirZ).toBe(-1);
    expect(spot.dirX).toBe(0);
  });

  it("steps aside when a piece stands on the first spot", () => {
    const base = { ...seedLoft(), items: [] };
    const first = walkEntry(base, blockersFor(base), () => 0)!;
    const crowded = { ...base, items: [{ id: "x", levelId: "level_ground", kind: "armchair", x: first.x, y: first.z, rotation: 0 }] };
    const b = blockersFor(crowded);
    const spot = walkEntry(crowded, b, () => 0)!;
    expect(spot).not.toEqual(first);
    expect(blocked(b, spot.x, spot.z, () => 0)).toBe(false);
  });

  it("prefers a spot clear of the pendant over the room's centre", () => {
    const m = seedLoft();
    const spot = walkEntry(m, blockersFor(m), () => 0)!;
    const room = m.rooms.reduce((a, r) => (r.w * r.h > a.w * a.h ? r : a));
    expect(Math.hypot(spot.x - (room.x + room.w / 2), spot.z - (room.y + room.h / 2))).toBeGreaterThanOrEqual(WALK_ENTRY.pendantClear - 1e-9);
  });

  it("has nowhere to go in a plan without rooms", () => {
    const m = { ...seedLoft(), rooms: [] };
    expect(walkEntry(m, blockersFor(m), () => 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------- the style as a setting

describe("the 3D style", () => {
  beforeEach(resetStore);

  it("starts drawn in the plan's ink, uncut, with a cut height inside the range ready", () => {
    expect(store.getState().editor.scene).toEqual(SCENE_STYLE_DEFAULTS);
    expect(SCENE_STYLE_DEFAULTS).toMatchObject({ edges: true, cutaway: false });
    expect(SCENE_STYLE_DEFAULTS.cutHeight).toBeGreaterThanOrEqual(CUT_HEIGHT.min);
    expect(SCENE_STYLE_DEFAULTS.cutHeight).toBeLessThanOrEqual(CUT_HEIGHT.max);
  });

  it("is a view setting: changing it keeps the plan and the undo history as they are", () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    const { model, undoStack } = store.getState();
    expect(actions.setSceneStyle({ edges: true, cutaway: true, cutHeight: 1.6 }).ok).toBe(true);
    expect(store.getState().editor.scene).toEqual({ edges: true, cutaway: true, cutHeight: 1.6 });
    expect(store.getState().model).toBe(model);
    expect(store.getState().undoStack).toBe(undoStack);
    // what is left out stays
    actions.setSceneStyle({ edges: false });
    expect(store.getState().editor.scene).toEqual({ edges: false, cutaway: true, cutHeight: 1.6 });
  });

  it("refuses a cut outside the range, from anyone", () => {
    const r = actions.setSceneStyle({ cutHeight: CUT_HEIGHT.max + 1 });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("cutHeight");
    expect(actions.setSceneStyle({ edges: "yes" as unknown as boolean }).ok).toBe(false);
    expect(store.getState().editor.scene).toEqual(SCENE_STYLE_DEFAULTS);
  });

  it("is what set_3d_style sets, through a closed schema built from the limits", async () => {
    const tool = TOOLS.find((t) => t.name === "set_3d_style")!;
    const schema = inputSchemaOf(tool) as { properties: Record<string, { type: string; minimum?: number; maximum?: number }>; required?: string[]; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties.edges.type).toBe("boolean");
    expect(schema.properties.cutaway.type).toBe("boolean");
    expect(schema.properties.cutHeight).toMatchObject({ type: "number", minimum: CUT_HEIGHT.min, maximum: CUT_HEIGHT.max });

    const ok = JSON.parse(JSON.stringify(await runToolManually("set_3d_style", { cutaway: true, cutHeight: 1.4 })));
    expect(ok.ok).toBe(true);
    expect(store.getState().editor.scene).toMatchObject({ cutaway: true, cutHeight: 1.4 });
    expect(store.getState().editor.view).toBe("3d");

    const bad = await runToolManually("set_3d_style", { cutHeight: 99 });
    expect(bad.ok).toBe(false);
    const unknown = await runToolManually("set_3d_style", { ceiling: false });
    expect(unknown.ok).toBe(false);
    expect(store.getState().editor.scene.cutHeight).toBe(1.4);
  });
});
