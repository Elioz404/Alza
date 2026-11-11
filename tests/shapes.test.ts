/**
 * Free shapes (model/shapes.ts): arcs by their bulge, and room outlines whose edges may be arcs —
 * their measures, their winding, where a point is, where edges meet, the anchor a name stands
 * at, and the degenerate cases each has to survive.
 */
import { describe, expect, it } from "vitest";
import {
  arcOf,
  bulgeFromSagitta,
  bulgeThrough,
  closestOnEdge,
  concentricBulge,
  curveBulge,
  edgeBox,
  edgeBulge,
  edgeIntersections,
  edgeLength,
  edgesOverlap,
  extendedWall,
  intersectCurves,
  normalizeOutline,
  openingSag,
  outlineAnchor,
  outlineArea,
  outlineBounds,
  outlineDistance,
  outlineError,
  outlineFromInput,
  outlinePath,
  outlinePerimeter,
  outlineRect,
  outlineSelfIntersection,
  pointInOutline,
  pointOnEdge,
  rectOutline,
  sagittaOf,
  stretchOutline,
  subEdge,
  tangentOnEdge,
  tessellateEdge,
  tessellateOutline,
  translateOutline,
  wallArcError,
  wallLength,
  wallPieces,
  wallPointAt,
  type Edge,
} from "../src/model/shapes";
import { ARC_TESSELLATION, ROOM_SHAPE, ROOM_SIZE, STRAIGHT_SAGITTA } from "../src/model/limits";
import type { RoomVertex, Wall } from "../src/model/types";
import { regionPieces, piecesArea, sharedArea } from "../src/model/region";

const close = (p: { x: number; y: number }, q: { x: number; y: number }, digits = 9) => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
};

const wall = (over: Partial<Wall> = {}): Wall => ({ id: "w", levelId: "level_ground", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.2, height: 2.7, ...over });

describe("an arc by its bulge", () => {
  const half: Edge = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, bulge: 1 };

  it("a bulge of 1 is a half circle on the chord, bowing to (dy, -dx)", () => {
    const arc = arcOf(half.a, half.b, half.bulge)!;
    close(arc.center, { x: 1, y: 0 });
    expect(arc.radius).toBeCloseTo(1);
    expect(arc.sweep).toBeCloseTo(Math.PI);
    expect(arc.length).toBeCloseTo(Math.PI);
    // its middle stands 1 m off the chord on the -y side: (dy, -dx) for a chord along +x
    close(pointOnEdge(half, 0.5), { x: 1, y: -1 });
    close(pointOnEdge(half, 0), half.a);
    close(pointOnEdge(half, 1), half.b);
  });

  it("a negative bulge bows the other way, and 0 (or one too small to bend) is straight", () => {
    close(pointOnEdge({ ...half, bulge: -1 }, 0.5), { x: 1, y: 1 });
    expect(arcOf(half.a, half.b, 0)).toBeNull();
    expect(arcOf(half.a, half.b, 1e-12)).toBeNull();
    expect(arcOf(half.a, half.a, 0.5)).toBeNull();
    expect(edgeLength({ ...half, bulge: 0 })).toBeCloseTo(2);
  });

  it("t runs along the arc by length", () => {
    const e: Edge = { a: { x: 0, y: 0 }, b: { x: 3, y: 1 }, bulge: 0.4 };
    const arc = arcOf(e.a, e.b, e.bulge)!;
    // equal steps of t are equal angles, so equal lengths along it
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => pointOnEdge(e, t));
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 9);
    for (const p of pts) expect(Math.hypot(p.x - arc.center.x, p.y - arc.center.y)).toBeCloseTo(arc.radius, 9);
  });

  it("the tangent leaves the start toward the bulge and is perpendicular to the radius", () => {
    const t0 = tangentOnEdge(half, 0);
    close(t0, { x: 0, y: -1 });
    const arc = arcOf(half.a, half.b, half.bulge)!;
    for (const t of [0.1, 0.4, 0.9]) {
      const p = pointOnEdge(half, t);
      const u = tangentOnEdge(half, t);
      expect(Math.hypot(u.x, u.y)).toBeCloseTo(1);
      expect((p.x - arc.center.x) * u.x + (p.y - arc.center.y) * u.y).toBeCloseTo(0, 9);
    }
    close(tangentOnEdge({ ...half, bulge: 0 }, 0.3), { x: 1, y: 0 });
  });

  it("sagitta, bulge and a through-point describe the same arc", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };
    const k = bulgeFromSagitta(a, b, 1);
    expect(k).toBeCloseTo(0.5);
    expect(sagittaOf({ a, b, bulge: k })).toBeCloseTo(1);
    // the arc's middle is (2, -1): through it is the same bulge
    expect(bulgeThrough(a, b, { x: 2, y: -1 })).toBeCloseTo(0.5);
    // any other point of the same arc too
    expect(bulgeThrough(a, b, pointOnEdge({ a, b, bulge: 0.5 }, 0.2))).toBeCloseTo(0.5);
    expect(bulgeThrough(a, b, { x: 2, y: 1 })).toBeCloseTo(-0.5);
    expect(bulgeThrough(a, b, { x: 2, y: 0 })).toBe(0);
    expect(bulgeThrough(a, b, a)).toBeNull();
    expect(curveBulge(a, b, { sagitta: -1 })).toBeCloseTo(-0.5);
    expect(curveBulge(a, b, { through: { x: 2, y: -2 } })).toBeCloseTo(1);
    expect(curveBulge(a, b, { bulge: 0.3 })).toBe(0.3);
  });

  it("the nearest point of an arc to a point, inside its sweep and past its ends", () => {
    const c = closestOnEdge(half, { x: 1, y: -3 });
    expect(c.t).toBeCloseTo(0.5);
    expect(c.distance).toBeCloseTo(2);
    // beyond its ends the nearest point is an end
    const past = closestOnEdge(half, { x: 3, y: 0.5 });
    expect(past.t).toBe(1);
    close(past.point, half.b);
    // the centre is equally far from every point of it
    expect(closestOnEdge(half, { x: 1, y: 0 }).distance).toBeCloseTo(1);
  });

  it("bounds hold the arc's outermost point", () => {
    const box = edgeBox(half);
    expect(box.minY).toBeCloseTo(-1);
    expect(box.maxY).toBeCloseTo(0);
    expect(box.minX).toBeCloseTo(0);
    expect(box.maxX).toBeCloseTo(2);
  });

  it("is cut into pieces no longer, and turning no more, than the tessellation allows", () => {
    const e: Edge = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, bulge: 0.6 };
    const pts = [...tessellateEdge(e), e.b];
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(ARC_TESSELLATION.maxSegment + 1e-9);
    expect(tessellateEdge({ ...e, bulge: 0 })).toEqual([e.a]);
  });

  it("a part of an arc is an arc of the same circle", () => {
    const e: Edge = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, bulge: 0.5 };
    const part = subEdge(e, 0.25, 0.75);
    const whole = arcOf(e.a, e.b, e.bulge)!;
    const arc = arcOf(part.a, part.b, part.bulge)!;
    close(arc.center, whole.center);
    expect(arc.radius).toBeCloseTo(whole.radius);
    expect(edgeLength(part)).toBeCloseTo(edgeLength(e) / 2);
    expect(concentricBulge(e, part.a, part.b)).toBeCloseTo(part.bulge);
  });
});

describe("where curves and edges meet", () => {
  it("lines, a line and a circle, two circles", () => {
    expect(intersectCurves({ kind: "line", p: { x: 0, y: 0 }, d: { x: 1, y: 0 } }, { kind: "line", p: { x: 2, y: -1 }, d: { x: 0, y: 1 } })).toEqual([{ x: 2, y: 0 }]);
    expect(intersectCurves({ kind: "line", p: { x: 0, y: 0 }, d: { x: 1, y: 0 } }, { kind: "line", p: { x: 0, y: 1 }, d: { x: 2, y: 0 } })).toEqual([]);
    const lc = intersectCurves({ kind: "line", p: { x: -5, y: 0 }, d: { x: 1, y: 0 } }, { kind: "circle", c: { x: 0, y: 0 }, r: 2 });
    expect(lc.map((p) => Math.round(p.x)).sort()).toEqual([-2, 2]);
    // tangent: one point
    expect(intersectCurves({ kind: "line", p: { x: -5, y: 2 }, d: { x: 1, y: 0 } }, { kind: "circle", c: { x: 0, y: 0 }, r: 2 })).toHaveLength(1);
    const cc = intersectCurves({ kind: "circle", c: { x: 0, y: 0 }, r: 1 }, { kind: "circle", c: { x: 1, y: 0 }, r: 1 });
    expect(cc).toHaveLength(2);
    for (const p of cc) expect(p.x).toBeCloseTo(0.5);
    expect(intersectCurves({ kind: "circle", c: { x: 0, y: 0 }, r: 1 }, { kind: "circle", c: { x: 5, y: 0 }, r: 1 })).toEqual([]);
    expect(intersectCurves({ kind: "circle", c: { x: 0, y: 0 }, r: 1 }, { kind: "circle", c: { x: 0, y: 0 }, r: 1 })).toEqual([]);
  });

  it("an arc crossing a segment, and two arcs crossing, only within both", () => {
    const arc: Edge = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, bulge: 1 };
    const seg: Edge = { a: { x: 1, y: 0.5 }, b: { x: 1, y: -2 }, bulge: 0 };
    const hits = edgeIntersections(arc, seg);
    expect(hits).toHaveLength(1);
    close(hits[0].p, { x: 1, y: -1 });
    expect(hits[0].t1).toBeCloseTo(0.5);
    // the same line, but not reaching the arc
    expect(edgeIntersections(arc, { ...seg, b: { x: 1, y: -0.5 } })).toEqual([]);
    const other: Edge = { a: { x: 1, y: 1 }, b: { x: 1, y: -3 }, bulge: 0.3 };
    expect(edgeIntersections(arc, other).length).toBeGreaterThan(0);
  });

  it("edges running along each other, on one line or one circle", () => {
    expect(edgesOverlap({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, bulge: 0 }, { a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, bulge: 0 })).toBe(true);
    expect(edgesOverlap({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, bulge: 0 }, { a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, bulge: 0 })).toBe(false);
    const arc: Edge = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, bulge: 1 };
    expect(edgesOverlap(arc, subEdge(arc, 0.2, 0.6))).toBe(true);
    expect(edgesOverlap(subEdge(arc, 0, 0.4), subEdge(arc, 0.4, 1))).toBe(false);
  });
});

describe("a room's outline", () => {
  const l: RoomVertex[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 4 },
    { x: 0, y: 4 },
  ];

  it("a rectangle is its four corners, positive, and reads back as the rectangle", () => {
    const r = rectOutline(1, 2, 3, 4);
    expect(outlineArea(r)).toBeCloseTo(12);
    expect(outlinePerimeter(r)).toBeCloseTo(14);
    expect(outlineRect(r)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(outlineRect(l)).toBeNull();
    expect(outlineRect([...r.slice(0, 3), { ...r[3], bulge: 0.1 }])).toBeNull();
  });

  it("measures an L, and an outline with an arc edge", () => {
    expect(outlineArea(l)).toBeCloseTo(12);
    expect(outlinePerimeter(l)).toBeCloseTo(16);
    // the top edge of a 2 × 2 square bowed out to a half circle: + π/2
    const dome = [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(outlineArea(dome)).toBeCloseTo(4 + Math.PI / 2);
    expect(outlinePerimeter(dome)).toBeCloseTo(6 + Math.PI);
    // bowed in, the same arc takes it away
    const scoop = [{ x: 0, y: 0, bulge: -0.5 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(outlineArea(scoop)).toBeLessThan(4);
    // its area agrees with its cut-up polygon's
    expect(piecesArea(regionPieces([tessellateOutline(dome)]))).toBeCloseTo(outlineArea(dome), 2);
  });

  it("is kept wound one way: reversing moves each bulge to the edge's other end and flips it", () => {
    const backwards = [{ x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 0, bulge: -1 }];
    expect(outlineArea(backwards)).toBeLessThan(0);
    const kept = normalizeOutline(backwards);
    expect(outlineArea(kept)).toBeCloseTo(4 + Math.PI / 2);
    // the bowed edge ran from (0, 0) back to (0, 2), bowing out to -x; reversed, it runs from
    // (0, 2) to (0, 0) and its bulge, still bowing out, is positive
    const bowed = kept.find((p) => p.bulge !== undefined)!;
    expect(bowed).toMatchObject({ x: 0, y: 2, bulge: 1 });
    // a positive one stays as it is, and corners given twice are dropped
    expect(normalizeOutline(rectOutline(0, 0, 2, 2))).toEqual(rectOutline(0, 0, 2, 2));
    expect(normalizeOutline([...rectOutline(0, 0, 2, 2), { x: 0, y: 0 }])).toHaveLength(4);
  });

  it("tells inside from outside, an arc's bulge and an L's notch included", () => {
    expect(pointInOutline({ x: 1, y: 1 }, l)).toBe(true);
    expect(pointInOutline({ x: 3, y: 3 }, l)).toBe(false);
    const dome = [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(pointInOutline({ x: 1, y: -0.9 }, dome)).toBe(true);
    expect(pointInOutline({ x: 1, y: -1.1 }, dome)).toBe(false);
    const scoop = [{ x: 0, y: 0, bulge: -0.5 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(pointInOutline({ x: 1, y: 0.2 }, scoop)).toBe(false);
    expect(pointInOutline({ x: 1, y: 1 }, scoop)).toBe(true);
    expect(outlineDistance({ x: 3, y: 3 }, l)).toBeCloseTo(1);
  });

  it("finds an outline crossing itself, but not the corners adjacent edges share", () => {
    expect(outlineSelfIntersection(l)).toBeNull();
    const bow = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }];
    expect(outlineSelfIntersection(bow)).not.toBeNull();
    // a corner doubling back along the edge before it
    expect(outlineSelfIntersection([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }])).not.toBeNull();
    // an arc bowing in, across the opposite edge; bowing out, it crosses nothing
    expect(outlineSelfIntersection([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1, bulge: -1 }, { x: 0, y: 1 }])).not.toBeNull();
    expect(outlineSelfIntersection([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1, bulge: 1 }, { x: 0, y: 1 }])).toBeNull();
  });

  it("anchors a name inside an L, away from its notch, not at its centroid", () => {
    const u: RoomVertex[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const a = outlineAnchor(u);
    expect(pointInOutline(a, u)).toBe(true);
    // the U's centroid falls in its gap; the anchor sits in one of its legs, a full metre from every edge
    expect(a.clearance).toBeGreaterThan(0.95);
    expect(outlineDistance(a, u)).toBeCloseTo(a.clearance, 6);
    const r = outlineAnchor(rectOutline(0, 0, 4, 2));
    expect(r.x).toBeCloseTo(2, 1);
    expect(r.clearance).toBeCloseTo(1, 1);
    // the same outline array answers from memory
    expect(outlineAnchor(u)).toBe(a);
  });

  it("is judged as a room's outline: corners, bulges, edges, crossings, area, width", () => {
    expect(outlineError(l, ROOM_SIZE.min)).toBeNull();
    expect(outlineError(l.slice(0, 2), ROOM_SIZE.min)).toMatch(/corners/);
    expect(outlineError([{ x: 0, y: 0, bulge: 1.5 }, { x: 2, y: 0 }, { x: 2, y: 2 }], ROOM_SIZE.min)).toMatch(/half circle/);
    expect(outlineError([{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], ROOM_SIZE.min)).toMatch(/Edge 0/);
    expect(outlineError([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }], ROOM_SIZE.min)).toMatch(/cross/);
    expect(outlineError(rectOutline(0, 0, 0.3, 0.3), ROOM_SIZE.min)).toMatch(/m²/);
    expect(outlineError(rectOutline(0, 0, 0.3, 4), ROOM_SIZE.min)).toMatch(/wide/);
    expect(outlineError(rectOutline(0, 0, ROOM_SIZE.min, ROOM_SIZE.min), ROOM_SIZE.min)).toBeNull();
    expect(ROOM_SHAPE.minArea).toBeCloseTo(ROOM_SIZE.min ** 2);
  });

  it("reads corners and arcs as a tool takes them, a positive sagitta bowing out whichever way round", () => {
    const corners = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const forward = outlineFromInput(corners, [{ edge: 0, sagitta: 1 }]);
    const backward = outlineFromInput([...corners].reverse(), [{ edge: 2, sagitta: 1 }]);
    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) return;
    expect(outlineArea(forward.points)).toBeGreaterThan(12);
    expect(outlineArea(backward.points)).toBeCloseTo(outlineArea(forward.points), 9);
    const through = outlineFromInput(corners, [{ edge: 0, through: { x: 2, y: -1 } }]);
    expect(through.ok && outlineArea(through.points)).toBeCloseTo(outlineArea(forward.points), 9);
    expect(outlineFromInput(corners, [{ edge: 7, sagitta: 1 }])).toMatchObject({ ok: false });
    expect(outlineFromInput(corners, [{ edge: 0, sagitta: 1 }, { edge: 0, sagitta: 2 }])).toMatchObject({ ok: false });
    expect(outlineFromInput(corners, [{ edge: 0, through: { x: 0, y: 0 } }])).toMatchObject({ ok: false });
  });

  it("moves and stretches from its bounds' corner, arcs keeping their bulge", () => {
    const dome = [{ x: 0, y: 0, bulge: 0.5 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    const moved = translateOutline(dome, 1, 2);
    expect(moved[0]).toEqual({ x: 1, y: 2, bulge: 0.5 });
    const box = outlineBounds(dome);
    const stretched = stretchOutline(dome, box.w * 2, box.h);
    expect(outlineBounds(stretched).w).toBeCloseTo(box.w * 2);
    expect(stretched.find((p) => p.bulge)?.bulge).toBe(0.5);
  });

  it("is drawn as SVG path data with arcs, not chords", () => {
    expect(outlinePath(rectOutline(0, 0, 2, 1), 10)).toBe("M0 0L20 0L20 10L0 10L0 0Z");
    expect(outlinePath([{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }, { x: 2, y: 2 }], 1)).toMatch(/^M0 0A1 1 0 0 1 2 0L2 2L0 0Z$/);
    expect(outlinePath([])).toBe("");
  });

  it("two rooms side by side share no area; one over another shares the overlap", () => {
    expect(sharedArea(tessellateOutline(rectOutline(0, 0, 2, 2)), tessellateOutline(rectOutline(2, 0, 2, 2)))).toBeCloseTo(0, 9);
    expect(sharedArea(tessellateOutline(rectOutline(0, 0, 2, 2)), tessellateOutline(rectOutline(1, 1, 2, 2)))).toBeCloseTo(1, 9);
    // an L and a rectangle in its notch touch along two edges only
    expect(sharedArea(tessellateOutline(l), tessellateOutline(rectOutline(2, 2, 2, 2)))).toBeCloseTo(0, 9);
  });
});

describe("a curved wall", () => {
  it("its length, its points and t are along its arc", () => {
    const w = wall({ bulge: 1 });
    expect(wallLength(w)).toBeCloseTo(2 * Math.PI);
    close(wallPointAt(w, 0.5), { x: 2, y: -2 });
    expect(wallLength(wall())).toBeCloseTo(4);
  });

  it("is too tight when its radius is under its thickness, and never bends past a half circle", () => {
    expect(wallArcError(wall({ bulge: 0.5 }))).toBeNull();
    expect(wallArcError(wall({ bx: 0.3, bulge: 1, thickness: 0.2 }))).toMatch(/radius/);
    expect(wallArcError(wall({ bulge: 1.2 }))).toMatch(/half circle/);
    expect(wallArcError(wall())).toBeNull();
  });

  it("is covered by its thick pieces", () => {
    const w = wall({ bulge: 0.6 });
    const pieces = wallPieces(w);
    expect(pieces.length).toBeGreaterThan(1);
    expect(wallPieces(wall())).toHaveLength(1);
  });

  it("an opening's chord sags off the arc by R(1 − cos(w/2R)); none on a straight wall", () => {
    const w = wall({ bulge: 1 }); // radius 2
    expect(openingSag(w, 1)).toBeCloseTo(2 * (1 - Math.cos(0.25)));
    expect(openingSag(wall(), 1)).toBe(0);
  });

  it("extends along its circle, or along its line", () => {
    const w = wall({ bulge: 0.5 });
    const longer = extendedWall(w, "b", 1)!;
    expect(wallLength({ ...w, ...longer })).toBeCloseTo(wallLength(w) + 1, 9);
    const arc = arcOf({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, w.bulge)!;
    const same = arcOf({ x: longer.ax, y: longer.ay }, { x: longer.bx, y: longer.by }, longer.bulge)!;
    close(same.center, arc.center);
    const back = extendedWall(w, "a", -1)!;
    expect(wallLength({ ...w, ...back })).toBeCloseTo(wallLength(w) - 1, 9);
    expect(extendedWall(wall(), "b", 1)).toEqual({ ax: 0, ay: 0, bx: 5, by: 0 });
    expect(extendedWall(wall(), "a", -5)).toBeNull();
    // past a half circle it does not go
    expect(extendedWall(wall({ bulge: 0.95 }), "b", 3)).toBeNull();
  });
});

describe("nearly straight edges", () => {
  it("reads an edge bowed less than STRAIGHT_SAGITTA as straight, by its sagitta whatever its length", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 8, y: 0 };
    expect(edgeBulge(a, b, bulgeFromSagitta(a, b, STRAIGHT_SAGITTA * 0.9))).toBe(0);
    expect(edgeBulge(a, b, bulgeFromSagitta(a, b, STRAIGHT_SAGITTA * 1.1))).not.toBe(0);
    expect(arcOf(a, b, bulgeFromSagitta(a, b, STRAIGHT_SAGITTA / 10))).toBeNull();
    // stored so: the outline keeps no bulge on it
    expect(normalizeOutline([a, { x: 8, y: 0, bulge: 1e-7 }, { x: 8, y: 6 }, { x: 0, y: 6 }])[1].bulge).toBeUndefined();
  });

  it("finds where a circle kilometres across meets a small one to the micrometre", () => {
    const big = arcOf({ x: 0, y: 0 }, { x: 8.7, y: 0 }, bulgeFromSagitta({ x: 0, y: 0 }, { x: 8.7, y: 0 }, 2e-3))!;
    const small = { kind: "circle" as const, c: { x: 8.7, y: 2.5 }, r: 2.6 };
    const hits = intersectCurves({ kind: "circle", c: big.center, r: big.radius }, small);
    expect(hits.length).toBeGreaterThan(0);
    for (const p of hits) {
      expect(Math.abs(Math.hypot(p.x - small.c.x, p.y - small.c.y) - small.r)).toBeLessThan(1e-6);
      expect(Math.abs(Math.hypot(p.x - big.center.x, p.y - big.center.y) - big.radius)).toBeLessThan(1e-6);
    }
  });

  it("does not refuse a valid room for a slight bend beside an arc edge", () => {
    // the reported outline: edge 1 bent by a fraction of a millimetre next to arc edge 2 was
    // refused as crossing it, depending on the bend's sign and size
    const base: RoomVertex[] = [{ x: 12.85, y: 24.45 }, { x: 20.4, y: 25.25 }, { x: 19.95, y: 34, bulge: -0.1408 }, { x: 12.85, y: 34 }];
    for (const sagitta of [1e-6, -1e-6, 1e-5, -1e-5, 5e-5, -5e-5, 1e-4, -1e-4, 1e-3, -1e-3, 2e-3, -2e-3, 1e-2]) {
      const points = base.map((p, i) => (i === 1 ? { ...p, bulge: bulgeFromSagitta(p, base[2], sagitta) } : p));
      expect(outlineSelfIntersection(points), `sagitta ${sagitta}`).toBeNull();
    }
    // and a sweep of such quadrilaterals on a 5 cm grid: a bend of a tenth of a millimetre beside an arc never reads as a crossing
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const g = () => Math.round(rnd() * 600) * 0.05;
    let tried = 0;
    while (tried < 500) {
      const pts: RoomVertex[] = [0, 1, 2, 3].map(() => ({ x: g(), y: g() }));
      pts[2] = { ...pts[2], bulge: (rnd() - 0.5) * 1.2 };
      if (outlineSelfIntersection(pts) || edgeLength({ a: pts[1], b: pts[2], bulge: 0 }) < 0.5) continue;
      tried++;
      const bent = pts.map((p, i) => (i === 1 ? { ...p, bulge: bulgeFromSagitta(p, pts[2], (rnd() < 0.5 ? 1 : -1) * 1e-4) } : p));
      expect(outlineSelfIntersection(bent), JSON.stringify(bent)).toBeNull();
    }
  });
});
