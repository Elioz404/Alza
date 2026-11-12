/**
 * The demo, "Crescent House" (model/demoCrescent.ts): a two-storey family house with a garage —
 * a curved glazed bay with a roof terrace over it, a stair hall, an enclosed garage, and a main
 * bedroom that projects over the drive on two columns, a covered parking bay under it. Clean under
 * every rule, sensible where a person would check it (the cars, the columns, the stair), and
 * loadable like any plan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID, CRESCENT_LANE_X } from "../src/model/demoCrescent";
import { checkModel, doorLeaves, driveInLanes, leafSweep, openingCenter, parkingClearance } from "../src/model/issues";
import { dispatch } from "../src/model/commands";
import { store } from "../src/model/store";
import { migratePlan } from "../src/model/planFormat";
import { catalogOf } from "../src/model/catalog";
import { isCurved, outlineRect, outlineSelfIntersection, pointInOutline, roomArea, wallPointAt } from "../src/model/shapes";
import { boxOf, rectCorners, type ORect } from "../src/model/geometry";
import { sharedArea } from "../src/model/region";
import { planRangeErrors } from "../src/model/planRanges";
import { levelSlice, stairGeometryIn } from "../src/model/levels";
import { placeOf } from "../src/model/places";
import { PARKING, STAIR } from "../src/model/limits";
import { centreOf } from "../src/ui/activity/entities";
import { wallPlace } from "../src/ui/inspector/entities";
import { cornersOf, targetShapes } from "../src/ui/approvals/describe";
import type { PendingApproval, PlanModel } from "../src/model/types";
import { resetStore } from "./support/store";

beforeEach(resetStore);

const G = "level_ground";
const room = (m: PlanModel, label: string) => m.rooms.find((r) => r.label === label)!;
const itemRect = (m: PlanModel, id: string): ORect => {
  const it = m.items.find((i) => i.id === id)!;
  const def = catalogOf(m).get(it.kind)!;
  return { cx: it.x, cy: it.y, hw: def.w / 2, hd: def.d / 2, rot: (-it.rotation * Math.PI) / 180 };
};

describe("Crescent House", () => {
  it("has 0 issues on either storey", () => {
    expect(checkModel(seedCrescent())).toEqual([]);
  });

  it("is two storeys of rooms fitted to their walls: a curved bay on both, rooms with more than four corners", () => {
    const m = seedCrescent();
    expect(m.levels.map((l) => l.id)).toEqual([G, CRESCENT_FIRST_LEVEL_ID]);
    // the bay downstairs and the roof terrace's parapet on it upstairs
    expect(m.walls.filter(isCurved).map((w) => w.id).sort()).toEqual(["f_facade", "g_facade"]);
    // the living room's floor and the terrace's follow the arc; the hall and the landing are not rectangles
    expect(room(m, "Living").points.some((p) => p.bulge !== undefined)).toBe(true);
    expect(room(m, "Roof terrace").points.some((p) => p.bulge !== undefined)).toBe(true);
    expect(room(m, "Hall").points.length).toBeGreaterThan(4);
    expect(outlineRect(room(m, "Hall").points)).toBeNull();
    expect(outlineRect(room(m, "Landing").points)).toBeNull();
    for (const r of m.rooms) {
      expect(outlineSelfIntersection(r.points), r.label).toBeNull();
      expect(roomArea(r), r.label).toBeGreaterThan(1.2);
    }
    // every piece stands in a room of its level
    for (const it of m.items) expect(m.rooms.some((r) => r.levelId === it.levelId && pointInOutline(it, r.points)), it.id).toBe(true);
  });

  it("has the rooms of a family house, sized as one", () => {
    const m = seedCrescent();
    const on = (levelId: string) => m.rooms.filter((r) => r.levelId === levelId).map((r) => r.label).sort();
    expect(on(G)).toEqual(["Coats", "Garage", "Hall", "Kitchen & dining", "Living", "Porch & carport", "Utility", "WC"]);
    expect(on(CRESCENT_FIRST_LEVEL_ID)).toEqual(["Bathroom", "Bedroom 2", "Bedroom 3", "En-suite", "Landing", "Linen", "Main bedroom", "Roof terrace", "Walk-in wardrobe"]);
    const area = (label: string) => roomArea(room(m, label));
    // an enclosed single garage, 3.3-3.6 by 5.8-6.2 m inside
    const g = outlineRect(room(m, "Garage").points)!;
    expect(Math.min(g.w, g.h)).toBeGreaterThanOrEqual(3.3);
    expect(Math.min(g.w, g.h)).toBeLessThanOrEqual(3.6);
    expect(Math.max(g.w, g.h)).toBeGreaterThanOrEqual(5.8);
    expect(Math.max(g.w, g.h)).toBeLessThanOrEqual(6.2);
    // the house's floor area on each storey, the garage, the porch and the terrace aside
    const net = (levelId: string) => m.rooms.filter((r) => r.levelId === levelId && r.kind !== "open" && !["Garage", "Roof terrace"].includes(r.label)).reduce((s, r) => s + roomArea(r), 0);
    expect(net(G)).toBeGreaterThan(100);
    expect(net(G)).toBeLessThan(120);
    expect(net(CRESCENT_FIRST_LEVEL_ID)).toBeLessThan(125);
    expect(area("Main bedroom")).toBeGreaterThan(20);
    expect(area("WC")).toBeGreaterThan(2.5);
    expect(area("Coats")).toBeGreaterThan(1.2);
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

describe("the Crescent House's stair", () => {
  const m = seedCrescent();
  const stair = m.stairs[0];
  const g = stairGeometryIn(m, stair)!;

  it("climbs from the hall to the landing within the stair rules, with headroom", () => {
    expect(pointInOutline(g.start, room(m, "Hall").points)).toBe(true);
    expect(pointInOutline(g.end, room(m, "Landing").points)).toBe(true);
    expect(g.riserHeight).toBeGreaterThanOrEqual(STAIR.riser.min);
    expect(g.riserHeight).toBeLessThanOrEqual(STAIR.riser.max);
    expect(g.going).toBeGreaterThanOrEqual(STAIR.tread.min);
    expect(g.going).toBeLessThanOrEqual(STAIR.tread.max);
    expect(g.stepRule).toBeGreaterThanOrEqual(STAIR.stepRule.min);
    expect(g.stepRule).toBeLessThanOrEqual(STAIR.stepRule.max);
    expect(g.headroom).toBeGreaterThanOrEqual(STAIR.headroom);
  });

  it("runs along the spine wall, and no door swings over it or its landings", () => {
    const spine = m.walls.find((w) => w.id === "g_spine")!;
    // its east edge is the spine's west face
    expect(stair.x + stair.width / 2).toBeCloseTo(spine.ax - spine.thickness / 2, 9);
    const stairFloor = [...g.footprint, g.bottomExit, g.topExit].map(rectCorners);
    for (const o of m.openings) {
      if (o.kind !== "door" || o.style === "garage") continue;
      const wall = m.walls.find((w) => w.id === o.wallId)!;
      if (wall.levelId !== stair.levelId && wall.levelId !== CRESCENT_FIRST_LEVEL_ID) continue;
      for (const leaf of doorLeaves(wall, o)) {
        // the stair's flight and foot on the ground, its head upstairs: each against the doors of its own floor
        const parts = wall.levelId === stair.levelId ? stairFloor.slice(0, -1) : stairFloor.slice(-1);
        for (const part of parts) expect(sharedArea(leafSweep(leaf), part), o.id).toBeLessThan(1e-6);
      }
    }
  });
});

describe("the Crescent House's cars and columns", () => {
  const m = seedCrescent();

  it("has both cars on one line with the garage door, each with a clear drive-in lane", () => {
    const lanes = driveInLanes(m);
    expect([...lanes.keys()].sort()).toEqual(["g_car", "g_car_bay"]);
    // the car in the garage comes in through the garage door, the one under the bedroom from the street
    expect(lanes.get("g_car")!.map((l) => l.exit)).toContainEqual({ through: "garage_door", door: "g_garage_door" });
    expect(lanes.get("g_car_bay")!.map((l) => l.exit)).toContainEqual({ through: "open_side" });
    const door = m.openings.find((o) => o.id === "g_garage_door")!;
    const front = m.walls.find((w) => w.id === door.wallId)!;
    expect(openingCenter(front, door).x).toBeCloseTo(CRESCENT_LANE_X, 9);
    for (const id of ["g_car", "g_car_bay"]) expect(m.items.find((i) => i.id === id)!.x).toBeCloseTo(CRESCENT_LANE_X, 9);
  });

  it("drives the lane between the two columns, wider than the lane and the car's clearance", () => {
    const [c1, c2] = m.columns;
    const clear = c2.x - c2.w / 2 - (c1.x + c1.w / 2);
    const zone = parkingClearance(itemRect(m, "g_car_bay"));
    expect(clear).toBeGreaterThan(2 * zone.hw);
    // neither column is in the lane, the car's clearance or a doorway: the checker is clean of them
    for (const c of m.columns) {
      expect(Math.abs(c.x - CRESCENT_LANE_X) - c.w / 2).toBeGreaterThan(1.8 / 2 + PARKING.side);
    }
  });

  it("parks the second car wholly under the bedroom's slab", () => {
    const slabEdge = m.walls.find((w) => w.id === "f_proj_s")!;
    const corners = rectCorners(itemRect(m, "g_car_bay"));
    const box = boxOf(corners);
    expect(box.maxY).toBeLessThanOrEqual(slabEdge.ay + slabEdge.thickness / 2 + 1e-9);
    expect(box.minY).toBeGreaterThanOrEqual(m.walls.find((w) => w.id === "g_front")!.ay);
  });

  it("is caught when a column is moved into the drive", () => {
    const [c1] = m.columns;
    const moved = { ...m, columns: m.columns.map((c) => (c.id === c1.id ? { ...c, x: CRESCENT_LANE_X, y: 19.3 } : c)) };
    const codes = checkModel(moved).map((i) => i.code);
    expect(codes).toContain("column_blocks_parking");
    expect(codes).toContain("item_hits_column");
  });

  it("shuts the garage's car in without its garage door", () => {
    const walled = { ...m, openings: m.openings.filter((o) => o.id !== "g_garage_door") };
    const found = checkModel(walled).filter((i) => i.code === "car_no_lane");
    expect(found.map((i) => i.refs[0])).toEqual(["g_car"]);
    expect(found[0].refs.slice(1).sort()).toEqual(["g_front", "g_garage_n"]);
  });

  it("parks the bay car in line on the garage car's drive: a tandem, the one in front driven out first", () => {
    const [lane] = driveInLanes(m).get("g_car")!;
    // the bay car stands on the drive past the garage door, the garage car's run-out, wholly inside its width
    const bay = boxOf(rectCorners(itemRect(m, "g_car_bay")));
    const runOut = boxOf(rectCorners(lane.runOut));
    expect(bay.minX).toBeGreaterThanOrEqual(runOut.minX - 1e-9);
    expect(bay.maxX).toBeLessThanOrEqual(runOut.maxX + 1e-9);
    expect(bay.minY).toBeLessThan(runOut.maxY);
    // turned across that drive, it would shut the garage car in
    const across = { ...m, items: m.items.map((i) => (i.id === "g_car_bay" ? { ...i, rotation: 90 } : i)) };
    expect(checkModel(across).filter((i) => i.code === "item_blocks_lane").map((i) => i.refs)).toEqual([["g_car_bay", "g_car"]]);
  });

  it("is caught when a column stands in the bay on the garage car's line, out past the door's keep-out", () => {
    const post = {
      ...m,
      items: m.items.filter((i) => i.id !== "g_car_bay"),
      columns: [...m.columns, { ...m.columns[0], id: "c_bay", x: CRESCENT_LANE_X, y: 16.8 }],
    };
    const found = checkModel(post).filter((i) => i.code === "column_blocks_lane");
    expect(found.map((i) => i.refs)).toEqual([["c_bay", "g_car"]]);
    expect(found[0].message).toContain("on the drive past garage door g_garage_door");
  });

  it("keeps every door's swing clear of the cars and their clearance", () => {
    const cars = ["g_car", "g_car_bay"].map((id) => rectCorners(parkingClearance(itemRect(m, id))));
    for (const o of m.openings.filter((x) => x.kind === "door" && x.style !== "garage")) {
      const wall = m.walls.find((w) => w.id === o.wallId)!;
      if (wall.levelId !== G) continue;
      for (const leaf of doorLeaves(wall, o)) for (const car of cars) expect(sharedArea(leafSweep(leaf), car), o.id).toBeLessThan(1e-6);
    }
  });
});

describe("the Crescent House's curved bay, wherever the page points at it", () => {
  const m = seedCrescent();
  const facade = m.walls.find((w) => w.id === "g_facade")!;
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  it("a feed link brings the wall and its door into view where they are, along the arc, as placeOf says", () => {
    for (const ref of [{ type: "wall", id: "g_facade" }, { type: "wall", id: "f_facade" }, { type: "door", id: "g_door_garden" }, { type: "window", id: "g_win_facade_w" }] as const) {
      const centre = centreOf(m, ref)!;
      const place = placeOf(m, ref.id)!;
      expect(dist(centre, place), ref.id).toBeLessThan(1e-9);
    }
    // the bay's middle is on its arc: its sagitta off the chord's middle, not on the chord
    expect(dist(centreOf(m, { type: "wall", id: "g_facade" })!, wallPointAt(facade, 0.5))).toBeLessThan(1e-9);
  });

  it("names the room the bay runs along in the wall's properties", () => {
    // read from the whole plan, as Properties reads it: the room above is on another storey
    expect(wallPlace(m, facade)).toBe("Along Living");
    const upper = m.walls.find((w) => w.id === "f_facade")!;
    expect(wallPlace(m, upper)).toBe("Along Roof terrace");
    expect(wallPlace(levelSlice(m, upper.levelId), upper)).toBe("Along Roof terrace");
  });

  it("frames an approval on the bay round its whole arc, and one on its door where the door is", () => {
    const pending = (targets: PendingApproval["targets"]): PendingApproval => ({ id: "a", tool: "remove_wall", actor: "agent", request: "", targets, effects: [], at: 0 });
    const wallCorners = targetShapes(pending([{ type: "wall", id: "g_facade", label: "" }]), m).flatMap(cornersOf);
    const ys = wallCorners.map((p) => p.y);
    // the arc's middle bows into the garden (north, -y) past the chord: the frame reaches it, both faces
    const bow = wallPointAt(facade, 0.5);
    expect(bow.y).toBeLessThan(facade.ay - 1);
    // (to within the facets the arc is cut into: ARC_TESSELLATION keeps them under 2 mm off it)
    expect(Math.min(...ys)).toBeLessThanOrEqual(bow.y - facade.thickness / 2 + 2e-3);
    // where the chord alone would stop short by the whole bow
    expect(Math.min(facade.ay, facade.by) - Math.min(...ys)).toBeGreaterThan(1);
    const doorCorners = targetShapes(pending([{ type: "door", id: "g_door_garden", label: "" }]), m).flatMap(cornersOf);
    const mid = { x: doorCorners.reduce((s, p) => s + p.x, 0) / doorCorners.length, y: doorCorners.reduce((s, p) => s + p.y, 0) / doorCorners.length };
    expect(dist(mid, placeOf(m, "g_door_garden")!)).toBeLessThan(0.05);
  });
});

describe("the Crescent House as an architect would walk it", () => {
  const m = seedCrescent();
  const wall = (id: string) => m.walls.find((w) => w.id === id)!;
  const opening = (id: string) => m.openings.find((o) => o.id === id)!;
  const sweepOf = (id: string) => {
    const o = opening(id);
    return leafSweep(doorLeaves(wall(o.wallId), o)[0]);
  };
  /** where along the run of its wall an opening's centre stands, as a plan coordinate */
  const at = (id: string) => openingCenter(wall(opening(id).wallId), opening(id));

  it("opens the coats cupboard into the hall, by a passage past the stair wider than a corridor needs", () => {
    // its leaf swings into the hall, not into the cupboard it closes
    expect(sharedArea(sweepOf("g_door_coats"), room(m, "Coats").points)).toBeLessThan(1e-6);
    expect(sharedArea(sweepOf("g_door_coats"), room(m, "Hall").points)).toBeGreaterThan(0.3);
    // from the front door north, between the cupboard and the stair's string: 1.25 m
    const coats = wall("g_coats_e");
    const stair = m.stairs[0];
    expect(stair.x - stair.width / 2 - (coats.ax + coats.thickness / 2)).toBeGreaterThanOrEqual(1.2);
  });

  it("lights the stair from a gallery window upstairs, stacked over a high light in the hall", () => {
    const gallery = at("f_win_gallery");
    const hall = at("g_win_hall_s");
    expect(gallery.y).toBeCloseTo(hall.y, 9);
    expect(opening("g_win_hall_s").sill).toBeGreaterThan(1);
    // the gallery is part of the landing, beside the stairwell, wider than a corridor: the linen store keeps to the corner by the street wall
    expect(pointInOutline({ x: wall("f_w").ax + 0.5, y: gallery.y }, room(m, "Landing").points)).toBe(true);
    const linen = outlineRect(room(m, "Linen").points)!;
    expect(linen.y).toBeGreaterThan(gallery.y + opening("f_win_gallery").width / 2);
    // and its door swings out onto the landing, clear of the main bedroom's
    expect(sharedArea(sweepOf("f_door_linen"), room(m, "Linen").points)).toBeLessThan(1e-6);
    expect(sharedArea(sweepOf("f_door_linen"), sweepOf("f_door_master"))).toBeLessThan(1e-6);
  });

  it("runs the kitchen's worktop round its L without a gap, the sink under its window", () => {
    const run = ["g_counter_n", "g_sink", "g_counter_corner"].map((id) => boxOf(rectCorners(itemRect(m, id)))).sort((a, b) => a.minX - b.minX);
    for (let i = 1; i < run.length; i++) expect(run[i].minX - run[i - 1].maxX).toBeLessThanOrEqual(1e-6);
    // the corner unit reaches the east wall's face
    expect(wall("g_e").ax - wall("g_e").thickness / 2 - run[run.length - 1].maxX).toBeLessThanOrEqual(1e-6);
    expect(at("g_win_sink").x).toBeCloseTo(m.items.find((i) => i.id === "g_sink")!.x, 9);
  });

  it("orders its facades: the main bedroom's street windows even about its front, the east openings one over another", () => {
    const front = wall("f_proj_s");
    const middle = (front.ax + front.bx) / 2;
    const xs = ["f_win_master_s1", "f_win_master_s2"].map((id) => at(id).x);
    expect((xs[0] + xs[1]) / 2).toBeCloseTo(middle, 9);
    // every ground opening in the east wall has one upstairs straight over it
    const east = (wallId: string) => m.openings.filter((o) => o.wallId === wallId).map((o) => openingCenter(wall(wallId), o).y);
    const upstairs = east("f_e");
    for (const y of east("g_e")) expect(upstairs.some((u) => Math.abs(u - y) < 1e-6), `ground opening at y ${y}`).toBe(true);
  });

  it("gives the en-suite's WC room at its side: its centre 0.4 m or more from the wall beside it", () => {
    const wc = itemRect(m, "f_ensuite_toilet");
    const side = wall("f_bath_s");
    // the toilet's width runs north-south here: its centre from the face of the wall to its north
    expect(wc.cy - (side.ay + side.thickness / 2)).toBeGreaterThanOrEqual(0.4);
  });
});
