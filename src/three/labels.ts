/**
 * Room names over the model, as the plan letters them: each room's name on its floor (or, where
 * the walls hide the floor, over the room at the top of its walls), in the plan's lettering on a
 * paper chip that keeps it legible over any finish or piece — the selected room's in the accent,
 * and a room a pending request would remove flagged as the plan flags it. The name stands a
 * little along the room's longer side from its centre (LABELS.pendantClear), clear of where the
 * pendant hangs.
 *
 * They are HTML over the canvas, not textures in the scene: crisp at any zoom, set in the page's
 * own drawing face, and free of any canvas text rendering. Each one is placed after a frame is
 * drawn, by projecting its anchor with the camera, and only through CSS custom properties
 * (--label-x, --label-y) set from script, so the strict CSP holds. A name is hidden when a wall
 * stands between it and the camera (a wall the cutaway has sliced away above the cut does not
 * count), when its room shows smaller on screen than the name needs, when the name would not fit
 * inside the view, when the room is behind the camera, or far away.
 *
 * The layer is aria-hidden: the names are the plan's, which keyboard and screen-reader users
 * already have, with the rooms themselves, in the 2D view and the panels.
 */

import * as THREE from "three";
import type { PendingApproval, PlanModel, Room } from "../model/types";
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
 * longer side (toward its east or south end), never past LABELS.maxShift of its half-length.
 */
export function labelAnchor(room: Room): { x: number; z: number } {
  const wide = room.w >= room.h;
  const shift = Math.min(LABELS.pendantClear, ((wide ? room.w : room.h) / 2) * LABELS.maxShift);
  return { x: room.x + room.w / 2 + (wide ? shift : 0), z: room.y + room.h / 2 + (wide ? 0 : shift) };
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
): LabelSpot {
  const at = labelAnchor(room);
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
  for (const [cx, cz] of [
    [room.x, room.y],
    [room.x + room.w, room.y],
    [room.x + room.w, room.y + room.h],
    [room.x, room.y + room.h],
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

  /** The plan's rooms, which of them is selected, and the requests pending on them. */
  setRooms(model: PlanModel, selectedRoomId: string | null, approvals: readonly PendingApproval[]): void {
    const removing = new Set(approvals.flatMap((a) => a.targets.filter((t) => t.type === "room").map((t) => t.id)));
    const seen = new Set<string>();
    for (const room of model.rooms) {
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
        node = { el, name, flag, text: "", width: 0, height: 0, room, x: NaN, y: NaN, visible: false };
        this.nodes.set(room.id, node);
      }
      node.room = room;
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
   * (`top`: the ceiling, or the cut while there is one).
   */
  place(camera: THREE.Camera, width: number, height: number, occluders: readonly THREE.Object3D[], cut: number | null, top: number): void {
    for (const node of this.nodes.values()) {
      if ((node.width === 0 || node.height === 0) && node.el.isConnected) {
        // measured while shown at its last spot (a hidden element has no size)
        const wasHidden = node.el.hidden;
        node.el.hidden = false;
        node.width = node.el.offsetWidth;
        node.height = node.el.offsetHeight;
        node.el.hidden = wasHidden;
      }
      const floor = FLOOR_TOP + LABELS.lift;
      let spot = placeLabel(node.room, camera, width, height, node.width, this.raycaster, occluders, cut, floor, node.height);
      if (!spot.visible) spot = placeLabel(node.room, camera, width, height, node.width, this.raycaster, occluders, cut, (cut ?? top) + LABELS.lift, node.height);
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
