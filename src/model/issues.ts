/**
 * Constraint engine — the metric precision checker agents use to self-repair.
 *
 * The checker is a list of rules. Each rule is a function of one shared, precomputed context
 * (walls by id, the plan's catalogue, every opening on its wall, every item's footprint) and
 * returns the issues it finds, with entity refs so callers can act on them. A rule can be run
 * and tested on its own, and a new one is added by writing it and listing it in RULES.
 */

import type { Column, Issue, Item, KindDef, Opening, OpeningKind, PlanModel, Room, Wall } from "./types";
import {
  areCollinear,
  boxOf,
  boxesApart,
  collinearOverlap,
  dist,
  satRectRect,
  segLen,
  segmentsCross,
  rectCorners,
  type Box,
  type ORect,
  type Pt,
} from "./geometry";
import {
  closestOnEdge,
  edgeBox,
  edgeIntersections,
  edgeLength,
  edgesOverlap,
  isCurved,
  openingSag,
  outlineAnchor,
  outlineArea,
  outlineBox,
  outlineDistance,
  outlineEdges,
  outlineSelfIntersection,
  pointInOutline,
  tessellateOutline,
  wallArcError,
  wallDistance,
  wallEdge,
  wallLength,
  wallPieces,
  wallPointAt,
  wallTangentAt,
  type Edge,
} from "./shapes";
import { sharedArea } from "./region";
import { catalogOf, kindName, type Catalog } from "./catalog";
import { ARC_TESSELLATION, BULGE, DOOR_SWING_DEFAULTS, DOOR_SWINGS_TOUCH, DOUBLE_DOOR_CLEAR, GARAGE_DOOR, PARKING, ROOM_SHAPE, ROOM_SIZE, SLAB_THICKNESS, STAIR, SUPPORT, WALL_MIN_LENGTH } from "./limits";
import { levelAbove, levelBelow, levelInfo, levelSlice, levelsOf, reachesSlab, slabFit, slabUnderside, stairwellsOf, type LevelInfo, type Stairwell } from "./levels";
import { stairGeometry } from "./stairs";
import { columnBox, columnDistance, columnFootprint, columnHeight, columnHitsRect, columnsHit, columnWalls } from "./columns";
import { unsupportedZones } from "./supports";

const ENDPOINT_SNAP = 0.08; // endpoints closer than this count as connected
const DOOR_CLEAR = 0.1; // furniture must keep this margin in front of openings

const wA = (w: Wall): Pt => ({ x: w.ax, y: w.ay });
const wB = (w: Wall): Pt => ({ x: w.bx, y: w.by });

/** Center point of an opening in world coordinates: at its t along the wall's centreline (an arc's too). */
export function openingCenter(wall: Wall, o: Opening): Pt {
  return wallPointAt(wall, o.t);
}

/**
 * Opening span (start/end t). An opening's width is measured along its wall's centreline, the
 * arc of a curved wall, so its jambs stand width/2 to either side of its centre along it.
 */
export function openingSpan(wall: Wall, o: Opening): [number, number] {
  const len = wallLength(wall);
  const half = o.width / 2 / Math.max(len, 1e-9);
  return [o.t - half, o.t + half];
}

/** One leaf of a door as it swings: its hinge, where its tip is shut and open, and its radius. */
export interface DoorLeaf {
  readonly hinge: Pt;
  readonly shut: Pt;
  readonly open: Pt;
  readonly r: number;
}

/**
 * A door's leaves, hinged `face` metres off the centreline on the side it swings to (half the
 * wall's thickness: its face). A leaf is straight, a chord's length, and swings square to the
 * vano's chord, to the door's side (walking from A to B, right is the +y side of the chord's
 * frame); a door wider than DOUBLE_DOOR_CLEAR is a pair, one leaf on each jamb. What the plan
 * draws and what the checker tests two doors' swings with.
 */
export function doorLeaves(wall: Wall, o: Opening, face: number = wall.thickness / 2): DoorLeaf[] {
  const [t0, t1] = openingSpan(wall, o);
  const p0 = wallPointAt(wall, t0);
  const p1 = wallPointAt(wall, t1);
  const s = (o.side ?? DOOR_SWING_DEFAULTS.side) === "right" ? 1 : -1;
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const nx = (-(p1.y - p0.y) / chord) * s;
  const ny = ((p1.x - p0.x) / chord) * s;
  const tm = (t0 + t1) / 2;
  const spans: { hinge: number; to: number }[] =
    (t1 - t0) * wallLength(wall) > DOUBLE_DOOR_CLEAR ? [{ hinge: t0, to: tm }, { hinge: t1, to: tm }] : (o.hinge ?? DOOR_SWING_DEFAULTS.hinge) === "b" ? [{ hinge: t1, to: t0 }] : [{ hinge: t0, to: t1 }];
  return spans.map(({ hinge, to }) => {
    const from = wallPointAt(wall, hinge);
    const u = wallTangentAt(wall, hinge);
    const h = { x: from.x - u.y * s * face, y: from.y + u.x * s * face };
    const closed = wallPointAt(wall, to);
    const r = Math.hypot(closed.x - from.x, closed.y - from.y);
    // shut, the leaf lies along the chord from its hinge; open, square to it
    return { hinge: h, shut: { x: h.x + (closed.x - from.x), y: h.y + (closed.y - from.y) }, open: { x: h.x + nx * r, y: h.y + ny * r }, r };
  });
}

/** The floor a door leaf sweeps, as a polygon: its hinge and the arc from open to shut. */
export function leafSweep(leaf: DoorLeaf): Pt[] {
  const a0 = Math.atan2(leaf.open.y - leaf.hinge.y, leaf.open.x - leaf.hinge.x);
  const a1 = Math.atan2(leaf.shut.y - leaf.hinge.y, leaf.shut.x - leaf.hinge.x);
  const turn = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
  const n = Math.max(2, Math.ceil(Math.abs(turn) / ((ARC_TESSELLATION.maxAngle * Math.PI) / 180)));
  const pts: Pt[] = [leaf.hinge];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (turn * i) / n;
    pts.push({ x: leaf.hinge.x + leaf.r * Math.cos(a), y: leaf.hinge.y + leaf.r * Math.sin(a) });
  }
  return pts;
}

/** Whether an opening is a garage door: a sectional door that rises overhead and sweeps no floor. */
export const isGarageDoor = (o: Pick<Opening, "kind" | "style">): boolean => o.kind === "door" && o.style === "garage";

/**
 * Why a garage door `width` wide does not fit its wall, or null: with the jamb its tracks need at
 * either side (GARAGE_DOOR.jamb), it must be no wider than the wall is long.
 */
export function garageDoorFitError(wall: Wall, width: number): string | null {
  const len = wallLength(wall);
  const need = width + 2 * GARAGE_DOOR.jamb;
  return need <= len + 1e-9
    ? null
    : `A ${width.toFixed(2)} m garage door needs ${need.toFixed(2)} m of wall with its ${(GARAGE_DOOR.jamb * 100).toFixed(0)} cm jambs, and wall ${wall.id} is ${len.toFixed(2)} m long. Make the door narrower or the wall longer.`;
}

/** Clamp an opening's t so the whole vano stays inside the wall. Returns null if the wall is too short. */
export function clampOpeningT(wall: Wall, width: number, t: number): number | null {
  const len = wallLength(wall);
  if (width > len - 0.02) return null;
  const half = width / 2 / len;
  const lo = half;
  const hi = 1 - half;
  return Math.min(hi, Math.max(lo, t));
}

/**
 * Why an opening `width` wide cannot sit on this wall's arc, or null: a door's leaf and a
 * window's pane are straight, across the vano's chord, and that chord must stay inside the wall
 * (its sag off the arc under half the thickness). Always null on a straight wall.
 */
export function openingArcError(wall: Wall, width: number, kind: OpeningKind): string | null {
  const sag = openingSag(wall, width);
  if (sag <= wall.thickness / 2 + 1e-9) return null;
  return `A ${width.toFixed(2)} m ${kind} is too wide for the bend of curved wall ${wall.id}: its straight ${kind === "door" ? "leaf" : "pane"} would stand ${(sag * 100).toFixed(1)} cm off the arc, past the wall's half thickness (${((wall.thickness / 2) * 100).toFixed(1)} cm). Make it narrower, the wall thicker, or the bend gentler.`;
}

// ---------------------------------------------------------------------------- context

/** A wall with the shapes the pairwise rules test it as, computed once per check. */
export interface WallShape {
  readonly wall: Wall;
  readonly a: Pt;
  readonly b: Pt;
  /** its centreline, straight or an arc */
  readonly edge: Edge;
  /** bounds of the centreline */
  readonly segBox: Box;
  /** the wall as thick rectangles: one for a straight wall, one per piece of a curved one */
  readonly pieces: readonly ORect[];
  /** bounds of the wall's thickness */
  readonly box: Box;
}

/** An opening whose host wall exists, with the numbers several rules need. */
export interface HostedOpening {
  readonly opening: Opening;
  readonly wall: Wall;
  /** start and end of the vano along the wall, as wall parameters */
  readonly span: readonly [number, number];
  readonly center: Pt;
  /** the floor in front of it that furniture must keep clear, and its bounds */
  readonly clearance: ORect;
  readonly clearanceBox: Box;
}

/** An item whose kind the catalogue knows, with its footprint on the plan. */
export interface PlacedItem {
  readonly item: Item;
  readonly def: KindDef;
  readonly rect: ORect;
  /** bounds of the footprint */
  readonly box: Box;
}

/** What every rule reads, computed once per level checked. */
export interface CheckContext {
  /** the level being checked, as the plan sees it: its own walls, openings, rooms, items, stairs */
  readonly model: PlanModel;
  /** the whole plan, every level of it */
  readonly plan: PlanModel;
  /** the level being checked, and the one above it (where its stairs arrive), if any */
  readonly level: LevelInfo;
  readonly above: LevelInfo | undefined;
  /** the stairs standing on this level, with their geometry */
  readonly stairs: readonly Stairwell[];
  /** the stairs climbing to this level from the one below: the stairwells in its floor */
  readonly wells: readonly Stairwell[];
  readonly wallById: ReadonlyMap<string, Wall>;
  readonly catalog: Catalog;
  readonly walls: readonly WallShape[];
  readonly hosted: readonly HostedOpening[];
  /** the hosted openings of each wall, by wall id */
  readonly hostedOn: ReadonlyMap<string, readonly HostedOpening[]>;
  readonly placed: readonly PlacedItem[];
  /** the columns standing on this level, with their bounds */
  readonly columns: readonly PlacedColumn[];
}

/** A column with its bounds. */
export interface PlacedColumn {
  readonly column: Column;
  readonly box: Box;
}

/** One check over the plan. */
export type Rule = (ctx: CheckContext) => Issue[];

/**
 * The floor in front of an opening furniture must keep clear: a door's swing, a window's reach, a
 * garage door's threshold (its panels rise overhead, so a car may park right behind it).
 */
function clearanceOf(wall: Wall, o: Opening, center: Pt): ORect {
  return {
    cx: center.x,
    cy: center.y,
    hw: o.width / 2 + DOOR_CLEAR,
    hd: wall.thickness / 2 + (isGarageDoor(o) ? GARAGE_DOOR.threshold : o.kind === "door" ? 0.8 : 0.4),
    rot: (() => {
      const u = wallTangentAt(wall, o.t);
      return Math.atan2(u.y, u.x);
    })(),
  };
}

/**
 * The context for checking `model` as level `levelId` of `plan`. Called with the plan alone it
 * checks the plan's first level as if it held everything — which, for a one-storey plan, it does.
 */
export function checkContext(model: PlanModel, plan: PlanModel = model, levelId: string = plan.levels[0].id): CheckContext {
  const level = levelInfo(plan, levelId) ?? levelsOf(plan)[0];
  const above = levelAbove(plan, level.level.id);
  const stairs = model.stairs.map((stair) => ({ stair, geometry: stairGeometry(stair, level.level.height) }));
  const wells = stairwellsOf(plan, level.level.id);
  const wallById = new Map(model.walls.map((w) => [w.id, w]));
  const catalog = catalogOf(model);
  const walls = model.walls.map((wall): WallShape => {
    const edge = wallEdge(wall);
    const pieces = wallPieces(wall);
    return { wall, a: edge.a, b: edge.b, edge, segBox: edgeBox(edge), pieces, box: boxOf(pieces.flatMap(rectCorners)) };
  });
  const hosted: HostedOpening[] = [];
  const hostedOn = new Map<string, HostedOpening[]>();
  for (const opening of model.openings) {
    const wall = wallById.get(opening.wallId);
    if (!wall) continue;
    const center = openingCenter(wall, opening);
    const clearance = clearanceOf(wall, opening, center);
    const h: HostedOpening = {
      opening,
      wall,
      span: openingSpan(wall, opening),
      center,
      clearance,
      clearanceBox: boxOf(rectCorners(clearance)),
    };
    hosted.push(h);
    const list = hostedOn.get(wall.id);
    if (list) list.push(h);
    else hostedOn.set(wall.id, [h]);
  }
  const placed: PlacedItem[] = [];
  for (const item of model.items) {
    const def = catalog.get(item.kind);
    if (def) {
      const rect: ORect = { cx: item.x, cy: item.y, hw: def.w / 2, hd: def.d / 2, rot: (-item.rotation * Math.PI) / 180 };
      placed.push({ item, def, rect, box: boxOf(rectCorners(rect)) });
    }
  }
  const columns = model.columns.map((column): PlacedColumn => ({ column, box: columnBox(column) }));
  return { model, plan, level, above, stairs, wells, wallById, catalog, walls, hosted, hostedOn, placed, columns };
}

/** The edges of a room's outline, straight or arcs. */
const roomEdges = (r: Room): Edge[] => outlineEdges(r.points);

/** Is p in the room, or within `tol` of its edge? */
const inRoomNear = (r: Room, p: Pt, tol: number): boolean => pointInOutline(p, r.points) || outlineDistance(p, r.points) <= tol;

/** Do the wall's thick pieces overlap the oriented rectangle (touching within `eps` does not count)? */
const wallHits = (s: WallShape, rect: ORect, eps: number): boolean => s.pieces.some((piece) => satRectRect(rect, piece, eps));

// ---------------------------------------------------------------------------- walls

export const wallTooShort: Rule = ({ model }) =>
  model.walls.flatMap((w): Issue[] => {
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    if (len >= WALL_MIN_LENGTH) return [];
    return [
      {
        severity: "error",
        code: "wall_too_short",
        message: `Wall ${w.id} is only ${(len * 100).toFixed(0)} cm long (min ${(WALL_MIN_LENGTH * 100).toFixed(0)} cm).`,
        refs: [w.id],
      },
    ];
  });

/** Pairs of walls that overlap collinearly, or else cross mid-span (T-junctions at endpoints are legal). */
export const wallIntersections: Rule = ({ walls }) => {
  const issues: Issue[] = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const sa = walls[i];
      const sb = walls[j];
      // segments whose bounds are apart can neither overlap nor cross
      if (boxesApart(sa.segBox, sb.segBox)) continue;
      const a = sa.wall;
      const b = sb.wall;
      if (isCurved(a) || isCurved(b)) {
        const crossing = curvedCrossing(sa, sb);
        if (crossing) issues.push(crossing);
        continue;
      }
      const ov = collinearOverlap(sa.a, sa.b, sb.a, sb.b);
      if (ov > 0.01) {
        issues.push({
          severity: "error",
          code: "walls_overlap_collinear",
          message: `Walls ${a.id} and ${b.id} overlap collinearly for ${(ov * 100).toFixed(0)} cm.`,
          refs: [a.id, b.id],
        });
      } else if (!areCollinear(sa.a, sa.b, sb.a, sb.b) && segmentsCross(sa.a, sa.b, sb.a, sb.b)) {
        issues.push({
          severity: "error",
          code: "walls_cross",
          message: `Walls ${a.id} and ${b.id} cross mid-span.`,
          refs: [a.id, b.id],
        });
      }
    }
  }
  return issues;
};

/** Two walls at least one of which is curved: one running along the other, or crossing it away from every end. */
function curvedCrossing(sa: WallShape, sb: WallShape): Issue | null {
  const a = sa.wall;
  const b = sb.wall;
  if (edgesOverlap(sa.edge, sb.edge, 0.01)) {
    return { severity: "error", code: "walls_overlap_collinear", message: `Walls ${a.id} and ${b.id} run along each other.`, refs: [a.id, b.id] };
  }
  const ends = [sa.a, sa.b, sb.a, sb.b];
  const crossing = edgeIntersections(sa.edge, sb.edge).some(({ p }) => ends.every((e) => dist(e, p) >= ENDPOINT_SNAP));
  return crossing ? { severity: "error", code: "walls_cross", message: `Walls ${a.id} and ${b.id} cross mid-span.`, refs: [a.id, b.id] } : null;
}

/** A curved wall bent tighter than its thickness allows, or past a half circle. */
export const wallArcTooTight: Rule = ({ model }) =>
  model.walls.flatMap((w): Issue[] => {
    const why = wallArcError(w);
    return why ? [{ severity: "error", code: "wall_arc_too_tight", message: why, refs: [w.id] }] : [];
  });

/** An endpoint that touches nothing (T-junctions count as connected, and so does a column it ends on). */
export const wallLooseEnds: Rule = ({ walls, columns }) => {
  if (walls.length + columns.length <= 1) return [];
  const issues: Issue[] = [];
  for (const { wall: w, a, b } of walls) {
    for (const end of [a, b] as const) {
      const connected =
        walls.some(
          (other) =>
            other.wall.id !== w.id &&
            (dist(end, other.a) < ENDPOINT_SNAP ||
              dist(end, other.b) < ENDPOINT_SNAP ||
              wallDistance(end, other.wall) <= ENDPOINT_SNAP),
        ) || columns.some(({ column }) => columnDistance(end, column) <= ENDPOINT_SNAP);
      if (!connected) {
        issues.push({
          severity: "warning",
          code: "wall_loose_end",
          message: `Wall ${w.id} has a loose end at (${end.x.toFixed(2)}, ${end.y.toFixed(2)}).`,
          refs: [w.id],
        });
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------- openings

/** An opening whose wall is gone (levelContents counts it on the plan's first level). */
export const openingOrphan: Rule = ({ model, wallById }) =>
  model.openings
    .filter((o) => !wallById.has(o.wallId))
    .map((o): Issue => ({
      severity: "error",
      code: "opening_orphan",
      message: `${o.kind} ${o.id} references missing wall ${o.wallId}.`,
      refs: [o.id],
    }));

/** The vano must lie inside its wall, along it and up it. */
export const openingFit: Rule = ({ hosted }) =>
  hosted.flatMap(({ opening: o, wall, span: [t0, t1] }) => {
    const issues: Issue[] = [];
    if (t0 < -1e-6 || t1 > 1 + 1e-6) {
      issues.push({
        severity: "error",
        code: "opening_overflow",
        message: `${o.kind} ${o.id} extends past the end of ${isCurved(wall) ? "curved " : ""}wall ${wall.id}.`,
        refs: [o.id, wall.id],
      });
    }
    const tight = openingArcError(wall, o.width, o.kind);
    if (tight) issues.push({ severity: "error", code: "opening_too_wide_for_arc", message: tight, refs: [o.id, wall.id] });
    if (o.sill + o.height > wall.height + 1e-6) {
      issues.push({
        severity: "error",
        code: "opening_too_tall",
        message: `${o.kind} ${o.id} (sill ${o.sill}m + height ${o.height}m) exceeds wall height ${wall.height}m.`,
        refs: [o.id, wall.id],
      });
    }
    return issues;
  });

/** Two openings on the same wall whose spans overlap. Each pair is reported once. */
export const openingsOverlap: Rule = ({ hosted, hostedOn }) => {
  const issues: Issue[] = [];
  for (const a of hosted) {
    // only openings on the same wall can overlap
    for (const b of hostedOn.get(a.wall.id) ?? []) {
      if (b.opening.id <= a.opening.id) continue;
      if (Math.min(a.span[1], b.span[1]) - Math.max(a.span[0], b.span[0]) > 1e-6) {
        issues.push({
          severity: "error",
          code: "openings_overlap",
          message: `${a.opening.kind} ${a.opening.id} overlaps ${b.opening.kind} ${b.opening.id} on wall ${a.wall.id}.`,
          refs: [a.opening.id, b.opening.id, a.wall.id],
        });
      }
    }
  }
  return issues;
};

/** A different wall ENDING inside an opening's span. */
export const wallEndsInOpening: Rule = ({ model: { walls }, hosted }) => {
  const issues: Issue[] = [];
  for (const { opening: o, wall, span: [t0, t1] } of hosted) {
    const host = wallEdge(wall);
    for (const other of walls) {
      if (other.id === wall.id) continue;
      for (const end of [wA(other), wB(other)] as const) {
        // param of the endpoint along the host wall
        const near = closestOnEdge(host, end);
        if (near.distance > 0.02) continue;
        const t = near.t;
        if (t > t0 + 0.01 && t < t1 - 0.01) {
          issues.push({
            severity: "error",
            code: "wall_ends_in_opening",
            message: `Wall ${other.id} ends inside the ${o.kind} ${o.id} of wall ${wall.id}.`,
            refs: [other.id, o.id, wall.id],
          });
        }
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------- rooms

/** A room too small to be one: under ROOM_SHAPE.minArea, or narrower anywhere than ROOM_SIZE.min. */
export const roomTooSmall: Rule = ({ model }) =>
  model.rooms
    .filter((r) => {
      if (r.points.length < 3) return false;
      const area = Math.abs(outlineArea(r.points));
      return area < ROOM_SHAPE.minArea - 1e-9 || outlineAnchor(r.points).clearance * 2 < ROOM_SIZE.min - ROOM_SHAPE.anchorPrecision;
    })
    .map((r): Issue => ({
      severity: "error",
      code: "room_too_small",
      message: `Room "${r.label}" is smaller than ${ROOM_SIZE.min} × ${ROOM_SIZE.min} m: it must hold at least ${ROOM_SHAPE.minArea} m² and be ${ROOM_SIZE.min} m wide everywhere.`,
      refs: [r.id],
    }));

/** A room's outline as an outline: enough corners, edges bent no further than a half circle, none too short, none crossing another. */
export const roomOutline: Rule = ({ model }) =>
  model.rooms.flatMap((r): Issue[] => {
    const { vertices, minEdge } = ROOM_SHAPE;
    if (r.points.length < vertices.min || r.points.length > vertices.max || r.points.some((p) => p.bulge !== undefined && !(Math.abs(p.bulge) <= BULGE.max))) {
      return [{ severity: "error", code: "room_outline_invalid", message: `Room "${r.label}" has ${r.points.length} corners or an edge bent past a half circle (allowed ${vertices.min}-${vertices.max} corners, each edge at most a half circle).`, refs: [r.id] }];
    }
    const issues: Issue[] = [];
    const crossing = outlineSelfIntersection(r.points);
    if (crossing) {
      issues.push({ severity: "error", code: "room_self_intersecting", message: `Room "${r.label}" crosses itself: edges ${crossing[0]} and ${crossing[1]} of its outline cross or touch.`, refs: [r.id] });
    }
    roomEdges(r).forEach((e, i) => {
      const len = edgeLength(e);
      if (len < minEdge - 1e-9) {
        issues.push({ severity: "error", code: "room_edge_too_short", message: `Edge ${i} of room "${r.label}" is ${(len * 100).toFixed(1)} cm long (min ${(minEdge * 100).toFixed(0)} cm).`, refs: [r.id] });
      }
    });
    return issues;
  });

/** Whether a room is an open space (a carport, a porch): it is not asked for enclosing walls or a door. */
export const isOpenRoom = (r: Pick<Room, "kind">): boolean => r.kind === "open";

/** No wall near any corner of the room. An open space needs none. */
export const roomFloating: Rule = ({ model: { rooms }, walls }) => {
  if (walls.length === 0) return [];
  return rooms
    .filter((r) => !isOpenRoom(r) && !r.points.some((p) => walls.some((s) => wallDistance(p, s.wall) < 0.25)))
    .map((r): Issue => ({
      severity: "warning",
      code: "room_floating",
      message: `Room "${r.label}" is not bounded by any wall.`,
      refs: [r.id],
    }));
};

/** At least one door must sit on the room's boundary, once the plan has openings at all. An open space is entered from its open sides. */
export const roomNoDoor: Rule = ({ model: { rooms, openings }, hosted }) => {
  if (openings.length === 0) return [];
  const doorCenters = hosted.filter((h) => h.opening.kind === "door").map((h) => h.center);
  return rooms
    .filter((r) => {
      if (isOpenRoom(r)) return false;
      const edges = roomEdges(r);
      return !doorCenters.some((c) => edges.some((e) => closestOnEdge(e, c).distance < 0.3));
    })
    .map((r): Issue => ({
      severity: "warning",
      code: "room_no_door",
      message: `Room "${r.label}" has no door on its boundary.`,
      refs: [r.id],
    }));
};

/** Two rooms whose outlines share more than ROOM_SHAPE.overlap of floor (sharing an edge is not overlapping). */
export const roomsOverlap: Rule = ({ model: { rooms } }) => {
  const issues: Issue[] = [];
  const shapes = rooms.map((r) => ({ r, box: outlineBox(r.points), poly: tessellateOutline(r.points) }));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      if (boxesApart(a.box, b.box)) continue;
      const shared = sharedArea(a.poly, b.poly);
      if (shared > ROOM_SHAPE.overlap) {
        issues.push({
          severity: "error",
          code: "rooms_overlap",
          message: `Rooms "${a.r.label}" and "${b.r.label}" overlap (${shared.toFixed(2)} m² shared).`,
          refs: [a.r.id, b.r.id],
        });
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------- furniture
// Item messages name a kind with kindName: a supplier product's label is the partner's text,
// and these messages are the page's own sentences to the agent.

export const itemUnknown: Rule = ({ model, catalog }) =>
  model.items
    .filter((it) => !catalog.get(it.kind))
    .map((it): Issue => ({
      severity: "error",
      code: "item_unknown",
      message: `Item ${it.id} has unknown kind "${it.kind}".`,
      refs: [it.id],
    }));

/** Touching a wall (leaning) is legal; crossing through it is an error. */
export const itemThroughWall: Rule = ({ walls, placed }) =>
  placed.flatMap(({ item, def, rect, box }) =>
    walls
      // tolerance 0.02: penetration up to 2 cm still counts as "leaning"
      .filter((s) => !boxesApart(box, s.box) && wallHits(s, rect, 0.02))
      .map(({ wall: w }): Issue => ({
        severity: "error",
        code: "item_through_wall",
        message: `${kindName(def)} crosses wall ${w.id}.`,
        refs: [item.id, w.id],
      })),
  );

/** Furniture in an opening's clearance: a door is blocked outright, a window only above its sill. */
export const itemBlocksOpening: Rule = ({ hosted, placed }) => {
  const issues: Issue[] = [];
  for (const { item, def, rect, box } of placed) {
    for (const { opening: o, clearance, clearanceBox } of hosted) {
      if (boxesApart(box, clearanceBox) || !satRectRect(rect, clearance)) continue;
      if (o.kind === "door") {
        issues.push({
          severity: "error",
          code: "item_blocks_door",
          message: isGarageDoor(o)
            ? `${kindName(def)} stands in the threshold of garage door ${o.id}: keep ${GARAGE_DOOR.threshold} m behind it clear.`
            : `${kindName(def)} blocks the swing path of door ${o.id}.`,
          refs: [item.id, o.id],
        });
      } else if (def.h > o.sill) {
        issues.push({
          severity: "warning",
          code: "item_blocks_window",
          message: `${kindName(def)} (h ${def.h}m) sits in front of window ${o.id} (sill ${o.sill}m).`,
          refs: [item.id, o.id],
        });
      }
    }
  }
  return issues;
};

/**
 * Two doors whose leaves sweep the same floor: opened together they hit each other. Each pair is
 * reported once; a pair of leaves of one door meets in its middle by design and is not tested.
 */
export const doorsSwingTogether: Rule = ({ hosted }) => {
  const doors = hosted
    // a garage door rises overhead: it sweeps no floor
    .filter(({ opening: o }) => o.kind === "door" && !isGarageDoor(o))
    .map(({ opening, wall }) => {
      const sweeps = doorLeaves(wall, opening).map(leafSweep);
      return { opening, sweeps, box: boxOf(sweeps.flat()) };
    });
  const issues: Issue[] = [];
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i];
      const b = doors[j];
      if (boxesApart(a.box, b.box)) continue;
      if (!a.sweeps.some((p) => b.sweeps.some((q) => sharedArea(p, q) > DOOR_SWINGS_TOUCH))) continue;
      issues.push({
        severity: "warning",
        code: "doors_swing_together",
        message: `Door ${a.opening.id} and door ${b.opening.id} swing into each other.`,
        refs: [a.opening.id, b.opening.id],
      });
    }
  }
  return issues;
};

/** Two pieces of furniture on top of each other (rugs exempt). Each pair is reported once. */
export const itemsOverlap: Rule = ({ placed }) => {
  const issues: Issue[] = [];
  for (const a of placed) {
    if (a.def.isRug) continue;
    for (const b of placed) {
      if (b.item.id <= a.item.id || b.def.isRug) continue;
      if (!boxesApart(a.box, b.box) && satRectRect(a.rect, b.rect, 0.01)) {
        issues.push({
          severity: "error",
          code: "items_overlap",
          message: `${kindName(a.def)} overlaps ${kindName(b.def)}.`,
          refs: [a.item.id, b.item.id],
        });
      }
    }
  }
  return issues;
};

/** Once the plan has rooms, every piece should stand in one of them. */
export const itemOutsideRooms: Rule = ({ model: { rooms }, placed }) => {
  if (rooms.length === 0) return [];
  return placed
    .filter(({ item: it }) => !rooms.some((rm) => inRoomNear(rm, it, 0.05)))
    .map(({ item, def }): Issue => ({
      severity: "warning",
      code: "item_outside_rooms",
      message: `${kindName(def)} is outside every room.`,
      refs: [item.id],
    }));
};

// ---------------------------------------------------------------------------- stairs
// A stair is checked on the level it stands on (its steps, its foot) and its stairwell on the
// level it arrives on (the void, what stands over it, the floor past its top), so every issue is
// reported with the level whose entities it names.

const round3 = (v: number): string => v.toFixed(3);

/** Does any of `rects` overlap `other` (touching does not count)? */
const anyOverlap = (rects: readonly ORect[], other: ORect, eps = 1e-9): boolean => rects.some((r) => satRectRect(r, other, eps));

/** Does wall `s` cross any of `rects`? A wall merely touching (2 cm) is a wall the stair stands against. */
const wallCrosses = (s: WallShape, rects: readonly ORect[], box: Box): boolean =>
  !boxesApart(s.box, box) && rects.some((r) => wallHits(s, r, 0.02));

/** A stair on the top level climbs to nothing. */
export const stairNoUpperLevel: Rule = ({ stairs, above }) =>
  above
    ? []
    : stairs.map(({ stair }): Issue => ({
        severity: "error",
        code: "stair_no_upper_level",
        message: `Stair ${stair.id} is on the top level: there is no level for it to reach. Add one above it, or move it down.`,
        refs: [stair.id],
      }));

/** Risers and goings inside their ranges, and the two in proportion (2R + G). */
export const stairDimensions: Rule = ({ stairs }) =>
  stairs.flatMap(({ stair, geometry: g }) => {
    const issues: Issue[] = [];
    if (g.riserHeight < STAIR.riser.min - 1e-9 || g.riserHeight > STAIR.riser.max + 1e-9) {
      issues.push({
        severity: "error",
        code: "stair_riser_out_of_range",
        message: `Stair ${stair.id} has ${g.risers} risers of ${round3(g.riserHeight)} m (allowed ${STAIR.riser.min}-${STAIR.riser.max} m).`,
        refs: [stair.id],
      });
    }
    if (g.going < STAIR.tread.min - 1e-9 || g.going > STAIR.tread.max + 1e-9) {
      issues.push({
        severity: "error",
        code: "stair_tread_out_of_range",
        message: `Stair ${stair.id} has a going of ${round3(g.going)} m (allowed ${STAIR.tread.min}-${STAIR.tread.max} m).`,
        refs: [stair.id],
      });
    }
    const { min, max } = STAIR.stepRule;
    if (g.stepRule < min - 1e-9 || g.stepRule > max + 1e-9) {
      issues.push({
        severity: "warning",
        code: "stair_step_rule",
        message: `Stair ${stair.id}: 2 × riser + going is ${round3(g.stepRule)} m, outside the comfortable ${min}-${max} m.`,
        refs: [stair.id],
      });
    }
    return issues;
  });

/** The slab above must leave a person's height over the first tread, at the stairwell's edge. */
export const stairHeadroom: Rule = ({ stairs, above }) =>
  above
    ? stairs
        .filter(({ geometry: g }) => g.headroom < STAIR.headroom - 1e-9)
        .map(({ stair, geometry: g }): Issue => ({
          severity: "error",
          code: "stair_headroom",
          message: `Stair ${stair.id} leaves ${g.headroom.toFixed(2)} m of headroom under the slab above (min ${STAIR.headroom} m).`,
          refs: [stair.id],
        }))
    : [];

/** A wall of the stair's own level standing in its flights or its landing. */
export const stairCrossesWall: Rule = ({ stairs, walls }) =>
  stairs.flatMap(({ stair, geometry: g }) =>
    walls
      .filter((s) => wallCrosses(s, g.footprint, g.box))
      .map(({ wall }): Issue => ({
        severity: "error",
        code: "stair_crosses_wall",
        message: `Wall ${wall.id} stands in stair ${stair.id}.`,
        refs: [stair.id, wall.id],
      })),
  );

/**
 * The floor in front of the bottom riser (on the stair's level) and past the top one (on the
 * level it arrives on) must be clear of walls: you have to be able to step on and off.
 */
export const stairExitBlocked: Rule = ({ stairs, wells, walls }) => {
  const ends = [
    ...stairs.map(({ stair, geometry }) => ({ stair, exit: geometry.bottomExit, where: "at its foot" })),
    ...wells.map(({ stair, geometry }) => ({ stair, exit: geometry.topExit, where: "at its head" })),
  ];
  return ends.flatMap(({ stair, exit, where }) => {
    const box = boxOf(rectCorners(exit));
    return walls
      .filter((s) => wallCrosses(s, [exit], box))
      .map(({ wall }): Issue => ({
        severity: "error",
        code: "stair_landing_blocked",
        message: `Wall ${wall.id} blocks the landing of stair ${stair.id} ${where}.`,
        refs: [wall.id, stair.id],
      }));
  });
};

/** A wall of the upper level standing over the stairwell would stand on nothing, in the way of the stair. */
export const stairwellBlocked: Rule = ({ wells, walls }) =>
  wells.flatMap(({ stair, geometry: g }) =>
    walls
      .filter((s) => wallCrosses(s, g.footprint, g.box))
      .map(({ wall }): Issue => ({
        severity: "error",
        code: "stairwell_blocked",
        message: `Wall ${wall.id} stands over the stairwell of stair ${stair.id}.`,
        refs: [wall.id, stair.id],
      })),
  );

/** Once the upper level has rooms, the stairwell should open into one of them. */
export const stairwellOutsideRoom: Rule = ({ wells, model: { rooms } }) => {
  if (rooms.length === 0) return [];
  const tol = 0.05;
  return wells
    .filter(({ geometry: g }) => {
      const corners = g.footprint.flatMap(rectCorners);
      return !rooms.some((r) => corners.every((p) => inRoomNear(r, p, tol)));
    })
    .map(({ stair }): Issue => ({
      severity: "warning",
      code: "stairwell_outside_room",
      message: `The stairwell of stair ${stair.id} is not inside any room on the level it reaches.`,
      refs: [stair.id],
    }));
};

/** Furniture standing on a stair's flights or landing. */
export const itemOnStair: Rule = ({ stairs, placed }) =>
  stairs.flatMap(({ stair, geometry: g }) =>
    placed
      .filter((p) => !boxesApart(p.box, g.box) && anyOverlap(g.footprint, p.rect, 0.01))
      .map(({ item, def }): Issue => ({
        severity: "error",
        code: "item_on_stair",
        message: `${kindName(def)} stands on stair ${stair.id}.`,
        refs: [item.id, stair.id],
      })),
  );

/** Furniture on the upper level standing over the stairwell: there is no floor under it. */
export const itemOverStairwell: Rule = ({ wells, placed }) =>
  wells.flatMap(({ stair, geometry: g }) =>
    placed
      .filter((p) => !boxesApart(p.box, g.box) && anyOverlap(g.footprint, p.rect, 0.01))
      .map(({ item, def }): Issue => ({
        severity: "error",
        code: "item_over_stairwell",
        message: `${kindName(def)} stands over the stairwell of stair ${stair.id}, where there is no floor.`,
        refs: [item.id, stair.id],
      })),
  );

/** Two stairs on one level on top of each other. Each pair is reported once. */
export const stairsOverlap: Rule = ({ stairs }) => {
  const issues: Issue[] = [];
  for (let i = 0; i < stairs.length; i++) {
    for (let j = i + 1; j < stairs.length; j++) {
      const a = stairs[i];
      const b = stairs[j];
      if (boxesApart(a.geometry.box, b.geometry.box)) continue;
      if (a.geometry.footprint.some((r) => anyOverlap(b.geometry.footprint, r))) {
        issues.push({
          severity: "error",
          code: "stairs_overlap",
          message: `Stairs ${a.stair.id} and ${b.stair.id} overlap.`,
          refs: [a.stair.id, b.stair.id],
        });
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------- columns and parking
// A column is checked on the level it stands on (what it is in, what it is in the way of) and
// against the level below (what it stands on); a floor is checked against the level below it
// (what carries it). Sanity checks with the numbers in limits.ts, not engineering.

/** The floor a parked car needs: its footprint grown by PARKING's side and end clearances. */
export const parkingClearance = (rect: ORect): ORect => ({ ...rect, hw: rect.hw + PARKING.side, hd: rect.hd + PARKING.end });

/**
 * What a column must keep out of at an opening: the drive through a garage door (its width,
 * GARAGE_DOOR.approach either side of the wall); a hinged door's or a window's vano (a hinged
 * door's leaves are tested on their own, columnInSwing). A column beside the jamb, in the wall,
 * is in none of them.
 */
function columnKeepOut({ opening: o, wall, center, clearance }: HostedOpening): ORect {
  if (isGarageDoor(o)) return { ...clearance, hw: o.width / 2, hd: wall.thickness / 2 + GARAGE_DOOR.approach };
  return { ...clearance, cx: center.x, cy: center.y, hw: o.width / 2, hd: wall.thickness / 2 };
}

/** Whether a column stands in the floor a hinged door's leaves sweep (doorLeaves, leafSweep), sharing more than DOOR_SWINGS_TOUCH of it. */
function columnInSwing(c: Column, { opening: o, wall }: HostedOpening): boolean {
  if (o.kind !== "door" || isGarageDoor(o)) return false;
  const section = columnFootprint(c);
  const box = boxOf(section);
  return doorLeaves(wall, o)
    .map(leafSweep)
    .some((sweep) => !boxesApart(box, boxOf(sweep)) && sharedArea(section, sweep) > DOOR_SWINGS_TOUCH);
}

const columnWord = (c: Column): string => `Column ${c.id}`;

/** A column should stand on its level's floor: in one of its rooms (or on its edge), or in one of its walls. */
export const columnOffFloor: Rule = ({ model, columns }) => {
  if (model.rooms.length === 0 && model.walls.length === 0) return [];
  return columns
    .filter(({ column: c }) => !model.rooms.some((r) => inRoomNear(r, c, 0.05)) && columnWalls(model.walls, c).length === 0)
    .map(({ column: c }): Issue => ({
      severity: "warning",
      code: "column_off_floor",
      message: `${columnWord(c)} at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) stands in no room and no wall of its level: it is off the floor.`,
      refs: [c.id],
    }));
};

/**
 * On a level above the ground, a column carries its load down: under it there should be a column
 * of the level below (their sections overlapping, within SUPPORT.stack) or a wall of it, one that
 * reaches the slab between them (levels.ts reachesSlab): a stub or a low partition carries nothing.
 */
export const columnUnsupported: Rule = ({ plan, level, columns }) => {
  const below = levelBelow(plan, level.level.id);
  if (!below || columns.length === 0) return [];
  const h = below.level.height;
  const walls = plan.walls.filter((w) => w.levelId === below.level.id && reachesSlab(w.height, h));
  const under = plan.columns.filter((c) => c.levelId === below.level.id && reachesSlab(columnHeight(plan, c) ?? 0, h));
  return columns
    .filter(({ column: c }) => {
      const onColumn = under.some((u) => columnDistance(c, u) <= SUPPORT.stack || columnsHit(c, u));
      const onWall = walls.some((w) => wallDistance(c, w) <= w.thickness / 2 + SUPPORT.stack);
      return !onColumn && !onWall;
    })
    .map(({ column: c }): Issue => ({
      severity: "warning",
      code: "column_unsupported",
      message: `${columnWord(c)} stands on nothing on ${below.level.name}: put a column or a wall under it there, so its load reaches the ground.`,
      refs: [c.id],
    }));
};

/** A column in a door's way (its vano, its leaves' swing, a garage door's drive) or in a window's vano. */
export const columnBlocksOpening: Rule = ({ hosted, columns }) => {
  const issues: Issue[] = [];
  for (const { column: c, box } of columns) {
    for (const h of hosted) {
      const zone = columnKeepOut(h);
      const inVano = !boxesApart(box, boxOf(rectCorners(zone))) && columnHitsRect(c, zone, 0.01);
      if (!inVano && !columnInSwing(c, h)) continue;
      const o = h.opening;
      issues.push(
        o.kind === "door"
          ? {
              severity: "error",
              code: "column_blocks_door",
              message: isGarageDoor(o)
                ? `${columnWord(c)} stands in the drive through garage door ${o.id}: keep ${GARAGE_DOOR.approach} m either side of it clear across its ${o.width.toFixed(2)} m width.`
                : inVano
                  ? `${columnWord(c)} stands in the doorway of door ${o.id}.`
                  : `${columnWord(c)} blocks the swing path of door ${o.id}.`,
              refs: [c.id, o.id],
            }
          : { severity: "error", code: "column_in_opening", message: `${columnWord(c)} stands in window ${o.id}.`, refs: [c.id, o.id] },
      );
    }
  }
  return issues;
};

/** A column on top of another one, a stair's flight, or a piece of furniture (a rug lies round it). */
export const columnCollisions: Rule = ({ columns, stairs, placed }) => {
  const issues: Issue[] = [];
  for (let i = 0; i < columns.length; i++) {
    const a = columns[i];
    for (let j = i + 1; j < columns.length; j++) {
      const b = columns[j];
      if (!boxesApart(a.box, b.box) && columnsHit(a.column, b.column, 0.01)) {
        issues.push({ severity: "error", code: "columns_overlap", message: `Columns ${a.column.id} and ${b.column.id} overlap.`, refs: [a.column.id, b.column.id] });
      }
    }
    for (const { stair, geometry: g } of stairs) {
      if (!boxesApart(a.box, g.box) && g.footprint.some((r) => columnHitsRect(a.column, r, 0.01))) {
        issues.push({ severity: "error", code: "column_on_stair", message: `${columnWord(a.column)} stands in stair ${stair.id}.`, refs: [a.column.id, stair.id] });
      }
    }
    for (const { item, def, rect, box } of placed) {
      if (def.isRug || boxesApart(a.box, box) || !columnHitsRect(a.column, rect, 0.01)) continue;
      issues.push({ severity: "error", code: "item_hits_column", message: `${kindName(def)} runs into ${columnWord(a.column).toLowerCase()}.`, refs: [item.id, a.column.id] });
    }
  }
  return issues;
};

/** How a car's drive-in lane leaves its space: through a garage door, or out of an open side. */
export type LaneExit = { readonly through: "garage_door"; readonly door: string } | { readonly through: "open_side" };

/** A clear way a parked car is driven in: straight out of one of its ends to where it leaves its space, and on. */
export interface DriveLane {
  /** the floor it runs over, from the car's end to the exit: as wide as the car plus PARKING.laneSide each side */
  readonly rect: ORect;
  /** how far it runs to its exit, metres */
  readonly length: number;
  readonly exit: LaneExit;
  /**
   * the drive past the exit, as wide, for the car's length and PARKING.end more: the floor the car
   * is driven over to come in and go out, outside its space, on which nothing may stand either
   */
  readonly runOut: ORect;
}

/** A garage door in a wall a lane ran into that does not take the lane: off its line, or too narrow. */
interface NearDoor {
  readonly door: string;
  readonly wall: string;
  /** how far the car would move, square to its length, to stand on the door's line */
  readonly shift: Pt;
  /** the width the door would need to take the lane where the car stands */
  readonly width: number;
}

/** What ended a lane: a wall or a room (`id`), and the exit it had passed on its way, if any. */
interface LaneEnd {
  readonly id: string;
  readonly past: LaneExit | null;
}

/** What following a car's lanes found: the lanes that reach an exit, and what ended the others. */
interface LaneSearch {
  readonly lanes: readonly DriveLane[];
  /** the walls the others ran into, and the exit each had passed first, if any (on the drive outside) */
  readonly walls: readonly LaneEnd[];
  /** the enclosed rooms the others ran on into, with no wall between, likewise */
  readonly rooms: readonly LaneEnd[];
  /** garage doors in those walls that came close to taking a lane */
  readonly near: readonly NearDoor[];
}

/**
 * The lanes a parked car (`car`, a kind marked `parking`) can be driven along, one from each of
 * its ends: a strip as wide as the car plus PARKING.laneSide at each side, followed straight out
 * along the car's length in PARKING.laneStep steps until it passes through a garage door that
 * spans it, leaves the open space the car is in or the whole plan by a side no wall closes, or has
 * gone PARKING.laneReach without meeting anything (all exits); then on past the exit for the
 * car's length and PARKING.end more, its run-out, the drive outside. A wall the lane runs into,
 * before its exit or past it, or an enclosed room (not the car's own) it runs on into, means no
 * lane that way. Columns and furniture are not tested here: they are what can stand in a lane,
 * not what ends it. Only the walls and rooms along the farthest the lane could go are looked at.
 */
function laneSearch(ctx: CheckContext, car: PlacedItem): LaneSearch {
  const { walls, hostedOn, model } = ctx;
  const { rect } = car;
  const halfWidth = rect.hw + PARKING.laneSide;
  const step = PARKING.laneStep;
  const runOut = 2 * rect.hd + PARKING.end;
  // the car's length runs along its local y: (-sin rot, cos rot)
  const along: Pt = { x: -Math.sin(rect.rot), y: Math.cos(rect.rot) };
  const room = model.rooms.find((r) => pointInOutline(car.item, r.points));
  const open = room !== undefined && isOpenRoom(room);
  // the plan's extent on this level, its walls' and its rooms': past it, a lane is out in the open
  const extents = [...walls.map((s) => s.box), ...model.rooms.map((r) => outlineBox(r.points))];
  const all = extents.length > 0 ? extents.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) })) : null;
  const lanes: DriveLane[] = [];
  const blocked: LaneEnd[] = [];
  const into: LaneEnd[] = [];
  const near: NearDoor[] = [];
  for (const sign of [1, -1]) {
    const u = { x: along.x * sign, y: along.y * sign };
    const end = { x: rect.cx + u.x * rect.hd, y: rect.cy + u.y * rect.hd };
    /** the strip from `from` to `to` metres out of the car's end */
    const strip = (from: number, to: number): ORect => ({ cx: end.x + (u.x * (from + to)) / 2, cy: end.y + (u.y * (from + to)) / 2, hw: halfWidth, hd: (to - from) / 2, rot: rect.rot });
    // what the lane could meet at all, out to the farthest it could go
    const corridor = boxOf(rectCorners(strip(0, PARKING.laneReach + runOut)));
    const nearWalls = walls.filter((s) => !boxesApart(s.box, corridor));
    const enclosed = model.rooms.filter((r) => r !== room && !isOpenRoom(r) && !boxesApart(outlineBox(r.points), corridor));
    let exit: { at: number; how: LaneExit; wall: string | null } | null = null;
    let found: DriveLane | null = null;
    let stop: string | null = null;
    let entered: string | null = null;
    for (let k = 1; !found && !stop && !entered; k++) {
      const d = k * step;
      if (exit && d - step >= exit.at + runOut) {
        found = { rect: strip(0, exit.at), length: exit.at, exit: exit.how, runOut: strip(exit.at, exit.at + runOut) };
        break;
      }
      const slab = strip(d - step, d);
      const slabBox = boxOf(rectCorners(slab));
      const hit = nearWalls.find((s) => s.wall.id !== exit?.wall && !boxesApart(s.box, slabBox) && wallHits(s, slab, 0.02));
      if (hit) {
        const doors = (hostedOn.get(hit.wall.id) ?? []).filter((h) => isGarageDoor(h.opening));
        const door: HostedOpening | undefined = exit ? undefined : doors.find((h) => laneAcross(h, slab, u).spans);
        if (door) exit = { at: d, how: { through: "garage_door", door: door.opening.id }, wall: hit.wall.id };
        else {
          stop = hit.wall.id;
          if (!exit) {
            for (const h of doors) {
              const across = laneAcross(h, slab, u);
              if (across.overlaps) near.push({ door: h.opening.id, wall: hit.wall.id, shift: across.shift, width: across.width });
            }
          }
        }
        continue;
      }
      const corners = rectCorners(slab);
      const other = enclosed.find((r) => corners.some((p) => pointInOutline(p, r.points)));
      if (other) {
        entered = other.id;
        continue;
      }
      if (exit) continue;
      const leftRoom = open && corners.every((p) => !pointInOutline(p, room.points));
      const leftPlan = !all || boxesApart(slabBox, all);
      if (leftRoom || leftPlan || d >= PARKING.laneReach) exit = { at: Math.max(d - step, 0), how: { through: "open_side" }, wall: null };
    }
    if (found) lanes.push(found);
    if (stop) blocked.push({ id: stop, past: exit?.how ?? null });
    if (entered) into.push({ id: entered, past: exit?.how ?? null });
  }
  return { lanes, walls: blocked, rooms: into, near };
}

/**
 * How a garage door's vano meets a lane slab crossing its wall: whether it takes the lane's whole
 * width (`spans`) or some of it (`overlaps`), how far the car would move square to its length to
 * stand on the door's line, and the width the door would need to take the lane where it is.
 */
function laneAcross({ opening: o, wall, center }: HostedOpening, slab: ORect, u: Pt): { spans: boolean; overlaps: boolean; shift: Pt; width: number } {
  const edge = wallEdge(wall);
  const at = closestOnEdge(edge, { x: slab.cx, y: slab.cy });
  const tangent = wallTangentAt(wall, at.t);
  // the lane's width measured along the wall, wider the more slanted it crosses it
  const across = Math.abs(u.x * tangent.y - u.y * tangent.x);
  const side = { x: -u.y, y: u.x };
  const off = (center.x - slab.cx) * side.x + (center.y - slab.cy) * side.y;
  const shift = { x: side.x * off, y: side.y * off };
  if (across < 1e-6) return { spans: false, overlaps: false, shift, width: Infinity };
  const fromCentre = Math.abs(at.t - o.t) * wallLength(wall);
  const reach = slab.hw / across;
  return { spans: fromCentre + reach <= o.width / 2 + 1e-6, overlaps: fromCentre < o.width / 2 + reach, shift, width: 2 * (fromCentre + reach) };
}

/**
 * The drive-in lanes of every parked car on a level of the plan (the ground floor by default),
 * by the car's id: the clear way or ways it can be driven in, none for a car shut in.
 */
export function driveInLanes(plan: PlanModel, levelId: string = plan.levels[0].id): ReadonlyMap<string, readonly DriveLane[]> {
  const ctx = checkContext(levelSlice(plan, levelId), plan, levelId);
  return new Map(ctx.placed.filter((p) => p.def.parking).map((p) => [p.item.id, laneSearch(ctx, p).lanes]));
}

/**
 * A parked car another one is parked in line behind, in its lane: a tandem, which is deliberate —
 * the car in front is driven out first, along the same line (its own lane is checked as its own).
 * Square to the lane, or off its line, a car stands in the way.
 */
function inTandem(other: PlacedItem, lane: ORect): boolean {
  if (!other.def.parking) return false;
  if (Math.abs(Math.sin(other.rect.rot - lane.rot)) > 1e-6) return false;
  const side = { x: Math.cos(lane.rot), y: Math.sin(lane.rot) };
  const off = Math.abs((other.rect.cx - lane.cx) * side.x + (other.rect.cy - lane.cy) * side.y);
  return off + other.rect.hw <= lane.hw + 1e-6;
}

/** Metres to the centimetre, for a message. */
const cm = (v: number): string => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);

/**
 * A parked car (a kind marked `parking`) needs PARKING's clear floor round it: no column in it,
 * no wall through it, and, in an enclosed room, all of it inside that room — the garage it is in.
 * An open space's open sides are where its people get out, so only its walls and columns count.
 *
 * A car that fits must also be one that can be driven there: from one of its ends a straight lane
 * (laneSearch) to a garage door or an open side, and on over the drive outside, with no column or
 * furniture standing in it (another car parked in line on it is a tandem: inTandem). Each thing is
 * reported once: a column in the car's clearance is that, not also in its lane; one in the drive
 * through the lane's garage door is the door's (columnBlocksOpening); and a car that does not fit
 * is not asked for a lane. A car shut in is told what would let it out: a garage door in the wall
 * ahead that is off its line or too narrow, or one in a wall beside it.
 */
export const parkingClear: Rule = (ctx) => {
  const { model, placed, walls, columns, hosted } = ctx;
  const { rooms } = model;
  const issues: Issue[] = [];
  for (const car of placed) {
    const { item, def, rect } = car;
    if (!def.parking) continue;
    const zone = parkingClearance(rect);
    const zoneBox = boxOf(rectCorners(zone));
    const inClearance = new Set<string>();
    for (const { column: c, box } of columns) {
      if (!boxesApart(box, zoneBox) && columnHitsRect(c, zone, 0.01)) {
        inClearance.add(c.id);
        issues.push({
          severity: "error",
          code: "column_blocks_parking",
          message: `${columnWord(c)} stands in the ${PARKING.side} m clearance ${kindName(def)} needs at its sides (${PARKING.end} m at its ends): the doors would not open.`,
          refs: [c.id, item.id],
        });
      }
    }
    const wall = walls.find((s) => !boxesApart(s.box, zoneBox) && wallHits(s, zone, 0.02));
    const room = rooms.find((r) => pointInOutline(item, r.points));
    const outside = room && !isOpenRoom(room) && !rectCorners(zone).every((p) => inRoomNear(room, p, 0.05));
    if (wall || outside) {
      issues.push({
        severity: "error",
        code: "car_does_not_fit",
        message: `${kindName(def)} does not fit ${room ? `"${room.label}"` : "where it stands"}: with ${PARKING.side} m at its sides and ${PARKING.end} m at its ends it ${wall ? `runs into wall ${wall.wall.id}` : "reaches past the room's walls"}.`,
        refs: wall ? [item.id, wall.wall.id] : room ? [item.id, room.id] : [item.id],
      });
      continue;
    }
    const width = 2 * (rect.hw + PARKING.laneSide);
    const search = laneSearch(ctx, car);
    if (search.lanes.length === 0) {
      const into = [...new Set(search.walls.map((e) => e.id))];
      const onInto = [...new Set(search.rooms.map((e) => e.id))].map((id) => rooms.find((r) => r.id === id)!);
      const pastOf = (e: LaneEnd) => (e.past === null ? "" : e.past.through === "garage_door" ? ` past garage door ${e.past.door}` : " past its open side");
      const ends = [
        ...search.walls.map((e) => `wall ${e.id}${pastOf(e)}`),
        ...search.rooms.map((e) => `"${rooms.find((r) => r.id === e.id)!.label}"${pastOf(e)}, with no wall between`),
      ].join(" and ");
      // what would let it out: a garage door ahead that misses its line, or one beside it
      const near = search.near.map((n) => {
        const off = Math.hypot(n.shift.x, n.shift.y);
        const to = `(${cm(item.x + n.shift.x)}, ${cm(item.y + n.shift.y)})`;
        return off < 0.005
          ? `garage door ${n.door} in wall ${n.wall} is too narrow for its lane: widen it to ${cm(n.width)} m`
          : `garage door ${n.door} in wall ${n.wall} is ${cm(off)} m off the car's line: centre the car on it at ${to}, or widen the door to ${cm(n.width)} m`;
      });
      const ahead = new Set([...search.near.map((n) => n.door), ...[...search.walls, ...search.rooms].flatMap((e) => (e.past?.through === "garage_door" ? [e.past.door] : []))]);
      const beside = room
        ? hosted.filter((h) => {
            if (!isGarageDoor(h.opening) || ahead.has(h.opening.id)) return false;
            const u = wallTangentAt(h.wall, h.opening.t);
            const reach = h.wall.thickness / 2 + PARKING.laneStep;
            return [1, -1].some((s) => pointInOutline({ x: h.center.x - u.y * reach * s, y: h.center.y + u.x * reach * s }, room.points));
          })
        : [];
      const fixes = [...near, ...beside.map((h) => `garage door ${h.opening.id} is in wall ${h.wall.id}, not at either end of the car: turn the car or move the door`)];
      issues.push({
        severity: "error",
        code: "car_no_lane",
        message:
          `${kindName(def)} ${room ? `in "${room.label}" ` : ""}cannot be driven in: straight out of either end it runs into ${ends}` +
          (fixes.length > 0 ? `; ${fixes.join("; ")}.` : `, with no garage door across its line and no open side.`) +
          ` It needs a straight lane ${width.toFixed(2)} m wide to a garage door or an open side, and the car's length and ${PARKING.end} m clear past it.`,
        refs: [item.id, ...into, ...onInto.map((r) => r.id), ...search.near.map((n) => n.door), ...beside.map((h) => h.opening.id)],
      });
      continue;
    }
    // what stands in each lane, inside or on the drive past its exit: columns (those not already in
    // the car's clearance, nor in the drive through the lane's own garage door, which is that
    // door's issue) and furniture, other than a car parked in line on it
    const blockers = search.lanes.map((lane) => {
      const door = lane.exit.through === "garage_door" ? lane.exit.door : null;
      const doorDrive = door ? hosted.find((h) => h.opening.id === door) : undefined;
      const found = (strip: ORect) => {
        const box = boxOf(rectCorners(strip));
        const cols = columns.filter(
          ({ column: c, box: cb }) =>
            !inClearance.has(c.id) && !boxesApart(cb, box) && columnHitsRect(c, strip, 0.01) && !(doorDrive && columnHitsRect(c, columnKeepOut(doorDrive), 0.01)),
        );
        const things = placed.filter((p) => p.item.id !== item.id && !p.def.isRug && !boxesApart(p.box, box) && satRectRect(p.rect, strip, 0.01) && !inTandem(p, strip));
        return { cols, things };
      };
      const inside = found(lane.rect);
      const past = found(lane.runOut);
      const seen = new Set([...inside.cols.map((c) => c.column.id), ...inside.things.map((p) => p.item.id)]);
      return {
        lane,
        inside,
        past: { cols: past.cols.filter((c) => !seen.has(c.column.id)), things: past.things.filter((p) => !seen.has(p.item.id)) },
        count: inside.cols.length + inside.things.length + past.cols.length + past.things.length,
      };
    });
    if (blockers.some((b) => b.count === 0)) continue;
    const first = blockers.reduce((a, b) => (b.count < a.count ? b : a));
    const exit = first.lane.exit.through === "garage_door" ? `garage door ${first.lane.exit.door}` : "its open side";
    for (const [where, set] of [
      [`to ${exit}`, first.inside],
      [`on the drive past ${exit}`, first.past],
    ] as const) {
      for (const { column: c } of set.cols) {
        issues.push({
          severity: "error",
          code: "column_blocks_lane",
          message: `${columnWord(c)} stands in the drive-in lane of ${kindName(def)} (${width.toFixed(2)} m wide, ${where}): a car cannot be driven past it.`,
          refs: [c.id, item.id],
        });
      }
      for (const p of set.things) {
        issues.push({
          severity: "error",
          code: "item_blocks_lane",
          message: `${kindName(p.def)} stands in the drive-in lane of ${kindName(def)} (${width.toFixed(2)} m wide, ${where}).`,
          refs: [p.item.id, item.id],
        });
      }
    }
  }
  return issues;
};

/**
 * A garage door is the way from an enclosed garage out to a drive. One with no enclosed room on
 * either side of it opens nothing (a door in a space already open has no use); one between two
 * enclosed rooms, or one whose drive (GARAGE_DOOR.approach deep outside it, across its width) a
 * wall stands in, has nowhere for a car to come from. Asked of a plan once it has rooms.
 */
export const garageDoorUse: Rule = ({ model: { rooms }, hosted, walls }) => {
  if (rooms.length === 0) return [];
  return hosted.flatMap((h): Issue[] => {
    const { opening: o, wall, center } = h;
    if (!isGarageDoor(o)) return [];
    const u = wallTangentAt(wall, o.t);
    const n = { x: -u.y, y: u.x };
    const reach = wall.thickness / 2 + GARAGE_DOOR.approach / 2;
    const sides = [1, -1].map((s) => {
      const p = { x: center.x + n.x * reach * s, y: center.y + n.y * reach * s };
      return { s, room: rooms.find((r) => pointInOutline(p, r.points)) };
    });
    const enclosed = sides.filter((x) => x.room && !isOpenRoom(x.room));
    if (enclosed.length === 0) {
      return [
        {
          severity: "warning",
          code: "garage_door_no_garage",
          message: `Garage door ${o.id} opens no garage: there is no enclosed room on either side of it${sides.some((x) => x.room) ? `, and "${sides.find((x) => x.room)!.room!.label}" is already open` : ""}. A garage door closes an enclosed garage off from the drive; put it in a garage's wall, or take it out.`,
          refs: [o.id, ...sides.flatMap((x) => (x.room ? [x.room.id] : []))],
        },
      ];
    }
    if (enclosed.length === 2) {
      return [
        {
          severity: "warning",
          code: "garage_door_no_drive",
          message: `Garage door ${o.id} opens from "${enclosed[0].room!.label}" into "${enclosed[1].room!.label}": a garage door leads from a garage out to a drive.`,
          refs: [o.id, enclosed[0].room!.id, enclosed[1].room!.id],
        },
      ];
    }
    const out = sides.find((x) => x !== enclosed[0])!.s;
    const drive: ORect = { ...h.clearance, cx: center.x + n.x * out * (wall.thickness / 2 + GARAGE_DOOR.approach / 2), cy: center.y + n.y * out * (wall.thickness / 2 + GARAGE_DOOR.approach / 2), hw: o.width / 2, hd: GARAGE_DOOR.approach / 2 };
    const driveBox = boxOf(rectCorners(drive));
    const across = walls.find((s) => s.wall.id !== wall.id && !boxesApart(s.box, driveBox) && wallHits(s, drive, 0.02));
    return across
      ? [
          {
            severity: "warning",
            code: "garage_door_no_drive",
            message: `Garage door ${o.id} faces wall ${across.wall.id}: the ${GARAGE_DOOR.approach} m in front of it, across its width, is where a car comes in.`,
            refs: [o.id, across.wall.id],
          },
        ]
      : [];
  });
};

/** A garage door wider than its wall can hold with its jambs, or sized outside a garage door's range. */
export const garageDoorFit: Rule = ({ hosted }) =>
  hosted.flatMap(({ opening: o, wall }): Issue[] => {
    if (!isGarageDoor(o)) return [];
    const wide = garageDoorFitError(wall, o.width);
    if (wide) return [{ severity: "error", code: "garage_door_too_wide", message: wide, refs: [o.id, wall.id] }];
    const { width, height } = GARAGE_DOOR;
    if (o.width < width.min - 1e-9 || o.width > width.max + 1e-9 || o.height < height.min - 1e-9 || o.height > height.max + 1e-9) {
      return [
        {
          severity: "warning",
          code: "garage_door_size",
          message: `Garage door ${o.id} is ${o.width.toFixed(2)} × ${o.height.toFixed(2)} m; a garage door is ${width.min}-${width.max} m wide and ${height.min}-${height.max} m tall.`,
          refs: [o.id],
        },
      ];
    }
    return [];
  });

/**
 * An upper floor must be carried: every point of its rooms within SUPPORT.span / 2 of a wall or a
 * column of the level below (model/supports.ts). Each stretch that is not is reported once, with
 * where it is, so a column can be put under it.
 */
export const slabUnsupported: Rule = ({ plan, level }) =>
  unsupportedZones(plan, level.level.id).map((z): Issue => ({
    severity: "warning",
    code: "slab_unsupported",
    message: `${z.area.toFixed(2)} m² of the floor of ${level.level.name} (x ${z.box.minX.toFixed(2)} to ${z.box.maxX.toFixed(2)}, y ${z.box.minY.toFixed(2)} to ${z.box.maxY.toFixed(2)}, around (${z.centre.x.toFixed(2)}, ${z.centre.y.toFixed(2)})) has no wall or column under it within ${(SUPPORT.span / 2).toFixed(2)} m ${Number.isFinite(z.reach) ? `(its furthest point ${z.reach.toFixed(2)} m)` : "(nothing on the level below reaches its slab)"}: put a column or a wall under it on the level below.`,
    refs: z.rooms,
  }));

// ---------------------------------------------------------------------------- storeys

/**
 * Under a level above, a wall should reach the underside of its slab: a wall that stops short
 * leaves an open band under the floor above (a half-height partition is the one kind meant to),
 * and one that runs past it stands up through that floor. The top level has no slab over it.
 */
export const wallSlabFit: Rule = ({ model, level, above }) => {
  if (!above) return [];
  const underside = slabUnderside(level.level.height);
  return model.walls.flatMap((w): Issue[] => {
    const fit = slabFit(w.height, level.level.height);
    if (fit === "meets") return [];
    const gap = underside - w.height;
    return fit === "short"
      ? [
          {
            severity: "warning",
            code: "wall_short_of_slab",
            message: `Wall ${w.id} is ${w.height.toFixed(2)} m tall and stops ${gap.toFixed(2)} m under the ${SLAB_THICKNESS} m slab of ${above.level.name} (its underside is ${underside.toFixed(2)} m up). Raise it to ${underside.toFixed(2)} m unless it is meant as a low partition.`,
            refs: [w.id],
          },
        ]
      : [
          {
            severity: "error",
            code: "wall_through_slab",
            message: `Wall ${w.id} is ${w.height.toFixed(2)} m tall and runs ${(-gap).toFixed(2)} m up through the floor of ${above.level.name} (the slab's underside is ${underside.toFixed(2)} m up). Lower it to ${underside.toFixed(2)} m.`,
            refs: [w.id],
          },
        ];
  });
};

/**
 * Under a level above, a column with a height of its own should reach the underside of the slab,
 * as a wall should (wallSlabFit, the same tolerance): one that stops short carries nothing (the
 * floor over it is checked as if it were not there), and one that runs past it stands up through
 * that floor. A column without a height reaches the slab by definition; the top level has no slab.
 */
export const columnSlabFit: Rule = ({ plan, level, above, columns }) => {
  if (!above) return [];
  const underside = slabUnderside(level.level.height);
  return columns.flatMap(({ column: c }): Issue[] => {
    const height = columnHeight(plan, c);
    if (height === undefined) return [];
    const fit = slabFit(height, level.level.height);
    if (fit === "meets") return [];
    return fit === "short"
      ? [
          {
            severity: "warning",
            code: "column_short_of_slab",
            message: `${columnWord(c)} is ${height.toFixed(2)} m tall and stops ${(underside - height).toFixed(2)} m under the ${SLAB_THICKNESS} m slab of ${above.level.name} (its underside is ${underside.toFixed(2)} m up): it carries nothing. Clear its height so it reaches the slab.`,
            refs: [c.id],
          },
        ]
      : [
          {
            severity: "error",
            code: "column_through_slab",
            message: `${columnWord(c)} is ${height.toFixed(2)} m tall and runs ${(height - underside).toFixed(2)} m up through the floor of ${above.level.name} (the slab's underside is ${underside.toFixed(2)} m up). Clear its height so it stops at the slab.`,
            refs: [c.id],
          },
        ];
  });
};

// ---------------------------------------------------------------------------- the checker

/** Every rule the checker runs, in the order their issues are reported. */
export const RULES: readonly Rule[] = Object.freeze([
  wallTooShort,
  wallArcTooTight,
  wallIntersections,
  wallLooseEnds,
  openingOrphan,
  openingFit,
  openingsOverlap,
  wallEndsInOpening,
  roomOutline,
  roomTooSmall,
  roomFloating,
  roomNoDoor,
  roomsOverlap,
  itemUnknown,
  itemThroughWall,
  itemBlocksOpening,
  doorsSwingTogether,
  itemsOverlap,
  itemOutsideRooms,
  wallSlabFit,
  stairNoUpperLevel,
  stairDimensions,
  stairHeadroom,
  stairCrossesWall,
  stairExitBlocked,
  stairwellBlocked,
  stairwellOutsideRoom,
  itemOnStair,
  itemOverStairwell,
  stairsOverlap,
  columnOffFloor,
  columnUnsupported,
  columnSlabFit,
  columnBlocksOpening,
  columnCollisions,
  parkingClear,
  garageDoorFit,
  garageDoorUse,
  slabUnsupported,
]);

/**
 * Run `rules` (all of them by default) over the plan, level by level from the ground up. Each
 * level is checked on its own — a wall upstairs never crosses one downstairs — with one context
 * its rules share. A one-storey plan is one level, checked over one context, as it always was.
 */
export function checkModel(model: PlanModel, rules: readonly Rule[] = RULES): Issue[] {
  return model.levels.flatMap((level) => checkLevel(model, level.id, rules));
}

/** Run `rules` over one level of the plan. */
const checkLevel = (model: PlanModel, levelId: string, rules: readonly Rule[]): Issue[] => {
  const ctx = checkContext(levelSlice(model, levelId), model, levelId);
  return rules.flatMap((rule) => rule(ctx));
};

/** Every plan's full check, by level, computed once. Plans are immutable, so a plan's issues never change. */
interface PlanIssues {
  readonly all: readonly Issue[];
  readonly byLevel: ReadonlyMap<string, readonly Issue[]>;
}
const issuesByModel = new WeakMap<PlanModel, PlanIssues>();

const NO_ISSUES: readonly Issue[] = Object.freeze([]);

const freezeIssue = (i: Issue): Issue => Object.freeze({ ...i, refs: Object.freeze([...i.refs]) });

function planIssues(model: PlanModel): PlanIssues {
  let found = issuesByModel.get(model);
  if (!found) {
    const byLevel = new Map<string, readonly Issue[]>();
    for (const level of model.levels) byLevel.set(level.id, Object.freeze(checkLevel(model, level.id, RULES).map(freezeIssue)));
    found = { all: Object.freeze([...byLevel.values()].flat()), byLevel };
    issuesByModel.set(model, found);
  }
  return found;
}

/**
 * The plan's issues under every rule: the derived value the Issues tab, its count badge and
 * the get_issues tool all read. It is computed the first time a plan object is asked about and
 * kept for as long as that object lives, so a render, a tab switch or an agent asking twice
 * costs nothing. Frozen, because every reader shares the one list.
 */
export const issuesOf = (model: PlanModel): readonly Issue[] => planIssues(model).all;

/**
 * The issues found on one level: about its walls, rooms, items and the stairs that start on it,
 * and about the stairwells in its floor (what stands over them, the floor past their top).
 * Shared and frozen like issuesOf; empty for a level the plan does not have.
 */
export const issuesOnLevel = (model: PlanModel, levelId: string): readonly Issue[] => planIssues(model).byLevel.get(levelId) ?? NO_ISSUES;

