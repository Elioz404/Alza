/**
 * Composite furniture builders. Each built-in kind is modelled from soft boxes, turned profiles
 * and extruded outlines (furnitureShapes.ts) drawn with the 3D view's named surfaces
 * (surfaces.ts: wood grain, fabric weave, brushed metal…) in the furniture palette's colours
 * (src/ui/theme/sceneTokens.ts FURNITURE), to the proportions in furnitureStyle.ts. Local frame:
 * footprint centred at the origin, width along +x, depth along +z, front facing +z, standing on
 * y = 0; a built-in piece fills its catalogue box w × h × d exactly.
 *
 * Everything is built from a catalogue definition (model/catalog.ts), never from state kept
 * here: a built-in kind gets its hand-modelled builder, an agent-defined one is assembled from
 * the `parts` its definition carries (each part's `material` names a surface, its colour tints
 * it), and anything else is blocked out from its footprint.
 *
 * A built-in piece is baked to one mesh per surface (a sofa is four draw calls, not twenty), and
 * every piece of one definition shares its geometries: the first build of a definition makes
 * them, every later one draws the same buffers, and they are freed when the last piece drawing
 * them is disposed (disposeObject), so nothing outlives the pieces in the scene.
 */

import * as THREE from "three";
import type { KindDef, PartSpec } from "../model/types";
import type { Swatch } from "../ui/theme/color";
import { FURNITURE as F } from "../ui/theme/sceneTokens";
import { MaterialCache } from "./materials";
import { partSurface, projectSurfaceUVs, staticSurface, surface, type SurfaceName } from "./surfaces";
import { FURNITURE_STYLE as S, NO_SHADOW_SURFACES, riseOf } from "./furnitureStyle";
import {
  chamferBox,
  cushion,
  disc,
  ellipseOutline,
  plate,
  quarterOutline,
  rectOutline,
  type Outline,
  fitToBox,
  hardBox,
  lathe,
  mergePlaced,
  softBox,
  triangleCount,
  turned,
} from "./furnitureShapes";

// ============================================================================ materials

/** A named surface in a tint: what a part of a model is drawn with, before any material exists. */
interface Look {
  readonly name: SurfaceName;
  readonly tint?: string;
}

/**
 * The materials a definition's model is made with while its shared geometry is built: one cache
 * per build, freed as soon as the model is made (templateFor). They are never drawn — each piece
 * built from the model takes the same surface, in the same tint, from the cache it is built for
 * (the scene's, a thumbnail batch's, or none) — so nothing outlives the build that made them.
 */
let modelling: MaterialCache | null = null;
const looks = new WeakMap<THREE.Material, Look>();

/** A named surface in a palette colour (or its own). */
function surf(name: SurfaceName, tint?: Swatch | string): THREE.MeshStandardMaterial {
  const hex = typeof tint === "string" ? tint : tint?.hex;
  // plain: a modelling material is never drawn, so it makes no texture
  const material = surface(name, hex, modelling, false);
  looks.set(material, { name, tint: hex });
  return material;
}

const FABRIC = (c: Swatch) => surf("fabric", c);
const LINEN = (c: Swatch) => surf("linen", c);
const WOOD = (c: Swatch) => surf("oak", c);
const LIGHT_WOOD = (c: Swatch) => surf("lightWood", c);
const DARK_WOOD = (c: Swatch) => surf("darkWood", c);
const PAINT = (c: Swatch | string) => surf("paint", c);
const LACQUER = (c: Swatch | string) => surf("lacquer", c);
const STONE = (c: Swatch) => surf("stone", c);
const PLASTIC = (c: Swatch) => surf("plastic", c);
const SCREEN = (c?: Swatch) => surf("screen", c);
const METAL = (c?: Swatch) => surf("metal", c);
const CHROME = () => surf("chrome");
const BRASS = () => surf("brass");
const CERAMIC = (c: Swatch = F.porcelain) => surf("ceramic", c); // glazed sanitaryware
// the same three surfaces in every piece that has them: made once, never disposed with a piece
const DARK = staticSurface("rubber", F.dark.hex);
const WATER = staticSurface("water");
const PANE = staticSurface("glass");
/** a car's tinted glass: dark and glossy, so its glasshouse reads as glass from outside */
const GLAZING = staticSurface("ceramic", F.carGlass.hex);

// ============================================================================ the modelling kit

interface KitPart {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  material: THREE.Material;
  cast: boolean;
  /** a fitting (a tap, a television, a headboard): it may stand over the piece's catalogue height */
  fitting: boolean;
}

/** How a part is turned (radians, about its own centre) and whether it casts a shadow. */
interface Place {
  rx?: number;
  ry?: number;
  rz?: number;
  /** the order the turns apply in (three.js Euler order; "YXZ" tilts first, then turns about y) */
  order?: THREE.EulerOrder;
  cast?: boolean;
}

const euler = new THREE.Euler();
const turn = new THREE.Quaternion();
const unit = new THREE.Vector3(1, 1, 1);

/** Collects a piece's parts, each a geometry placed in the piece's frame with its surface. */
class Kit {
  readonly parts: KitPart[] = [];
  private fitting = false;

  /** Model `parts` as fittings: they stand over the piece's catalogue height, which its body fills. */
  fittings(parts: () => void): void {
    this.fitting = true;
    try {
      parts();
    } finally {
      this.fitting = false;
    }
  }

  /** A geometry with its origin put at (x, y, z), turned by `place`. */
  put(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, place: Place = {}): void {
    euler.set(place.rx ?? 0, place.ry ?? 0, place.rz ?? 0, place.order ?? "XYZ");
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), turn.setFromEuler(euler), unit);
    const cast = place.cast ?? !NO_SHADOW_SURFACES.has(material.userData.surface as string);
    this.parts.push({ geometry, matrix, material, cast, fitting: this.fitting });
  }

  /** A hard box (small bevel) standing on y0. */
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y0: number, z: number, place?: Place, radius?: number): void {
    this.put(hardBox(w, h, d, radius), m, x, y0 + h / 2, z, place);
  }

  /** A sharp-edged slab standing on y0 (books, panes, a rug's layers). */
  slab(m: THREE.Material, w: number, h: number, d: number, x: number, y0: number, z: number, place?: Place): void {
    this.put(softBox(w, h, d), m, x, y0 + h / 2, z, place);
  }

  /** A rounded panel: soft edges, flat faces (an upholstered frame, a headboard channel). */
  panel(m: THREE.Material, w: number, h: number, d: number, x: number, y0: number, z: number, radius: number, place?: Place, edgeSegments: number = S.bevel.softEdgeSegments): void {
    // one band over an edge is a chamfer: cheaper drawn as one, shading just as soft
    const geometry = edgeSegments > 1 ? softBox(w, h, d, { radius, edgeSegments }) : chamferBox(w, h, d, Math.min(radius, Math.min(w, h, d) * S.bevel.maxFraction));
    this.put(geometry, m, x, y0 + h / 2, z, place);
  }

  /** A cushion: rounded all round, its top sagging toward the middle. */
  soft(m: THREE.Material, w: number, h: number, d: number, x: number, y0: number, z: number, radius: number, sag = 0, place?: Place): void {
    this.put(cushion(w, h, d, radius, sag), m, x, y0 + h / 2, z, place);
  }

  /** An upright cylinder (or cone) standing on y0. */
  cyl(m: THREE.Material, r: number, h: number, x: number, y0: number, z: number, segments: number = S.segments.small, rTop = r, place?: Place): void {
    this.put(new THREE.CylinderGeometry(rTop, r, h, segments), m, x, y0 + h / 2, z, place);
  }

  /** A rod of radius r from a to b (handles, rails, spindles). */
  rod(m: THREE.Material, r: number, a: THREE.Vector3Like, b: THREE.Vector3Like, segments: number = S.segments.small): void {
    const from = new THREE.Vector3(a.x, a.y, a.z);
    const along = new THREE.Vector3(b.x, b.y, b.z).sub(from);
    const length = along.length();
    const geometry = new THREE.CylinderGeometry(r, r, length, segments);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
    const matrix = new THREE.Matrix4().compose(from.addScaledVector(along, 0.5), q, unit);
    this.parts.push({ geometry, matrix, material: m, cast: true, fitting: this.fitting });
  }

  /** A shape whose geometry rises from y = 0 (turned, extruded), put with its foot at (x, y0, z). */
  stand(m: THREE.Material, geometry: THREE.BufferGeometry, x: number, y0: number, z: number, place?: Place): void {
    this.put(geometry, m, x, y0, z, place);
  }
}

type Builder = (k: Kit, def: KindDef) => void;

// ============================================================================ shared details

const C = S.cabinets;
const HANDLE_DEPTH = C.handle.standoff + C.handle.bar;

/** The four leg positions inset from a footprint's corners. */
const corners = (w: number, d: number, inset: number): [number, number][] => [
  [-w / 2 + inset, d / 2 - inset],
  [w / 2 - inset, d / 2 - inset],
  [-w / 2 + inset, -d / 2 + inset],
  [w / 2 - inset, -d / 2 + inset],
];

/** A leg tapering toward the floor. */
const taperedLeg = (k: Kit, m: THREE.Material, r: number, h: number, x: number, z: number, y0 = 0) =>
  k.stand(m, turned(S.legs.tapered, r, h, S.segments.leg), x, y0, z);

/** A turned leg: collars, a waist and a bead, wider at the top. */
const turnedLeg = (k: Kit, m: THREE.Material, r: number, h: number, x: number, z: number) =>
  k.stand(m, turned(S.legs.turned, r, h, S.segments.leg), x, 0, z);

/** A bar pull on a front whose face is at zFace, along x (or y when upright). */
function barHandle(k: Kit, m: THREE.Material, length: number, x: number, y: number, zFace: number, upright = false): void {
  const { bar, standoff, postInsetFraction, postInsetBars, postFraction } = C.handle;
  const z = zFace + standoff + bar / 2;
  const dx = upright ? 0 : length / 2;
  const dy = upright ? length / 2 : 0;
  k.rod(m, bar / 2, { x: x - dx, y: y - dy, z }, { x: x + dx, y: y + dy, z });
  const inset = Math.min(length * postInsetFraction, bar * postInsetBars);
  for (const s of [-1, 1]) {
    const px = x + s * (dx - (upright ? 0 : inset));
    const py = y + s * (dy - (upright ? inset : 0));
    k.rod(m, bar * postFraction, { x: px, y: py, z: zFace }, { x: px, y: py, z }, S.segments.leg);
  }
}

/** A turned knob on a front whose face is at zFace. */
const knob = (k: Kit, m: THREE.Material, x: number, y: number, zFace: number) =>
  k.stand(m, turned(C.knob, C.knobRadius, C.knobDepth, S.segments.small), x, y, zFace, { rx: Math.PI / 2 });

/** A door or drawer front: its face at zFace, standing on y0. */
const front = (k: Kit, m: THREE.Material, w: number, h: number, x: number, y0: number, zFace: number) =>
  k.box(m, w, h, C.frontThickness, x, y0, zFace - C.frontThickness / 2, undefined, C.frontThickness * C.frontBevelFraction);

/** `n` equal fronts across a width, with a gap between and at each end: their centres and width. */
function split(width: number, n: number, gap: number = C.gap): { xs: number[]; w: number } {
  const w = (width - (n + 1) * gap) / n;
  return { xs: Array.from({ length: n }, (_, i) => -width / 2 + gap + w / 2 + i * (w + gap)), w };
}

/** A value in [0, 1) for the i-th of something (book sizes, leaf tilts): an integer hash, the same on every engine. */
const jitter = (i: number): number => {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const between = ([lo, hi]: readonly number[], t: number) => lo + (hi - lo) * t;

// ============================================================================ seating

interface Upholstered {
  seats: number;
  body: THREE.Material;
  cushion: THREE.Material;
  pillow?: THREE.Material;
}

/** A sofa or an armchair: a frame on tapered legs, arms, a back, and soft seat and back cushions. */
function upholstered(k: Kit, def: KindDef, o: Upholstered): void {
  const s = S.seating;
  const { w, d, h } = def;
  for (const [x, z] of corners(w, d, s.legInset)) taperedLeg(k, DARK, s.legRadius, s.legHeight, x, z);
  // the frame, the arms and the back the cushions rest on
  k.panel(o.body, w, s.frameTop - s.legHeight, d, 0, s.legHeight, 0, s.frameRadius);
  for (const side of [-1, 1]) k.panel(o.body, s.armWidth, s.armHeight - s.legHeight, d, side * (w / 2 - s.armWidth / 2), s.legHeight, 0, s.armRadius);
  k.panel(o.body, w - 2 * s.armWidth + 2 * s.frameRadius, h * s.backFrameHeightFraction - s.legHeight, s.backDepth, 0, s.legHeight, -d / 2 + s.backDepth / 2, s.frameRadius);

  const inner = w - 2 * s.armWidth;
  const backFront = -d / 2 + s.backDepth;
  const seatTop = s.frameTop + s.seatThickness;
  const { xs, w: cw } = split(inner, o.seats, s.seatGap);
  // seat cushions from the back's face to the front edge
  const seatDepth = d / 2 - backFront - s.seatGap;
  for (const x of xs) k.soft(o.cushion, cw, s.seatThickness, seatDepth, x, s.frameTop, backFront + seatDepth / 2, s.cushionRadius, s.seatSag);
  // back cushions leaning on the back, their top at the piece's height
  const lean = s.backLean;
  const bt = s.backThickness;
  const sink = s.seatSag;
  const bh = (h - seatTop + sink - bt * Math.sin(lean)) / Math.cos(lean);
  const cy = h - (bh / 2) * Math.cos(lean) - (bt / 2) * Math.sin(lean);
  const cz = backFront - s.seatGap + (bt / 2) * Math.cos(lean) + (bh / 2) * Math.sin(lean);
  for (const x of xs) k.put(cushion(cw, bh, bt, s.cushionRadius, 0), o.cushion, x, cy, cz, { rx: -lean });
  if (o.pillow) {
    const p = s.pillow;
    const x = inner / 2 - p.size / 2 - s.seatGap;
    const cy = seatTop - sink + (p.size / 2) * Math.cos(p.lean) + (p.thickness / 2) * Math.sin(p.lean);
    k.put(cushion(p.size, p.size, p.thickness, s.cushionRadius, p.sag), o.pillow, x, cy, backFront + bt + p.thickness / 2, { rx: -p.lean, rz: p.lean / 3 });
  }
}

const sofa: Builder = (k, def) => upholstered(k, def, { seats: 2, body: FABRIC(F.upholstery), cushion: FABRIC(F.cushion) });
const sofa3: Builder = (k, def) =>
  upholstered(k, def, { seats: 3, body: FABRIC(F.upholsteryDeep), cushion: FABRIC(F.cushion), pillow: LINEN(F.throwPillow) });
const armchair: Builder = (k, def) => upholstered(k, def, { seats: 1, body: FABRIC(F.upholstery), cushion: FABRIC(F.cushion) });

const diningChair: Builder = (k, { w, d, h }) => {
  const c = S.chairs;
  const wood = WOOD(F.oak);
  const seatY = c.seatHeight - c.seatThickness - c.padThickness;
  // turned front legs, square back legs running on up as the back's posts
  for (const side of [-1, 1]) {
    turnedLeg(k, wood, c.legRadius, seatY, side * (w / 2 - c.legRadius - c.postSide / 4), d / 2 - c.legRadius - c.postSide / 4);
    k.box(wood, c.postSide, h, c.postSide, side * (w / 2 - c.postSide / 2), 0, -d / 2 + c.postSide / 2);
  }
  // seat frame, its upholstered pad, and the stretchers that brace the legs
  k.box(wood, w, c.seatThickness, d, 0, seatY, 0);
  k.put(softBox(w - 2 * c.rail, c.padThickness, d - 2 * c.rail, { radius: c.padRadius, sag: c.padSag, edgeSegments: 1, perMetre: c.padGrid }), FABRIC(F.seatPad), 0, seatY + c.seatThickness + c.padThickness / 2, c.rail / 2);
  const low = seatY * c.stretcherHeight;
  for (const side of [-1, 1]) k.slab(wood, c.stretcher, c.stretcher, d - c.postSide, side * (w / 2 - c.postSide / 2), low, 0);
  // the back: a top rail on the posts, spindles down to the seat
  const top = h - c.backRailHeight;
  k.box(wood, w - c.postSide, c.backRailHeight, c.rail, 0, top, -d / 2 + c.postSide / 2);
  const span = w - 2 * c.postSide;
  for (let i = 0; i < c.spindles; i++) {
    const x = -span / 2 + (span * (i + 1)) / (c.spindles + 1);
    k.rod(wood, c.spindleRadius, { x, y: seatY + c.seatThickness, z: -d / 2 + c.postSide / 2 }, { x, y: top, z: -d / 2 + c.postSide / 2 }, S.segments.leg);
  }
};

const officeChair: Builder = (k, { w, d, h }) => {
  const o = S.chairs.office;
  const fabric = FABRIC(F.charcoal);
  const shell = PLASTIC(F.chassis);
  const steel = METAL(F.steelDeep);
  // a five-star base on casters, one arm pointing forward
  const reach = d / 2 - o.caster;
  const starY = o.caster * 2;
  for (let i = 0; i < o.arms; i++) {
    const a = (i / o.arms) * Math.PI * 2;
    const [sx, sz] = [Math.sin(a), Math.cos(a)];
    k.put(new THREE.SphereGeometry(o.caster, S.segments.leg, Math.round(S.segments.leg * S.segments.sphereRings)), DARK, sx * reach, o.caster, sz * reach);
    k.box(shell, reach, o.starArmHeight, o.starArm, (sx * reach) / 2, starY, (sz * reach) / 2, { ry: a - Math.PI / 2 });
  }
  k.cyl(shell, o.hubRadius, o.starArm, 0, starY, 0, S.segments.small);
  const seatBottom = o.seatHeight - o.seatThickness;
  const shellBottom = seatBottom - o.shellThickness;
  k.cyl(CHROME(), o.columnRadius, shellBottom - starY - o.starArm, 0, starY + o.starArm, 0, S.segments.small);
  // the seat on its shell, pushed back so the arms frame it
  const seatW = w - 2 * o.armPad - 2 * S.chairs.rail;
  const seatZ = d / 2 - o.caster - o.seatDepth / 2;
  const shellW = seatW * o.shellFraction;
  k.box(shell, shellW, o.shellThickness, o.seatDepth * o.shellFraction, 0, shellBottom, seatZ);
  k.soft(fabric, seatW, o.seatThickness, o.seatDepth, 0, seatBottom, seatZ, o.seatRadius, o.backSag);
  // the back on its spine
  const backBottom = o.seatHeight + o.armPad;
  const backH = h - backBottom;
  const backZ = -d / 2 + o.backThickness / 2;
  k.soft(fabric, seatW, backH, o.backThickness, 0, backBottom, backZ, o.backRadius, 0);
  const spine = o.spine;
  k.box(steel, spine.width, backBottom - shellBottom + backH * spine.reachFraction, spine.depth, 0, shellBottom, -d / 2 + o.backThickness + spine.depth / 2);
  // armrests: a bracket out from under the seat's shell, a post up from it, a pad on top
  const arm = o.arm;
  const armZ = seatZ - o.seatDepth * arm.back;
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - o.armPad / 2);
    const inner = shellW / 2;
    const outer = Math.abs(x) + arm.post / 2;
    k.box(steel, outer - inner, arm.bracket, arm.depth, side * ((inner + outer) / 2), shellBottom, armZ);
    k.box(steel, arm.post, seatBottom + o.armHeight - shellBottom, arm.depth, x, shellBottom, armZ);
    k.box(shell, o.armPad, arm.padThickness, o.seatDepth * arm.padDepthFraction, x, seatBottom + o.armHeight, seatZ - o.seatDepth * arm.padBack, undefined, arm.padRadius);
  }
};

// ============================================================================ tables

const coffeeTable: Builder = (k, { w, d, h }) => {
  const t = S.tables;
  const c = t.coffee;
  const top = LIGHT_WOOD(F.honeyDeep);
  k.stand(top, plate(rectOutline(w, d, c.cornerRadius), t.topThickness), 0, h - t.topThickness, 0);
  for (const [x, z] of corners(w, d, t.legInset + c.legRadius)) taperedLeg(k, WOOD(F.oakDeep), c.legRadius, h - t.topThickness, x, z);
  const inset = 2 * (t.legInset + c.legRadius);
  k.box(top, w - inset, c.shelfThickness, d - inset, 0, c.shelfHeight, 0);
};

const sideTable: Builder = (k, { w, d, h }) => {
  const s = S.tables.side;
  k.stand(LIGHT_WOOD(F.honeyDeep), disc(w / 2, d / 2, s.topThickness, S.bevel.hard), 0, h - s.topThickness, 0);
  const columnH = h - s.topThickness - s.baseThickness;
  k.stand(WOOD(F.oak), turned(s.column, 1, columnH, S.segments.medium), 0, s.baseThickness, 0);
  k.stand(WOOD(F.oakDeep), disc((w / 2) * s.baseRadiusFraction, (d / 2) * s.baseRadiusFraction, s.baseThickness, S.bevel.hard, S.segments.medium), 0, 0, 0);
};

const diningTable: Builder = (k, { w, d, h }) => {
  const t = S.tables;
  const legs = WOOD(F.oak);
  k.box(LIGHT_WOOD(F.honey), w, t.topThickness, d, 0, h - t.topThickness, 0);
  const underTop = h - t.topThickness;
  for (const [x, z] of corners(w, d, t.legInset + t.legSide / 2)) k.box(legs, t.legSide, underTop, t.legSide, x, 0, z);
  // the apron the legs are tenoned into
  const ax = w / 2 - t.apronInset - t.legSide / 2;
  const az = d / 2 - t.apronInset - t.legSide / 2;
  for (const s of [-1, 1]) {
    k.box(legs, 2 * ax, t.apronHeight, t.apronThickness, 0, underTop - t.apronHeight, s * az);
    k.box(legs, t.apronThickness, t.apronHeight, 2 * az, s * ax, underTop - t.apronHeight, 0);
  }
};

const diningTableOval: Builder = (k, { w, d, h }) => {
  const t = S.tables;
  const o = t.oval;
  // a true oval top, its edge rounded over
  k.stand(LIGHT_WOOD(F.honey), disc(w / 2, d / 2, t.topThickness, o.edgeBevel), 0, h - t.topThickness, 0);
  // a tulip pedestal, its foot stretched along the oval
  const pedestal = turned(o.pedestal, 1, h - t.topThickness, S.segments.large);
  pedestal.scale(o.pedestalStretch, 1, 1);
  k.stand(LACQUER(F.pedestal), pedestal, 0, 0, 0);
};

const desk: Builder = (k, { w, d, h }) => {
  const t = S.tables;
  const s = t.desk;
  const top = LIGHT_WOOD(F.honey);
  const body = LACQUER(F.cabinetFront);
  const steel = METAL(F.steelDeep);
  const underTop = h - t.topThickness;
  k.box(top, w, t.topThickness, d, 0, underTop, 0);
  // a drawer pedestal on the left
  const px = -w / 2 + s.pedestalWidth / 2 + C.gap;
  const bodyD = d - HANDLE_DEPTH - C.frontThickness - t.legInset;
  k.box(body, s.pedestalWidth, underTop, bodyD, px, 0, -d / 2 + bodyD / 2);
  const zFace = -d / 2 + bodyD + C.frontThickness;
  const dh = (underTop - (s.drawers + 1) * C.gap) / s.drawers;
  for (let i = 0; i < s.drawers; i++) {
    const y0 = C.gap + i * (dh + C.gap);
    front(k, body, s.pedestalWidth - 2 * C.gap, dh, px, y0, zFace);
    barHandle(k, steel, C.handle.length, px, y0 + dh - 2 * C.handle.standoff, zFace);
  }
  // steel legs on the right, a modesty panel between
  for (const z of [d / 2 - t.legInset, -d / 2 + t.legInset]) k.box(steel, s.legSide, underTop, s.legSide, w / 2 - t.legInset, 0, z);
  const panelW = w - s.pedestalWidth - t.legInset - 2 * C.gap;
  k.box(body, panelW, s.panelHeight, C.frontThickness, (w / 2 - t.legInset + (-w / 2 + s.pedestalWidth)) / 2, underTop - s.panelHeight, -d / 2 + t.legInset);
};

// ============================================================================ cabinets

interface CabinetRun {
  /** height of the cabinet's top (the piece may carry something above it) */
  top: number;
  doors: number;
  body: THREE.Material;
  fronts: THREE.Material;
  lid: THREE.Material;
  handles: THREE.Material;
  knobs?: boolean;
  /** stands on tapered legs; otherwise on a recessed plinth */
  legs?: THREE.Material;
}

/** A sideboard-like run: a carcass, a top, `doors` fronts with handles, on legs or a plinth. */
function cabinetRun(k: Kit, { w, d }: KindDef, o: CabinetRun): void {
  const foot = o.legs ? C.legHeight : C.plinth;
  const bodyD = d - HANDLE_DEPTH - C.frontThickness;
  if (o.legs) for (const [x, z] of corners(w, bodyD, C.legRadius * 3)) taperedLeg(k, o.legs, C.legRadius, foot, x, z - d / 2 + bodyD / 2);
  else k.box(o.body, w - 2 * C.plinthRecess, foot, bodyD - C.plinthRecess, 0, 0, -d / 2 + (bodyD - C.plinthRecess) / 2);
  const underTop = o.top - C.topThickness;
  k.box(o.body, w, underTop - foot, bodyD, 0, foot, -d / 2 + bodyD / 2);
  k.box(o.lid, w, C.topThickness, d, 0, underTop, 0);
  const zFace = d / 2 - HANDLE_DEPTH;
  const fh = underTop - foot - 2 * C.gap;
  const { xs, w: fw } = split(w, o.doors);
  xs.forEach((x, i) => {
    front(k, o.fronts, fw, fh, x, foot + C.gap, zFace);
    const y = foot + C.gap + fh - 3 * C.handle.standoff;
    if (o.knobs) knob(k, o.handles, x, y, zFace);
    else {
      // pairs of doors meet at their handles; a lone door takes its handle on the opening side
      const side = i % 2 === 0 ? 1 : -1;
      barHandle(k, o.handles, Math.min(C.handle.length, fw * C.handle.maxFrontFraction), x + side * (fw / 2 - C.handle.length / 2 - C.handle.standoff), y, zFace);
    }
  });
}

/** A flat screen on a foot, standing on y = base, its top at `top`. */
function television(k: Kit, w: number, base: number, top: number): void {
  const t = C.tv;
  const screenH = top - base - t.foot - t.neck;
  const screenW = Math.min(w * t.maxWidthFraction, screenH / t.screenRatio);
  const z = -t.depth;
  k.box(DARK, t.footWidth, t.foot, t.footDepth, 0, base, z);
  k.box(DARK, t.neck * t.neckWidthFraction, t.neck, t.depth, 0, base + t.foot, z - t.depth / 2);
  const y0 = base + t.foot + t.neck;
  k.panel(PLASTIC(F.chassis), screenW, screenH, t.depth, 0, y0, z, t.bezel / 2, undefined, 1);
  k.slab(SCREEN(F.screenGlow), screenW - 2 * t.bezel, screenH - 2 * t.bezel, t.screenThickness, 0, y0 + t.bezel, z + t.depth / 2 + t.screenThickness / 2, { cast: false });
}

const sideboard: Builder = (k, def) =>
  cabinetRun(k, def, { top: def.h, doors: 4, body: DARK_WOOD(F.walnutDeep), fronts: DARK_WOOD(F.walnutLight), lid: DARK_WOOD(F.walnut), handles: BRASS(), legs: DARK_WOOD(F.walnutDeep) });

const tvSideboard: Builder = (k, def) => {
  cabinetRun(k, def, { top: C.tv.sideboardTop, doors: 4, body: DARK_WOOD(F.walnutDeep), fronts: DARK_WOOD(F.walnutLight), lid: DARK_WOOD(F.walnut), handles: BRASS(), legs: DARK_WOOD(F.walnutDeep) });
  television(k, def.w, C.tv.sideboardTop, def.h);
};

// a low stand at its own height, the television on it a fitting that stands over it
const tvStand: Builder = (k, def) => {
  cabinetRun(k, def, { top: def.h, doors: 3, body: DARK_WOOD(F.walnutDeep), fronts: LACQUER(F.cabinetFront), lid: DARK_WOOD(F.walnut), handles: METAL(F.steelDeep), knobs: true, legs: DARK_WOOD(F.walnutDeep) });
  k.fittings(() => television(k, def.w, def.h, def.h + riseOf(def)));
};

const nightstand: Builder = (k, { w, d, h }) => {
  const n = C.nightstand;
  const wood = DARK_WOOD(F.walnutLight);
  const bodyD = d - C.knobDepth - C.frontThickness;
  for (const [x, z] of corners(w, bodyD, C.legRadius * 3)) taperedLeg(k, DARK_WOOD(F.walnutDeep), C.legRadius, C.legHeight, x, z - d / 2 + bodyD / 2);
  const underTop = h - C.topThickness;
  k.box(DARK_WOOD(F.walnutDeep), w, underTop - C.legHeight, bodyD, 0, C.legHeight, -d / 2 + bodyD / 2);
  k.box(wood, w, C.topThickness, d, 0, underTop, 0);
  const zFace = d / 2 - C.knobDepth;
  const fh = (underTop - C.legHeight - (n.drawers + 1) * C.gap) / n.drawers;
  for (let i = 0; i < n.drawers; i++) {
    const y0 = C.legHeight + C.gap + i * (fh + C.gap);
    front(k, wood, w - 2 * C.gap, fh, 0, y0, zFace);
    knob(k, BRASS(), 0, y0 + fh / 2, zFace);
  }
};

const wardrobe: Builder = (k, { w, d, h }) => {
  const o = C.wardrobe;
  const body = DARK_WOOD(F.walnutDeep);
  const doors = DARK_WOOD(F.walnut);
  const bodyD = d - HANDLE_DEPTH - C.frontThickness;
  k.box(body, w - 2 * C.plinthRecess, C.plinth, bodyD - C.plinthRecess, 0, 0, -d / 2 + (bodyD - C.plinthRecess) / 2);
  const underTop = h - o.cornice;
  k.box(body, w, underTop - C.plinth, bodyD, 0, C.plinth, -d / 2 + bodyD / 2);
  k.box(DARK_WOOD(F.walnutDeep), w, o.cornice, d, 0, underTop, 0);
  const zFace = d / 2 - HANDLE_DEPTH;
  const fh = underTop - C.plinth - 2 * C.gap;
  const { xs, w: fw } = split(w, o.doors);
  xs.forEach((x, i) => {
    front(k, doors, fw, fh, x, C.plinth + C.gap, zFace);
    // the doors open from the middle; the last one from its own edge
    const side = i === xs.length - 1 ? -1 : i % 2 === 0 ? 1 : -1;
    barHandle(k, CHROME(), o.handleLength, x + side * (fw / 2 - 3 * C.handle.standoff), C.plinth + fh * o.handleHeight, zFace, true);
  });
};

const bookshelf: Builder = (k, { w, d, h }) => {
  const s = S.shelves;
  const wood = WOOD(F.oak);
  const books = F.books.map((c) => PAINT(c));
  // sides, top, plinth and a thin back
  for (const side of [-1, 1]) k.box(wood, s.board, h, d, side * (w / 2 - s.board / 2), 0, 0);
  k.box(wood, w - 2 * s.board, s.board, d, 0, h - s.board, 0);
  k.box(wood, w - 2 * s.board, s.plinth, s.board, 0, 0, d / 2 - s.board / 2 - C.gap);
  k.slab(WOOD(F.oakDeep), w - 2 * s.board, h - s.plinth, s.back, 0, s.plinth, -d / 2 + s.back / 2);
  const inner = w - 2 * s.board;
  const pitch = (h - s.plinth - s.board) / s.tiers;
  let n = 0;
  for (let tier = 0; tier < s.tiers; tier++) {
    const y = s.plinth + tier * pitch;
    k.box(wood, inner, s.board, d - s.back, 0, y, s.back / 2);
    const floor = y + s.board;
    const clear = pitch - s.board;
    // a run of upright books from one side, the last leaning on them, then a lying stack
    let x = -inner / 2 + C.gap;
    // a tier with a stack keeps room for it at its far end
    const end = -inner / 2 + inner * (tier % 2 === 0 ? s.stackedFill : s.fill * (1 - s.fillJitter * jitter(tier)));
    while (x < end) {
      const t = jitter(++n);
      const bw = between(s.bookWidth, t);
      const bh = Math.min(clear - C.gap, between(s.bookHeight, jitter(n * 3)));
      const bd = between(s.bookDepth, jitter(n * 7));
      k.slab(books[n % books.length], bw, bh, bd, x + bw / 2, floor, d / 2 - bd / 2 - s.board);
      x += bw + C.gap / 2;
    }
    const lean = s.lean;
    const lh = between(s.bookHeight, jitter(tier + 50));
    k.slab(books[(n + 2) % books.length], s.bookWidth[1], lh, s.bookDepth[0], x + (lh / 2) * Math.sin(lean) + s.bookWidth[1] / 2, floor - (lh / 2) * (1 - Math.cos(lean)), d / 2 - s.bookDepth[0] / 2 - s.board, { rz: -lean });
    if (tier % 2 === 0) {
      const thick = s.bookWidth[1] * s.stackScale;
      for (let j = 0; j < s.stack; j++) {
        const bd = between(s.bookDepth, jitter(tier * 11 + j));
        const bw = between(s.bookHeight, jitter(tier * 13 + j)) * s.stackScale;
        k.slab(books[(tier + j) % books.length], bw, thick, bd, inner / 2 - bw / 2 - C.gap * 2, floor + j * thick, d / 2 - bd / 2 - s.board);
      }
    }
  }
};

// ============================================================================ beds

/**
 * A bed: the frame on its legs, the mattress, the duvet over its foot with the sheet turned down
 * over it — the bed's catalogue height is the top of that bedding — and, as fittings over it,
 * the pillows and an upholstered headboard in vertical channels.
 */
function bed(k: Kit, def: KindDef): void {
  const { w, d, h } = def;
  const b = S.beds;
  const frame = DARK_WOOD(F.walnut);
  for (const [x, z] of corners(w, d - b.headboardDepth, b.railThickness)) k.box(frame, b.railThickness, b.legHeight, b.railThickness, x, 0, z + b.headboardDepth / 2);
  k.panel(frame, w, b.railHeight, d - b.headboardDepth, 0, b.legHeight, b.headboardDepth / 2, b.frameRadius, undefined, 1);
  // the mattress takes what the bed's height leaves between the frame and the bedding's top
  const mw = w - 2 * b.railThickness;
  const md = d - b.headboardDepth - b.railThickness;
  const mBottom = b.legHeight + b.railHeight;
  const mTop = h - b.duvetThickness * b.foldRise;
  const mattress = Math.max(b.minMattress, mTop - mBottom);
  const mFront = d / 2 - b.railThickness / 2;
  k.put(cushion(mw, mattress, md, b.mattressRadius, 0), LINEN(F.mattress), 0, mBottom + mattress / 2, mFront - md / 2);
  const dw = mw + 2 * b.duvetOverhang;
  const len = md * b.duvetCoverage;
  const drop = mattress * b.duvetDrop;
  const duvetFront = mFront + b.duvetOverhang / 2;
  const top = mBottom + mattress;
  k.soft(FABRIC(F.blanket), dw, drop + b.duvetThickness, len, 0, top - drop, duvetFront - len / 2, b.duvetThickness, b.duvetThickness * b.duvetSag);
  k.soft(LINEN(F.duvetFold), dw + C.gap, drop + b.duvetThickness * b.foldRise, b.foldDepth, 0, top - drop, duvetFront - len + b.foldDepth / 2, b.duvetThickness, 0);
  k.fittings(() => {
    const pillows = w > b.doubleFrom ? 2 : 1;
    const { xs, w: pw } = split(mw - 2 * b.duvetOverhang, pillows, b.duvetOverhang * 2);
    const pz = -d / 2 + b.headboardDepth + b.pillowDepth / 2 + C.gap * b.pillowGaps;
    for (const x of xs) k.put(cushion(pw, b.pillowThickness, b.pillowDepth, b.pillowThickness * b.pillowRadiusFraction, b.pillowSag), LINEN(F.pillow), x, top + b.pillowThickness / 2 - b.pillowSag / 2, pz, { rx: -b.pillowTilt });
    const { xs: channels, w: cw } = split(w, b.channels, C.gap);
    const headboard = h + riseOf(def) - b.legHeight;
    for (const x of channels) k.panel(FABRIC(F.headboard), cw, headboard, b.headboardDepth, x, b.legHeight, -d / 2 + b.headboardDepth / 2, b.headboardDepth * b.channelRadiusFraction, undefined, 1);
  });
}

const bedDouble: Builder = bed;
const bedSingle: Builder = bed;

// ============================================================================ kitchen

interface KitchenFront {
  x: number;
  w: number;
  /** "drawers": that many stacked drawer fronts; "doors": one door with a vertical pull; "oven" */
  kind: "drawers" | "door" | "oven";
  drawers?: number;
  /** the side the door's pull is on */
  pull?: -1 | 1;
}

interface KitchenOptions {
  fronts: KitchenFront[];
  /** where a sink is let into the worktop (its centre along x) */
  sink?: number;
  /** where a hob sits on the worktop */
  hob?: number;
}

/** A run of kitchen units: plinth, carcass, fronts, a stone worktop with a sink or a hob in it. */
function kitchenRun(k: Kit, def: KindDef, o: KitchenOptions): void {
  const { w, d, h } = def;
  const kt = S.kitchen;
  // the worktop is at the unit's height; a tap stands over it as a fitting
  const top = h;
  const under = top - kt.worktopThickness;
  const carcass = PAINT(F.cabinet);
  const fronts = LACQUER(F.cabinetFront);
  const steel = METAL();
  const zFace = d / 2 - HANDLE_DEPTH - kt.carcassDepthInset;
  const bodyD = zFace - C.frontThickness + d / 2;
  k.box(PAINT(F.plinth), w, C.plinth, bodyD - C.plinthRecess, 0, 0, -d / 2 + (bodyD - C.plinthRecess) / 2);
  k.box(carcass, w, under - C.plinth, bodyD, 0, C.plinth, -d / 2 + bodyD / 2);

  // the worktop, cut for the sink and the hob: one stone plate round each cut, side by side
  const stone = STONE(F.worktop);
  const sink = kt.sink;
  const hob = kt.hob;
  const sinkZ = (d / 2 - HANDLE_DEPTH - sink.d / 2 - kt.carcassDepthInset * 2) / 2;
  const cuts: { x: number; z: number; w: number; d: number; corner: number }[] = [];
  if (o.sink !== undefined) cuts.push({ x: o.sink, z: sinkZ, ...sink });
  if (o.hob !== undefined) cuts.push({ x: o.hob, z: 0, ...hob });
  cuts.sort((a, b) => a.x - b.x);
  if (cuts.length === 0) k.box(stone, w, kt.worktopThickness, d, 0, under, 0);
  cuts.forEach((cut, i) => {
    const x0 = i === 0 ? -w / 2 : (cuts[i - 1].x + cut.x) / 2;
    const x1 = i === cuts.length - 1 ? w / 2 : (cut.x + cuts[i + 1].x) / 2;
    const hole = rectOutline(cut.w, cut.d, cut.corner, cut.x, cut.z);
    k.stand(stone, plate(rectOutline(x1 - x0, d, 0, (x0 + x1) / 2, 0), kt.worktopThickness, hole, [cut.x, cut.z]), 0, under, 0);
  });

  if (o.sink !== undefined) {
    // a deep steel bowl under the cut, and a gooseneck tap behind it
    const bowl = METAL(F.steelDeep);
    const walls = plate(rectOutline(sink.w - C.gap / 2, sink.d - C.gap / 2, sink.corner), sink.depth, rectOutline(sink.w - 2 * sink.wall, sink.d - 2 * sink.wall, sink.corner - sink.wall));
    k.stand(bowl, walls, o.sink, top - sink.depth, sinkZ);
    k.slab(bowl, sink.w - 2 * sink.wall, sink.wall, sink.d - 2 * sink.wall, o.sink, top - sink.depth, sinkZ);
    const t = kt.tap;
    const tz = sinkZ - sink.d / 2 - t.base * t.setBack;
    const arc = t.reach / 2;
    const sinkTop = o.sink;
    k.fittings(() => {
      const column = h + riseOf(def) - top - arc - t.radius;
      k.cyl(CHROME(), t.base, t.base, sinkTop, top, tz, S.segments.small);
      k.cyl(CHROME(), t.radius, column, sinkTop, top, tz, S.segments.small);
      k.put(new THREE.TorusGeometry(arc, t.radius, S.segments.leg, S.segments.small, Math.PI), CHROME(), sinkTop, top + column, tz + arc, { ry: Math.PI / 2 });
    });
  }
  if (o.hob !== undefined) {
    // a flush glass-ceramic hob let into the cut, its rings printed a hair proud of the glass
    const glassTop = top - 2 * hob.ring.lift;
    k.slab(surf("ceramic", F.hobGlass), hob.w - C.gap / 2, hob.thickness, hob.d - C.gap / 2, o.hob, glassTop - hob.thickness, 0);
    for (const [x, z] of corners(hob.w, hob.d, hob.d * hob.ringInsetFraction)) {
      // printed on the glass: a flat ring facing up, round enough to read as a circle
      const ring = new THREE.RingGeometry(hob.ring.inner, hob.ring.outer, S.segments.ring);
      ring.rotateX(-Math.PI / 2);
      k.stand(PLASTIC(F.burner), ring, o.hob + x, glassTop + hob.ring.lift, z, { cast: false });
    }
  }

  // the fronts and their pulls
  const fy = C.plinth + C.gap;
  const fh = under - C.plinth - 2 * C.gap;
  for (const f of o.fronts) {
    if (f.kind === "drawers") {
      const n = f.drawers ?? 1;
      const dh = (fh - (n - 1) * C.gap) / n;
      for (let i = 0; i < n; i++) {
        const y0 = fy + i * (dh + C.gap);
        front(k, fronts, f.w, dh, f.x, y0, zFace);
        barHandle(k, steel, Math.min(f.w * C.handle.maxFrontFraction, C.handle.length * C.handle.drawerLengths), f.x, y0 + dh - 3 * C.handle.standoff, zFace);
      }
    } else if (f.kind === "door") {
      front(k, fronts, f.w, fh, f.x, fy, zFace);
      barHandle(k, steel, C.handle.length, f.x + (f.pull ?? 1) * (f.w / 2 - 3 * C.handle.standoff), fy + fh - C.handle.length, zFace, true);
    } else {
      // an oven: a steel control strip with knobs, a door with a dark window, a bar handle
      const ov = kt.oven;
      const strip = ov.strip;
      const door = fh - strip - C.gap;
      front(k, METAL(F.steelDeep), f.w, door, f.x, fy, zFace);
      k.slab(SCREEN(F.ovenGlass), f.w - 2 * ov.windowInset, door - 3 * ov.windowInset, C.gap, f.x, fy + ov.windowInset, zFace + C.gap / 2);
      barHandle(k, steel, f.w - 2 * ov.windowInset, f.x, fy + door - ov.handleDrop, zFace);
      front(k, METAL(F.steel), f.w, strip, f.x, fy + door + C.gap, zFace);
      for (let i = 0; i < ov.knobs; i++) knob(k, METAL(F.steelDeep), f.x - f.w / 2 + ((i + 0.5) * f.w) / ov.knobs, fy + door + C.gap + strip / 2, zFace);
    }
  }
}

/** The fronts of `n` equal doors across a unit, their pulls meeting in pairs. */
const doors = (w: number, n: number): KitchenFront[] => {
  const { xs, w: fw } = split(w, n);
  return xs.map((x, i) => ({ x, w: fw, kind: "door", pull: i % 2 === 0 ? 1 : -1 }));
};

const kitchenCounter: Builder = (k, def) =>
  kitchenRun(k, def, { fronts: doors(def.w, 4), sink: -def.w / 4, hob: def.w / 4 });

const counterUnit: Builder = (k, def) => {
  const { xs, w } = split(def.w, 1);
  kitchenRun(k, def, { fronts: [{ x: xs[0], w, kind: "drawers", drawers: 3 }] });
};

const kitchenSinkUnit: Builder = (k, def) => kitchenRun(k, def, { fronts: doors(def.w, 2), sink: 0 });

const kitchenHobUnit: Builder = (k, def) => {
  const { xs, w } = split(def.w, 1);
  kitchenRun(k, def, { fronts: [{ x: xs[0], w, kind: "oven" }], hob: 0 });
};

const fridge: Builder = (k, { w, d, h }) => {
  const f = S.fridge;
  const doorFace = METAL(F.steelFace);
  const handle = METAL(F.steelDeep);
  const zFace = d / 2 - HANDLE_DEPTH;
  const bodyD = zFace - f.doorThickness + d / 2;
  k.box(PAINT(F.steelDeep), w - 2 * C.plinthRecess, f.plinth, bodyD - C.plinthRecess, 0, 0, -d / 2 + (bodyD - C.plinthRecess) / 2);
  k.box(METAL(F.steelBody), w, h - f.plinth - f.cap, bodyD, 0, f.plinth, -d / 2 + bodyD / 2);
  k.box(METAL(F.steel), w, f.cap, bodyD, 0, h - f.cap, -d / 2 + bodyD / 2);
  // a tall fridge door under a freezer door, a gasket showing round each
  const span = h - f.plinth - f.cap - 3 * f.gap;
  const lower = span * (1 - f.split);
  const upper = span * f.split;
  for (const [dh, y0] of [
    [lower, f.plinth + f.gap],
    [upper, f.plinth + 2 * f.gap + lower],
  ]) {
    k.panel(doorFace, w - 2 * f.gap, dh, f.doorThickness, 0, y0, zFace - f.doorThickness / 2, f.radius, undefined, 1);
    k.slab(PLASTIC(F.gasket), w - 4 * f.gap, dh - 2 * f.gap, f.gap, 0, y0 + f.gap, zFace - f.doorThickness - f.gap / 2);
    barHandle(k, handle, dh * f.pullFraction, w / 2 - 4 * C.handle.standoff, y0 + dh / 2, zFace, true);
  }
  k.slab(SCREEN(F.display), w * f.display.widthFraction, f.display.height, C.gap / 2, -w / 4, h - f.cap - 3 * f.gap - upper * f.display.dropFraction, zFace + C.gap / 4);
};

// ============================================================================ bathroom

/** A deck mixer: a short chrome column and a spout reaching toward +x (turned by ry). */
function deckTap(k: Kit, x: number, y: number, z: number, top: number, ry = 0): void {
  const t = S.bath.tap;
  k.cyl(CHROME(), t.radius, top - y, x, y, z, S.segments.small);
  const dir = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
  const yTop = top - t.radius;
  k.rod(CHROME(), t.radius * t.spoutFraction, { x, y: yTop, z }, { x: x + dir.x * t.reach, y: yTop, z: z + dir.z * t.reach });
}

/** A bath shell from an outline: rim, walls and floor, the water inside, a mixer on the rim. */
function bathShell(k: Kit, outer: Outline, inner: Outline, centre: readonly [number, number], at: { x: number; z: number }): void {
  const b = S.bath;
  k.stand(CERAMIC(F.porcelain), plate(outer, b.rimHeight, inner, centre), at.x, 0, at.z);
  k.stand(CERAMIC(F.porcelainBowl), plate(inner, b.floor), at.x, 0, at.z);
  k.stand(WATER, plate(inner, C.gap), at.x, b.floor + b.waterDepth, at.z, { cast: false });
}

const bathtub: Builder = (k, { w, d, h }) => {
  const b = S.bath;
  bathShell(k, rectOutline(w, d, b.corner), rectOutline(w - 2 * b.rim, d - 2 * b.rim, b.corner - b.rim), [0, 0], { x: 0, z: 0 });
  deckTap(k, -w / 2 + b.rim / 2, b.rimHeight, 0, h);
};

const cornerBath: Builder = (k, { w, d, h }) => {
  const b = S.bath;
  const R = Math.min(w, d);
  // a quarter round with its flat backs against the walls (-x and -z)
  const middle = R * b.cornerMiddle;
  bathShell(k, quarterOutline(R, 0, S.segments.quarter), quarterOutline(R - b.rim, b.rim, S.segments.quarter), [middle, middle], { x: -w / 2, z: -d / 2 });
  deckTap(k, -w / 2 + R * b.cornerTapAt, b.rimHeight, -d / 2 + b.rim / 2, h, -Math.PI / 2);
};

const shower: Builder = (k, { w, d, h }) => {
  const s = S.bath.shower;
  const tile = CERAMIC(F.showerTile);
  k.panel(CERAMIC(F.porcelain), w, s.tray, d, 0, 0, 0, s.tray / 3, undefined, 1);
  k.cyl(CHROME(), s.head / 2, C.gap, 0, s.tray, 0, S.segments.medium);
  // the tiled walls on two sides, glass on the other two in a slim chrome frame
  k.box(tile, s.wall, h - s.tray, d, -w / 2 + s.wall / 2, s.tray, 0);
  k.box(tile, w - s.wall, h - s.tray, s.wall, s.wall / 2, s.tray, -d / 2 + s.wall / 2);
  const glassH = h - s.tray - s.frame;
  k.slab(PANE, w - s.wall - s.frame, glassH, s.glass, (s.wall - s.frame) / 2, s.tray, d / 2 - s.frame / 2, { cast: false });
  k.slab(PANE, s.glass, glassH, d - s.wall - s.frame, w / 2 - s.frame / 2, s.tray, (s.wall - s.frame) / 2, { cast: false });
  const chrome = CHROME();
  k.box(chrome, w - s.wall, s.frame, s.frame, s.wall / 2, h - s.frame, d / 2 - s.frame / 2);
  k.box(chrome, s.frame, s.frame, d - s.wall, w / 2 - s.frame / 2, h - s.frame, s.wall / 2);
  k.box(chrome, s.frame, h - s.tray, s.frame, w / 2 - s.frame / 2, s.tray, d / 2 - s.frame / 2);
  // a riser rail with the head on an arm, and the mixer below it
  const rx = -w / 2 + s.wall + 2 * s.frame;
  const rz = -d / 2 + s.wall + 2 * s.frame;
  const railTop = h * s.railTo;
  const arm = s.head * s.armReach;
  k.rod(chrome, s.frame / 2, { x: rx, y: h * s.railFrom, z: rz }, { x: rx, y: railTop, z: rz });
  k.rod(chrome, s.frame / 2, { x: rx, y: railTop, z: rz }, { x: rx + arm, y: railTop, z: rz + arm });
  k.stand(chrome, lathe([[0, 0], [s.head, s.frame / 2], [s.head, s.frame], [0, s.frame * 1.5]], S.segments.medium), rx + arm, railTop - s.frame * 1.5, rz + arm);
  k.cyl(chrome, s.head / 2, s.frame * 2, rx, h * s.mixerAt, -d / 2 + s.wall, S.segments.medium, s.head / 2, { rx: Math.PI / 2 });
};

const toilet: Builder = (k, { w, d, h }) => {
  const t = S.bath.toilet;
  const cer = CERAMIC();
  const bowlR = t.bowl.at(-1)![0];
  const bowl = turned(t.bowl, 1, t.bowlHeight, S.segments.medium);
  bowl.scale(w / 2 / bowlR, 1, t.bowlDepth / 2 / bowlR);
  const bz = d / 2 - t.bowlDepth / 2;
  k.stand(cer, bowl, 0, 0, bz);
  // the seat ring and the closed lid on the bowl's rim
  const seat = new THREE.TorusGeometry(bowlR * t.seatFraction, t.seatThickness / 2, S.segments.leg, S.segments.medium);
  seat.rotateX(Math.PI / 2);
  seat.scale(w / 2 / bowlR, 1, t.bowlDepth / 2 / bowlR);
  k.put(seat, CERAMIC(F.porcelainBowl), 0, t.bowlHeight + t.seatThickness / 2, bz);
  k.stand(cer, disc((w / 2) * t.lidFraction, (t.bowlDepth / 2) * t.lidFraction, t.seatThickness, t.seatThickness / 3, S.segments.medium), 0, t.bowlHeight + t.seatThickness, bz);
  // the cistern behind, its flush button on top at the piece's height
  const button = t.button;
  const cisternBottom = h - button - t.cisternHeight;
  k.panel(cer, w * t.cisternWidthFraction, t.cisternHeight, t.cisternDepth, 0, cisternBottom, -d / 2 + t.cisternDepth / 2, t.cisternDepth * t.cisternRadiusFraction, undefined, 1);
  // the trap that joins the bowl to the wall under the cistern
  const back = -d / 2 + t.cisternDepth * t.trapBackFraction;
  k.box(cer, w * t.trapWidthFraction, cisternBottom, bz - back, 0, 0, (back + bz) / 2);
  k.cyl(CHROME(), t.cisternDepth * t.buttonFraction, button, 0, h - button, -d / 2 + t.cisternDepth / 2, S.segments.small);
};

const sink: Builder = (k, { w, d, h }) => {
  const b = S.bath.basin;
  const cer = CERAMIC(F.porcelain);
  // a deck with an oval cut, a hollow bowl under the cut, a turned pedestal under the bowl
  const rx = w / 2 - b.deck;
  const rz = d / 2 - b.deck - b.tapDeck / 2;
  const bz = b.tapDeck / 2;
  k.stand(cer, plate(rectOutline(w, d, b.deck), b.deckThickness, ellipseOutline(rx, rz, 0, bz, S.segments.outline / 2), [0, bz]), 0, b.rim - b.deckThickness, 0);
  const wall = b.wall;
  const bowl = lathe(
    [
      [0, -b.bowlDepth - wall],
      [rx * b.bowlFloorFraction, -b.bowlDepth - wall],
      [rx * b.bowlBellyFraction, -b.bowlDepth * b.bowlBellyDepth],
      [rx, 0],
      [rx - wall, 0],
      [rx * b.bowlBellyFraction - wall, -b.bowlDepth * b.bowlBellyDepth + wall / 2],
      [rx * b.bowlFloorFraction, -b.bowlDepth],
      [0, -b.bowlDepth],
    ],
    S.segments.medium,
  );
  bowl.scale(1, 1, rz / rx);
  k.stand(CERAMIC(F.porcelainBowl), bowl, 0, b.rim - C.gap / 4, bz);
  const columnH = b.rim - b.bowlDepth - wall;
  k.stand(cer, turned(b.column, 1, columnH, S.segments.medium), 0, 0, bz);
  deckTap(k, 0, b.rim, -d / 2 + b.tapDeck / 2 + b.deck / 2, h, -Math.PI / 2);
};

const towelRail: Builder = (k, { w, d, h }) => {
  const r = S.bath.rail;
  const chrome = CHROME();
  // a heated ladder rail: two uprights into the floor, rungs between, stand-offs to the wall
  const z = -d / 2 + r.standoff + r.tube;
  const ux = w / 2 - r.tube;
  for (const x of [-ux, ux]) {
    k.cyl(chrome, r.tube, h - r.tube, x, 0, z, S.segments.leg);
    k.put(new THREE.SphereGeometry(r.tube, S.segments.leg, Math.round(S.segments.leg * S.segments.sphereRings)), chrome, x, h - r.tube, z);
    for (const at of r.stays) k.rod(chrome, r.tube * r.stayFraction, { x, y: h * at, z: -d / 2 }, { x, y: h * at, z }, S.segments.leg);
  }
  const rungs: number[] = [];
  for (let i = 0; i < r.bars; i++) rungs.push(h * (r.rungFrom + ((r.rungTo - r.rungFrom) * i) / (r.bars - 1)));
  for (const y of rungs) k.rod(chrome, r.tube * r.rungFraction, { x: -ux, y, z }, { x: ux, y, z }, S.segments.leg);
  // two towels folded over the rungs, hanging to the front
  const tints: readonly Swatch[] = [F.towel, F.towelDeep];
  const towels = r.towels.map((t, i) => [tints[i % tints.length], w * t.at, w * t.width, rungs[r.bars - t.rung]] as const);
  for (const [tint, x, tw, top] of towels) {
    const depth = d / 2 - (z - r.tube - r.towel);
    const drop = top * r.towelDrop;
    k.soft(FABRIC(tint), tw, drop, depth, x, top - drop + r.tube + r.towel, z - r.tube - r.towel + depth / 2, r.towel * 2, 0);
  }
};

// ============================================================================ decor

const rug: Builder = (k, { w, d, h }) => {
  const r = S.rug;
  const flat = { cast: false };
  const body = w - 2 * r.fringe;
  k.slab(FABRIC(F.rug), body, h - C.gap / 2, d, 0, 0, 0, flat);
  k.slab(FABRIC(F.rugField), body - 2 * r.border, h, d - 2 * r.border, 0, 0, 0, flat);
  // the cotton fringe at each short end: one band of fine strands (the linen's weave), the whole width
  const fringe = LINEN(F.rugFringe);
  for (const side of [-1, 1]) k.slab(fringe, r.fringe, r.fringeThickness, d, side * (body / 2 + r.fringe / 2), 0, 0, flat);
};

const plant: Builder = (k, { w, d, h }) => {
  const p = S.plant;
  const potR = (Math.min(w, d) / 2) * p.potRadiusFraction;
  k.stand(surf("terracotta", F.pot), turned(p.pot, potR, p.potHeight, S.segments.medium), 0, 0, 0);
  k.cyl(PAINT(F.soil), potR * p.soilFraction, C.gap, 0, p.potHeight * p.soilLevel, 0, S.segments.medium);
  k.cyl(WOOD(F.stem), p.stem, h * p.stemHeight, 0, p.potHeight * p.soilLevel, 0, S.segments.leg, p.stem * p.stemTaper);
  // leaves on short stalks, spiralling up the stem by the golden angle, longest at the bottom
  const leaves = [surf("foliage", F.leaf), surf("foliage", F.leafLight)];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const reach = Math.min(w, d) / 2;
  for (let i = 0; i < p.leaves; i++) {
    const t = i / (p.leaves - 1);
    const a = i * golden;
    const length = p.leafLength * (1 - p.leafShrink * t);
    const pitch = p.leafPitch + p.leafPitchRise * t + p.leafPitchJitter * jitter(i);
    const leaf = new THREE.SphereGeometry(1, S.segments.leg, S.segments.leg - 3);
    leaf.scale(p.leafWidth / 2, p.leafThickness / 2, length / 2);
    leaf.translate(0, 0, length / 2);
    const y = p.potHeight + (h - p.potHeight - length * Math.sin(pitch)) * (p.leafStart + (1 - p.leafStart) * t);
    const base = Math.max(0, reach - length * Math.cos(pitch)) * p.leafReach;
    k.put(leaf, leaves[i % 2], Math.sin(a) * base, y, Math.cos(a) * base, { ry: a, rx: -pitch, order: "YXZ" });
  }
};

const floorLamp: Builder = (k, { w, d, h }) => {
  const l = S.lamp;
  const r = Math.min(w, d) / 2;
  const metal = METAL(F.steelDeep);
  k.stand(metal, lathe(l.base.map(([fr, fh]) => [r * fr, l.baseThickness * fh]), S.segments.medium), 0, 0, 0);
  const shadeBottom = h - l.shadeHeight;
  k.cyl(BRASS(), l.stemRadius, shadeBottom + l.shadeHeight * l.stemInto - l.baseThickness, 0, l.baseThickness, 0, S.segments.leg, l.stemRadius * l.stemTaper);
  k.put(new THREE.SphereGeometry(l.bulb, S.segments.small, S.segments.leg), SCREEN(F.bulb), 0, shadeBottom + l.shadeHeight * l.bulbAt, 0, { cast: false });
  // a drum shade, open top and bottom, with a wall you can see both sides of
  const top = r * l.shadeTopFraction;
  const t = l.shadeWall;
  k.stand(
    LINEN(F.lampShade),
    lathe([[r - t, 0], [r, 0], [top, l.shadeHeight], [top - t, l.shadeHeight], [r - t, 0]], S.segments.large),
    0,
    shadeBottom,
    0,
  );
};

/** A side profile ([along the car, up] points, convex) extruded `width` across, centred on x = 0: a car's body or its glasshouse. */
function sideways(profile: Outline, width: number): THREE.BufferGeometry {
  // plate() extrudes an [x, z] outline up y: turned so its outline is the car's (z, y) and it runs along x
  return plate(profile, width).applyMatrix4(new THREE.Matrix4().set(0, 1, 0, -width / 2, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
}

/**
 * The car, a reference object, low-poly: its body and its glasshouse are side profiles extruded
 * across it (shares of its length and height: a bonnet sloping to the nose, a windscreen and a
 * rear window raked back to the roof), its roof a panel over the glass, pillars in its paint
 * either side between the windscreen, the side windows and the rear window, its four wheels proud
 * of the body's sides with a hub on each, a lamp each side of its nose and a tail lamp each side
 * of its back. It faces +z.
 */
const car: Builder = (k, { w, d, h, color }) => {
  const c = S.car;
  const paint = LACQUER(color);
  const half = d / 2;
  const at = (points: readonly (readonly [number, number])[]): Outline => points.map(([z, y]) => [z * half, y * h] as const);
  const body = w - 2 * c.wheelProud;
  k.stand(paint, sideways(at(c.body), body), 0, 0, 0);
  const cabin = body * c.cabinWidthFraction;
  k.stand(GLAZING, sideways(at(c.glass), cabin), 0, 0, 0);
  // the pillars, each side: up the windscreen's edge (A), across the side windows (B), down the rear window's (C)
  const [rearFoot, noseFoot, noseTop, rearTop] = c.glass;
  const pw = c.pillarWidth;
  const strips: (readonly (readonly [number, number])[])[] = [
    [noseFoot, noseTop, [noseTop[0] - pw, noseTop[1]], [noseFoot[0] - pw, noseFoot[1]]],
    [[c.pillarB - pw / 2, noseFoot[1]], [c.pillarB + pw / 2, noseFoot[1]], [c.pillarB + pw / 2, noseTop[1]], [c.pillarB - pw / 2, noseTop[1]]],
    [rearFoot, [rearFoot[0] + pw, rearFoot[1]], [rearTop[0] + pw, rearTop[1]], rearTop],
  ];
  for (const strip of strips) {
    const pillar = sideways(at(strip), c.pillarProud);
    for (const side of [-1, 1]) k.stand(paint, pillar.clone(), side * (cabin / 2 + c.pillarProud / 2), 0, 0);
    pillar.dispose();
  }
  // the roof over the glass, wider than it, its top the car's
  const [r0, r1] = c.roof;
  k.box(paint, cabin + 2 * c.roofOverhang, c.roofThickness, (r1 - r0) * half, 0, h - c.roofThickness, ((r0 + r1) / 2) * half);
  // the wheels, axles across the car, their tyres proud of its sides, a hub standing out of each
  const wx = w / 2 - c.hubProud - c.wheelWidth / 2;
  for (const z of [-c.axleFraction * half, c.axleFraction * half]) {
    for (const side of [-1, 1]) {
      k.cyl(DARK, c.wheelRadius, c.wheelWidth, side * wx, c.wheelRadius - c.wheelWidth / 2, z, S.segments.medium, c.wheelRadius, { rz: Math.PI / 2 });
      k.cyl(METAL(F.steel), c.hubRadius, c.hubDepth, side * (w / 2 - c.hubDepth / 2), c.wheelRadius - c.hubDepth / 2, z, S.segments.small, c.hubRadius, { rz: Math.PI / 2 });
    }
  }
  // the lamps either side of the nose, and the tail lamps the same either side of its back
  const [lw, lh, ly] = c.lamp;
  for (const side of [-1, 1]) {
    const x = side * (body / 2 - (lw * body) / 2 - c.lampInset);
    k.slab(CERAMIC(F.porcelain), lw * body, lh * h, c.lampDepth, x, ly * h, half - c.lampDepth / 2);
    k.slab(CERAMIC(F.carTailLamp), lw * body, lh * h, c.lampDepth, x, ly * h, -half + c.lampDepth / 2);
  }
};

export const FURNITURE_BUILDERS: Record<string, Builder> = {
  sofa,
  sofa_3: sofa3,
  armchair,
  coffee_table: coffeeTable,
  side_table: sideTable,
  sideboard,
  tv_sideboard: tvSideboard,
  tv_stand: tvStand,
  bookshelf,
  rug,
  bed_double: bedDouble,
  bed_single: bedSingle,
  nightstand,
  wardrobe,
  desk,
  office_chair: officeChair,
  dining_table: diningTable,
  dining_table_oval: diningTableOval,
  dining_chair: diningChair,
  kitchen_counter: kitchenCounter,
  counter_unit: counterUnit,
  kitchen_sink_unit: kitchenSinkUnit,
  kitchen_hob_unit: kitchenHobUnit,
  fridge,
  bathtub,
  corner_bath: cornerBath,
  shower,
  toilet,
  sink,
  towel_rail: towelRail,
  plant,
  floor_lamp: floorLamp,
  car,
};

/**
 * An agent-authored piece, from the parts its definition carries. Local frame matches every
 * other builder: width along +x, depth along +z, y measured up from the floor, front facing +z.
 * A part is drawn with the surface its `material` names (a matte paint without one), in its
 * colour; a part that names a material but no colour takes the surface's own. A soft surface
 * (fabric, linen, leather) gets rounded edges, a hard one a small bevel, like the built-ins.
 */
function buildCustom(k: Kit, parts: readonly PartSpec[], fallbackColor: string): void {
  const P = S.parts;
  for (const part of parts) {
    const w = Math.max(P.minSize, part.w ?? P.defaultSize);
    const h = Math.max(P.minSize, part.h ?? P.defaultSize);
    const d = Math.max(P.minSize, part.d ?? P.defaultSize);
    const name = partSurface(part.material);
    const m = surf(name, part.color ?? (part.material ? undefined : fallbackColor));
    let geometry: THREE.BufferGeometry;
    if (part.shape === "cylinder") {
      geometry = new THREE.CylinderGeometry(w / 2, w / 2, h, P.roundSegments);
      geometry.scale(1, 1, d / w); // an ellipse when depth differs from width
    } else if (part.shape === "sphere") {
      geometry = new THREE.SphereGeometry(w / 2, P.sphereSegments, Math.round(P.sphereSegments * S.segments.sphereRings));
      geometry.scale(1, h / w, d / w);
    } else {
      geometry = SOFT_SURFACES.has(name) ? cushion(w, h, d, P.softRadius) : hardBox(w, h, d, P.hardRadius);
    }
    k.put(geometry, m, part.x ?? 0, (part.y ?? 0) + h / 2, part.z ?? 0, { ry: ((part.rotation ?? 0) * Math.PI) / 180 });
  }
}

/** Surfaces a part is upholstered in rather than made of. */
const SOFT_SURFACES: ReadonlySet<SurfaceName> = new Set(["fabric", "linen", "leather"]);

/** A kind with neither a builder nor parts (an imported partner product): blocked out from its box. */
function genericPiece(k: Kit, { w, d, h, color }: KindDef): void {
  const g = S.generic;
  const top = h * g.topFraction;
  k.box(DARK, w - 2 * g.plinthInset, g.plinth, d - 2 * g.plinthInset, 0, 0, 0);
  k.panel(PAINT(color), w, h - g.plinth - top, d, 0, g.plinth, 0, g.radius, undefined, 1);
  k.box(LACQUER(color), w, top, d, 0, h - top, 0);
}

// ============================================================================ shared geometry

/**
 * One mesh of a definition's model: its shared geometry and what it is drawn with — a named
 * surface in a tint (each piece takes that material from the cache it is built for) or one of
 * the static materials every piece shares.
 */
interface Entry {
  readonly geometry: THREE.BufferGeometry;
  readonly look: Look | THREE.Material;
  readonly cast: boolean;
  /** an agent's part keeps its own transform; a baked built-in has none */
  readonly matrix?: THREE.Matrix4;
}

interface Template {
  readonly entries: readonly Entry[];
  /** the scale the design took to fill its catalogue box, per axis (1 when it already did) */
  readonly fit: readonly [number, number, number];
  /** the size of the piece's body after the fit (its fittings left out): its catalogue box */
  readonly body: readonly [number, number, number];
}

/** What a kit part is drawn with, kept past the build: its look, or the static material itself. */
const lookOf = (material: THREE.Material): Look | THREE.Material => looks.get(material) ?? material;

const templates = new Map<string, Template>();
/** How many live meshes draw each shared geometry. */
const users = new Map<THREE.BufferGeometry, number>();

/**
 * A geometry shared by every piece of its definition: disposing it (disposeObject does, once
 * per mesh that draws it) frees it only when no piece draws it any more, and the definition's
 * model is made afresh on its next build.
 */
function share(geometry: THREE.BufferGeometry, key: string): THREE.BufferGeometry {
  geometry.dispose = () => {
    const left = (users.get(geometry) ?? 0) - 1;
    if (left > 0) {
      users.set(geometry, left);
      return;
    }
    users.delete(geometry);
    templates.delete(key);
    THREE.BufferGeometry.prototype.dispose.call(geometry);
  };
  return geometry;
}

/** The key a definition's model is shared under: everything its geometry and surfaces come from. */
function templateKey(def: KindDef): string {
  if (def.parts && def.parts.length > 0) return `parts|${def.color}|${JSON.stringify(def.parts)}`;
  const shape = `${def.w}|${def.d}|${def.h}`;
  return def.source === "builtin" && FURNITURE_BUILDERS[def.kind] ? `builtin|${def.kind}|${shape}` : `generic|${def.color}|${shape}`;
}

/**
 * The box a built-in's design is fitted to its catalogue box by: all of its parts across (its
 * fittings stand inside its footprint), its body alone in height (its fittings may stand over it).
 */
function fitBounds(parts: readonly KitPart[]): THREE.Box3 {
  const all = new THREE.Box3();
  const body = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of parts) {
    // the corners as placed (a turned part's box, turned, would stand wider than the part)
    const position = p.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(p.matrix);
      all.expandByPoint(v);
      if (!p.fitting) body.expandByPoint(v);
    }
  }
  if (!body.isEmpty()) all.max.y = body.max.y;
  return all;
}

/** Bake a built-in's parts to one geometry per surface (and shadow casting), fitted to its box. */
function bake(k: Kit, def: KindDef, key: string): Template {
  const bounds = fitBounds(k.parts);
  const groups = new Map<THREE.Material, Map<boolean, KitPart[]>>();
  for (const part of k.parts) {
    const byCast = groups.get(part.material) ?? new Map<boolean, KitPart[]>();
    groups.set(part.material, byCast);
    byCast.set(part.cast, [...(byCast.get(part.cast) ?? []), part]);
  }
  const entries: { geometry: THREE.BufferGeometry; material: THREE.Material; cast: boolean }[] = [];
  for (const [material, byCast] of groups) {
    for (const [cast, parts] of byCast) entries.push({ geometry: mergePlaced(parts), material, cast });
  }
  for (const part of k.parts) part.geometry.dispose();
  const fit = fitToBox(
    entries.map((e) => e.geometry),
    def.w,
    def.h,
    def.d,
    bounds,
  );
  const body: [number, number, number] = [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z].map((s, i) => s * fit[i]) as [number, number, number];
  return { entries: entries.map((e) => ({ geometry: share(e.geometry, key), look: lookOf(e.material), cast: e.cast })), fit, body };
}

/** An agent's parts, one mesh each, kept as they were placed. */
function keepParts(k: Kit, key: string, def: KindDef): Template {
  return {
    entries: k.parts.map((p) => ({ geometry: share(p.geometry, key), look: lookOf(p.material), cast: p.cast, matrix: p.matrix })),
    fit: [1, 1, 1],
    body: [def.w, def.h, def.d],
  };
}

/**
 * Give a model's patterned surfaces texture coordinates in metres, as its pieces will stand,
 * drawn for the purpose with the modelling materials (the surfaces carry the pattern's repeat).
 */
function project(template: Template, cache: MaterialCache): void {
  const root = new THREE.Group();
  for (const e of template.entries) {
    const material = e.look instanceof THREE.Material ? e.look : surface(e.look.name, e.look.tint, cache, false);
    const mesh = new THREE.Mesh(e.geometry, material);
    if (e.matrix) e.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    root.add(mesh);
  }
  projectSurfaceUVs(root);
}

function templateFor(def: KindDef): Template {
  const key = templateKey(def);
  const hit = templates.get(key);
  if (hit) return hit;
  // the materials this build models with live only as long as the build
  const cache = (modelling = new MaterialCache());
  try {
    const k = new Kit();
    let template: Template;
    if (def.parts && def.parts.length > 0) {
      buildCustom(k, def.parts, def.color);
      template = keepParts(k, key, def);
    } else {
      const builder = def.source === "builtin" ? FURNITURE_BUILDERS[def.kind] : undefined;
      if (builder) builder(k, def);
      else genericPiece(k, def);
      template = bake(k, def, key);
    }
    // grain and weave at their size in metres, continuous from part to part
    project(template, cache);
    templates.set(key, template);
    return template;
  } finally {
    modelling = null;
    cache.dispose();
  }
}

/** How a piece is drawn: its surfaces with their patterns (the 3D view), or plain (a thumbnail). */
export interface BuildOptions {
  readonly patterns?: boolean;
}

/**
 * The 3D piece for one catalogue definition. With `materials`, its surfaces come from that
 * cache — retain the piece there while it is shown, and release it when it goes. Its geometries
 * are shared with every other piece of the same definition: never change them in place.
 */
export function buildFurniture(def: KindDef, materials?: MaterialCache, { patterns = true }: BuildOptions = {}): THREE.Group {
  const template = templateFor(def);
  const cache = materials ?? null;
  const piece = new THREE.Group();
  piece.name = `furniture:${def.kind}`;
  piece.userData.kind = def.kind;
  piece.userData.fit = template.fit;
  piece.userData.body = template.body;
  for (const e of template.entries) {
    const material = e.look instanceof THREE.Material ? e.look : surface(e.look.name, e.look.tint, cache, patterns);
    const mesh = new THREE.Mesh(e.geometry, material);
    if (e.matrix) e.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = true;
    users.set(e.geometry, (users.get(e.geometry) ?? 0) + 1);
    piece.add(mesh);
  }
  return piece;
}

/** How many definitions' models are shared right now (one per definition some piece draws). */
export const sharedModelCount = (): number => templates.size;

/** Triangles a built piece draws. */
export function pieceTriangles(piece: THREE.Object3D): number {
  let count = 0;
  piece.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) count += triangleCount(mesh.geometry);
  });
  return count;
}
