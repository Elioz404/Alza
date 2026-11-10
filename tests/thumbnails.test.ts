/**
 * Catalogue thumbnails are drawn and read back in the same task, so their renderer needs no
 * preserveDrawingBuffer (which costs on every frame); and a piece drawn for a thumbnail leaves
 * nothing behind — its geometries at once, its shared materials once the batch is done.
 * WebGL is replaced by a recorder; everything else is real three.js.
 */
import { describe, expect, it, vi } from "vitest";
import type * as THREE_NS from "three";
import { BUILT_IN_KINDS } from "../src/model/catalog";
import { flush } from "./support/store";

const gl = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  log: [] as string[],
  drawn: [] as THREE_NS.Object3D[],
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE_NS>();
  class RecordingRenderer {
    toneMapping = 0;
    toneMappingExposure = 1;
    domElement = {
      toDataURL: () => {
        gl.log.push("read");
        return `data:image/png;base64,${gl.log.length}`;
      },
    };
    constructor(options: Record<string, unknown> = {}) {
      gl.options.push(options);
    }
    setPixelRatio() {}
    setSize() {}
    render(scene: THREE_NS.Scene) {
      gl.log.push("render");
      gl.drawn.push(...scene.children.filter((c) => c.type === "Group"));
    }
  }
  return { ...actual, WebGLRenderer: RecordingRenderer };
});

const { thumbnailFor } = await import("../src/three/thumbnails");

describe("thumbnailFor", () => {
  it("draws on a renderer without preserveDrawingBuffer and reads the frame back in the same call", () => {
    const sofa = BUILT_IN_KINDS.find((k) => k.kind === "sofa")!;
    const url = thumbnailFor(sofa);
    expect(url).toMatch(/^data:image\/png/);
    expect(gl.options).toHaveLength(1);
    expect(gl.options[0]).not.toHaveProperty("preserveDrawingBuffer");
    expect(gl.log).toEqual(["render", "read"]);
  });

  it("is cached by definition", () => {
    const sofa = BUILT_IN_KINDS.find((k) => k.kind === "sofa")!;
    const before = gl.log.length;
    thumbnailFor(sofa);
    expect(gl.log.length).toBe(before);
  });

  it("frees every piece it drew: geometries at once, materials once the batch is done", async () => {
    const THREE = await import("three");
    const { isStatic } = await import("../src/three/materials");
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    gl.drawn.length = 0;
    const pieces = BUILT_IN_KINDS.filter((k) => k.kind !== "sofa");
    const geometries = new Set<THREE_NS.BufferGeometry>();
    const materials = new Set<THREE_NS.Material>();
    const disposed = new Set<THREE_NS.Material>();
    for (const def of pieces) {
      thumbnailFor(def);
      const piece = gl.drawn.at(-1)!;
      expect(piece.parent).toBeNull(); // taken back out of the thumbnail scene
      piece.traverse((o) => {
        const mesh = o as THREE_NS.Mesh;
        if (!mesh.geometry) return;
        geometries.add(mesh.geometry);
        const m = mesh.material as THREE_NS.Material;
        if (materials.has(m)) return;
        materials.add(m);
        m.addEventListener("dispose", () => disposed.add(m));
      });
    }
    expect(gl.drawn).toHaveLength(pieces.length);
    // every geometry was disposed before thumbnailFor returned
    const gone = new Set(disposeGeometry.mock.contexts);
    expect([...geometries].filter((g) => !gone.has(g))).toEqual([]);
    // the batch's shared surfaces go once it is over; only the static finishes remain
    expect(disposed.size).toBe(0);
    await flush();
    expect([...materials].filter((m) => !disposed.has(m)).every((m) => isStatic(m))).toBe(true);
    expect(disposed.size).toBeGreaterThan(0);
    disposeGeometry.mockRestore();
  });
});
