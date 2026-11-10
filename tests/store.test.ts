/**
 * Characterisation of the shared actions the UI and the tools both call: walls, openings and
 * undo. These pin today's correct behaviour so later refactors of the store have a baseline.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store, UNDO_DEPTH } from "../src/model/store";
import { SNAP } from "../src/model/limits";
import { resetStore } from "./support/store";

const model = () => store.getState().model;
const undoDepth = () => store.getState().undoStack.length;

beforeEach(resetStore);

describe("addWall", () => {
  it("adds a wall with the default thickness and height and reports its length", () => {
    const r = actions.addWall(0, 0, 4, 0);
    expect(r.ok).toBe(true);
    expect(r.length).toBeCloseTo(4);
    expect(model().walls).toEqual([{ id: r.id, ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 }]);
  });

  it("keeps an explicit thickness and height", () => {
    const r = actions.addWall(0, 0, 3, 0, 0.1, 3);
    const wall = model().walls.find((w) => w.id === r.id)!;
    expect(wall.thickness).toBe(0.1);
    expect(wall.height).toBe(3);
  });

  it("snaps endpoints to the grid", () => {
    actions.addWall(0.01, 0.02, 2.98, 1.03);
    const [w] = model().walls;
    for (const v of [w.ax, w.ay, w.bx, w.by]) {
      expect(Math.abs(v / SNAP - Math.round(v / SNAP))).toBeLessThan(1e-9);
    }
    expect(w.bx).toBeCloseTo(3);
    expect(w.by).toBeCloseTo(1.05);
  });

  it("rejects a wall shorter than 20 cm without touching the model or the undo stack", () => {
    const before = model();
    const r = actions.addWall(0, 0, 0.1, 0);
    expect(r.ok).toBe(false);
    expect(model()).toBe(before);
    expect(undoDepth()).toBe(0);
  });

  it("gives every wall its own id", () => {
    const a = actions.addWall(0, 0, 4, 0);
    const b = actions.addWall(0, 0, 0, 4);
    expect(a.id).not.toBe(b.id);
    expect(model().walls).toHaveLength(2);
  });
});

describe("addOpening", () => {
  let wallId: string;
  beforeEach(() => {
    wallId = actions.addWall(0, 0, 4, 0).id as string;
  });

  it("adds a door with the default size and swing", () => {
    const r = actions.addOpening("door", wallId, 0.5);
    expect(r.ok).toBe(true);
    expect(model().openings).toEqual([
      { id: r.id, kind: "door", wallId, t: 0.5, width: 0.9, sill: 0, height: 2.1, hinge: "a", side: "right" },
    ]);
  });

  it("adds a window with the default size and sill and no swing", () => {
    const r = actions.addOpening("window", wallId, 0.5);
    expect(r.ok).toBe(true);
    const o = model().openings[0];
    expect(o).toMatchObject({ kind: "window", width: 1.2, sill: 0.9, height: 1.2 });
    expect(o.hinge).toBeUndefined();
    expect(o.side).toBeUndefined();
  });

  it("honours an explicit swing", () => {
    actions.addOpening("door", wallId, 0.5, undefined, undefined, undefined, { hinge: "b", side: "left" });
    expect(model().openings[0]).toMatchObject({ hinge: "b", side: "left" });
  });

  it("clamps t so the opening stays inside its wall", () => {
    const r = actions.addOpening("door", wallId, 0);
    expect(r.ok).toBe(true);
    // half the 0.9 m door on a 4 m wall
    expect(r.t).toBeCloseTo(0.45 / 4);
    expect(r.summary).toMatch(/clamped/);
  });

  it("rejects an opening wider than its wall", () => {
    const r = actions.addOpening("window", wallId, 0.5, 5);
    expect(r.ok).toBe(false);
    expect(model().openings).toHaveLength(0);
  });

  it("rejects an opening taller than its wall", () => {
    const r = actions.addOpening("window", wallId, 0.5, 1, 2, 1);
    expect(r.ok).toBe(false);
    expect(model().openings).toHaveLength(0);
  });

  it("fails on an unknown wall", () => {
    const r = actions.addOpening("door", "no_such_wall", 0.5);
    expect(r.ok).toBe(false);
    expect(model().openings).toHaveLength(0);
  });

  it("removing the wall removes its openings", () => {
    actions.addOpening("door", wallId, 0.5);
    actions.removeWall(wallId);
    expect(model().walls).toHaveLength(0);
    expect(model().openings).toHaveLength(0);
  });
});

describe("undo", () => {
  it("has nothing to undo on a fresh store", () => {
    expect(actions.undo()).toMatchObject({ ok: false });
  });

  it("reverts the last change", () => {
    actions.addWall(0, 0, 4, 0);
    actions.addWall(0, 0, 0, 4);
    expect(actions.undo().ok).toBe(true);
    expect(model().walls).toHaveLength(1);
    expect(actions.undo().ok).toBe(true);
    expect(model().walls).toHaveLength(0);
    expect(actions.undo().ok).toBe(false);
  });

  it("brings back a removed wall together with its openings", () => {
    const wallId = actions.addWall(0, 0, 4, 0).id as string;
    actions.addOpening("door", wallId, 0.5);
    const before = model();
    actions.removeWall(wallId);
    actions.undo();
    expect(model()).toEqual(before);
  });

  it("restores a cleared plan", () => {
    actions.addWall(0, 0, 4, 0);
    actions.setPlanName("Kept");
    const before = model();
    actions.clearModel();
    expect(model().walls).toHaveLength(0);
    actions.undo();
    expect(model()).toEqual(before);
  });

  it("a step holds the plan object it was taken from, which later edits never change", () => {
    // the model is replaced, never edited in place, so the step can keep the object itself
    actions.addWall(0, 0, 4, 0);
    const before = model();
    const asItWas = structuredClone(before);
    actions.addWall(4, 0, 4, 3);
    const step = store.getState().undoStack.at(-1)!;
    expect(step.model).toBe(before);
    actions.editWall(before.walls[0].id, { ax: 1 });
    actions.removeWall(before.walls[0].id);
    expect(step.model).toEqual(asItWas);
  });

  it(`keeps at most ${UNDO_DEPTH} steps, dropping the oldest`, () => {
    for (let i = 0; i < UNDO_DEPTH + 5; i++) actions.setPlanName(`name ${i}`);
    expect(undoDepth()).toBe(UNDO_DEPTH);
    for (let i = 0; i < UNDO_DEPTH; i++) actions.undo();
    // the five oldest snapshots fell off, so the furthest back is the fifth rename
    expect(model().name).toBe("name 4");
    expect(actions.undo().ok).toBe(false);
  });
});
