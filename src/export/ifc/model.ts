/**
 * The plan as an IFC4 building model: what each part of the plan becomes, and where.
 *
 *   plan                      → IfcProject (SI metres, radians; a 3D "Model" context with Body
 *                               and Axis subcontexts, a 2D "Plan" one with FootPrint)
 *                               > IfcSite > IfcBuilding (named after the plan)
 *   level                     → IfcBuildingStorey, at its elevation (IfcRelAggregates), standing
 *                               on one IfcSlab FLOOR: under its rooms and its walls to their joints
 *                               (model/floors.ts, the 3D view's own slab outline), opened by an
 *                               IfcOpeningElement for every stair rising through it from below
 *   wall                      → IfcWall STANDARD: an Axis line and a Body extruded from its
 *                               centreline, butt-jointed to the walls it meets (model/joints.ts:
 *                               one wall fills each corner, the others stop at its face, so no two
 *                               bodies overlap), with a one-layer IfcMaterialLayerSetUsage,
 *                               Pset_WallCommon (IsExternal, when the rooms tell) and
 *                               Qto_WallBaseQuantities. A curved wall's Axis is its arc and its
 *                               Body is extruded from its closed curved outline (both an
 *                               IfcIndexedPolyCurve with an IfcArcIndex per arc): its two faces
 *                               concentric arcs, run on along their tangents or trimmed back along
 *                               the arc to the same butt joints
 *   door / window             → an IfcOpeningElement voiding its wall (IfcRelVoidsElement),
 *                               filled (IfcRelFillsElement) by an IfcDoor / IfcWindow; a door's
 *                               placement faces the way its leaf swings (see doorFacing). In a
 *                               curved wall the opening is placed on its chord (from one cut to
 *                               the other, square to the arc at t ± half its width along it), its
 *                               void the stretch of the wall between the two radial cuts, and its
 *                               door or window spans the chord: OverallWidth is the chord
 *   room                      → an IfcSpace (LongName = its label) aggregated under its storey,
 *                               its FootPrint and Body its outline (a polyline, or with arcs an
 *                               IfcIndexedPolyCurve), with Pset_SpaceCommon and
 *                               Qto_SpaceBaseQuantities; and its floor
 *                               finish as an IfcCovering FLOORING laid on the slab, covering the
 *                               space (IfcRelCoversSpaces), in its finish's material
 *   stair                     → IfcStair, aggregating its IfcStairFlights (one per flight, with
 *                               risers, treads, riser height and going) and, for an L-shaped one,
 *                               its landing as an IfcSlab LANDING; Pset_StairCommon
 *   item                      → IfcFurniture with its catalogue box as body, standing on the floor
 *                               finish; a supplier product carries its sku and vendor in the
 *                               plan's own Alza_Product set
 *
 * Every element is contained in its level's storey (IfcRelContainedInSpatialStructure), placed
 * relative to it, and has a GlobalId derived from the plan's id and its own (guid.ts). Every name
 * the file holds is plan text made a clean label (model/text.ts, cut to STRING(255)).
 *
 * Plan coordinates have y growing down the sheet; IFC's are right-handed with Z up. A plan
 * point (x, y) is IFC (x, -y): the plan seen from above is the model seen from above.
 */

import {
  concentricBulge,
  isCurved,
  isStraight,
  outlineArea,
  outlineDistance,
  outlineEdges,
  outlinePerimeter,
  pointInOutline,
  pointOnEdge,
  roomArea,
  tessellateOutline,
  intersectCurves,
  wallDistance,
  wallEdge,
  wallLength,
  type Curve,
  wallPointAt,
  wallTangentAt,
  closestOnEdge,
} from "../../model/shapes";
import type { Item, Level, Opening, PlanModel, Room, RoomVertex, Stair, Wall } from "../../model/types";
import { catalogOf, SUPPLIER_KIND_PREFIX, isSupplierKind } from "../../model/catalog";
import { rectCorners, segLen, type ORect, type Pt } from "../../model/geometry";
import { levelSlice, levelsOf, slabUnderside, stairGeometryIn, stairwellsOf, type LevelInfo } from "../../model/levels";
import { buttJointExtensions, offsetCurve } from "../../model/joints";
import { slabOutline, stairwellPolys } from "../../model/floors";
import { piecesArea, regionPieces, type Piece, type Poly } from "../../model/region";
import { stairSplit } from "../../model/stairs";
import { cleanText } from "../../model/text";
import { DOOR_SWING_DEFAULTS, DOUBLE_DOOR_CLEAR, FLOOR_FINISH_DEPTH, REGION, SLAB_THICKNESS, SUPPLIER, TEXT, WALL_IN_LINE_SINE, WALL_JOINT_REACH, WALL_MITRE_LIMIT } from "../../model/limits";
import { FLOOR_MATERIAL, FURNITURE_TYPE, IFC_NAMES, IFC_PSETS, IFC_REPRESENTATION as REP, IFC_SIZES, MODEL_PRECISION, STEP_LABEL_MAX, WALL_MATERIAL } from "./config";
import { IfcEntities, type Context, type CurveSegment, type ElementHead, type LayerSetUsage, type LocalPlacement, type Material, type ProductShape, type PropertyValue } from "./entities";
import type { Ref } from "./step";

const DEG = Math.PI / 180;

/** A plan point as IFC coordinates: y flipped, so the model keeps the plan's handedness seen from above. */
const at = (x: number, y: number): [number, number] => [x, -y];

/** An oriented plan rectangle's frame in IFC: its centre, and its local x axis. */
const rectFrame = (r: ORect): { centre: [number, number]; xAxis: [number, number] } => ({
  centre: at(r.cx, r.cy),
  // the plan's local x axis is (cos rot, sin rot); with y flipped it is (cos -rot, sin -rot)
  xAxis: [Math.cos(r.rot), -Math.sin(r.rot)],
});

/** A room's outline, its arcs cut into pieces (limits.ts ARC_TESSELLATION): what regions are cut from. */
const roomPoly = (r: Room): Poly => tessellateOutline(r.points);

const inRoom = (rooms: readonly Room[], x: number, y: number): boolean => rooms.some((r) => pointInOutline({ x, y }, r.points) || outlineDistance({ x, y }, r.points) < 1e-9);

/**
 * A frame on the plan: an origin and the unit direction of its x axis. A plan point's coordinates
 * in it, as IFC reads them (IFC's x is the plan's, its y the plan's flipped, so the frame's y axis
 * is a quarter turn counter-clockwise from x seen from above).
 */
interface PlanFrame {
  readonly o: Pt;
  readonly d: Pt;
}
function inFrame(f: PlanFrame, p: Pt): [number, number] {
  const [px, py] = at(p.x - f.o.x, p.y - f.o.y);
  const [dx, dy] = at(f.d.x, f.d.y);
  return [px * dx + py * dy, -px * dy + py * dx];
}
/** A plan direction in a frame, as IFC reads it. */
function directionIn(f: PlanFrame, d: Pt): [number, number] {
  return inFrame({ o: { x: 0, y: 0 }, d: f.d }, d);
}
const WORLD_FRAME: PlanFrame = { o: { x: 0, y: 0 }, d: { x: 1, y: 0 } };

/**
 * A closed outline on the plan (shapes.ts: vertex i carries the bulge of the edge to i + 1) as an
 * IFC curve in a frame: a closed IfcPolyline when every edge is straight, else an
 * IfcIndexedPolyCurve whose arcs are IfcArcIndex segments through each arc's middle.
 */
function outlineCurve(ifc: IfcEntities, points: readonly RoomVertex[], frame: PlanFrame = WORLD_FRAME) {
  const edges = outlineEdges(points);
  if (edges.every((e) => isStraight(e.bulge))) {
    const ring = points.map((p) => inFrame(frame, p));
    return ifc.polyline([...ring, ring[0]]);
  }
  const coords: [number, number][] = [];
  const segments: CurveSegment[] = [];
  const corner: number[] = [];
  for (const e of edges) {
    corner.push(coords.push(inFrame(frame, e.a)));
    if (!isStraight(e.bulge)) coords.push(inFrame(frame, pointOnEdge(e, 0.5)));
  }
  edges.forEach((e, i) => {
    const from = corner[i];
    const to = corner[(i + 1) % edges.length];
    segments.push(isStraight(e.bulge) ? { line: [from, to] } : { arc: [from, from + 1, to] });
  });
  return ifc.indexedCurve(coords, segments);
}

/** Plan text as an IFC label or identifier: a clean name (model/text.ts), at most STRING(255). */
const label = (text: string): string => cleanText(text, STEP_LABEL_MAX);

/**
 * A piece of a region (model/region.ts: a trapezoid) as the corners of a closed profile in IFC,
 * counter-clockwise seen from above, a side the piece has no height at given once. Null for a
 * piece too thin to be a face.
 */
function pieceCorners(p: Piece): [number, number][] | null {
  const ring = [
    at(p.x0, p.lo0),
    at(p.x1, p.lo1),
    at(p.x1, p.hi1),
    at(p.x0, p.hi0),
  ].filter((q, i, all) => {
    const next = all[(i + 1) % all.length];
    return Math.hypot(q[0] - next[0], q[1] - next[1]) > REGION.edgeTolerance;
  });
  if (ring.length < 3) return null;
  const twiceArea = ring.reduce((sum, q, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + q[0] * next[1] - next[0] * q[1];
  }, 0);
  if (Math.abs(twiceArea) / 2 < MODEL_PRECISION * MODEL_PRECISION) return null;
  return twiceArea > 0 ? ring : ring.reverse();
}

/**
 * Whether a wall is an outside wall, read off the rooms on its level: a step past each face, at
 * a few points along it, lands in a room on one side only (outside) or on both (a partition).
 * Undefined when the rooms do not say (no room on either side), so the property is left out.
 */
export function wallIsExternal(wall: Wall, rooms: readonly Room[]): boolean | undefined {
  if (wallLength(wall) === 0) return undefined;
  const reach = wall.thickness / 2 + IFC_SIZES.roomProbe;
  let outside = 0;
  let inside = 0;
  for (const f of IFC_SIZES.roomProbeAt) {
    // square to the wall where it is probed: across a curved wall, along its radius
    const p = wallPointAt(wall, f);
    const u = wallTangentAt(wall, f);
    const [nx, ny] = [-u.y, u.x];
    const left = inRoom(rooms, p.x + nx * reach, p.y + ny * reach);
    const right = inRoom(rooms, p.x - nx * reach, p.y - ny * reach);
    if (left && right) inside++;
    else if (left !== right) outside++;
  }
  if (outside === inside) return undefined;
  return outside > inside;
}

/**
 * Which way a door's own placement faces, relative to its wall's frame (whose x axis runs A→B,
 * so its +Y is the left of A→B seen from above). IFC opens a swinging door towards its
 * placement's +Y, so the placement is turned half a turn about Z for a leaf that swings to the
 * right of A→B: either way, +Y is the side the leaf opens to. Null: the wall's own axes.
 */
export function doorFacing(opening: Opening): [number, number] | null {
  return (opening.side ?? DOOR_SWING_DEFAULTS.side) === "right" ? [-1, 0] : null;
}

/**
 * The IfcDoorTypeOperationEnum value of a door. IFC names a single swing by the side its hinges
 * are on as seen looking along the door placement's +Y, the way the leaf swings (doorFacing):
 * facing the side of the wall the leaf opens to, a leaf swinging to the right of A→B has the B
 * end on its left, one swinging to the left the A end. A door wide enough to hang as a pair
 * (DOUBLE_DOOR_CLEAR) swings both leaves one way.
 */
export function doorOperation(opening: Opening): string {
  if (opening.width > DOUBLE_DOOR_CLEAR) return "DOUBLE_DOOR_SINGLE_SWING";
  const hinge = opening.hinge ?? DOOR_SWING_DEFAULTS.hinge;
  const side = opening.side ?? DOOR_SWING_DEFAULTS.side;
  const leftEnd = side === "right" ? "b" : "a";
  return hinge === leftEnd ? "SINGLE_SWING_LEFT" : "SINGLE_SWING_RIGHT";
}

/** A wall's body on the plan as a building model has it: butt-jointed to the walls it meets (see buttBody). */
export interface ButtBody {
  /** its outline: its right face from A to B, its B end, its left face back, its A end */
  readonly outline: RoomVertex[];
  /** how far each end reaches past the wall's endpoint along its centreline's tangent (buttJointExtensions) */
  readonly ext: readonly [number, number];
  /** both ends square to a straight wall: its outline is a rectangle along it */
  readonly square: boolean;
}

/** The short arc's bulge from p to q round a circle's centre c. */
const bulgeRound = (c: Pt, p: Pt, q: Pt): number => {
  const [ux, uy, vx, vy] = [p.x - c.x, p.y - c.y, q.x - c.x, q.y - c.y];
  return Math.tan(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) / 4);
};

/** One end of a butt-jointed body: where its right and left faces stop, the faces they stop at, and the corner between those. */
interface ButtEnd {
  readonly right: Pt;
  readonly left: Pt;
  readonly rightFace: Curve | null;
  readonly leftFace: Curve | null;
  readonly via: Pt | null;
}

/**
 * A wall's body, butt-jointed to the walls it meets at any angle (model/joints.ts
 * buttJointExtensions says how far each end reaches along the centreline): each of its faces runs
 * on, or is cut back, to the face it meets there — a line, or an arc of a curved wall — so a wall
 * meeting another at 30 degrees stops exactly at its face, without a corner pushed into it.
 *  - An end cut back (it ends against walls it does not fill the corner of): each face stops at
 *    the first face of those walls it enters, within their bodies; where the two faces of the
 *    wall stop at different walls (at a node of three), the end runs through the corner between
 *    those faces.
 *  - An end reaching on (it fills an L corner): both faces run on to the far face of the wall it
 *    fills the corner against.
 *  - A free end, or one in line with the next wall: square.
 * A curved wall's faces are concentric arcs, run on along their circle.
 */
export function buttBody(wall: Wall, levelWalls: readonly Wall[]): ButtBody {
  const len = wallLength(wall);
  const butt = buttJointExtensions(wall, levelWalls);
  // a wall wholly inside the walls it meets would be cut to nothing, so it keeps its own length
  const ext: [number, number] = len + butt[0] + butt[1] > MODEL_PRECISION ? [butt[0], butt[1]] : [0, 0];
  const half = wall.thickness / 2;
  const faces = { left: offsetCurve(wall, half), right: offsetCurve(wall, -half) };
  const reach = WALL_MITRE_LIMIT * Math.max(wall.thickness, ...levelWalls.map((w) => w.thickness));
  let square = !isCurved(wall);
  /** the nearest of the points to q, within reach of it */
  const nearest = (pts: readonly Pt[], q: Pt): Pt | null =>
    pts.filter((h) => Math.hypot(h.x - q.x, h.y - q.y) <= reach).reduce<Pt | null>((best, h) => (!best || Math.hypot(h.x - q.x, h.y - q.y) < Math.hypot(best.x - q.x, best.y - q.y) ? h : best), null);
  /**
   * Whether q lies along a wall's body: beside its centreline, or past an end no further than that
   * end reaches on (buttJointExtensions) and the wall's own thickness, as far as a face cut along
   * another at an angle, or run on round an arc, can stand past the end of its centreline.
   */
  const alongBody = (o: Wall, q: Pt): boolean => {
    const [oa, ob] = buttJointExtensions(o, levelWalls);
    const c = closestOnEdge(wallEdge(o), q);
    if (c.t > 0 && c.t < 1) return true;
    const endT = c.t <= 0 ? 0 : 1;
    const u = wallTangentAt(o, endT);
    const p = wallPointAt(o, endT);
    const s = (q.x - p.x) * u.x + (q.y - p.y) * u.y;
    return (endT === 0 ? -s - Math.max(0, oa) : s - Math.max(0, ob)) <= o.thickness;
  };
  const cap = (end: "a" | "b"): ButtEnd => {
    const k = end === "a" ? 0 : 1;
    const p = wallPointAt(wall, k);
    const u = wallTangentAt(wall, k);
    const out = end === "a" ? { x: -u.x, y: -u.y } : u;
    // the walls met at this end, and each one's face toward this wall's body (its near face) and away (far)
    const met = levelWalls.flatMap((o) => {
      if (o.id === wall.id || wallLength(o) === 0 || wallDistance(p, o) >= WALL_JOINT_REACH) return [];
      const v = wallTangentAt(o, closestOnEdge(wallEdge(o), p).t);
      if (Math.abs(out.x * v.y - out.y * v.x) < WALL_IN_LINE_SINE) return [];
      const side = -Math.sign(v.y * out.x - v.x * out.y);
      // a wall this end runs into mid-span, or one that reaches on into the joint, is one it stops at first
      const oEnd = (["a", "b"] as const).find((q) => Math.hypot((q === "a" ? o.ax : o.bx) - p.x, (q === "a" ? o.ay : o.by) - p.y) < WALL_JOINT_REACH);
      const blocks = oEnd === undefined || buttJointExtensions(o, levelWalls)[oEnd === "a" ? 0 : 1] > 0;
      return [{ o, blocks, through: oEnd === undefined, near: offsetCurve(o, (side * o.thickness) / 2), far: offsetCurve(o, (-side * o.thickness) / 2) }];
    });
    if (ext[k] === 0) {
      // in line with the next wall: square, unless a wall runs on through the joint across both (a
      // cross), whose near face this end then stops at, as the next wall's does at its far side
      const cuts = met.filter((m) => m.through).flatMap((m) => intersectCurves({ kind: "line", p, d: out }, m.near).map((q) => (q.x - p.x) * out.x + (q.y - p.y) * out.y));
      if (cuts.length > 0) ext[k] = cuts.reduce((best, c) => (Math.abs(c) < Math.abs(best) ? c : best));
    }
    const e = ext[k];
    const tip = { x: p.x + out.x * e, y: p.y + out.y * e };
    // where each face would end, square to the tangent at the end
    const squared = (side: 1 | -1): Pt => ({ x: tip.x + u.y * half * side, y: tip.y - u.x * half * side });
    if (e === 0) return { right: squared(-1), left: squared(1), rightFace: null, leftFace: null, via: null };
    const atReach = (curve: Curve) => intersectCurves({ kind: "line", p, d: out }, curve).some((q) => Math.abs((q.x - p.x) * out.x + (q.y - p.y) * out.y - e) < 1e-7);
    const filled = met.find((m) => atReach(m.far));
    if (filled) {
      // this end fills the corner: both faces run on to the far face of the wall it meets
      const right = nearest(intersectCurves(faces.right, filled.far), squared(-1)) ?? squared(-1);
      const left = nearest(intersectCurves(faces.left, filled.far), squared(1)) ?? squared(1);
      return { right, left, rightFace: filled.far, leftFace: filled.far, via: null };
    }
    // cut back: each face stops at the first near face it enters, within that wall's body, of the
    // walls that run on through the joint or reach into it if there are any
    const blockers = met.some((m) => m.blocks) ? met.filter((m) => m.blocks) : met;
    const stop = (mine: Curve, side: 1 | -1): { at: Pt; face: Curve | null } => {
      const guess = squared(side);
      let best: { at: Pt; face: Curve; s: number } | null = null;
      for (const m of blockers) {
        const hit = nearest(intersectCurves(mine, m.near), guess);
        if (!hit || !alongBody(m.o, hit)) continue;
        const s = (hit.x - p.x) * out.x + (hit.y - p.y) * out.y;
        if (!best || s < best.s) best = { at: hit, face: m.near, s };
      }
      return best ? { at: best.at, face: best.face } : { at: guess, face: null };
    };
    const r = stop(faces.right, -1);
    const l = stop(faces.left, 1);
    const via = r.face && l.face && r.face !== l.face ? nearest(intersectCurves(r.face, l.face), p) : null;
    return { right: r.at, left: l.at, rightFace: r.face, leftFace: l.face, via };
  };
  const a = cap("a");
  const b = cap("b");
  const sq = (q: Pt, r: Pt) => Math.hypot(q.x - r.x, q.y - r.y) <= MODEL_PRECISION;
  if (!isCurved(wall)) {
    const ends = [
      [a, 0],
      [b, 1],
    ] as const;
    for (const [c, t] of ends) {
      const e = t === 0 ? ext[0] : ext[1];
      const p = wallPointAt(wall, t);
      const u = wallTangentAt(wall, t);
      const out = t === 0 ? { x: -u.x, y: -u.y } : u;
      const tip = { x: p.x + out.x * e, y: p.y + out.y * e };
      if (c.via || !sq(c.right, { x: tip.x - u.y * half, y: tip.y + u.x * half }) || !sq(c.left, { x: tip.x + u.y * half, y: tip.y - u.x * half })) square = false;
    }
  }
  const centre = wallEdge(wall);
  const along = (face: Curve | null, from: Pt, to: Pt) => (face?.kind === "circle" ? bulgeRound(face.c, from, to) : 0);
  const ring: RoomVertex[] = [];
  const add = (p: Pt, bulge: number) => {
    const last = ring[ring.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < MODEL_PRECISION) {
      // the same corner twice: the edge from it is the one that follows
      ring[ring.length - 1] = isStraight(bulge) ? { x: last.x, y: last.y } : { x: last.x, y: last.y, bulge };
      return;
    }
    ring.push(isStraight(bulge) ? { x: p.x, y: p.y } : { x: p.x, y: p.y, bulge });
  };
  add(a.right, concentricBulge(centre, a.right, b.right));
  if (b.via) {
    add(b.right, along(b.rightFace, b.right, b.via));
    add(b.via, along(b.leftFace, b.via, b.left));
  } else add(b.right, along(b.rightFace, b.right, b.left));
  add(b.left, -concentricBulge(centre, a.left, b.left));
  if (a.via) {
    add(a.left, along(a.leftFace, a.left, a.via));
    add(a.via, along(a.rightFace, a.via, a.right));
  } else add(a.left, along(a.leftFace, a.left, a.right));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < MODEL_PRECISION) ring.pop();
  return { outline: ring, ext, square };
}

/**
 * The stretch of a curved wall between its centreline's parameters t0 and t1, `reach` to either
 * side of the centreline along its radius: an opening's void, between two radial cuts.
 */
export function arcBand(wall: Wall, t0: number, t1: number, reach: number): RoomVertex[] {
  const centre = wallEdge(wall);
  const at = (t: number, side: 1 | -1): Pt => {
    const p = wallPointAt(wall, t);
    const u = wallTangentAt(wall, t);
    return { x: p.x + u.y * reach * side, y: p.y - u.x * reach * side };
  };
  const [r0, r1, l1, l0] = [at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1)];
  return [
    { ...r0, bulge: concentricBulge(centre, r0, r1) },
    { ...r1 },
    { ...l1, bulge: -concentricBulge(centre, l0, l1) },
    { ...l0 },
  ];
}

/** The plain-language counts of what was exported, by IFC class. */
export interface IfcElementCounts {
  storeys: number;
  walls: number;
  doors: number;
  windows: number;
  openings: number;
  slabs: number;
  coverings: number;
  spaces: number;
  stairs: number;
  stairFlights: number;
  furniture: number;
}

/** Builds the plan's IFC model into a STEP file, entity by entity. */
export class PlanToIfc {
  readonly ifc = new IfcEntities();
  private body!: Context;
  private axis!: Context;
  private footPrint!: Context;
  private plasterMaterial: Material | null = null;
  private readonly wallUsages = new Map<number, { usage: LayerSetUsage; walls: Ref[] }>();
  private readonly slabs: Ref[] = [];
  private readonly floorMaterials = new Map<string, { material: Material; coverings: Ref[] }>();

  constructor(private readonly model: PlanModel) {}

  /**
   * The GlobalId of `key` in this plan: keyed by the plan's own id as well as the entity's, so
   * the same plan exported again keeps every GlobalId, and no two plans share one, even where
   * their entities have the same ids (every plan's ground level is "level_ground").
   */
  private guid(key: string): string {
    return this.ifc.guid(`${this.model.id}:${key}`);
  }

  /** The plaster walls and slabs are written in, one material for both. */
  private plaster(): Material {
    return (this.plasterMaterial ??= this.ifc.material(WALL_MATERIAL.name, WALL_MATERIAL.category));
  }

  /** A body extruded straight up from `base` over an oriented rectangle. */
  private boxSolid(r: ORect, depth: number, base = 0) {
    const { centre, xAxis } = rectFrame(r);
    return this.ifc.extrusion(this.ifc.rectangle(centre, 2 * r.hw, 2 * r.hd, xAxis), depth, [0, 0, base]);
  }

  /** A region's pieces, each extruded straight up from `base`: the solids of one flat body. */
  private regionSolids(pieces: readonly Piece[], depth: number, base = 0) {
    return pieces.flatMap((p) => {
      const corners = pieceCorners(p);
      return corners ? [this.ifc.extrusion(this.ifc.polygon(corners), depth, [0, 0, base])] : [];
    });
  }

  private bodyShape(items: Parameters<IfcEntities["shapeRepresentation"]>[3]): ProductShape | null {
    if (items.length === 0) return null;
    return this.ifc.productShape([this.ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, items)]);
  }

  private properties(owner: Ref, key: string, set: string, values: readonly [string, PropertyValue][]): void {
    if (values.length === 0) return;
    const pset = this.ifc.propertySet(this.guid(`pset:${set}:${key}`), set, values.map(([name, value]) => this.ifc.property(name, value)));
    this.ifc.definesByProperties(this.guid(`rel:${set}:${key}`), [owner], pset);
  }

  private quantities(owner: Ref, key: string, set: string, values: readonly ["length" | "area" | "volume", string, number][]): void {
    const qto = this.ifc.elementQuantity(this.guid(`qto:${set}:${key}`), set, values.map(([kind, name, value]) => this.ifc.quantity(kind, name, value)));
    this.ifc.definesByProperties(this.guid(`rel:${set}:${key}`), [owner], qto);
  }

  /** The whole model, written. */
  build(): void {
    const ifc = this.ifc;
    const model3d = ifc.context(REP.model, 3);
    const plan2d = ifc.context(REP.plan, 2);
    this.body = ifc.subContext(REP.body, REP.model, model3d, "MODEL_VIEW");
    this.axis = ifc.subContext(REP.axis, REP.model, model3d, "GRAPH_VIEW");
    this.footPrint = ifc.subContext(REP.footPrint, REP.plan, plan2d, "PLAN_VIEW");
    const units = ifc.units([
      ifc.siUnit("LENGTHUNIT", "METRE"),
      ifc.siUnit("AREAUNIT", "SQUARE_METRE"),
      ifc.siUnit("VOLUMEUNIT", "CUBIC_METRE"),
      ifc.siUnit("PLANEANGLEUNIT", "RADIAN"),
    ]);
    const name = cleanText(this.model.name, TEXT.planName) || IFC_NAMES.building;
    const project = ifc.project(this.guid("project"), name, [model3d, plan2d], units);

    const sitePlacement = ifc.localPlacement(null, ifc.placement3([0, 0, 0]));
    const site = ifc.site(this.guid("site"), IFC_NAMES.site, sitePlacement);
    const buildingPlacement = ifc.localPlacement(sitePlacement, ifc.placement3([0, 0, 0]));
    const building = ifc.building(this.guid("building"), name, buildingPlacement);
    ifc.aggregates(this.guid("rel:aggregates:project"), project, [site]);
    ifc.aggregates(this.guid("rel:aggregates:site"), site, [building]);

    const storeys = levelsOf(this.model).map((info) => this.storey(info, buildingPlacement));
    ifc.aggregates(this.guid("rel:aggregates:building"), building, storeys);

    for (const [thickness, { usage, walls }] of this.wallUsages) ifc.associatesMaterial(this.guid(`rel:material:wall:${thickness}`), walls, usage);
    if (this.slabs.length > 0) ifc.associatesMaterial(this.guid("rel:material:slab"), this.slabs, this.plaster());
    for (const [finish, { material, coverings }] of this.floorMaterials) ifc.associatesMaterial(this.guid(`rel:material:floor:${finish}`), coverings, material);
  }

  /** One level: its storey, and everything on it. */
  private storey(info: LevelInfo, buildingPlacement: LocalPlacement): Ref<"IFCBUILDINGSTOREY"> {
    const ifc = this.ifc;
    const { level } = info;
    const placement = ifc.localPlacement(buildingPlacement, ifc.placement3([0, 0, info.elevation]));
    const storey = ifc.storey(this.guid(`level:${level.id}`), label(cleanText(level.name) || level.id), placement, info.elevation);

    const walls = this.model.walls.filter((w) => w.levelId === level.id);
    const rooms = this.model.rooms.filter((r) => r.levelId === level.id);
    const wells = stairwellPolys(this.model, level.id);
    const contained: Ref[] = [];
    for (const wall of walls) contained.push(...this.wall(wall, walls, rooms, placement));
    const slab = this.floorSlab(level, wells, placement);
    if (slab) contained.push(slab);
    const spaces = rooms.map((room) => {
      const space = this.space(room, level, placement);
      const covering = this.flooring(room, wells, placement);
      if (covering) {
        contained.push(covering);
        ifc.coversSpace(this.guid(`rel:covers:${room.id}`), space, [covering]);
      }
      return space;
    });
    for (const stair of this.model.stairs.filter((s) => s.levelId === level.id)) {
      const built = this.stair(stair, placement);
      if (built) contained.push(built);
    }
    for (const item of this.model.items.filter((i) => i.levelId === level.id)) contained.push(this.item(item, placement));

    if (spaces.length > 0) ifc.aggregates(this.guid(`rel:aggregates:spaces:${level.id}`), storey, spaces);
    if (contained.length > 0) ifc.contains(this.guid(`rel:contains:${level.id}`), storey, contained);
    return storey;
  }

  private wallUsage(thickness: number): { usage: LayerSetUsage; walls: Ref[] } {
    const known = this.wallUsages.get(thickness);
    if (known) return known;
    const mm = Math.round(thickness * 1000);
    const entry = { usage: this.ifc.layerSetUsage(this.plaster(), thickness, `${WALL_MATERIAL.name} ${mm} mm`), walls: [] as Ref[] };
    this.wallUsages.set(thickness, entry);
    return entry;
  }

  /** A wall, and the doors and windows in it: the elements its storey contains. */
  private wall(wall: Wall, levelWalls: readonly Wall[], rooms: readonly Room[], storeyPlacement: LocalPlacement): Ref[] {
    if (isCurved(wall)) return this.curvedWall(wall, levelWalls, rooms, storeyPlacement);
    const ifc = this.ifc;
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    if (len === 0) return [];
    const dir: [number, number] = [(wall.bx - wall.ax) / len, -(wall.by - wall.ay) / len];
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([...at(wall.ax, wall.ay), 0], dir));
    // butt joints: a rectangle along the wall where both its ends are square, else its outline,
    // each end cut along the face it meets at an angle
    const outline = buttBody(wall, levelWalls);
    const [extA, extB] = outline.ext;
    const bodyLength = len + extA + extB;
    const axis = ifc.shapeRepresentation(this.axis, REP.axis, REP.curve2d, [ifc.polyline([[0, 0], [len, 0]])]);
    const frame: PlanFrame = { o: { x: wall.ax, y: wall.ay }, d: { x: (wall.bx - wall.ax) / len, y: (wall.by - wall.ay) / len } };
    const profile = outline.square ? ifc.rectangle([(len + extB - extA) / 2, 0], bodyLength, wall.thickness) : ifc.closedProfile(outlineCurve(ifc, outline.outline, frame));
    const footprint = outline.square ? bodyLength * wall.thickness : Math.abs(outlineArea(outline.outline));
    const body = ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, [ifc.extrusion(profile, wall.height)]);
    const element = ifc.wall(
      { guid: this.guid(`wall:${wall.id}`), name: label(`${IFC_NAMES.wall} ${wall.id}`), placement, shape: ifc.productShape([axis, body]), tag: label(wall.id) },
      "STANDARD",
    );
    this.wallUsage(wall.thickness).walls.push(element);

    const external = wallIsExternal(wall, rooms);
    this.properties(element, wall.id, IFC_PSETS.wallCommon, external === undefined ? [] : [["IsExternal", { type: "IFCBOOLEAN", value: external }]]);

    // measured on the body as written, so the quantities and the solid agree
    const openings = this.model.openings.filter((o) => o.wallId === wall.id);
    const cut = openings.reduce((sum, o) => sum + o.width * Math.max(0, Math.min(o.height, wall.height - o.sill)), 0);
    const side = bodyLength * wall.height;
    this.quantities(element, wall.id, IFC_PSETS.wallQuantities, [
      ["length", "Length", bodyLength],
      ["length", "Width", wall.thickness],
      ["length", "Height", wall.height],
      ["area", "GrossFootprintArea", footprint],
      ["area", "GrossSideArea", side],
      ["area", "NetSideArea", Math.max(0, side - cut)],
      ["volume", "GrossVolume", footprint * wall.height],
      ["volume", "NetVolume", Math.max(0, footprint * wall.height - cut * wall.thickness)],
    ]);

    return [element, ...openings.map((o) => this.filledOpening(o, wall, len, element, placement))];
  }

  /**
   * A curved wall: placed at its A end, its x axis along its chord; its Axis the arc, its Body
   * extruded from its outline — its two faces concentric with the centreline, butt-jointed as a
   * straight wall is (buttBody). Its openings sit on the arc.
   */
  private curvedWall(wall: Wall, levelWalls: readonly Wall[], rooms: readonly Room[], storeyPlacement: LocalPlacement): Ref[] {
    const ifc = this.ifc;
    const len = wallLength(wall);
    const chord = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    if (len === 0 || chord === 0) return [];
    const frame: PlanFrame = { o: { x: wall.ax, y: wall.ay }, d: { x: (wall.bx - wall.ax) / chord, y: (wall.by - wall.ay) / chord } };
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([...at(wall.ax, wall.ay), 0], at(frame.d.x, frame.d.y)));
    const centre = wallEdge(wall);
    const axis = ifc.shapeRepresentation(this.axis, REP.axis, REP.curve2d, [
      ifc.indexedCurve([inFrame(frame, centre.a), inFrame(frame, pointOnEdge(centre, 0.5)), inFrame(frame, centre.b)], [{ arc: [1, 2, 3] }]),
    ]);
    const { outline, ext } = buttBody(wall, levelWalls);
    const [extA, extB] = ext;
    const body = ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, [ifc.extrusion(ifc.closedProfile(outlineCurve(ifc, outline, frame)), wall.height)]);
    const element = ifc.wall(
      { guid: this.guid(`wall:${wall.id}`), name: label(`${IFC_NAMES.wall} ${wall.id}`), placement, shape: ifc.productShape([axis, body]), tag: label(wall.id) },
      "STANDARD",
    );
    this.wallUsage(wall.thickness).walls.push(element);
    const external = wallIsExternal(wall, rooms);
    this.properties(element, wall.id, IFC_PSETS.wallCommon, external === undefined ? [] : [["IsExternal", { type: "IFCBOOLEAN", value: external }]]);

    // measured on the body as written: along the centreline, and the outline's own area
    const openings = this.model.openings.filter((o) => o.wallId === wall.id);
    const bodyLength = len + extA + extB;
    const footprint = Math.abs(outlineArea(outline));
    const cut = openings.reduce((sum, o) => sum + o.width * Math.max(0, Math.min(o.height, wall.height - o.sill)), 0);
    const side = bodyLength * wall.height;
    this.quantities(element, wall.id, IFC_PSETS.wallQuantities, [
      ["length", "Length", bodyLength],
      ["length", "Width", wall.thickness],
      ["length", "Height", wall.height],
      ["area", "GrossFootprintArea", footprint],
      ["area", "GrossSideArea", side],
      ["area", "NetSideArea", Math.max(0, side - cut)],
      ["volume", "GrossVolume", footprint * wall.height],
      ["volume", "NetVolume", Math.max(0, footprint * wall.height - cut * wall.thickness)],
    ]);
    return [element, ...openings.map((o) => this.filledArcOpening(o, wall, frame, element, placement))];
  }

  /**
   * A door or window in a curved wall: placed on its chord's middle, its x axis along the chord;
   * its void the stretch of the wall between the two radial cuts at t ± half its width along the
   * arc, reaching IFC_SIZES.openingOverreach past both faces (and the foot or the top where it
   * meets them); its door or window across the chord, as the 3D view and the plan draw it.
   */
  private filledArcOpening(o: Opening, wall: Wall, wallFrame: PlanFrame, wallElement: Ref, wallPlacement: LocalPlacement): Ref {
    const ifc = this.ifc;
    // its span along the centreline, by length (as model/issues.ts openingSpan measures it)
    const half = o.width / 2 / wallLength(wall);
    const [t0, t1] = [o.t - half, o.t + half];
    const a = wallPointAt(wall, t0);
    const b = wallPointAt(wall, t1);
    const chord = segLen(a.x, a.y, b.x, b.y);
    const frame: PlanFrame = { o: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord } };
    const placement = ifc.localPlacement(wallPlacement, ifc.placement3([...inFrame(wallFrame, frame.o), o.sill], directionIn(wallFrame, frame.d)));
    const reach = wall.thickness / 2 + IFC_SIZES.openingOverreach;
    const below = o.sill <= 0 ? IFC_SIZES.openingOverreach : 0;
    const above = o.sill + o.height >= wall.height ? IFC_SIZES.openingOverreach : 0;
    const void_ = ifc.opening({
      guid: this.guid(`opening:${o.id}`),
      name: label(`${IFC_NAMES.opening} ${o.id}`),
      placement,
      shape: this.bodyShape([ifc.extrusion(ifc.closedProfile(outlineCurve(ifc, arcBand(wall, t0, t1, reach), frame)), o.height + below + above, [0, 0, -below])]),
      tag: label(o.id),
    });
    ifc.voids(this.guid(`rel:voids:${o.id}`), wallElement, void_);

    const facing = o.kind === "door" ? doorFacing(o) : null;
    const fillPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0], facing ?? undefined));
    const depth = o.kind === "door" ? IFC_SIZES.doorLeafDepth : IFC_SIZES.windowDepth;
    const head: ElementHead = {
      guid: this.guid(`${o.kind}:${o.id}`),
      name: label(`${o.kind === "door" ? IFC_NAMES.door : IFC_NAMES.window} ${o.id}`),
      placement: fillPlacement,
      shape: this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], chord, depth), o.height)]),
      tag: label(o.id),
    };
    const fill = o.kind === "door" ? ifc.door(head, o.height, chord, doorOperation(o)) : ifc.window(head, o.height, chord);
    ifc.fills(this.guid(`rel:fills:${o.id}`), void_, fill);
    return fill;
  }

  /**
   * A door or window: the opening it voids in its wall, and the door or window filling it. The
   * void reaches IFC_SIZES.openingOverreach past every face of the wall it cuts through (both
   * sides, and the wall's foot or top where the opening meets them), so the boolean that cuts
   * it never meets a face of the wall in its own plane.
   */
  private filledOpening(o: Opening, wall: Wall, len: number, wallElement: Ref, wallPlacement: LocalPlacement): Ref {
    const ifc = this.ifc;
    const placement = ifc.localPlacement(wallPlacement, ifc.placement3([o.t * len, 0, o.sill]));
    const reach = wall.thickness + 2 * IFC_SIZES.openingOverreach;
    const below = o.sill <= 0 ? IFC_SIZES.openingOverreach : 0;
    const above = o.sill + o.height >= wall.height ? IFC_SIZES.openingOverreach : 0;
    const void_ = ifc.opening({
      guid: this.guid(`opening:${o.id}`),
      name: label(`${IFC_NAMES.opening} ${o.id}`),
      placement,
      shape: this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], o.width, reach), o.height + below + above, [0, 0, -below])]),
      tag: label(o.id),
    });
    ifc.voids(this.guid(`rel:voids:${o.id}`), wallElement, void_);

    const facing = o.kind === "door" ? doorFacing(o) : null;
    const fillPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0], facing ?? undefined));
    const depth = o.kind === "door" ? IFC_SIZES.doorLeafDepth : IFC_SIZES.windowDepth;
    const head: ElementHead = {
      guid: this.guid(`${o.kind}:${o.id}`),
      name: label(`${o.kind === "door" ? IFC_NAMES.door : IFC_NAMES.window} ${o.id}`),
      placement: fillPlacement,
      // centred on its placement, so turning a door to face its swing leaves the leaf where it was
      shape: this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], o.width, depth), o.height)]),
      tag: label(o.id),
    };
    const fill = o.kind === "door" ? ifc.door(head, o.height, o.width, doorOperation(o)) : ifc.window(head, o.height, o.width);
    ifc.fills(this.guid(`rel:fills:${o.id}`), void_, fill);
    return fill;
  }

  /** A room as a space: its floor rectangle, extruded to the underside of the slab over it. */
  private space(room: Room, level: Level, storeyPlacement: LocalPlacement): Ref<"IFCSPACE"> {
    const ifc = this.ifc;
    const height = slabUnderside(level.height);
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    // its outline as it is, arcs and all: the footprint, and the profile its body rises from
    const footPrint = ifc.shapeRepresentation(this.footPrint, REP.footPrint, REP.curve2d, [outlineCurve(ifc, room.points)]);
    const body = ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, [ifc.extrusion(ifc.closedProfile(outlineCurve(ifc, room.points)), height)]);
    const longName = cleanText(room.label);
    const space = ifc.space(this.guid(`space:${room.id}`), label(room.id), label(longName || room.id), placement, ifc.productShape([footPrint, body]));
    const area = roomArea(room);
    this.properties(space, room.id, IFC_PSETS.spaceCommon, [
      ["Reference", { type: "IFCIDENTIFIER", value: label(room.id) }],
      ["IsExternal", { type: "IFCBOOLEAN", value: false }],
    ]);
    this.quantities(space, room.id, IFC_PSETS.spaceQuantities, [
      ["length", "Height", height],
      ["length", "GrossPerimeter", outlinePerimeter(room.points)],
      ["area", "GrossFloorArea", area],
      ["area", "NetFloorArea", area],
      ["volume", "GrossVolume", area * height],
    ]);
    return space;
  }

  /**
   * The slab a level stands on: SLAB_THICKNESS deep, its top at the storey's floor, under the
   * level's rooms and its walls to their joints (model/floors.ts, as the 3D view builds it), so
   * it closes the floor line under every wall of the level below too. Every stair rising
   * through it from the level below opens it. Null when the level has nothing to stand on one.
   */
  private floorSlab(level: Level, wells: readonly Poly[], storeyPlacement: LocalPlacement): Ref<"IFCSLAB"> | null {
    const ifc = this.ifc;
    const outline = slabOutline(levelSlice(this.model, level.id));
    const pieces = regionPieces(outline);
    const shape = this.bodyShape(this.regionSolids(pieces, SLAB_THICKNESS, -SLAB_THICKNESS));
    if (!shape) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const levelName = cleanText(level.name) || level.id;
    const slab = ifc.slab({ guid: this.guid(`slab:${level.id}`), name: label(`${IFC_NAMES.floor} ${levelName}`), placement, shape, tag: label(level.id) }, "FLOOR");
    this.slabs.push(slab);

    const gross = piecesArea(pieces);
    const net = piecesArea(regionPieces(outline, wells));
    this.quantities(slab, level.id, IFC_PSETS.slabQuantities, [
      ["length", "Width", SLAB_THICKNESS],
      ["area", "GrossArea", gross],
      ["area", "NetArea", net],
      ["volume", "GrossVolume", gross * SLAB_THICKNESS],
      ["volume", "NetVolume", net * SLAB_THICKNESS],
    ]);

    const overreach = IFC_SIZES.openingOverreach;
    for (const { stair, geometry } of stairwellsOf(this.model, level.id)) {
      // the parts of the stairwell that take some of the slab away
      const through = geometry.footprint.filter((r) => piecesArea(regionPieces(outline, [rectCorners(r)])) < gross - REGION.probe * REGION.probe);
      if (through.length === 0) continue;
      const openingPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      const void_ = ifc.opening({
        guid: this.guid(`stairwell:${stair.id}`),
        name: label(`${IFC_NAMES.stairwell} ${stair.id}`),
        placement: openingPlacement,
        shape: this.bodyShape(through.map((r) => this.boxSolid(r, SLAB_THICKNESS + 2 * overreach, -SLAB_THICKNESS - overreach))),
        tag: label(stair.id),
      });
      ifc.voids(this.guid(`rel:voids:stairwell:${stair.id}`), slab, void_);
    }
    return slab;
  }

  /**
   * A room's floor finish: an IfcCovering FLOORING, FLOOR_FINISH_DEPTH thick, laid on the slab
   * over the room less any stairwell crossing it, in the finish's material, covering its space.
   * Null when a stairwell takes the whole room.
   */
  private flooring(room: Room, wells: readonly Poly[], storeyPlacement: LocalPlacement): Ref<"IFCCOVERING"> | null {
    const ifc = this.ifc;
    const outline = roomPoly(room);
    const pieces = regionPieces([outline], wells);
    // its own outline, arcs and all, where no stairwell crosses it; else the region left, in pieces
    const crossed = wells.some((w) => piecesArea(regionPieces([outline], [w])) < piecesArea(regionPieces([outline])) - REGION.probe * REGION.probe);
    const shape = crossed
      ? this.bodyShape(this.regionSolids(pieces, FLOOR_FINISH_DEPTH))
      : this.bodyShape([this.ifc.extrusion(this.ifc.closedProfile(outlineCurve(this.ifc, room.points)), FLOOR_FINISH_DEPTH)]);
    if (!shape) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const longName = cleanText(room.label);
    const covering = ifc.covering(
      { guid: this.guid(`flooring:${room.id}`), name: label(`${IFC_NAMES.flooring} ${longName || room.id}`), placement, shape, tag: label(room.id) },
      "FLOORING",
    );
    const finish = FLOOR_MATERIAL[room.floor];
    let entry = this.floorMaterials.get(room.floor);
    if (!entry) this.floorMaterials.set(room.floor, (entry = { material: ifc.material(finish.name, finish.category), coverings: [] }));
    entry.coverings.push(covering);
    const net = crossed ? piecesArea(pieces) : roomArea(room);
    this.quantities(covering, room.id, IFC_PSETS.coveringQuantities, [
      ["length", "Width", FLOOR_FINISH_DEPTH],
      ["area", "GrossArea", roomArea(room)],
      ["area", "NetArea", net],
    ]);
    return covering;
  }

  /** A stair: its flights and landing as parts, the stair itself the element its storey contains. */
  private stair(stair: Stair, storeyPlacement: LocalPlacement): Ref<"IFCSTAIR"> | null {
    const ifc = this.ifc;
    const g = stairGeometryIn(this.model, stair);
    if (!g) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const element = ifc.stair(
      { guid: this.guid(`stair:${stair.id}`), name: label(`${IFC_NAMES.stair} ${stair.id}`), placement, shape: null, tag: label(stair.id) },
      stair.shape === "l" ? "QUARTER_TURN_STAIR" : "STRAIGHT_RUN_STAIR",
    );
    const parts: Ref[] = [];
    // an L-shaped stair's first flight climbs to the landing (stairSplit risers), its second the rest;
    // each flight's last riser lands on the landing or the floor above, so it has one tread fewer
    const split = stair.shape === "l" ? stairSplit(stair, g.risers) : g.risers;
    const flightRisers = stair.shape === "l" ? [split, g.risers - split] : [g.risers];
    flightRisers.forEach((risers, f) => {
      const steps = g.steps.filter((s) => s.flight === f);
      const flightPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      parts.push(
        ifc.stairFlight(
          {
            guid: this.guid(`stair:${stair.id}:flight:${f}`),
            name: label(`${IFC_NAMES.flight} ${f + 1}`),
            placement: flightPlacement,
            shape: this.bodyShape(steps.map((s) => this.boxSolid(s.rect, s.top))),
          },
          risers,
          steps.length,
          g.riserHeight,
          g.going,
        ),
      );
    });
    if (g.landing) {
      const landingPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      parts.push(
        ifc.slab(
          { guid: this.guid(`stair:${stair.id}:landing`), name: IFC_NAMES.landing, placement: landingPlacement, shape: this.bodyShape([this.boxSolid(g.landing.rect, g.landing.top)]) },
          "LANDING",
        ),
      );
    }
    ifc.aggregates(this.guid(`rel:aggregates:stair:${stair.id}`), element, parts);
    this.properties(element, stair.id, IFC_PSETS.stairCommon, [
      ["NumberOfRiser", { type: "IFCCOUNTMEASURE", value: g.risers }],
      ["NumberOfTreads", { type: "IFCCOUNTMEASURE", value: g.steps.length }],
      ["RiserHeight", { type: "IFCPOSITIVELENGTHMEASURE", value: g.riserHeight }],
      ["TreadLength", { type: "IFCPOSITIVELENGTHMEASURE", value: g.going }],
    ]);
    return element;
  }

  /** A piece of furniture: its catalogue footprint and height as a box, turned as it stands, on the floor finish. */
  private item(item: Item, storeyPlacement: LocalPlacement): Ref<"IFCFURNITURE"> {
    const ifc = this.ifc;
    const def = catalogOf(this.model).get(item.kind);
    const turn = item.rotation * DEG;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([...at(item.x, item.y), FLOOR_FINISH_DEPTH], [Math.cos(turn), Math.sin(turn)]));
    const shape = def ? this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], def.w, def.d), def.h)]) : null;
    const element = ifc.furniture(
      { guid: this.guid(`item:${item.id}`), name: (def && cleanText(def.label)) || IFC_NAMES.unknownKind, objectType: label(item.kind), placement, shape, tag: label(item.id) },
      FURNITURE_TYPE[item.kind] ?? "NOTDEFINED",
    );
    if (isSupplierKind(item.kind)) {
      this.properties(element, item.id, IFC_PSETS.product, [
        ["Sku", { type: "IFCIDENTIFIER", value: label(item.kind.slice(SUPPLIER_KIND_PREFIX.length)) }],
        ["Vendor", { type: "IFCLABEL", value: SUPPLIER.vendor }],
      ]);
    }
    return element;
  }

  /** What the file holds, by the plan's kinds of thing. */
  counts(): IfcElementCounts {
    const c = this.ifc.file.entityCounts();
    const n = (type: string) => c[type] ?? 0;
    return {
      storeys: n("IFCBUILDINGSTOREY"),
      walls: n("IFCWALL"),
      doors: n("IFCDOOR"),
      windows: n("IFCWINDOW"),
      openings: n("IFCOPENINGELEMENT"),
      slabs: n("IFCSLAB"),
      coverings: n("IFCCOVERING"),
      spaces: n("IFCSPACE"),
      stairs: n("IFCSTAIR"),
      stairFlights: n("IFCSTAIRFLIGHT"),
      furniture: n("IFCFURNITURE"),
    };
  }
}
