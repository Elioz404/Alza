/**
 * Where walls meet (model/joints.ts), at any angle and with curved walls: each wall's footprint is
 * mitred against its neighbours so the footprints tile every joint — no gap, no overlap — and the
 * building model's butt joints stop each wall at the face it meets, a curved face included.
 */
import { describe, expect, it } from "vitest";
import { buttJointExtensions, jointExtensions, wallFootprint } from "../src/model/joints";
import { closestOnEdge, outlineArea, outlineDistance, outlineSelfIntersection, pointInOutline, tessellateOutline, wallEdge, wallLength, wallTangentAt } from "../src/model/shapes";
import { regionPieces, piecesArea, sharedArea } from "../src/model/region";
import type { Wall } from "../src/model/types";
import type { Pt } from "../src/model/geometry";

const T = 0.2;
const wall = (id: string, ax: number, ay: number, bx: number, by: number, over: Partial<Wall> = {}): Wall => ({ id, levelId: "level_ground", ax, ay, bx, by, thickness: T, height: 2.7, ...over });
const rad = (deg: number) => (deg * Math.PI) / 180;
const poly = (w: Wall, walls: readonly Wall[]) => tessellateOutline(wallFootprint(w, walls).outline);
const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * The walls' footprints overlap nowhere, and together cover exactly what each covers. Curved
 * faces are compared cut into pieces, each footprint's own, so they may part by the pieces' sag.
 */
function expectTiled(walls: readonly Wall[], slack = 1e-6) {
  const polys = walls.map((w) => poly(w, walls));
  for (let i = 0; i < polys.length; i++) {
    expect(outlineArea(wallFootprint(walls[i], walls).outline)).toBeGreaterThan(0);
    for (let j = i + 1; j < polys.length; j++) expect(sharedArea(polys[i], polys[j])).toBeLessThan(slack);
  }
  const each = polys.reduce((s, p) => s + piecesArea(regionPieces([p])), 0);
  expect(Math.abs(piecesArea(regionPieces(polys)) - each)).toBeLessThan(slack * walls.length);
}

describe("an L corner at any angle", () => {
  it.each([30, 45, 60, 90, 120, 150])("two walls meeting at %i° are mitred on the bisector", (deg) => {
    const a = wall("a", 0, 0, 4, 0);
    const b = wall("b", 0, 0, 4 * Math.cos(rad(deg)), 4 * Math.sin(rad(deg)));
    const walls = [a, b];
    const fa = wallFootprint(a, walls);
    const fb = wallFootprint(b, walls);
    // both faces of each run on to where they meet the other's: t/2 / sin(θ/2) from the corner
    const reach = T / 2 / Math.sin(rad(deg) / 2);
    for (const p of fa.capA) expect(dist(p, { x: 0, y: 0 })).toBeCloseTo(reach, 9);
    // on the bisector
    const bis = { x: Math.cos(rad(deg) / 2), y: Math.sin(rad(deg) / 2) };
    for (const p of fa.capA) expect(Math.abs(p.x * bis.y - p.y * bis.x)).toBeCloseTo(0, 9);
    // the two caps are one edge, met from either side
    expect(new Set(fa.capA.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`))).toEqual(new Set(fb.capA.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`)));
    expectTiled(walls);
  });

  it("walls of different thicknesses still share one cap edge", () => {
    const a = wall("a", 0, 0, 4, 0, { thickness: 0.3 });
    const b = wall("b", 0, 0, 2, 3, { thickness: 0.1 });
    const walls = [a, b];
    const capA = wallFootprint(a, walls).capA.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`);
    const capB = wallFootprint(b, walls).capA.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`);
    expect(new Set(capA)).toEqual(new Set(capB));
    expectTiled(walls);
  });

  it("a very sharp corner is squared off rather than run out to a spike", () => {
    const a = wall("a", 0, 0, 4, 0);
    const b = wall("b", 0, 0, 4 * Math.cos(rad(3)), 4 * Math.sin(rad(3)));
    const f = wallFootprint(a, [a, b]);
    for (const p of f.capA) expect(dist(p, { x: 0, y: 0 })).toBeLessThanOrEqual(T / 2 + 1e-9);
  });

  it("an end touching nothing is square, and two walls in line butt at their shared point", () => {
    const a = wall("a", 0, 0, 4, 0);
    const lone = wallFootprint(a, [a]);
    expect(lone.capA.map((p) => [p.x, p.y])).toEqual([
      [0, T / 2],
      [0, -T / 2],
    ]);
    const b = wall("b", 4, 0, 8, 0);
    expect(wallFootprint(a, [a, b]).capB.every((p) => Math.abs(p.x - 4) < 1e-9)).toBe(true);
    expectTiled([a, b]);
  });
});

describe("a T, and a node of three walls", () => {
  it.each([90, 60, 30])("a wall ending on another's span at %i° stops at its face", (deg) => {
    const top = wall("top", -4, 0, 4, 0);
    const stem = wall("stem", 0, 0, 3 * Math.cos(rad(deg)), 3 * Math.sin(rad(deg)));
    const walls = [top, stem];
    const f = wallFootprint(stem, walls);
    // the stem's cap lies along the top's near face
    for (const p of f.capA) expect(p.y).toBeCloseTo(T / 2, 9);
    // the top runs through, uncut
    const ft = wallFootprint(top, walls);
    expect(ft.left.a.x).toBeCloseTo(-4);
    expect(ft.left.b.x).toBeCloseTo(4);
    expectTiled(walls);
  });

  it("three walls ending at one point tile it", () => {
    const walls = [0, 120, 240].map((deg, i) => wall(`w${i}`, 0, 0, 3 * Math.cos(rad(deg)), 3 * Math.sin(rad(deg))));
    expectTiled(walls);
    for (const w of walls) expect(wallFootprint(w, walls).capA).toHaveLength(3);
  });

  it("the corners of a closed room of angled walls are all mitred", () => {
    // a parallelogram, 60° and 120° corners
    const p = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5 + 2, y: 3 },
      { x: 2, y: 3 },
    ];
    const walls = p.map((q, i) => wall(`w${i}`, q.x, q.y, p[(i + 1) % 4].x, p[(i + 1) % 4].y));
    expectTiled(walls);
  });
});

describe("curved walls at their joints", () => {
  it("an arc meeting a straight wall at an L tiles the corner", () => {
    const arc = wall("arc", 0, 0, 4, 0, { bulge: -0.4 });
    const side = wall("side", 4, 0, 4, 4);
    const back = wall("back", 0, 0, 0, 4);
    expectTiled([arc, side, back]);
    // the arc's faces are concentric arcs: its footprint's area is thickness × centreline length, give or take its mitres
    const f = wallFootprint(arc, [arc]);
    expect(outlineArea(f.outline)).toBeCloseTo(T * wallLength(arc), 6);
  });

  it("a straight wall ending on a curved one stops at its curved face", () => {
    // the arc bows to +y; its middle is at (0, 0.8), and a stem runs on from there to +y
    const facade = wall("facade", -4, 0, 4, 0, { bulge: -0.2 });
    const mid = { x: 0, y: 0.8 };
    const stem = wall("stem", mid.x, mid.y, 0, 4);
    const walls = [facade, stem];
    const f = wallFootprint(stem, walls);
    for (const p of f.capA) expect(p.y).toBeGreaterThan(mid.y + T / 2 - 0.01);
    // the cap follows the curved face: an arc of it, not its chord
    expect(f.capABulge).not.toBe(0);
    expectTiled(walls, 1e-5);
    // the building model's stem stops at the curved face too: cut back half the facade's thickness
    expect(buttJointExtensions(stem, walls)[0]).toBeCloseTo(-T / 2, 2);
    // and its band reaches no further than the facade's centreline
    expect(jointExtensions(stem, walls)[0]).toBeCloseTo(0, 9);
  });

  it("two arcs in a smooth run butt at their shared point", () => {
    const a = wall("a", 0, 0, 4, 0, { bulge: 0.3 });
    // the second continues along the first's tangent at its end, curving on
    const b = wall("b", 4, 0, 8, 0, { bulge: 0.3 });
    expectTiled([a, b]);
  });

  it("an L of two straight walls is the same whichever wall the joint is read from", () => {
    const a = wall("a", 0, 0, 4, 0);
    const b = wall("b", 4, 0, 4, 3);
    const walls = [a, b];
    // the outer corner is at (4 + t/2, -t/2), and both footprints reach it
    const corner = { x: 4 + T / 2, y: -T / 2 };
    expect(wallFootprint(a, walls).capB.some((p) => dist(p, corner) < 1e-9)).toBe(true);
    expect(wallFootprint(b, walls).capA.some((p) => dist(p, corner) < 1e-9)).toBe(true);
    // a point just inside the corner is in one of them
    const inner = { x: 4 + T / 2 - 0.01, y: -T / 2 + 0.01 };
    expect(walls.some((w) => pointInOutline(inner, wallFootprint(w, walls).outline))).toBe(true);
  });
});

describe("sharp joints between a curved wall and another", () => {
  /**
   * An L at the origin: `curved` comes in from the west and ends there, `other` leaves at phi
   * degrees from the curved wall's end tangent (measured from the curved wall's direction back
   * into it), bent by its own bulge, aimed so its own tangent leaves at that angle.
   */
  function sharpL(bulge: number, phi: number, otherBulge = 0): Wall[] {
    const curved = wall("curved", -3, 0, 0, 0, { bulge });
    const u = wallTangentAt(curved, 1);
    const at = Math.atan2(-u.y, -u.x) + rad(phi);
    let other = wall("other", 0, 0, 3 * Math.cos(at), 3 * Math.sin(at), otherBulge ? { bulge: otherBulge } : {});
    const v = wallTangentAt(other, 0);
    const aim = 2 * at - Math.atan2(v.y, v.x);
    other = wall("other", 0, 0, 3 * Math.cos(aim), 3 * Math.sin(aim), otherBulge ? { bulge: otherBulge } : {});
    return [curved, other];
  }

  /**
   * Sampled round the joint: no point of either wall's band is left out of both footprints, and
   * no point is in both but where the bands themselves overlap. Points on an outline are skipped.
   */
  function expectJointTiled(walls: readonly Wall[], label: string) {
    const outlines = walls.map((w) => wallFootprint(w, walls).outline);
    for (const o of outlines) expect(outlineSelfIntersection(o), label).toBeNull();
    const R = 0.9;
    const N = 45;
    let gaps = 0;
    let overlaps = 0;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const p = { x: -R + (2 * R * (i + 0.5)) / N, y: -R + (2 * R * (j + 0.5)) / N };
        if (outlines.some((o) => outlineDistance(p, o) < 2e-3)) continue;
        const inBand = walls.map((w) => {
          const c = closestOnEdge(wallEdge(w), p);
          return c.t > 1e-6 && c.t < 1 - 1e-6 && c.distance < w.thickness / 2 - 2e-3;
        });
        const covered = outlines.filter((o) => pointInOutline(p, o)).length;
        if ((inBand[0] || inBand[1]) && covered === 0) gaps++;
        if (covered > 1 && !(inBand[0] && inBand[1])) overlaps++;
      }
    expect(gaps, `${label}: gaps`).toBe(0);
    expect(overlaps, `${label}: overlaps`).toBe(0);
  }

  for (const bulge of [0.3, 0.6, 1]) {
    it(`tiles a curved wall of bulge ±${bulge} meeting a straight one at 20–40 and 320–340 degrees, as straight walls do`, () => {
      for (const sign of [1, -1])
        for (const phi of [20, 25, 30, 35, 40, 320, 325, 330, 335, 340]) {
          expectJointTiled(sharpL(sign * bulge, phi), `bulge ${sign * bulge}, ${phi}°`);
          // the same joint read the other way round: the straight wall ending on the curved one's start
          const [c, o] = sharpL(sign * bulge, phi);
          const flipped = [{ ...o, ax: o.bx, ay: o.by, bx: o.ax, by: o.ay }, c];
          expectJointTiled(flipped, `flipped, bulge ${sign * bulge}, ${phi}°`);
        }
    });
  }

  it("tiles two curved walls meeting at 25 to 335 degrees", () => {
    for (const bulge of [0.3, -0.6, 1])
      for (const other of [0.4, -0.4])
        for (let phi = 25; phi <= 335; phi += 31) expectJointTiled(sharpL(bulge, phi, other), `bulge ${bulge} × ${other}, ${phi}°`);
  });

  it("the reported cases: no self-crossing outline, no gap at the joint", () => {
    // a 0.6 bulge at 30° crossed itself; 0.3 at 20° left a gap where both ends were squared off
    expectJointTiled(sharpL(0.6, 30), "0.6 at 30°");
    expectJointTiled(sharpL(1, 30), "1 at 30°");
    expectJointTiled(sharpL(0.3, 20), "0.3 at 20°");
  });
});
