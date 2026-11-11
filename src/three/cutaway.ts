/**
 * The dollhouse cutaway: one level plane that slices the walls at a height, so the rooms can be
 * looked into from above, and the poché the cut shows, as the plan draws a cut wall solid in its
 * ink.
 *
 * Every material a wall is built with is clipped by CUT_PLANE (three.js clipping planes,
 * evaluated in the fragment shader; the renderer has local clipping on), the walls' shadows
 * included. Where the plane opens a wall, a flat cap in SCENE_MARK.poche closes it at the cut:
 * over the wall's solid stretches and its frames' jambs, never across a doorway or a window the
 * cut passes through — the plan's wall, drawn at the cut (build.ts wallCutCap).
 *
 * The plane is part of the walls' shaders only while there is a cut: without one (the default)
 * they are the very programs the furniture in the same finishes draws with, so the view's first
 * frame compiles nothing for a cutaway nobody asked for. Turning the cut on compiles the walls'
 * clipped programs once; moving it compiles nothing.
 */

import * as THREE from "three";
import { keepStatic } from "./materials";
import { CUTAWAY, FLOOR_TOP } from "./config";
import { SCENE_MARK } from "../ui/theme/sceneTokens";

/** The cut: everything above it, of what is clipped by it, is not drawn. */
export const CUT_PLANE = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUTAWAY.off);
/**
 * The top of the storeys shown: the underside of the slab over the topmost one. A stair there
 * climbs on into the storey above, which is not shown (or into nothing, on the plan's top
 * level); it stops at this plane, as the storey's walls stop at their ceiling.
 */
export const STOREY_PLANE = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUTAWAY.off);
// one array per combination, so moving a plane never hands a material a new list
const CUT_PLANES = [CUT_PLANE];
const STOREY_PLANES = [STOREY_PLANE];
const BOTH_PLANES = [CUT_PLANE, STOREY_PLANE];

/** Every material the cut slices: the walls' own, all static. */
const sliced = new Set<THREE.Material>();
/** The ones of them that also stop at the top of the storeys shown: a stair's own. */
const topped = new Set<THREE.Material>();

/** Where the top of the storeys shown is now, metres above the ground; null while it is not set. */
export const storeyTop = (): number | null => (STOREY_PLANE.constant >= CUTAWAY.off ? null : STOREY_PLANE.constant);

/** The planes `material` is clipped by now: the cut while there is one, and a stair's storey top. */
function planesOf(material: THREE.Material): THREE.Plane[] | null {
  const cut = cutLevel() !== null;
  const top = topped.has(material) && storeyTop() !== null;
  return cut && top ? BOTH_PLANES : cut ? CUT_PLANES : top ? STOREY_PLANES : null;
}

/** Hand every sliced material the planes it is clipped by now (only when one came or went). */
function replane(): void {
  for (const m of sliced) {
    const planes = planesOf(m);
    if (m.clippingPlanes !== planes) m.clippingPlanes = planes;
  }
}

/**
 * Put the cut `height` metres above the floor of the storey whose floor is `base` metres up (the
 * topmost one shown: the storeys under it stand whole, below the plane), or take it away (null).
 * Returns whether it moved.
 */
export function setCut(height: number | null, base = 0): boolean {
  const constant = height === null ? CUTAWAY.off : base + FLOOR_TOP + height;
  if (CUT_PLANE.constant === constant) return false;
  const was = cutLevel() !== null;
  CUT_PLANE.constant = constant;
  // the plane joins the walls' shaders when there is a cut, and leaves them when there is none
  if (was !== (height !== null)) replane();
  return true;
}

/**
 * Put the top of the storeys shown `level` metres above the ground (the underside of the slab
 * over the topmost storey shown), or take it away (null). Returns whether it moved.
 */
export function setStoreyTop(level: number | null): boolean {
  const constant = level === null ? CUTAWAY.off : level;
  if (STOREY_PLANE.constant === constant) return false;
  const was = storeyTop() !== null;
  STOREY_PLANE.constant = constant;
  if (was !== (level !== null)) replane();
  return true;
}

/** Where the cut is now, metres above the ground; null while there is none. */
export const cutLevel = (): number | null => (CUT_PLANE.constant >= CUTAWAY.off ? null : CUT_PLANE.constant);

/** Have `material` sliced by the cut, its shadow included, whenever there is one. */
export function clipToCut<M extends THREE.Material>(material: M): M {
  sliced.add(material);
  material.clippingPlanes = planesOf(material);
  material.clipShadows = true;
  return material;
}

/** Have `material` sliced by the cut and stopped at the top of the storeys shown: a stair's. */
export function clipToStoreyTop<M extends THREE.Material>(material: M): M {
  topped.add(material);
  return clipToCut(material);
}

/** The name of a wall's cap at the cut: a drawing aid, not part of what is exported. */
export const CUT_CAP = "cut-cap";

/** The poché the caps are drawn in: exactly the plan's wall ink on screen, unlit. */
export const POCHE = keepStatic(
  new THREE.MeshBasicMaterial({
    color: SCENE_MARK.poche.hex,
    toneMapped: false,
  }),
);
