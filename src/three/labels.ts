/**
 * Room names over the model, as the plan letters them: each room's name on its floor (or, where
 * the walls hide the floor, over the room at the top of its walls), in the plan's lettering on a
 * paper chip that keeps it legible over any finish or piece — the selected room's in the accent,
 * and a room a pending request would remove flagged as the plan flags it. The name stands a
 * little along the room's longer side from its centre (LABELS.pendantClear), clear of where the
 * pendant hangs, and off any car parked in the room, which would otherwise wear it on its roof.
 *
 * They are HTML over the canvas, not textures in the scene: crisp at any zoom, set in the page's
 * own drawing face, and free of any canvas text rendering. Each one is placed after a frame is
 * drawn, by projecting its anchor with the camera, and only through CSS custom properties
 * (--label-x, --label-y) set from script, so the strict CSP holds. A name is hidden when a wall
 * stands between it and the camera (a wall the cutaway has sliced away above the cut does not
 * count), when its room shows smaller on screen than the name needs, when the name would not fit
 * inside the view, when the room is behind the camera, or far away.
 *
 * On a plan of several storeys a name stands on its room's floor, at its level's elevation, and
 * the slabs of the storeys shown hide it as the walls do; the rooms of a level the view hides
 * have no name over the model.
 *
 * The layer is aria-hidden: the names are the plan's, which keyboard and screen-reader users
 * already have, with the rooms themselves, in the 2D view and the panels.
 */

import { outlineAnchor, outlineBounds, outlineDistance, outlineRect, pointInOutline } from "../model/shapes";
import * as THREE from "three";
import type { PendingApproval, PlanModel, Room } from "../model/types";
import { elevationOf } from "../model/levels";
import { catalogOf } from "../model/catalog";
import { pointInORect, type ORect } from "../model/geometry";
import { FLOOR_TOP, LABELS } from "./config";

/** Where one name goes on screen, in CSS pixels from the canvas's top left, and whether it shows. */
export interface LabelSpot {
  x: number;
  y: number;
  visible: boolean;
}

const scratch = {
  anchor: new THREE.Vector3(),
  ndc: new THREE.Vector3(),
  corner: new THREE.Vector3(),
  view: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

/**
 * Where on the plan a room's name stands: LABELS.pendantClear from the room's centre along its
 * longer side (toward its east or south end), never past LABELS.maxShift of its half-length; and,
 * where that is on a car parked in it (`parked`, parkedIn), the nearest point clear of the cars.
 */
export function labelAnchor(room: Room, parked: readonly ORect[] = []): { x: number; z: number } {
  const at = centreAnchor(room);
  if (parked.length === 0) return at;
  const grown = parked.map((r) => ({ ...r, hw: r.hw + LABELS.itemClear, hd: r.hd + LABELS.itemClear }));
  const clear = (p: { x: number; y: number }) => !grown.some((r) => pointInORect(p, r));
  if (clear({ x: at.x, y: at.z })) return at;
  // the nearest point of the room clear of the cars and of its edge, on a grid
  const box = outlineBounds(room.points);
  const step = LABELS.searchStep;
  let best: { x: number; z: number; d: number } | null = null;
  for (let x = box.x + step / 2; x < box.x + box.w; x += step) {
    for (let y = box.y + step / 2; y < box.y + box.h; y += step) {
      const p = { x, y };
      if (!clear(p) || !pointInOutline(p, room.points) || outlineDistance(p, room.points) < LABELS.wallClear) continue;
      const d = Math.hypot(x - at.x, y - at.z);
      if (!best || d < best.d) best = { x, z: y, d };
    }
  }
  return best ? { x: best.x, z: best.z } : at;
}

/** The cars parked in a room (a kind marked `parking`, standing in it): their footprints, which its name keeps off. */
export function parkedIn(model: PlanModel, room: Room): ORect[] {
  const catalog = catalogOf(model);
  return model.items.flatMap((i): ORect[] => {
    const def = catalog.get(i.kind);
    if (!def?.parking || i.levelId !== room.levelId || !pointInOutline(i, room.points)) return [];
    return [{ cx: i.x, cy: i.y, hw: def.w / 2, hd: def.d / 2, rot: (-i.rotation * Math.PI) / 180 }];
  });
}

/** The name's spot by the room's shape alone. */
function centreAnchor(room: Room): { x: number; z: number } {
  const r = outlineRect(room.points);
  if (!r) {
    // any other outline: its most interior point, the pendant's spot (build.ts roomMiddle), moved
    // along the longer side of its bounds as far as the widest circle there allows
    const anchor = outlineAnchor(room.points);
    const box = outlineBounds(room.points);
    const wide = box.w >= box.h;
    const shift = Math.min(LABELS.pendantClear, anchor.clearance * LABELS.maxShift);
    return { x: anchor.x + (wide ? shift : 0), z: anchor.y + (wide ? 0 : shift) };
  }
  const wide = r.w >= r.h;
  const shift = Math.min(LABELS.pendantClear, ((wide ? r.w : r.h) / 2) * LABELS.maxShift);
  return { x: r.x + r.w / 2 + (wide ? shift : 0), z: r.y + r.h / 2 + (wide ? 0 : shift) };
}

/**
 * Where `room`'s name goes for `camera` on a `width` by `height` canvas, given that the name is
 * `textWidth` by `textHeight` pixels. `occluders` are what can stand in front of it (the
 * walls), `cut` the cutaway's level (null: none).
 */
export function placeLabel(
  room: Room,
  camera: THREE.Camera,
  width: number,
  height: number,
  textWidth: number,
  raycaster: THREE.Raycaster,
  occluders: readonly THREE.Object3D[],
  cut: number | null,
  level: number = FLOOR_TOP + LABELS.lift,
  textHeight = 0,
  at: { x: number; z: number } = labelAnchor(room),
): LabelSpot {
  const anchor = scratch.anchor.set(at.x, level, at.z);
  const hidden: LabelSpot = { x: 0, y: 0, visible: false };
  camera.updateMatrixWorld();
  const view = scratch.view.copy(anchor).applyMatrix4(camera.matrixWorldInverse);
  // behind the camera, or too far to read
  if (view.z >= 0 || -view.z > LABELS.maxDistance) return hidden;
  const ndc = scratch.ndc.copy(anchor).project(camera);
  if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return hidden;
  const x = ((ndc.x + 1) / 2) * width;
  const y = ((1 - ndc.y) / 2) * height;
  // the name is centred on its anchor: it must fit inside the view whole, not be cut by its edge
  if (x - textWidth / 2 < 0 || x + textWidth / 2 > width || y - textHeight / 2 < 0 || y + textHeight / 2 > height) return hidden;

  // too small: the room's corners on screen are closer together than the name is wide
  let minX = Infinity;
  let maxX = -Infinity;
  let behind = false;
  const box = outlineBounds(room.points);
  for (const [cx, cz] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ]) {
    const corner = scratch.corner.set(cx, level, cz);
    if (scratch.dir.copy(corner).applyMatrix4(camera.matrixWorldInverse).z >= 0) behind = true;
    corner.project(camera);
    const px = ((corner.x + 1) / 2) * width;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
  }
  // a room partly behind the camera surrounds the walker: it is big enough
  if (!behind && maxX - minX < textWidth + LABELS.padPx) return hidden;

  // hidden behind a wall: something hit on the way to the anchor, short of it
  const origin = camera.getWorldPosition(scratch.corner);
  const toAnchor = scratch.dir.subVectors(anchor, origin);
  const distance = toAnchor.length();
  raycaster.set(origin, toAnchor.normalize());
  raycaster.far = distance;
  for (const hit of raycaster.intersectObjects(occluders as THREE.Object3D[], true)) {
    if (cut !== null && hit.point.y > cut) continue;
    if (hit.distance < distance - LABELS.occlusionSlack) return hidden;
    break;
  }
  raycaster.far = Infinity;
  return { x, y, visible: true };
}

interface LabelNode {
  el: HTMLElement;
  name: HTMLElement;
  flag: HTMLElement;
  text: string;
  width: number;
  height: number;
  room: Room;
  /** where on the plan its name stands (labelAnchor, off any car parked there) */
  anchor: { x: number; z: number };
  /** how far up the room's floor stands: its level's elevation */
  floor: number;
  x: number;
  y: number;
  visible: boolean;
}

/** The names in one layer over the canvas, kept in step with the plan's rooms. */
export class RoomLabels {
  private readonly nodes = new Map<string, LabelNode>();
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly layer: HTMLElement) {
    layer.setAttribute("aria-hidden", "true");
  }

  /**
   * The plan's rooms, which of them is selected, and the requests pending on them; only the rooms
   * on the levels in `shown` get a name (none: every level).
   */
  setRooms(model: PlanModel, selectedRoomId: string | null, approvals: readonly PendingApproval[], shown: ReadonlySet<string> | null = null): void {
    const removing = new Set(approvals.flatMap((a) => a.targets.filter((t) => t.type === "room").map((t) => t.id)));
    const seen = new Set<string>();
    for (const room of model.rooms) {
      if (shown !== null && !shown.has(room.levelId)) continue;
      seen.add(room.id);
      let node = this.nodes.get(room.id);
      if (!node) {
        const el = document.createElement("span");
        el.className = "scene-label";
        const name = document.createElement("span");
        name.className = "scene-label__name";
        const flag = document.createElement("span");
        flag.className = "scene-label__flag";
        flag.textContent = "Removal pending";
        el.append(name, flag);
        el.hidden = true;
        this.layer.appendChild(el);
        node = { el, name, flag, text: "", width: 0, height: 0, room, anchor: { x: 0, z: 0 }, floor: 0, x: NaN, y: NaN, visible: false };
        this.nodes.set(room.id, node);
      }
      node.room = room;
      node.anchor = labelAnchor(room, parkedIn(model, room));
      node.floor = elevationOf(model, room.levelId);
      if (node.text !== room.label) {
        node.text = room.label;
        node.name.textContent = room.label;
        node.width = 0; // measured again when next shown
      }
      node.el.classList.toggle("scene-label--selected", room.id === selectedRoomId);
      const flagged = removing.has(room.id);
      node.el.classList.toggle("scene-label--pending", flagged);
      if (node.flag.hidden === flagged) node.height = 0; // the flag changes the chip's height: measured again
      node.flag.hidden = !flagged;
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.el.remove();
      this.nodes.delete(id);
    }
  }

  /**
   * Place every name for the frame just drawn: on its room's floor, or — where the walls hide
   * the floor, as from a low orbit over a dollhouse — over the room at the top of its walls
   * (`top`: the ceiling, or the cut while there is one; a height, or one for each room). A room
   * under another storey shown has no such fallback (`top` gives null): the floor over it hides
   * it, so its name shows only where its own floor can be seen.
   */
  place(
    camera: THREE.Camera,
    width: number,
    height: number,
    occluders: readonly THREE.Object3D[],
    cut: number | null,
    top: number | ((room: Room) => number | null),
  ): void {
    for (const node of this.nodes.values()) {
      if ((node.width === 0 || node.height === 0) && node.el.isConnected) {
        // measured while shown at its last spot (a hidden element has no size)
        const wasHidden = node.el.hidden;
        node.el.hidden = false;
        node.width = node.el.offsetWidth;
        node.height = node.el.offsetHeight;
        node.el.hidden = wasHidden;
      }
      const floor = node.floor + FLOOR_TOP + LABELS.lift;
      const lid = typeof top === "number" ? (cut ?? top) : top(node.room);
      let spot = placeLabel(node.room, camera, width, height, node.width, this.raycaster, occluders, cut, floor, node.height, node.anchor);
      if (!spot.visible && lid !== null) spot = placeLabel(node.room, camera, width, height, node.width, this.raycaster, occluders, cut, lid + LABELS.lift, node.height, node.anchor);
      if (spot.visible !== node.visible) {
        node.visible = spot.visible;
        node.el.hidden = !spot.visible;
      }
      if (!spot.visible) continue;
      const x = Math.round(spot.x);
      const y = Math.round(spot.y);
      if (x !== node.x) node.el.style.setProperty("--label-x", `${(node.x = x)}px`);
      if (y !== node.y) node.el.style.setProperty("--label-y", `${(node.y = y)}px`);
    }
  }

  /** How many names there are, and how many show. */
  get counts(): { total: number; shown: number } {
    let shown = 0;
    for (const n of this.nodes.values()) if (n.visible) shown++;
    return { total: this.nodes.size, shown };
  }

  dispose(): void {
    for (const node of this.nodes.values()) node.el.remove();
    this.nodes.clear();
  }
}
