/**
 * The 3D view's shared surfaces (src/three/surfaces.ts): each procedural pattern is made once
 * and shared by every material that samples it, static, freed only all together; its scale is
 * metres of surface, the floors' the plan's own; and an agent's parts get the same surfaces as
 * the built-in pieces. No WebGL is involved: the textures are DataTextures computed in script.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CONTACT_SHADOW,
  PART_SURFACE,
  PATTERN_NAMES,
  SURFACE_NAMES,
  contactShadow,
  disposePatternTextures,
  partSurface,
  patternImage,
  patternMetres,
  patternTexture,
  patternTextureCount,
  projectSurfaceUVs,
  staticSurface,
  surface,
} from "../src/three/surfaces";
import { MaterialCache, disposeObject, isStatic, materialsOf, texturesOf } from "../src/three/materials";
import { buildFloor } from "../src/three/build";
import { buildFurniture } from "../src/three/furniture";
import { PlanScene } from "../src/three/planScene";
import { CONTACT, PATTERNS, SURFACES } from "../src/three/config";
import { FLOOR_PATTERN } from "../src/editor/drawing";
import { MATERIAL, SURFACE_TINT } from "../src/ui/theme/sceneTokens";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { PART_MATERIALS } from "../src/model/limits";
import { emptyModel, type KindDef } from "../src/model/types";

const texel = (img: { width: number; data: Uint8Array }, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("pattern textures", () => {
  it("are made once and shared by every material that samples them", () => {
    disposePatternTextures();
    const a = surface("oak", "#806040");
    const b = surface("darkWood");
    const c = staticSurface("lightWood");
    expect(a.map).toBeInstanceOf(THREE.DataTexture);
    expect(b.map).toBe(a.map);
    expect(c.map).toBe(a.map);
    expect(patternTexture("grain")).toBe(a.map);
    expect(patternTextureCount()).toBe(1);
    // every pattern, at most one texture each, however many surfaces ask
    for (const name of SURFACE_NAMES) surface(name);
    expect(patternTextureCount()).toBeLessThanOrEqual(PATTERN_NAMES.length);
    for (const name of PATTERN_NAMES) expect(isStatic(patternTexture(name))).toBe(true);
  });

  it("are the same texels on every run", () => {
    // compared byte by byte here: a deep equality over a megabyte of texels is needlessly slow
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const name of PATTERN_NAMES) expect(same(patternImage(name).data, patternImage(name).data)).toBe(true);
  });

  it("are never disposed with an object, and all go together when asked", () => {
    const sofa = BUILT_IN_KINDS.find((k) => k.kind === "sofa")!;
    const piece = buildFurniture(sofa); // no cache: the piece owns its materials
    const textures = new Set<THREE.Texture>();
    for (const m of materialsOf(piece)) for (const t of texturesOf(m)) textures.add(t);
    expect(textures.size).toBeGreaterThan(0); // the upholstery's weave
    const disposed = new Set<THREE.Texture>();
    for (const t of textures) t.addEventListener("dispose", () => disposed.add(t));
    disposeObject(piece);
    expect(disposed.size).toBe(0);

    const before = patternTextureCount();
    expect(disposePatternTextures()).toBe(before);
    expect(disposed.size).toBe(textures.size);
    expect(patternTextureCount()).toBe(0);
    // asked again, a pattern is made afresh
    const fresh = patternTexture("weave");
    expect(textures.has(fresh)).toBe(false);
  });

  it("repeat, mipmap and are sampled at an angle; colour patterns are sRGB, shades linear", () => {
    const planks = patternTexture("planks");
    const weave = patternTexture("weave");
    for (const t of [planks, weave]) {
      expect(t.wrapS).toBe(THREE.RepeatWrapping);
      expect(t.wrapT).toBe(THREE.RepeatWrapping);
      expect(t.generateMipmaps).toBe(true);
      expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(t.anisotropy).toBeGreaterThan(1);
    }
    expect(planks.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(weave.colorSpace).toBe(THREE.NoColorSpace);
  });
});

describe("pattern scale", () => {
  it("the oak floor is one run of the plan's planks, its joints where the plan draws them", () => {
    const img = patternImage("planks");
    const rows = FLOOR_PATTERN.plankJoints.length;
    expect(img.metres).toEqual([FLOOR_PATTERN.plankRun, rows * FLOOR_PATTERN.plankWidth]);
    expect(img.width).toBe(Math.round(FLOOR_PATTERN.plankRun * PATTERNS.planks.pxPerMetre));
    const px = (m: number) => Math.floor(m * PATTERNS.planks.pxPerMetre);
    const seam = rgb(MATERIAL.oakSeam.hex);
    FLOOR_PATTERN.plankJoints.forEach((joint, row) => {
      const mid = px((row + 0.5) * FLOOR_PATTERN.plankWidth);
      expect(texel(img, px(joint), mid)).toEqual(seam);
      expect(texel(img, px(joint + FLOOR_PATTERN.plankRun / 2), mid)).not.toEqual(seam);
    });
    // and a seam between every two rows
    expect(texel(img, px(0.1), px(FLOOR_PATTERN.plankWidth))).toEqual(seam);
  });

  it("the tiled floor is the plan's tiles, grout on the lines the plan draws", () => {
    const img = patternImage("tiles");
    const side = FLOOR_PATTERN.tile;
    expect(img.metres).toEqual([PATTERNS.tiles.perSide * side, PATTERNS.tiles.perSide * side]);
    const px = (m: number) => Math.floor(m * PATTERNS.tiles.pxPerMetre);
    const grout = rgb(MATERIAL.tileGrout.hex);
    expect(texel(img, px(side), px(side / 2))).toEqual(grout);
    expect(texel(img, px(side / 2), px(side / 2))).not.toEqual(grout);
  });

  it("a floor's texture coordinates are plan metres, so its pattern is anchored where the plan's is", () => {
    const room = { id: "r", x: 2.4, y: 0.64, w: 2.4, h: 1.28, label: "R", floor: "oak" as const };
    const floor = buildFloor(room);
    const uv = floor.geometry.getAttribute("uv");
    const pos = floor.geometry.getAttribute("position");
    const [mu, mv] = patternImage("planks").metres;
    for (let i = 0; i < pos.count; i++) {
      expect(uv.getX(i)).toBeCloseTo((pos.getX(i) + floor.position.x) / mu, 6);
      expect(uv.getY(i)).toBeCloseTo((pos.getZ(i) + floor.position.z) / mv, 6);
    }
    // the room's north-west corner is exactly one repeat in, each way
    const corner = [...Array(pos.count).keys()].find(
      (i) => Math.abs(pos.getX(i) + floor.position.x - room.x) < 1e-5 && Math.abs(pos.getZ(i) + floor.position.z - room.y) < 1e-5,
    )!;
    expect(uv.getX(corner)).toBeCloseTo(1, 6);
    expect(uv.getY(corner)).toBeCloseTo(1, 6);
  });

  it("a floor darkens toward its edges, where it meets the walls", () => {
    const floor = buildFloor({ id: "r", x: 0, y: 0, w: 4, h: 3, label: "R", floor: "tile" });
    const color = floor.geometry.getAttribute("color");
    const pos = floor.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const onEdge = Math.abs(Math.abs(pos.getX(i)) - 2) < 1e-9 || Math.abs(Math.abs(pos.getZ(i)) - 1.5) < 1e-9;
      expect(color.getX(i)).toBeCloseTo(onEdge ? CONTACT.floorEdge.shade : 1, 6);
    }
    expect((floor.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
  });

  it("a piece's grain is the same size whatever the size of the part it is on", () => {
    const [mu] = PATTERNS.grain.metres;
    const density = (w: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.5), surface("oak"));
      const g = new THREE.Group().add(mesh);
      projectSurfaceUVs(g);
      const uv = mesh.geometry.getAttribute("uv");
      const normal = mesh.geometry.getAttribute("normal");
      let lo = Infinity;
      let hi = -Infinity;
      // the top face: its u runs along the part's width
      for (let i = 0; i < uv.count; i++) {
        if (normal.getY(i) < 0.99) continue;
        lo = Math.min(lo, uv.getX(i));
        hi = Math.max(hi, uv.getX(i));
      }
      return (hi - lo) / w;
    };
    expect(density(0.4)).toBeCloseTo(1 / mu, 6);
    expect(density(2.0)).toBeCloseTo(1 / mu, 6);
  });
});

describe("materials by surface", () => {
  it("a scene's cache hands out one material per surface and tint, sharing the pattern", () => {
    const cache = new MaterialCache();
    const a = surface("fabric", "#7a8ba0", cache);
    expect(surface("fabric", "#7A8BA0", cache)).toBe(a);
    const b = surface("fabric", "#9aa5b5", cache);
    expect(b).not.toBe(a);
    expect(b.map).toBe(a.map);
    expect(cache.size).toBe(2);
    expect(a.color.getHexString()).toBe("7a8ba0");
    expect(a.roughness).toBe(SURFACES.fabric.roughness);
    cache.dispose();
  });

  it("a plain surface is the same finish and tint with no pattern, and makes no texture", () => {
    disposePatternTextures();
    const cache = new MaterialCache();
    const plain = surface("oak", "#96754e", cache, false);
    expect(plain).not.toBe(surface("oak", "#96754e", cache));
    disposePatternTextures();
    const again = surface("oak", "#96754e", new MaterialCache(), false);
    expect(again.map).toBeNull();
    expect(patternTextureCount()).toBe(0);
    expect(again.roughness).toBe(SURFACES.oak.roughness);
    expect(again.color.getHexString()).toBe("96754e");
    // it still lays out texture coordinates in metres, as the patterned surface would
    expect(again.userData.metres).toEqual(PATTERNS.grain.metres);
    // and building a model makes no texture: only drawing it with its patterns does
    const piece = buildFurniture({ ...BUILT_IN_KINDS.find((k) => k.kind === "coffee_table")!, w: 1.234 }, undefined, { patterns: false });
    expect(patternTextureCount()).toBe(0);
    disposeObject(piece);
    cache.dispose();
  });

  it("knows each pattern's repeat without making it", () => {
    for (const name of PATTERN_NAMES) expect(patternMetres(name), name).toEqual(patternImage(name).metres);
  });

  it("a surface without a tint is drawn in its token colour", () => {
    expect(surface("chrome").color.getHexString()).toBe(SURFACE_TINT.chrome.hex.slice(1));
    expect(staticSurface("plaster")).toBe(staticSurface("plaster"));
    expect(isStatic(staticSurface("plaster"))).toBe(true);
  });

  it("every part material an agent may name is a surface", () => {
    for (const m of PART_MATERIALS) expect(SURFACE_NAMES).toContain(PART_SURFACE[m]);
    expect(partSurface(undefined)).toBe("paint");
  });

  it("an agent's parts are drawn with the surfaces they name, in their colours", () => {
    const def: KindDef = {
      kind: "reading_chair",
      label: "Reading chair",
      w: 0.8,
      d: 0.8,
      h: 0.9,
      color: "#556677",
      category: "living",
      source: "custom",
      parts: [
        { shape: "box", w: 0.8, h: 0.4, d: 0.8, material: "fabric", color: "#aa5533" },
        { shape: "cylinder", w: 0.05, h: 0.2, d: 0.05, material: "wood" },
        { shape: "box", w: 0.8, h: 0.5, d: 0.1, y: 0.4, z: -0.35 },
      ],
    };
    const meshes = buildFurniture(def).children as THREE.Mesh[];
    const [seat, leg, back] = meshes.map((m) => m.material as THREE.MeshStandardMaterial);
    expect(seat.userData.surface).toBe("fabric");
    expect(seat.map).toBe(patternTexture("weave"));
    expect(seat.color.getHexString()).toBe("aa5533");
    expect(leg.userData.surface).toBe("oak");
    expect(leg.color.getHexString()).toBe(SURFACE_TINT.oak.hex.slice(1));
    expect(back.userData.surface).toBe("paint");
    expect(back.color.getHexString()).toBe("556677");
    // the textured parts have texture coordinates in metres
    expect(meshes[0].geometry.getAttribute("uv")).toBeTruthy();
  });
});

describe("contact shadows", () => {
  it("every piece but a rug stands on one, sized to its footprint, sharing one material", () => {
    const scene = new PlanScene();
    scene.update({
      ...emptyModel(),
      items: [
        { id: "a", kind: "sofa", x: 1, y: 1, rotation: 0 },
        { id: "b", kind: "armchair", x: 4, y: 1, rotation: 0 },
        { id: "c", kind: "rug", x: 2, y: 3, rotation: 0 },
      ],
    });
    const shadows: THREE.Mesh[] = [];
    scene.root.traverse((o) => o.name === CONTACT_SHADOW && shadows.push(o as THREE.Mesh));
    expect(shadows).toHaveLength(2);
    expect(shadows[0].material).toBe(shadows[1].material);
    expect(isStatic(shadows[0].material as THREE.Material)).toBe(true);
    expect(shadows.every((s) => !s.castShadow && !s.receiveShadow)).toBe(true);
    scene.dispose();
  });

  it("spreads the same distance past any footprint", () => {
    for (const [w, d] of [
      [0.4, 0.4],
      [2.6, 0.95],
    ]) {
      const box = new THREE.Box3().setFromObject(contactShadow(w, d));
      expect(box.max.x - box.min.x).toBeCloseTo(w + 2 * CONTACT.shadow.spread, 6);
      expect(box.max.z - box.min.z).toBeCloseTo(d + 2 * CONTACT.shadow.spread, 6);
    }
  });
});
