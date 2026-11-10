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
 * disposed with a piece. A floor owns its material, because each room repeats its texture to
 * its own size.
 */

import * as THREE from "three";
import type { Item, Opening, PlanModel, Room, Wall } from "../model/types";
import { catalogOf, type Catalog } from "../model/catalog";
import { segLen } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { DOUBLE_DOOR_CLEAR, WALL_DEFAULTS, type FloorFinish } from "../model/limits";
import { keepStatic } from "./materials";
import { FLOOR_TOP } from "./config";
// every surface colour comes from the design tokens (src/ui/theme/tokens.ts → MATERIAL)
import { MATERIAL } from "../ui/theme/tokens";

const standard = (params: THREE.MeshStandardMaterialParameters) => keepStatic(new THREE.MeshStandardMaterial(params));

export const wallMaterial = standard({ color: MATERIAL.wall.hex, roughness: 0.93, metalness: 0.0 });
export const wallTopMaterial = standard({ color: MATERIAL.wallTop.hex, roughness: 0.9 });
export const glassMaterial = keepStatic(
  new THREE.MeshPhysicalMaterial({
    color: MATERIAL.glass.hex,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  }),
);
export const frameMaterial = standard({ color: MATERIAL.frame.hex, roughness: 0.6 });

export const doorLeafMaterial = standard({ color: MATERIAL.doorLeaf.hex, roughness: 0.5 });
export const doorPanelMaterial = standard({ color: MATERIAL.doorPanel.hex, roughness: 0.55 });
export const skirtingMaterial = standard({ color: MATERIAL.skirting.hex, roughness: 0.55 });
export const handleMaterial = standard({ color: MATERIAL.handle.hex, roughness: 0.3, metalness: 0.8 });

export const sillMaterial = standard({ color: MATERIAL.sill.hex, roughness: 0.6 });
export const curtainMaterial = standard({ color: MATERIAL.curtain.hex, roughness: 0.97 });
// double-sided: the shade is an open cone, seen from below as well as from above
export const lampShadeMaterial = standard({
  color: MATERIAL.lampShade.hex,
  roughness: 0.6,
  emissive: new THREE.Color(MATERIAL.lampGlow.hex),
  emissiveIntensity: 0.9,
  side: THREE.DoubleSide,
});
export const cableMaterial = standard({ color: MATERIAL.cable.hex, roughness: 0.8 });

const SKIRTING_H = 0.09;
const DOOR_SWING = (82 * Math.PI) / 180;

/**
 * Procedural floor finishes — one canvas per finish, cloned per room so each gets its own
 * repeat. The canvases are static: a clone shares its canvas and its upload, and only the
 * clone is the room's to dispose.
 */
const texCache = new Map<FloorFinish, THREE.CanvasTexture>();
function floorTexture(kind: FloorFinish): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const hit = texCache.get(kind);
  if (hit) return hit;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const x = c.getContext("2d");
  if (!x) return null;
  const jitter = (base: string, amt: number) => {
    const n = Math.round((Math.random() - 0.5) * amt);
    const r = parseInt(base.slice(1, 3), 16) + n;
    const g = parseInt(base.slice(3, 5), 16) + n;
    const b = parseInt(base.slice(5, 7), 16) + n;
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    return "rgb(" + cl(r) + "," + cl(g) + "," + cl(b) + ")";
  };
  if (kind === "oak") {
    x.fillStyle = MATERIAL.floor.oak.hex;
    x.fillRect(0, 0, S, S);
    const rows = 8;
    const rh = S / rows;
    for (let i = 0; i < rows; i++) {
      let px = -Math.random() * 180;
      while (px < S) {
        const pw = 130 + Math.random() * 190;
        x.fillStyle = jitter(MATERIAL.floor.oak.hex, 26);
        x.fillRect(px, i * rh, pw, rh - 1.5);
        x.strokeStyle = MATERIAL.oakSeam.css;
        x.lineWidth = 1.5;
        x.strokeRect(px, i * rh, pw, rh - 1.5);
        for (let gi = 0; gi < 5; gi++) {
          x.strokeStyle = MATERIAL.oakGrain.css;
          x.lineWidth = 1;
          const gy = i * rh + 4 + Math.random() * (rh - 10);
          x.beginPath();
          x.moveTo(px + 4, gy);
          x.bezierCurveTo(px + pw * 0.3, gy + 3, px + pw * 0.7, gy - 3, px + pw - 4, gy);
          x.stroke();
        }
        px += pw;
      }
    }
  } else if (kind === "tile") {
    x.fillStyle = MATERIAL.tileGrout.hex;
    x.fillRect(0, 0, S, S);
    const n = 4;
    const t = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        x.fillStyle = jitter(MATERIAL.floor.tile.hex, 14);
        x.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      }
    }
  } else if (kind === "carpet") {
    x.fillStyle = MATERIAL.floor.carpet.hex;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const w = Math.random() > 0.5 ? "255,255,255" : "0,0,0";
      x.fillStyle = "rgba(" + w + "," + Math.random() * 0.08 + ")";
      x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
  } else {
    x.fillStyle = MATERIAL.floor.concrete.hex;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const w = Math.random() > 0.5 ? "255,255,255" : "0,0,0";
      x.fillStyle = "rgba(" + w + ",0.05)";
      x.beginPath();
      x.arc(Math.random() * S, Math.random() * S, 6 + Math.random() * 34, 0, Math.PI * 2);
      x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  keepStatic(tex);
  texCache.set(kind, tex);
  return tex;
}

/** Metres of floor covered by one texture tile, per finish. */
const FLOOR_SCALE: Record<FloorFinish, number> = { oak: 2.4, tile: 1.2, carpet: 2, concrete: 3 };

const FLOOR_COLORS: Record<FloorFinish, string> = {
  oak: MATERIAL.floor.oak.hex,
  tile: MATERIAL.floor.tile.hex,
  carpet: MATERIAL.floor.carpet.hex,
  concrete: MATERIAL.floor.concrete.hex,
};

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
    if (pSeg(a) < 0.09) extA = Math.max(extA, o.thickness / 2);
    if (pSeg(b) < 0.09) extB = Math.max(extB, o.thickness / 2);
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
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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
  const [extA, extB] = ext;
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
  const addSeg = (x0: number, x1: number, y0: number, y1: number, mat = wallMaterial) => {
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    // local coords: group origin is the CENTER of the extended wall
    g.add(box(x1 - x0, y1 - y0, wall.thickness, mat, (x0 + x1) / 2 - total / 2, (y0 + y1) / 2, 0, 0));
    // skirting board wherever the wall meets the floor
    if (y0 < 0.001 && y1 > SKIRTING_H) {
      g.add(
        box(x1 - x0, SKIRTING_H, wall.thickness + 0.024, skirtingMaterial, (x0 + x1) / 2 - total / 2, SKIRTING_H / 2, 0, 0, false),
      );
    }
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
      const fT = 0.05;
      const cy = o.sill + fh / 2;
      const cx = (x0 + x1) / 2 - total / 2;
      for (const [bw, bh, px, py] of [
        [fw, fT, cx, o.sill + fT / 2],
        [fw, fT, cx, o.sill + fh - fT / 2],
        [fT, fh, x0 - total / 2 + fT / 2, cy],
        [fT, fh, x1 - total / 2 - fT / 2, cy],
      ] as const) {
        g.add(box(bw, bh, wall.thickness + 0.02, frameMaterial, px, py, 0, 0, false));
      }
      // stone sill, proud of both faces
      g.add(box(fw + 0.14, 0.045, wall.thickness + 0.16, sillMaterial, cx, o.sill - 0.022, 0, 0, false));
      // curtains, but only where nothing is parked in front of the window
      if (curtained.has(o.id)) {
        const rodY = o.sill + fh + 0.16;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, fw + 0.44, 10), frameMaterial);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(cx, rodY, wall.thickness / 2 + 0.11);
        g.add(rod);
        const top = rodY - 0.05;
        const bottom = 0.06;
        const ph = top - bottom;
        // four narrow slats per panel at alternating depths read as folds
        for (const edge of [-1, 1] as const) {
          const outer = cx + edge * (fw / 2 + 0.19);
          for (let k = 0; k < 4; k++) {
            const px2 = outer - edge * k * 0.082;
            const z = wall.thickness / 2 + (k % 2 === 0 ? 0.075 : 0.135);
            g.add(box(0.085, ph, 0.055, curtainMaterial, px2, bottom + ph / 2, z, 0, false));
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
      const fT = 0.06;
      for (const [bw, bh, px, py] of [
        [fT, o.height, x0 - total / 2 + fT / 2, o.height / 2],
        [fT, o.height, x1 - total / 2 - fT / 2, o.height / 2],
        [x1 - x0, fT, (x0 + x1) / 2 - total / 2, o.height + fT / 2],
      ] as const) {
        g.add(box(bw, bh, wall.thickness + 0.02, frameMaterial, px, py, 0, 0, false));
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

  // place group: center of extended wall, rotated
  g.position.set(ox + (dirX * total) / 2, 0, oy + (dirY * total) / 2);
  g.rotation.y = -angle;
  return g;
}

/** A room's floor slab, textured with its finish. The material and its texture repeat are the floor's own. */
export function buildFloor(room: Room): THREE.Mesh {
  const color = FLOOR_COLORS[room.floor];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: room.floor === "carpet" ? 1 : 0.72 });
  const base = floorTexture(room.floor);
  if (base) {
    const tex = base.clone();
    tex.needsUpdate = true;
    const sc = FLOOR_SCALE[room.floor];
    tex.repeat.set(room.w / sc, room.h / sc);
    mat.map = tex;
    mat.color.set(MATERIAL.untinted.hex);
    if (room.floor === "tile") mat.roughness = 0.4;
  }
  const geo = new THREE.BoxGeometry(room.w, FLOOR_TOP, room.h);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(room.x + room.w / 2, FLOOR_TOP / 2, room.y + room.h / 2);
  m.receiveShadow = true;
  return m;
}

/** A pendant fixture plus the point light it stands for, hung over a room's centre. */
export function buildPendant(room: Room, ceiling: number): THREE.Group {
  const g = new THREE.Group();
  const drop = Math.min(0.55, ceiling * 0.22);
  const shadeY = ceiling - drop;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, drop, 6), cableMaterial);
  cable.position.set(0, ceiling - drop / 2, 0);
  g.add(cable);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.19, 0.17, 20, 1, true), lampShadeMaterial);
  shade.position.set(0, shadeY, 0);
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), lampShadeMaterial);
  bulb.position.set(0, shadeY - 0.09, 0);
  g.add(bulb);
  // brightness scaled to the room so a corridor is not lit like a living room
  const area = Math.max(4, room.w * room.h);
  const light = new THREE.PointLight(MATERIAL.pendantLight.hex, Math.min(8, 2.2 + area * 0.26), Math.max(5, room.w + room.h), 2);
  light.position.set(0, shadeY - 0.12, 0);
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

/** The ceiling the pendants hang from: the plan's first wall, or a standard wall's height. */
export const ceilingOf = (model: PlanModel): number => model.walls[0]?.height ?? WALL_DEFAULTS.height;

/** The ground around the plan. It has nothing to do with the plan's content, so it is built once per scene. */
export function buildGround(): THREE.Mesh {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: MATERIAL.ground.hex, roughness: 1 }),
  );
  ground.name = "ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  return ground;
}
