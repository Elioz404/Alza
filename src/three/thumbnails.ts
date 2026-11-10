/**
 * Catalogue thumbnails — every card shows the piece you will actually get.
 *
 * One shared offscreen renderer draws each kind's real THREE.Group from a fixed three-quarter
 * angle and hands back a data URL, cached by kind. Agent-defined and supplier-imported kinds
 * come out of the same pipeline, so a piece an agent models at runtime appears in the catalogue
 * looking like itself rather than as a coloured rectangle.
 *
 * The cache is keyed by kind and checked against the whole definition, so a kind an agent
 * redefines (or an undo restores) gets the thumbnail of what it is now, and the cache holds one
 * image per kind however often that happens.
 */

import * as THREE from "three";
import { buildFurniture } from "./furniture";
import type { KindDef } from "../model/types";

const SIZE = 176;
const cache = new Map<string, { definition: string; url: string }>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function init(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(SIZE, SIZE);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight("#eef3fa", "#6a6152", 1.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight("#fff4e2", 2.4);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#cfe0ff", 0.7);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
    return true;
  } catch {
    renderer = null;
    return false;
  }
}

function dispose(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

/** Render one catalogue kind to a PNG data URL (cached). Returns null if WebGL is unavailable. */
export function thumbnailFor(def: KindDef): string | null {
  const definition = JSON.stringify(def);
  const hit = cache.get(def.kind);
  if (hit?.definition === definition) return hit.url;
  if (!init() || !renderer || !scene || !camera) return null;

  const piece = buildFurniture(def);
  scene.add(piece);

  // frame the piece: three-quarter view, fitted to its bounding sphere
  const box = new THREE.Box3().setFromObject(piece);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.25);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) + radius * 0.35;
  camera.position.set(centre.x + dist * 0.62, centre.y + dist * 0.5, centre.z + dist * 0.72);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");

  scene.remove(piece);
  dispose(piece);
  cache.set(def.kind, { definition, url });
  return url;
}
