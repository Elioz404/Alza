import { describe, it, expect } from "vitest";
import { checkModel, clampOpeningT } from "../src/model/issues";
import { emptyModel, type PlanModel } from "../src/model/types";
import { seedLoft } from "../src/model/seed";

const base = (): PlanModel => emptyModel();

describe("seed regression", () => {
  it("Sunset Loft has ZERO issues", () => {
    const issues = checkModel(seedLoft());
    expect(issues).toEqual([]);
  });
});

describe("wall rules", () => {
  it("flags too-short walls", () => {
    const m = base();
    m.walls.push({ id: "w1", ax: 0, ay: 0, bx: 0.1, by: 0, thickness: 0.15, height: 2.7 });
    expect(checkModel(m).some((i) => i.code === "wall_too_short")).toBe(true);
  });

  it("flags collinear overlap (partial)", () => {
    const m = base();
    m.walls.push(
      { id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
      { id: "w2", ax: 2, ay: 0, bx: 6, by: 0, thickness: 0.15, height: 2.7 },
    );
    expect(checkModel(m).some((i) => i.code === "walls_overlap_collinear")).toBe(true);
  });

  it("flags mid-span crossing", () => {
    const m = base();
    m.walls.push(
      { id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
      { id: "w2", ax: 2, ay: -1, bx: 2, by: 1, thickness: 0.15, height: 2.7 },
    );
    expect(checkModel(m).some((i) => i.code === "walls_cross")).toBe(true);
  });

  it("T-junctions count as connected (no loose end)", () => {
    const m = base();
    // closed square — no loose ends — plus one wall T-ing into its south edge
    m.walls.push(
      { id: "n", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
      { id: "e", ax: 4, ay: 0, bx: 4, by: 4, thickness: 0.15, height: 2.7 },
      { id: "s", ax: 4, ay: 4, bx: 0, by: 4, thickness: 0.15, height: 2.7 },
      { id: "w", ax: 0, ay: 4, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
      { id: "t", ax: 2, ay: 4, bx: 2, by: 2, thickness: 0.1, height: 2.7 },
    );
    const loose = checkModel(m).filter((i) => i.code === "wall_loose_end");
    expect(loose).toHaveLength(1); // only the T wall's free end at (2,2)
    expect(loose[0].refs).toEqual(["t"]);
  });
});

describe("opening rules", () => {
  const wallModel = (): PlanModel => {
    const m = base();
    m.walls.push({ id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 });
    return m;
  };

  it("clamps the full vano inside the wall", () => {
    const wall = wallModel().walls[0];
    expect(clampOpeningT(wall, 0.9, 0.05)).toBeCloseTo(0.9 / 2 / 4);
    expect(clampOpeningT(wall, 0.9, 0.5)).toBeCloseTo(0.5);
    expect(clampOpeningT(wall, 5, 0.5)).toBeNull();
  });

  it("flags openings overlapping each other", () => {
    const m = wallModel();
    m.openings.push(
      { id: "o1", kind: "door", wallId: "w1", t: 0.4, width: 1, sill: 0, height: 2.1 },
      { id: "o2", kind: "window", wallId: "w1", t: 0.55, width: 1, sill: 0.9, height: 1.2 },
    );
    expect(checkModel(m).some((i) => i.code === "openings_overlap")).toBe(true);
  });

  it("flags a wall ending inside another wall's opening", () => {
    const m = wallModel();
    m.openings.push({ id: "o1", kind: "door", wallId: "w1", t: 0.5, width: 1, sill: 0, height: 2.1 });
    m.walls.push({ id: "w2", ax: 2, ay: 0, bx: 2, by: 2, thickness: 0.1, height: 2.7 });
    expect(checkModel(m).some((i) => i.code === "wall_ends_in_opening")).toBe(true);
  });

  it("flags openings taller than the wall", () => {
    const m = wallModel();
    m.openings.push({ id: "o1", kind: "window", wallId: "w1", t: 0.5, width: 1, sill: 2, height: 1.2 });
    expect(checkModel(m).some((i) => i.code === "opening_too_tall")).toBe(true);
  });
});

describe("room rules", () => {
  it("flags overlapping rooms", () => {
    const m = base();
    m.rooms.push(
      { id: "r1", x: 0, y: 0, w: 3, h: 3, label: "A", floor: "oak" },
      { id: "r2", x: 2, y: 2, w: 3, h: 3, label: "B", floor: "oak" },
    );
    expect(checkModel(m).some((i) => i.code === "rooms_overlap")).toBe(true);
  });

  it("flags floating rooms", () => {
    const m = base();
    m.walls.push({ id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 });
    m.rooms.push({ id: "r1", x: 10, y: 10, w: 3, h: 3, label: "Far", floor: "oak" });
    expect(checkModel(m).some((i) => i.code === "room_floating")).toBe(true);
  });
});

describe("furniture rules", () => {
  it("flags furniture crossing a wall but allows leaning", () => {
    const m = base();
    m.walls.push({ id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 });
    m.items.push({ id: "i1", kind: "sofa", x: 2, y: 0, rotation: 0 }); // centered ON the wall
    expect(checkModel(m).some((i) => i.code === "item_through_wall")).toBe(true);

    const m2 = base();
    m2.walls.push({ id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 });
    m2.items.push({ id: "i1", kind: "sofa", x: 2, y: 0.075 + 0.45, rotation: 0 }); // leaning
    expect(checkModel(m2).some((i) => i.code === "item_through_wall")).toBe(false);
  });

  it("flags furniture blocking a door", () => {
    const m = base();
    m.walls.push({ id: "w1", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 });
    m.openings.push({ id: "o1", kind: "door", wallId: "w1", t: 0.5, width: 0.9, sill: 0, height: 2.1 });
    m.items.push({ id: "i1", kind: "sofa", x: 2, y: 0.6, rotation: 0 });
    expect(checkModel(m).some((i) => i.code === "item_blocks_door")).toBe(true);
  });

  it("rugs are exempt from furniture overlap", () => {
    const m = base();
    m.items.push(
      { id: "i1", kind: "rug", x: 2, y: 2, rotation: 0 },
      { id: "i2", kind: "coffee_table", x: 2, y: 2, rotation: 0 },
    );
    expect(checkModel(m).some((i) => i.code === "items_overlap")).toBe(false);
  });

  it("flags furniture overlapping furniture", () => {
    const m = base();
    m.items.push(
      { id: "i1", kind: "sofa", x: 2, y: 2, rotation: 0 },
      { id: "i2", kind: "armchair", x: 2.2, y: 2, rotation: 0 },
    );
    expect(checkModel(m).some((i) => i.code === "items_overlap")).toBe(true);
  });
});
