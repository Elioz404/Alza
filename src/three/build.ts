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
import { outlineAnchor, outlineBounds, outlineDistance, outlineRect, roomArea, tessellateEdge, tessellateOutline, wallLength, wallPointAt, wallTangentAt } from "../model/shapes";
import type { WallFootprint } from "../model/joints";
import type { Item, Opening, PlanModel, Room, Wall } from "../model/types";
import { catalogOf, type Catalog } from "../model/catalog";
import type { Pt } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { DOUBLE_DOOR_CLEAR, REGION, WALL_DEFAULTS, type FloorFinish } from "../model/limits";
import { keepStatic, type MaterialCache } from "./materials";
import { CONTACT, CUTAWAY, FLOOR_TOP, LIGHTS, PENDANT, SCENE, WALL_SOLID } from "./config";
import { PRISM_SOLID, alongWall, bandRuns, localTurn, pieceRing, prismGeometry, ringSection, seamShare, toLocal, wallFrame, type WallBands, type WallFrame, type WallPiece } from "./wallSolids";
import { piecesArea, regionPieces, regionRim, type Poly } from "../model/region";
import { NO_INK, piecesGeometry, rimGeometry } from "./slabs";
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

/** One door or window as a wall is built round it: where it is along the wall, and its frame. */
interface OpeningPlan {
  readonly o: Opening;
  /** its span along the centreline, as shares of the wall's length (openingSpan) */
  readonly t0: number;
  readonly t1: number;
  /** its chord: the straight line across it from one cut to the other, which its leaf or pane spans */
  readonly chord: number;
  /**
   * Its own frame on the plan: x along the chord, z to the chord's right, its origin half way
   * from the chord's middle to the centreline's (on a straight wall, the opening's middle), so a
   * straight frame across an arc stands as far proud of one face as it is short of the other.
   */
  readonly origin: Pt;
  readonly dir: Pt;
  /**
   * How far the centreline's middle stands off the chord's (0 on a straight wall): across the
   * opening the wall is that much deeper than its thickness, so the frame's head and foot and the
   * window's stone sill, straight across the chord, are deepened by it to cover the lintel and sill.
   */
  readonly sag: number;
  /** the jambs, square to the centreline where it is cut: each one's middle on the plan and its direction along the wall */
  readonly jambs: readonly { readonly at: Pt; readonly dir: Pt }[];
}

/** How a wall is built: its frame, its prisms (body, skirting and top band) and its openings. */
export interface WallPlan {
  readonly frame: WallFrame;
  readonly body: readonly WallPiece[];
  readonly skirting: readonly WallPiece[];
  readonly cap: WallPiece | null;
  readonly openings: readonly OpeningPlan[];
}

/** The plan of a wall's solids: cut at its openings, along its centreline (along the arc, on a curved wall). */
export function planWall(wall: Wall, openings: readonly Opening[], bands: WallBands): WallPlan {
  const frame = wallFrame(wall);
  const tess = WALL_SOLID.tessellation;
  const half = wall.thickness / 2;
  const seam = seamShare(wall);
  const body: WallPiece[] = [];
  const skirting: WallPiece[] = [];
  const len = wallLength(wall);
  const spans = openings.map((o) => ({ o, span: openingSpan(wall, o) })).sort((p, q) => p.span[0] - q.span[0]);
  /** one stretch of the wall between two cuts (null: the footprint's own end), from y0 up to y1 */
  const addSeg = (from: number | null, to: number | null, y0: number, y1: number) => {
    if (y1 - y0 < 0.005) return;
    if (from !== null && to !== null && (to - from) * len < 0.005) return;
    const t0 = from === null ? null : from - seam;
    const t1 = to === null ? null : to + seam;
    const runs = bandRuns(bands.body, wall, half, t0, t1, tess);
    if (!runs) return;
    body.push({ runs, y0, y1 });
    // skirting wherever the wall meets the floor
    if (y0 < 0.001 && y1 > WALL_SOLID.skirtingHeight) {
      const skirt = bandRuns(bands.skirting, wall, half + WALL_SOLID.skirtingProud, t0, t1, tess);
      if (skirt) skirting.push({ runs: skirt, y0: 0, y1: WALL_SOLID.skirtingHeight });
    }
  };
  let cursor: number | null = null;
  const plans: OpeningPlan[] = [];
  for (const { o, span } of spans) {
    const [t0, t1] = span;
    addSeg(cursor, t0, 0, wall.height);
    // the lintel over the opening, the sill under a window
    addSeg(t0, t1, o.sill + o.height, wall.height);
    if (o.sill > 0.005) addSeg(t0, t1, 0, o.sill);
    cursor = t1;
    const a = wallPointAt(wall, t0);
    const b = wallPointAt(wall, t1);
    const m = wallPointAt(wall, o.t);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dir = chord > 0 ? { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord } : wallTangentAt(wall, o.t);
    const jamb = o.kind === "door" ? DOOR_FRAME : WINDOW_FRAME;
    const ta = wallTangentAt(wall, t0);
    const tb = wallTangentAt(wall, t1);
    plans.push({
      o,
      t0,
      t1,
      chord,
      origin: { x: (mid.x + m.x) / 2, y: (mid.y + m.y) / 2 },
      dir,
      sag: Math.hypot(m.x - mid.x, m.y - mid.y),
      jambs: [
        { at: { x: a.x + (ta.x * jamb) / 2, y: a.y + (ta.y * jamb) / 2 }, dir: ta },
        { at: { x: b.x - (tb.x * jamb) / 2, y: b.y - (tb.y * jamb) / 2 }, dir: tb },
      ],
    });
  }
  addSeg(cursor, null, 0, wall.height);
  const capRuns = bandRuns(bands.cap, wall, half + WALL_SOLID.capProud, null, null, tess);
  const cap = capRuns ? { runs: capRuns, y0: wall.height, y1: wall.height + WALL_SOLID.capHeight } : null;
  return { frame, body, skirting, cap, openings: plans };
}

/** One prism of a wall as a mesh: its ends in `ends`, the rest in `material`. */
function prism(piece: WallPiece, plan: WallPlan, along: (p: Pt) => number, material: THREE.Material, ends: THREE.Material | null, castShadow: boolean): THREE.Mesh {
  const metres = (material.userData?.metres as readonly [number, number] | undefined) ?? [1, 1];
  const geometry = prismGeometry(piece, plan.frame, along, metres);
  const m = new THREE.Mesh(geometry, ends ? [ends, material] : material);
  if (!ends) geometry.clearGroups();
  m.castShadow = castShadow;
  m.receiveShadow = true;
  m.userData[PRISM_SOLID] = geometry.userData[PRISM_SOLID];
  m.userData.ownUVs = true;
  return m;
}

/** A box on the plan, in a wall's frame: its middle `at`, its length along `dir`. */
function planBox(plan: WallPlan, w: number, h: number, d: number, mat: THREE.Material, at: Pt, y: number, dir: Pt, castShadow = true): THREE.Mesh {
  const q = toLocal(plan.frame, at);
  return box(w, h, d, mat, q.x, y, q.y, localTurn(plan.frame, dir), castShadow);
}

/**
 * Build one wall with its openings: its prisms (the stretches between its openings, the lintels
 * and sills, its skirting and the band on its top), its windows' frames, panes and curtains and
 * its doors' frames and leaves. `bands` is what wallBands() gives for it against the walls of its
 * level, and `curtained` the windows that have room for curtains. Straight or curved: on an arc,
 * every pane and leaf spans its opening's chord, its jambs square to the centreline where it is cut.
 */
export function buildWall(wall: Wall, openings: readonly Opening[], bands: WallBands, curtained: ReadonlySet<string>): THREE.Group {
  const g = new THREE.Group();
  const plan = planWall(wall, openings, bands);
  const along = alongWall(wall, plan.frame);
  for (const piece of plan.body) g.add(prism(piece, plan, along, wallMaterial, wallEndMaterial, true));
  for (const piece of plan.skirting) g.add(prism(piece, plan, along, skirtingMaterial, skirtingEndMaterial, false));
  // the band along the wall's top, for a finished dollhouse look
  if (plan.cap) g.add(prism(plan.cap, plan, along, wallTopMaterial, null, true));

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

  for (const op of plan.openings) {
    const { o } = op;
    // the opening's own frame: x along its chord, from -chord/2 to chord/2
    const of = new THREE.Group();
    const q = toLocal(plan.frame, op.origin);
    of.position.set(q.x, 0, q.y);
    of.rotation.y = localTurn(plan.frame, op.dir);
    g.add(of);
    const x0 = -op.chord / 2;
    const x1 = op.chord / 2;
    const fw = op.chord;
    const fT = o.kind === "door" ? DOOR_FRAME : WINDOW_FRAME;
    const depth = wall.thickness + FRAME_PROUD;
    // straight across the chord, as deep as the wall is there (deeper than its thickness on an arc)
    const across = depth + op.sag;
    // the jambs, square to the centreline at the cuts
    for (const j of op.jambs) g.add(planBox(plan, fT, o.height, depth, frameMaterial, j.at, o.sill + o.height / 2, j.dir, false));

    /**
     * One hinged door leaf. dir=+1 hinges on the A-side jamb (leaf runs toward +x), -1 on the
     * B-side jamb. `left` swings the leaf to -z instead of the default +z — i.e. to the left
     * of someone walking the wall from its A endpoint to its B endpoint.
     */
    const addLeaf = (hingeX: number, dir: 1 | -1, leafW: number, height: number, id: string, left: boolean) => {
      const hinge = new THREE.Group();
      hinge.position.set(hingeX, 0, 0);
      hinge.userData = { doorHinge: true, doorId: id, swing: dir * (left ? 1 : -1) * DOOR_SWING };
      const h = height - 0.03;
      const cx = (dir * leafW) / 2;
      hinge.add(box(leafW, h, 0.045, doorLeafMaterial, cx, h / 2, 0, 0));
      // two recessed panels per leaf, on both faces
      for (const [py, ph] of [
        [h * 0.31, h * 0.42],
        [h * 0.75, h * 0.34],
      ]) {
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
      of.add(hinge);
    };

    if (o.kind === "window") {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.04, o.height - 0.04, 0.02), glassMaterial);
      glass.position.set(0, o.sill + o.height / 2, 0);
      of.add(glass);
      // the frame's head and foot (its jambs stand at the cuts)
      for (const py of [o.sill + fT / 2, o.sill + o.height - fT / 2]) of.add(box(fw, fT, across, frameMaterial, 0, py, 0, 0, false));
      // stone sill, proud of both faces
      of.add(box(fw + 0.14, 0.045, wall.thickness + 0.16 + op.sag, sillMaterial, 0, o.sill - 0.022, 0, 0, false));
      // curtains, but only where nothing is parked in front of the window
      if (curtained.has(o.id)) {
        // on a curved wall whose right face curves toward the curtains, they hang that much further out
        const reach = fw / 2 + 0.44;
        const lift = Math.max(0, ...curtainFace(bands.body, op).filter((p) => Math.abs(p.x) <= reach).map((p) => p.y - wall.thickness / 2));
        const rodY = o.sill + o.height + 0.16;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, fw + 0.44, 10), frameMaterial);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(0, rodY, wall.thickness / 2 + lift + 0.11);
        const hung = new THREE.Group();
        hung.position.copy(of.position);
        hung.rotation.copy(of.rotation);
        hung.add(rod);
        const top = rodY - 0.05;
        const bottom = 0.06;
        const ph = top - bottom;
        // four narrow slats per panel at alternating depths read as folds
        for (const edge of [-1, 1] as const) {
          const outer = edge * (fw / 2 + 0.19);
          for (let k = 0; k < 4; k++) {
            const px2 = outer - edge * k * 0.082;
            const z = wall.thickness / 2 + lift + (k % 2 === 0 ? 0.075 : 0.135);
            hung.add(box(0.085, ph, 0.055, curtainMaterial, px2, bottom + ph / 2, z, 0, false));
          }
        }
        curtainGroup().add(hung);
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
      // the door frame's head (its posts stand at the cuts)
      of.add(box(fw, fT, across, frameMaterial, 0, o.height + fT / 2, 0, 0, false));
    }
  }

  // grain on the frames and sills in metres, along the wall
  projectSurfaceUVs(g);

  // place the group: at the middle of the wall's chord, turned along it
  g.position.set(plan.frame.ox, 0, plan.frame.oy);
  g.rotation.y = -plan.frame.angle;
  return g;
}

/** The right face of a wall's body round an opening, in the opening's frame (x along its chord, y its z). */
function curtainFace(body: WallFootprint, op: OpeningPlan): Pt[] {
  const pts = tessellateEdge(body.right, WALL_SOLID.tessellation).concat([body.right.b]);
  return pts.map((p) => {
    const dx = p.x - op.origin.x;
    const dy = p.y - op.origin.y;
    return { x: dx * op.dir.x + dy * op.dir.y, y: -dx * op.dir.y + dy * op.dir.x };
  });
}

/** A box's outline on (x, z): w along x and d along z, about (cx, cz), turned `turn` about y as three.js turns it. */
function boxRing(cx: number, cz: number, w: number, d: number, turn: number): Pt[] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, z]) => ({ x: cx + x * c + z * s, y: cz - x * s + z * c }));
}

/**
 * A wall's cap at the cutaway's `level` (metres above its floor), in the wall's own frame (as
 * buildWall places it): flat poché over what the cut passes through — the wall's prisms there (a
 * stretch, a lintel or a sill where the cut is above or below an opening) and the frames' jambs
 * beside an opening it crosses — so a cut wall reads as the plan's solid wall, with its doorways
 * and windows open. Null when the cut passes over the wall.
 */
export function wallCutCap(wall: Wall, openings: readonly Opening[], bands: WallBands, level: number): THREE.Mesh | null {
  if (level >= wall.height || level <= 0) return null;
  const plan = planWall(wall, openings, bands);
  const positions: number[] = [];
  for (const piece of plan.body) if (level > piece.y0 && level < piece.y1) ringSection(pieceRing(piece.runs, plan.frame).pts, level, positions);
  for (const op of plan.openings) {
    const { o } = op;
    if (!(level > o.sill && level < o.sill + o.height)) continue;
    // the cut crosses the opening: the frame's two jambs
    const fT = o.kind === "door" ? DOOR_FRAME : WINDOW_FRAME;
    for (const j of op.jambs) {
      const q = toLocal(plan.frame, j.at);
      ringSection(boxRing(q.x, q.y, fT, wall.thickness + FRAME_PROUD, localTurn(plan.frame, j.dir)), level, positions);
    }
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
export function buildFloor(room: Room, materials?: MaterialCache, wells: readonly Poly[] = []): THREE.Mesh {
  const material = surface(FLOOR_SURFACE[room.floor], undefined, materials);
  const [mu, mv] = (material.userData.metres as readonly [number, number] | undefined) ?? [1, 1];
  const box = outlineBounds(room.points);
  const cx = box.x + box.w / 2;
  const cz = box.y + box.h / 2;
  const hw = box.w / 2;
  const hd = box.h / 2;
  // the edge band, never wider than half the room
  const band = Math.min(CONTACT.floorEdge.width, hw, hd);
  // its arcs cut as finely as the curved walls along them (WALL_SOLID.tessellation)
  const outline: Poly = tessellateOutline(room.points, WALL_SOLID.tessellation);
  // a stairwell crosses the room when it takes some of its floor away
  const area = piecesArea(regionPieces([outline]));
  const crossing = wells.filter((w) => piecesArea(regionPieces([outline], [w])) < area - REGION.probe * REGION.probe);
  if (crossing.length > 0 || !outlineRect(room.points)) {
    // a stairwell crosses the room, or it is no rectangle: its floor is the room (less the
    // opening), in pieces cut at the edge band's lines, its sides along the rim
    const shade = (x: number, z: number) => {
      const d = outlineDistance({ x, y: z }, room.points);
      return CONTACT.floorEdge.shade + (1 - CONTACT.floorEdge.shade) * Math.min(1, Math.max(0, d) / band);
    };
    // cut a band's width in from every corner of it too, so an L's inner corner shades as its outer ones do
    const cuts = (along: (p: { x: number; y: number }) => number) => [...new Set(room.points.flatMap((p) => [along(p) - band, along(p) + band]))];
    const pieces = regionPieces([outline], crossing, cuts((p) => p.x), cuts((p) => p.y));
    const floor = new THREE.Mesh(piecesGeometry(pieces, FLOOR_TOP, false, (x, z) => [x / mu, z / mv], shade, -cx, -cz), material);
    floor.receiveShadow = true;
    // cut into pieces that are no edge of anything: the ink is the rim's
    floor.userData[NO_INK] = true;
    const sides = new THREE.Mesh(
      rimGeometry(regionRim([outline], crossing), 0, FLOOR_TOP, (a, y) => [a / mu, y / mv], true, -cx, -cz),
      material,
    );
    sides.receiveShadow = true;
    floor.add(sides);
    floor.position.set(cx, 0, cz);
    return floor;
  }
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

/** A room's middle: its rectangle's centre, or for any other outline its most interior point. */
export function roomMiddle(room: Room): { x: number; y: number } {
  const r = outlineRect(room.points);
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : outlineAnchor(room.points);
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
  const area = Math.max(minArea, roomArea(room));
  const box = outlineBounds(room.points);
  const light = new THREE.PointLight(
    MATERIAL.pendantLight.hex,
    Math.min(max, base + area * perSquareMetre),
    Math.max(minRange, box.w + box.h),
    decay,
  );
  light.position.set(0, shadeY - p.lightBelow, 0);
  g.add(light);
  // over its middle: a rectangle's centre, any other room's most interior point
  const over = roomMiddle(room);
  g.position.set(over.x, 0, over.y);
  return g;
}

/** Is a piece of furniture parked within curtain depth of this window? Measured along the wall where the window is (its tangent there, on an arc). */
function blockedInFront(wall: Wall, o: Opening, items: readonly Item[], catalog: Catalog): boolean {
  if (wallLength(wall) === 0) return true;
  const c = wallPointAt(wall, o.t);
  const { x: dx, y: dy } = wallTangentAt(wall, o.t);
  for (const it of items) {
    const cat = catalog.get(it.kind);
    if (!cat || cat.isRug) continue;
    const radius = Math.max(cat.w, cat.d) / 2;
    const vx = it.x - c.x;
    const vy = it.y - c.y;
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
