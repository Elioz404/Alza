/**
 * The plan as data: the format a plan is written in, and how a plan written in an older one
 * is brought up to date.
 *
 * Format 1 had one storey: walls, openings, rooms and items, with no levels. Format 2 has levels
 * and stairs, and every wall, room and item names the level it stands on. Format 3 (the current
 * one, PLAN_FORMAT_VERSION) has free shapes: a room is a polygon (`points`, each corner with the
 * bulge of the edge it starts) rather than a rectangle (x, y, w, h), and a wall may carry a
 * `bulge` and be an arc. A format-1 plan loads as one level, the ground floor, holding all of it;
 * a format-1 or format-2 room loads as its rectangle's four corners, clockwise on the sheet from
 * the top-left one, and every wall of either stays as straight as it was. Nothing is lost on the
 * way: the rectangle is exactly its four corners. A plan from a format newer than this page knows
 * is refused rather than half-read.
 *
 * A plan's id (PlanModel.id) came later than any format and is optional in all of them: a plan
 * saved without one is given one, once, as it loads, and keeps it from then on.
 *
 * The shape is checked before anything is migrated or loaded: types and references (every
 * level an entity names must exist), not the ranges the actions hold edits to. A plan that
 * breaks a range still loads, and the checker reports it, so a drawing is never lost because
 * one of its walls is too short or one of its rooms crosses itself.
 */

import { z } from "zod";
import { newPlanId } from "./ids";
import { groundLevel, type Item, type PlanModel, type Room, type Stair, type Wall } from "./types";
import { describeIssues, floorFinish, hinge, itemCategory, partList, swingSide } from "./schemas";
import { KIND_SOURCES, OPENING_KINDS, PLAN_FORMAT_VERSION, STAIR_SHAPES, STAIR_TURNS } from "./limits";
import { edgeBulge, rectOutline } from "./shapes";

/** A room as formats 1 and 2 wrote it: a rectangle, by its top-left corner and size. */
export interface RectRoom extends Omit<Room, "points"> {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A plan in format 1: one storey, no levels or stairs, entities without a level. */
export interface PlanModelV1 extends Omit<PlanModel, "version" | "id" | "levels" | "stairs" | "walls" | "rooms" | "items"> {
  version?: 1;
  id?: string;
  walls: Omit<Wall, "levelId" | "bulge">[];
  rooms: Omit<RectRoom, "levelId">[];
  items: Omit<Item, "levelId">[];
}

/** A plan in format 2: levels and stairs, rooms as rectangles, every wall straight. */
export interface PlanModelV2 extends Omit<PlanModel, "version" | "id" | "rooms" | "walls"> {
  version: 2;
  id?: string;
  walls: Omit<Wall, "bulge">[];
  rooms: RectRoom[];
}

/** A plan in the current format, saved before plans had ids. */
export type PlanModelUnidentified = Omit<PlanModel, "id"> & { id?: string };

/** Any plan a page can be handed: the current format or an older one. */
export type PlanInput = PlanModel | PlanModelUnidentified | PlanModelV2 | PlanModelV1;

// ---------------------------------------------------------------------------- the shape

const num = z.number();
const id = z.string().min(1);

const wallRecord = z.object({ id, ax: num, ay: num, bx: num, by: num, thickness: num, height: num, levelId: id.optional(), bulge: num.optional() });
const openingRecord = z.object({
  id,
  kind: z.enum(OPENING_KINDS),
  wallId: id,
  t: num,
  width: num,
  sill: num,
  height: num,
  hinge: hinge.optional(),
  side: swingSide.optional(),
});
/** A corner of a room's outline, with the bulge of the edge it starts (format 3). */
const vertexRecord = z.object({ x: num, y: num, bulge: num.optional() });
/** A room as format 3 writes it: its outline. */
const roomRecord = z.object({ id, points: z.array(vertexRecord), label: z.string(), floor: floorFinish, levelId: id.optional() });
/** A room as formats 1 and 2 wrote it: a rectangle. */
const rectRoomRecord = z.object({ id, x: num, y: num, w: num, h: num, label: z.string(), floor: floorFinish, levelId: id.optional() });
const itemRecord = z.object({ id, kind: z.string(), x: num, y: num, rotation: num, levelId: id.optional() });
const kindRecord = z.object({
  kind: z.string(),
  label: z.string(),
  w: num,
  d: num,
  h: num,
  color: z.string(),
  category: itemCategory,
  source: z.enum(KIND_SOURCES),
  isRug: z.boolean().optional(),
  parts: partList.optional(),
});
const underlayRecord = z.object({ assetId: z.string(), opacity: num, x: num, y: num, w: num, h: num, pw: num.optional(), ph: num.optional() });
const levelRecord = z.object({ id, name: z.string(), height: num });
const stairRecord = z.object({
  id,
  levelId: id,
  shape: z.enum(STAIR_SHAPES),
  x: num,
  y: num,
  rotation: num,
  width: num,
  turn: z.enum(STAIR_TURNS).optional(),
  split: z.int().optional(),
  risers: z.int().optional(),
  tread: num.optional(),
});

/**
 * Each kind of entity's record, as this page reads it in the current format: what the shared
 * session checks another tab's entities against (src/session/messages.ts, which also holds every
 * entity to its level, as the current format does).
 */
export const ENTITY_RECORDS = Object.freeze({ levelRecord, wallRecord, openingRecord, roomRecord, itemRecord, stairRecord, kindRecord });

/** What any plan, of any format this page reads, must look like. */
const planRecord = z.object({
  version: z.number().int().min(1).optional(),
  id: id.optional(),
  name: z.string(),
  levels: z.array(levelRecord).optional(),
  walls: z.array(wallRecord),
  openings: z.array(openingRecord),
  rooms: z.array(z.union([roomRecord, rectRoomRecord])),
  items: z.array(itemRecord),
  stairs: z.array(stairRecord).optional(),
  kinds: z.array(kindRecord),
  underlay: underlayRecord.nullable(),
});

// ---------------------------------------------------------------------------- migration

export type Migration = { ok: true; model: PlanModel; from: number } | { ok: false; summary: string };

const refused = (summary: string): { ok: false; summary: string } => ({ ok: false, summary });

/**
 * `input` as a plan in the current format, or why it cannot be one. The entities it holds are
 * kept as they are (the same objects) wherever they need nothing added, so a plan already in the
 * current format comes back with every entity it had.
 */
export function migratePlan(input: unknown): Migration {
  const parsed = planRecord.safeParse(input);
  if (!parsed.success) return refused(`Not a plan: ${describeIssues(parsed.error, { root: "plan" }).join("; ")}`);
  const raw = parsed.data;
  const from = raw.version ?? 1;
  if (from > PLAN_FORMAT_VERSION) {
    return refused(`The plan is in format ${from}, newer than this page reads (${PLAN_FORMAT_VERSION}). Nothing was loaded.`);
  }
  // a format writes one kind of room: a rectangle before format 3, an outline from it on
  const odd = raw.rooms.find((r) => "points" in r !== from >= 3);
  if (odd) {
    return refused(
      from >= 3
        ? `Room ${odd.id} is a rectangle (x, y, w, h), as plans before format 3 wrote rooms, in a plan in format ${from}, whose rooms are outlines (points). Nothing was loaded.`
        : `Room ${odd.id} is an outline (points), which only format 3 has, in a plan in format ${from}. Nothing was loaded.`,
    );
  }
  const bent = from < 3 ? raw.walls.find((w) => w.bulge !== undefined) : undefined;
  if (bent) return refused(`Wall ${bent.id} has a bulge, which only format 3 has, in a plan in format ${from}. Nothing was loaded.`);
  // the parsed copy is only the check: the plan is built from what was handed in
  const plan = input as PlanInput;
  if (from < 2) {
    const v2 = fromV1(plan as PlanModelV1);
    return v2.ok ? fromV2(v2.model, from) : v2;
  }
  return from < 3 ? fromV2(plan as PlanModelV2, from) : checkLevels(plan as PlanModelUnidentified, from);
}

/** Format 1 → 2: the one storey becomes the ground floor, and everything on it stands there. */
function fromV1(plan: PlanModelV1): { ok: true; model: PlanModelV2 } | { ok: false; summary: string } {
  if ((plan as { levels?: unknown }).levels !== undefined || (plan as { stairs?: unknown }).stairs !== undefined) {
    return refused("The plan says it is in format 1, which has no levels or stairs, yet it holds some. Nothing was loaded.");
  }
  const ground = groundLevel();
  const onGround = <T extends object>(e: T): T & { levelId: string } => ({ ...e, levelId: ground.id });
  return {
    ok: true,
    model: {
      ...plan,
      version: 2,
      id: plan.id ?? newPlanId(),
      levels: [ground],
      walls: plan.walls.map(onGround),
      rooms: plan.rooms.map(onGround),
      items: plan.items.map(onGround),
      stairs: [],
    },
  };
}

/**
 * Format 2 → 3: each room's rectangle becomes its outline, its four corners clockwise on the
 * sheet from the top-left one (shapes.ts, rectOutline); every wall was straight and stays so, no
 * bulge added. Then checked as a plan in the current format is.
 */
function fromV2(plan: PlanModelV2, from: number): Migration {
  const rooms: Room[] = plan.rooms.map(({ x, y, w, h, ...rest }) => ({ ...rest, points: rectOutline(x, y, w, h) }));
  return checkLevels({ ...plan, version: PLAN_FORMAT_VERSION, rooms }, from);
}

/** A plan in the current format, refused if it names a level it does not have. */
function checkLevels(plan: PlanModelUnidentified, from: number): Migration {
  const levels = plan.levels ?? [];
  if (levels.length === 0) return refused("The plan has no levels; every plan has at least one. Nothing was loaded.");
  const ids = new Set(levels.map((l) => l.id));
  if (ids.size !== levels.length) return refused("Two of the plan's levels share an id. Nothing was loaded.");
  const lost = [
    ...plan.walls.map((w) => [w.id, w.levelId] as const),
    ...plan.rooms.map((r) => [r.id, r.levelId] as const),
    ...plan.items.map((i) => [i.id, i.levelId] as const),
    ...(plan.stairs ?? []).map((s: Stair) => [s.id, s.levelId] as const),
  ].find(([, levelId]) => !levelId || !ids.has(levelId));
  if (lost) return refused(`${lost[0]} is on level ${JSON.stringify(lost[1] ?? null)}, which the plan does not have. Nothing was loaded.`);
  return { ok: true, from, model: { ...straightened(plan), version: PLAN_FORMAT_VERSION, id: plan.id ?? newPlanId(), stairs: plan.stairs ?? [] } };
}

/**
 * The plan with every bow under STRAIGHT_SAGITTA (limits.ts) stored straight, as the commands
 * store one: a wall or a room's edge bent so little reads as straight everywhere, so it carries no
 * bulge. Nothing else changes, and a plan with no such bow comes back as it was.
 */
function straightened(plan: PlanModelUnidentified): PlanModelUnidentified {
  const walls = plan.walls.map((w) => {
    if (w.bulge === undefined || edgeBulge({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, w.bulge) !== 0) return w;
    const rest: Wall = { ...w };
    delete rest.bulge;
    return rest;
  });
  const rooms = plan.rooms.map((r) => {
    const n = r.points.length;
    if (!r.points.some((p, i) => p.bulge !== undefined && edgeBulge(p, r.points[(i + 1) % n], p.bulge) === 0)) return r;
    return { ...r, points: r.points.map((p, i) => (p.bulge !== undefined && edgeBulge(p, r.points[(i + 1) % n], p.bulge) === 0 ? { x: p.x, y: p.y } : p)) };
  });
  return { ...plan, walls, rooms };
}
