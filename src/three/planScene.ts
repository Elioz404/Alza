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
 * its footprint mitred against its neighbours (wallSolids.ts wallBands) and which of its windows have curtains. So
 * moving a wall rebuilds it and exactly the neighbours whose joints it changed; a sofa pushed
 * against a window rebuilds that window's wall (its curtains go) and nothing else.
 *
 * The door leaves' swing is state of the scene, not of the plan: it is kept by door id, so a
 * wall rebuilt under an open door still shows it open.
 *
 * Storeys: every level of the plan is a group of its own, standing at the level's elevation
 * (model/levels.ts levelsOf), and each entity is built in its level's group from that level alone
 * — a wall's joints are with the walls on its own floor, a window's curtains give way to the
 * pieces on its own floor. Every level above the ground stands on its slab (slabs.ts), with a
 * stairwell left open over each stair from the level below; each stair (stairs.ts) stands on its
 * level and climbs to the next. A level whose height changes moves the groups above it and
 * rebuilds nothing; setLevels() shows and hides whole storeys.
 */

import { outlineBox } from "../model/shapes";
import * as THREE from "three";
import type { KindDef, Opening, PlanModel, Stair, Wall } from "../model/types";
import { levelSlice, levelsOf, stairGeometryIn } from "../model/levels";
import { catalogOf } from "../model/catalog";
import type { SetDoorsPayload } from "../model/sceneBus";
import {
  buildFloor,
  buildGround,
  buildPendant,
  buildWall,
  ceilingOf,
  CURTAINS,
  wallCutCap,
  curtainedWindows,
  openingsByWall,
} from "./build";
import { bandsSignature, wallBands, type WallBands } from "./wallSolids";
import { buildFurniture } from "./furniture";
import { MaterialCache, disposeObject } from "./materials";
import { contactShadow } from "./surfaces";
import { addInkEdges, removeInkEdges, type InkClip } from "./edges";
import { CUT_CAP } from "./cutaway";
import { buildSlab } from "./slabs";
import { slabOutline, stairwellPolys } from "../model/floors";
import { buildStair } from "./stairs";
import type { Poly } from "../model/region";
import { CUTAWAY, DOORS, FLOOR_TOP } from "./config";

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
  /** the level it stands on */
  level: string;
  /** a wall's cap at the cutaway's level, built from what the wall was */
  capAt?: (level: number) => THREE.Mesh | null;
  /**
   * The cut's height over the entity's own floor its cap was built for (null: built with no
   * cut, so no cap); undefined until it is first capped. A cap is built again only when it moves.
   */
  capCut?: number | null;
}

/** What a click on the model picked: the plan entity a mesh belongs to, as the store selects it. */
export interface Picked {
  type: "wall" | "room" | "item" | "stair";
  id: string;
  /** the level it stands on */
  levelId: string;
}

/** An entity's key, by the store's selection: a floor and its pendant are the room's. */
const PICK_TYPE: Readonly<Record<string, Picked["type"]>> = Object.freeze({ wall: "wall", floor: "room", pendant: "room", item: "item", stair: "stair" });

/** What an entity's ink stops at, as the entity does: a stair's at the cut and its storey's top. */
const inkClipOf = (key: string): InkClip => (key.startsWith("stair:") ? "stair" : "none");

/** What a stair is built from: its own numbers and the height it climbs. */
const stairSignature = (s: Stair, rise: number) => JSON.stringify([s.shape, s.x, s.y, s.rotation, s.width, s.turn ?? "", s.split ?? "", s.risers ?? "", s.tread ?? "", rise]);

/** A slab's signature: the outlines it covers, or the openings left in it. */
const polysSignature = (polys: readonly Poly[]) => polys.map((p) => p.map((q) => `${q.x},${q.y}`).join(" ")).join("|");

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

const wallSignature = (w: Wall, openings: readonly Opening[], bands: WallBands, curtained: ReadonlySet<string>) =>
  JSON.stringify([w.ax, w.ay, w.bx, w.by, w.bulge ?? 0, w.thickness, w.height, bandsSignature(bands), openings.map((o) => openingSignature(o, curtained))]);

export class PlanScene {
  /** Everything the plan puts in the scene, ground included: add it to the scene, export it as OBJ. */
  readonly root = new THREE.Group();
  readonly materials: MaterialCache;
  private readonly entities = new Map<string, Entity>();
  /** one group per level, at its elevation */
  private readonly levels = new Map<string, THREE.Group>();
  /** the levels shown (null: every one) */
  private shown: ReadonlySet<string> | null = null;
  private readonly ground: THREE.Mesh;
  private leaves: DoorLeaf[] = [];
  /** per door id: where its leaves are going (0 shut, 1 open) and where they are */
  private readonly doorState = new Map<string, { target: number; current: number }>();
  private hasWalls = false;
  private edges = false;
  /** the cutaway's level, metres above the ground; null while there is none */
  private cut: number | null = null;
  /** whether the pendants' fixtures are shown (only from inside, walking: see setFixtures) */
  private fixtures = false;

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
    // the storeys first: a group per level, at its elevation (a level that went takes its group)
    const infos = levelsOf(model);
    for (const info of infos) {
      let group = this.levels.get(info.level.id);
      if (!group) {
        group = new THREE.Group();
        group.name = `level:${info.level.id}`;
        group.userData.levelId = info.level.id;
        this.levels.set(info.level.id, group);
        this.root.add(group);
      }
      group.position.y = info.elevation;
      group.visible = this.shown === null || this.shown.has(info.level.id);
    }
    let level = "";
    const put = (key: string, built: string, build: () => THREE.Object3D | null, capAt?: Entity["capAt"]): THREE.Object3D | null => {
      seen.add(key);
      // what an entity is built from always includes the level it stands on: one moved to another
      // level is built again in that level's group, whatever else it keeps
      const signature = `${level}#${built}`;
      const current = this.entities.get(key);
      if (current?.signature === signature) {
        stats.kept++;
        return current.object;
      }
      if (current) {
        this.drop(current);
        this.entities.delete(key);
      }
      const object = build();
      if (!object) {
        // nothing to build (a slab under nothing): what was there is gone
        if (current) stats.removed++;
        return null;
      }
      if (current) stats.rebuilt++;
      else stats.added++;
      object.userData.entity = key;
      const entity: Entity = { signature, object, level, capAt };
      this.style(key, entity);
      this.materials.retain(object);
      this.levels.get(level)!.add(object);
      this.entities.set(key, entity);
      return object;
    };

    const byWall = openingsByWall(model);
    const catalog = catalogOf(model);
    let wallsChanged = false;
    for (const info of infos) {
      level = info.level.id;
      const slice = levelSlice(model, level);
      const before = stats.added + stats.rebuilt;
      const curtained = curtainedWindows(slice, byWall);
      for (const w of slice.walls) {
        const openings = byWall.get(w.id) ?? [];
        const bands = wallBands(w, slice.walls);
        put(`wall:${w.id}`, wallSignature(w, openings, bands, curtained), () => buildWall(w, openings, bands, curtained), (at) =>
          wallCutCap(w, openings, bands, at),
        );
      }
      if (stats.added + stats.rebuilt > before) wallsChanged = true;
      const wells = info.index > 0 ? stairwellPolys(model, level) : [];
      const wellSig = polysSignature(wells);
      if (info.index > 0) {
        const outline = slabOutline(slice);
        put(`slab:${level}`, `${polysSignature(outline)}#${wellSig}`, () => buildSlab(outline, wells));
      }
      const ceiling = ceilingOf(slice);
      for (const r of slice.rooms) {
        // the stairwells that reach into this room: only those can change its floor
        const b = outlineBox(r.points);
        const near = wells.filter((w) => w.some((p) => p.x > b.minX - 1e-9) && w.some((p) => p.x < b.maxX + 1e-9) && w.some((p) => p.y > b.minY - 1e-9) && w.some((p) => p.y < b.maxY + 1e-9));
        put(`floor:${r.id}`, JSON.stringify([r.points, r.floor, polysSignature(near)]), () => buildFloor(r, this.materials, near));
        put(`pendant:${r.id}`, JSON.stringify([r.points, ceiling]), () => buildPendant(r, ceiling));
      }
      for (const st of slice.stairs) {
        const g = stairGeometryIn(model, st);
        if (g) put(`stair:${st.id}`, stairSignature(st, g.rise), () => buildStair(st, g));
      }
      for (const it of slice.items) {
        const def = catalog.get(it.kind);
        if (!def) continue;
        const key = `item:${it.id}`;
        const before = this.entities.get(key);
        const piece = put(key, String(defId(def)), () => {
          const built = buildFurniture(def, this.materials);
          // what an occlusion pass used to darken: the floor the piece stands on (a rug lies flat)
          if (!def.isRug) built.add(contactShadow(def.w, def.d));
          return built;
        })!;
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
    }

    for (const [key, entity] of this.entities) {
      if (seen.has(key)) continue;
      this.drop(entity);
      this.entities.delete(key);
      stats.removed++;
    }
    for (const [id, group] of this.levels) {
      if (infos.some((l) => l.level.id === id)) continue;
      this.root.remove(group);
      this.levels.delete(id);
    }
    this.materials.sweep();
    if (this.edges && (wallsChanged || stats.removed > 0)) this.reink();
    // a cap stands at the cut's height over its own floor, which a change of storey heights
    // moves: capWall builds again only the caps whose height over their floor did change
    if (this.cut !== null) for (const entity of this.entities.values()) this.capWall(entity);
    this.collectLeaves(model);
    this.hasWalls = model.walls.length > 0;
    return stats;
  }

  /**
   * Show the levels in `ids` and hide the rest (null: show every one). Returns whether anything
   * changed.
   */
  setLevels(ids: ReadonlySet<string> | null): boolean {
    this.shown = ids;
    let changed = false;
    for (const [id, group] of this.levels) {
      const visible = ids === null || ids.has(id);
      if (group.visible !== visible) changed = true;
      group.visible = visible;
    }
    return changed;
  }

  /** Each level's group, by level id. */
  get levelGroups(): ReadonlyMap<string, THREE.Group> {
    return this.levels;
  }

  /** Is the level shown? */
  private levelShown(id: string): boolean {
    return this.levels.get(id)?.visible ?? false;
  }

  /** How far up the floor of an entity's level stands. */
  private elevationOf(entity: Entity): number {
    return this.levels.get(entity.level)?.position.y ?? 0;
  }

  /** Give a newly built entity the drawing style the scene is in. */
  private style(key: string, entity: Entity): void {
    // a wall's ink depends on the walls it meets: drawn once they are all built (reink)
    if (this.edges && !key.startsWith("wall:")) addInkEdges(entity.object, false, [], inkClipOf(key));
    this.capWall(entity);
    if (key.startsWith("pendant:")) this.showPendant(entity.object);
  }

  /**
   * A pendant hangs from a ceiling the model does not draw: its fixture is shown only from
   * inside (setFixtures), and never while the cutaway has taken the ceiling's walls away. Its
   * light is kept whatever shows.
   */
  private showPendant(object: THREE.Object3D): void {
    const shown = this.fixtures && !(this.cut !== null && CUTAWAY.hidePendants);
    for (const c of object.children) if (!(c as THREE.Light).isLight) c.visible = shown;
  }

  /**
   * Show the pendants' fixtures, or hide them. From outside — orbiting, or looking down from the
   * top — a cord hanging from no ceiling is noise over the rooms and their names; walking, it is
   * the room's light. Returns whether anything changed.
   */
  setFixtures(shown: boolean): boolean {
    if (shown === this.fixtures) return false;
    this.fixtures = shown;
    for (const [key, { object }] of this.entities) if (key.startsWith("pendant:")) this.showPendant(object);
    return true;
  }

  /**
   * Close a wall at the cut with its cap (and take an old one away). Its curtains go while the
   * wall is cut: they are cloth, with no section to show, and would stand sliced beside the poché.
   */
  private capWall(entity: Entity): void {
    if (!entity.capAt) return;
    const at = this.cut === null ? null : this.cut - this.elevationOf(entity);
    if (entity.capCut === at) return; // the cap there is the one this cut needs
    entity.capCut = at;
    const curtains = entity.object.getObjectByName(CURTAINS);
    if (curtains) curtains.visible = !(this.cut !== null && CUTAWAY.hideCurtains);
    const old = entity.object.getObjectByName(CUT_CAP);
    if (old) {
      entity.object.remove(old);
      (old as THREE.Mesh).geometry.dispose();
    }
    const cap = at === null ? null : entity.capAt(at);
    if (cap) entity.object.add(cap);
  }

  /** Draw every entity with ink edges, or take them off. Returns whether anything changed. */
  setEdges(on: boolean): boolean {
    if (on === this.edges) return false;
    this.edges = on;
    for (const [key, { object }] of this.entities) {
      if (on && !key.startsWith("wall:")) addInkEdges(object, false, [], inkClipOf(key));
      else removeInkEdges(object);
      if (key.startsWith("pendant:")) this.showPendant(object);
    }
    if (on) this.reink();
    return true;
  }

  /** Ink every wall afresh, against the walls it meets now: the walls on its own floor. */
  private reink(): void {
    const byLevel = new Map<string, THREE.Object3D[]>();
    for (const [key, { object, level }] of this.entities) {
      if (!key.startsWith("wall:")) continue;
      const list = byLevel.get(level);
      if (list) list.push(object);
      else byLevel.set(level, [object]);
    }
    for (const walls of byLevel.values()) {
      for (const wall of walls) {
        removeInkEdges(wall);
        addInkEdges(wall, true, walls);
      }
    }
  }

  /**
   * Where the cutaway slices the walls, metres above the ground (cutaway.ts cutLevel), or null:
   * every wall is capped at it, and the pendants' fixtures go with the ceiling. Returns whether
   * anything changed.
   */
  setCut(level: number | null): boolean {
    if (level === this.cut) return false;
    this.cut = level;
    for (const [key, entity] of this.entities) {
      this.capWall(entity);
      if (key.startsWith("pendant:")) this.showPendant(entity.object);
    }
    return true;
  }

  /** The plan entity a picked object is part of, as the store selects it; null for the ground. */
  entityOf(object: THREE.Object3D): Picked | null {
    for (let n: THREE.Object3D | null = object; n && n !== this.root; n = n.parent) {
      const key = n.userData?.entity as string | undefined;
      if (!key) continue;
      const colon = key.indexOf(":");
      const type = PICK_TYPE[key.slice(0, colon)];
      const entity = this.entities.get(key);
      return type && entity ? { type, id: key.slice(colon + 1), levelId: entity.level } : null;
    }
    return null;
  }

  /** The entities' objects, for picking: walls, floors, pendants and pieces. */
  get objects(): THREE.Object3D[] {
    return [...this.entities.values()].map((e) => e.object);
  }

  /** The walls' objects, on every level. */
  get walls(): THREE.Object3D[] {
    const walls: THREE.Object3D[] = [];
    for (const [key, { object }] of this.entities) if (key.startsWith("wall:")) walls.push(object);
    return walls;
  }

  /** What can stand between the camera and a room on the levels shown: their walls and slabs. */
  get occluders(): THREE.Object3D[] {
    const found: THREE.Object3D[] = [];
    for (const [key, { object, level }] of this.entities) {
      if ((key.startsWith("wall:") || key.startsWith("slab:")) && this.levelShown(level)) found.push(object);
    }
    return found;
  }

  /** How many stairs and slabs the scene holds. */
  get counts(): { stairs: number; slabs: number } {
    let stairs = 0;
    let slabs = 0;
    for (const key of this.entities.keys()) {
      if (key.startsWith("stair:")) stairs++;
      else if (key.startsWith("slab:")) slabs++;
    }
    return { stairs, slabs };
  }

  private drop(entity: Entity): void {
    entity.object.parent?.remove(entity.object);
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

  /**
   * Set where doors are going: one by id, or all of them; `instant` (prefers-reduced-motion)
   * puts each leaf there at once instead of swinging it. Returns whether any leaf now has
   * somewhere to go, or (instant) went there.
   */
  setDoors(payload: SetDoorsPayload, instant = false): boolean {
    let moving = false;
    // by door, not by leaf: the two leaves of a double door are one door, toggled once
    const ids = new Set(this.leaves.map((l) => l.doorId).filter((id) => !payload.id || id === payload.id));
    for (const id of ids) {
      let state = this.doorState.get(id);
      if (!state) this.doorState.set(id, (state = { target: 0, current: 0 }));
      state.target = payload.state === "toggle" ? (state.target > 0.5 ? 0 : 1) : payload.state === "open" ? 1 : 0;
      if (Math.abs(state.target - state.current) > DOORS.settleEpsilon) moving = true;
      if (instant) state.current = state.target;
    }
    if (instant && moving) for (const leaf of this.leaves) leaf.hinge.rotation.y = (this.doorState.get(leaf.doorId)?.current ?? 0) * leaf.swing;
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

  /** The content of the levels shown, ground excluded — what the camera frames. */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    if (!this.hasWalls) return target.copy(EMPTY_PLAN_BOUNDS);
    target.makeEmpty();
    // the levels' groups stand at their elevations: their pieces' frames are measured through them
    this.root.updateMatrixWorld(true);
    for (const entity of this.entities.values()) if (this.levelShown(entity.level)) target.expandByObject(entity.object);
    if (target.isEmpty()) target.copy(EMPTY_PLAN_BOUNDS);
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
    for (const group of this.levels.values()) this.root.remove(group);
    this.levels.clear();
    this.root.remove(this.ground);
    disposeObject(this.ground, this.materials);
    this.materials.dispose();
    this.leaves = [];
    this.doorState.clear();
  }
}
