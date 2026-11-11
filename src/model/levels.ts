/**
 * The plan's storeys, and what stands on each.
 *
 * A plan lists its levels from the ground up. Each one stores its floor-to-floor height; where
 * its floor stands follows from the ones below it (levelsOf), so moving or resizing a level can
 * never leave an elevation behind. Walls, rooms, items and stairs name their level; an opening
 * is on its wall's level. A stair stands on its level and arrives on the one above.
 *
 * Every function here is pure over the plan, and the ones a render may call on every frame
 * (levelsOf, levelSlice) keep their answer per plan object.
 */

import type { Item, Level, Opening, PlanModel, Room, Stair, Wall } from "./types";
import { LEVEL_NAMES, SLAB_THICKNESS, WALL_SLAB_TOLERANCE } from "./limits";
import { stairGeometry, type StairGeometry } from "./stairs";
import { roomArea } from "./shapes";

/** A level with where it sits in the stack. */
export interface LevelInfo {
  readonly level: Level;
  /** 0 for the ground level, counting up */
  readonly index: number;
  /** height of its floor above the ground level's floor, metres */
  readonly elevation: number;
  /** height of the next level's floor: elevation + floor-to-floor height */
  readonly top: number;
}

const infoCache = new WeakMap<readonly Level[], readonly LevelInfo[]>();

/** The plan's levels from the ground up, each with its elevation. */
export function levelsOf(model: Pick<PlanModel, "levels">): readonly LevelInfo[] {
  const cached = infoCache.get(model.levels);
  if (cached) return cached;
  let elevation = 0;
  const infos = model.levels.map((level, index): LevelInfo => {
    const info = Object.freeze({ level, index, elevation, top: elevation + level.height });
    elevation += level.height;
    return info;
  });
  const frozen = Object.freeze(infos);
  infoCache.set(model.levels, frozen);
  return frozen;
}

/** A level by its exact id, with where it sits; undefined when the plan has none by that id. */
export const levelInfo = (model: Pick<PlanModel, "levels">, id: string): LevelInfo | undefined =>
  levelsOf(model).find((l) => l.level.id === id);

/**
 * Height of level `levelId`'s floor above the ground level's floor, metres. An entity on no
 * level (or a level the plan no longer has) stands on the ground: 0.
 */
export const elevationOf = (model: Pick<PlanModel, "levels">, levelId: string | undefined): number =>
  (levelId === undefined ? undefined : levelInfo(model, levelId)?.elevation) ?? 0;

/** The level directly above `id`, if there is one: where a stair standing on `id` arrives. */
export function levelAbove(model: Pick<PlanModel, "levels">, id: string): LevelInfo | undefined {
  const info = levelInfo(model, id);
  return info ? levelsOf(model)[info.index + 1] : undefined;
}

/** The level directly below `id`, if there is one: the one the 2D view draws as a ghost. */
export function levelBelow(model: Pick<PlanModel, "levels">, id: string): LevelInfo | undefined {
  const info = levelInfo(model, id);
  return info && info.index > 0 ? levelsOf(model)[info.index - 1] : undefined;
}

/** Height of the underside of the slab over a level of floor-to-floor height `height`, from its floor. */
export const slabUnderside = (height: number): number => height - SLAB_THICKNESS;

/** Whether a wall `wallHeight` tall meets the slab over a level `levelHeight` floor to floor. */
export const meetsSlab = (wallHeight: number, levelHeight: number): boolean =>
  Math.abs(wallHeight - slabUnderside(levelHeight)) <= WALL_SLAB_TOLERANCE + 1e-9;

/** What a level at `index` (0 = ground) is called by its place: "First floor", or "Level N" past the named ones. */
export const defaultLevelName = (index: number): string => LEVEL_NAMES[index] ?? `Level ${index + 1}`;

/** How a level's name is compared: the way lookupLevel matches a `level` argument. */
const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * Whether `name` would make a level reference ambiguous: another level (any but `except`) is
 * already called that, or has it as its id. lookupLevel matches names and ids case-insensitively,
 * so this does too; with it refused, a level's name always names one level.
 */
export function levelNameTaken(model: Pick<PlanModel, "levels">, name: string, except?: string): boolean {
  const key = nameKey(name);
  return model.levels.some((l) => l.id !== except && (nameKey(l.name) === key || nameKey(l.id) === key));
}

/**
 * The name a new level on top gets when nobody names it: the name of its place ("Second
 * floor"), or, when a level is already called that (a level below was removed or renamed), the
 * next place's name nobody uses — so the default never repeats a name in the plan.
 */
export function freeLevelName(model: Pick<PlanModel, "levels">): string {
  for (let index = model.levels.length; ; index++) {
    const name = defaultLevelName(index);
    if (!levelNameTaken(model, name)) return name;
  }
}

/**
 * Why level `level` cannot be removed, or null when it can: a plan always keeps one level. The
 * one rule both the removal and the request that asks the human for it check, so a request that
 * could never run is refused before anybody is asked to approve it.
 */
export const levelRemovalError = (model: Pick<PlanModel, "levels">, level: Level): string | null =>
  model.levels.length > 1 ? null : `"${level.name}" is the plan's only level; a plan always has one. Use clear_model to start over.`;

/** A stair whose upper end changes when a level goes: it used to arrive on that level. */
export interface RerouteStair {
  readonly stair: Stair;
  /** the level it arrives on once the level is gone (the next one up), or undefined for none */
  readonly reaches: Level | undefined;
}

/**
 * The stairs that climb to level `levelId` from the level below, with where each arrives once
 * that level is removed: the next level up, whose floor then opens over it, or nowhere.
 */
export function stairsRerouted(model: PlanModel, levelId: string): RerouteStair[] {
  const info = levelInfo(model, levelId);
  if (!info) return [];
  const reaches = levelsOf(model)[info.index + 1]?.level;
  return stairwellsOf(model, levelId).map(({ stair }) => ({ stair, reaches }));
}

/**
 * What happens to a rerouted stair, said before the removal (`"ahead"`, for the request the
 * human approves) or after it (`"done"`): "Stair stair_1 from Ground floor will open into Attic".
 */
export function rerouteText(model: Pick<PlanModel, "levels">, r: RerouteStair, when: "ahead" | "done"): string {
  const from = levelInfo(model, r.stair.levelId)?.level.name ?? r.stair.levelId;
  const where = r.reaches
    ? `${when === "ahead" ? "will open" : "now opens"} into ${r.reaches.name}, which gets a stairwell in its floor`
    : `${when === "ahead" ? "will reach" : "now reaches"} no level`;
  return `Stair ${r.stair.id} from ${from} ${where}`;
}

/** The level an opening is on: its wall's. Undefined for an opening whose wall is gone. */
export const openingLevelId = (model: Pick<PlanModel, "walls">, opening: Opening): string | undefined =>
  model.walls.find((w) => w.id === opening.wallId)?.levelId;

/** The level any entity of the plan is on, by its id; undefined when no entity has that id. */
export function levelIdOf(model: PlanModel, id: string): string | undefined {
  for (const list of [model.walls, model.rooms, model.items, model.stairs] as const) {
    const found = (list as readonly { id: string; levelId: string }[]).find((e) => e.id === id);
    if (found) return found.levelId;
  }
  const opening = model.openings.find((o) => o.id === id);
  if (opening) return openingLevelId(model, opening);
  return model.levels.some((l) => l.id === id) ? id : undefined;
}

/** What stands on one level. */
export interface LevelContents {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  stairs: Stair[];
}

/**
 * Everything on level `levelId`: its walls and their openings, its rooms, items and stairs. An
 * opening whose wall is gone stands on no level; it is counted with the plan's first level, so
 * it is still seen (and reported) somewhere rather than nowhere.
 */
export function levelContents(model: PlanModel, levelId: string): LevelContents {
  const walls = model.walls.filter((w) => w.levelId === levelId);
  const wallIds = new Set(walls.map((w) => w.id));
  const first = model.levels[0]?.id === levelId;
  const allWalls = first ? new Set(model.walls.map((w) => w.id)) : null;
  return {
    walls,
    openings: model.openings.filter((o) => wallIds.has(o.wallId) || (allWalls !== null && !allWalls.has(o.wallId))),
    rooms: model.rooms.filter((r) => r.levelId === levelId),
    items: model.items.filter((i) => i.levelId === levelId),
    stairs: model.stairs.filter((s) => s.levelId === levelId),
  };
}

const sliceCache = new WeakMap<PlanModel, Map<string, PlanModel>>();

/**
 * The plan as one level sees it: the same plan with only that level's walls, openings, rooms,
 * items and stairs (the levels, the kinds and the underlay are the plan's). Kept per plan object
 * and level, so a view that reads it on every render gets the same object until the plan
 * changes — and a plan whose every entity is on that level is its own slice.
 */
export function levelSlice(model: PlanModel, levelId: string): PlanModel {
  let byLevel = sliceCache.get(model);
  const hit = byLevel?.get(levelId);
  if (hit) return hit;
  const contents = levelContents(model, levelId);
  const whole =
    contents.walls.length === model.walls.length &&
    contents.openings.length === model.openings.length &&
    contents.rooms.length === model.rooms.length &&
    contents.items.length === model.items.length &&
    contents.stairs.length === model.stairs.length;
  const slice = whole ? model : { ...model, ...contents };
  if (!byLevel) sliceCache.set(model, (byLevel = new Map()));
  byLevel.set(levelId, slice);
  return slice;
}

/** A stair's geometry as the plan has it: climbing its level's floor-to-floor height. */
export function stairGeometryIn(model: Pick<PlanModel, "levels">, stair: Stair): StairGeometry | null {
  const level = levelInfo(model, stair.levelId);
  return level ? stairGeometry(stair, level.level.height) : null;
}

/** A stairwell: a stair from the level below, and the opening it needs in this level's floor. */
export interface Stairwell {
  readonly stair: Stair;
  readonly geometry: StairGeometry;
}

/**
 * The stairwells in level `levelId`'s floor: one for every stair that climbs to it from the
 * level below. Its geometry's footprint is the void to leave in the slab.
 */
export function stairwellsOf(model: PlanModel, levelId: string): Stairwell[] {
  const below = levelBelow(model, levelId);
  if (!below) return [];
  return model.stairs
    .filter((s) => s.levelId === below.level.id)
    .map((stair) => ({ stair, geometry: stairGeometry(stair, below.level.height) }));
}

/** How much stands on a level, as the tools and the panels report it. */
export interface LevelStats {
  walls: number;
  doors: number;
  windows: number;
  rooms: number;
  items: number;
  stairs: number;
  /** floor area of its rooms, square metres */
  area: number;
}

export function levelStats(model: PlanModel, levelId: string): LevelStats {
  const c = levelContents(model, levelId);
  return {
    walls: c.walls.length,
    doors: c.openings.filter((o) => o.kind === "door").length,
    windows: c.openings.filter((o) => o.kind === "window").length,
    rooms: c.rooms.length,
    items: c.items.length,
    stairs: c.stairs.length,
    area: c.rooms.reduce((sum, r) => sum + roomArea(r), 0),
  };
}
