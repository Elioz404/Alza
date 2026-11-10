/**
 * The plan's content in the 3D scene, kept in step with the model piece by piece.
 *
 * The scene used to be thrown away and rebuilt — renderer and WebGL context included — on
 * every change to the plan, so an agent making forty edits made forty contexts. Here the scene
 * outlives the changes: each wall, floor, pendant and piece of furniture is one entity, keyed
 * by its id, and update() compares what each entity is built from (its signature) with what
 * it was built from last time. Only an entity whose signature changed is rebuilt; one that is
 * gone is removed and its GPU resources freed; a piece of furniture that only moved is moved.
 *
 * A wall's signature covers everything its shape depends on: its own numbers, its openings,
 * its joints with its neighbours (jointExtensions) and which of its windows have curtains. So
 * moving a wall rebuilds it and exactly the neighbours whose joints it changed; a sofa pushed
 * against a window rebuilds that window's wall (its curtains go) and nothing else.
 *
 * The door leaves' swing is state of the scene, not of the plan: it is kept by door id, so a
 * wall rebuilt under an open door still shows it open.
 */

import * as THREE from "three";
import type { KindDef, Opening, PlanModel, Wall } from "../model/types";
import { catalogOf } from "../model/catalog";
import type { SetDoorsPayload } from "../model/sceneBus";
import {
  buildFloor,
  buildGround,
  buildPendant,
  buildWall,
  ceilingOf,
  curtainedWindows,
  jointExtensions,
  openingsByWall,
} from "./build";
import { buildFurniture } from "./furniture";
import { MaterialCache, disposeObject } from "./materials";
import { DOORS, FLOOR_TOP } from "./config";

/** What one update did, by entity: for tests and the development probe. */
export interface ReconcileStats {
  added: number;
  rebuilt: number;
  moved: number;
  removed: number;
  kept: number;
}

/** One hinged leaf in the scene; a double door has two with the same id. */
export interface DoorLeaf {
  readonly hinge: THREE.Object3D;
  readonly doorId: string;
  readonly swing: number;
}

interface Entity {
  signature: string;
  object: THREE.Object3D;
}

/** Bounds the camera frames when the plan has no walls yet. */
const EMPTY_PLAN_BOUNDS = new THREE.Box3(new THREE.Vector3(-4, 0, -3), new THREE.Vector3(4, 3, 3));

/** A kind definition's identity as a short token: definitions are frozen and replaced, never edited. */
const defIds = new WeakMap<KindDef, number>();
let defSeq = 0;
const defId = (def: KindDef): number => {
  let id = defIds.get(def);
  if (id === undefined) defIds.set(def, (id = ++defSeq));
  return id;
};

const openingSignature = (o: Opening, curtained: ReadonlySet<string>) =>
  [o.id, o.kind, o.t, o.width, o.sill, o.height, o.hinge ?? "", o.side ?? "", curtained.has(o.id)];

const wallSignature = (w: Wall, openings: readonly Opening[], ext: readonly [number, number], curtained: ReadonlySet<string>) =>
  JSON.stringify([w.ax, w.ay, w.bx, w.by, w.thickness, w.height, ext, openings.map((o) => openingSignature(o, curtained))]);

export class PlanScene {
  /** Everything the plan puts in the scene, ground included: add it to the scene, export it as OBJ. */
  readonly root = new THREE.Group();
  readonly materials: MaterialCache;
  private readonly entities = new Map<string, Entity>();
  private readonly ground: THREE.Mesh;
  private leaves: DoorLeaf[] = [];
  /** per door id: where its leaves are going (0 shut, 1 open) and where they are */
  private readonly doorState = new Map<string, { target: number; current: number }>();
  private hasWalls = false;

  constructor(materials = new MaterialCache()) {
    this.materials = materials;
    this.root.name = "plan";
    this.ground = buildGround();
    this.root.add(this.ground);
  }

  /** Bring the scene in step with `model`, touching only the entities that changed. */
  update(model: PlanModel): ReconcileStats {
    const stats: ReconcileStats = { added: 0, rebuilt: 0, moved: 0, removed: 0, kept: 0 };
    const seen = new Set<string>();
    const put = (key: string, signature: string, build: () => THREE.Object3D): THREE.Object3D => {
      seen.add(key);
      const current = this.entities.get(key);
      if (current?.signature === signature) {
        stats.kept++;
        return current.object;
      }
      if (current) {
        this.drop(current);
        stats.rebuilt++;
      } else stats.added++;
      const object = build();
      this.materials.retain(object);
      this.root.add(object);
      this.entities.set(key, { signature, object });
      return object;
    };

    const byWall = openingsByWall(model);
    const curtained = curtainedWindows(model, byWall);
    for (const w of model.walls) {
      const openings = byWall.get(w.id) ?? [];
      const ext = jointExtensions(w, model.walls);
      put(`wall:${w.id}`, wallSignature(w, openings, ext, curtained), () => buildWall(w, openings, ext, curtained));
    }
    const ceiling = ceilingOf(model);
    for (const r of model.rooms) {
      put(`floor:${r.id}`, JSON.stringify([r.x, r.y, r.w, r.h, r.floor]), () => buildFloor(r));
      put(`pendant:${r.id}`, JSON.stringify([r.x, r.y, r.w, r.h, ceiling]), () => buildPendant(r, ceiling));
    }
    const catalog = catalogOf(model);
    for (const it of model.items) {
      const def = catalog.get(it.kind);
      if (!def) continue;
      const key = `item:${it.id}`;
      const before = this.entities.get(key);
      const piece = put(key, String(defId(def)), () => buildFurniture(def, this.materials));
      // where a piece stands is not part of what it is built from: moving it moves it
      const x = it.x;
      const z = it.y;
      const ry = (it.rotation * Math.PI) / 180;
      if (before?.object === piece && (piece.position.x !== x || piece.position.z !== z || piece.rotation.y !== ry)) {
        stats.kept--;
        stats.moved++;
      }
      piece.position.set(x, FLOOR_TOP, z);
      piece.rotation.y = ry;
    }

    for (const [key, entity] of this.entities) {
      if (seen.has(key)) continue;
      this.drop(entity);
      this.entities.delete(key);
      stats.removed++;
    }
    this.materials.sweep();
    this.collectLeaves(model);
    this.hasWalls = model.walls.length > 0;
    return stats;
  }

  private drop(entity: Entity): void {
    this.root.remove(entity.object);
    this.materials.release(entity.object);
    disposeObject(entity.object, this.materials);
  }

  /** Find the leaves the walls carry now, and put each where its door's swing says. */
  private collectLeaves(model: PlanModel): void {
    const leaves: DoorLeaf[] = [];
    for (const [key, { object }] of this.entities) {
      if (!key.startsWith("wall:")) continue;
      object.traverse((o) => {
        if (o.userData?.doorHinge) leaves.push({ hinge: o, doorId: o.userData.doorId as string, swing: o.userData.swing as number });
      });
    }
    this.leaves = leaves;
    const doors = new Set(model.openings.filter((o) => o.kind === "door").map((o) => o.id));
    for (const id of this.doorState.keys()) if (!doors.has(id)) this.doorState.delete(id);
    for (const leaf of leaves) leaf.hinge.rotation.y = (this.doorState.get(leaf.doorId)?.current ?? 0) * leaf.swing;
  }

  /** The door leaves in the scene now. */
  get doors(): readonly DoorLeaf[] {
    return this.leaves;
  }

  /** The door a picked object belongs to, if it is part of a leaf. */
  doorOf(object: THREE.Object3D): string | null {
    for (let n: THREE.Object3D | null = object; n; n = n.parent) {
      if (n.userData?.doorHinge) return n.userData.doorId as string;
    }
    return null;
  }

  /** Set where doors are going: one by id, or all of them. Returns whether any leaf now has somewhere to go. */
  setDoors(payload: SetDoorsPayload): boolean {
    let moving = false;
    // by door, not by leaf: the two leaves of a double door are one door, toggled once
    const ids = new Set(this.leaves.map((l) => l.doorId).filter((id) => !payload.id || id === payload.id));
    for (const id of ids) {
      let state = this.doorState.get(id);
      if (!state) this.doorState.set(id, (state = { target: 0, current: 0 }));
      state.target = payload.state === "toggle" ? (state.target > 0.5 ? 0 : 1) : payload.state === "open" ? 1 : 0;
      if (Math.abs(state.target - state.current) > DOORS.settleEpsilon) moving = true;
    }
    return moving;
  }

  /** Swing every leaf `dt` seconds closer to its target. Returns whether any is still moving. */
  stepDoors(dt: number): boolean {
    let moving = false;
    for (const state of this.doorState.values()) {
      if (Math.abs(state.target - state.current) <= DOORS.settleEpsilon) {
        state.current = state.target;
        continue;
      }
      state.current += (state.target - state.current) * Math.min(1, dt * DOORS.easeRate);
      moving = true;
    }
    if (moving) for (const leaf of this.leaves) leaf.hinge.rotation.y = (this.doorState.get(leaf.doorId)?.current ?? 0) * leaf.swing;
    return moving;
  }

  /** How far a door is open, 0 (shut) to 1 (open). */
  openness = (doorId: string): number => this.doorState.get(doorId)?.current ?? 0;

  /** Whether the plan the scene shows has any walls. */
  get hasContent(): boolean {
    return this.hasWalls;
  }

  /** The plan's content bounds, ground excluded — what the camera frames. */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    if (!this.hasWalls) return target.copy(EMPTY_PLAN_BOUNDS);
    target.makeEmpty();
    for (const { object } of this.entities.values()) target.expandByObject(object);
    return target;
  }

  /** How many entities the scene holds (ground excluded). */
  get size(): number {
    return this.entities.size;
  }

  /** Free everything: every entity, the ground, and every material the cache still holds. */
  dispose(): void {
    for (const entity of this.entities.values()) this.drop(entity);
    this.entities.clear();
    this.root.remove(this.ground);
    disposeObject(this.ground, this.materials);
    this.materials.dispose();
    this.leaves = [];
    this.doorState.clear();
  }
}
