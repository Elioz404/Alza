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
import { ROOM_SIZE, SLAB_THICKNESS, STAIR, WALL_MIN_LENGTH, WALL_SLAB_TOLERANCE } from "./limits";
import { levelAbove, levelInfo, levelSlice, levelsOf, slabUnderside, stairwellsOf, type LevelInfo, type Stairwell } from "./levels";
import { stairGeometry } from "./stairs";

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
  return { model, plan, level, above, stairs, wells, wallById, catalog, walls, hosted, hostedOn, placed };
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

// ---------------------------------------------------------------------------- stairs
// A stair is checked on the level it stands on (its steps, its foot) and its stairwell on the
// level it arrives on (the void, what stands over it, the floor past its top), so every issue is
// reported with the level whose entities it names.

const round3 = (v: number): string => v.toFixed(3);

/** Does any of `rects` overlap `other` (touching does not count)? */
const anyOverlap = (rects: readonly ORect[], other: ORect, eps = 1e-9): boolean => rects.some((r) => satRectRect(r, other, eps));

/** Does wall `s` cross any of `rects`? A wall merely touching (2 cm) is a wall the stair stands against. */
const wallCrosses = (s: WallShape, rects: readonly ORect[], box: Box): boolean =>
  !boxesApart(s.box, box) && rects.some((r) => satRectWall(r, s.wall, 0.02));

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
      return !rooms.some((r) => corners.every((p) => p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol));
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
    const gap = underside - w.height;
    if (Math.abs(gap) <= WALL_SLAB_TOLERANCE + 1e-9) return [];
    return gap > 0
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

