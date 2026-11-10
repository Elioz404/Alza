/**
 * The built-in pieces (src/three/furniture.ts): each fills its catalogue box w × h × d, faces
 * +z, stays inside its triangle and draw-call budgets (src/three/furnitureStyle.ts), is drawn
 * with the shared surfaces, and shares its geometry with every other piece of its definition
 * until the last of them is disposed. No WebGL: these are plain three.js objects.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { buildFurniture, pieceTriangles, sharedModelCount } from "../src/three/furniture";
import { FURNITURE_STYLE, riseOf } from "../src/three/furnitureStyle";
import { chamferBox, cushion, hardBox, mergePlaced, plate, rectOutline, triangleCount } from "../src/three/furnitureShapes";
import { MaterialCache, disposeObject, isStatic, materialsOf } from "../src/three/materials";
import { SURFACE_NAMES } from "../src/three/surfaces";
import { SURFACES } from "../src/three/config";
import type { KindDef } from "../src/model/types";

const { fit, budget, drawCalls } = FURNITURE_STYLE;
const kind = (k: string) => BUILT_IN_KINDS.find((d) => d.kind === k)!;
const meshesOf = (root: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  return meshes;
};
const surfaceOf = (m: THREE.Mesh) => (m.material as THREE.Material).userData.surface as string;

/** Build a piece, hand it to `inspect`, then dispose it so its shared geometry goes with it. */
function withPiece<T>(def: KindDef, inspect: (piece: THREE.Group) => T, cache?: MaterialCache): T {
  const piece = buildFurniture(def, cache);
  try {
    return inspect(piece);
  } finally {
    disposeObject(piece, cache);
  }
}

describe("every built-in piece", () => {
  it.each(BUILT_IN_KINDS.map((d) => [d.kind, d] as const))("%s fills its catalogue box", (_, def) => {
    withPiece(def, (piece) => {
      const box = new THREE.Box3().setFromObject(piece);
      const size = box.getSize(new THREE.Vector3());
      // its body is the box exactly; a tap, a television, a headboard stand over it by the kind's rise
      const body = piece.userData.body as number[];
      expect(Math.abs(body[0] - def.w)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(body[1] - def.h)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(body[2] - def.d)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(size.x - def.w)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(size.y - (def.h + riseOf(def)))).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(size.z - def.d)).toBeLessThanOrEqual(fit.tolerance);
      // standing on the floor, centred on its footprint
      expect(Math.abs(box.min.y)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThanOrEqual(fit.tolerance);
      expect(Math.abs(box.min.z + box.max.z)).toBeLessThanOrEqual(fit.tolerance);
      // and the design already had those proportions: fitting it to the box barely scaled it
      for (const s of piece.userData.fit as number[]) expect(Math.abs(s - 1)).toBeLessThanOrEqual(fit.maxScale);
    });
  });

  it.each(BUILT_IN_KINDS.map((d) => [d.kind, d] as const))("%s stays inside its triangle and draw-call budget", (k, def) => {
    withPiece(def, (piece) => {
      expect(pieceTriangles(piece)).toBeLessThanOrEqual(budget[k] ?? budget.default);
      expect(meshesOf(piece).length).toBeLessThanOrEqual(drawCalls);
    });
  });

  it("is baked to one mesh per surface (and per shadow casting), not one per part", () => {
    for (const def of BUILT_IN_KINDS) {
      withPiece(def, (piece) => {
        const keys = meshesOf(piece).map((m) => `${(m.material as THREE.Material).uuid}|${m.castShadow}`);
        expect(new Set(keys).size, def.kind).toBe(keys.length);
      });
    }
  });

  it("is drawn with the shared named surfaces, the patterned ones with texture coordinates", () => {
    const names = new Set<string>(SURFACE_NAMES);
    for (const def of BUILT_IN_KINDS) {
      withPiece(def, (piece) => {
        for (const mesh of meshesOf(piece)) {
          const name = surfaceOf(mesh);
          expect(names.has(name), `${def.kind}: ${name}`).toBe(true);
          if ((SURFACES[name as keyof typeof SURFACES] as { pattern?: string }).pattern) {
            expect(mesh.geometry.getAttribute("uv"), `${def.kind}: ${name}`).toBeTruthy();
          }
        }
      });
    }
  });

  it("faces +z: handles and pulls on the front, a seat's back at the back", () => {
    for (const k of ["sideboard", "wardrobe", "nightstand", "counter_unit", "kitchen_sink_unit", "fridge"]) {
      withPiece(kind(k), (piece) => {
        const fittings = meshesOf(piece).filter((m) => ["brass", "chrome", "metal"].includes(surfaceOf(m)) && m.geometry.boundingBox!.max.z > 0);
        expect(fittings.length, k).toBeGreaterThan(0);
        const box = new THREE.Box3();
        for (const m of fittings) box.union(m.geometry.boundingBox!);
        // at the front face (a kitchen's under the worktop's overhang)
        expect(box.max.z, k).toBeGreaterThanOrEqual(kind(k).d / 2 - FURNITURE_STYLE.kitchen.carcassDepthInset - fit.tolerance);
      });
    }
    for (const k of ["sofa", "sofa_3", "armchair", "dining_chair", "office_chair", "bed_double", "bed_single"]) {
      const def = kind(k);
      withPiece(def, (piece) => {
        // what stands highest (a back, a headboard) stands toward -z
        let sum = 0;
        let n = 0;
        const p = new THREE.Vector3();
        for (const m of meshesOf(piece)) {
          const position = m.geometry.getAttribute("position");
          for (let i = 0; i < position.count; i++) {
            p.fromBufferAttribute(position, i);
            if (p.y > def.h * 0.9) {
              sum += p.z;
              n++;
            }
          }
        }
        expect(n, k).toBeGreaterThan(0);
        expect(sum / n, k).toBeLessThan(-def.d / 8);
      });
    }
  });

  it("casts shadows except where it cannot: the rug lies flat, glass and water let light through", () => {
    withPiece(kind("rug"), (piece) => expect(meshesOf(piece).every((m) => !m.castShadow)).toBe(true));
    for (const k of ["shower", "bathtub"]) {
      withPiece(kind(k), (piece) => {
        for (const m of meshesOf(piece)) {
          const see = ["glass", "water"].includes(surfaceOf(m));
          expect(m.castShadow, `${k}: ${surfaceOf(m)}`).toBe(!see);
        }
      });
    }
    withPiece(kind("sofa"), (piece) => expect(meshesOf(piece).every((m) => m.castShadow && m.receiveShadow)).toBe(true));
  });
});

describe("the shapes", () => {
  it("the oval dining table's top is a true ellipse, w by d", () => {
    const def = kind("dining_table_oval");
    withPiece(def, (piece) => {
      const top = meshesOf(piece).find((m) => surfaceOf(m) === "lightWood")!; // the honey top; the pedestal is lacquer
      const position = top.geometry.getAttribute("position");
      const p = new THREE.Vector3();
      let outer = 0;
      let rim = 0;
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i);
        const r = (p.x / (def.w / 2)) ** 2 + (p.z / (def.d / 2)) ** 2;
        outer = Math.max(outer, r);
        if (r > 0.995) rim++;
      }
      expect(outer).toBeLessThanOrEqual(1 + 1e-3);
      // the outline is on the ellipse all the way round, not at four points of a box
      expect(rim).toBeGreaterThanOrEqual(FURNITURE_STYLE.segments.outline);
    });
  });

  it("turned parts are round: the side table's column and the lamp's shade are lathed", () => {
    for (const [k, surface] of [
      ["side_table", "oak"],
      ["floor_lamp", "linen"],
    ] as const) {
      withPiece(kind(k), (piece) => {
        const turned = meshesOf(piece).filter((m) => surfaceOf(m) === surface);
        expect(turned.length, k).toBeGreaterThan(0);
        // a lathed part's ring of vertices at one height is equidistant from the axis
        const p = new THREE.Vector3();
        const rings = new Map<string, number[]>();
        for (const m of turned) {
          const position = m.geometry.getAttribute("position");
          for (let i = 0; i < position.count; i++) {
            p.fromBufferAttribute(position, i);
            const key = p.y.toFixed(4);
            rings.set(key, [...(rings.get(key) ?? []), Math.hypot(p.x, p.z)]);
          }
        }
        const round = [...rings.values()].filter((r) => r.length >= FURNITURE_STYLE.segments.medium);
        expect(round.length, k).toBeGreaterThan(0);
      });
    }
  });

  it("cushions are soft: rounded edges and a top that sags toward the middle", () => {
    const [w, h, d, r, sag] = [0.8, 0.14, 0.6, 0.05, 0.02];
    const g = cushion(w, h, d, r, sag);
    const position = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
    expect(box.max.x - box.min.x).toBeCloseTo(w, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(d, 6);
    // normals lean between two axes on the rounded edges, not only along one (a box's)
    let leaning = 0;
    let middle = Infinity;
    for (let i = 0; i < normal.count; i++) {
      const [x, y, z] = [normal.getX(i), normal.getY(i), normal.getZ(i)].map(Math.abs);
      if (Math.max(x, y, z) < 0.95) leaning++;
      if (Math.abs(position.getX(i)) < 1e-6 && Math.abs(position.getZ(i)) < 1e-6 && normal.getY(i) > 0) middle = position.getY(i);
    }
    expect(leaning).toBeGreaterThan(normal.count / 10);
    // the middle of the top is sat in by the sag; the flat top's edge is not
    expect(middle).toBeCloseTo(h / 2 - sag, 6);
    expect(box.max.y).toBeGreaterThan(middle);
    // and a hard part's bevel is small: its faces stay flat to within the bevel
    const hard = hardBox(0.5, 0.3, 0.4);
    const hb = new THREE.Box3().setFromBufferAttribute(hard.getAttribute("position") as THREE.BufferAttribute);
    expect(hb.max.y).toBeCloseTo(0.15, 6);
  });

  it("a hard part's chamfered box is closed, wound outward, and cheap", () => {
    const [w, h, d, r] = [0.5, 0.3, 0.4, 0.01];
    const g = chamferBox(w, h, d, r);
    expect(triangleCount(g)).toBe(44);
    const position = g.getAttribute("position");
    const index = g.index!;
    const [a, b, c, n, centre] = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
    // every triangle faces away from the middle, and the surface encloses the box's volume
    let volume = 0;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      centre.copy(a).add(b).add(c).divideScalar(3);
      expect(n.dot(centre)).toBeGreaterThan(0);
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    // a box less what the chamfers cut off its edges and corners
    expect(volume).toBeLessThan(w * h * d);
    expect(volume).toBeGreaterThan(w * h * d - 2 * r * r * (w + h + d));
    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
    expect(box.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(6))).toEqual([w, h, d]);
  });

  it("a plate cut round a hole is closed, wound outward, and keeps the hole open", () => {
    const [w, d, t] = [1.2, 0.62, 0.04];
    const hole = rectOutline(0.56, 0.4, 0.05, 0.1, 0.02);
    const g = plate(rectOutline(w, d, 0), t, hole, [0.1, 0.02]);
    const position = g.getAttribute("position");
    const index = g.index!;
    const [a, b, c, n] = [0, 1, 2, 3].map(() => new THREE.Vector3());
    let volume = 0;
    let holeArea = 0;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      volume += a.dot(b.clone().cross(c)) / 6;
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      // no top face covers the middle of the cut
      const mid = a.clone().add(b).add(c).divideScalar(3);
      if (n.y > 0 && Math.abs(mid.x - 0.1) < 0.2 && Math.abs(mid.z - 0.02) < 0.12) holeArea += n.length() / 2;
    }
    const cut = 0.56 * 0.4 - (4 - Math.PI) * 0.05 * 0.05;
    expect(volume).toBeCloseTo((w * d - cut) * t, 3);
    expect(holeArea).toBe(0);
    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
    expect(box.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(6))).toEqual([w, t, d]);
  });

  it("the merge bakes each part where it stands, in one index", () => {
    const a = hardBox(0.2, 0.2, 0.2);
    const b = hardBox(0.2, 0.2, 0.2);
    const merged = mergePlaced([
      { geometry: a, matrix: new THREE.Matrix4() },
      { geometry: b, matrix: new THREE.Matrix4().makeTranslation(1, 0, 0) },
    ]);
    expect(triangleCount(merged)).toBe(triangleCount(a) + triangleCount(b));
    const box = new THREE.Box3().setFromBufferAttribute(merged.getAttribute("position") as THREE.BufferAttribute);
    expect(box.min.x).toBeCloseTo(-0.1, 6);
    expect(box.max.x).toBeCloseTo(1.1, 6);
  });
});

describe("shared geometry", () => {
  it("every piece of one definition draws the same geometries", () => {
    const def = kind("dining_chair");
    const a = buildFurniture(def);
    const b = buildFurniture(def);
    expect(meshesOf(a).map((m) => m.geometry)).toEqual(meshesOf(b).map((m) => m.geometry));
    // but each its own meshes, which a scene can move, hide or recolour one by one
    expect(meshesOf(a)[0]).not.toBe(meshesOf(b)[0]);
    disposeObject(a);
    disposeObject(b);
  });

  it("frees a shared geometry with the last piece that draws it, and makes it afresh after", () => {
    const def = kind("armchair");
    const before = sharedModelCount();
    const a = buildFurniture(def);
    const b = buildFurniture(def);
    expect(sharedModelCount()).toBe(before + 1);
    const geometries = meshesOf(a).map((m) => m.geometry);
    const freed = new Set<THREE.BufferGeometry>();
    for (const g of geometries) g.addEventListener("dispose", () => freed.add(g));
    disposeObject(a);
    expect(freed.size).toBe(0); // b still draws them
    disposeObject(b);
    expect(freed.size).toBe(geometries.length);
    expect(sharedModelCount()).toBe(before);
    const c = buildFurniture(def);
    expect(meshesOf(c).some((m) => geometries.includes(m.geometry))).toBe(false);
    disposeObject(c);
  });

  it("shares by definition: a redefined agent kind gets its own geometry", () => {
    const def: KindDef = { kind: "crate", label: "Crate", w: 1, d: 1, h: 1, color: "#887766", category: "decor", source: "custom", parts: [{ shape: "box", w: 1, h: 1, d: 1 }] };
    const a = buildFurniture(def);
    const b = buildFurniture({ ...def, parts: [{ shape: "box", w: 0.5, h: 1, d: 1 }] });
    expect(meshesOf(a)[0].geometry).not.toBe(meshesOf(b)[0].geometry);
    disposeObject(a);
    disposeObject(b);
  });

  it("takes its materials from the cache it is built for, and the same surfaces however it was built", () => {
    const def = kind("sideboard");
    const cache = new MaterialCache();
    withPiece(
      def,
      (scenePiece) => {
        withPiece(def, (owned) => {
          const shared = [...materialsOf(scenePiece)].filter((m) => !isStatic(m));
          expect(shared.every((m) => cache.owns(m))).toBe(true);
          expect([...materialsOf(owned)].some((m) => cache.owns(m))).toBe(false);
          const describe = (p: THREE.Object3D) =>
            meshesOf(p).map((m) => `${surfaceOf(m)}|${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`);
          expect(describe(owned)).toEqual(describe(scenePiece));
        });
      },
      cache,
    );
  });
});

describe("pieces not hand-modelled", () => {
  it("an imported product is blocked out to exactly its box, in its own colour", () => {
    const def: KindDef = { kind: "nordika:NK-1", label: "Shelf", w: 1.2, d: 0.4, h: 0.8, color: "#336699", category: "living", source: "supplier" };
    withPiece(def, (piece) => {
      const size = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(def.w, 3);
      expect(size.y).toBeCloseTo(def.h, 3);
      expect(size.z).toBeCloseTo(def.d, 3);
      const colours = meshesOf(piece).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString());
      expect(colours).toContain("336699");
    });
  });

  it("an agent's soft parts are upholstered like the built-ins, its hard parts bevelled", () => {
    const part = { shape: "box" as const, w: 0.6, h: 0.2, d: 0.6 };
    const def = (material: "fabric" | "wood"): KindDef => ({ kind: `seat_${material}`, label: "Seat", w: 0.6, d: 0.6, h: 0.2, color: "#777777", category: "living", source: "custom", parts: [{ ...part, material }] });
    const soft = withPiece(def("fabric"), (p) => pieceTriangles(p));
    const hard = withPiece(def("wood"), (p) => pieceTriangles(p));
    expect(soft).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThan(12); // not a raw box either
  });
});
