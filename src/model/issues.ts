/**
 * Constraint engine — the metric precision checker agents use to self-repair.
 *
 * The checker is a list of rules. Each rule is a function of one shared, precomputed context
 * (walls by id, the plan's catalogue, every opening on its wall, every item's footprint) and
 * returns the issues it finds, with entity refs so callers can act on them. A rule can be run
 * and tested on its own, and a new one is added by writing it and listing it in RULES.
 */

import type { Issue, Item, KindDef, Opening, PlanModel, Room, Wall } from "./types";
import {
  aabbOverlap,
  areCollinear,
  boxOf,
  boxesApart,
  collinearOverlap,
  dist,
  pointOnSeg,
  pointSegDist,
  satRectRect,
  satRectWall,
  segLen,
  segPoint,
  segmentsCross,
  rectCorners,
  wallAsRect,
  type Box,
  type ORect,
  type Pt,
} from "./geometry";
import { catalogOf, kindName, type Catalog } from "./catalog";
import { ROOM_SIZE, WALL_MIN_LENGTH } from "./limits";

const ENDPOINT_SNAP = 0.08; // endpoints closer than this count as connected
const DOOR_CLEAR = 0.1; // furniture must keep this margin in front of openings

const wA = (w: Wall): Pt => ({ x: w.ax, y: w.ay });
const wB = (w: Wall): Pt => ({ x: w.bx, y: w.by });

/** Center point of an opening in world coordinates. */
export function openingCenter(wall: Wall, o: Opening): Pt {
  return segPoint(wA(wall), wB(wall), o.t);
}

/** Opening span (start/end t) clamped so the full vano fits inside the wall. */
export function openingSpan(wall: Wall, o: Opening): [number, number] {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const half = o.width / 2 / Math.max(len, 1e-9);
  return [o.t - half, o.t + half];
}

/** Clamp an opening's t so the whole vano stays inside the wall. Returns null if the wall is too short. */
export function clampOpeningT(wall: Wall, width: number, t: number): number | null {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (width > len - 0.02) return null;
  const half = width / 2 / len;
  const lo = half;
  const hi = 1 - half;
  return Math.min(hi, Math.max(lo, t));
}

// ---------------------------------------------------------------------------- context

/** A wall with the shapes the pairwise rules test it as, computed once per check. */
export interface WallShape {
  readonly wall: Wall;
  readonly a: Pt;
  readonly b: Pt;
  /** bounds of the centreline segment */
  readonly segBox: Box;
  /** bounds of the wall as a thick rectangle */
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

/** What every rule reads, computed once per check. */
export interface CheckContext {
  readonly model: PlanModel;
  readonly wallById: ReadonlyMap<string, Wall>;
  readonly catalog: Catalog;
  readonly walls: readonly WallShape[];
  readonly hosted: readonly HostedOpening[];
  /** the hosted openings of each wall, by wall id */
  readonly hostedOn: ReadonlyMap<string, readonly HostedOpening[]>;
  readonly placed: readonly PlacedItem[];
}

/** One check over the plan. */
export type Rule = (ctx: CheckContext) => Issue[];

/** The floor in front of an opening furniture must keep clear: a door's swing, a window's reach. */
function clearanceOf(wall: Wall, o: Opening, center: Pt): ORect {
  return {
    cx: center.x,
    cy: center.y,
    hw: o.width / 2 + DOOR_CLEAR,
    hd: wall.thickness / 2 + (o.kind === "door" ? 0.8 : 0.4),
    rot: Math.atan2(wall.by - wall.ay, wall.bx - wall.ax),
  };
}

export function checkContext(model: PlanModel): CheckContext {
  const wallById = new Map(model.walls.map((w) => [w.id, w]));
  const catalog = catalogOf(model);
  const walls = model.walls.map((wall): WallShape => {
    const a = wA(wall);
    const b = wB(wall);
    return {
      wall,
      a,
      b,
      segBox: boxOf([a, b]),
      box: boxOf(rectCorners(wallAsRect(wall.ax, wall.ay, wall.bx, wall.by, wall.thickness))),
    };
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
  return { model, wallById, catalog, walls, hosted, hostedOn, placed };
}

/** The four edges of a room, clockwise from its top-left corner. */
const roomEdges = (r: Room): [Pt, Pt][] => [
  [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
  [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
  [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
];

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

/** An endpoint that touches nothing (T-junctions count as connected). */
export const wallLooseEnds: Rule = ({ walls }) => {
  if (walls.length <= 1) return [];
  const issues: Issue[] = [];
  for (const { wall: w, a, b } of walls) {
    for (const end of [a, b] as const) {
      const connected = walls.some(
        (other) =>
          other.wall.id !== w.id &&
          (dist(end, other.a) < ENDPOINT_SNAP ||
            dist(end, other.b) < ENDPOINT_SNAP ||
            pointOnSeg(end, other.a, other.b, ENDPOINT_SNAP)),
      );
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
        message: `${o.kind} ${o.id} extends past the end of wall ${wall.id}.`,
        refs: [o.id, wall.id],
      });
    }
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
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by) || 1;
    const dx = wall.bx - wall.ax;
    const dy = wall.by - wall.ay;
    for (const other of walls) {
      if (other.id === wall.id) continue;
      for (const end of [wA(other), wB(other)] as const) {
        if (!pointOnSeg(end, wA(wall), wB(wall), 0.02)) continue;
        // param of the endpoint along the host wall
        const t = ((end.x - wall.ax) * dx + (end.y - wall.ay) * dy) / (len * len);
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

export const roomTooSmall: Rule = ({ model }) =>
  model.rooms
    .filter((r) => r.w < ROOM_SIZE.min || r.h < ROOM_SIZE.min)
    .map((r): Issue => ({
      severity: "error",
      code: "room_too_small",
      message: `Room "${r.label}" is smaller than ${ROOM_SIZE.min} × ${ROOM_SIZE.min} m.`,
      refs: [r.id],
    }));

/** No wall near any corner of the room. */
export const roomFloating: Rule = ({ model: { rooms, walls } }) => {
  if (walls.length === 0) return [];
  return rooms
    .filter(
      (r) =>
        !roomEdges(r).some(([e0, e1]) =>
          walls.some((w) => pointSegDist(e0, wA(w), wB(w)) < 0.25 || pointSegDist(e1, wA(w), wB(w)) < 0.25),
        ),
    )
    .map((r): Issue => ({
      severity: "warning",
      code: "room_floating",
      message: `Room "${r.label}" is not bounded by any wall.`,
      refs: [r.id],
    }));
};

/** At least one door must sit on the room's boundary, once the plan has openings at all. */
export const roomNoDoor: Rule = ({ model: { rooms, openings }, hosted }) => {
  if (openings.length === 0) return [];
  const doorCenters = hosted.filter((h) => h.opening.kind === "door").map((h) => h.center);
  return rooms
    .filter((r) => {
      const edges = roomEdges(r);
      return !doorCenters.some((c) => edges.some(([e0, e1]) => pointSegDist(c, e0, e1) < 0.3));
    })
    .map((r): Issue => ({
      severity: "warning",
      code: "room_no_door",
      message: `Room "${r.label}" has no door on its boundary.`,
      refs: [r.id],
    }));
};

export const roomsOverlap: Rule = ({ model: { rooms } }) => {
  const issues: Issue[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (aabbOverlap(rooms[i], rooms[j])) {
        issues.push({
          severity: "error",
          code: "rooms_overlap",
          message: `Rooms "${rooms[i].label}" and "${rooms[j].label}" overlap.`,
          refs: [rooms[i].id, rooms[j].id],
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
      .filter((s) => !boxesApart(box, s.box) && satRectWall(rect, s.wall, 0.02))
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
          message: `${kindName(def)} blocks the swing path of door ${o.id}.`,
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
    .filter(
      ({ item: it }) =>
        !rooms.some((rm) => it.x >= rm.x - 0.05 && it.x <= rm.x + rm.w + 0.05 && it.y >= rm.y - 0.05 && it.y <= rm.y + rm.h + 0.05),
    )
    .map(({ item, def }): Issue => ({
      severity: "warning",
      code: "item_outside_rooms",
      message: `${kindName(def)} is outside every room.`,
      refs: [item.id],
    }));
};

// ---------------------------------------------------------------------------- the checker

/** Every rule the checker runs, in the order their issues are reported. */
export const RULES: readonly Rule[] = Object.freeze([
  wallTooShort,
  wallIntersections,
  wallLooseEnds,
  openingOrphan,
  openingFit,
  openingsOverlap,
  wallEndsInOpening,
  roomTooSmall,
  roomFloating,
  roomNoDoor,
  roomsOverlap,
  itemUnknown,
  itemThroughWall,
  itemBlocksOpening,
  itemsOverlap,
  itemOutsideRooms,
]);

/** Run `rules` (all of them by default) over the plan, sharing one context between them. */
export function checkModel(model: PlanModel, rules: readonly Rule[] = RULES): Issue[] {
  const ctx = checkContext(model);
  return rules.flatMap((rule) => rule(ctx));
}

/** Every plan's full check, computed once. Plans are immutable, so a plan's issues never change. */
const issuesByModel = new WeakMap<PlanModel, readonly Issue[]>();

/**
 * The plan's issues under every rule: the derived value the sidebar's badge, its Check tab and
 * the get_issues tool all read. It is computed the first time a plan object is asked about and
 * kept for as long as that object lives, so a render, a tab switch or an agent asking twice
 * costs nothing. Frozen, because every reader shares the one list.
 */
export function issuesOf(model: PlanModel): readonly Issue[] {
  let issues = issuesByModel.get(model);
  if (!issues) {
    issues = Object.freeze(checkModel(model).map((i) => Object.freeze({ ...i, refs: Object.freeze([...i.refs]) })));
    issuesByModel.set(model, issues);
  }
  return issues;
}
