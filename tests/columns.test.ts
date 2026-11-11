/**
 * Structure: columns carrying an upper floor over open ground, open spaces (a carport), garage
 * doors and the car as a reference object — the model, the plan format, the commands, the
 * checker's structural rules and the tools, and the Crescent House demo's carport.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { runTool, DESTRUCTIVE_TOOL_NAMES } from "../src/mcp/tools";
import { checkModel, issuesOf } from "../src/model/issues";
import { migratePlan } from "../src/model/planFormat";
import { planRangeErrors } from "../src/model/planRanges";
import { columnArea, columnFootprint, columnGrid, columnHeight, columnWalls, snapColumnPoint } from "../src/model/columns";
import { sampleGrid, supportsUnder, unsupportedZones } from "../src/model/supports";
import { overhangOf, slabOutline, slabRegion } from "../src/model/floors";
import { piecesArea, regionPieces } from "../src/model/region";
import { levelSlice, levelStats, slabUnderside } from "../src/model/levels";
import { placeOf } from "../src/model/places";
import { touchedBy } from "../src/model/touch";
import { changedEntities } from "../src/model/provenance";
import { catalogOf } from "../src/model/catalog";
import { seedLoft } from "../src/model/seed";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID } from "../src/model/demoCrescent";
import { pointInOutline, rectOutline } from "../src/model/shapes";
import { presence } from "../src/model/presence";
import { agentLabel } from "../src/ui/session/participants";
import { APP, parseMessage } from "../src/session/messages";
import { COLUMN, COORD, GARAGE_DOOR, LEVEL_DEFAULTS, OPEN_FLOOR, PARKING, PLAN_FORMAT_VERSION, SESSION, SUPPORT } from "../src/model/limits";
import { emptyModel, groundLevel, type Column, type Issue, type PlanModel, type Wall } from "../src/model/types";
import { resetStore, flush } from "./support/store";

beforeEach(resetStore);

const G = "level_ground";
const F = "level_first";
const human = { actor: "human" } as const;
const model = () => store.getState().model;
const codes = (issues: readonly Issue[]) => issues.map((i) => i.code);

const wallOn = (id: string, levelId: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({ id, levelId, ax, ay, bx, by, thickness: 0.2, height: 2.7, ...extra });
const column = (id: string, levelId: string, x: number, y: number, extra: Partial<Column> = {}): Column => ({ id, levelId, shape: "square", x, y, w: 0.3, d: 0.3, rotation: 0, ...extra });

/** A 4 × 4 m room on the ground, and upstairs a 4 × 12 m room reaching 8 m east over open ground. */
function overhang(columns: Column[] = []): PlanModel {
  return {
    ...emptyModel(),
    levels: [groundLevel(), { id: F, name: "First floor", height: LEVEL_DEFAULTS.height }],
    walls: [
      wallOn("g_n", G, 0, 0, 4, 0),
      wallOn("g_e", G, 4, 0, 4, 4),
      wallOn("g_s", G, 4, 4, 0, 4),
      wallOn("g_w", G, 0, 4, 0, 0),
      wallOn("f_n", F, 0, 0, 12, 0),
      wallOn("f_e", F, 12, 0, 12, 4),
      wallOn("f_s", F, 12, 4, 0, 4),
      wallOn("f_w", F, 0, 4, 0, 0),
    ],
    rooms: [
      { id: "g_room", levelId: G, points: rectOutline(0.1, 0.1, 3.8, 3.8), label: "Store", floor: "concrete" },
      { id: "f_room", levelId: F, points: rectOutline(0.1, 0.1, 11.8, 3.8), label: "Gallery", floor: "oak" },
    ],
    columns,
  };
}

describe("a column's shape", () => {
  it("is its section: a square's or a rectangle's corners, a circle cut into sides on its circle", () => {
    const sq = column("c", G, 1, 2);
    expect(columnFootprint(sq)).toHaveLength(4);
    expect(columnArea(sq)).toBeCloseTo(0.09);
    const rect = column("r", G, 0, 0, { shape: "rectangle", w: 0.5, d: 0.25, rotation: 90 });
    const xs = columnFootprint(rect).map((p) => Math.abs(p.x));
    // turned a quarter, its 0.5 m width runs along y and its 0.25 m depth along x
    for (const x of xs) expect(x).toBeCloseTo(0.125);
    const round = column("o", G, 0, 0, { shape: "circle", w: 0.4, d: 0.4 });
    const pts = columnFootprint(round);
    expect(pts).toHaveLength(COLUMN.circleSides);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.2);
  });

  it("stands to the underside of the slab over its level unless a height is set", () => {
    const m = overhang();
    expect(columnHeight(m, column("c", G, 1, 1))).toBeCloseTo(slabUnderside(LEVEL_DEFAULTS.height));
    expect(columnHeight(m, column("c", G, 1, 1, { height: 1.2 }))).toBe(1.2);
    expect(columnHeight(m, column("c", "nowhere", 1, 1))).toBeUndefined();
  });

  it("is part of the walls whose thickness its centre stands in, and only those of its level", () => {
    const walls = overhang().walls;
    expect(columnWalls(walls, column("c", G, 2, 0.05)).map((w) => w.id)).toEqual(["g_n"]);
    expect(columnWalls(walls, column("c", G, 4, 0)).map((w) => w.id).sort()).toEqual(["g_e", "g_n"]);
    expect(columnWalls(walls, column("c", G, 2, 0.5))).toEqual([]);
  });

  it("is pulled onto a wall's corner, a wall's axis, another column's axis, or the grid, in that order", () => {
    const slice = { walls: overhang().walls.filter((w) => w.levelId === G), columns: [column("k", G, 2.53, 2.81)] };
    expect(snapColumnPoint({ x: 3.9, y: 0.12 }, slice)).toMatchObject({ x: 4, y: 0, to: "corner" });
    expect(snapColumnPoint({ x: 2.02, y: 0.18 }, slice)).toMatchObject({ x: 2.02, y: 0, to: "wall", ref: "g_n" });
    expect(snapColumnPoint({ x: 2.6, y: 1.31 }, slice)).toMatchObject({ x: 2.53, to: "column", ref: "k" });
    expect(snapColumnPoint({ x: 2.6, y: 1.31 }, slice).y).toBeCloseTo(1.3);
    expect(snapColumnPoint({ x: 1.52, y: 1.48 }, slice)).toMatchObject({ to: "grid" });
    // the column being moved does not pull itself
    expect(snapColumnPoint({ x: 2.6, y: 1.31 }, slice, COLUMN.snap, "k").to).toBe("grid");
  });

  it("lays a grid out centred on its point, turned with it", () => {
    const pts = columnGrid({ x: 10, y: 5 }, 2, 3, 2);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[8, 4], [10, 4], [12, 4], [8, 6], [10, 6], [12, 6]]);
    const turned = columnGrid({ x: 0, y: 0 }, 1, 2, 2, 90);
    // turned a quarter, the row runs up the sheet: its first column (the turned left) at +y
    expect(turned[0].x).toBeCloseTo(0);
    expect(turned[0].y).toBeCloseTo(1);
    expect(turned[1].x).toBeCloseTo(0);
    expect(turned[1].y).toBeCloseTo(-1);
  });
});

describe("column commands", () => {
  beforeEach(() => actions.loadModel(overhang()));

  it("add one with the defaults, on the level named, its height derived", () => {
    const r = dispatch({ type: "add_column", spec: { x: 6.0004, y: 2, level: "Ground floor" } }, human);
    expect(r.ok).toBe(true);
    const c = model().columns[0];
    expect(c).toMatchObject({ id: r.id, levelId: G, shape: COLUMN.defaults.shape, w: COLUMN.defaults.size, d: COLUMN.defaults.size, rotation: 0, x: 6, y: 2 });
    expect(c).not.toHaveProperty("height");
    expect(r.height).toBeCloseTo(slabUnderside(LEVEL_DEFAULTS.height));
    expect(r.summary).toContain(`Column ${c.id} added`);
  });

  it("lay out a grid as one undo step", () => {
    const before = model();
    const r = dispatch({ type: "add_column", spec: { x: 8, y: 2, level: G, grid: { rows: 2, cols: 3, spacing: 2 } } }, human);
    expect(r.ok).toBe(true);
    expect(model().columns).toHaveLength(6);
    expect(r.ids).toEqual(model().columns.map((c) => c.id));
    dispatch({ type: "undo" }, human);
    expect(model()).toBe(before);
  });

  it("keep a square's and a circle's depth to their width, and a rectangle's own", () => {
    const id = String(dispatch({ type: "add_column", spec: { x: 6, y: 2, level: G, shape: "rectangle", w: 0.5, d: 0.3 } }, human).id);
    expect(model().columns[0]).toMatchObject({ w: 0.5, d: 0.3 });
    expect(dispatch({ type: "update_column", id, patch: { shape: "circle" } }, human).ok).toBe(true);
    expect(model().columns[0]).toMatchObject({ shape: "circle", w: 0.5, d: 0.5 });
    expect(dispatch({ type: "update_column", id, patch: { shape: "rectangle", d: 0.25 } }, human).ok).toBe(true);
    expect(model().columns[0]).toMatchObject({ w: 0.5, d: 0.25 });
    expect(dispatch({ type: "add_column", spec: { x: 6, y: 3, level: G, shape: "square", w: 0.3, d: 0.4 } }, human).ok).toBe(false);
  });

  it("set a height and clear it back to the slab, move to another level, and remove", () => {
    const id = String(dispatch({ type: "add_column", spec: { x: 6, y: 2, level: G } }, human).id);
    dispatch({ type: "update_column", id, patch: { height: 1.5 } }, human);
    expect(model().columns[0].height).toBe(1.5);
    dispatch({ type: "update_column", id, patch: { height: null } }, human);
    expect(model().columns[0]).not.toHaveProperty("height");
    expect(dispatch({ type: "move_column", id, x: 7, y: 2.5, rotation: 45 }, human).ok).toBe(true);
    expect(model().columns[0]).toMatchObject({ x: 7, y: 2.5, rotation: 45 });
    dispatch({ type: "update_column", id, patch: { levelId: "First floor" } }, human);
    expect(model().columns[0].levelId).toBe(F);
    expect(dispatch({ type: "remove_column", id }, human).ok).toBe(true);
    expect(model().columns).toEqual([]);
  });

  it("refuse what is out of range, an unknown level or column, and past the most a plan holds", () => {
    const before = model();
    expect(dispatch({ type: "add_column", spec: { x: 6, y: 2, w: COLUMN.size.max + 0.1 } }, human).ok).toBe(false);
    expect(dispatch({ type: "add_column", spec: { x: 6, y: 2, height: 0 } }, human).ok).toBe(false);
    expect(dispatch({ type: "add_column", spec: { x: 6, y: 2, level: "Attic" } }, human).ok).toBe(false);
    expect(dispatch({ type: "add_column", spec: { x: 6, y: 2, grid: { rows: 13, cols: 1, spacing: 2 } } }, human).ok).toBe(false);
    expect(dispatch({ type: "update_column", id: "nope", patch: { x: 1 } }, human).ok).toBe(false);
    expect(dispatch({ type: "add_column", spec: { x: 0, y: 0, grid: { rows: 12, cols: 12, spacing: 1 } } }, human).ok).toBe(true);
    expect(dispatch({ type: "add_column", spec: { x: 30, y: 30, grid: { rows: 12, cols: 12, spacing: 1 } } }, human).ok).toBe(false);
    expect(model().columns).toHaveLength(144);
    dispatch({ type: "undo" }, human);
    expect(model()).toBe(before);
  });

  it("go with their level, and are counted with it", () => {
    dispatch({ type: "add_column", spec: { x: 6, y: 2, level: F } }, human);
    expect(levelStats(model(), F).columns).toBe(1);
    expect(levelSlice(model(), F).columns).toHaveLength(1);
    expect(levelSlice(model(), G).columns).toHaveLength(0);
    expect(dispatch({ type: "remove_level", id: F }, human).ok).toBe(true);
    expect(model().columns).toEqual([]);
  });

  it("are entities like the rest: placed, touched, recorded as changed", () => {
    const before = model();
    const id = String(dispatch({ type: "add_column", spec: { x: 6, y: 2, level: G } }, human).id);
    expect(placeOf(model(), id)).toEqual({ x: 6, y: 2, levelId: G });
    expect(touchedBy({ type: "update_column", id, patch: { x: 1 } }, model())).toEqual([id]);
    expect(touchedBy({ type: "add_column", spec: { x: 1, y: 1 } }, model())).toEqual([]);
    expect(changedEntities(before, model()).touched).toContain(id);
  });
});

describe("the plan format", () => {
  it("is format 4", () => {
    expect(PLAN_FORMAT_VERSION).toBe(4);
    expect(emptyModel().columns).toEqual([]);
  });

  it("loads a format-3 plan with no columns, its rooms enclosed and its doors swinging, nothing else changed", () => {
    const loft = seedLoft();
    const { columns: _none, ...rest } = loft;
    void _none;
    const v3 = JSON.parse(JSON.stringify({ ...rest, version: 3 }));
    const migrated = migratePlan(v3);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.from).toBe(3);
    expect(migrated.model).toEqual({ ...loft, version: PLAN_FORMAT_VERSION, columns: [] });
    expect(checkModel(migrated.model)).toEqual(checkModel(loft));
  });

  it("refuses a plan before format 4 that holds what only format 4 has, and a format-4 plan with no column list", () => {
    const { columns: _none, ...v3 } = { ...seedLoft(), version: 3 };
    void _none;
    expect(migratePlan({ ...v3, columns: [] })).toMatchObject({ ok: false });
    expect(migratePlan({ ...v3, rooms: v3.rooms.map((r) => ({ ...r, kind: "open" })) })).toMatchObject({ ok: false });
    expect(migratePlan({ ...v3, openings: v3.openings.map((o) => ({ ...o, style: "garage" })) })).toMatchObject({ ok: false });
    expect(migratePlan({ ...v3, version: 4 })).toMatchObject({ ok: false });
  });

  it("round-trips a format-4 plan with columns, an open room and a garage door, and refuses a column on a missing level", () => {
    const crescent = seedCrescent();
    const migrated = migratePlan(JSON.parse(JSON.stringify(crescent)));
    expect(migrated.ok && migrated.model).toEqual(crescent);
    expect(migratePlan({ ...crescent, columns: [column("c", "level_attic", 0, 0)] })).toMatchObject({ ok: false });
    expect(planRangeErrors({ ...crescent, columns: [column("c", G, 0, 0, { w: 0 })] })).toEqual([expect.stringContaining("column c: w must be")]);
  });

  it("travels between tabs whole: a column, an open room's kind and a garage door's style", () => {
    const message = (k: string, v: unknown) => ({
      app: APP,
      protocol: SESSION.protocol,
      from: "fedcba9876543210",
      type: "ops",
      writes: [{ k, c: 1, t: "fedcba9876543210", v }],
      meta: { actor: "human", as: "add_column", summary: "Column added.", gesture: null },
    });
    const c = column("c", G, 1, 2, { height: 2 });
    const room = { id: "r", levelId: G, points: rectOutline(0, 0, 3, 5), label: "Carport", floor: OPEN_FLOOR, kind: "open" };
    const door = { id: "d", kind: "door", wallId: "w", t: 0.5, width: 2.5, sill: 0, height: 2.1, style: "garage" };
    for (const [k, v] of [["columns:c", c], ["rooms:r", room], ["openings:d", door]] as const) {
      const m = parseMessage(message(k, v), "0123456789abcdef");
      expect(m && m.type === "ops" ? m.writes[0].v : null).toEqual(v);
    }
  });
});

describe("open spaces", () => {
  it("add_room open: a carport floored in concrete, kept only when open, back to enclosed by update_room", async () => {
    const open = await runTool("add_room", { x: 0, y: 0, w: 3, h: 5.5, label: "Carport", open: true }, "agent");
    expect(open.ok).toBe(true);
    const room = () => model().rooms.find((r) => r.id === open.id)!;
    expect(room()).toMatchObject({ kind: "open", floor: OPEN_FLOOR });
    const closed = await runTool("add_room", { x: 4, y: 0, w: 3, h: 3, label: "Store" }, "agent");
    expect(model().rooms.find((r) => r.id === closed.id)).not.toHaveProperty("kind");
    await runTool("update_room", { id: "Carport", open: false }, "agent");
    expect(room()).not.toHaveProperty("kind");
    await runTool("update_room", { id: "Carport", open: true, floor: "tile" }, "agent");
    expect(room()).toMatchObject({ kind: "open", floor: "tile" });
  });

  it("are not asked for enclosing walls or a door; an enclosed room still is", () => {
    const m: PlanModel = {
      ...emptyModel(),
      walls: [wallOn("w1", G, 10, 0, 14, 0), wallOn("w2", G, 14, 0, 14, 4), wallOn("w3", G, 14, 4, 10, 4), wallOn("w4", G, 10, 4, 10, 0)],
      openings: [{ id: "door_1", kind: "door", wallId: "w3", t: 0.5, width: 0.9, sill: 0, height: 2.1 }],
      rooms: [
        { id: "porch", levelId: G, points: rectOutline(0, 0, 3, 3), label: "Porch", floor: "concrete", kind: "open" },
        { id: "shed", levelId: G, points: rectOutline(20, 0, 3, 3), label: "Shed", floor: "concrete" },
      ],
    };
    const found = checkModel(m);
    expect(found.filter((i) => i.refs.includes("porch"))).toEqual([]);
    expect(codes(found.filter((i) => i.refs.includes("shed"))).sort()).toEqual(["room_floating", "room_no_door"]);
  });
});

describe("garage doors", () => {
  const garage = (): PlanModel => ({
    ...emptyModel(),
    walls: [wallOn("w_n", G, 0, 0, 4, 0), wallOn("w_e", G, 4, 0, 4, 6), wallOn("w_s", G, 4, 6, 0, 6), wallOn("w_w", G, 0, 6, 0, 0)],
    rooms: [{ id: "garage", levelId: G, points: rectOutline(0.1, 0.1, 3.8, 5.8), label: "Garage", floor: "concrete" }],
  });
  beforeEach(() => actions.loadModel(garage()));

  it("add_door style garage: a garage door's default size, no hinge or swing", async () => {
    const r = await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage" }, "agent");
    expect(r.ok).toBe(true);
    const d = model().openings[0];
    expect(d).toMatchObject({ kind: "door", style: "garage", width: GARAGE_DOOR.defaults.width, height: GARAGE_DOOR.defaults.height, sill: 0 });
    expect(d).not.toHaveProperty("hinge");
    expect(d).not.toHaveProperty("side");
    expect(r.summary).toContain("Garage door added");
  });

  it("refuses a garage door's size outside its range, one too wide for its wall with its jambs, a hinge, and a swing change", async () => {
    expect((await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage", width: 2 }, "agent")).ok).toBe(false);
    expect((await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage", height: 2.7 }, "agent")).ok).toBe(false);
    expect((await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage", width: 3.9 }, "agent")).ok).toBe(false);
    expect((await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage", hinge: "a" }, "agent")).ok).toBe(false);
    expect(model().openings).toEqual([]);
    const id = String((await runTool("add_door", { wallId: "w_n", t: 0.5, style: "garage" }, "agent")).id);
    expect((await runTool("set_door_swing", { id, side: "left" }, "agent")).ok).toBe(false);
  });

  it("update_opening turns a door into a garage door and back, held to each one's sizes", () => {
    const id = String(dispatch({ type: "add_door", wallId: "w_n", t: 0.5 }, human).id);
    expect(dispatch({ type: "update_opening", id, patch: { style: "garage" } }, human).ok).toBe(false); // 0.9 m is no garage door
    expect(dispatch({ type: "update_opening", id, patch: { style: "garage", width: 2.6 } }, human).ok).toBe(true);
    expect(model().openings[0]).toMatchObject({ style: "garage", width: 2.6 });
    expect(model().openings[0]).not.toHaveProperty("hinge");
    expect(dispatch({ type: "update_opening", id, patch: { style: "swing", width: 0.9 } }, human).ok).toBe(true);
    expect(model().openings[0]).toMatchObject({ hinge: "a", side: "right", width: 0.9 });
    expect(model().openings[0]).not.toHaveProperty("style");
  });

  it("sweeps no floor: a car parked right behind it blocks nothing, and it swings into no other door", () => {
    const m: PlanModel = {
      ...garage(),
      openings: [
        { id: "gd", kind: "door", style: "garage", wallId: "w_n", t: 0.5, width: 2.5, sill: 0, height: 2.1 },
        { id: "door", kind: "door", wallId: "w_w", t: 0.05, width: 0.6, sill: 0, height: 2.1, hinge: "b", side: "right" },
      ],
      items: [{ id: "car", levelId: G, kind: "car", x: 2, y: 2.9, rotation: 0 }],
    };
    expect(checkModel(m)).toEqual([]);
  });

  it("furniture on its threshold is reported as in the threshold, not in a swing it does not have", () => {
    const m: PlanModel = {
      ...garage(),
      openings: [{ id: "gd", kind: "door", style: "garage", wallId: "w_n", t: 0.5, width: 2.5, sill: 0, height: 2.1 }],
      items: [{ id: "pot", levelId: G, kind: "plant", x: 2, y: 0.35, rotation: 0 }],
    };
    const blocked = checkModel(m).filter((i) => i.code === "item_blocks_door");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].message).toContain(`threshold of garage door gd: keep ${GARAGE_DOOR.threshold} m`);
    expect(blocked[0].message).not.toContain("swing");
  });

  it("the checker reports one too wide for its wall in a loaded plan", () => {
    const m: PlanModel = { ...garage(), openings: [{ id: "gd", kind: "door", style: "garage", wallId: "w_n", t: 0.5, width: 3.85, sill: 0, height: 2.1 }] };
    expect(codes(checkModel(m))).toContain("garage_door_too_wide");
  });
});

describe("the car", () => {
  it("is a built-in reference object at a car's real size", () => {
    expect(catalogOf(emptyModel()).get("car")).toMatchObject({ w: 1.8, d: 4.5, h: 1.5, parking: true, category: "garage", source: "builtin" });
  });

  it("must fit its garage with its clearances: a wall through them, its garage's walls, a column in them", () => {
    const base: PlanModel = {
      ...emptyModel(),
      walls: [wallOn("w_n", G, 0, 0, 3, 0), wallOn("w_e", G, 3, 0, 3, 6), wallOn("w_s", G, 3, 6, 0, 6), wallOn("w_w", G, 0, 6, 0, 0)],
      openings: [{ id: "gd", kind: "door", style: "garage", wallId: "w_n", t: 0.5, width: 2.4, sill: 0, height: 2.1 }],
      rooms: [{ id: "garage", levelId: G, points: rectOutline(0.1, 0.1, 2.8, 5.8), label: "Garage", floor: "concrete" }],
      items: [{ id: "car", levelId: G, kind: "car", x: 1.5, y: 3, rotation: 0 }],
    };
    // 2.8 m inside, a 1.8 m car needs 3.0 with its sides clear
    expect(codes(checkModel(base))).toEqual(["car_does_not_fit"]);
    const wider = { ...base, walls: base.walls.map((w) => (w.id === "w_n" ? { ...w, bx: 3.4 } : w.id === "w_e" ? { ...w, ax: 3.4, bx: 3.4 } : w.id === "w_s" ? { ...w, ax: 3.4 } : w)), rooms: [{ ...base.rooms[0], points: rectOutline(0.1, 0.1, 3.2, 5.8) }], items: [{ ...base.items[0], x: 1.7 }] };
    expect(checkModel(wider)).toEqual([]);
    const blocked = { ...wider, columns: [column("c", G, 1.7 + 0.9 + PARKING.side / 2, 3)] };
    expect(codes(checkModel(blocked))).toEqual(["column_blocks_parking"]);
  });
});

describe("the checker's structural rules", () => {
  it("reports the upper floor over open ground with nothing under it, where it is, and is satisfied by columns", () => {
    const bare = overhang();
    const zones = unsupportedZones(bare, F);
    expect(zones).toHaveLength(1);
    const z = zones[0];
    expect(z.rooms).toEqual(["f_room"]);
    // the gallery reaches 8 m past the store's east wall: past SUPPORT.span / 2 from it, unsupported
    expect(z.box.minX).toBeGreaterThan(4.1 + SUPPORT.span / 2 - SUPPORT.sample);
    expect(z.box.maxX).toBeCloseTo(12, 0);
    expect(z.reach).toBeGreaterThan(SUPPORT.span / 2);
    const found = checkModel(bare).filter((i) => i.code === "slab_unsupported");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("First floor");
    expect(found[0].refs).toEqual(["f_room"]);
    // two columns under its far corners and one between carry it
    const carried = overhang([column("c1", G, 11.85, 0.15), column("c2", G, 11.85, 3.85), column("c3", G, 8, 2)]);
    expect(unsupportedZones(carried, F)).toEqual([]);
    expect(supportsUnder(carried, F)?.columns).toHaveLength(3);
    expect(unsupportedZones(carried, G)).toEqual([]);
  });

  it("reports a column off every room and wall, and one upstairs with nothing under it", () => {
    const m = overhang([column("lost", G, 20, 20), column("up", F, 10, 2), column("over", F, 2, 2), column("on_wall", F, 4, 2)]);
    const found = checkModel(m);
    expect(found.filter((i) => i.code === "column_off_floor").map((i) => i.refs[0])).toEqual(["lost"]);
    expect(found.filter((i) => i.code === "column_unsupported").map((i) => i.refs[0])).toEqual(["up", "over"]);
    // a column under it carries it
    expect(codes(checkModel(overhang([column("up", F, 10, 2), column("down", G, 10, 2.1)])))).not.toContain("column_unsupported");
  });

  it("reports a column in a door's swing, in a garage door's drive, in a window, on a stair, on another column and in furniture", () => {
    const m: PlanModel = {
      ...overhang(),
      openings: [
        { id: "door", kind: "door", wallId: "g_s", t: 0.5, width: 0.9, sill: 0, height: 2.1, hinge: "a", side: "right" },
        { id: "gd", kind: "door", style: "garage", wallId: "g_n", t: 0.5, width: 2.5, sill: 0, height: 2.1 },
        { id: "win", kind: "window", wallId: "g_w", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
      ],
      items: [{ id: "sofa", levelId: G, kind: "sofa", x: 2.6, y: 2.6, rotation: 0 }],
      columns: [
        column("in_swing", G, 2, 3.5),
        column("in_drive", G, 2, 0.8),
        column("in_window", G, 0, 2),
        column("in_sofa", G, 2.6, 2.6),
        column("twin_a", G, 1, 2.2),
        column("twin_b", G, 1.1, 2.2),
      ],
    };
    const found = checkModel(m);
    const by = (code: string) => found.filter((i) => i.code === code).map((i) => i.refs.join(" "));
    expect(by("column_blocks_door").sort()).toEqual(["in_drive gd", "in_swing door"]);
    expect(by("column_in_opening")).toEqual(["in_window win"]);
    expect(by("item_hits_column")).toEqual(["sofa in_sofa"]);
    expect(by("columns_overlap")).toEqual(["twin_a twin_b"]);
  });

  it("counts only the walls and columns that reach the slab as carrying it, and reports a column short of it or through it", () => {
    // the gallery's open ground has no room under it: its columns stand off the floor, which is not what this is about
    const checked = (m: PlanModel) => checkModel(m).filter((i) => i.code !== "column_off_floor");
    const corners = (extra: Partial<Column> = {}) => [
      column("c1", G, 11.85, 0.15, extra),
      column("c2", G, 11.85, 3.85, extra),
      column("c3", G, 8, 2, extra),
    ];
    // full height: carried, nothing to say
    expect(checked(overhang(corners()))).toEqual([]);
    // stubs: they carry nothing, so the floor over them is unsupported, and each is reported as short
    for (const height of [1, 0.3]) {
      const found = checked(overhang(corners({ height })));
      expect(codes(found).filter((c) => c === "slab_unsupported")).toHaveLength(1);
      expect(found.filter((i) => i.code === "column_short_of_slab").map((i) => i.refs[0]).sort()).toEqual(["c1", "c2", "c3"]);
      expect(found.find((i) => i.code === "column_short_of_slab")!.severity).toBe("warning");
      expect(supportsUnder(overhang(corners({ height })), F)?.columns).toEqual([]);
    }
    // within the walls' tolerance of the underside it still meets it
    const underside = slabUnderside(LEVEL_DEFAULTS.height);
    expect(checked(overhang(corners({ height: underside - 0.005 })))).toEqual([]);
    // one that runs up through the floor above is an error, as a wall's is; it still carries
    const tall = checked(overhang([...corners().slice(0, 2), column("c3", G, 8, 2, { height: 6 })]));
    expect(tall.filter((i) => i.code === "column_through_slab").map((i) => [i.refs[0], i.severity])).toEqual([["c3", "error"]]);
    expect(codes(tall)).not.toContain("slab_unsupported");
    // on the top level there is no slab over it: any height is its own
    expect(codes(checked(overhang([...corners(), column("up", F, 2, 2, { height: 1 })])))).not.toContain("column_short_of_slab");
    // a column upstairs on a stub below stands on nothing
    const stacked = checked(overhang([...corners(), column("stub", G, 6, 2, { height: 0.3 }), column("up", F, 6, 2)]));
    expect(stacked.filter((i) => i.code === "column_unsupported").map((i) => i.refs[0])).toEqual(["up"]);
    expect(codes(checked(overhang([...corners(), column("post", G, 6, 2), column("up", F, 6, 2)])))).not.toContain("column_unsupported");
    // a low partition carries nothing either: with the store's east wall at 1.5 m, more of the floor is unsupported
    const low = overhang();
    const lowered = { ...low, walls: low.walls.map((w) => (w.id === "g_e" ? { ...w, height: 1.5 } : w)) };
    expect(supportsUnder(lowered, F)?.walls.map((w) => w.id)).not.toContain("g_e");
    expect(unsupportedZones(lowered, F)[0].box.minX).toBeLessThan(unsupportedZones(low, F)[0].box.minX);
  });

  it("checks a floor as large as the plan allows without overflowing, and samples it within its cap", () => {
    const far = 100;
    const big: PlanModel = {
      ...emptyModel(),
      levels: [groundLevel(), { id: F, name: "First floor", height: LEVEL_DEFAULTS.height }],
      walls: [wallOn("stub", G, 0, 0, 1, 0)],
      rooms: [{ id: "hall", levelId: F, points: rectOutline(0, 0, far, far), label: "Hall", floor: "oak" }],
    };
    const found = checkModel(big).filter((i) => i.code === "slab_unsupported");
    expect(found).toHaveLength(1);
    expect(found[0].refs).toEqual(["hall"]);
    const [zone] = unsupportedZones(big, F);
    // nearly the whole floor, its furthest point near the far corner from the one wall
    expect(zone.area).toBeGreaterThan(far * far * 0.95);
    expect(zone.reach).toBeGreaterThan(far);
    // the sample count stays within the cap however large the floor is (COORD's whole span)
    for (const size of [far, COORD.max - COORD.min]) {
      const g = sampleGrid({ minX: 0, minY: 0, maxX: size, maxY: size });
      expect(g.nx * g.ny).toBeLessThanOrEqual(SUPPORT.maxSamples);
      expect(g.step * g.nx).toBeGreaterThanOrEqual(size - 1e-9);
    }
    expect(sampleGrid({ minX: 0, minY: 0, maxX: 4, maxY: 4 }).step).toBe(SUPPORT.sample);
  });

  it("keeps a floor's zones across edits that do not touch what carries it", () => {
    const bare = overhang();
    const zones = unsupportedZones(bare, F);
    // a chair put down on the ground floor: the same zones, not sampled again
    const moved: PlanModel = { ...bare, items: [{ id: "chair", levelId: G, kind: "office_chair", x: 2, y: 2, rotation: 0 }] };
    expect(unsupportedZones(moved, F)).toBe(zones);
    // a column under it: sampled again
    expect(unsupportedZones({ ...bare, columns: [column("c", G, 8, 2)] }, F)).not.toBe(zones);
  });

  it("does not count a column in the wall beside a door as in its swing; one in the doorway or the leaf's sweep is", () => {
    const door = { id: "door", kind: "door" as const, wallId: "g_s", t: 0.5, width: 0.9, sill: 0, height: 2.1, hinge: "a" as const, side: "right" as const };
    const at = (x: number, y = 4): PlanModel => ({ ...overhang(), openings: [door], columns: [column("c", G, x, y, { w: 0.25, d: 0.25 })] });
    const blocks = (m: PlanModel) => checkModel(m).filter((i) => i.code === "column_blocks_door");
    // the vano runs x 1.55 to 2.45 along y 4; a column in the wall 2 cm past either jamb is beside it
    expect(blocks(at(1.55 - 0.125 - 0.02))).toEqual([]);
    expect(blocks(at(2.45 + 0.125 + 0.02))).toEqual([]);
    // in the doorway itself
    const inside = blocks(at(2));
    expect(inside.map((i) => i.refs)).toEqual([["c", "door"]]);
    expect(inside[0].message).toContain("doorway");
    // in the floor the leaf sweeps, off the wall on the side it opens to (and not on the other)
    const swept = [...blocks(at(2, 3.5)), ...blocks(at(2, 4.5))];
    expect(swept).toHaveLength(1);
    expect(swept[0].message).toContain("swing path");
  });

  it("counts a wall that ends on a column as joined to it", () => {
    const m: PlanModel = { ...emptyModel(), walls: [wallOn("w", G, 0, 0, 4, 0), wallOn("v", G, 0, 0, 0, 3)], columns: [column("c", G, 4, 0), column("k", G, 0, 3)] };
    expect(codes(checkModel(m))).not.toContain("wall_loose_end");
    expect(codes(checkModel({ ...m, columns: [] }))).toContain("wall_loose_end");
  });
});

describe("the column tools", () => {
  beforeEach(() => {
    actions.setRequireApproval(true);
    actions.loadModel(overhang());
  });

  it("add_column takes a room and a grid, and refuses a grid that would leave the room", async () => {
    const r = await runTool("add_column", { room: "Store", grid: { rows: 2, cols: 2, spacing: 2 } }, "agent");
    expect(r.ok).toBe(true);
    expect(model().columns.map((c) => [c.x, c.y, c.levelId])).toEqual([[1, 1, G], [3, 1, G], [1, 3, G], [3, 3, G]]);
    expect((await runTool("add_column", { room: "Store", grid: { rows: 1, cols: 3, spacing: 2.5 } }, "agent")).ok).toBe(false);
    expect((await runTool("add_column", { room: "Store", x: 1 }, "agent")).ok).toBe(false);
    expect((await runTool("add_column", { y: 1 }, "agent")).ok).toBe(false);
  });

  it("show the agent at work on the column it adds", async () => {
    const r = await runTool("add_column", { x: 8, y: 2, level: "Ground floor" }, "agent");
    expect(presence.getState().agent.focus).toEqual([r.id]);
    expect(agentLabel({ state: "working", tool: "add_column", focus: [String(r.id)] }, model())).toBe("Agent · adding Column 1");
  });

  it("remove_column waits for the human's approval", async () => {
    await runTool("add_column", { x: 8, y: 2, level: G }, "agent");
    expect(DESTRUCTIVE_TOOL_NAMES).toContain("remove_column");
    const id = model().columns[0].id;
    const call = runTool("remove_column", { id }, "agent");
    await flush();
    const pending = store.getState().approvals;
    expect(pending).toHaveLength(1);
    expect(pending[0].targets).toEqual([{ type: "column", id, label: "0.30 m square" }]);
    expect(pending[0].effects[0]).toContain("First floor");
    actions.resolveApproval(pending[0].id, true);
    expect((await call).ok).toBe(true);
    expect(model().columns).toEqual([]);
  });

  it("add_column with a room centres it inside the room, an L as well as a rectangle", async () => {
    const ell = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }];
    actions.loadModel({ ...emptyModel(), rooms: [{ id: "ell", levelId: G, points: ell, label: "Ell", floor: "oak" }] });
    const r = await runTool("add_column", { room: "Ell" }, "agent");
    expect(r.ok).toBe(true);
    const c = model().columns[0];
    // inside the L, not at its bounds' middle (3, 3), which is outside it
    expect(pointInOutline(c, ell)).toBe(true);
    expect((await runTool("add_column", { room: "Ell", grid: { rows: 1, cols: 2, spacing: 1 } }, "agent")).ok).toBe(true);
  });

  it("report a derived height as get_model does, to the millimetre", async () => {
    const added = await runTool("add_column", { x: 8, y: 2, level: G }, "agent");
    expect(added.height).toBe(2.7);
    const updated = await runTool("update_column", { id: String(added.id), x: 8.5 }, "agent");
    expect(updated.height).toBe(2.7);
  });

  it("remove_level names the columns it removes, and a column changed while it waits makes it a different request", async () => {
    await runTool("add_column", { x: 8, y: 2, level: F }, "agent");
    const call = runTool("remove_level", { id: F }, "agent");
    await flush();
    const asked = store.getState().approvals[0];
    expect(asked.effects[0]).toContain("1 column");
    dispatch({ type: "update_column", id: model().columns[0].id, patch: { x: 3 } }, human);
    actions.resolveApproval(asked.id, true);
    expect((await call).ok).toBe(false);
    expect(model().levels).toHaveLength(2);
    expect(model().columns).toHaveLength(1);
  });

  it("clear_model says it erases the plan's columns", async () => {
    await runTool("add_column", { x: 8, y: 2, level: G }, "agent");
    const call = runTool("clear_model", {}, "agent");
    await flush();
    const asked = store.getState().approvals[0];
    expect(asked.effects).toContain("Erases the plan's 1 column.");
    actions.resolveApproval(asked.id, false);
    await call;
  });

  it("update_column clears a set height with null", async () => {
    const id = String((await runTool("add_column", { x: 8, y: 2, level: G, height: 2 }, "agent")).id);
    expect((await runTool("update_column", { id, height: null }, "agent")).ok).toBe(true);
    expect(model().columns[0]).not.toHaveProperty("height");
  });

  it("get_model reports each column's height and walls, open spaces, and what carries each upper floor", async () => {
    await runTool("add_column", { x: 4, y: 2, level: G }, "agent");
    const r = await runTool("get_model", {}, "agent");
    const m = r.model as { columns: { height: number; heightSet: boolean; inWalls: string[] }[] };
    expect(m.columns[0]).toMatchObject({ heightSet: false, inWalls: ["g_e"] });
    expect(m.columns[0].height).toBeCloseTo(slabUnderside(LEVEL_DEFAULTS.height));
    const supports = r.supports as { levelId: string; columns: number; unsupported: { rooms: string[] }[] }[];
    expect(supports).toHaveLength(1);
    expect(supports[0]).toMatchObject({ levelId: F, columns: 1 });
    expect(supports[0].unsupported[0].rooms).toEqual(["f_room"]);
    const one = await runTool("get_model", { level: "First floor" }, "agent");
    expect((one.supports as unknown[]).length).toBe(1);
    expect(((await runTool("get_model", { level: "Ground floor" }, "agent")).supports as unknown[]).length).toBe(0);
    expect((await runTool("get_issues", {}, "agent")).issues).toBe(issuesOf(model()));
  });
});

describe("Crescent House's carport", () => {
  it("is an open space under the studio, with a car, a garage door and three columns, and no issues", () => {
    const m = seedCrescent();
    const carport = m.rooms.find((r) => r.label === "Carport")!;
    expect(carport).toMatchObject({ kind: "open", floor: OPEN_FLOOR, levelId: G });
    expect(m.openings.filter((o) => o.style === "garage")).toHaveLength(1);
    expect(m.items.find((i) => i.kind === "car")?.levelId).toBe(G);
    expect(m.columns).toHaveLength(3);
    expect(m.rooms.some((r) => r.label === "Studio" && r.levelId === CRESCENT_FIRST_LEVEL_ID)).toBe(true);
    expect(checkModel(m)).toEqual([]);
  });

  it("stands every column on the carport's floor and under the studio's slab, flush with its edge", () => {
    const m = seedCrescent();
    const slab = slabRegion(m, CRESCENT_FIRST_LEVEL_ID);
    // the ground floor's rooms and its walls' footprints: what a column there can stand on
    const floors = slabOutline(levelSlice(m, G));
    for (const c of m.columns) {
      // none of its section is off the floor (in the carport, or in the wall it is part of) or out from under the slab
      const section = [columnFootprint(c)];
      expect(piecesArea(regionPieces(section, floors)), `${c.id} on the floor`).toBeLessThan(1e-9);
      expect(piecesArea(regionPieces(section, slab.include)), `${c.id} under the slab`).toBeLessThan(1e-9);
    }
    // their outer faces are the studio walls' outer faces over them, where the slab ends
    const east = m.walls.find((w) => w.id === "f_studio_e")!;
    for (const c of m.columns) expect(c.x + c.w / 2).toBeCloseTo(east.ax + east.thickness / 2, 9);
    const north = m.walls.find((w) => w.id === "f_studio_n")!;
    const south = m.walls.find((w) => w.id === "f_studio_s")!;
    expect(Math.min(...m.columns.map((c) => c.y - c.d / 2))).toBeCloseTo(north.ay - north.thickness / 2, 9);
    expect(Math.max(...m.columns.map((c) => c.y + c.d / 2))).toBeCloseTo(south.ay + south.thickness / 2, 9);
  });

  it("stands the studio on its columns: without them its floor is unsupported", () => {
    const m = seedCrescent();
    expect(unsupportedZones(m, CRESCENT_FIRST_LEVEL_ID)).toEqual([]);
    const without = { ...m, columns: [] };
    const zones = unsupportedZones(without, CRESCENT_FIRST_LEVEL_ID);
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((z) => z.rooms.includes("f_room_studio"))).toBe(true);
  });

  it("overhangs the open ground: the studio's slab over the carport, none over the enclosed rooms", () => {
    const m = seedCrescent();
    const over = overhangOf(m, CRESCENT_FIRST_LEVEL_ID);
    const area = piecesArea(regionPieces(over.include, over.exclude));
    const studio = m.rooms.find((r) => r.id === "f_room_studio")!;
    const studioArea = piecesArea(regionPieces([studio.points.map((p) => ({ x: p.x, y: p.y }))]));
    // at least the studio's floor, at most it with the walls round it
    expect(area).toBeGreaterThan(studioArea * 0.95);
    expect(area).toBeLessThan(studioArea * 1.3);
    expect(overhangOf(m, G)).toEqual({ include: [], exclude: [] });
    const slab = slabRegion(m, CRESCENT_FIRST_LEVEL_ID);
    expect(slab.exclude.length).toBe(1); // the stairwell
  });
});
