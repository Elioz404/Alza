import { describe, it, expect } from "vitest";
import {
  snap,
  segmentsCross,
  collinearOverlap,
  satRectRect,
  satRectWall,
  pointSegDist,
  clamp,
} from "../src/model/geometry";

describe("snap", () => {
  it("snaps to 5 cm grid", () => {
    expect(snap(1.23)).toBeCloseTo(1.25);
    expect(snap(1.22)).toBeCloseTo(1.2);
    expect(snap(-0.97)).toBeCloseTo(-0.95);
  });
});

describe("segmentsCross", () => {
  it("detects mid-span crossing", () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBe(true);
  });
  it("ignores endpoint touching (T/L junctions)", () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 })).toBe(false);
  });
  it("ignores parallel segments", () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
  });
});

describe("collinearOverlap", () => {
  it("measures partial overlap", () => {
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 6, y: 0 })).toBeCloseTo(2);
  });
  it("measures total containment", () => {
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(2);
  });
  it("returns 0 for endpoint touch", () => {
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 })).toBe(0);
  });
  it("returns 0 for parallel non-collinear", () => {
    expect(collinearOverlap({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(0);
  });
});

describe("SAT oriented rectangles", () => {
  it("detects overlap of rotated rects", () => {
    expect(satRectRect(
      { cx: 0, cy: 0, hw: 1, hd: 1, rot: Math.PI / 4 },
      { cx: 0.5, cy: 0.5, hw: 1, hd: 1, rot: 0 },
    )).toBe(true);
  });
  it("edge touching is NOT intersection", () => {
    expect(satRectRect(
      { cx: 0, cy: 0, hw: 1, hd: 1, rot: 0 },
      { cx: 2, cy: 0, hw: 1, hd: 1, rot: 0 },
    )).toBe(false);
  });
  it("separated rotated rects do not intersect", () => {
    expect(satRectRect(
      { cx: 0, cy: 0, hw: 0.5, hd: 0.5, rot: Math.PI / 4 },
      { cx: 3, cy: 0, hw: 0.5, hd: 0.5, rot: 0 },
    )).toBe(false);
  });
});

describe("satRectWall — leaning is legal, crossing is not", () => {
  const wall = { ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15 };
  it("furniture leaning on the wall is legal (0.02 tolerance)", () => {
    // rect bottom edge exactly at wall top edge (y = 0.075)
    expect(satRectWall({ cx: 2, cy: 0.075 + 0.3, hw: 0.5, hd: 0.3, rot: 0 }, wall, 0.02)).toBe(false);
    // 1 cm into the wall still counts as leaning
    expect(satRectWall({ cx: 2, cy: 0.075 + 0.3 - 0.01, hw: 0.5, hd: 0.3, rot: 0 }, wall, 0.02)).toBe(false);
  });
  it("furniture crossing the wall is an error", () => {
    expect(satRectWall({ cx: 2, cy: 0, hw: 0.5, hd: 0.3, rot: 0 }, wall, 0.02)).toBe(true);
  });
});

describe("pointSegDist / clamp", () => {
  it("computes distance to segment", () => {
    expect(pointSegDist({ x: 2, y: 1 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(1);
    expect(pointSegDist({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(1);
  });
  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});
