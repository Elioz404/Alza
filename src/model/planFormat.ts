/**
 * The plan as data: the format a plan is written in, and how a plan written in an older one
 * is brought up to date.
 *
 * Format 1 had one storey: walls, openings, rooms and items, with no levels. Format 2 (the
 * current one, PLAN_FORMAT_VERSION) has levels and stairs, and every wall, room and item names
 * the level it stands on. A format-1 plan loads as one level, the ground floor, holding all of
 * it. A plan from a format newer than this page knows is refused rather than half-read.
 *
 * The shape is checked before anything is migrated or loaded: types and references (every
 * level an entity names must exist), not the ranges the actions hold edits to. A plan that
 * breaks a range still loads, and the checker reports it, so a drawing is never lost because
 * one of its walls is too short.
 */

import { z } from "zod";
import { groundLevel, type Item, type PlanModel, type Room, type Stair, type Wall } from "./types";
import { describeIssues, floorFinish, hinge, itemCategory, partList, swingSide } from "./schemas";
import { KIND_SOURCES, OPENING_KINDS, PLAN_FORMAT_VERSION, STAIR_SHAPES, STAIR_TURNS } from "./limits";

/** A plan in format 1: one storey, no levels or stairs, entities without a level. */
export interface PlanModelV1 extends Omit<PlanModel, "version" | "levels" | "stairs" | "walls" | "rooms" | "items"> {
  version?: 1;
  walls: Omit<Wall, "levelId">[];
  rooms: Omit<Room, "levelId">[];
  items: Omit<Item, "levelId">[];
}

/** Any plan a page can be handed: the current format or an older one. */
export type PlanInput = PlanModel | PlanModelV1;

// ---------------------------------------------------------------------------- the shape

const num = z.number();
const id = z.string().min(1);

const wallRecord = z.object({ id, ax: num, ay: num, bx: num, by: num, thickness: num, height: num, levelId: id.optional() });
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
const roomRecord = z.object({ id, x: num, y: num, w: num, h: num, label: z.string(), floor: floorFinish, levelId: id.optional() });
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

/** What any plan, of any format this page reads, must look like. */
const planRecord = z.object({
  version: z.number().int().min(1).optional(),
  name: z.string(),
  levels: z.array(levelRecord).optional(),
  walls: z.array(wallRecord),
  openings: z.array(openingRecord),
  rooms: z.array(roomRecord),
  items: z.array(itemRecord),
  stairs: z.array(stairRecord).optional(),
  kinds: z.array(kindRecord),
  underlay: underlayRecord.nullable(),
});

// ---------------------------------------------------------------------------- migration

export type Migration = { ok: true; model: PlanModel; from: number } | { ok: false; summary: string };

const refused = (summary: string): Migration => ({ ok: false, summary });

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
  // the parsed copy is only the check: the plan is built from what was handed in
  const plan = input as PlanInput;
  return from < 2 ? fromV1(plan as PlanModelV1) : checkLevels(plan as PlanModel, from);
}

/** Format 1 → 2: the one storey becomes the ground floor, and everything on it stands there. */
function fromV1(plan: PlanModelV1): Migration {
  if ((plan as { levels?: unknown }).levels !== undefined || (plan as { stairs?: unknown }).stairs !== undefined) {
    return refused("The plan says it is in format 1, which has no levels or stairs, yet it holds some. Nothing was loaded.");
  }
  const ground = groundLevel();
  const onGround = <T extends object>(e: T): T & { levelId: string } => ({ ...e, levelId: ground.id });
  return {
    ok: true,
    from: 1,
    model: {
      ...plan,
      version: PLAN_FORMAT_VERSION,
      levels: [ground],
      walls: plan.walls.map(onGround),
      rooms: plan.rooms.map(onGround),
      items: plan.items.map(onGround),
      stairs: [],
    },
  };
}

/** A plan in the current format, refused if it names a level it does not have. */
function checkLevels(plan: PlanModel, from: number): Migration {
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
  return { ok: true, from, model: { ...plan, stairs: plan.stairs ?? [] } };
}
