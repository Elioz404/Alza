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
 *
 * A piece lives only for the frame that draws it: it is read back in the same task (so the
 * renderer needs no preserveDrawingBuffer) and then freed — its geometries at once (unless the
 * 3D view is drawing the same kind: pieces of one definition share them, furniture.ts), its
 * shared materials once the batch of thumbnails being drawn is done, so the pieces of one
 * catalogue render share their materials and shaders instead of compiling them per card.
 *
 * A card shows the piece as the 3D view draws it, standing on its contact shadow, in its
 * surfaces' finishes and tints — but plain: without their patterns, and without the plan's ink.
 * At a card's size a weave or a grain is finer than a pixel and an ink line crosses the piece's
 * own edge, while finding the creases, sampling the patterns and encoding the extra detail
 * would slow the Library's first open, when every card is drawn at once.
 *
 * Loaded on demand (ui/useThumbnails.ts), with three.js, so the page's first chunk has neither.
 */

import * as THREE from "three";
import { buildFurniture } from "./furniture";
import { MaterialCache, disposeObject } from "./materials";
import { TONE_MAPPING, contactShadow } from "./surfaces";
import { RENDERER, THUMBNAIL, THUMBNAIL_SIZE } from "./config";
import type { KindDef } from "../model/types";

const cache = new Map<string, { definition: string; url: string }>();
const materials = new MaterialCache();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let sweepQueued = false;

function init(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    renderer.toneMapping = TONE_MAPPING[RENDERER.toneMapping];
    renderer.toneMappingExposure = THUMBNAIL.toneMappingExposure;

    scene = new THREE.Scene();
    const { hemisphere, key: keySpec, rim: rimSpec } = THUMBNAIL;
    scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
    const key = new THREE.DirectionalLight(keySpec.color, keySpec.intensity);
    key.position.set(...keySpec.position);
    scene.add(key);
    const rim = new THREE.DirectionalLight(rimSpec.color, rimSpec.intensity);
    rim.position.set(...rimSpec.position);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(THUMBNAIL.camera.fov, 1, THUMBNAIL.camera.near, THUMBNAIL.camera.far);
    return true;
  } catch {
    renderer = null;
    return false;
  }
}

/** Free the materials no thumbnail holds once the current batch of draws is over. */
function sweepAfterBatch(): void {
  if (sweepQueued) return;
  sweepQueued = true;
  queueMicrotask(() => {
    sweepQueued = false;
    materials.sweep();
  });
}

/** Render one catalogue kind to a PNG data URL (cached). Returns null if WebGL is unavailable. */
export function thumbnailFor(def: KindDef): string | null {
  const definition = JSON.stringify(def);
  const hit = cache.get(def.kind);
  if (hit?.definition === definition) return hit.url;
  if (!init() || !renderer || !scene || !camera) return null;

  const piece = buildFurniture(def, materials, { patterns: false });
  // frame the piece itself: three-quarter view, fitted to its bounding sphere
  const box = new THREE.Box3().setFromObject(piece);
  // drawn as the 3D view draws it (planScene.ts): standing on its contact shadow (a rug lies flat)
  if (!def.isRug) piece.add(contactShadow(def.w, def.d));
  materials.retain(piece);
  scene.add(piece);

  const centre = box.getCenter(new THREE.Vector3());
  const { minRadius, margin, direction } = THUMBNAIL.camera;
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, minRadius);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) + radius * margin;
  const [east, up, south] = direction;
  camera.position.set(centre.x + dist * east, centre.y + dist * up, centre.z + dist * south);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();

  // drawn and read back in the same task: the buffer is still there to read
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");

  scene.remove(piece);
  materials.release(piece);
  disposeObject(piece, materials);
  sweepAfterBatch();
  cache.set(def.kind, { definition, url });
  return url;
}
