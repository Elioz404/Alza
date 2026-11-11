/**
 * Columns, open ground and garage doors in the 3D view: a column extruded from its section to
 * the slab over it, the wall it stands in stopping at its faces; the slab's soffit and edge over
 * open ground; a sectional garage door that runs up and back on its track; the car; and the
 * pieces of every door and window standing in their vano with no two faces in one plane (the
 * stone sill's top once stood half a millimetre over the masonry under it, and the two fought for
 * depth at a distance).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildColumn, buildWall, columnCutCap, curtainedWindows, garageInside, openingsByWall, planWall, poseGarageDoor, wallPosts } from "../src/three/build";
import { PlanScene } from "../src/three/planScene";
import { PRISM_SOLID, wallBands } from "../src/three/wallSolids";
import { addInkEdges, INK_EDGE, isAid } from "../src/three/edges";
import { blocked, blockersFor } from "../src/three/walk";
import { markBox } from "../src/three/marks";
import { buildFurniture, pieceTriangles } from "../src/three/furniture";
import { FURNITURE_STYLE } from "../src/three/furnitureStyle";
import { staticSurface } from "../src/three/surfaces";
import { FURNITURE } from "../src/ui/theme/sceneTokens";
import { labelAnchor, parkedIn } from "../src/three/labels";
import { pointInORect } from "../src/model/geometry";
import { GARAGE_DOOR_MODEL, LABELS, OPENING_PIECES } from "../src/three/config";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { columnArea, columnFootprint, columnHeight } from "../src/model/columns";
import { overhangOf } from "../src/model/floors";
import { levelSlice, levelsOf } from "../src/model/levels";
import { piecesArea, regionPieces } from "../src/model/region";
import { bulgeFromSagitta, pointInOutline, rectOutline, wallLength } from "../src/model/shapes";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID } from "../src/model/demoCrescent";
import { GARAGE_DOOR, GROUND_LEVEL_ID, SLAB_THICKNESS } from "../src/model/limits";
import { emptyModel, type Column, type Opening, type PlanModel, type Room, type Wall } from "../src/model/types";

const G = GROUND_LEVEL_ID;
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({ id, levelId: G, ax, ay, bx, by, thickness: 0.2, height: 2.7, ...extra });
const column = (id: string, x: number, y: number, extra: Partial<Column> = {}): Column => ({ id, levelId: G, shape: "square", x, y, w: 0.3, d: 0.3, rotation: 0, ...extra });
const opening = (id: string, wallId: string, kind: Opening["kind"], t: number, width: number, sill: number, height: number, extra: Partial<Opening> = {}): Opening => ({
  id,
  kind,
  wallId,
  t,
  width,
  sill,
  height,
  ...extra,
});

// ---------------------------------------------------------------------------- coplanar faces

/** A triangle in the world: its corners, its unit normal and its plane's offset (n · p). */
interface Tri {
  p: THREE.Vector3[];
  n: THREE.Vector3;
  d: number;
}

/** Every drawn mesh of a built wall (not its ink, caps or contact shadows), with its triangles in the world. */
function trianglesOf(g: THREE.Object3D): { mesh: THREE.Mesh; tris: Tri[] }[] {
  g.updateMatrixWorld(true);
  const out: { mesh: THREE.Mesh; tris: Tri[] }[] = [];
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isAid(mesh)) return;
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    const tris: Tri[] = [];
    for (let i = 0; i + 2 < count; i += 3) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
      const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
      if (n.length() < 1e-12) continue;
      n.normalize();
      tris.push({ p, n, d: n.dot(p[0]) });
    }
    out.push({ mesh, tris });
  });
  return out;
}

/** The area two triangles in (nearly) one plane share, measured in that plane (convex clipping). */
function sharedArea(a: Tri, b: Tri): number {
  // a frame in a's plane
  const u = new THREE.Vector3().subVectors(a.p[1], a.p[0]).normalize();
  const v = new THREE.Vector3().crossVectors(a.n, u);
  const flat = (t: Tri) => t.p.map((q) => ({ x: q.dot(u), y: q.dot(v) }));
  const ccw = (poly: { x: number; y: number }[]) => {
    const s = poly.reduce((acc, q, i) => acc + q.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * q.y, 0);
    return s < 0 ? poly.reverse() : poly;
  };
  let subject = ccw(flat(a));
  const clip = ccw(flat(b));
  for (let i = 0; i < clip.length && subject.length > 0; i++) {
    const c0 = clip[i];
    const c1 = clip[(i + 1) % clip.length];
    const side = (q: { x: number; y: number }) => (c1.x - c0.x) * (q.y - c0.y) - (c1.y - c0.y) * (q.x - c0.x);
    const next: { x: number; y: number }[] = [];
    for (let k = 0; k < subject.length; k++) {
      const p = subject[k];
      const q = subject[(k + 1) % subject.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    subject = next;
  }
  if (subject.length < 3) return 0;
  return Math.abs(subject.reduce((acc, q, i) => acc + q.x * subject[(i + 1) % subject.length].y - subject[(i + 1) % subject.length].x * q.y, 0)) / 2;
}

/** Faces of two different meshes this close to one plane, facing the same way, fight for depth where they overlap. */
const PLANE_TOLERANCE = 0.002;
/** Overlaps smaller than this are edges touching, not faces (square metres). */
const AREA_TOLERANCE = 1e-6;

/**
 * Pairs of faces of a built wall's pieces that lie in one plane (within PLANE_TOLERANCE), face
 * the same way and overlap. A wall's own prisms (its masonry, skirting and band) are one solid in
 * one plaster, tiling each other with their seams: two of them are not compared; every piece of a
 * door or a window is, with every other and with the prisms. A face standing on the floor (facing
 * down at the wall's foot) is never seen, and is not compared either.
 */
function coplanarPieces(g: THREE.Object3D): string[] {
  const meshes = trianglesOf(g);
  const onFloor = (t: Tri) => t.n.y < -1 + 1e-6 && t.p.every((q) => Math.abs(q.y) < PLANE_TOLERANCE);
  const seen = (tris: Tri[]) => tris.filter((t) => !onFloor(t));
  const found: string[] = [];
  const name = (m: THREE.Mesh) => `${(Array.isArray(m.material) ? m.material[m.material.length - 1] : m.material).name}@${m.position.y.toFixed(3)}`;
  for (let i = 0; i < meshes.length; i++) {
    for (let j = i + 1; j < meshes.length; j++) {
      const [a, b] = [meshes[i], meshes[j]];
      if (a.mesh.geometry.userData[PRISM_SOLID] && b.mesh.geometry.userData[PRISM_SOLID]) continue;
      const hit = seen(a.tris).some((s) => seen(b.tris).some((t) => s.n.dot(t.n) > 1 - 1e-6 && Math.abs(s.d - t.d) < PLANE_TOLERANCE && sharedArea(s, t) > AREA_TOLERANCE));
      if (hit) found.push(`${name(a.mesh)} / ${name(b.mesh)}`);
    }
  }
  return found;
}

describe("the pieces of a door or a window", () => {
  const w = wall("w", 0, 0, 12, 0);
  const pieces: Opening[] = [
    opening("win", "w", "window", 0.12, 1.2, 0.9, 1.2),
    opening("door", "w", "door", 0.3, 0.9, 0, 2.1, { hinge: "a", side: "right" }),
    opening("double", "w", "door", 0.48, 1.6, 0, 2.1, { side: "left" }),
    opening("garage", "w", "door", 0.75, 2.6, 0, 2.1, { style: "garage" }),
  ];

  it("stand in their vano with no two faces in one plane: the sill under the frame, the masonry under the sill", () => {
    const g = buildWall(w, pieces, wallBands(w, [w]), new Set(["win"]));
    expect(coplanarPieces(g)).toEqual([]);
    // the masonry under the window stops at the stone's underside, and the stone's top is the frame's foot
    const plan = planWall(w, pieces, wallBands(w, [w]));
    const under = plan.body.find((p) => p.y0 === 0 && p.y1 < 0.9);
    expect(under?.y1).toBeCloseTo(0.9 - OPENING_PIECES.sill.thickness, 9);
    const stone = new THREE.Box3();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === "surface:stone") stone.setFromObject(m);
    });
    expect(stone.max.y).toBeCloseTo(0.9, 6);
    expect(stone.min.y).toBeCloseTo(0.9 - OPENING_PIECES.sill.thickness, 6);
  });

  it("stand clear in a curved wall too, and in every wall of the Crescent House", () => {
    const curve = wall("arc", 0, 0, 6, 0, { bulge: bulgeFromSagitta({ x: 0, y: 0 }, { x: 6, y: 0 }, 1) });
    const g = buildWall(curve, [opening("cw", "arc", "window", 0.3, 1.2, 0.9, 1.2), opening("cd", "arc", "door", 0.7, 0.9, 0, 2.1)], wallBands(curve, [curve]), new Set(["cw"]));
    expect(coplanarPieces(g)).toEqual([]);
    const house = seedCrescent();
    const byWall = openingsByWall(house);
    for (const info of levelsOf(house)) {
      const slice = levelSlice(house, info.level.id);
      const curtained = curtainedWindows(slice, byWall);
      for (const hw of slice.walls) {
        const openings = byWall.get(hw.id) ?? [];
        if (openings.length === 0) continue;
        const built = buildWall(hw, openings, wallBands(hw, slice.walls), curtained, { posts: wallPosts(hw, slice.columns), inside: new Map() });
        expect(coplanarPieces(built), hw.id).toEqual([]);
      }
    }
  });

  it("is a check that finds the old fault: a sill's top half a millimetre over the masonry", () => {
    const g = buildWall(w, [pieces[0]], wallBands(w, [w]), new Set());
    // put the stone back where it was: its top 0.5 mm over the masonry, which ran up to the frame
    const plan = planWall(w, [pieces[0]], wallBands(w, [w]));
    const masonry = plan.body.find((p) => p.y0 === 0 && p.y1 < 0.9)!;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === "surface:stone") m.position.y = masonry.y1 + 0.0005 - OPENING_PIECES.sill.thickness / 2;
    });
    expect(coplanarPieces(g).some((pair) => pair.includes("surface:stone"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------- columns

describe("a column in the model", () => {
  it("stands from its floor to the underside of the slab over it, as its section", () => {
    const m: PlanModel = { ...emptyModel(), columns: [column("c", 2, 3, { shape: "rectangle", w: 0.5, d: 0.25, rotation: 30 })] };
    const c = m.columns[0];
    const h = columnHeight(m, c)!;
    const g = buildColumn(c, h);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(h, 6);
    // its corners are the plan's: the section's footprint, turned as it stands
    const mesh = g.children[0] as THREE.Mesh;
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute("position");
    const corners = columnFootprint(c);
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      expect(Math.min(...corners.map((q) => Math.hypot(q.x - p.x, q.y - p.z)))).toBeLessThan(1e-6);
    }
  });

  it("is round as the plan's polygon is, its cut its section, and lined only at its rims", () => {
    const c = column("r", 0, 0, { shape: "circle", w: 0.4, d: 0.4 });
    const g = buildColumn(c, 2.7);
    const mesh = g.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    const corners = columnFootprint(c);
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = [pos.getX(i), pos.getZ(i)];
      // the cylinder's centre vertices of its caps aside, every vertex is a corner of the plan's polygon
      if (Math.hypot(x, z) < 1e-9) continue;
      expect(Math.min(...corners.map((q) => Math.hypot(q.x - x, q.y - z)))).toBeLessThan(1e-6);
    }
    const cap = columnCutCap(c, 2.7, 1.2)!;
    const cp = cap.geometry.getAttribute("position");
    let area = 0;
    for (let i = 0; i < cp.count; i += 3) {
      const [ax, az, bx, bz, cx, cz] = [cp.getX(i), cp.getZ(i), cp.getX(i + 1), cp.getZ(i + 1), cp.getX(i + 2), cp.getZ(i + 2)];
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      expect(cp.getY(i)).toBeCloseTo(1.2, 6);
    }
    const polygon = Math.abs(corners.reduce((s, p, i) => s + p.x * corners[(i + 1) % corners.length].y - corners[(i + 1) % corners.length].x * p.y, 0)) / 2;
    expect(area).toBeCloseTo(polygon, 6);
    expect(area).toBeCloseTo(columnArea(c), 2);
    expect(columnCutCap(c, 2.7, 3)).toBeNull();
    // its ink: the two rims, never a facet of its side
    g.updateMatrixWorld(true);
    addInkEdges(g, false, [], "cut");
    const lines = g.children.find((o) => o.name === INK_EDGE) as THREE.LineSegments;
    const lp = lines.geometry.getAttribute("position");
    for (let i = 0; i < lp.count; i += 2) expect(Math.abs(lp.getY(i) - lp.getY(i + 1))).toBeLessThan(1e-9);
  });

  it("takes the stretch of a wall it fills the thickness of: the wall stops at its faces, a narrower one stands inside it", () => {
    const w = wall("w", 0, 0, 6, 0);
    const end = column("end", 6, 0);
    const mid = column("mid", 3, 0, { shape: "circle", w: 0.4, d: 0.4 });
    const slim = column("slim", 1.5, 0, { w: 0.25, d: 0.15 });
    const posts = wallPosts(w, [end, mid, slim]);
    expect(posts).toHaveLength(2);
    const len = wallLength(w);
    // the square one at the end: from its west face on
    expect(posts.find((p) => p.t1 > 1)!.t0 * len).toBeCloseTo(6 - 0.15, 9);
    // the round one: where both faces of the wall enter the circle
    const round = posts.find((p) => p.t0 > 0 && p.t1 < 1)!;
    const half = Math.sqrt(0.2 * 0.2 - 0.1 * 0.1);
    expect(round.t0 * len).toBeLessThan(3 - half + 1e-3);
    expect(round.t1 * len).toBeGreaterThan(3 + half - 1e-3);
    expect(round.t0 * len).toBeGreaterThan(3 - 0.2);
    const plan = planWall(w, [], wallBands(w, [w]), posts);
    // two stretches of masonry, and of the band on top: none of them in either column
    const full = plan.body.filter((p) => p.y0 === 0 && p.y1 === w.height);
    expect(full).toHaveLength(2);
    expect(plan.cap).toHaveLength(2);
    const xs = (runs: (typeof full)[number]["runs"]) => runs.flatMap((r) => r.pts.map((p) => p.x));
    for (const piece of [...full, ...plan.cap]) {
      const along = xs(piece.runs);
      expect(Math.max(...along) <= 6 - 0.15 + 0.002, "past the end column's face").toBe(true);
      expect(Math.max(...along) <= 3 - half + 0.002 || Math.min(...along) >= 3 + half - 0.002, "into the round column").toBe(true);
    }
  });

  it("leaves the wall whole over a column that stops under its top, as over a doorway", () => {
    const w = wall("w", 0, 0, 6, 0);
    const plan = { levels: [{ id: G, name: "Ground floor", height: 2.9 }] };
    const short = column("short", 3, 0, { height: 1 });
    const [post] = wallPosts(w, [short], plan);
    expect(post.top).toBe(1);
    // a column to the slab, as tall as the wall or taller, takes the wall's whole height
    expect(wallPosts(w, [column("tall", 3, 0)], plan)[0].top).toBeUndefined();
    const built = planWall(w, [], wallBands(w, [w]), [post]);
    // the two stretches either side from the floor, and one over the column from its top up
    expect(built.body.filter((p) => p.y0 === 0 && p.y1 === w.height)).toHaveLength(2);
    const over = built.body.filter((p) => p.y0 === 1 && p.y1 === w.height);
    expect(over).toHaveLength(1);
    const along = over[0].runs.flatMap((r) => r.pts.map((p) => p.x));
    expect(Math.min(...along)).toBeLessThan(3 - 0.1);
    expect(Math.max(...along)).toBeGreaterThan(3 + 0.1);
    // the band on top runs on over it, unbroken
    expect(built.cap).toHaveLength(1);
  });

  it("is built in the scene with its level, picked, marked, cut and walked round", () => {
    const house = seedCrescent();
    const scene = new PlanScene();
    scene.update(house);
    expect(scene.counts.columns).toBe(house.columns.length);
    expect(house.columns.length).toBeGreaterThan(0);
    for (const c of house.columns) {
      const object = scene.objects.find((o) => o.userData.entity === `column:${c.id}`)!;
      expect(object, c.id).toBeDefined();
      expect(scene.entityOf(object.children[0])).toEqual({ type: "column", id: c.id, levelId: c.levelId });
      const box = new THREE.Box3().setFromObject(object);
      expect(box.max.y - box.min.y).toBeCloseTo(columnHeight(house, c)!, 6);
      // the carport's columns carry the studio: they reach the underside of its slab
      expect(columnHeight(house, c)).toBeCloseTo(levelsOf(house)[0].level.height - SLAB_THICKNESS, 9);
      const mark = markBox("column", c.id, house)!;
      expect([mark.cx, mark.cz, mark.w, mark.d, mark.y1]).toEqual([c.x, c.y, c.w, c.d, columnHeight(house, c)]);
    }
    // cut, each column is closed in the poché at the cut; uncut, not
    expect(scene.setCut(1.2)).toBe(true);
    for (const c of house.columns) expect(scene.objects.find((o) => o.userData.entity === `column:${c.id}`)!.getObjectByName("cut-cap"), c.id).toBeDefined();
    scene.setCut(null);
    for (const c of house.columns) expect(scene.objects.find((o) => o.userData.entity === `column:${c.id}`)!.getObjectByName("cut-cap"), c.id).toBeUndefined();
    // the walker cannot stand in one, a round one is a disc
    const b = blockersFor(levelSlice(house, G));
    const c0 = house.columns[0];
    expect(blocked(b, c0.x, c0.y, () => 0)).toBe(true);
    const round = blockersFor({ ...emptyModel(), columns: [column("r", 0, 0, { shape: "circle", w: 0.4, d: 0.4 })] });
    // just past the disc (and the walker's reach) at 45 degrees, inside the square round it
    const r = 0.2 + 0.3 + 0.02;
    expect(blocked(round, r / Math.SQRT2, r / Math.SQRT2, () => 0)).toBe(false);
    expect(blocked(round, r - 0.04, 0, () => 0)).toBe(true);
    scene.dispose();
  });

  it("is rebuilt when it moves, and so is the wall it stands in; nothing else is", () => {
    const w = wall("w", 0, 0, 6, 0);
    const m: PlanModel = { ...emptyModel(), walls: [w, wall("v", 0, 0, 0, 4)], columns: [column("c", 6, 0)] };
    const scene = new PlanScene();
    scene.update(m);
    const moved = scene.update({ ...m, columns: [column("c", 6.05, 0)] });
    expect(moved.rebuilt).toBe(2);
    expect(moved.kept).toBe(1);
    scene.dispose();
  });
});

// ---------------------------------------------------------------------------- open ground

describe("the slab over open ground", () => {
  const house = seedCrescent();
  const overhang = overhangOf(house, CRESCENT_FIRST_LEVEL_ID);

  it("has its underside, the soffit, and its edge over the carport", () => {
    const area = piecesArea(regionPieces(overhang.include, overhang.exclude));
    expect(area).toBeGreaterThan(5);
    const scene = new PlanScene();
    scene.update(house);
    const slab = scene.objects.find((o) => o.userData.entity === `slab:${CRESCENT_FIRST_LEVEL_ID}`)!;
    expect(slab).toBeDefined();
    // the down-facing faces at the slab's underside cover the overhang
    const studio = house.rooms.find((r) => r.id === "f_room_studio")!;
    const xs = studio.points.map((p) => p.x);
    const ys = studio.points.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const ray = new THREE.Raycaster();
    slab.parent!.updateMatrixWorld(true);
    const elevation = slab.parent!.position.y;
    for (const [x, z] of [
      [(x0 + x1) / 2, (y0 + y1) / 2],
      [x1 - 0.3, y0 + 0.3],
      [x1 - 0.3, y1 - 0.3],
    ]) {
      // from under the carport, looking up: the first thing met is the soffit, at the slab's underside
      ray.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, 1, 0));
      const hit = ray.intersectObject(slab, true)[0];
      expect(hit, `${x},${z}`).toBeDefined();
      expect(hit.point.y).toBeCloseTo(elevation - SLAB_THICKNESS, 6);
      expect(hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).y).toBeLessThan(-0.99);
    }
    // from the east, at the slab's mid-depth: its edge, facing out, on the studio's east line
    ray.set(new THREE.Vector3(x1 + 5, elevation - SLAB_THICKNESS / 2, (y0 + y1) / 2), new THREE.Vector3(-1, 0, 0));
    const edge = ray.intersectObject(slab, true)[0];
    expect(edge).toBeDefined();
    expect(edge.point.x).toBeGreaterThan(x1 - 0.01);
    scene.dispose();
  });

  it("is over an open room the carport is, with no pendant hanging in it and a concrete floor", () => {
    const carport = house.rooms.find((r) => r.kind === "open")!;
    expect(carport).toBeDefined();
    expect(carport.floor).toBe("concrete");
    const scene = new PlanScene();
    scene.update(house);
    expect(scene.objects.some((o) => o.userData.entity === `pendant:${carport.id}`)).toBe(false);
    expect(scene.objects.some((o) => o.userData.entity === `floor:${carport.id}`)).toBe(true);
    scene.dispose();
  });
});

// ---------------------------------------------------------------------------- garage doors

describe("a garage door", () => {
  const w = wall("w", 0, 0, 6, 0);
  const door = opening("gd", "w", "door", 0.5, 2.6, 0, 2.1, { style: "garage" });
  // the garage is south of the wall: +y on the plan, the chord's right
  const garage: Room = { id: "garage", levelId: G, label: "Garage", floor: "concrete", points: rectOutline(0, 0, 6, 5) };
  const m: PlanModel = { ...emptyModel(), walls: [w], openings: [door], rooms: [garage] };
  const doorGroup = (g: THREE.Object3D) => {
    let found: THREE.Object3D | null = null;
    g.traverse((o) => {
      if (o.userData.garage) found = o;
    });
    return found! as THREE.Object3D;
  };

  it("opens into the garage, whichever side of the wall that is", () => {
    expect(garageInside(w, door, [garage])).toBe(1);
    expect(garageInside(w, door, [{ ...garage, points: rectOutline(0, -5, 6, 5) }])).toBe(-1);
    // an enclosed room before an open one: the garage, not the drive in front of it
    expect(garageInside(w, door, [garage, { ...garage, id: "drive", kind: "open", points: rectOutline(0, -5, 6, 5) }])).toBe(1);
  });

  it("is sections under the head, upright when shut and flat under the ceiling inside when open; no leaf swings", () => {
    const g = buildWall(w, [door], wallBands(w, [w]), new Set(), { posts: [], inside: new Map([["gd", 1]]) });
    const d = doorGroup(g);
    expect(d.userData.doorHinge).toBe(true);
    expect(d.userData.swing).toBe(0);
    let hinges = 0;
    g.traverse((o) => o.userData.doorHinge && hinges++);
    expect(hinges).toBe(1);
    const top = door.height - OPENING_PIECES.doorFrame - GARAGE_DOOR_MODEL.gap;
    expect(d.children).toHaveLength(Math.round(top / GARAGE_DOOR_MODEL.section));
    g.updateMatrixWorld(true);
    const shut = new THREE.Box3().setFromObject(d);
    expect(shut.max.y).toBeLessThanOrEqual(door.height - OPENING_PIECES.doorFrame + 1e-9);
    expect(shut.min.y).toBeCloseTo(0, 6);
    // between the jambs, within the wall's depth, toward its inside face
    expect(shut.max.x - shut.min.x).toBeCloseTo(door.width - 2 * OPENING_PIECES.doorFrame, 6);
    for (const s of d.children) expect(s.rotation.x).toBe(0);
    expect(coplanarPieces(g)).toEqual([]);
    poseGarageDoor(d, 1);
    g.updateMatrixWorld(true);
    for (const s of d.children) expect(Math.abs(s.rotation.x)).toBeCloseTo(Math.PI / 2, 9);
    const open = new THREE.Box3().setFromObject(d);
    expect(open.max.y).toBeLessThanOrEqual(top + 1e-6);
    expect(open.min.y).toBeGreaterThan(top - 2 * GARAGE_DOOR_MODEL.thickness - 0.01);
    // run back into the garage (the wall's +z side, south on the plan), as deep as the door was tall
    expect(open.max.z).toBeGreaterThan(top - 0.1);
    expect(open.min.z).toBeGreaterThan(-0.1);
    // half way, some sections still stand and some lie flat
    poseGarageDoor(d, 0.5);
    const turns = d.children.map((s) => Math.abs(s.rotation.x));
    expect(turns[0]).toBe(0);
    expect(turns[turns.length - 1]).toBeCloseTo(Math.PI / 2, 9);
    // never under the floor or over the head on its way
    for (let k = 0; k <= 20; k++) {
      poseGarageDoor(d, k / 20);
      g.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(d);
      expect(b.min.y, `${k}`).toBeGreaterThan(-1e-6);
      expect(b.max.y, `${k}`).toBeLessThanOrEqual(top + 1e-6);
    }
  });

  it("is raised and lowered by set_doors in the scene, and walked through only when up", () => {
    const scene = new PlanScene();
    scene.update(m);
    const leaf = scene.doors.find((l) => l.doorId === "gd")!;
    expect(leaf).toBeDefined();
    expect(scene.setDoors({ state: "open", id: "gd" }, true)).toBe(true);
    for (const s of leaf.hinge.children) expect(Math.abs(s.rotation.x)).toBeCloseTo(Math.PI / 2, 9);
    expect(scene.setDoors({ state: "closed", id: "gd" }, true)).toBe(true);
    for (const s of leaf.hinge.children) expect(s.rotation.x).toBe(0);
    const b = blockersFor(m);
    expect(blocked(b, 3, 0, () => 0)).toBe(true);
    expect(blocked(b, 3, 0, () => 1)).toBe(false);
    // rebuilt when its style changes: a swinging door has leaves that swing
    scene.update({ ...m, openings: [{ ...door, style: "swing", width: 0.9 }] });
    expect(scene.doors.every((l) => l.swing !== 0)).toBe(true);
    scene.dispose();
  });

  it("stands in the Crescent House's carport, opening under the studio", () => {
    const house = seedCrescent();
    const scene = new PlanScene();
    scene.update(house);
    const leaf = scene.doors.find((l) => l.doorId === "g_garage_door")!;
    expect(leaf).toBeDefined();
    expect(leaf.hinge.userData.garage.inside).toBeDefined();
    // the carport is south of its north wall: the door runs back over it
    const gd = house.openings.find((o) => o.id === "g_garage_door")!;
    const carportWall = house.walls.find((x) => x.id === gd.wallId)!;
    expect(garageInside(carportWall, gd, house.rooms)).toBe(1);
    expect(gd.width).toBeGreaterThanOrEqual(GARAGE_DOOR.width.min);
    scene.dispose();
  });
});

// ---------------------------------------------------------------------------- the car

describe("the car", () => {
  const def = BUILT_IN_KINDS.find((k) => k.kind === "car")!;

  it("is a car's real size, low-poly, standing on its wheels", () => {
    expect([def.w, def.d, def.h]).toEqual([1.8, 4.5, 1.5]);
    const piece = buildFurniture(def);
    const box = new THREE.Box3().setFromObject(piece);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(def.w, 2);
    expect(size.y).toBeCloseTo(def.h, 2);
    expect(size.z).toBeCloseTo(def.d, 2);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(pieceTriangles(piece)).toBeLessThanOrEqual(FURNITURE_STYLE.budget.car ?? FURNITURE_STYLE.budget.default);
  });

  it("has pillars between its windows and a tail lamp each side of its back, its glass not the hob's black", () => {
    const piece = buildFurniture(def);
    piece.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    piece.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const materials = new Set(meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
    expect(materials.has(staticSurface("ceramic", FURNITURE.carGlass.hex))).toBe(true);
    expect(materials.has(staticSurface("ceramic", FURNITURE.hobGlass.hex))).toBe(false);
    const c = FURNITURE_STYLE.car;
    const cabin = (def.w - 2 * c.wheelProud) * c.cabinWidthFraction;
    // the pillars' outer faces: out of the glass's sides, short of the roof's, between the belt and the roof
    const v = new THREE.Vector3();
    let pillarCorners = { left: 0, right: 0 };
    let tail = 0;
    for (const m of meshes) {
      const pos = m.geometry.getAttribute("position");
      const box = new THREE.Box3().setFromObject(m);
      if (box.max.z <= -def.d / 2 + c.lampDepth + 1e-6) tail++;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y <= def.h * 0.6 || v.y >= def.h * 0.965 + 1e-6) continue;
        if (Math.abs(Math.abs(v.x) - (cabin / 2 + c.pillarProud)) > 1e-4) continue;
        pillarCorners = v.x > 0 ? { ...pillarCorners, right: pillarCorners.right + 1 } : { ...pillarCorners, left: pillarCorners.left + 1 };
      }
    }
    expect(pillarCorners.left).toBeGreaterThan(0);
    expect(pillarCorners.right).toBeGreaterThan(0);
    // the tail lamps, at its back, as the lamps are at its nose
    expect(tail).toBeGreaterThan(0);
  });

  it("keeps the carport's name off the car parked there", () => {
    const house = seedCrescent();
    const carport = house.rooms.find((r) => r.id === "g_room_carport")!;
    const parked = parkedIn(house, carport);
    expect(parked).toHaveLength(1);
    const [car] = parked;
    const at = labelAnchor(carport, parked);
    const grown = { ...car, hw: car.hw + LABELS.itemClear - 1e-6, hd: car.hd + LABELS.itemClear - 1e-6 };
    expect(pointInORect({ x: at.x, y: at.z }, grown)).toBe(false);
    expect(pointInOutline({ x: at.x, y: at.z }, carport.points)).toBe(true);
    // without the car it stands where it always did, which is on the car
    const plain = labelAnchor(carport);
    expect(pointInORect({ x: plain.x, y: plain.z }, car)).toBe(true);
    // a room with no car keeps its spot
    const studio = house.rooms.find((r) => r.id === "f_room_studio")!;
    expect(labelAnchor(studio, parkedIn(house, studio))).toEqual(labelAnchor(studio));
  });

  it("is something the walker walks round", () => {
    const house = seedCrescent();
    const car = house.items.find((i) => i.kind === "car")!;
    expect(blocked(blockersFor(levelSlice(house, car.levelId)), car.x, car.y, () => 0)).toBe(true);
  });
});
