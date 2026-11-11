/**
 * Free shapes in the 3D view: walls extruded from their footprints (wallSolids.ts), straight at
 * any angle and curved, with their openings cut along the arc; shaped floors; the ink, the cut,
 * the marks and the walker on them.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildFloor, buildWall, FLOOR_SURFACE, planWall, wallCutCap } from "../src/three/build";
import { PRISM_SOLID, pieceRing, wallBands, wallFrame } from "../src/three/wallSolids";
import { triangulate } from "../src/three/triangulate";
import { addInkEdges, INK_EDGE } from "../src/three/edges";
import { blocked, blockersFor } from "../src/three/walk";
import { markBox, outlinePositions } from "../src/three/marks";
import { PlanScene } from "../src/three/planScene";
import { CONTACT, FLOOR_TOP, MARKS, OPENING_PIECES, WALL_SOLID } from "../src/three/config";
import { surface } from "../src/three/surfaces";
import { bulgeFromSagitta, outlineArea, rectOutline, roomArea, tessellateOutline, wallArc, wallLength, wallPointAt } from "../src/model/shapes";
import { emptyModel, type Opening, type PlanModel, type Room, type Wall } from "../src/model/types";
import { GROUND_LEVEL_ID } from "../src/model/limits";
import { piecesArea, regionPieces, sharedArea, type Poly } from "../src/model/region";
import { seedCrescent } from "../src/model/demoCrescent";

const G = GROUND_LEVEL_ID;
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({ id, levelId: G, ax, ay, bx, by, thickness: 0.2, height: 2.7, ...extra });
const DEG = Math.PI / 180;

/** Every prism mesh of a built wall, with its solid. */
function prisms(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.userData[PRISM_SOLID]) out.push(m);
  });
  return out;
}

/** A body prism's outline on the plan (the wall's frame undone). */
function planRing(w: Wall, mesh: THREE.Mesh): Poly {
  const f = wallFrame(w);
  const ring = mesh.geometry.userData[PRISM_SOLID].ring as { x: number; y: number }[];
  return ring.map((q) => ({ x: f.ox + q.x * f.ux - q.y * f.uy, y: f.oy + q.x * f.uy + q.y * f.ux }));
}

/** The prisms of a wall that stand from the floor to its full height: its masonry, not its skirting, band, lintels or sills. */
const fullHeight = (w: Wall, g: THREE.Object3D) => prisms(g).filter((m) => m.geometry.userData[PRISM_SOLID].y0 === 0 && m.geometry.userData[PRISM_SOLID].y1 === w.height);

describe("walls at any angle", () => {
  for (const angle of [30, 45, 60, 90, 120, 150]) {
    it(`meets a wall at ${angle} degrees at a mitre: the two solids tile the corner, no gap and no overlap`, () => {
      const a = wall("a", 0, 0, 4, 0);
      const b = wall("b", 0, 0, 4 * Math.cos(angle * DEG), 4 * Math.sin(angle * DEG));
      const walls = [a, b];
      const [ra] = fullHeight(a, buildWall(a, [], wallBands(a, walls), new Set())).map((m) => planRing(a, m));
      const [rb] = fullHeight(b, buildWall(b, [], wallBands(b, walls), new Set())).map((m) => planRing(b, m));
      // no overlap, and the two share their cap: a vertex of both at the outer and the inner mitre
      expect(sharedArea(ra, rb)).toBeLessThan(1e-9);
      const shared = ra.filter((p) => rb.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9));
      expect(shared).toHaveLength(2);
      // the outer corner is where the two outer faces meet: half the thickness off both centrelines
      const outer = shared.reduce((best, p) => (Math.hypot(p.x, p.y) > Math.hypot(best.x, best.y) ? p : best));
      const offA = Math.abs(outer.y);
      const offB = Math.abs(-outer.x * Math.sin(angle * DEG) + outer.y * Math.cos(angle * DEG));
      expect(offA).toBeCloseTo(0.1, 9);
      expect(offB).toBeCloseTo(0.1, 9);
      // together they cover the corner's whole footprint: their two areas, the bands' and the mitred corner's
      const union = piecesArea(regionPieces([ra, rb]));
      expect(union).toBeCloseTo(piecesArea(regionPieces([ra])) + piecesArea(regionPieces([rb])), 9);
    });
  }

  it("stops a wall meeting another mid-span at 45 degrees along that wall's face, both faces of it", () => {
    const top = wall("top", -3, 0, 3, 0);
    const stem = wall("stem", 0, 0, 3 * Math.cos(45 * DEG), 3 * Math.sin(45 * DEG));
    const walls = [top, stem];
    const [ring] = fullHeight(stem, buildWall(stem, [], wallBands(stem, walls), new Set())).map((m) => planRing(stem, m));
    const onFace = ring.filter((p) => Math.abs(p.y - 0.1) < 1e-9);
    expect(onFace).toHaveLength(2);
    const [topRing] = fullHeight(top, buildWall(top, [], wallBands(top, walls), new Set())).map((m) => planRing(top, m));
    expect(sharedArea(ring, topRing)).toBeLessThan(1e-9);
  });
});

describe("curved walls", () => {
  // a 6 m chord bowed 1 m: a radius of 5 m
  const curve = wall("arc", 0, 0, 6, 0, { bulge: bulgeFromSagitta({ x: 0, y: 0 }, { x: 6, y: 0 }, 1) });
  const arc = wallArc(curve)!;
  const window_: Opening = { id: "w", kind: "window", wallId: "arc", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 };
  const door: Opening = { id: "d", kind: "door", wallId: "arc", t: 0.2, width: 0.9, sill: 0, height: 2.1, hinge: "a", side: "right" };

  it("extrudes its faces as arcs concentric with its centreline, half its thickness either side", () => {
    expect(arc.radius).toBeCloseTo(5, 9);
    const g = buildWall(curve, [], wallBands(curve, [curve]), new Set());
    const [body] = fullHeight(curve, g);
    const ring = planRing(curve, body);
    const radii = ring.map((p) => Math.hypot(p.x - arc.center.x, p.y - arc.center.y));
    // every corner of its outline is on one face or the other
    for (const r of radii) expect(Math.min(Math.abs(r - (arc.radius - 0.1)), Math.abs(r - (arc.radius + 0.1)))).toBeLessThan(1e-9);
    expect(radii.filter((r) => r > arc.radius).length).toBeGreaterThan(10);
    expect(radii.filter((r) => r < arc.radius).length).toBeGreaterThan(10);
    // no facet longer than the tessellation allows
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(Math.max(WALL_SOLID.tessellation.maxSegment, 0.2) + 1e-9);
    }
    // its area is its thickness by its length
    expect(Math.abs(outlineArea(ring.map((p) => ({ x: p.x, y: p.y }))))).toBeCloseTo(0.2 * wallLength(curve), 2);
    // and its shading normals point out along the radius, smooth round the arc
    const n = body.geometry.getAttribute("normal");
    const pos = body.geometry.getAttribute("position");
    const f = wallFrame(curve);
    let radial = 0;
    for (let i = 0; i < n.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) continue;
      const px = f.ox + pos.getX(i) * f.ux - pos.getZ(i) * f.uy;
      const py = f.oy + pos.getX(i) * f.uy + pos.getZ(i) * f.ux;
      const nx = n.getX(i) * f.ux - n.getZ(i) * f.uy;
      const ny = n.getX(i) * f.uy + n.getZ(i) * f.ux;
      const r = Math.hypot(px - arc.center.x, py - arc.center.y);
      const ux = (px - arc.center.x) / r;
      const uy = (py - arc.center.y) / r;
      if (Math.abs(Math.abs(nx * ux + ny * uy) - 1) < 1e-3) radial++;
    }
    expect(radial).toBeGreaterThan(n.count / 4);
  });

  it("cuts its openings square to the arc at t ± half their width along it: the masonry stops there, the lintel and sill span it", () => {
    const g = buildWall(curve, [window_, door], wallBands(curve, [curve]), new Set());
    const len = wallLength(curve);
    const angleAt = (p: { x: number; y: number }) => Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
    const pieces = prisms(g)
      .filter((m) => !(m.material as THREE.Material[])[1]?.name.includes("lacquer") && m.geometry.userData[PRISM_SOLID].y1 <= curve.height)
      .map((m) => ({ s: m.geometry.userData[PRISM_SOLID], ring: planRing(curve, m) }));
    for (const o of [window_, door]) {
      const half = o.width / 2 / len;
      const [a0, a1] = [angleAt(wallPointAt(curve, o.t - half)), angleAt(wallPointAt(curve, o.t + half))].sort((x, y) => x - y);
      const mid = angleAt(wallPointAt(curve, o.t));
      // nothing stands in the opening between its sill and its head
      const across = pieces.filter((p) => p.s.y0 < o.sill + o.height / 2 && p.s.y1 > o.sill + o.height / 2);
      for (const p of across) {
        const angles = p.ring.map(angleAt);
        expect(Math.min(...angles) > mid || Math.max(...angles) < mid, o.id).toBe(true);
      }
      // the masonry either side stops at the cuts (a seam's width on into the vano)
      const beside = across.flatMap((p) => p.ring.map(angleAt)).filter((a) => Math.abs(a - a0) < 0.01 || Math.abs(a - a1) < 0.01);
      const seam = 0.001 / arc.radius + 1e-9;
      expect(beside.some((a) => Math.abs(a - a0) <= seam + 1e-3), o.id).toBe(true);
      expect(beside.some((a) => Math.abs(a - a1) <= seam + 1e-3), o.id).toBe(true);
      // over it, the lintel runs from cut to cut
      const lintel = pieces.find((p) => Math.abs(p.s.y0 - (o.sill + o.height)) < 1e-6 && Math.min(...p.ring.map(angleAt)) < mid && Math.max(...p.ring.map(angleAt)) > mid);
      expect(lintel, o.id).toBeDefined();
      const la = lintel!.ring.map(angleAt);
      expect(Math.min(...la), o.id).toBeCloseTo(a0 - seam, 3);
      expect(Math.max(...la), o.id).toBeCloseTo(a1 + seam, 3);
    }
    // a window's pane and a door's leaf span the chord
    let pane: THREE.Mesh | null = null;
    g.traverse((m) => {
      if ((m as THREE.Mesh).isMesh && ((m as THREE.Mesh).material as THREE.Material).name === "surface:glass") pane = m as THREE.Mesh;
    });
    expect(pane).not.toBeNull();
    const chord = 2 * arc.radius * Math.sin(window_.width / (2 * arc.radius));
    const p = pane! as THREE.Mesh;
    p.geometry.computeBoundingBox();
    expect(p.geometry.boundingBox!.max.x - p.geometry.boundingBox!.min.x).toBeCloseTo(chord - 0.04, 6);
    const hinges: THREE.Object3D[] = [];
    g.traverse((o) => o.userData.doorHinge && hinges.push(o));
    expect(hinges).toHaveLength(1);
  });

  it("deepens the straight head across the chord to cover the curved lintel over it, faces and all", () => {
    const g = buildWall(curve, [window_], wallBands(curve, [curve]), new Set());
    g.updateMatrixWorld(true);
    const len = wallLength(curve);
    const chord = 2 * arc.radius * Math.sin(window_.width / (2 * arc.radius));
    const top = window_.sill + window_.height;
    let head: THREE.Mesh | null = null;
    g.traverse((m) => {
      const geo = (m as THREE.Mesh).geometry as THREE.BoxGeometry | undefined;
      if ((m as THREE.Mesh).isMesh && geo?.type === "BoxGeometry" && Math.abs(geo.parameters.width - chord) < 1e-9 && m.position.y < top && m.position.y > top - 0.1) head = m as THREE.Mesh;
    });
    expect(head).not.toBeNull();
    const h = head! as THREE.Mesh;
    const halfDepth = (h.geometry as THREE.BoxGeometry).parameters.depth / 2;
    const toHead = h.matrixWorld.clone().invert();
    const lintel = prisms(g).find((m) => Math.abs(m.geometry.userData[PRISM_SOLID].y0 - top) < 1e-6 && m.geometry.userData[PRISM_SOLID].y1 <= curve.height)!;
    const angleAt = (p: { x: number; y: number }) => Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
    const [a0, a1] = [angleAt(wallPointAt(curve, window_.t - window_.width / 2 / len)), angleAt(wallPointAt(curve, window_.t + window_.width / 2 / len))].sort((x, y) => x - y);
    const ring = planRing(curve, lintel).filter((p) => angleAt(p) >= a0 - 1e-3 && angleAt(p) <= a1 + 1e-3);
    expect(ring.length).toBeGreaterThan(4);
    // every corner of the lintel's faces over the opening lies within the head's depth: none shows through it
    for (const p of ring) expect(Math.abs(new THREE.Vector3(p.x, top, p.y).applyMatrix4(toHead).z)).toBeLessThanOrEqual(halfDepth + 1e-9);
  });

  it("closes the cut in the poché over its curved masonry, open across the window", () => {
    const cap = wallCutCap(curve, [window_], wallBands(curve, [curve]), 1.2)!;
    const pos = cap.geometry.getAttribute("position");
    let area = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const [ax, az, bx, bz, cx, cz] = [pos.getX(i), pos.getZ(i), pos.getX(i + 1), pos.getZ(i + 1), pos.getX(i + 2), pos.getZ(i + 2)];
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      for (const k of [0, 1, 2]) expect(pos.getY(i + k)).toBeCloseTo(1.2, 6);
    }
    // the wall's footprint, less the window (its width along the arc by the thickness), plus its two jambs
    const expected = 0.2 * wallLength(curve) - 0.2 * window_.width + 2 * OPENING_PIECES.windowFrame * (0.2 + 2 * OPENING_PIECES.frameProud);
    expect(area).toBeCloseTo(expected, 2);
  });

  it("draws its ink at its creases, never along its facets", () => {
    const g = buildWall(curve, [], wallBands(curve, [curve]), new Set());
    g.updateMatrixWorld(true);
    addInkEdges(g, true);
    const lines = g.children.find((c) => c.name === INK_EDGE) as THREE.LineSegments;
    const p = lines.geometry.getAttribute("position");
    let uprights = 0;
    for (let i = 0; i < p.count; i += 2) {
      const dy = Math.abs(p.getY(i + 1) - p.getY(i));
      const flat = Math.hypot(p.getX(i + 1) - p.getX(i), p.getZ(i + 1) - p.getZ(i));
      if (dy > 1 && flat < 1e-6) uprights++;
    }
    // the four corners of its two ends, and no line down the curved faces
    expect(uprights).toBe(4);
  });

  it("is a wall the walker cannot walk through, along its arc, but through its open door", () => {
    const m: PlanModel = { ...emptyModel(), walls: [curve], openings: [door] };
    const b = blockersFor(m);
    const onArc = wallPointAt(curve, 0.7);
    expect(blocked(b, onArc.x, onArc.y, () => 0)).toBe(true);
    // the chord's middle is a metre off the arc: free
    expect(blocked(b, 3, 0, () => 0)).toBe(false);
    const doorway = wallPointAt(curve, door.t);
    expect(blocked(b, doorway.x, doorway.y, () => 0)).toBe(true);
    expect(blocked(b, doorway.x, doorway.y, () => 1)).toBe(false);
  });

  it("is marked by its own outline when selected", () => {
    const m: PlanModel = { ...emptyModel(), walls: [curve] };
    const box = markBox("wall", "arc", m)!;
    expect(box.ring).toBeDefined();
    const positions = outlinePositions(box, MARKS.outline);
    // every point of the outline stands off the wall's faces, never inside them
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i] + box.cx - arc.center.x, positions[i + 2] + box.cz - arc.center.y);
      const off = Math.min(Math.abs(r - (arc.radius - 0.1)), Math.abs(r - (arc.radius + 0.1)));
      expect(r < arc.radius - 0.1 + 1e-9 || r > arc.radius + 0.1 - 1e-9 || off < 1e-9).toBe(true);
    }
  });
});

describe("shaped floors", () => {
  const L: Room = { id: "l", levelId: G, label: "L", floor: "oak", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }] };
  const arched: Room = { id: "a", levelId: G, label: "Arched", floor: "tile", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3, bulge: 0.4 }, { x: 0, y: 3 }] };

  /** The floor's top: its upward triangles, their area, and each vertex's place on the plan and texture coordinates. */
  function top(room: Room) {
    const floor = buildFloor(room);
    floor.updateMatrixWorld(true);
    // a rectangle's nine-patch is indexed, a shaped floor's pieces are not: read both as triangles
    const geometry = floor.geometry.index ? floor.geometry.toNonIndexed() : floor.geometry;
    const pos = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    let area = 0;
    const vertices: { x: number; z: number; u: number; v: number }[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(floor.matrixWorld));
      const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
      expect(n.y).toBeGreaterThanOrEqual(0);
      area += n.length() / 2;
      for (const k of [0, 1, 2]) {
        expect(p[k].y).toBeCloseTo(FLOOR_TOP, 6);
        vertices.push({ x: p[k].x, z: p[k].z, u: uv.getX(i + k), v: uv.getY(i + k) });
      }
    }
    return { area, vertices, floor };
  }

  it("lays a concave L's floor over the L, and only the L", () => {
    const { area, vertices } = top(L);
    expect(area).toBeCloseTo(roomArea(L), 5);
    // nothing in the notch the L leaves
    for (const v of vertices) expect(v.x > 2 + 1e-9 && v.z > 2 + 1e-9).toBe(false);
  });

  it("lays a floor under a curved edge, cut into facets no coarser than the 3D view's tessellation", () => {
    const { area } = top(arched);
    const exact = roomArea(arched);
    expect(area).toBeLessThanOrEqual(exact + 1e-5);
    expect(area).toBeCloseTo(piecesArea(regionPieces([tessellateOutline(arched.points, WALL_SOLID.tessellation)])), 5);
    expect(exact - area).toBeLessThan(0.01);
  });

  it("textures every shaped floor in plan metres over its pattern's repeat, as a rectangle's is", () => {
    for (const room of [L, arched, { ...L, id: "r", points: rectOutline(1, 1, 3, 2) }]) {
      const { vertices } = top(room);
      const [mu, mv] = surface(FLOOR_SURFACE[room.floor]).userData.metres as [number, number];
      for (const v of vertices) {
        expect(v.u).toBeCloseTo(v.x / mu, 6);
        expect(v.v).toBeCloseTo(v.z / mv, 6);
      }
    }
  });

  it("shades its rim within the contact band, wherever the outline turns", () => {
    const { floor } = top(L);
    const color = floor.geometry.getAttribute("color");
    let shaded = 0;
    for (let i = 0; i < color.count; i++) if (color.getX(i) < 1 - 1e-6) shaded++;
    expect(shaded).toBeGreaterThan(0);
    expect(CONTACT.floorEdge.shade).toBeLessThan(1);
  });

  it("marks a shaped room by its own outline, not its bounds", () => {
    const m: PlanModel = { ...emptyModel(), rooms: [L] };
    const box = markBox("room", "l", m)!;
    expect(box.ring).toBeDefined();
    const positions = outlinePositions(box, MARKS.outline);
    // a corner of the outline stands in the L's inner corner, a margin outside it
    const inner = { x: 2 + MARKS.outline, z: 2 + MARKS.outline };
    expect(positions.some((_, i) => i % 3 === 0 && Math.abs(positions[i] + box.cx - inner.x) < 1e-9 && Math.abs(positions[i + 2] + box.cz - inner.z) < 1e-9)).toBe(true);
  });
});

describe("the Crescent House in 3D", () => {
  it("builds every wall, floor and piece, its curved walls smooth, every joint of each level tiled", () => {
    const m = seedCrescent();
    const scene = new PlanScene();
    scene.update(m);
    expect(scene.walls).toHaveLength(m.walls.length);
    for (const levelId of [G, m.levels[1].id]) {
      const walls = m.walls.filter((w) => w.levelId === levelId);
      const rings = walls.map((w) => fullHeightRings(w, walls));
      for (let i = 0; i < walls.length; i++)
        for (let j = i + 1; j < walls.length; j++)
          for (const a of rings[i]) for (const b of rings[j]) expect(sharedArea(a, b), `${walls[i].id} × ${walls[j].id}`).toBeLessThan(1e-6);
    }
    scene.dispose();
  });
});

/** The rings of a wall's masonry where it stands full height (its stretches between openings), on the plan. */
function fullHeightRings(w: Wall, walls: readonly Wall[]): Poly[] {
  const plan = planWall(w, [], wallBands(w, walls));
  const f = wallFrame(w);
  return plan.body.map((piece) => pieceRing(piece.runs, f).pts.map((q) => ({ x: f.ox + q.x * f.ux - q.y * f.uy, y: f.oy + q.x * f.uy + q.y * f.ux })));
}


describe("ear clipping", () => {
  const area2 = (pts: readonly { x: number; y: number }[]) => pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;
  const cases: [string, { x: number; y: number }[]][] = [
    ["a concave L", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }]],
    ["an L wound the other way", [{ x: 0, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 0 }, { x: 0, y: 0 }]],
    ["a run of corners on one line", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }]],
    ["an outline with an arc", tessellateOutline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3, bulge: -0.6 }, { x: 0, y: 3 }], WALL_SOLID.tessellation)],
    ["a comb", [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }]],
  ];
  it.each(cases)("cuts %s into triangles covering it exactly, each wound as it is", (_, pts) => {
    const tris = triangulate(pts);
    const total = Math.abs(area2(pts));
    let sum = 0;
    for (const [a, b, c] of tris) {
      const t = area2([pts[a], pts[b], pts[c]]);
      expect(Math.sign(t)).toBe(Math.sign(area2(pts)));
      sum += Math.abs(t);
    }
    expect(sum).toBeCloseTo(total, 9);
    // no two triangles overlap
    const polys = tris.map((t) => t.map((i) => pts[i]));
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) expect(sharedArea(polys[i], polys[j])).toBeLessThan(1e-9);
  });
});
