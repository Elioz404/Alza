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
const CUT_PLANES = [CUT_PLANE];

/** Every material the cut slices: the walls' own, all static. */
const sliced = new Set<THREE.Material>();

/** Put the cut `height` metres above the floors, or take it away (null). Returns whether it moved. */
export function setCut(height: number | null): boolean {
  const constant = height === null ? CUTAWAY.off : FLOOR_TOP + height;
  if (CUT_PLANE.constant === constant) return false;
  const was = cutLevel() !== null;
  CUT_PLANE.constant = constant;
  // the plane joins the walls' shaders when there is a cut, and leaves them when there is none
  if (was !== (height !== null)) for (const m of sliced) m.clippingPlanes = height === null ? null : CUT_PLANES;
  return true;
}

/** Where the cut is now, metres above the ground; null while there is none. */
export const cutLevel = (): number | null => (CUT_PLANE.constant >= CUTAWAY.off ? null : CUT_PLANE.constant);

/** Have `material` sliced by the cut, its shadow included, whenever there is one. */
export function clipToCut<M extends THREE.Material>(material: M): M {
  sliced.add(material);
  material.clippingPlanes = cutLevel() === null ? null : CUT_PLANES;
  material.clipShadows = true;
  return material;
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
