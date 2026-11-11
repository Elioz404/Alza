/**
 * Free shapes through the model: curved walls and polygon rooms as the actions take them, the
 * tools describe them and the checker judges them; rooms fitted to the walls round a point; and
 * plans saved before rooms were outlines, migrated without loss.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { checkModel } from "../src/model/issues";
import { migratePlan } from "../src/model/planFormat";
import { enclosedOutline } from "../src/model/enclose";
import { seedLoft, seedTownhouse } from "../src/model/seed";
import { runTool } from "../src/mcp/tools";
import { slabOutline } from "../src/model/floors";
import { regionPieces, piecesArea } from "../src/model/region";
import { arcOf, outlineArea, outlineBounds, outlineError, outlineRect, outlineSelfIntersection, pointInOutline, rectOutline, roomArea, wallArc, wallLength, wallPointAt } from "../src/model/shapes";
import { PLAN_FORMAT_VERSION, ROOM_SHAPE, ROOM_SIZE, STRAIGHT_SAGITTA } from "../src/model/limits";
import type { PlanModel, Room, Wall } from "../src/model/types";
import { emptyModel } from "../src/model/types";
import { resetStore } from "./support/store";

beforeEach(resetStore);

const model = () => store.getState().model;
const human = { actor: "human" } as const;
const codes = (m: PlanModel) => checkModel(m).map((i) => i.code);
const G = "level_ground";
const wall = (id: string, ax: number, ay: number, bx: number, by: number, over: Partial<Wall> = {}): Wall => ({ id, levelId: G, ax, ay, bx, by, thickness: 0.2, height: 2.7, ...over });
const room = (id: string, points: Room["points"], over: Partial<Room> = {}): Room => ({ id, levelId: G, points, label: id, floor: "oak", ...over });
const plan = (over: Partial<PlanModel>): PlanModel => ({ ...emptyModel(), ...over });

describe("plans saved before free shapes", () => {
  it("a format-2 plan's rooms load as their four corners, its walls as straight, nothing else changed", () => {
    const loft = seedLoft();
    // format 2 had no columns: the plan it saved has no list of them
    const { columns: _none, ...saved } = loft;
    void _none;
    const v2 = {
      ...saved,
      version: 2,
      rooms: loft.rooms.map(({ points, ...r }) => ({ ...r, ...outlineBounds(points) })),
    };
    const migrated = migratePlan(JSON.parse(JSON.stringify(v2)));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.from).toBe(2);
    expect(migrated.model.version).toBe(PLAN_FORMAT_VERSION);
    // exactly the rectangles it had, as corners, and back
    for (const [i, r] of migrated.model.rooms.entries()) {
      expect(r.points).toEqual(rectOutline(v2.rooms[i].x, v2.rooms[i].y, v2.rooms[i].w, v2.rooms[i].h));
      expect(outlineRect(r.points)).toEqual({ x: v2.rooms[i].x, y: v2.rooms[i].y, w: v2.rooms[i].w, h: v2.rooms[i].h });
      expect(r).not.toHaveProperty("x");
    }
    expect(migrated.model.walls.every((w) => w.bulge === undefined)).toBe(true);
    expect(migrated.model.walls).toEqual(loft.walls);
    expect(checkModel(migrated.model)).toEqual(checkModel(loft));
  });

  it("a format-1 plan migrates through format 2 to outlines", () => {
    const loft = seedLoft();
    const unlevelled = <T extends { levelId?: string }>(e: T): T => {
      const copy = { ...e };
      delete copy.levelId;
      return copy;
    };
    const v1 = {
      name: "Old",
      walls: loft.walls.map(unlevelled),
      openings: loft.openings,
      rooms: loft.rooms.map(({ points, ...r }) => unlevelled({ ...r, ...outlineBounds(points) })),
      items: loft.items.map(unlevelled),
      kinds: [],
      underlay: null,
    };
    const migrated = migratePlan(v1);
    expect(migrated.ok && migrated.from).toBe(1);
    expect(migrated.ok && migrated.model.rooms[0].points).toEqual(loft.rooms[0].points);
  });

  it("refuses a plan whose rooms are not the kind its format writes, or a bulge before format 3", () => {
    const loft = seedLoft();
    expect(migratePlan({ ...loft, version: 2 })).toMatchObject({ ok: false, summary: expect.stringMatching(/only format 3/) });
    const rects = loft.rooms.map(({ points, ...r }) => ({ ...r, ...outlineBounds(points) }));
    expect(migratePlan({ ...loft, rooms: rects })).toMatchObject({ ok: false, summary: expect.stringMatching(/rectangle/) });
    const bent = { ...loft, version: 2, rooms: rects, walls: [{ ...loft.walls[0], bulge: 0.2 }, ...loft.walls.slice(1)] };
    expect(migratePlan(bent)).toMatchObject({ ok: false, summary: expect.stringMatching(/bulge/) });
  });

  it("a current plan keeps every entity it had, and loads", () => {
    const loft = seedLoft();
    const again = migratePlan(loft);
    expect(again.ok && again.model.rooms[0]).toBe(loft.rooms[0]);
    expect(dispatch({ type: "load_model", model: JSON.parse(JSON.stringify(loft)) }, human).ok).toBe(true);
    expect(model().rooms).toEqual(loft.rooms);
  });
});

describe("curved walls through the actions", () => {
  it("add_wall bends a wall by its sagitta or a point it passes, and edit_wall straightens it", () => {
    const r = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, curve: { sagitta: 1 } }, human);
    expect(r.ok).toBe(true);
    const w = model().walls[0];
    expect(w.bulge).toBeCloseTo(0.5);
    expect(r.length).toBeCloseTo(wallLength(w));
    // its middle is 1 m to its left (the side (dy, -dx) of A→B: -y)
    expect(wallPointAt(w, 0.5).y).toBeCloseTo(-1);
    expect(dispatch({ type: "edit_wall", id: w.id, patch: { curve: { through: { x: 2, y: 2 } } } }, human).ok).toBe(true);
    expect(model().walls[0].bulge).toBeCloseTo(-1);
    expect(dispatch({ type: "edit_wall", id: w.id, patch: { curve: { sagitta: 0 } } }, human).ok).toBe(true);
    expect(model().walls[0]).not.toHaveProperty("bulge");
    // undo walks it back, one bend at a time
    dispatch({ type: "undo" }, human);
    expect(model().walls[0].bulge).toBeCloseTo(-1);
  });

  it("stores a bow under STRAIGHT_SAGITTA as a straight wall or edge, through the commands and from a saved plan", () => {
    const id = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 6, by: 0, curve: { sagitta: STRAIGHT_SAGITTA / 3 } }, human).id as string;
    expect(model().walls[0]).not.toHaveProperty("bulge");
    expect(dispatch({ type: "edit_wall", id, patch: { curve: { sagitta: STRAIGHT_SAGITTA * 3 } } }, human).ok).toBe(true);
    expect(model().walls[0].bulge).toBeCloseTo((2 * STRAIGHT_SAGITTA * 3) / 6, 12);
    const roomId = dispatch({ type: "add_room", points: rectOutline(1, 1, 4, 3), label: "R" }, human).id as string;
    expect(dispatch({ type: "reshape_room", id: roomId, change: { op: "bend_edge", edge: 0, curve: { sagitta: STRAIGHT_SAGITTA / 3 } } }, human).ok).toBe(true);
    expect(model().rooms[0].points.every((p) => p.bulge === undefined)).toBe(true);
    // a saved plan carrying such bows loads without them, and nothing else about it changes
    const loft = seedLoft();
    const saved: PlanModel = {
      ...loft,
      walls: loft.walls.map((w, i) => (i === 0 ? { ...w, bulge: 1e-8 } : w)),
      rooms: loft.rooms.map((r, i) => (i === 0 ? { ...r, points: r.points.map((p, k) => (k === 0 ? { ...p, bulge: 1e-8 } : p)) } : r)),
    };
    const loaded = migratePlan(JSON.parse(JSON.stringify(saved)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.model.walls).toEqual(loft.walls);
    expect(loaded.model.rooms).toEqual(loft.rooms);
  });

  it("moving an end keeps the bend's bulge", () => {
    const id = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, curve: { bulge: 0.4 } }, human).id as string;
    dispatch({ type: "edit_wall", id, patch: { bx: 6 } }, human);
    expect(model().walls[0]).toMatchObject({ bx: 6, bulge: 0.4 });
  });

  it("refuses a bend past a half circle, or tighter than the wall's thickness", () => {
    expect(dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, curve: { sagitta: 3 } }, human)).toMatchObject({ ok: false, summary: expect.stringMatching(/half circle/) });
    expect(dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 0.3, by: 0, thickness: 0.5, curve: { bulge: 1 } }, human)).toMatchObject({ ok: false, summary: expect.stringMatching(/radius/) });
    expect(dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, curve: { through: { x: 0, y: 0 } } }, human).ok).toBe(false);
    expect(model().walls).toHaveLength(0);
  });

  it("a door on a curved wall sits at t along its arc, and one too wide for the bend is refused", () => {
    const id = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.2, curve: { bulge: 0.5 } }, human).id as string;
    const door = dispatch({ type: "add_door", wallId: id, t: 0.5, width: 0.9 }, human);
    expect(door.ok).toBe(true);
    const w = model().walls[0];
    const arc = wallArc(w)!;
    expect(Math.hypot(wallPointAt(w, 0.5).x - arc.center.x, wallPointAt(w, 0.5).y - arc.center.y)).toBeCloseTo(arc.radius);
    // a tight arc and a wide door: its straight leaf would stand out of the wall
    const tight = dispatch({ type: "add_wall", ax: 10, ay: 0, bx: 12, by: 0, thickness: 0.1, curve: { bulge: 1 } }, human).id as string;
    expect(dispatch({ type: "add_window", wallId: tight, t: 0.5, width: 2 }, human)).toMatchObject({ ok: false, summary: expect.stringMatching(/too wide for the bend/) });
  });
});

describe("rooms of any shape through the actions", () => {
  const L = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 5 },
    { x: 0, y: 5 },
  ];

  it("add_room takes an outline in either winding and keeps it wound one way, snapped", () => {
    const r = dispatch({ type: "add_room", points: [...L].reverse().map((p) => ({ x: p.x + 0.01, y: p.y })), label: "L" }, human);
    expect(r.ok).toBe(true);
    const points = model().rooms[0].points;
    expect(outlineArea(points)).toBeCloseTo(24);
    expect(points.every((p) => Math.abs(p.x * 20 - Math.round(p.x * 20)) < 1e-9)).toBe(true);
    expect(r.area).toBeCloseTo(24);
  });

  it("a rectangle is still x, y, w, h, and is its four corners", () => {
    dispatch({ type: "add_room", x: 1, y: 2, w: 3, h: 4, label: "R" }, human);
    expect(model().rooms[0].points).toEqual(rectOutline(1, 2, 3, 4));
  });

  it("refuses an outline that crosses itself, is too small, or mixes shapes", () => {
    const bow = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }];
    expect(dispatch({ type: "add_room", points: bow, label: "Bow" }, human)).toMatchObject({ ok: false, summary: expect.stringMatching(/cross/) });
    expect(dispatch({ type: "add_room", points: rectOutline(0, 0, 0.3, 0.3), label: "Tiny" }, human).ok).toBe(false);
    expect(dispatch({ type: "add_room", x: 0, y: 0, w: 2, h: 2, points: L, label: "Both" }, human)).toMatchObject({ ok: false, summary: expect.stringMatching(/exactly one shape/) });
    expect(dispatch({ type: "add_room", x: 0, y: 0, w: 2, label: "Half" }, human).ok).toBe(false);
    expect(model().rooms).toHaveLength(0);
  });

  it("reshapes a corner at a time, each one undo step", () => {
    const id = dispatch({ type: "add_room", points: L, label: "L" }, human).id as string;
    expect(dispatch({ type: "reshape_room", id, change: { op: "move_vertex", index: 2, x: 6, y: 2 } }, human).ok).toBe(true);
    // (6, 3) up to (6, 2): the triangle (6, 2), (6, 3), (3, 3) leaves the room
    expect(outlineArea(model().rooms[0].points)).toBeCloseTo(24 - 1.5);
    expect(dispatch({ type: "reshape_room", id, change: { op: "insert_vertex", edge: 0, x: 3, y: -1 } }, human).ok).toBe(true);
    expect(model().rooms[0].points).toHaveLength(7);
    expect(dispatch({ type: "reshape_room", id, change: { op: "remove_vertex", index: 1 } }, human).ok).toBe(true);
    expect(model().rooms[0].points).toHaveLength(6);
    dispatch({ type: "undo" }, human);
    expect(model().rooms[0].points).toHaveLength(7);
    dispatch({ type: "undo" }, human);
    dispatch({ type: "undo" }, human);
    expect(model().rooms[0].points).toEqual(L);
  });

  it("bends an edge out of the room and back, and splits an arc where a corner is added on it", () => {
    const id = dispatch({ type: "add_room", points: rectOutline(0, 0, 4, 3), label: "R" }, human).id as string;
    expect(dispatch({ type: "reshape_room", id, change: { op: "bend_edge", edge: 0, curve: { sagitta: 1 } } }, human).ok).toBe(true);
    const bent = model().rooms[0].points;
    expect(outlineArea(bent)).toBeGreaterThan(12);
    // the arc's middle is outside the rectangle, on the north
    const arc = arcOf(bent[0], bent[1], bent[0].bulge)!;
    expect(arc.center.y).toBeGreaterThan(0);
    const before = outlineArea(bent);
    expect(dispatch({ type: "reshape_room", id, change: { op: "insert_vertex", edge: 0, x: 2, y: -1 } }, human).ok).toBe(true);
    const split = model().rooms[0].points;
    expect(split).toHaveLength(5);
    expect(outlineArea(split)).toBeCloseTo(before, 6);
    expect(dispatch({ type: "reshape_room", id, change: { op: "bend_edge", edge: 0, curve: { sagitta: 3 } } }, human).ok).toBe(false);
    expect(dispatch({ type: "reshape_room", id, change: { op: "remove_vertex", index: 9 } }, human).ok).toBe(false);
  });

  it("update_room moves an outline by its bounds' corner and stretches it", () => {
    const id = dispatch({ type: "add_room", points: L, label: "L" }, human).id as string;
    dispatch({ type: "update_room", id, patch: { x: 1, y: 1 } }, human);
    expect(outlineBounds(model().rooms[0].points)).toMatchObject({ x: 1, y: 1, w: 6, h: 5 });
    dispatch({ type: "update_room", id, patch: { w: 12 } }, human);
    expect(roomArea(model().rooms[0])).toBeCloseTo(48);
    dispatch({ type: "update_room", id, patch: { points: rectOutline(0, 0, 2, 2) } }, human);
    expect(model().rooms[0].points).toEqual(rectOutline(0, 0, 2, 2));
  });
});

describe("rooms fitted to the walls", () => {
  it("fills the rectangle four walls close off, to their inner faces", () => {
    const walls = [wall("n", 0, 0, 6, 0), wall("e", 6, 0, 6, 4), wall("s", 6, 4, 0, 4), wall("w", 0, 4, 0, 0)];
    const outline = enclosedOutline(walls, { x: 3, y: 2 })!;
    expect(outlineRect(outline)).toEqual({ x: expect.closeTo(0.1, 9), y: expect.closeTo(0.1, 9), w: expect.closeTo(5.8, 9), h: expect.closeTo(3.8, 9) });
    expect(enclosedOutline(walls, { x: 9, y: 9 })).toBeNull();
  });

  it("fits a sharp wedge to its walls' inner faces, however sharp its corner", () => {
    for (const apex of [8, 10, 12, 13, 15, 20]) {
      // a triangle of 0.2 m walls, legs 8 m, apex at the origin
      const half = ((apex / 2) * Math.PI) / 180;
      const p = { x: 8 * Math.cos(half), y: 8 * Math.sin(half) };
      const q = { x: 8 * Math.cos(half), y: -8 * Math.sin(half) };
      const walls = [wall("a", 0, 0, p.x, p.y), wall("b", p.x, p.y, q.x, q.y), wall("c", q.x, q.y, 0, 0)];
      const outline = enclosedOutline(walls, { x: (p.x + q.x) / 3, y: 0 })!;
      expect(outline, `${apex}°`).toHaveLength(3);
      expect(outlineSelfIntersection(outline), `${apex}°`).toBeNull();
      // the exact inset: each side moved in 0.1 m, the apex 0.1 / sin(apex/2) along the bisector
      const apexIn = 0.1 / Math.sin(half);
      const baseX = p.x - 0.1;
      const exact = (baseX - apexIn) * (baseX - apexIn) * Math.tan(half);
      expect(roomArea({ points: outline }), `${apex}°`).toBeCloseTo(exact, 6);
      expect(outlineError(outline, ROOM_SIZE.min), `${apex}°`).toBeNull();
    }
  });

  it("follows a curved facade, picks the space round the point, and ignores a wall hanging in it", () => {
    const walls = [
      wall("n", 0, 0, 6, 0, { bulge: 0.3 }),
      wall("e", 6, 0, 6, 4),
      wall("s", 6, 4, 0, 4),
      wall("w", 0, 4, 0, 0),
      // a partition splitting it in two, and a stub sticking into the east half
      wall("mid", 3, 0, 3, 4),
      wall("stub", 6, 2, 5, 2),
    ];
    // the partition meets the arc mid-span: the arc there is at its middle
    walls[4] = { ...walls[4], ay: wallPointAt(walls[0], 0.5).y };
    const west = enclosedOutline(walls, { x: 1, y: 2 })!;
    const east = enclosedOutline(walls, { x: 4.5, y: 3 })!;
    expect(west.some((p) => p.bulge !== undefined)).toBe(true);
    expect(pointInOutline({ x: 1, y: 2 }, west)).toBe(true);
    expect(pointInOutline({ x: 4.5, y: 3 }, west)).toBe(false);
    expect(pointInOutline({ x: 4.5, y: 3 }, east)).toBe(true);
    // the arc's bulge gives the west room more than its straight part: the band under the arc is in it
    expect(outlineArea(west)).toBeGreaterThan(2.8 * 3.8);
    // the stub does not cut the east room
    expect(east.length).toBeLessThanOrEqual(5);
  });

  it("a fitted room has no corner where a wall meets its side from outside", () => {
    // a 6 × 4 box, a wing wall leaving its east side at 45°, and a partition outside its north side
    const walls = [
      wall("n", 0, 0, 6, 0),
      wall("e", 6, 0, 6, 4),
      wall("s", 6, 4, 0, 4),
      wall("w", 0, 4, 0, 0),
      wall("wing", 6, 1.5, 8, 3.5),
      wall("out", 3, 0, 3, -2),
    ];
    const inside = enclosedOutline(walls, { x: 3, y: 2 })!;
    expect(inside).toHaveLength(4);
    expect(outlineArea(inside)).toBeCloseTo(5.8 * 3.8, 9);
    // a jog where a thinner wall carries on in line is a real corner, and stays
    const jog = enclosedOutline([...walls.slice(0, 4).map((w) => (w.id === "n" ? { ...w, bx: 3 } : w)), wall("n2", 3, 0, 6, 0, { thickness: 0.1 })], { x: 3, y: 2 })!;
    expect(jog).toHaveLength(6);
  });

  it("add_room { fit } and update_room { fit } take the walls of the room's own level", async () => {
    for (const [ax, ay, bx, by] of [[0, 0, 5, 0], [5, 0, 5, 4], [5, 4, 0, 4], [0, 4, 0, 0]]) dispatch({ type: "add_wall", ax, ay, bx, by, thickness: 0.2 }, human);
    const r = await runTool("add_room", { fit: [2, 2], label: "Fitted" }, "agent");
    expect(r.ok).toBe(true);
    expect(roomArea(model().rooms[0])).toBeCloseTo(4.8 * 3.8, 6);
    expect(await runTool("add_room", { fit: [20, 2], label: "Nowhere" }, "agent")).toMatchObject({ ok: false, summary: expect.stringMatching(/No walls/) });
    expect(await runTool("add_room", { fit: [2, 2], x: 0, label: "Both" }, "agent")).toMatchObject({ ok: false });
    // another level's walls close nothing off here
    dispatch({ type: "add_level" }, human);
    expect(await runTool("add_room", { fit: [2, 2], label: "Upstairs", level: "First floor" }, "agent")).toMatchObject({ ok: false });
    const id = r.id as string;
    dispatch({ type: "update_room", id, patch: { points: rectOutline(1, 1, 1, 1) } }, human);
    expect((await runTool("update_room", { id, fit: true }, "agent")).ok).toBe(true);
    expect(roomArea(model().rooms[0])).toBeCloseTo(4.8 * 3.8, 6);
  });
});

describe("the checker on free shapes", () => {
  const box = [wall("n", 0, 0, 6, 0), wall("e", 6, 0, 6, 4), wall("s", 6, 4, 0, 4), wall("w", 0, 4, 0, 0)];

  it("a self-crossing room, a too-short edge, a bad outline", () => {
    const bow = room("bow", [{ x: 0.5, y: 0.5 }, { x: 3, y: 3 }, { x: 3, y: 0.5 }, { x: 0.5, y: 3 }]);
    expect(codes(plan({ walls: box, rooms: [bow] }))).toContain("room_self_intersecting");
    const nick = room("nick", [{ x: 0.1, y: 0.1 }, { x: 5, y: 0.1 }, { x: 5.02, y: 0.1 }, { x: 5.9, y: 3.9 }, { x: 0.1, y: 3.9 }]);
    expect(codes(plan({ walls: box, rooms: [nick] }))).toContain("room_edge_too_short");
    const two = room("two", [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(codes(plan({ walls: box, rooms: [two] }))).toContain("room_outline_invalid");
    const narrow = room("narrow", [{ x: 0.1, y: 0.1 }, { x: 5.9, y: 0.1 }, { x: 5.9, y: 0.4 }, { x: 0.1, y: 0.4 }]);
    expect(codes(plan({ walls: box, rooms: [narrow] }))).toContain("room_too_small");
  });

  it("rooms overlapping by area, an L and the rectangle in its notch touching only", () => {
    const l = room("l", [{ x: 0.1, y: 0.1 }, { x: 5.9, y: 0.1 }, { x: 5.9, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3.9 }, { x: 0.1, y: 3.9 }]);
    const notch = room("notch", rectOutline(3, 2, 2.9, 1.9));
    expect(codes(plan({ walls: box, rooms: [l, notch] }))).not.toContain("rooms_overlap");
    const over = room("over", rectOutline(2.5, 1.5, 2, 2));
    const found = checkModel(plan({ walls: box, rooms: [l, over] })).find((i) => i.code === "rooms_overlap");
    expect(found?.message).toMatch(/m² shared/);
  });

  it("a curved wall bent too tight, an opening too wide for its arc, and one past the arc's end", () => {
    const tight = wall("tight", 0, 0, 0.3, 0, { bulge: 1, thickness: 0.3 });
    expect(codes(plan({ walls: [tight] }))).toContain("wall_arc_too_tight");
    const arc = wall("arc", 0, 0, 2, 0, { bulge: 1, thickness: 0.1 });
    const wide = { id: "win", kind: "window" as const, wallId: "arc", t: 0.5, width: 2, sill: 0.9, height: 1.2 };
    expect(codes(plan({ walls: [arc], openings: [wide] }))).toContain("opening_too_wide_for_arc");
    const past = { ...wide, width: 0.3, t: 0.99 };
    expect(codes(plan({ walls: [arc], openings: [past] }))).toContain("opening_overflow");
  });

  it("curved walls crossing, and a straight one ending on an arc's span joined to it", () => {
    const a = wall("a", 0, 0, 6, 0, { bulge: 0.3 });
    const across = wall("x", 3, -3, 3, 3);
    expect(codes(plan({ walls: [a, across] }))).toContain("walls_cross");
    const stem = wall("stem", 3, wallPointAt(a, 0.5).y, 3, 3);
    const c = codes(plan({ walls: [a, stem] }));
    expect(c).not.toContain("walls_cross");
    // its end on the arc is joined: the only loose ends are the others
    expect(checkModel(plan({ walls: [a, stem] })).filter((i) => i.code === "wall_loose_end" && i.refs[0] === "stem")).toHaveLength(1);
  });

  it("furniture through a curved wall, and outside a shaped room", () => {
    const facade = wall("facade", 0, 0, 6, 0, { bulge: 0.3 });
    const peak = wallPointAt(facade, 0.5);
    const sofa = { id: "sofa", levelId: G, kind: "sofa", x: peak.x, y: peak.y, rotation: 0 };
    expect(codes(plan({ walls: [facade], items: [sofa] }))).toContain("item_through_wall");
    // beside the arc's middle, clear of its chord's rectangle but in its band: still through it
    const l = room("l", [{ x: 0.1, y: 0.1 }, { x: 5.9, y: 0.1 }, { x: 5.9, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3.9 }, { x: 0.1, y: 3.9 }]);
    const inNotch = { id: "plant", levelId: G, kind: "plant", x: 4.5, y: 3, rotation: 0 };
    expect(codes(plan({ walls: box, rooms: [l], items: [inNotch] }))).toContain("item_outside_rooms");
    const inL = { ...inNotch, x: 1.5, y: 3 };
    expect(codes(plan({ walls: box, rooms: [l], items: [inL] }))).not.toContain("item_outside_rooms");
  });

  it("the demo plans are still clean, and their floors cover what they did", () => {
    expect(checkModel(seedLoft())).toEqual([]);
    expect(checkModel(seedTownhouse())).toEqual([]);
    // a room fitted to four walls, and the walls mitred round it: the slab is the shell to the walls' outer faces
    const shell = plan({ walls: box, rooms: [room("in", enclosedOutline(box, { x: 3, y: 2 })!)] });
    expect(piecesArea(regionPieces(slabOutline(shell)))).toBeCloseTo(6.2 * 4.2, 6);
    // and a curved shell, its floor under the arc too
    const curved = [{ ...box[0], bulge: 0.2 }, ...box.slice(1)];
    const inside = enclosedOutline(curved, { x: 3, y: 2 })!;
    const floor = piecesArea(regionPieces(slabOutline(plan({ walls: curved, rooms: [room("in", inside)] }))));
    expect(floor).toBeGreaterThan(6.2 * 4.2);
  });
});

describe("the tools on free shapes", () => {
  it("add_wall's curve and get_model's arc and length", async () => {
    const r = await runTool("add_wall", { ax: 0, ay: 0, bx: 4, by: 0, curve: { through: [2, -1] } }, "agent");
    expect(r.ok).toBe(true);
    const m = await runTool("get_model", {}, "agent");
    const w = (m.model as { walls: { bulge: number; length: number; arc: { radius: number; sagitta: number } }[] }).walls[0];
    expect(w.bulge).toBeCloseTo(0.5);
    expect(w.arc.sagitta).toBeCloseTo(1);
    expect(w.arc.radius).toBeCloseTo(2.5);
    expect(w.length).toBeCloseTo(wallLength(model().walls[0]), 3);
    expect((await runTool("edit_wall", { id: r.id as string, curve: { sagitta: 0 } }, "agent")).ok).toBe(true);
    expect(model().walls[0].bulge).toBeUndefined();
  });

  it("add_room by points and arcs, by fit, or as a rectangle; get_model gives area, perimeter, anchor", async () => {
    const r = await runTool("add_room", { points: [[0, 0], [4, 0], [4, 3], [0, 3]], arcs: [{ edge: 0, sagitta: 1 }], label: "Bay" }, "agent");
    expect(r.ok).toBe(true);
    expect(r.area as number).toBeGreaterThan(12);
    expect((await runTool("add_room", { x: 6, y: 0, w: 2, h: 2, label: "Box" }, "agent")).ok).toBe(true);
    const m = await runTool("get_model", {}, "agent");
    const rooms = (m.model as { rooms: { label: string; area: number; perimeter: number; anchor: { x: number }; rect?: unknown }[] }).rooms;
    const bay = rooms.find((x) => x.label === "Bay")!;
    expect(bay.area).toBeCloseTo(r.area as number, 3);
    expect(bay.rect).toBeUndefined();
    expect(bay.perimeter).toBeGreaterThan(14);
    expect(rooms.find((x) => x.label === "Box")!.rect).toEqual({ x: 6, y: 0, w: 2, h: 2 });
    expect(await runTool("add_room", { arcs: [{ edge: 0, sagitta: 1 }], label: "No corners" }, "agent")).toMatchObject({ ok: false });
    expect(await runTool("add_room", { points: [[0, 0], [1, 0]], label: "Two" }, "agent")).toMatchObject({ ok: false });
  });

  it("update_room reshapes by points", async () => {
    await runTool("add_room", { x: 0, y: 0, w: 3, h: 3, label: "Den" }, "agent");
    const r = await runTool("update_room", { id: "Den", points: [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]] }, "agent");
    expect(r.ok).toBe(true);
    expect(roomArea(model().rooms[0])).toBeCloseTo(14);
  });

  it("the selected-wall tool extends a curved wall along its arc", async () => {
    const id = (await runTool("add_wall", { ax: 0, ay: 0, bx: 4, by: 0, curve: { sagitta: 0.8 } }, "agent")).id as string;
    actions.selectWall(id);
    const before = wallLength(model().walls[0]);
    expect((await runTool("extend_selected_wall", { meters: 1, end: "b" }, "agent")).ok).toBe(true);
    // its end lands on the grid, so the length is close to, not exactly, one metre more
    expect(wallLength(model().walls[0])).toBeCloseTo(before + 1, 1);
    expect(model().walls[0].bulge).toBeGreaterThan(0.3);
  });

  it("a room's limits are the published ones", () => {
    expect(ROOM_SHAPE.vertices.min).toBe(3);
  });
});
