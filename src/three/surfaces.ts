/**
 * The 3D view's shared surfaces: every material the model is drawn with is one of a short list
 * of named surfaces (oak, fabric, brushed metal, the floor finishes…), each a finish from
 * config.ts (SURFACES) in a colour from the tokens (sceneTokens.ts SURFACE_TINT, or the tint the
 * caller names), textured with a procedural pattern where the surface has one.
 *
 * The patterns (wood grain, fabric weave, brushed metal, the floors' planks and tiles…) are
 * computed texel by texel into DataTextures: no canvas, no image files, nothing fetched, and the
 * same texels on every run (a seeded noise). Each is made once, on first use, and shared by every
 * material, every scene and every thumbnail that samples it; it is static (materials.ts), so no
 * object takes it with it when it goes, and disposePatternTextures() frees them all.
 *
 * A pattern's scale is in metres of surface, not in faces: projectSurfaceUVs() gives a built
 * piece texture coordinates from where its faces are, so the grain on a table top is as wide as
 * on its legs, and a floor's planks fall where the plan's oak pattern draws them
 * (src/editor/drawing.ts FLOOR_PATTERN, anchored at the plan's origin like the sheet's).
 *
 *   surface("fabric", tint)            a material, owned by the caller
 *   surface("fabric", tint, cache)     the scene's shared one (MaterialCache: counted, swept)
 *   surface("fabric", tint, c, false)  plain: its finish and tint, no pattern (a thumbnail's)
 *   staticSurface("plaster", tint)     one for every build, never disposed (walls, frames)
 *   partSurface(part.material)         the surface an agent's part names
 */

import * as THREE from "three";
import { FLOOR_PATTERN } from "../editor/drawing";
import type { PartMaterial } from "../model/limits";
import { MATERIAL, SURFACE_TINT } from "../ui/theme/sceneTokens";
import { CONTACT, PATTERN_RECIPES as R, PATTERNS, SURFACES, TEXTURES, type PatternName, type SurfaceFinish, type ToneMappingName } from "./config";
import { keepStatic, type MaterialCache } from "./materials";

export type SurfaceName = keyof typeof SURFACES;
export const SURFACE_NAMES = Object.freeze(Object.keys(SURFACES) as SurfaceName[]);

/** The renderer's tone mapping, by the name config.ts gives it. */
export const TONE_MAPPING: Readonly<Record<ToneMappingName, THREE.ToneMapping>> = Object.freeze({
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
});

// ============================================================================ noise

/** A well-mixed integer hash of a lattice point, in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** Value noise over the unit square: its value at (u, v). */
type Noise = (u: number, v: number) => number;

/**
 * Value noise over the unit square, `cx` by `cy` cells, wrapping at the square's edges: a
 * texture made from it tiles without a seam. The hash of every lattice point is taken once, when
 * the noise is made — a pattern reads each point many thousand times — so the texels are the
 * same as hashing at every read, made several times faster.
 */
function tileNoise(cx: number, cy: number, seed: number): Noise {
  const table = new Float64Array(cx * cy);
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) table[j * cx + i] = hash(i, j, seed);
  return (u, v) => {
    const x = u * cx;
    const y = v * cy;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const i0 = wrap(ix, cx);
    const i1 = wrap(ix + 1, cx);
    const j0 = wrap(iy, cy) * cx;
    const j1 = wrap(iy + 1, cy) * cx;
    const top = table[j0 + i0] + (table[j0 + i1] - table[j0 + i0]) * fx;
    const bottom = table[j1 + i0] + (table[j1 + i1] - table[j1 + i0]) * fx;
    return top + (bottom - top) * fy;
  };
}

// ============================================================================ patterns

/** One pattern's texels and how much surface they cover. */
export interface PatternImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, row 0 at v = 0 (the plan's north edge for a floor) */
  readonly data: Uint8Array;
  /** metres of surface one repeat covers, along u and along v */
  readonly metres: readonly [number, number];
  /** true when the texels are colours (sRGB); false when they are a shade a tint multiplies (linear) */
  readonly baked: boolean;
}

type Rgb = readonly [number, number, number];
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** A width × height image, each texel from `texel(u, v, x, y)`: a shade (one number) or a colour. */
function paint(
  width: number,
  height: number,
  texel: (u: number, v: number, x: number, y: number) => number | Rgb,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = texel((x + 0.5) / width, (y + 0.5) / height, x, y);
      const i = (y * width + x) * 4;
      if (typeof t === "number") {
        const b = byte(t * 255);
        data[i] = data[i + 1] = data[i + 2] = b;
      } else {
        data[i] = byte(t[0]);
        data[i + 1] = byte(t[1]);
        data[i + 2] = byte(t[2]);
      }
      data[i + 3] = 255;
    }
  }
  return data;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

/** Each pattern's own seed: the shared one, offset by the pattern, so no two look alike. */
const seedOf = (name: PatternName) => TEXTURES.seed * TEXTURES.seedStride + PATTERN_NAMES.indexOf(name);


/** A shade field over a pattern's texels: (u, v) in the unit square, (x, y) the texel. */
type Field = (u: number, v: number, x: number, y: number) => number;

/** A tinted pattern: a shade in [1 - detail, 1] that the surface's colour is multiplied by; `field` is made from the pattern's seed. */
function shade(name: Exclude<PatternName, "planks" | "tiles">, field: (seed: number) => Field): PatternImage {
  const spec = PATTERNS[name];
  const [width, height] = spec.size;
  const f = field(seedOf(name));
  const data = paint(width, height, (u, v, x, y) => 1 - spec.detail * Math.max(0, Math.min(1, f(u, v, x, y))));
  return { width, height, data, metres: spec.metres, baked: false };
}

/** Over-under threads, `n` a repeat each way, each thread rounded across its width. */
function woven(u: number, v: number, n: number): number {
  const x = u * n;
  const y = v * n;
  const over = (Math.floor(x) + Math.floor(y)) % 2 === 0;
  const across = over ? y - Math.floor(y) : x - Math.floor(x);
  return 1 - Math.sin(Math.PI * across);
}

/** The oak floor: one run of FLOOR_PATTERN's planks, its joints where the plan draws them. */
function planks(): PatternImage {
  const { plankWidth, plankRun, plankJoints } = FLOOR_PATTERN;
  const { pxPerMetre, detail, seam } = PATTERNS.planks;
  const p = R.planks;
  const rows = plankJoints.length;
  const metres: [number, number] = [plankRun, rows * plankWidth];
  const width = Math.round(metres[0] * pxPerMetre);
  const height = Math.round(metres[1] * pxPerMetre);
  const seed = seedOf("planks");
  const oak = rgbOf(MATERIAL.floor.oak.hex);
  const seamColour = rgbOf(MATERIAL.oakSeam.hex);
  const grainColour = rgbOf(MATERIAL.oakGrain.hex);
  const streaks = tileNoise(p.streakCells[0], rows * p.streakCells[1], seed + 1);
  const flecks = tileNoise(p.fleckCells[0], rows * p.fleckCells[1], seed + 2);
  const data = paint(width, height, (u, v) => {
    const mx = u * metres[0];
    const my = v * metres[1];
    const row = Math.min(rows - 1, Math.floor(my / plankWidth));
    const along = wrap(mx - plankJoints[row], plankRun);
    const across = my - row * plankWidth;
    if (Math.min(along, plankRun - along) < seam / 2 || Math.min(across, plankWidth - across) < seam / 2) return seamColour;
    // each plank its own tone, then long streaks of grain along it
    const tone = 1 + (hash(row, 0, seed) - 0.5) * detail;
    return mix(scale(oak, tone), grainColour, detail * (p.weights[0] * Math.max(0, streaks(u, v) - p.streakFrom) + p.weights[1] * flecks(u, v)));
  });
  return { width, height, data, metres, baked: true };
}

/** The tiled floor: a block of FLOOR_PATTERN tiles, the grout on the lines the plan draws. */
function tiles(): PatternImage {
  const { pxPerMetre, perSide, grout, detail } = PATTERNS.tiles;
  const side = FLOOR_PATTERN.tile;
  const metres: [number, number] = [perSide * side, perSide * side];
  const size = Math.round(metres[0] * pxPerMetre);
  const seed = seedOf("tiles");
  const tile = rgbOf(MATERIAL.floor.tile.hex);
  const groutColour = rgbOf(MATERIAL.tileGrout.hex);
  const cells = perSide * R.tiles.cellsPerTile;
  const mottle = tileNoise(cells, cells, seed + 1);
  const data = paint(size, size, (u, v) => {
    const mx = u * metres[0];
    const my = v * metres[1];
    const fx = wrap(mx, side);
    const fy = wrap(my, side);
    if (Math.min(fx, side - fx) < grout / 2 || Math.min(fy, side - fy) < grout / 2) return groutColour;
    const tone = 1 + (hash(Math.floor(mx / side), Math.floor(my / side), seed) - 0.5) * detail;
    return scale(tile, tone - detail * R.tiles.weight * mottle(u, v));
  });
  return { width: size, height: size, data, metres, baked: true };
}

/** Threads over and under over a soft mottle (the weave, the linen). */
const cloth = (recipe: { readonly threads: number; readonly cells: readonly [number, number]; readonly weights: readonly [number, number] }) => (seed: number): Field => {
  const mottle = tileNoise(...recipe.cells, seed);
  return (u, v) => recipe.weights[0] * woven(u, v, recipe.threads) + recipe.weights[1] * mottle(u, v);
};

/** A noise and a texel-fine grit (brushed metal, speckle, pile). */
const grit = (recipe: { readonly cells: readonly [number, number]; readonly weights: readonly [number, number] }) => (seed: number): Field => {
  const cloud = tileNoise(...recipe.cells, seed);
  return (u, v, x, y) => recipe.weights[0] * cloud(u, v) + recipe.weights[1] * hash(x, y, seed + 1);
};

/** How each pattern is made. */
const MAKERS: Readonly<Record<PatternName, () => PatternImage>> = {
  // wood: growth rings drawn out along u, warped, over fine fibres
  grain: () =>
    shade("grain", (seed) => {
      const g = R.grain;
      const warp = tileNoise(...g.warpCells, seed);
      const fibre = tileNoise(...g.fibreCells, seed + 1);
      const figure = tileNoise(...g.figureCells, seed + 2);
      return (u, v) => {
        const band = (v * g.rings + g.warp * warp(u, v)) % 1;
        const ring = Math.max(0, (band - g.ringFrom) / (1 - g.ringFrom));
        return g.weights[0] * ring + g.weights[1] * fibre(u, v) + g.weights[2] * figure(u, v);
      };
    }),
  weave: () => shade("weave", cloth(R.weave)),
  linen: () => shade("linen", cloth(R.linen)),
  brushed: () => shade("brushed", grit(R.brushed)),
  speckle: () => shade("speckle", grit(R.speckle)),
  pile: () => shade("pile", grit(R.pile)),
  concrete: () =>
    shade("concrete", (seed) => {
      const c = R.concrete;
      const cloud = tileNoise(...c.cells, seed);
      const fine = tileNoise(...c.fineCells, seed + 1);
      return (u, v, x, y) => c.weights[0] * cloud(u, v) + c.weights[1] * fine(u, v) + c.weights[2] * hash(x, y, seed + 2);
    }),
  planks,
  tiles,
};

export const PATTERN_NAMES = Object.freeze(Object.keys(MAKERS) as PatternName[]);

/**
 * The surface one repeat of a pattern covers, metres along u and v, known without making the
 * pattern: a piece's texture coordinates are laid out from it before any texture exists.
 */
export function patternMetres(name: PatternName): readonly [number, number] {
  if (name === "planks") return [FLOOR_PATTERN.plankRun, FLOOR_PATTERN.plankJoints.length * FLOOR_PATTERN.plankWidth];
  if (name === "tiles") return [PATTERNS.tiles.perSide * FLOOR_PATTERN.tile, PATTERNS.tiles.perSide * FLOOR_PATTERN.tile];
  return PATTERNS[name].metres;
}

/** A pattern's texels, computed afresh: what the texture holds, for the tests. */
export const patternImage = (name: PatternName): PatternImage => MAKERS[name]();

const textures = new Map<PatternName, THREE.DataTexture>();

/**
 * The shared texture for a pattern, made on first use. It repeats, mipmaps, and is sampled at an
 * angle (anisotropy) so a floor seen edge-on keeps its joints; its `userData.metres` is the
 * surface one repeat covers.
 */
export function patternTexture(name: PatternName): THREE.DataTexture {
  const hit = textures.get(name);
  if (hit) return hit;
  const image = patternImage(name);
  const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `pattern:${name}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURES.anisotropy;
  texture.colorSpace = image.baked ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.userData.metres = image.metres;
  texture.needsUpdate = true;
  keepStatic(texture);
  textures.set(name, texture);
  return texture;
}

/** How many pattern textures exist right now (at most one per pattern). */
export const patternTextureCount = (): number => textures.size;

/**
 * Free every pattern texture (on every renderer that uploaded it). A later ask makes it afresh;
 * the materials that still sample one then upload it again when next drawn.
 */
export function disposePatternTextures(): number {
  const count = textures.size;
  for (const texture of textures.values()) texture.dispose();
  textures.clear();
  return count;
}

// ============================================================================ materials

/** The tint a surface is drawn in: the caller's, or the surface's own. */
const tintOf = (name: SurfaceName, tint?: string): string => (tint ?? SURFACE_TINT[name].hex).toLowerCase();

/** The cache key of a surface in a tint, patterned or plain. */
export const surfaceKey = (name: SurfaceName, tint?: string, patterned = true): string => `surface|${name}|${tintOf(name, tint)}${patterned ? "" : "|plain"}`;

/**
 * A new material for a named surface. Its `userData.surface` names it; one with a pattern
 * carries `userData.metres`, the surface one repeat covers (projectSurfaceUVs reads it), and —
 * unless `patterned` is false — the pattern's texture. A plain one is the surface's finish in its
 * tint, and makes no texture: what a Library thumbnail draws, where a weave or a grain would be
 * finer than its pixels, and what a model is laid out with before it is drawn. A surface with
 * `vertexShade` (the floors) reads per-vertex shading: draw it only on geometry that has a
 * colour attribute.
 */
export function createSurfaceMaterial(name: SurfaceName, tint?: string, patterned = true): THREE.MeshStandardMaterial {
  const finish: SurfaceFinish = SURFACES[name];
  const color = tintOf(name, tint);
  const material = new THREE.MeshStandardMaterial({ color, roughness: finish.roughness, metalness: finish.metalness });
  material.name = `surface:${name}`;
  material.userData.surface = name;
  if (finish.pattern) {
    material.userData.metres = patternMetres(finish.pattern);
    if (patterned) material.map = patternTexture(finish.pattern);
  }
  if (finish.opacity !== undefined) {
    material.transparent = true;
    material.opacity = finish.opacity;
  }
  if (finish.doubleSide) material.side = THREE.DoubleSide;
  if (finish.vertexShade) material.vertexColors = true;
  if (finish.glow) {
    material.emissive.set(color);
    material.emissiveIntensity = finish.glow;
  }
  return material;
}

/**
 * A named surface in a tint. With a cache, the scene's one shared material for it (retain the
 * object that draws with it there, and release it when it goes); without, a material the
 * caller owns.
 */
export function surface(name: SurfaceName, tint?: string, cache?: MaterialCache | null, patterned = true): THREE.MeshStandardMaterial {
  if (!cache) return createSurfaceMaterial(name, tint, patterned);
  return cache.obtain(surfaceKey(name, tint, patterned), () => createSurfaceMaterial(name, tint, patterned));
}

const statics = new Map<string, THREE.MeshStandardMaterial>();

/** The one static material for a surface in a tint: shared by every build and never disposed. */
export function staticSurface(name: SurfaceName, tint?: string): THREE.MeshStandardMaterial {
  const key = surfaceKey(name, tint);
  let material = statics.get(key);
  if (!material) statics.set(key, (material = keepStatic(createSurfaceMaterial(name, tint))));
  return material;
}

/** The surface each part material an agent may name is drawn with. */
export const PART_SURFACE: Readonly<Record<PartMaterial, SurfaceName>> = Object.freeze({
  wood: "oak",
  light_wood: "lightWood",
  dark_wood: "darkWood",
  paint: "paint",
  lacquer: "lacquer",
  fabric: "fabric",
  linen: "linen",
  leather: "leather",
  metal: "metal",
  chrome: "chrome",
  brass: "brass",
  ceramic: "ceramic",
  stone: "stone",
  glass: "glass",
  plastic: "plastic",
});

/** The surface a part without a material is drawn with: a matte finish in the part's colour. */
export const DEFAULT_PART_SURFACE: SurfaceName = "paint";

/** The surface for an agent's part. */
export const partSurface = (material: PartMaterial | undefined): SurfaceName =>
  material ? PART_SURFACE[material] : DEFAULT_PART_SURFACE;

// ============================================================================ texture coordinates

const scratch = {
  matrix: new THREE.Matrix4(),
  normalMatrix: new THREE.Matrix3(),
  p: new THREE.Vector3(),
  n: new THREE.Vector3(),
};

/**
 * Give every patterned mesh under `root` texture coordinates in metres of surface, measured in
 * `root`'s frame: each face takes the two axes it lies along (a top x and z, a front x and y, a
 * side z and y) divided by its pattern's repeat. Neighbouring parts then continue one another's
 * grain, and a pattern is the same size whatever the part's size. Meshes without a pattern are
 * left as they are.
 */
export function projectSurfaceUVs(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const metres = (mesh.material as THREE.Material | undefined)?.userData?.metres as readonly [number, number] | undefined;
    if (!metres) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    if (!position || !normal) return;
    // the mesh's transform up to (not including) the root
    scratch.matrix.identity();
    for (let n: THREE.Object3D | null = mesh; n && n !== root; n = n.parent) {
      n.updateMatrix();
      scratch.matrix.premultiply(n.matrix);
    }
    scratch.normalMatrix.getNormalMatrix(scratch.matrix);
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      scratch.p.fromBufferAttribute(position, i).applyMatrix4(scratch.matrix);
      scratch.n.fromBufferAttribute(normal, i).applyMatrix3(scratch.normalMatrix);
      const ax = Math.abs(scratch.n.x);
      const ay = Math.abs(scratch.n.y);
      const az = Math.abs(scratch.n.z);
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) [u, v] = [scratch.p.x, scratch.p.z];
      else if (ax >= az) [u, v] = [scratch.p.z, scratch.p.y];
      else [u, v] = [scratch.p.x, scratch.p.y];
      uv[i * 2] = u / metres[0];
      uv[i * 2 + 1] = v / metres[1];
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  });
}

// ============================================================================ flat patches

/**
 * A flat, upward-facing patch on four lines each way (three by three quads): the outer ring is
 * where a floor's contact shading or a shadow's soft edge goes, the middle is flat. `xs` and `zs`
 * are the four lines' positions, `uv` gives a vertex's texture coordinates, `shade` (optional)
 * its colour, by line index (0 and 3 are the edges).
 */
export function ninePatch(
  xs: readonly number[],
  zs: readonly number[],
  y: number,
  uv: (x: number, z: number, i: number, j: number) => readonly [number, number],
  shade?: (i: number, j: number) => number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      positions.push(xs[i], y, zs[j]);
      uvs.push(...uv(xs[i], zs[j], i, j));
      if (shade) {
        const s = shade(i, j);
        colors.push(s, s, s);
      }
    }
  }
  const index: number[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      // (x0,z0) (x0,z1) (x1,z0), then (x1,z0) (x0,z1) (x1,z1): both face +y
      index.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(16).fill([0, 1, 0]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (shade) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  return geometry;
}

// ============================================================================ contact shadows

let shadowMaterial: THREE.MeshBasicMaterial | null = null;

/** The soft shadow's texture: opaque in the middle square, falling off to nothing at the rim. */
export function contactShadowImage(): PatternImage {
  const { texture: size, falloff } = CONTACT.shadow;
  const data = paint(size, size, (u, v) => {
    const dx = Math.max(0, falloff - u, u - (1 - falloff)) / falloff;
    const dy = Math.max(0, falloff - v, v - (1 - falloff)) / falloff;
    const d = Math.min(1, Math.hypot(dx, dy));
    return 1 - smooth(d);
  });
  return { width: size, height: size, data, metres: [1, 1], baked: false };
}

function contactShadowMaterial(): THREE.MeshBasicMaterial {
  if (shadowMaterial) return shadowMaterial;
  const image = contactShadowImage();
  const alpha = keepStatic(new THREE.DataTexture(image.data, image.width, image.height));
  alpha.name = "pattern:contact-shadow";
  alpha.magFilter = THREE.LinearFilter;
  alpha.minFilter = THREE.LinearMipmapLinearFilter;
  alpha.generateMipmaps = true;
  alpha.needsUpdate = true;
  shadowMaterial = keepStatic(
    new THREE.MeshBasicMaterial({
      color: MATERIAL.contactShadow.hex,
      alphaMap: alpha,
      transparent: true,
      opacity: CONTACT.shadow.opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  shadowMaterial.name = "surface:contact-shadow";
  return shadowMaterial;
}

/** The name contact shadows carry, so an export can leave them out. */
export const CONTACT_SHADOW = "contact-shadow";

/**
 * The soft shadow a piece `w` by `d` stands on, centred under it in its own frame: dark under
 * the footprint and fading over CONTACT.shadow.spread past it, whatever the footprint's size.
 * It neither casts nor receives shadows, and is not something a click can hit.
 */
export function contactShadow(w: number, d: number): THREE.Mesh {
  const { spread, lift, falloff } = CONTACT.shadow;
  const xs = [-w / 2 - spread, -w / 2, w / 2, w / 2 + spread];
  const zs = [-d / 2 - spread, -d / 2, d / 2, d / 2 + spread];
  const edge = [0, falloff, 1 - falloff, 1];
  const mesh = new THREE.Mesh(
    ninePatch(xs, zs, lift, (_x, _z, i, j) => [edge[i], edge[j]]),
    contactShadowMaterial(),
  );
  mesh.name = CONTACT_SHADOW;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}
