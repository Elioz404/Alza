/**
 * 3D builder — extrudes the plan into a dollhouse-style model:
 * walls with REAL openings (lintels + sills, no CSG), resolved corner joints,
 * per-room floors with finishes, ground plane.
 *
 * Each function here builds one piece of the plan from plain data and touches nothing else, so
 * the scene (planScene.ts) can rebuild exactly the pieces a change affects. What a piece
 * depends on beyond its own entity — a wall's joints with its neighbours, whether a window has
 * room for curtains — is computed here too, from the whole plan, and handed to the builder.
 *
 * The materials below are static (materials.ts): every wall shares them and they are never
 * disposed with a piece. They are named surfaces (surfaces.ts) in the tokens' colours, so a
 * door frame has the same wood grain as a bookshelf. A floor draws with its finish's shared
 * surface from the scene's cache; its texture coordinates are plan metres, so every room's
 * planks and tiles continue one pattern, the plan's.
 */

import * as THREE from "three";
import type { Item, Opening, PlanModel, Room, Wall } from "../model/types";
import { catalogOf, type Catalog } from "../model/catalog";
import { segLen } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { DOUBLE_DOOR_CLEAR, WALL_DEFAULTS, type FloorFinish } from "../model/limits";
import { keepStatic, type MaterialCache } from "./materials";
import { CONTACT, CUTAWAY, FLOOR_TOP, LIGHTS, PENDANT, SCENE } from "./config";
import { createSurfaceMaterial, ninePatch, projectSurfaceUVs, staticSurface, surface, type SurfaceName } from "./surfaces";
import { CUT_CAP, POCHE, clipToCut } from "./cutaway";
// every surface colour comes from the design tokens (src/ui/theme/sceneTokens.ts → MATERIAL)
import { MATERIAL } from "../ui/theme/sceneTokens";

/**
 * A wall's own surface: a named surface in its token's colour, made for the walls alone (not
 * the static one a piece of furniture in the same finish shares), since the cutaway slices
 * every wall material and must slice nothing else.
 */
const wallSurface = (name: SurfaceName, tint: string) => keepStatic(clipToCut(createSurfaceMaterial(name, tint)));

export const wallMaterial = wallSurface("plaster", MATERIAL.wall.hex);
export const wallTopMaterial = wallSurface("plaster", MATERIAL.wallTop.hex);
export const glassMaterial = wallSurface("glass", MATERIAL.glass.hex);
export const frameMaterial = wallSurface("darkWood", MATERIAL.frame.hex);

export const doorLeafMaterial = wallSurface("lacquer", MATERIAL.doorLeaf.hex);
export const doorPanelMaterial = wallSurface("lacquer", MATERIAL.doorPanel.hex);
export const skirtingMaterial = wallSurface("lacquer", MATERIAL.skirting.hex);
export const handleMaterial = wallSurface("brass", MATERIAL.handle.hex);

export const sillMaterial = wallSurface("stone", MATERIAL.sill.hex);

/**
 * A wall box's ends, in its own surface drawn a little deeper than they are (CUTAWAY.endOffset):
 * where a lintel or a sill overlaps the full-height stretch beside it, each one's end meets the
 * other's face edge-on, and pushed back it never shows through that face as a seam.
 */
const endsOf = (material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
  const ends = keepStatic(clipToCut(material.clone()));
  ends.name = `${material.name}:ends`;
  ends.polygonOffset = true;
  ends.polygonOffsetFactor = CUTAWAY.endOffset;
  ends.polygonOffsetUnits = CUTAWAY.endOffset;
  return ends;
};
const wallEndMaterial = endsOf(wallMaterial);
const skirtingEndMaterial = endsOf(skirtingMaterial);
export const curtainMaterial = wallSurface("linen", MATERIAL.curtain.hex);
// the pendant's shade and bulb: an open cone seen from below as well as from above, glowing
export const lampShadeMaterial = staticSurface("lampShade", MATERIAL.lampShade.hex);
export const cableMaterial = staticSurface("rubber", MATERIAL.cable.hex);

const SKIRTING_H = 0.09;
/** the width of a window's frame and of a door's, and how far either stands proud of the wall */
const WINDOW_FRAME = 0.05;
const DOOR_FRAME = 0.06;
const FRAME_PROUD = 0.02;
const DOOR_SWING = (82 * Math.PI) / 180;

/** The group a wall's curtains hang in: lined in ink on their own, and put away while the wall is cut. */
export const CURTAINS = "curtains";

/** The surface each floor finish is drawn with: its pattern is the plan's, at the plan's scale. */
export const FLOOR_SURFACE: Readonly<Record<FloorFinish, SurfaceName>> = Object.freeze({
  oak: "floorOak",
  tile: "floorTile",
  carpet: "floorCarpet",
  concrete: "floorConcrete",
});

/**
 * How far a wall's two ends reach past its endpoints: an end that touches another wall is
 * extended by half the partner's thickness, for a clean joint. This is the one thing a wall's
 * shape takes from its neighbours, so a neighbour that moves changes a wall exactly when it
 * changes these two numbers.
 */
export function jointExtensions(wall: Wall, walls: readonly Wall[]): [number, number] {
  const a = { x: wall.ax, y: wall.ay };
  const b = { x: wall.bx, y: wall.by };
  let extA = 0;
  let extB = 0;
  for (const o of walls) {
    if (o.id === wall.id) continue;
    const ends = [
      { x: o.ax, y: o.ay },
      { x: o.bx, y: o.by },
    ];
    for (const e of ends) {
      // extend just up to the partner's OUTER face — extending further pokes past the corner (X artifact)
      if (Math.hypot(e.x - a.x, e.y - a.y) < 0.09) extA = Math.max(extA, o.thickness / 2);
      if (Math.hypot(e.x - b.x, e.y - b.y) < 0.09) extB = Math.max(extB, o.thickness / 2);
    }
    // T-junction: our endpoint lands mid-span of the partner
    const pSeg = (p: { x: number; y: number }) => {
      const dx = o.bx - o.ax;
      const dy = o.by - o.ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Infinity;
      const t = Math.max(0, Math.min(1, ((p.x - o.ax) * dx + (p.y - o.ay) * dy) / l2));
      return Math.hypot(p.x - (o.ax + t * dx), p.y - (o.ay + t * dy));
    };
    // ...reaching on to the partner's middle, not through it: an end at its far face would lie in
    // that face's plane, and its sides would show through it as a seam on the far side
    const dA = pSeg(a);
    const dB = pSeg(b);
    if (dA < 0.09) extA = Math.max(extA, dA);
    if (dB < 0.09) extB = Math.max(extB, dB);
  }
  return [extA, extB];
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotY: number,
  castShadow = true,
  ends?: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (ends) {
    // BoxGeometry's six groups run +x, -x (its ends, along the wall), then +y, -y, +z, -z. Every
    // group is a draw call of its own, so the faces are regrouped into two runs: the ends, then
    // the rest, for two draws per box instead of six.
    const faces = geometry.groups[0].count;
    geometry.clearGroups();
    geometry.addGroup(0, faces * 2, 0);
    geometry.addGroup(faces * 2, faces * 4, 1);
  }
  const m = new THREE.Mesh(geometry, ends ? [ends, mat] : mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

/**
 * Build one wall with its openings as solid segments + lintels + sills + glass. `ext` is what
 * jointExtensions() gives for it, and `curtained` the windows that have room for curtains.
 */
export function buildWall(
  wall: Wall,
  openings: readonly Opening[],
  ext: readonly [number, number],
  curtained: ReadonlySet<string>,
): THREE.Group {
  const g = new THREE.Group();
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const [extA, extB] = insetJoints(ext);
  const total = len + extA + extB;
  const angle = Math.atan2(wall.by - wall.ay, wall.bx - wall.ax);
  // local frame: origin at wall start (extended), x along the wall
  const dirX = (wall.bx - wall.ax) / len;
  const dirY = (wall.by - wall.ay) / len;
  const ox = wall.ax - dirX * extA;
  const oy = wall.ay - dirY * extA;

  const spans = openings
    .map((o) => ({ o, span: openingSpan(wall, o) }))
    .sort((p, q) => p.span[0] - q.span[0]);

  // full-height segments between openings (in extended coords: opening t is relative to original len)
  const toX = (t: number) => extA + t * len;
  let cursor = 0;
  /**
   * One box of the wall. Neighbouring boxes overlap by a hair, so no hairline crack opens between
   * them onto the wall's inside (which the cutaway draws in the poché). Where they overlap, one
   * box's end meets the other's face edge-on, in its plane: the ends are drawn a little deeper
   * than they are (wallEndMaterial), so they never show through as a seam.
   */
  const addSeg = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    x0 -= CUTAWAY.seam;
    x1 += CUTAWAY.seam;
    const depth = wall.thickness;
    // local coords: group origin is the CENTER of the extended wall
    g.add(box(x1 - x0, y1 - y0, depth, wallMaterial, (x0 + x1) / 2 - total / 2, (y0 + y1) / 2, 0, 0, true, wallEndMaterial));
    // skirting board wherever the wall meets the floor
    if (y0 < 0.001 && y1 > SKIRTING_H) {
      g.add(box(x1 - x0, SKIRTING_H, depth + 0.024, skirtingMaterial, (x0 + x1) / 2 - total / 2, SKIRTING_H / 2, 0, 0, false, skirtingEndMaterial));
    }
  };
  /** the wall's curtains, in one group of their own (made with the first) */
  let curtains: THREE.Group | null = null;
  const curtainGroup = (): THREE.Group => {
    if (curtains) return curtains;
    curtains = new THREE.Group();
    curtains.name = CURTAINS;
    curtains.userData.inkAnchor = true;
    g.add(curtains);
    return curtains;
  };

  /**
   * One hinged door leaf. dir=+1 hinges on the A-side jamb (leaf runs toward +x), -1 on the
   * B-side jamb. `left` swings the leaf to -z instead of the default +z — i.e. to the left
   * of someone walking the wall from its A endpoint to its B endpoint.
   */
  const addLeaf = (hingeX: number, dir: 1 | -1, leafW: number, height: number, id: string, left: boolean) => {
    const hinge = new THREE.Group();
    hinge.position.set(hingeX - total / 2, 0, 0);
    hinge.userData = { doorHinge: true, doorId: id, swing: dir * (left ? 1 : -1) * DOOR_SWING };
    const h = height - 0.03;
    const cx = (dir * leafW) / 2;
    hinge.add(box(leafW, h, 0.045, doorLeafMaterial, cx, h / 2, 0, 0));
    // two recessed panels per leaf, on both faces
    for (const py_ph of [[h * 0.31, h * 0.42], [h * 0.75, h * 0.34]]) {
      const py = py_ph[0];
      const ph = py_ph[1];
      hinge.add(box(leafW - 0.18, ph, 0.008, doorPanelMaterial, cx, py, 0.027, 0, false));
      hinge.add(box(leafW - 0.18, ph, 0.008, doorPanelMaterial, cx, py, -0.027, 0, false));
    }
    // lever handle on the free edge, both faces
    const hx = cx + dir * (leafW / 2 - 0.09);
    for (const z of [0.055, -0.055]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 12), handleMaterial);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(hx, 1.05, z);
      knob.castShadow = true;
      hinge.add(knob);
      hinge.add(box(0.11, 0.022, 0.022, handleMaterial, hx - dir * 0.045, 1.05, z * 1.4, 0, false));
    }
    g.add(hinge);
  };

  for (const { o, span } of spans) {
    const x0 = toX(span[0]);
    const x1 = toX(span[1]);
    addSeg(cursor, x0, 0, wall.height);
    // lintel above the opening
    addSeg(x0, x1, o.sill + o.height, wall.height);
    // sill below windows
    if (o.sill > 0.005) addSeg(x0, x1, 0, o.sill);
    // glass pane for windows
    if (o.kind === "window") {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.04, o.height - 0.04, 0.02), glassMaterial);
      glass.position.set((x0 + x1) / 2 - total / 2, o.sill + o.height / 2, 0);
      g.add(glass);
      // frame
      const fw = x1 - x0;
      const fh = o.height;
      const fT = WINDOW_FRAME;
      const cy = o.sill + fh / 2;
      const cx = (x0 + x1) / 2 - total / 2;
      for (const [bw, bh, px, py] of [
        [fw, fT, cx, o.sill + fT / 2],
        [fw, fT, cx, o.sill + fh - fT / 2],
        [fT, fh, x0 - total / 2 + fT / 2, cy],
        [fT, fh, x1 - total / 2 - fT / 2, cy],
      ] as const) {
        g.add(box(bw, bh, wall.thickness + FRAME_PROUD, frameMaterial, px, py, 0, 0, false));
      }
      // stone sill, proud of both faces
      g.add(box(fw + 0.14, 0.045, wall.thickness + 0.16, sillMaterial, cx, o.sill - 0.022, 0, 0, false));
      // curtains, but only where nothing is parked in front of the window
      if (curtained.has(o.id)) {
        const rodY = o.sill + fh + 0.16;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, fw + 0.44, 10), frameMaterial);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(cx, rodY, wall.thickness / 2 + 0.11);
        curtainGroup().add(rod);
        const top = rodY - 0.05;
        const bottom = 0.06;
        const ph = top - bottom;
        // four narrow slats per panel at alternating depths read as folds
        for (const edge of [-1, 1] as const) {
          const outer = cx + edge * (fw / 2 + 0.19);
          for (let k = 0; k < 4; k++) {
            const px2 = outer - edge * k * 0.082;
            const z = wall.thickness / 2 + (k % 2 === 0 ? 0.075 : 0.135);
            curtainGroup().add(box(0.085, ph, 0.055, curtainMaterial, px2, bottom + ph / 2, z, 0, false));
          }
        }
      }
    } else {
      // hinged leaf (or two, for a double door) — clickable + animatable in Scene3D
      const clear = x1 - x0 - 0.04;
      const left = o.side === "left";
      if (clear > DOUBLE_DOOR_CLEAR) {
        // double door: one leaf per jamb, both swinging to the same side
        addLeaf(x0 + 0.02, 1, clear / 2, o.height, o.id, left);
        addLeaf(x1 - 0.02, -1, clear / 2, o.height, o.id, left);
      } else if (o.hinge === "b") {
        addLeaf(x1 - 0.02, -1, clear, o.height, o.id, left);
      } else {
        addLeaf(x0 + 0.02, 1, clear, o.height, o.id, left);
      }
      // door frame (two posts + header)
      const fT = DOOR_FRAME;
      for (const [bw, bh, px, py] of [
        [fT, o.height, x0 - total / 2 + fT / 2, o.height / 2],
        [fT, o.height, x1 - total / 2 - fT / 2, o.height / 2],
        [x1 - x0, fT, (x0 + x1) / 2 - total / 2, o.height + fT / 2],
      ] as const) {
        g.add(box(bw, bh, wall.thickness + FRAME_PROUD, frameMaterial, px, py, 0, 0, false));
      }
    }
    cursor = x1;
  }
  addSeg(cursor, total, 0, wall.height);

  // wall cap (top band) for a finished dollhouse look
  const cap = new THREE.Mesh(new THREE.BoxGeometry(total, 0.03, wall.thickness + 0.02), wallTopMaterial);
  cap.position.set(0, wall.height + 0.015, 0);
  cap.castShadow = true;
  g.add(cap);

  // grain on the frames and sills in metres, along the wall
  projectSurfaceUVs(g);

  // place group: center of extended wall, rotated
  g.position.set(ox + (dirX * total) / 2, 0, oy + (dirY * total) / 2);
  g.rotation.y = -angle;
  return g;
}

/**
 * A wall's cap at the cutaway's `level` (metres above the ground), in the wall's own frame (as
 * buildWall places it): flat poché over what the cut passes through — the wall's solid
 * stretches, a lintel or a sill where the cut is above or below an opening, and the frames'
 * jambs beside an opening it crosses — so a cut wall reads as the plan's solid wall, with its
 * doorways and windows open. Null when the cut passes over the wall.
 */
export function wallCutCap(wall: Wall, openings: readonly Opening[], ext: readonly [number, number], level: number): THREE.Mesh | null {
  if (level >= wall.height || level <= 0) return null;
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const [extA, extB] = insetJoints(ext);
  const total = len + extA + extB;
  const toX = (t: number) => extA + t * len;
  /** the stretches of the wall's length the cut passes through, and how deep each is */
  const solid: [number, number, number][] = [];
  let cursor = 0;
  const spans = openings.map((o) => ({ o, span: openingSpan(wall, o) })).sort((p, q) => p.span[0] - q.span[0]);
  for (const { o, span } of spans) {
    const x0 = toX(span[0]);
    const x1 = toX(span[1]);
    if (level > o.sill && level < o.sill + o.height) {
      // the cut crosses the opening: masonry up to it, then the frame's two jambs
      solid.push([cursor, x0, wall.thickness]);
      const jamb = o.kind === "door" ? DOOR_FRAME : WINDOW_FRAME;
      solid.push([x0, x0 + jamb, wall.thickness + FRAME_PROUD], [x1 - jamb, x1, wall.thickness + FRAME_PROUD]);
      cursor = x1;
    }
  }
  solid.push([cursor, total, wall.thickness]);
  const positions: number[] = [];
  for (const [a, b, depth] of solid) {
    if (b - a < 0.005) continue;
    const [x0, x1] = [a - total / 2 - CUTAWAY.seam, b - total / 2 + CUTAWAY.seam];
    const [z0, z1] = [-depth / 2, depth / 2];
    // two triangles facing up
    positions.push(x0, level, z0, x0, level, z1, x1, level, z1, x0, level, z0, x1, level, z1, x1, level, z0);
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const cap = new THREE.Mesh(geometry, POCHE);
  cap.name = CUT_CAP;
  cap.castShadow = false;
  cap.receiveShadow = false;
  return cap;
}

/**
 * The four sides of a floor slab, from the ground up to its top, unshaded: a slab only shows
 * them where a room stands clear of the walls.
 */
function slabSides(x0: number, z0: number, x1: number, z1: number, uv: (x: number, z: number, y: number) => [number, number]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const base = positions.length / 3;
    for (const [x, z, y] of [
      [ax, az, 0],
      [bx, bz, 0],
      [ax, az, FLOOR_TOP],
      [bx, bz, FLOOR_TOP],
    ] as const) {
      positions.push(x, y, z);
      normals.push(nx, 0, nz);
      uvs.push(...uv(x, z, y));
    }
    index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  side(x0, z1, x1, z1, 0, 1); // south, seen from +z
  side(x1, z0, x0, z0, 0, -1); // north
  side(x1, z1, x1, z0, 1, 0); // east
  side(x0, z0, x0, z1, -1, 0); // west
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(positions.length).fill(1), 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A room's floor: a slab in its finish, whose top darkens toward its edges, where it meets the
 * walls (CONTACT.floorEdge: the contact shading an occlusion pass used to add). Its texture
 * coordinates are plan metres over the pattern's repeat, so the planks and tiles line up with
 * the plan's drawing of them, and with the next room's. With `materials`, the finish is the
 * scene's shared one.
 */
export function buildFloor(room: Room, materials?: MaterialCache): THREE.Mesh {
  const material = surface(FLOOR_SURFACE[room.floor], undefined, materials);
  const [mu, mv] = (material.userData.metres as readonly [number, number] | undefined) ?? [1, 1];
  const cx = room.x + room.w / 2;
  const cz = room.y + room.h / 2;
  const hw = room.w / 2;
  const hd = room.h / 2;
  // the edge band, never wider than half the room
  const band = Math.min(CONTACT.floorEdge.width, hw, hd);
  const xs = [-hw, -hw + band, hw - band, hw];
  const zs = [-hd, -hd + band, hd - band, hd];
  const rim = (k: number) => k === 0 || k === 3;
  const top = ninePatch(
    xs,
    zs,
    FLOOR_TOP,
    (x, z) => [(x + cx) / mu, (z + cz) / mv],
    (i, j) => (rim(i) || rim(j) ? CONTACT.floorEdge.shade : 1),
  );
  const floor = new THREE.Mesh(top, material);
  floor.receiveShadow = true;
  const sides = new THREE.Mesh(
    slabSides(-hw, -hd, hw, hd, (x, z, y) => [(x + cx + z + cz) / mu, y / mv]),
    material,
  );
  sides.receiveShadow = true;
  floor.add(sides);
  floor.position.set(cx, 0, cz);
  return floor;
}

/**
 * A pendant fixture plus the point light it stands for, hung over a room's centre: a cord, an
 * open shade, and the bulb inside it (round enough that no facet of it takes the ink).
 */
export function buildPendant(room: Room, ceiling: number): THREE.Group {
  const g = new THREE.Group();
  const p = PENDANT;
  const drop = Math.min(p.maxDrop, ceiling * p.dropFraction);
  const shadeY = ceiling - drop;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(p.cord, p.cord, drop, p.cordSegments), cableMaterial);
  cable.position.set(0, ceiling - drop / 2, 0);
  g.add(cable);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(p.shadeTop, p.shadeBottom, p.shadeHeight, p.shadeSegments, 1, true), lampShadeMaterial);
  shade.position.set(0, shadeY, 0);
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(p.bulb, p.bulbSegments, p.bulbRings), lampShadeMaterial);
  // inside the shade: its bottom just above the shade's rim
  bulb.position.set(0, shadeY - p.shadeHeight / 2 + p.bulbInset + p.bulb, 0);
  g.add(bulb);
  // brightness scaled to the room so a corridor is not lit like a living room
  const { base, perSquareMetre, max, minArea, minRange, decay } = LIGHTS.pendant;
  const area = Math.max(minArea, room.w * room.h);
  const light = new THREE.PointLight(
    MATERIAL.pendantLight.hex,
    Math.min(max, base + area * perSquareMetre),
    Math.max(minRange, room.w + room.h),
    decay,
  );
  light.position.set(0, shadeY - p.lightBelow, 0);
  g.add(light);
  g.position.set(room.x + room.w / 2, 0, room.y + room.h / 2);
  return g;
}

/** Is a piece of furniture parked within curtain depth of this window? */
function blockedInFront(wall: Wall, o: Opening, items: readonly Item[], catalog: Catalog): boolean {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (len === 0) return true;
  const dx = (wall.bx - wall.ax) / len;
  const dy = (wall.by - wall.ay) / len;
  const cx = wall.ax + dx * o.t * len;
  const cy = wall.ay + dy * o.t * len;
  for (const it of items) {
    const cat = catalog.get(it.kind);
    if (!cat || cat.isRug) continue;
    const radius = Math.max(cat.w, cat.d) / 2;
    const vx = it.x - cx;
    const vy = it.y - cy;
    const along = Math.abs(vx * dx + vy * dy);
    const across = Math.abs(-vx * dy + vy * dx);
    if (along < o.width / 2 + radius && across < wall.thickness / 2 + 0.3 + radius) return true;
  }
  return false;
}

/** Each wall's openings, by wall id. */
export function openingsByWall(model: PlanModel): Map<string, Opening[]> {
  const byWall = new Map<string, Opening[]>();
  for (const o of model.openings) {
    const list = byWall.get(o.wallId);
    if (list) list.push(o);
    else byWall.set(o.wallId, [o]);
  }
  return byWall;
}

/**
 * The windows that get curtains: only those with the floor in front of them free — otherwise
 * the fabric would grow straight through a sofa or a wardrobe.
 */
export function curtainedWindows(model: PlanModel, byWall = openingsByWall(model)): Set<string> {
  const catalog = catalogOf(model);
  const curtained = new Set<string>();
  for (const w of model.walls) {
    for (const o of byWall.get(w.id) ?? []) {
      if (o.kind !== "window") continue;
      if (!blockedInFront(w, o, model.items, catalog)) curtained.add(o.id);
    }
  }
  return curtained;
}

/**
 * A wall's two ends as built: each joint's reach (jointExtensions) stops a hair inside the wall
 * it runs into, so the end face lies behind that wall's face, not in its plane — two faces in
 * one plane fight for depth, and draw the corner as a dashed seam.
 */
function insetJoints([extA, extB]: readonly [number, number]): [number, number] {
  const inset = (e: number) => (e > 0 ? Math.max(0, e - CUTAWAY.faceInset) : 0);
  return [inset(extA), inset(extB)];
}

/** The ceiling the pendants hang from: the plan's first wall, or a standard wall's height. */
export const ceilingOf = (model: PlanModel): number => model.walls[0]?.height ?? WALL_DEFAULTS.height;

/**
 * The ground around the plan: the studio's paper, a step deeper than the backdrop it fades into
 * (the fog). It has nothing to do with the plan's content, so it is built once per scene.
 */
export function buildGround(): THREE.Mesh {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(SCENE.groundRadius, SCENE.groundSegments),
    new THREE.MeshStandardMaterial({ color: MATERIAL.ground.hex, roughness: SCENE.groundRoughness }),
  );
  ground.name = "ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -SCENE.groundDrop;
  ground.receiveShadow = true;
  return ground;
}
