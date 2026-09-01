/**
 * Catalogue thumbnails — every card shows the piece you will actually get.
 *
 * One shared offscreen renderer draws each kind's real THREE.Group from a fixed three-quarter
 * angle and hands back a data URL, cached by kind. Agent-defined and supplier-imported kinds
 * come out of the same pipeline, so a piece an agent models at runtime appears in the catalogue
 * looking like itself rather than as a coloured rectangle.
 */

import * as THREE from "three";
import { buildFurniture } from "./furniture";

const SIZE = 176;
const cache = new Map<string, string>();
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
export function thumbnailFor(kind: string): string | null {
  const hit = cache.get(kind);
  if (hit !== undefined) return hit;
  if (!init() || !renderer || !scene || !camera) return null;

  const piece = buildFurniture(kind);
  if (!piece) {
    cache.set(kind, "");
    return null;
  }
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
  cache.set(kind, url);
  return url;
}

/** Drop a cached thumbnail — used when an agent redefines a kind it already created. */
export function invalidateThumbnail(kind: string): void {
  cache.delete(kind);
}
