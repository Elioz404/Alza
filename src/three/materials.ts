/**
 * Who owns which GPU resource, and when it is let go.
 *
 * Three kinds of material and texture exist in the 3D view:
 *  - STATIC ones, made once by a module (the wall plaster, the glass, a floor finish's canvas).
 *    Every build shares them and none of them is ever disposed with an object.
 *  - CACHED ones, handed out by a MaterialCache by key — a named surface in a tint
 *    (surfaces.ts). Two pieces of oak furniture, or two oak floors, share one material instead
 *    of each making its own. The cache counts the objects holding each one and disposes it when
 *    the last of them is released.
 *  - OWNED ones: anything else an object was built with (a piece built without a cache).
 *    They go with the object.
 *
 * Textures are the procedural patterns (surfaces.ts): static, one per pattern, shared by all.
 *
 * disposeObject() frees an object's geometries and the materials and textures it owns, so a
 * piece removed from the scene leaves nothing behind on the GPU.
 */

import * as THREE from "three";

const statics = new WeakSet<THREE.Material | THREE.Texture>();

/** Mark a module-level material or texture as shared by every build; it is never disposed with an object. */
export function keepStatic<T extends THREE.Material | THREE.Texture>(resource: T): T {
  statics.add(resource);
  return resource;
}

export const isStatic = (resource: THREE.Material | THREE.Texture): boolean => statics.has(resource);

/** The materials an object's meshes are drawn with, each once. */
export function materialsOf(root: THREE.Object3D): Set<THREE.Material> {
  const found = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) for (const x of m) found.add(x);
    else if (m) found.add(m);
  });
  return found;
}

/** The textures a material samples (its map, normal map, …), each once. */
export function texturesOf(material: THREE.Material): Set<THREE.Texture> {
  const found = new Set<THREE.Texture>();
  for (const value of Object.values(material)) if (value instanceof THREE.Texture) found.add(value);
  return found;
}

interface CacheEntry {
  readonly material: THREE.Material;
  /** how many retained objects draw with it */
  refs: number;
}

/**
 * Materials shared by key. obtain() hands out the one material for a key, creating it on first
 * ask. An object that keeps cached materials is retain()ed once when it joins the scene and
 * release()d once when it leaves; sweep() then disposes every material no retained object
 * holds any more. Counting per object, not per obtain(), is what keeps the count right however
 * many meshes of the piece share one material and however many times its builder asked.
 */
export class MaterialCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly owners = new Map<THREE.Material, CacheEntry>();

  /** The material for `key`, made by `create` the first time it is asked for. */
  obtain<M extends THREE.Material>(key: string, create: () => M): M {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { material: create(), refs: 0 };
      this.entries.set(key, entry);
      this.owners.set(entry.material, entry);
    }
    return entry.material as M;
  }

  owns(material: THREE.Material): boolean {
    return this.owners.has(material);
  }

  retain(root: THREE.Object3D): void {
    for (const m of materialsOf(root)) {
      const entry = this.owners.get(m);
      if (entry) entry.refs++;
    }
  }

  release(root: THREE.Object3D): void {
    for (const m of materialsOf(root)) {
      const entry = this.owners.get(m);
      if (entry && entry.refs > 0) entry.refs--;
    }
  }

  /** Dispose every material no retained object holds. Returns how many went. */
  sweep(): number {
    let swept = 0;
    for (const [key, entry] of this.entries) {
      if (entry.refs > 0) continue;
      entry.material.dispose();
      this.entries.delete(key);
      this.owners.delete(entry.material);
      swept++;
    }
    return swept;
  }

  /** How many materials the cache holds right now. */
  get size(): number {
    return this.entries.size;
  }

  /** Dispose everything, held or not: the scene that used the cache is going away. */
  dispose(): void {
    for (const entry of this.entries.values()) entry.material.dispose();
    this.entries.clear();
    this.owners.clear();
  }
}

/**
 * Free what `root` holds on the GPU: every geometry, and every material and texture it owns.
 * Static resources stay, and so do `cache`'s materials — release the object from its cache
 * (and sweep) for those.
 */
export function disposeObject(root: THREE.Object3D, cache?: MaterialCache): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  for (const material of materialsOf(root)) {
    if (isStatic(material) || cache?.owns(material)) continue;
    for (const texture of texturesOf(material)) if (!isStatic(texture)) texture.dispose();
    material.dispose();
  }
}
