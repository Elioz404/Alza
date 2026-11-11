/**
 * Levels and stairs in the model: the plan format and its migration, the level commands and
 * the stair commands (each one undo step, attributed, in the revisions), the level being worked
 * on (a view setting), the stair geometry every view reads, the checker's stair rules, and the
 * tools an agent reaches them through.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, activeLevelId, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { runTool } from "../src/mcp/tools";
import { migratePlan, type PlanModelV1 } from "../src/model/planFormat";
import { elevationOf, freeLevelName, levelAbove, levelBelow, levelIdOf, levelSlice, levelsOf, levelStats, stairGeometryIn, stairwellsOf } from "../src/model/levels";
import { stairGeometry, stairHeightAt } from "../src/model/stairs";
import { stairGuard } from "../src/model/stairGuard";
import { checkModel, issuesOf, issuesOnLevel } from "../src/model/issues";
import { provenance } from "../src/model/provenance";
import { FIRST_LEVEL_ID, seedLoft, seedTownhouse } from "../src/model/seed";
import { emptyModel, type PlanModel, type Stair } from "../src/model/types";
import { GROUND_LEVEL_ID, LEVEL_DEFAULTS, LEVEL_HEIGHT, LEVEL_NAMES, PLAN_FORMAT_VERSION, SLAB_THICKNESS, STAIR, WALL_DEFAULTS, WALL_SLAB_TOLERANCE } from "../src/model/limits";
import { flush, resetStore } from "./support/store";
import { outlineBounds, rectOutline } from "../src/model/shapes";

beforeEach(resetStore);

const state = () => store.getState();
const model = () => state().model;
const human = { actor: "human" } as const;
const agent = { actor: "agent" } as const;
const codes = (m: PlanModel) => checkModel(m).map((i) => i.code);

/** The demo loft as a format-1 plan: what a plan saved before levels existed looks like. */
function loftV1(): PlanModelV1 {
  const m = seedLoft();
  return {
    name: m.name,
    walls: m.walls.map((w) => withoutLevel(w)),
    openings: m.openings,
    // a format-1 room is a rectangle: the loft's rooms are, so their bounds are exactly them
    rooms: m.rooms.map(({ points, ...r }) => withoutLevel({ ...r, ...outlineBounds(points) })),
    items: m.items.map((i) => withoutLevel(i)),
    kinds: m.kinds,
    underlay: m.underlay,
  };
}

/** An entity as format 1 wrote it: without the level it stands on. */
function withoutLevel<T extends { levelId: string }>(e: T): Omit<T, "levelId"> {
  const copy: Partial<T> = { ...e };
  delete copy.levelId;
  return copy as Omit<T, "levelId">;
}

const townhouse = () => {
  dispatch({ type: "load_model", model: seedTownhouse() }, { actor: "system", undoable: false });
};

const stairOf = (m: PlanModel, id = "stair_main"): Stair => m.stairs.find((s) => s.id === id)!;

// ---------------------------------------------------------------------------- the format

describe("plan format", () => {
  it("a fresh plan is in the current format, with one ground level", () => {
    const m = emptyModel();
    expect(m.version).toBe(PLAN_FORMAT_VERSION);
    expect(m.levels).toEqual([{ id: GROUND_LEVEL_ID, name: LEVEL_NAMES[0], height: LEVEL_DEFAULTS.height }]);
    expect(m.stairs).toEqual([]);
    // a default wall fits under the slab of a default level
    expect(LEVEL_DEFAULTS.height).toBeCloseTo(WALL_DEFAULTS.height + SLAB_THICKNESS);
  });

  it("migrates a single-storey plan into one ground floor holding all of it", () => {
    const old = loftV1();
    const r = migratePlan(old);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    expect(r.model.version).toBe(PLAN_FORMAT_VERSION);
    expect(r.model.levels).toHaveLength(1);
    expect(r.model.levels[0]).toMatchObject({ id: GROUND_LEVEL_ID, name: "Ground floor" });
    expect(r.model.stairs).toEqual([]);
    for (const e of [...r.model.walls, ...r.model.rooms, ...r.model.items]) expect(e.levelId).toBe(GROUND_LEVEL_ID);
    // nothing else about the plan changes: it is the loft, on one level
    expect(r.model.walls.map((w) => withoutLevel(w))).toEqual(old.walls);
    expect(r.model.openings).toBe(old.openings);
    expect(checkModel(r.model)).toEqual([]);
  });

  it("an old plan loads through load_model, saved as JSON, and says it was migrated", () => {
    const saved = JSON.stringify(loftV1());
    const r = dispatch({ type: "load_model", model: JSON.parse(saved) as PlanModelV1 }, human);
    expect(r).toMatchObject({ ok: true, migratedFrom: 1 });
    expect(model().levels.map((l) => l.id)).toEqual([GROUND_LEVEL_ID]);
    expect(model().walls.every((w) => w.levelId === GROUND_LEVEL_ID)).toBe(true);
    expect(model().version).toBe(PLAN_FORMAT_VERSION);
  });

  it("a plan in the current format round-trips through JSON, every level and stair intact", () => {
    const plan = seedTownhouse();
    const r = dispatch({ type: "load_model", model: JSON.parse(JSON.stringify(plan)) as PlanModel }, human);
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("migratedFrom");
    expect(JSON.parse(JSON.stringify(model()))).toEqual(JSON.parse(JSON.stringify(plan)));
  });

  it("keeps the entities of a current plan as the very objects it was handed", () => {
    const plan = seedTownhouse();
    const r = migratePlan(plan);
    expect(r.ok && r.model.walls[0]).toBe(plan.walls[0]);
    expect(r.ok && r.model.stairs[0]).toBe(plan.stairs[0]);
  });

  it("refuses a plan from a newer format, a plan that names a level it lacks, and a plan with none", () => {
    expect(migratePlan({ ...seedTownhouse(), version: PLAN_FORMAT_VERSION + 1 })).toMatchObject({ ok: false });
    const lost = seedTownhouse();
    lost.items[0] = { ...lost.items[0], levelId: "level_nowhere" };
    const r = migratePlan(lost);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.summary).toContain(lost.items[0].id);
    expect(migratePlan({ ...seedTownhouse(), levels: [] }).ok).toBe(false);
    const dup = seedTownhouse();
    expect(migratePlan({ ...dup, levels: [dup.levels[0], { ...dup.levels[1], id: dup.levels[0].id }] }).ok).toBe(false);
  });

  it("refuses what is not a plan, or a format-1 plan that holds levels, and loads nothing", () => {
    const before = model();
    for (const bad of [null, 42, { name: "x" }, { ...loftV1(), walls: [{ id: "w" }] }, { ...loftV1(), levels: [] }]) {
      const r = dispatch({ type: "load_model", model: bad as unknown as PlanModel }, human);
      expect(r.ok).toBe(false);
    }
    expect(model()).toBe(before);
    expect(state().undoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------- levels

describe("levels", () => {
  it("stack from the ground up: each floor at the sum of the heights below it", () => {
    const m = seedTownhouse();
    const [g, f] = levelsOf(m);
    expect(g).toMatchObject({ index: 0, elevation: 0, top: LEVEL_DEFAULTS.height });
    expect(f).toMatchObject({ index: 1, elevation: LEVEL_DEFAULTS.height });
    expect(levelAbove(m, GROUND_LEVEL_ID)?.level.id).toBe(FIRST_LEVEL_ID);
    expect(levelBelow(m, FIRST_LEVEL_ID)?.level.id).toBe(GROUND_LEVEL_ID);
    expect(levelAbove(m, FIRST_LEVEL_ID)).toBeUndefined();
    expect(levelsOf(m)).toBe(levelsOf(m));
  });

  it("a level's slice holds only what stands on it, and a one-storey plan is its own slice", () => {
    const m = seedTownhouse();
    const up = levelSlice(m, FIRST_LEVEL_ID);
    expect(up.walls.every((w) => w.levelId === FIRST_LEVEL_ID)).toBe(true);
    expect(up.openings.map((o) => o.id).sort()).toEqual(["f_door_bed", "f_win_bed"]);
    expect(up.stairs).toEqual([]);
    expect(levelSlice(m, FIRST_LEVEL_ID)).toBe(up);
    expect(levelSlice(m, GROUND_LEVEL_ID).stairs.map((s) => s.id)).toEqual(["stair_main"]);
    const loft = seedLoft();
    expect(levelSlice(loft, GROUND_LEVEL_ID)).toBe(loft);
    expect(levelIdOf(m, "f_door_bed")).toBe(FIRST_LEVEL_ID);
    expect(levelStats(m, FIRST_LEVEL_ID)).toMatchObject({ walls: 5, doors: 1, windows: 1, rooms: 2, items: 1, stairs: 0 });
  });

  it("add_level puts an empty, named level on top as one undo step", () => {
    const r = dispatch({ type: "add_level" }, agent);
    expect(r.ok).toBe(true);
    expect(model().levels.map((l) => l.name)).toEqual(["Ground floor", "First floor"]);
    expect(model().levels[1]).toMatchObject({ id: r.id, height: LEVEL_DEFAULTS.height });
    expect(state().undoStack).toHaveLength(1);
    expect(state().activity.at(-1)).toMatchObject({ source: "agent", tool: "add_level", ok: true });
    dispatch({ type: "undo" }, human);
    expect(model().levels).toHaveLength(1);
  });

  it("add_level checks its height and the most levels a plan holds", () => {
    expect(dispatch({ type: "add_level", height: LEVEL_HEIGHT.min - 0.1 }, human).ok).toBe(false);
    expect(dispatch({ type: "add_level", name: "" }, human).ok).toBe(false);
    for (let i = 1; i < LEVEL_NAMES.length; i++) expect(dispatch({ type: "add_level" }, human).ok).toBe(true);
    expect(dispatch({ type: "add_level" }, human).ok).toBe(false);
  });

  it("update_level renames, changes the height (the levels above move) and reorders", () => {
    townhouse();
    const r = dispatch({ type: "update_level", id: "Ground floor", patch: { name: "Street level", height: 3.2 } }, human);
    expect(r.ok).toBe(true);
    expect(model().levels[0]).toMatchObject({ id: GROUND_LEVEL_ID, name: "Street level", height: 3.2 });
    expect(levelsOf(model())[1].elevation).toBeCloseTo(3.2);
    // the stair re-derives its risers from the new height
    expect(stairGeometryIn(model(), stairOf(model()))!.rise).toBe(3.2);
    expect(dispatch({ type: "update_level", id: FIRST_LEVEL_ID, patch: { order: 0 } }, human).ok).toBe(true);
    expect(model().levels.map((l) => l.id)).toEqual([FIRST_LEVEL_ID, GROUND_LEVEL_ID]);
    dispatch({ type: "undo" }, human);
    dispatch({ type: "undo" }, human);
    expect(model().levels).toEqual(seedTownhouse().levels);
  });

  it("remove_level takes everything on it, refuses the last level, and one undo brings it all back", () => {
    townhouse();
    const before = model();
    const r = dispatch({ type: "remove_level", id: GROUND_LEVEL_ID }, human);
    expect(r.ok).toBe(true);
    expect(model().levels.map((l) => l.id)).toEqual([FIRST_LEVEL_ID]);
    expect(model().walls.every((w) => w.levelId === FIRST_LEVEL_ID)).toBe(true);
    expect(model().openings.map((o) => o.id).sort()).toEqual(["f_door_bed", "f_win_bed"]);
    expect(model().stairs).toEqual([]);
    expect(model().items.map((i) => i.id)).toEqual(["f_item_bed"]);
    expect(dispatch({ type: "remove_level", id: FIRST_LEVEL_ID }, human).ok).toBe(false);
    dispatch({ type: "undo" }, human);
    expect(model()).toBe(before);
  });

  it("revisions name the levels and stairs a change touched", () => {
    townhouse();
    const r = dispatch({ type: "add_stair", spec: { x: 6, y: 3, rotation: 90, level: GROUND_LEVEL_ID } }, agent);
    expect(provenance.getState().revisions.at(-1)).toMatchObject({ source: "agent", touched: [r.id] });
    dispatch({ type: "update_level", id: FIRST_LEVEL_ID, patch: { name: "Loft" } }, agent);
    expect(provenance.getState().revisions.at(-1)).toMatchObject({ touched: [FIRST_LEVEL_ID] });
    dispatch({ type: "remove_stair", id: String(r.id) }, human);
    expect(provenance.getState().revisions.at(-1)).toMatchObject({ source: "human", removed: [r.id] });
  });
});

// ---------------------------------------------------------------------------- the active level

describe("the level being worked on", () => {
  it("is where new things go when no level is named, and is not an undo step", () => {
    townhouse();
    expect(activeLevelId(state())).toBe(GROUND_LEVEL_ID);
    expect(pageActions.setActiveLevel("First floor").ok).toBe(true);
    expect(activeLevelId(state())).toBe(FIRST_LEVEL_ID);
    expect(state().undoStack).toHaveLength(0);
    const wall = dispatch({ type: "add_wall", ax: 3, ay: 2, bx: 5, by: 2 }, human);
    expect(model().walls.find((w) => w.id === wall.id)?.levelId).toBe(FIRST_LEVEL_ID);
    const room = dispatch({ type: "add_room", x: 3, y: 3, w: 2, h: 2, label: "Study" }, human);
    expect(model().rooms.find((x) => x.id === room.id)?.levelId).toBe(FIRST_LEVEL_ID);
    const item = dispatch({ type: "place_item", kind: "plant", x: 4, y: 4 }, human);
    expect(model().items.find((x) => x.id === item.id)?.levelId).toBe(FIRST_LEVEL_ID);
    // a named level wins
    const down = dispatch({ type: "place_item", kind: "plant", x: 4, y: 4, level: "Ground floor" }, human);
    expect(model().items.find((x) => x.id === down.id)?.levelId).toBe(GROUND_LEVEL_ID);
    expect(dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 1, by: 0, level: "Attic" }, human).ok).toBe(false);
  });

  it("steps up and down the stack, and lets go of a selection on another level", () => {
    townhouse();
    pageActions.selectItem("g_item_sofa");
    expect(pageActions.stepActiveLevel(-1).ok).toBe(false);
    expect(pageActions.stepActiveLevel(1).ok).toBe(true);
    expect(activeLevelId(state())).toBe(FIRST_LEVEL_ID);
    expect(state().editor.selectedItemId).toBeNull();
    pageActions.selectItem("f_item_bed");
    pageActions.setActiveLevel(FIRST_LEVEL_ID);
    expect(state().editor.selectedItemId).toBe("f_item_bed");
    expect(pageActions.stepActiveLevel(1).ok).toBe(false);
  });

  it("falls back to the ground level when its level goes, and comes back with an undo", () => {
    townhouse();
    pageActions.setActiveLevel(FIRST_LEVEL_ID);
    dispatch({ type: "remove_level", id: FIRST_LEVEL_ID }, human);
    expect(activeLevelId(state())).toBe(GROUND_LEVEL_ID);
    dispatch({ type: "undo" }, human);
    expect(activeLevelId(state())).toBe(FIRST_LEVEL_ID);
  });

  it("selecting a stair lets go of everything else", () => {
    pageActions.selectWall("w");
    pageActions.selectStair("s");
    expect(state().editor).toMatchObject({ selectedStairId: "s", selectedWallId: null, selectedItemId: null, selectedRoomId: null });
    pageActions.selectRoom("r");
    expect(state().editor.selectedStairId).toBeNull();
  });

  it("the edit commands carry a wall with its openings, a room, a piece and a stair to another level", () => {
    townhouse();
    expect(dispatch({ type: "edit_wall", id: "g_wall_s", patch: { levelId: FIRST_LEVEL_ID } }, human).ok).toBe(true);
    expect(levelIdOf(model(), "g_wall_s")).toBe(FIRST_LEVEL_ID);
    expect(levelIdOf(model(), "g_door_main")).toBe(FIRST_LEVEL_ID);
    expect(dispatch({ type: "update_room", id: "g_room_living", patch: { levelId: "First floor" } }, human).ok).toBe(true);
    expect(dispatch({ type: "move_item", id: "g_item_table", level: "First floor" }, human).ok).toBe(true);
    expect(dispatch({ type: "update_stair", id: "stair_main", patch: { levelId: "First floor" } }, human).ok).toBe(true);
    for (const id of ["g_room_living", "g_item_table", "stair_main"]) expect(levelIdOf(model(), id), id).toBe(FIRST_LEVEL_ID);
    // where it stands on the plan does not change
    expect(model().items.find((i) => i.id === "g_item_table")).toMatchObject({ x: 4.5, y: 2.5 });
    expect(dispatch({ type: "move_item", id: "g_item_table", level: "nowhere" }, human).ok).toBe(false);
    expect(state().undoStack).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------- stair geometry

describe("stair geometry", () => {
  const straight: Stair = { id: "s", levelId: GROUND_LEVEL_ID, shape: "straight", x: 0, y: 0, rotation: 0, width: 1 };

  it("derives the fewest risers under the maximum, and the going from the step rule", () => {
    const g = stairGeometry(straight, 2.9);
    expect(g.risers).toBe(Math.ceil(2.9 / STAIR.riser.max));
    expect(g.riserHeight).toBeLessThanOrEqual(STAIR.riser.max);
    expect(g.riserHeight * g.risers).toBeCloseTo(2.9);
    expect(g.going).toBeCloseTo(STAIR.stepRule.target - 2 * g.riserHeight);
    expect(g.stepRule).toBeCloseTo(STAIR.stepRule.target);
    expect(g.headroom).toBeCloseTo(2.9 - SLAB_THICKNESS - g.riserHeight);
    expect(stairGeometry(straight, 2.9)).toBe(g);
  });

  it("lays a straight flight along its rotation: one tread fewer than risers, the top at the floor above", () => {
    const g = stairGeometry(straight, 2.9);
    expect(g.steps).toHaveLength(g.risers - 1);
    expect(g.steps.at(-1)!.top).toBeCloseTo(2.9 - g.riserHeight);
    // rotation 0 climbs toward +y
    expect(g.end.x).toBeCloseTo(0);
    expect(g.end.y).toBeCloseTo((g.risers - 1) * g.going);
    expect(g.flights).toHaveLength(1);
    expect(g.landing).toBeNull();
    expect(g.walkLine).toEqual([g.start, g.end]);
    // rotation 90 climbs toward +x
    const east = stairGeometry({ ...straight, rotation: 90 }, 2.9);
    expect(east.end.x).toBeCloseTo((g.risers - 1) * g.going);
    expect(east.end.y).toBeCloseTo(0);
  });

  it("an L-shaped stair climbs to a square landing and turns the way it is told", () => {
    const l: Stair = { ...straight, shape: "l", turn: "left", split: 8 };
    const g = stairGeometry(l, 2.9);
    expect(g.landing!.top).toBeCloseTo(8 * g.riserHeight);
    expect(g.steps.filter((s) => s.flight === 0)).toHaveLength(7);
    expect(g.steps.filter((s) => s.flight === 1)).toHaveLength(g.risers - 8 - 1);
    expect(g.footprint).toHaveLength(3);
    // climbing +y, a left turn heads +x; a right turn heads -x
    expect(g.endDir.x).toBeCloseTo(1);
    expect(stairGeometry({ ...l, turn: "right" }, 2.9).endDir.x).toBeCloseTo(-1);
    expect(g.walkLine).toHaveLength(3);
  });

  it("answers the height of the step under a point, and null off the stair", () => {
    const g = stairGeometry(straight, 2.9);
    expect(stairHeightAt(g, { x: 0, y: g.going * 0.5 })).toBeCloseTo(g.riserHeight);
    expect(stairHeightAt(g, { x: 0, y: g.going * 3.5 })).toBeCloseTo(4 * g.riserHeight);
    expect(stairHeightAt(g, { x: 5, y: 5 })).toBeNull();
    const l = stairGeometry({ ...straight, shape: "l", split: 8 }, 2.9);
    expect(stairHeightAt(l, { x: l.landing!.rect.cx, y: l.landing!.rect.cy })).toBeCloseTo(l.landing!.top);
  });

  it("the stairwell of a level is the footprint of the stair that climbs to it", () => {
    const m = seedTownhouse();
    const wells = stairwellsOf(m, FIRST_LEVEL_ID);
    expect(wells.map((w) => w.stair.id)).toEqual(["stair_main"]);
    expect(wells[0].geometry.footprint).toEqual(stairGeometryIn(m, stairOf(m))!.footprint);
    expect(stairwellsOf(m, GROUND_LEVEL_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------- stair commands

describe("stair commands", () => {
  it("add_stair stands it on the active level and reports what it works out to", () => {
    townhouse();
    const r = dispatch({ type: "add_stair", spec: { x: 6, y: 1, rotation: 0 } }, agent);
    expect(r).toMatchObject({ ok: true, levelId: GROUND_LEVEL_ID, risers: 16 });
    expect(stairOf(model(), String(r.id))).toMatchObject({ shape: "straight", width: STAIR.defaultWidth, rotation: 0 });
    expect(state().activity.at(-1)).toMatchObject({ source: "agent", tool: "add_stair" });
    dispatch({ type: "undo" }, human);
    expect(model().stairs.map((s) => s.id)).toEqual(["stair_main"]);
  });

  it("add_stair checks every number it is given", () => {
    for (const spec of [
      { x: NaN, y: 0 },
      { x: 0, y: 0, width: 0.1 },
      { x: 0, y: 0, risers: 3.5 },
      { x: 0, y: 0, tread: 2 },
      { x: 0, y: 0, shape: "spiral" as "l" },
      { x: 0, y: 0, level: "Attic" },
    ]) {
      expect(dispatch({ type: "add_stair", spec }, human).ok, JSON.stringify(spec)).toBe(false);
    }
    expect(model().stairs).toEqual([]);
  });

  it("update_stair reshapes; a straight stair keeps no turn; move_stair is the drag's command", () => {
    townhouse();
    expect(dispatch({ type: "update_stair", id: "stair_main", patch: { shape: "l", split: 6 } }, human).ok).toBe(true);
    expect(stairOf(model())).toMatchObject({ shape: "l", turn: "left", split: 6 });
    expect(dispatch({ type: "update_stair", id: "stair_main", patch: { shape: "straight" } }, human).ok).toBe(true);
    expect(stairOf(model())).not.toHaveProperty("turn");
    expect(stairOf(model())).not.toHaveProperty("split");
    expect(dispatch({ type: "move_stair", id: "stair_main", x: 1.02, y: 4.9, rotation: 90 }, human).ok).toBe(true);
    expect(stairOf(model())).toMatchObject({ x: 1, y: 4.9, rotation: 90, width: 0.9 });
    expect(dispatch({ type: "update_stair", id: "nope", patch: { x: 1 } }, human).ok).toBe(false);
    expect(state().undoStack).toHaveLength(3);
  });

  it("remove_stair removes it and closes its stairwell", () => {
    townhouse();
    expect(dispatch({ type: "remove_stair", id: "stair_main" }, human).ok).toBe(true);
    expect(stairwellsOf(model(), FIRST_LEVEL_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------- stair issues

describe("stair issues", () => {
  const withStair = (patch: Partial<Stair>, m = seedTownhouse()): PlanModel => ({
    ...m,
    stairs: m.stairs.map((s) => ({ ...s, ...patch })),
  });

  it("the townhouse is clean, level by level", () => {
    const m = seedTownhouse();
    expect(checkModel(m)).toEqual([]);
    expect(issuesOnLevel(m, FIRST_LEVEL_ID)).toEqual([]);
  });

  it("walls on different levels are never checked against each other", () => {
    const m = seedTownhouse();
    // the partition upstairs stands over the open living room downstairs, and that is fine
    expect(codes(m)).not.toContain("walls_cross");
    const flat = { ...m, walls: m.walls.map((w) => ({ ...w, levelId: GROUND_LEVEL_ID })) };
    expect(codes(flat)).toContain("walls_overlap_collinear");
  });

  it("a stair on the top level reaches nothing", () => {
    expect(codes(withStair({ levelId: FIRST_LEVEL_ID }))).toContain("stair_no_upper_level");
  });

  it("risers and goings outside their ranges, and an uncomfortable step", () => {
    expect(codes(withStair({ risers: 10 }))).toContain("stair_riser_out_of_range");
    const deep = codes(withStair({ tread: 0.4 }));
    expect(deep).toContain("stair_tread_out_of_range");
    expect(deep).toContain("stair_step_rule");
  });

  it("too little headroom under the slab above", () => {
    const m = seedTownhouse();
    const low = { ...m, levels: [{ ...m.levels[0], height: LEVEL_HEIGHT.min }, m.levels[1]] };
    expect(codes(low)).toContain("stair_headroom");
  });

  it("a wall in the stair, over the stairwell, or across a landing", () => {
    const m = seedTownhouse();
    const across = (levelId: string, y: number) => ({ id: `cut_${levelId}_${y}`, levelId, ax: 0, ay: y, bx: 2.5, by: y, thickness: 0.1, height: 2.7 });
    expect(codes({ ...m, walls: [...m.walls, across(GROUND_LEVEL_ID, 3)] })).toContain("stair_crosses_wall");
    const above = checkModel({ ...m, walls: [...m.walls, across(FIRST_LEVEL_ID, 3)] });
    expect(above.map((i) => i.code)).toContain("stairwell_blocked");
    // the foot: the floor in front of the bottom riser, on the stair's level
    expect(codes({ ...m, walls: [...m.walls, across(GROUND_LEVEL_ID, 5.4)] })).toContain("stair_landing_blocked");
    // the head: past the top riser, on the level it arrives on
    const head = stairGeometryIn(m, stairOf(m))!.topExit.cy;
    const headPlan = { ...m, walls: [...m.walls, across(FIRST_LEVEL_ID, head)] };
    expect(issuesOnLevel(headPlan, FIRST_LEVEL_ID).map((i) => i.code)).toContain("stair_landing_blocked");
  });

  it("a stairwell that opens outside every room above", () => {
    const m = seedTownhouse();
    const moved = { ...m, rooms: m.rooms.map((r) => (r.id === "f_room_hall" ? { ...r, points: rectOutline(1.2, 0.075, 1.25, 5.85) } : r)) };
    expect(codes(moved)).toContain("stairwell_outside_room");
  });

  it("furniture on a stair, or over a stairwell, is reported on its own level", () => {
    const m = seedTownhouse();
    const on = { ...m, items: [...m.items, { id: "box", levelId: GROUND_LEVEL_ID, kind: "plant", x: 0.55, y: 3, rotation: 0 }] };
    expect(issuesOnLevel(on, GROUND_LEVEL_ID).map((i) => i.code)).toContain("item_on_stair");
    const over = { ...m, items: [...m.items, { id: "box", levelId: FIRST_LEVEL_ID, kind: "plant", x: 0.55, y: 3, rotation: 0 }] };
    const up = issuesOnLevel(over, FIRST_LEVEL_ID).map((i) => i.code);
    expect(up).toContain("item_over_stairwell");
    expect(issuesOnLevel(over, GROUND_LEVEL_ID)).toEqual([]);
  });

  it("two stairs on one level on top of each other", () => {
    const m = seedTownhouse();
    const twin = { ...m.stairs[0], id: "stair_twin", x: 0.7 };
    expect(codes({ ...m, stairs: [...m.stairs, twin] })).toContain("stairs_overlap");
  });

  it("issuesOf is every level's issues, ground up, the same list each time it is asked", () => {
    const m = withStair({ risers: 10 });
    expect(issuesOf(m)).toEqual([...issuesOnLevel(m, GROUND_LEVEL_ID), ...issuesOnLevel(m, FIRST_LEVEL_ID)]);
    expect(issuesOnLevel(m, GROUND_LEVEL_ID)).toBe(issuesOnLevel(m, GROUND_LEVEL_ID));
    expect(Object.isFrozen(issuesOnLevel(m, GROUND_LEVEL_ID))).toBe(true);
  });
});

// ---------------------------------------------------------------------------- tools

describe("level and stair tools", () => {
  it("list_levels reports every level and stair with what it works out to", async () => {
    townhouse();
    const r = await runTool("list_levels", {}, "agent");
    expect(r.ok).toBe(true);
    expect(r.levels).toEqual([
      expect.objectContaining({ id: GROUND_LEVEL_ID, order: 0, elevation: 0, active: true, walls: 4, stairs: 1 }),
      expect.objectContaining({ id: FIRST_LEVEL_ID, order: 1, elevation: LEVEL_DEFAULTS.height, active: false, rooms: 2 }),
    ]);
    expect(r.stairs).toEqual([expect.objectContaining({ id: "stair_main", reaches: FIRST_LEVEL_ID, risers: 16 })]);
  });

  it("an agent builds a second storey with a stair through the same pipeline", async () => {
    townhouse();
    const level = await runTool("add_level", { name: "Attic", height: 2.5 }, "agent");
    expect(level.ok).toBe(true);
    const wall = await runTool("add_wall", { ax: 0, ay: 0, bx: 4, by: 0, level: "Attic" }, "agent");
    expect(model().walls.find((w) => w.id === wall.id)?.levelId).toBe(level.id);
    const stair = await runTool("add_stair", { x: 7, y: 1, rotation: 0, shape: "l", turn: "right", level: "First floor" }, "agent");
    expect(stair).toMatchObject({ ok: true, levelId: FIRST_LEVEL_ID });
    expect((await runTool("set_active_level", { id: "Attic" }, "agent")).ok).toBe(true);
    expect(activeLevelId(state())).toBe(level.id);
    const placed = await runTool("place_item", { kind: "plant", x: 1, y: 1 }, "agent");
    expect(model().items.find((i) => i.id === placed.id)?.levelId).toBe(level.id);
    const ed = await runTool("get_editor_state", {}, "agent");
    expect((ed.editor as { activeLevelId: string }).activeLevelId).toBe(level.id);
  });

  it("get_model and get_issues read one level when asked", async () => {
    townhouse();
    const whole = await runTool("get_model", {}, "agent");
    expect((whole.model as PlanModel).walls).toHaveLength(9);
    expect(whole.summary).toContain("2 levels");
    const up = await runTool("get_model", { level: "First floor" }, "agent");
    expect((up.model as PlanModel).walls).toHaveLength(5);
    expect(await runTool("get_model", { level: "Attic" }, "agent")).toMatchObject({ ok: false });
    store.setState((s) => ({ model: { ...s.model, items: [...s.model.items, { id: "box", levelId: FIRST_LEVEL_ID, kind: "plant", x: 0.55, y: 3, rotation: 0 }] } }));
    const issues = await runTool("get_issues", { level: FIRST_LEVEL_ID }, "agent");
    expect((issues.issues as { code: string }[]).map((i) => i.code)).toContain("item_over_stairwell");
    expect((await runTool("get_issues", { level: GROUND_LEVEL_ID }, "agent")).issues).toEqual([]);
  });

  it("move tools take a level to move to", async () => {
    townhouse();
    expect((await runTool("move_item", { id: "g_item_table", level: "First floor" }, "agent")).ok).toBe(true);
    expect(levelIdOf(model(), "g_item_table")).toBe(FIRST_LEVEL_ID);
    expect((await runTool("update_room", { id: "Living", level: "First floor" }, "agent")).ok).toBe(true);
    expect(levelIdOf(model(), "g_room_living")).toBe(FIRST_LEVEL_ID);
    expect((await runTool("edit_wall", { id: "g_wall_n", level: "First floor" }, "agent")).ok).toBe(true);
    expect(levelIdOf(model(), "g_win_n")).toBe(FIRST_LEVEL_ID);
    expect((await runTool("update_stair", { id: "stair_main", width: 1.1 }, "agent")).ok).toBe(true);
    expect(stairOf(model()).width).toBe(1.1);
  });

  it("refuses a fractional riser count and an unknown shape before anything runs", async () => {
    const before = model();
    expect((await runTool("add_stair", { x: 0, y: 0, risers: 15.5 }, "agent")).ok).toBe(false);
    expect((await runTool("add_stair", { x: 0, y: 0, shape: "spiral" }, "agent")).ok).toBe(false);
    expect((await runTool("update_level", { id: GROUND_LEVEL_ID, order: 0.5 }, "agent")).ok).toBe(false);
    expect(model()).toBe(before);
  });

  it("remove_level and remove_stair ask the human about the real level and stair", async () => {
    townhouse();
    const call = runTool("remove_level", { id: "First floor" }, "agent");
    await flush();
    const asked = state().approvals[0];
    expect(asked.targets).toEqual([{ type: "level", id: FIRST_LEVEL_ID, label: "First floor" }]);
    expect(asked.effects[0]).toContain("5 walls");
    actions.resolveApproval(asked.id, true);
    expect((await call).ok).toBe(true);
    expect(model().levels).toHaveLength(1);

    townhouse();
    const stair = runTool("remove_stair", { id: "stair_main" }, "agent");
    await flush();
    expect(state().approvals[0].targets[0]).toMatchObject({ type: "stair", id: "stair_main" });
    actions.resolveApproval(state().approvals[0].id, false);
    expect((await stair).ok).toBe(false);
    expect(model().stairs).toHaveLength(1);
  });

  it("a level that changed while its removal waited is not removed", async () => {
    townhouse();
    const call = runTool("remove_level", { id: FIRST_LEVEL_ID }, "agent");
    await flush();
    dispatch({ type: "place_item", kind: "plant", x: 5, y: 4, level: FIRST_LEVEL_ID }, human);
    actions.resolveApproval(state().approvals[0].id, true);
    expect((await call).ok).toBe(false);
    expect(model().levels).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------- removing, naming and sizing levels

describe("removing a level", () => {
  it("on a one-level plan is refused before the human is asked: no approval waits for it", async () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    const r = await runTool("remove_level", { id: "Ground floor" }, "agent");
    await flush();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("only level");
    expect(state().approvals).toEqual([]);
    expect(model().levels).toHaveLength(1);
    // the person's own removal is refused by the same rule
    expect(dispatch({ type: "remove_level", id: GROUND_LEVEL_ID }, human).ok).toBe(false);
  });

  it("names the stairs from below that will open into the next level up, and holds the request to them", async () => {
    townhouse();
    const attic = dispatch({ type: "add_level", name: "Attic" }, human);
    const call = runTool("remove_level", { id: "First floor" }, "agent");
    await flush();
    const asked = state().approvals[0];
    expect(asked.effects).toContain("Stair stair_main from Ground floor will open into Attic, which gets a stairwell in its floor.");
    // a change to the rerouted stair while the request waits makes it a different request
    dispatch({ type: "update_stair", id: "stair_main", patch: { width: 1.1 } }, human);
    actions.resolveApproval(asked.id, true);
    expect((await call).ok).toBe(false);
    expect(model().levels).toHaveLength(3);

    const again = runTool("remove_level", { id: "First floor" }, "agent");
    await flush();
    actions.resolveApproval(state().approvals[0].id, true);
    const done = await again;
    expect(done.ok).toBe(true);
    expect(done.summary).toContain("Stair stair_main from Ground floor now opens into Attic");
    expect(stairwellsOf(model(), String(attic.id)).map((w) => w.stair.id)).toEqual(["stair_main"]);
  });

  it("a stair arriving at the top level removed reaches no level, and the request says so", async () => {
    townhouse();
    const call = runTool("remove_level", { id: FIRST_LEVEL_ID }, "agent");
    await flush();
    expect(state().approvals[0].effects).toContain("Stair stair_main from Ground floor will reach no level.");
    actions.resolveApproval(state().approvals[0].id, false);
    await call;
  });
});

describe("level names", () => {
  it("an unnamed level takes the next name of a place no level uses, so a name always names one level", async () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    dispatch({ type: "add_level" }, human);
    dispatch({ type: "add_level" }, human);
    expect(model().levels.map((l) => l.name)).toEqual([LEVEL_NAMES[0], LEVEL_NAMES[1], LEVEL_NAMES[2]]);
    dispatch({ type: "remove_level", id: LEVEL_NAMES[1] }, human);
    expect(freeLevelName(model())).toBe(LEVEL_NAMES[3]);
    dispatch({ type: "add_level" }, human);
    const names = model().levels.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    // and every one of them works as a `level` argument
    for (const name of names) expect((await runTool("add_wall", { ax: 0, ay: 9, bx: 2, by: 9, level: name }, "agent")).ok, name).toBe(true);
  });

  it("a name another level already answers to is refused, whatever its case", () => {
    townhouse();
    const before = model();
    expect(dispatch({ type: "add_level", name: "first FLOOR" }, human).ok).toBe(false);
    expect(dispatch({ type: "update_level", id: GROUND_LEVEL_ID, patch: { name: " First floor " } }, human).ok).toBe(false);
    expect(dispatch({ type: "update_level", id: GROUND_LEVEL_ID, patch: { name: FIRST_LEVEL_ID } }, human).ok).toBe(false);
    expect(model()).toBe(before);
    // keeping a level's own name is no clash
    expect(dispatch({ type: "update_level", id: GROUND_LEVEL_ID, patch: { name: "Ground floor" } }, human).ok).toBe(true);
  });
});

describe("walls under the slab above", () => {
  const wall = (m: PlanModel, id: string) => m.walls.find((w) => w.id === id)!;

  it("a wall under a level that stops short of its slab, or runs up through it, is reported on its own level", () => {
    townhouse();
    expect(codes(model())).not.toContain("wall_short_of_slab");
    dispatch({ type: "edit_wall", id: "g_wall_n", patch: { height: 2.4 } }, human);
    dispatch({ type: "edit_wall", id: "g_wall_e", patch: { height: 3.1 } }, human);
    const issues = issuesOnLevel(model(), GROUND_LEVEL_ID).filter((i) => i.code === "wall_short_of_slab" || i.code === "wall_through_slab");
    expect(issues.map((i) => [i.code, i.refs[0]])).toEqual([
      ["wall_short_of_slab", "g_wall_n"],
      ["wall_through_slab", "g_wall_e"],
    ]);
    expect(issues[0].severity).toBe("warning");
    expect(issues[1].severity).toBe("error");
    // the top level has no slab over it
    dispatch({ type: "edit_wall", id: "f_wall_n", patch: { height: 2.2 } }, human);
    expect(issuesOnLevel(model(), FIRST_LEVEL_ID).some((i) => i.code === "wall_short_of_slab")).toBe(false);
  });

  it("within the tolerance a wall meets the slab", () => {
    townhouse();
    dispatch({ type: "edit_wall", id: "g_wall_n", patch: { height: LEVEL_DEFAULTS.height - SLAB_THICKNESS - WALL_SLAB_TOLERANCE } }, human);
    expect(codes(model())).not.toContain("wall_short_of_slab");
  });

  it("a new storey height carries the walls that met the slab with it, in the same undo step; walls: keep leaves them", async () => {
    townhouse();
    dispatch({ type: "edit_wall", id: "g_wall_w", patch: { height: 1.1 } }, human); // a low partition stays low
    const steps = state().undoStack.length;
    const r = await runTool("update_level", { id: GROUND_LEVEL_ID, height: 3.4 }, "agent");
    expect(r.ok).toBe(true);
    expect(r.wallsCarried).toBe(3);
    expect(state().undoStack.length).toBe(steps + 1);
    expect(wall(model(), "g_wall_n").height).toBeCloseTo(3.4 - SLAB_THICKNESS, 9);
    expect(wall(model(), "g_wall_w").height).toBe(1.1);
    // upstairs walls stand on their own level: untouched
    expect(wall(model(), "f_wall_n").height).toBe(WALL_DEFAULTS.height);
    expect(issuesOnLevel(model(), GROUND_LEVEL_ID).filter((i) => i.code === "wall_short_of_slab").map((i) => i.refs[0])).toEqual(["g_wall_w"]);
    // one undo takes the height and the walls back together
    dispatch({ type: "undo" }, human);
    expect(model().levels[0].height).toBe(LEVEL_DEFAULTS.height);
    expect(wall(model(), "g_wall_n").height).toBe(WALL_DEFAULTS.height);

    expect((await runTool("update_level", { id: GROUND_LEVEL_ID, height: 3.4, walls: "keep" }, "agent")).wallsCarried).toBe(0);
    expect(wall(model(), "g_wall_n").height).toBe(WALL_DEFAULTS.height);
    expect(codes(model())).toContain("wall_short_of_slab");
    expect((await runTool("update_level", { id: GROUND_LEVEL_ID, walls: "drop" }, "agent")).ok).toBe(false);
  });

  it("a level's floor stands at its elevation, and anything on no level on the ground", () => {
    const m = seedTownhouse();
    expect(elevationOf(m, FIRST_LEVEL_ID)).toBe(LEVEL_DEFAULTS.height);
    expect(elevationOf(m, GROUND_LEVEL_ID)).toBe(0);
    expect(elevationOf(m, "nowhere")).toBe(0);
    expect(elevationOf(m, undefined)).toBe(0);
  });
});

describe("the stairwell's guard", () => {
  const straight: Stair = { id: "s", levelId: GROUND_LEVEL_ID, shape: "straight", x: 0, y: 0, rotation: 0, width: 1 };

  it("runs round every edge of the void but the one the stair arrives across", () => {
    const g = stairGeometry(straight, LEVEL_DEFAULTS.height);
    const guard = stairGuard(g);
    expect(guard).toHaveLength(3);
    expect(stairGuard(g)).toBe(guard);
    const mid = (e: (typeof guard)[number]) => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
    // no guarded edge at the top riser
    expect(guard.some((e) => Math.hypot(mid(e).x - g.end.x, mid(e).y - g.end.y) < 1e-6)).toBe(false);
    // each faces away from the void, onto the floor
    for (const e of guard) {
      const m = mid(e);
      expect(stairHeightAt(g, { x: m.x + e.out.x * 0.01, y: m.y + e.out.y * 0.01 })).toBeNull();
      expect(stairHeightAt(g, { x: m.x - e.out.x * 0.01, y: m.y - e.out.y * 0.01 })).not.toBeNull();
    }
  });

  it("an L stair's guard follows the outline of both flights and the landing, not the edges between them", () => {
    const g = stairGeometry({ ...straight, shape: "l", turn: "right" }, LEVEL_DEFAULTS.height);
    const length = stairGuard(g).reduce((sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 0);
    const [f1, f2] = g.flights;
    const w = straight.width;
    // round the L: the first flight's start and two sides, the landing's two open sides, the second flight's two sides
    expect(length).toBeCloseTo(w + 2 * (f1.hd * 2) + 2 * w + 2 * (f2.hd * 2), 6);
  });
});
