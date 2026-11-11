/**
 * Domain invariants enforced by the store actions themselves. The UI calls these directly,
 * with no schema in front, so every action must refuse what the model cannot hold — and
 * refusing must leave the model, the undo stack and the notes exactly as they were.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store, type ActionResult, type RoomPatch, type WallPatch } from "../src/model/store";
import { executeWrapped, type ToolDef } from "../src/mcp/registry";
import { TOOLS } from "../src/mcp/tools";
import { SUPPLIER_KIND_PREFIX, catalogOf, customKindCount, supplierKind } from "../src/model/catalog";
import { snap } from "../src/model/geometry";
import {
  COORD,
  DOOR_DEFAULTS,
  FLOOR_FINISHES,
  FURNITURE_DIM,
  MAX_CUSTOM_KINDS,
  MAX_NOTES,
  MAX_PARTS,
  MAX_PENDING_APPROVALS,
  OPENING_WIDTH,
  ROOM_SIZE,
  ROTATION,
  SNAP,
  TEXT,
  UNDERLAY,
  UNDERLAY_SIZE,
  WALL_DEFAULTS,
  WALL_HEIGHT,
  WALL_MIN_LENGTH,
  WALL_THICKNESS,
  WINDOW_DEFAULTS,
  rangeError,
  within,
} from "../src/model/limits";
import { checkModel } from "../src/model/issues";
import { z } from "zod";
import { flush, heldImage, kindOf, resetStore } from "./support/store";
import type { Underlay } from "../src/model/types";
import { outlineBounds, rectOutline } from "../src/model/shapes";

beforeEach(resetStore);

const state = () => {
  const s = store.getState();
  return { model: s.model, undo: s.undoStack.length, notes: s.notes };
};

/** Run `act`, expect a refusal, and expect nothing to have changed. */
function expectRefused(act: () => ActionResult, message?: RegExp): void {
  const before = state();
  const r = act();
  expect(r.ok).toBe(false);
  if (message) expect(r.summary).toMatch(message);
  expect(state()).toEqual(before);
  expect(store.getState().model).toBe(before.model);
}

const tool = (name: string): ToolDef => TOOLS.find((t) => t.name === name)!;
const bad = [NaN, Infinity, -Infinity, "3" as unknown as number, null as unknown as number];

describe("limits helpers", () => {
  it("within accepts only finite numbers inside the range", () => {
    expect(within(0.15, WALL_THICKNESS)).toBe(true);
    for (const v of [...bad, -1, 2, undefined]) expect(within(v, WALL_THICKNESS)).toBe(false);
  });

  it("rangeError says what was expected and what arrived", () => {
    expect(rangeError("thickness", -5, WALL_THICKNESS)).toBe(
      `thickness must be a finite number from ${WALL_THICKNESS.min} to ${WALL_THICKNESS.max} m (got -5).`,
    );
    expect(rangeError("thickness", 0.15, WALL_THICKNESS)).toBeNull();
  });

  it("every default sits inside its own range", () => {
    expect(within(WALL_DEFAULTS.thickness, WALL_THICKNESS)).toBe(true);
    expect(within(WALL_DEFAULTS.height, WALL_HEIGHT)).toBe(true);
    for (const d of [DOOR_DEFAULTS, WINDOW_DEFAULTS]) {
      expect(within(d.width, OPENING_WIDTH)).toBe(true);
      expect(d.sill + d.height).toBeLessThanOrEqual(WALL_DEFAULTS.height);
    }
  });
});

describe("walls", () => {
  it.each(bad)("addWall refuses a coordinate of %s", (v) => {
    expectRefused(() => actions.addWall(v, 0, 4, 0), /ax must be a finite number/);
  });

  it.each([-5, 0, WALL_THICKNESS.max + 0.01, NaN])("addWall refuses thickness %s", (v) => {
    expectRefused(() => actions.addWall(0, 0, 4, 0, v), /thickness/);
  });

  it.each([1e9, WALL_HEIGHT.min - 0.01, Infinity])("addWall refuses height %s", (v) => {
    expectRefused(() => actions.addWall(0, 0, 4, 0, undefined, v), /height/);
  });

  it("addWall refuses a coordinate beyond the plan extent", () => {
    expectRefused(() => actions.addWall(0, 0, COORD.max + 1, 0), /bx/);
  });

  it("editWall refuses a non-finite patch and keeps the wall", () => {
    const id = actions.addWall(0, 0, 4, 0).id as string;
    expectRefused(() => actions.editWall(id, { thickness: NaN }));
    expectRefused(() => actions.editWall(id, { bx: Infinity }));
    expectRefused(() => actions.editWall(id, { height: -1 }));
  });

  it("editWall copies only geometry: an id in the patch cannot replace the wall's id", () => {
    const id = actions.addWall(0, 0, 4, 0).id as string;
    const r = actions.editWall(id, { id: "hijacked", thickness: 0.2 } as WallPatch);
    expect(r.ok).toBe(true);
    expect(store.getState().model.walls[0]).toMatchObject({ id, thickness: 0.2 });
  });

  it("the checker and the action share the minimum wall length", () => {
    expectRefused(() => actions.addWall(0, 0, WALL_MIN_LENGTH / 2, 0), /too short/);
  });
});

describe("openings", () => {
  let wallId: string;
  beforeEach(() => {
    wallId = actions.addWall(0, 0, 4, 0).id as string;
  });

  it.each([NaN, -0.1, 1.5, Infinity])("addOpening refuses t = %s", (t) => {
    expectRefused(() => actions.addOpening("door", wallId, t), /t must be/);
  });

  it.each([0, -1, NaN, OPENING_WIDTH.max + 1])("addOpening refuses width %s", (w) => {
    expectRefused(() => actions.addOpening("window", wallId, 0.5, w), /width/);
  });

  it("addOpening refuses a negative sill and an unknown swing", () => {
    expectRefused(() => actions.addOpening("window", wallId, 0.5, 1, -0.5), /sill/);
    expectRefused(() => actions.addOpening("door", wallId, 0.5, undefined, undefined, undefined, { hinge: "c" as "a" }), /hinge/);
  });

  it("moveOpening refuses a non-finite t", () => {
    const id = actions.addOpening("door", wallId, 0.5).id as string;
    expectRefused(() => actions.moveOpening(id, NaN));
  });
});

describe("rooms", () => {
  it.each([
    ["an infinite width", () => actions.addRoom({ x: 0, y: 0, w: Infinity, h: 3, label: "R" })],
    ["a NaN corner", () => actions.addRoom({ x: NaN, y: 0, w: 3, h: 3, label: "R" })],
    ["a size below the minimum", () => actions.addRoom({ x: 0, y: 0, w: ROOM_SIZE.min / 2, h: 3, label: "R" })],
    ["an empty label", () => actions.addRoom({ x: 0, y: 0, w: 3, h: 3, label: "  " })],
    ["an over-long label", () => actions.addRoom({ x: 0, y: 0, w: 3, h: 3, label: "x".repeat(TEXT.label + 1) })],
  ])("addRoom refuses %s", (_, act) => {
    expectRefused(act);
  });

  it("updateRoom refuses an invalid size and keeps the room", () => {
    const id = actions.addRoom({ x: 0, y: 0, w: 3, h: 3, label: "Bedroom" }).id as string;
    expectRefused(() => actions.updateRoom(id, { w: NaN }));
    expectRefused(() => actions.updateRoom(id, { h: -2 }));
    expectRefused(() => actions.updateRoom(id, { label: "" }));
  });

  it("the checker and the action share the minimum room size", () => {
    const issues = checkModel({ ...store.getState().model, rooms: [{ id: "r", levelId: "level_ground", points: rectOutline(0, 0, ROOM_SIZE.min / 2, 1), label: "R", floor: "oak" }] });
    expect(issues.some((i) => i.code === "room_too_small")).toBe(true);
  });
});

describe("A1 — update_room never overwrites a room's id", () => {
  it("update_room { id: 'bedroom', label: 'Main' } keeps the room's real id", async () => {
    const realId = actions.addRoom({ x: 0, y: 0, w: 4, h: 3, label: "Bedroom" }).id as string;
    const r = await executeWrapped(tool("update_room"), { id: "bedroom", label: "Main" });
    expect(r.ok).toBe(true);
    const rooms = store.getState().model.rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ id: realId, label: "Main", points: rectOutline(0, 0, 4, 3) });
  });

  it("the store action itself ignores keys outside the patch list", () => {
    const realId = actions.addRoom({ x: 0, y: 0, w: 4, h: 3, label: "Bedroom" }).id as string;
    actions.updateRoom(realId, { id: "hijacked", label: "Main" } as RoomPatch);
    expect(store.getState().model.rooms[0].id).toBe(realId);
  });

  it("an absent field is left alone rather than set to undefined", () => {
    const realId = actions.addRoom({ x: 0, y: 0, w: 4, h: 3, label: "Bedroom" }).id as string;
    actions.updateRoom(realId, { w: undefined, label: "Main" });
    expect(outlineBounds(store.getState().model.rooms[0].points).w).toBe(4);
  });
});

describe("furniture", () => {
  it.each([NaN, Infinity, ROTATION.max + 1])("placeItem refuses rotation %s", (rot) => {
    expectRefused(() => actions.placeItem("sofa", 1, 1, rot), /rotation/);
  });

  it("placeItem and moveItem refuse non-finite positions", () => {
    expectRefused(() => actions.placeItem("sofa", NaN, 1));
    const id = actions.placeItem("sofa", 1, 1).id as string;
    expectRefused(() => actions.moveItem(id, Infinity));
    expectRefused(() => actions.moveItem(id, undefined, undefined, NaN));
  });

  it("defineItemKind refuses out-of-range dimensions, bad colours and too many parts", () => {
    const base = { kind: "test_piano", label: "Piano", w: 1.5, d: 0.6, h: 1 };
    expect(actions.defineItemKind({ ...base, w: FURNITURE_DIM.max * 10 }).ok).toBe(false);
    expect(actions.defineItemKind({ ...base, h: NaN }).ok).toBe(false);
    expect(actions.defineItemKind({ ...base, color: "red" }).ok).toBe(false);
    expect(actions.defineItemKind({ ...base, label: "x".repeat(TEXT.label + 1) }).ok).toBe(false);
    expect(actions.defineItemKind({ ...base, kind: "k".repeat(TEXT.kind + 1) }).ok).toBe(false);
    const parts = Array.from({ length: MAX_PARTS + 1 }, () => ({ shape: "box" as const }));
    expect(actions.defineItemKind({ ...base, parts }).ok).toBe(false);
    expect(actions.defineItemKind({ ...base, parts: [{ w: Infinity }] }).ok).toBe(false);
    expect(kindOf("test_piano")).toBeUndefined();
  });

  it("defineItemKind still accepts a well-formed piece", () => {
    const r = actions.defineItemKind({ kind: "test_island", label: "Island", w: 2, d: 1, h: 0.9, parts: [{ shape: "box", w: 2, h: 0.9, d: 1 }] });
    expect(r.ok).toBe(true);
    expect(kindOf("test_island")).toMatchObject({ w: 2, d: 1, h: 0.9 });
  });
});

describe("underlay", () => {
  let underlay: Underlay;
  beforeEach(() => {
    underlay = { assetId: heldImage(), opacity: 0.5, x: 0, y: 0, w: 8, h: 6, pw: 800, ph: 600 };
  });

  it("setUnderlay refuses an opacity out of 0..1, an image the page does not hold, a non-image or an empty rect", () => {
    expectRefused(() => actions.setUnderlay({ ...underlay, opacity: 2 }), /opacity/);
    expectRefused(() => actions.setUnderlay({ ...underlay, assetId: "https://example.com/plan.png" }), /assetId/);
    expectRefused(() => actions.setUnderlay({ ...underlay, assetId: heldImage(4, "text/html") }), /not an image/);
    expectRefused(() => actions.setUnderlay({ ...underlay, assetId: heldImage(UNDERLAY.maxStoredBytes + 1) }), /too large/);
    expectRefused(() => actions.setUnderlay({ ...underlay, w: 0 }), /w must be/);
    expectRefused(() => actions.setUnderlay({ ...underlay, h: NaN }));
  });

  it("calibrateUnderlay refuses non-finite or out-of-range numbers", () => {
    expect(actions.setUnderlay(underlay).ok).toBe(true);
    expectRefused(() => actions.calibrateUnderlay(0, 0, 1, 0, NaN), /meters/);
    expectRefused(() => actions.calibrateUnderlay(0, 0, 1, 0, -3), /meters/);
    expectRefused(() => actions.calibrateUnderlay(0, 0, 1.5, 0, 3), /u2/);
    expectRefused(() => actions.calibrateUnderlay(0, 0, 1, 0, 3, 7), /opacity/);
    expect(actions.calibrateUnderlay(0, 0, 1, 0, 10).ok).toBe(true);
    expect(store.getState().model.underlay?.w).toBeCloseTo(10);
  });
});

describe("text and resource limits", () => {
  it("setPlanName refuses an over-long name but allows an empty one mid-edit", () => {
    expectRefused(() => actions.setPlanName("x".repeat(TEXT.planName + 1)), /max/);
    expect(actions.setPlanName("").ok).toBe(true);
  });

  it("leaveNote refuses empty or over-long text", () => {
    expectRefused(() => actions.leaveNote("agent", "   "));
    expectRefused(() => actions.leaveNote("agent", "x".repeat(TEXT.note + 1)));
  });

  it(`keeps at most ${MAX_NOTES} notes`, () => {
    for (let i = 0; i < MAX_NOTES; i++) expect(actions.leaveNote("agent", `note ${i}`).ok).toBe(true);
    expectRefused(() => actions.leaveNote("agent", "one too many"), new RegExp(`${MAX_NOTES} notes`));
    expect(store.getState().notes).toHaveLength(MAX_NOTES);
  });

  it(`parks at most ${MAX_PENDING_APPROVALS} destructive calls and refuses the rest`, async () => {
    let ran = 0;
    const spy: ToolDef = {
      name: "spy_destroy",
      description: "test double",
      input: z.strictObject({}),
      annotations: { destructiveHint: true },
      resolve: (input) => ({ ok: true, input, request: "destroy the thing", targets: [], effects: [], entities: [] }),
      execute: () => {
        ran++;
        return { ok: true, summary: "destroyed" };
      },
    };
    const parked = Array.from({ length: MAX_PENDING_APPROVALS }, () => executeWrapped(spy, {}));
    await flush();
    expect(store.getState().approvals).toHaveLength(MAX_PENDING_APPROVALS);

    const extra = await executeWrapped(spy, {});
    expect(extra.ok).toBe(false);
    expect(extra.summary).toMatch(/too many requests are already waiting/);
    expect(store.getState().approvals).toHaveLength(MAX_PENDING_APPROVALS);

    for (const a of store.getState().approvals) actions.resolveApproval(a.id, false);
    await Promise.all(parked);
    expect(ran).toBe(0);
    expect(store.getState().approvals).toHaveLength(0);
  });
});

describe("rooms: one size rule for the action, the tool and the snap", () => {
  it("the minimum sits on the snap grid, so a size the range accepts never snaps below it", () => {
    expect(snap(ROOM_SIZE.min)).toBe(ROOM_SIZE.min);
    expect(snap(ROOM_SIZE.min + SNAP / 2 - 1e-9)).toBeGreaterThanOrEqual(ROOM_SIZE.min);
  });

  it("a size just under the minimum is refused by the action and by add_room alike", async () => {
    const under = ROOM_SIZE.min - SNAP / 2 + 0.005;
    expectRefused(() => actions.addRoom({ x: 0, y: 0, w: under, h: 3, label: "R" }), /w must be/);
    const r = await executeWrapped(tool("add_room"), { x: 0, y: 0, w: under, h: 3, label: "R" });
    expect(r.ok).toBe(false);
    expect(actions.addRoom({ x: 0, y: 0, w: ROOM_SIZE.min, h: ROOM_SIZE.min, label: "R" }).ok).toBe(true);
    expect((await executeWrapped(tool("add_room"), { x: 2, y: 0, w: ROOM_SIZE.min, h: 1, label: "S" })).ok).toBe(true);
  });

  it("only known floor finishes are stored", async () => {
    expectRefused(() => actions.addRoom({ x: 0, y: 0, w: 3, h: 3, label: "R", floor: "marble" }), /floor must be one of/);
    const id = actions.addRoom({ x: 0, y: 0, w: 3, h: 3, label: "R" }).id as string;
    expectRefused(() => actions.updateRoom(id, { floor: "marble" as never }), /floor/);
    expect((await executeWrapped(tool("add_room"), { x: 0, y: 4, w: 3, h: 3, label: "M", floor: "marble" })).ok).toBe(false);
    for (const floor of FLOOR_FINISHES) expect(actions.updateRoom(id, { floor }).ok).toBe(true);
  });
});

describe("underlay calibration keeps the underlay valid", () => {
  let underlay: Underlay;
  beforeEach(() => {
    underlay = { assetId: heldImage(), opacity: 0.5, x: 0, y: 0, w: 10, h: 10, pw: 800, ph: 800 };
  });

  it("refuses a calibration that would push the corner off the plan, and leaves the underlay alone", () => {
    expect(actions.setUnderlay(underlay).ok).toBe(true);
    // the size alone is acceptable; the corner lands at x = 10 - 2000
    expect(UNDERLAY_SIZE.max).toBeGreaterThanOrEqual(2000);
    expectRefused(() => actions.calibrateUnderlay(1, 0, 0, 0, 2000), /Calibration rejected.*x must be/);
    expect(store.getState().model.underlay).toEqual(underlay);
  });

  it("whatever calibration stores, setUnderlay (the opacity slider) still accepts", () => {
    expect(actions.setUnderlay(underlay).ok).toBe(true);
    for (const [u1, meters] of [[0.9, 1500], [0.5, 900], [0, 1999], [1, 990]] as const) {
      actions.calibrateUnderlay(u1, 0, 0, 0, meters);
      const now = store.getState().model.underlay!;
      expect(actions.setUnderlay({ ...now, opacity: 0.3 }).ok).toBe(true);
    }
  });
});

describe("custom kinds", () => {
  it("refuses ids in the supplier's namespace", () => {
    const spec = { label: "Fake", w: 1, d: 1, h: 1 };
    expect(actions.defineItemKind({ ...spec, kind: `${SUPPLIER_KIND_PREFIX}nk-sof-3s` }).ok).toBe(false);
    expect(actions.defineItemKind({ ...spec, kind: `${SUPPLIER_KIND_PREFIX.toUpperCase()}NK-SOF-3S` }).ok).toBe(false);
    expect(catalogOf(store.getState().model).entries.some((c) => c.kind.startsWith(SUPPLIER_KIND_PREFIX))).toBe(false);
  });

  it("maps a supplier sku to one kind whatever its case", () => {
    expect(supplierKind("nk-sof-3s")).toBe(supplierKind("NK-SOF-3S"));
  });

  it(`adds at most ${MAX_CUSTOM_KINDS} kinds, but still lets an existing one be redefined`, () => {
    const spec = { label: "Block", w: 1, d: 1, h: 1 };
    for (let i = customKindCount(store.getState().model); i < MAX_CUSTOM_KINDS; i++) {
      expect(actions.defineItemKind({ ...spec, kind: `cap_${i}` }).ok).toBe(true);
    }
    expect(customKindCount(store.getState().model)).toBe(MAX_CUSTOM_KINDS);
    const r = actions.defineItemKind({ ...spec, kind: "one_too_many" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(new RegExp(`${MAX_CUSTOM_KINDS} custom kinds`));
    expect(kindOf("one_too_many")).toBeUndefined();
    const last = catalogOf(store.getState().model).entries.at(-1)!.kind;
    expect(actions.defineItemKind({ ...spec, kind: last, w: 2 }).ok).toBe(true);
    expect(kindOf(last)?.w).toBe(2);
  });
});
