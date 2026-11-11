/**
 * The plan's marks, in the model: what the plan draws over its drawing, the 3D view draws over
 * the model, in the same colours (sceneTokens.ts SCENE_MARK, the sheet's own values).
 *
 *  - The selection: the selected wall, room or piece outlined in the accent, standing
 *    MARKS.outline off it as the plan's outline does. The stretch of the outline something hides
 *    is drawn dashed and fainter, so a selected piece behind a wall still shows where it is.
 *  - A pending destructive request (remove_room, remove_wall, clear_model…): its target
 *    hatched and outlined in the error colour, as PlanMarks and the editor draw it on the plan,
 *    until the human approves or keeps it. A request to clear the plan outlines the plan's
 *    extent, as the plan does.
 *
 * An outline is a line of MARKS.width pixels over a paper casing (SCENE_MARK.casing), drawn
 * whatever the GPU's own line width (screenLines.ts), so it holds its contrast over oak, carpet or concrete as
 * the plan's marks do over the sheet. The hatch over the built finishes is the error colour a
 * step deeper (SCENE_MARK.destructiveInk), for the same reason; and the hatch, not the hue, is
 * what tells a pending removal from a selection.
 *
 * A room lies on its floor, where its own furniture and walls cover most of what is drawn there:
 * a room's marks are drawn again over the room at the top of its walls, or at the cut, over
 * everything (a wash of the mark's colour, the hatch and the outline), so the room a request
 * would remove is seen from any camera. Nothing of a room's outline is projected through its
 * walls: from outside, that would land on the room next to it.
 *
 * On a plan of several storeys every mark stands on its entity's level (at the level's
 * elevation), a room's lid at its own ceiling or the cut, whichever is lower; what stands on a
 * level the view hides is not marked, and a request to remove a level outlines everything on it.
 *
 * The marks are their own group beside the plan's content: never raycast, never exported, never
 * casting a shadow. They are rebuilt only when what they mark changed (a signature of their
 * boxes), and their materials and hatch texture are static.
 */

import { edgeBox, isCurved, outlineAnchor, outlineBox, outlineRect, tessellateOutline, wallEdge, wallPointAt } from "../model/shapes";
import { wallFootprint } from "../model/joints";
import { columnFootprint, columnHeight, isRound } from "../model/columns";
import * as THREE from "three";
import { ScreenLineMaterial, screenLines } from "./screenLines";
import type { ApprovalTarget, PlanModel } from "../model/types";
import { catalogOf } from "../model/catalog";
import { elevationOf, levelSlice, levelIdOf, stairGeometryIn } from "../model/levels";
import { segLen, type Pt } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { keepStatic } from "./materials";
import { riseOf } from "./furnitureStyle";
import { FLOOR_TOP, MARKS, WALL_SOLID } from "./config";
import { ceilingOf } from "./build";
import { triangulate } from "./triangulate";
import { SCENE_MARK } from "../ui/theme/sceneTokens";

/**
 * What a mark is drawn around: a box on the plan, turned `ry` radians, from `y0` up to `y1`; or,
 * with `ring`, the outline it has on the plan (a room's polygon, a curved wall's footprint), its
 * points relative to (cx, cz) as {x, y: z}, inside the box's w by d bounds and never turned; and
 * `at`, a point of the entity itself on the plan (a shaped room's most interior point, the middle of
 * a curved wall's arc), where the middle of its bounds may well not be.
 */
export interface MarkBox {
  cx: number;
  cz: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
  ry: number;
  ring?: readonly Pt[];
  at?: Pt;
}

/** A plan outline as a mark's box: its bounds, the outline itself relative to their middle. */
function ringBox(pts: readonly Pt[], y0: number, y1: number, at: Pt): MarkBox {
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.y);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return { cx, cz, w: x1 - x0, d: z1 - z0, y0, y1, ry: 0, ring: pts.map((p) => ({ x: p.x - cx, y: p.y - cz })), at: { x: at.x, y: at.y } };
}

/** Something the agent is touching (the shared session): any entity that stands on the plan. */
export interface Focused {
  type: Exclude<ApprovalTarget["type"], "plan" | "file" | "level">;
  id: string;
}

/** The entity the store has selected, if any. */
export interface Selected {
  type: "wall" | "room" | "item" | "stair" | "column";
  id: string;
}

/** How far up the floor of level `levelId` stands (0 for a level the plan does not have). */

/** A box lifted onto its level. */
const lifted = (b: MarkBox, by: number): MarkBox => (by === 0 ? b : { ...b, y0: b.y0 + by, y1: b.y1 + by });

/** The extent of walls, rooms and pieces on the plan, and the tallest wall: a "plan" or a "level" box. */
function extentBox(model: PlanModel): MarkBox | null {
  // a curved wall reaches as far as its arc bows
  const boxes = [...model.rooms.map((r) => outlineBox(r.points)), ...model.walls.map((w) => edgeBox(wallEdge(w)))];
  const xs = [...boxes.flatMap((b) => [b.minX, b.maxX]), ...model.items.map((i) => i.x)];
  const zs = [...boxes.flatMap((b) => [b.minY, b.maxY]), ...model.items.map((i) => i.y)];
  if (xs.length === 0) return null;
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const height = Math.max(FLOOR_TOP, ...model.walls.map((w) => w.height));
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y0: 0, y1: height, ry: 0 };
}

/**
 * The level a mark stands on, by what it marks: an entity's own level; none for the plan (it
 * spans them all) or a file (it is on none).
 */
export function markLevel(type: ApprovalTarget["type"], id: string, model: PlanModel): string | undefined {
  if (type === "plan" || type === "file") return undefined;
  if (type === "level") return id;
  return levelIdOf(model, id);
}

/**
 * The height a room's marks are drawn again at: the top of its walls (its level's ceiling), or
 * the cut where that is lower — absolute metres, as `cut` is.
 */
export function roomLid(model: PlanModel, levelId: string, cut: number | null): number {
  const ceiling = elevationOf(model, levelId) + ceilingOf(levelSlice(model, levelId));
  return cut === null ? ceiling : Math.min(cut, ceiling);
}

/**
 * The box around a wall, an opening, a room, a piece, a stair, a level or the whole plan, as the
 * model holds it now: on its level, in the scene's heights.
 */
export function markBox(type: ApprovalTarget["type"], id: string, model: PlanModel): MarkBox | null {
  const b = flatBox(type, id, model);
  return b && lifted(b, elevationOf(model, markLevel(type, id, model)));
}

/** The box as if its level stood on the ground. */
function flatBox(type: ApprovalTarget["type"], id: string, model: PlanModel): MarkBox | null {
  switch (type) {
    case "wall": {
      const w = model.walls.find((x) => x.id === id);
      if (!w) return null;
      // a curved wall: its footprint, mitred against the walls of its level as the model builds it
      if (isCurved(w)) return ringBox(tessellateOutline(wallFootprint(w, model.walls.filter((x) => x.levelId === w.levelId)).outline, WALL_SOLID.tessellation), 0, w.height, wallPointAt(w, 0.5));
      return {
        cx: (w.ax + w.bx) / 2,
        cz: (w.ay + w.by) / 2,
        w: segLen(w.ax, w.ay, w.bx, w.by),
        d: w.thickness,
        y0: 0,
        y1: w.height,
        ry: -Math.atan2(w.by - w.ay, w.bx - w.ax),
      };
    }
    case "door":
    case "window": {
      const o = model.openings.find((x) => x.id === id);
      const w = o && model.walls.find((x) => x.id === o.wallId);
      if (!o || !w) return null;
      // across its chord, from one cut to the other (on a straight wall, its span along the wall)
      const [t0, t1] = openingSpan(w, o);
      const a = wallPointAt(w, t0);
      const b = wallPointAt(w, t1);
      return {
        cx: (a.x + b.x) / 2,
        cz: (a.y + b.y) / 2,
        w: segLen(a.x, a.y, b.x, b.y),
        d: w.thickness,
        y0: o.sill,
        y1: o.sill + o.height,
        ry: -Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    case "room": {
      const r = model.rooms.find((x) => x.id === id);
      if (!r) return null;
      const b = outlineRect(r.points);
      if (b) return { cx: b.x + b.w / 2, cz: b.y + b.h / 2, w: b.w, d: b.h, y0: FLOOR_TOP, y1: FLOOR_TOP, ry: 0 };
      // any other outline is marked as it is drawn
      return ringBox(tessellateOutline(r.points, WALL_SOLID.tessellation), FLOOR_TOP, FLOOR_TOP, outlineAnchor(r.points));
    }
    case "item": {
      const it = model.items.find((x) => x.id === id);
      const def = it && catalogOf(model).get(it.kind);
      if (!it || !def) return null;
      // a piece's fittings (a tap, a television, a headboard) may stand over its catalogue height
      const top = FLOOR_TOP + def.h + riseOf(def);
      return { cx: it.x, cz: it.y, w: def.w, d: def.d, y0: FLOOR_TOP, y1: top, ry: (it.rotation * Math.PI) / 180 };
    }
    case "stair": {
      const s = model.stairs.find((x) => x.id === id);
      const g = s && stairGeometryIn(model, s);
      if (!g) return null;
      // a straight flight is its own turned box; an L's two flights and landing, their bounds
      if (g.footprint.length === 1) {
        const r = g.footprint[0];
        return { cx: r.cx, cz: r.cy, w: 2 * r.hw, d: 2 * r.hd, y0: FLOOR_TOP, y1: FLOOR_TOP + g.rise, ry: -r.rot };
      }
      const { minX, minY, maxX, maxY } = g.box;
      return { cx: (minX + maxX) / 2, cz: (minY + maxY) / 2, w: maxX - minX, d: maxY - minY, y0: FLOOR_TOP, y1: FLOOR_TOP + g.rise, ry: 0 };
    }
    case "column": {
      const c = model.columns.find((x) => x.id === id);
      const h = c && columnHeight(model, c);
      if (!c || h === undefined) return null;
      // a round one is marked by its own outline, as it is drawn
      if (isRound(c)) return ringBox(columnFootprint(c), 0, h, c);
      return { cx: c.x, cz: c.y, w: c.w, d: c.d, y0: 0, y1: h, ry: (c.rotation * Math.PI) / 180 };
    }
    // a level: the extent of what stands on it, as the plan's is drawn
    case "level":
      return model.levels.some((l) => l.id === id) ? extentBox(levelSlice(model, id)) : null;
    case "plan": {
      const b = extentBox(model);
      if (!b) return null;
      // every storey, up to the tallest wall on the top one that has walls
      const top = Math.max(b.y1, ...model.walls.map((w) => elevationOf(model, w.levelId) + w.height));
      return { ...b, y1: top };
    }
    // a file a call would download is nowhere in the scene
    case "file":
      return null;
  }
}

// ---------------------------------------------------------------------------- materials

/** How a stretch of outline is drawn: where it is seen, where it is hidden, or over everything. */
type Pass = "seen" | "hidden" | "over";

const lineMaterial = (color: string, width: number, pass: Pass): ScreenLineMaterial =>
  keepStatic(
    new ScreenLineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity: pass === "hidden" ? MARKS.hiddenOpacity : 1,
      depthTest: pass === "seen",
      depthWrite: false,
      dashed: pass === "hidden",
      dashSize: MARKS.dash,
      gapSize: MARKS.gap,
    }),
  );

/** One colour's outline in each pass, and the casing under it where it is drawn whole. */
const outlineMaterials = (color: string) =>
  Object.freeze({
    seen: lineMaterial(color, MARKS.width, "seen"),
    hidden: lineMaterial(color, MARKS.width, "hidden"),
    over: lineMaterial(color, MARKS.width, "over"),
  });

export const MARK_MATERIALS = Object.freeze({
  selection: outlineMaterials(SCENE_MARK.selection.hex),
  agent: outlineMaterials(SCENE_MARK.agent.hex),
  destructive: outlineMaterials(SCENE_MARK.destructive.hex),
  casing: Object.freeze({
    seen: lineMaterial(SCENE_MARK.casing.hex, MARKS.casing, "seen"),
    over: lineMaterial(SCENE_MARK.casing.hex, MARKS.casing, "over"),
  }),
});

const allLines: readonly ScreenLineMaterial[] = [
  ...Object.values(MARK_MATERIALS.selection),
  ...Object.values(MARK_MATERIALS.agent),
  ...Object.values(MARK_MATERIALS.destructive),
  ...Object.values(MARK_MATERIALS.casing),
];

/** The canvas's size in CSS pixels: an outline's width on screen is reckoned from it. */
export function setMarkResolution(width: number, height: number): void {
  for (const m of allLines) m.resolution.set(width, height);
}

/** The hatch: one diagonal line per tile of the texture, which repeats every MARKS.hatchPeriod metres. */
export function hatchImage(size: number = MARKS.hatchTexture): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = ((x + y + 1) / size) % 1;
      const on = along < MARKS.hatchLine ? 255 : 0;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = on;
      data[i + 3] = 255;
    }
  }
  return data;
}

let hatchTexture: THREE.DataTexture | null = null;
function hatchMap(): THREE.DataTexture {
  if (hatchTexture) return hatchTexture;
  const size = MARKS.hatchTexture;
  const texture = keepStatic(new THREE.DataTexture(hatchImage(size), size, size));
  texture.name = "mark:hatch";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return (hatchTexture = texture);
}

const flatMaterial = (params: THREE.MeshBasicMaterialParameters) =>
  keepStatic(
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
      fog: false,
      ...params,
    }),
  );

let hatchMaterials: { seen: THREE.MeshBasicMaterial; over: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial } | null = null;
/** The hatch over a target (seen where it is), the hatch over everything, and the wash under it. */
export function hatch(): { seen: THREE.MeshBasicMaterial; over: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial } {
  if (hatchMaterials) return hatchMaterials;
  const params = { color: SCENE_MARK.destructiveInk.hex, alphaMap: hatchMap(), opacity: MARKS.hatchOpacity };
  hatchMaterials = {
    seen: flatMaterial(params),
    over: flatMaterial({ ...params, depthTest: false }),
    fill: flatMaterial({ color: SCENE_MARK.destructive.hex, opacity: MARKS.lidFill, depthTest: false }),
  };
  return hatchMaterials;
}

// ---------------------------------------------------------------------------- geometry

const flat = (b: MarkBox) => b.y1 - b.y0 < 1e-6;

/** A ring's signed area. */
const ringArea = (pts: readonly Pt[]): number => pts.reduce((sum, p, i) => sum + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;

/**
 * A ring grown by `by` on every side: each corner moved out along its mitre, so every edge stands
 * `by` off the one it grows from (a corner sharper than MARKS.mitreLimit allows is held there).
 */
export function grownRing(pts: readonly Pt[], by: number): Pt[] {
  const n = pts.length;
  const sign = ringArea(pts) >= 0 ? 1 : -1;
  const normal = (p: Pt, q: Pt): Pt => {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (sign * (q.y - p.y)) / len, y: (-sign * (q.x - p.x)) / len };
  };
  return pts.map((p, i) => {
    const n0 = normal(pts[(i - 1 + n) % n], p);
    const n1 = normal(p, pts[(i + 1) % n]);
    // the mitre: the corner's bisector, as long as it takes to stand `by` off both edges
    const k = Math.min(MARKS.mitreLimit, 2 / Math.max(1e-9, 1 + n0.x * n1.x + n0.y * n1.y));
    return { x: p.x + ((n0.x + n1.x) / 2) * k * by, y: p.y + ((n0.y + n1.y) / 2) * k * by };
  });
}

/** Whether a ring turns at its point i by more than MARKS.ringCorner degrees: a corner its outline draws an upright line at. */
function cornerAt(pts: readonly Pt[], i: number): boolean {
  const n = pts.length;
  const a = pts[(i - 1 + n) % n];
  const p = pts[i];
  const b = pts[(i + 1) % n];
  const turn = Math.abs(Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)));
  return turn > (MARKS.ringCorner * Math.PI) / 180;
}

/** A box's outline, `pad` off it on every side (a flat box: its rectangle), as segment end points. */
export function outlinePositions(b: MarkBox, pad: number): number[] {
  if (b.ring) {
    const ring = grownRing(b.ring, pad);
    const positions: number[] = [];
    const loop = (y: number) =>
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        positions.push(p.x, y, p.y, q.x, y, q.y);
      });
    if (flat(b)) {
      loop(b.y0 + MARKS.lift);
      return positions;
    }
    loop(b.y0 - pad);
    loop(b.y1 + pad);
    ring.forEach((p, i) => {
      if (cornerAt(ring, i)) positions.push(p.x, b.y0 - pad, p.y, p.x, b.y1 + pad, p.y);
    });
    return positions;
  }
  const hw = b.w / 2 + pad;
  const hd = b.d / 2 + pad;
  if (flat(b)) {
    const y = b.y0 + MARKS.lift;
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      positions.push(ax, y, az, bx, y, bz);
    }
    return positions;
  }
  const box = new THREE.BoxGeometry(2 * hw, b.y1 - b.y0 + 2 * pad, 2 * hd);
  box.translate(0, (b.y0 + b.y1) / 2, 0);
  const edges = new THREE.EdgesGeometry(box);
  const positions = Array.from(edges.getAttribute("position").array as Float32Array);
  box.dispose();
  edges.dispose();
  return positions;
}

/**
 * A box's hatched skin, `pad` off it: its sides and top (a flat box: its rectangle), with
 * texture coordinates in hatch periods, so the hatch is the same size on every face and every
 * target.
 */
export function hatchGeometry(b: MarkBox, pad: number): THREE.BufferGeometry {
  if (b.ring) return ringHatch(b.ring, b, pad);
  const w = b.w + 2 * pad;
  const d = b.d + 2 * pad;
  const p = MARKS.hatchPeriod;
  if (flat(b)) {
    const plane = new THREE.PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, b.y0 + MARKS.lift, 0);
    scaleUVs(plane, () => [w / p, d / p]);
    return plane;
  }
  const h = b.y1 - b.y0 + 2 * pad;
  const box = new THREE.BoxGeometry(w, h, d);
  box.translate(0, (b.y0 + b.y1) / 2, 0);
  // BoxGeometry's faces, four vertices each: +x, -x, +y, -y, +z, -z
  const faceSize: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  scaleUVs(box, (vertex) => faceSize[Math.floor(vertex / 4)].map((s) => s / p) as [number, number]);
  return box;
}

/** A ring's hatched skin, `pad` off it: its top (a flat ring: itself) and, standing, its sides, in hatch periods. */
function ringHatch(outline: readonly Pt[], b: MarkBox, pad: number): THREE.BufferGeometry {
  const ring = grownRing(outline, pad);
  const p = MARKS.hatchPeriod;
  const positions: number[] = [];
  const uvs: number[] = [];
  const top = flat(b) ? b.y0 + MARKS.lift : b.y1 + pad;
  for (const tri of triangulate(ring)) {
    for (const k of tri) {
      positions.push(ring[k].x, top, ring[k].y);
      uvs.push(ring[k].x / p, ring[k].y / p);
    }
  }
  if (!flat(b)) {
    const y0 = b.y0 - pad;
    let around = 0;
    ring.forEach((a, i) => {
      const c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const quad: [Pt, number, number][] = [
        [a, y0, around],
        [c, y0, around + len],
        [c, top, around + len],
        [a, y0, around],
        [c, top, around + len],
        [a, top, around],
      ];
      for (const [q, y, u] of quad) {
        positions.push(q.x, y, q.y);
        uvs.push(u / p, y / p);
      }
      around += len;
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function scaleUVs(geometry: THREE.BufferGeometry, scale: (vertex: number) => [number, number]): void {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = scale(i);
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

const notPickable = <T extends THREE.Object3D>(o: T, order: number): T => {
  o.raycast = () => {};
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = order;
  return o;
};

/** The order the marks draw in, after the scene: casing, line, hidden stretch; then a room's lid over all. */
const ORDER = Object.freeze({ hatch: 1, casing: 2, line: 3, hidden: 4, fill: 5, lidHatch: 6, lidCasing: 7, lidLine: 8 });

/** One line set over the same segments. */
const lines = (positions: readonly number[], material: ScreenLineMaterial, order: number): THREE.Mesh => notPickable(screenLines(positions, material), order);

type Colours = (typeof MARK_MATERIALS)["selection"];

/**
 * One outline in a colour: the casing and the line where it is seen, and (`depth`) the hidden
 * stretch dashed, or (`depthNoHidden`, a room's) not at all; `over`: the outline drawn over
 * everything instead.
 */
function outline(b: MarkBox, colours: Colours, mode: "depth" | "depthNoHidden" | "over"): THREE.Group {
  const g = new THREE.Group();
  const positions = outlinePositions(b, MARKS.outline);
  if (mode === "over") {
    g.add(lines(positions, MARK_MATERIALS.casing.over, ORDER.lidCasing), lines(positions, colours.over, ORDER.lidLine));
    return g;
  }
  g.add(lines(positions, MARK_MATERIALS.casing.seen, ORDER.casing), lines(positions, colours.seen, ORDER.line));
  if (mode === "depth") g.add(lines(positions, colours.hidden, ORDER.hidden));
  return g;
}

function place(o: THREE.Object3D, b: MarkBox): THREE.Object3D {
  o.position.set(b.cx, 0, b.cz);
  o.rotation.y = b.ry;
  return o;
}

/** A room's box laid at the lid's level: the top of its walls, or the cut. */
const lidOf = (b: MarkBox, level: number): MarkBox => ({ ...b, y0: level, y1: level });

// ---------------------------------------------------------------------------- the marks

export class SceneMarks {
  readonly root = new THREE.Group();
  private signature = "";

  constructor() {
    this.root.name = "marks";
  }

  /**
   * Show `selected` and the targets of the pending requests, as `model` holds them; a room's
   * marks are drawn again at `lid` (the top of the walls, or the cut: a height, or one for each
   * room's level). Only what stands on a level in `shown` is marked (none: every level).
   * Returns whether anything changed on screen.
   */
  update(
    model: PlanModel,
    selected: Selected | null,
    pending: readonly ApprovalTarget[],
    lid: number | ((levelId: string) => number) = FLOOR_TOP,
    shown: ReadonlySet<string> | null = null,
    focus: readonly Focused[] = [],
  ): boolean {
    const visible = (type: ApprovalTarget["type"], id: string) => {
      const level = markLevel(type, id, model);
      return shown === null || level === undefined || shown.has(level);
    };
    const lidOfRoom = (id: string) => (typeof lid === "number" ? lid : lid(markLevel("room", id, model) ?? ""));
    const sel = selected && visible(selected.type, selected.id) ? { type: selected.type, id: selected.id, box: markBox(selected.type, selected.id, model) } : null;
    const targets = pending.flatMap((t) => {
      const b = visible(t.type, t.id) ? markBox(t.type, t.id, model) : null;
      return b ? [{ type: t.type, id: t.id, box: b }] : [];
    });
    const agentAt = focus.flatMap((t) => {
      const b = visible(t.type, t.id) ? markBox(t.type, t.id, model) : null;
      return b ? [{ type: t.type, id: t.id, box: b }] : [];
    });
    const lids = [...targets, ...(sel ? [sel] : [])].filter((t) => t.type === "room").map((t) => lidOfRoom(t.id));
    const signature = JSON.stringify([sel, targets, lids, agentAt]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    const destructive = MARK_MATERIALS.destructive;
    for (const { type, id, box } of targets) {
      const mark = new THREE.Group();
      mark.name = "mark:pending";
      if (type === "room") {
        // on the floor, where it is seen; over the room at its lid, over whatever stands in it
        const top = lidOf(box, lidOfRoom(id));
        mark.add(
          notPickable(new THREE.Mesh(hatchGeometry(box, MARKS.outline / 2), hatch().seen), ORDER.hatch),
          outline(box, destructive, "depthNoHidden"),
          notPickable(new THREE.Mesh(hatchGeometry(top, MARKS.outline), hatch().fill), ORDER.fill),
          notPickable(new THREE.Mesh(hatchGeometry(top, MARKS.outline), hatch().over), ORDER.lidHatch),
          outline(top, destructive, "over"),
        );
      } else {
        // a request to clear the plan is its extent outlined, as the plan draws it; the rest are hatched
        if (type !== "plan" && type !== "level") mark.add(notPickable(new THREE.Mesh(hatchGeometry(box, MARKS.outline / 2), hatch().seen), ORDER.hatch));
        mark.add(outline(box, destructive, "depth"));
      }
      this.root.add(place(mark, box));
    }
    // what the agent is touching: outlined in its colour, a room on its floor, the rest as a selection is
    for (const { type, box } of agentAt) {
      const mark = new THREE.Group();
      mark.name = "mark:agent";
      mark.add(outline(box, MARK_MATERIALS.agent, type === "room" ? "depthNoHidden" : "depth"));
      this.root.add(place(mark, box));
    }
    if (sel?.box) {
      const selection = MARK_MATERIALS.selection;
      const mark = new THREE.Group();
      mark.name = "mark:selection";
      if (sel.type === "room") mark.add(outline(sel.box, selection, "depthNoHidden"), outline(lidOf(sel.box, lidOfRoom(sel.id)), selection, "over"));
      else mark.add(outline(sel.box, selection, "depth"));
      this.root.add(place(mark, sel.box));
    }
    return true;
  }

  /** How many marks are showing, by what they mark. */
  get counts(): { selection: number; pending: number } {
    let selection = 0;
    let pending = 0;
    for (const c of this.root.children) {
      if (c.name === "mark:selection") selection++;
      else if (c.name === "mark:pending") pending++;
    }
    return { selection, pending };
  }

  /** How many of the agent's marks are showing (the shared session). */
  get agentCount(): number {
    return this.root.children.filter((c) => c.name === "mark:agent").length;
  }

  private clear(): void {
    for (const c of [...this.root.children]) {
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.root.remove(c);
    }
  }

  dispose(): void {
    this.clear();
    this.signature = "";
  }
}
