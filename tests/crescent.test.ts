/**
 * The free-shapes demo, "Crescent House" (model/demoCrescent.ts): two storeys, a curved facade,
 * a wing turned 30° off the house, an L-shaped kitchen, a roof terrace and a stair — clean under
 * every rule, and loadable like any plan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID } from "../src/model/demoCrescent";
import { checkModel } from "../src/model/issues";
import { dispatch } from "../src/model/commands";
import { store } from "../src/model/store";
import { migratePlan } from "../src/model/planFormat";
import { isCurved, outlineRect, outlineSelfIntersection, pointInOutline, roomArea, wallPointAt } from "../src/model/shapes";
import { planRangeErrors } from "../src/model/planRanges";
import { levelSlice, stairGeometryIn } from "../src/model/levels";
import { placeOf } from "../src/model/places";
import { centreOf } from "../src/ui/activity/entities";
import { wallPlace } from "../src/ui/inspector/entities";
import { cornersOf, targetShapes } from "../src/ui/approvals/describe";
import type { PendingApproval } from "../src/model/types";
import { resetStore } from "./support/store";

beforeEach(resetStore);

describe("Crescent House", () => {
  it("has 0 issues on either storey", () => {
    expect(checkModel(seedCrescent())).toEqual([]);
  });

  it("is two storeys of free shapes: a curved facade on both, an angled wing, an L kitchen, a polygon terrace", () => {
    const m = seedCrescent();
    expect(m.levels.map((l) => l.id)).toEqual(["level_ground", CRESCENT_FIRST_LEVEL_ID]);
    expect(m.walls.filter(isCurved).map((w) => w.levelId).sort()).toEqual([CRESCENT_FIRST_LEVEL_ID, "level_ground"].sort());
    const room = (label: string) => m.rooms.find((r) => r.label === label)!;
    // the living room's floor follows the facade's arc; the kitchen is an L of six corners
    expect(room("Living").points.some((p) => p.bulge !== undefined)).toBe(true);
    expect(room("Kitchen").points).toHaveLength(6);
    expect(outlineRect(room("Guest room").points)).toBeNull();
    expect(outlineRect(room("Roof terrace").points)).toBeNull();
    for (const r of m.rooms) {
      expect(outlineSelfIntersection(r.points)).toBeNull();
      expect(roomArea(r)).toBeGreaterThan(2);
    }
    // every piece stands in a room of its level
    for (const it of m.items) expect(m.rooms.some((r) => r.levelId === it.levelId && pointInOutline(it, r.points))).toBe(true);
    // the stair climbs from the hall to the landing
    const g = stairGeometryIn(m, m.stairs[0])!;
    expect(pointInOutline(g.end, room("Landing").points)).toBe(true);
  });

  it("keeps to every range, survives a save and loads as itself", () => {
    const m = seedCrescent();
    expect(planRangeErrors(m)).toEqual([]);
    const saved = JSON.parse(JSON.stringify(m));
    const back = migratePlan(saved);
    expect(back.ok && back.model).toEqual(m);
    expect(dispatch({ type: "load_model", model: saved }, { actor: "human" }).ok).toBe(true);
    expect(store.getState().model.name).toBe("Crescent House");
  });
});

describe("the Crescent House's curved facade, wherever the page points at it", () => {
  const m = seedCrescent();
  const facade = m.walls.find((w) => w.id === "g_facade")!;
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  it("a feed link brings the wall and its door into view where they are, along the arc, as placeOf says", () => {
    for (const ref of [{ type: "wall", id: "g_facade" }, { type: "wall", id: "f_facade" }, { type: "door", id: "g_door_garden" }, { type: "window", id: "g_win_facade_w" }] as const) {
      const centre = centreOf(m, ref)!;
      const place = placeOf(m, ref.id)!;
      expect(dist(centre, place), ref.id).toBeLessThan(1e-9);
    }
    // the facade's middle is on its arc: its sagitta off the chord's middle, not on the chord
    expect(dist(centreOf(m, { type: "wall", id: "g_facade" })!, wallPointAt(facade, 0.5))).toBeLessThan(1e-9);
  });

  it("names the room the facade runs along in the wall's properties", () => {
    // read from the whole plan, as Properties reads it: the room above is on another storey
    expect(wallPlace(m, facade)).toBe("Along Living");
    const upper = m.walls.find((w) => w.id === "f_facade")!;
    expect(wallPlace(m, upper)).toBe("Along Main bedroom");
    expect(wallPlace(levelSlice(m, upper.levelId), upper)).toBe("Along Main bedroom");
  });

  it("frames an approval on the facade round its whole arc, and one on its door where the door is", () => {
    const pending = (targets: PendingApproval["targets"]): PendingApproval => ({ id: "a", tool: "remove_wall", actor: "agent", request: "", targets, effects: [], at: 0 });
    const wallCorners = targetShapes(pending([{ type: "wall", id: "g_facade", label: "" }]), m).flatMap(cornersOf);
    const ys = wallCorners.map((p) => p.y);
    // the arc's middle bows HOUSE.facadeSagitta past the chord: the frame reaches it, both faces
    const bow = wallPointAt(facade, 0.5);
    // (to within the facets the arc is cut into: ARC_TESSELLATION keeps them under 2 mm off it)
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(bow.y + facade.thickness / 2 - 2e-3);
    // where the chord alone would stop short by the whole bow
    expect(Math.max(...ys) - Math.max(facade.ay, facade.by)).toBeGreaterThan(1);
    const doorCorners = targetShapes(pending([{ type: "door", id: "g_door_garden", label: "" }]), m).flatMap(cornersOf);
    const mid = { x: doorCorners.reduce((s, p) => s + p.x, 0) / doorCorners.length, y: doorCorners.reduce((s, p) => s + p.y, 0) / doorCorners.length };
    expect(dist(mid, placeOf(m, "g_door_garden")!)).toBeLessThan(0.05);
  });
});
