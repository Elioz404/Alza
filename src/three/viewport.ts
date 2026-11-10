/**
 * The 3D viewport: ACES tone mapping, soft shadows, hemisphere + sun lighting, image-based
 * bounce light, SSAO, three camera modes (orbit / top / walk with WASD), click-to-place
 * furniture, clickable doors, OBJ + PNG export.
 *
 * Everything that costs a WebGL context or a shader compile — the renderer, the environment
 * map, the lights, the post-processing chain, the controls — is created once, when the view
 * mounts, and lives until it unmounts. The plan's content is a PlanScene that setModel() keeps
 * in step with the model entity by entity, and the frame loop draws only when something
 * changed (frames.ts), so an idle 3D view, and a run of agent edits, cost what they should.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { store, pageActions } from "../model/store";
import { dispatch } from "../model/commands";
import { bus, EVENTS, sceneProbe, type SceneStats, type SetDoorsPayload } from "../model/sceneBus";
import type { CameraMode } from "../model/limits";
import type { PlanModel } from "../model/types";
import { runToolManually } from "../mcp/tools";
import { PlanScene } from "./planScene";
import { frameLoop } from "./frames";
import { WalkKeys, blockersFor, slide, type Blockers } from "./walk";
import { CAMERA, CAMERA_FRAMING, CLICK_SLOP_PX, CONTROLS, FLOOR_TOP, LIGHTS, RENDERER, SCENE, SSAO, WALK } from "./config";

export interface Viewport {
  /** Show this plan: only what changed since the last one is rebuilt. */
  setModel(model: PlanModel): void;
  setCamera(mode: CameraMode): void;
  /** Free the context and everything on it. The viewport cannot be used afterwards. */
  dispose(): void;
}

/** WebGL contexts this page has created and released for 3D views, for the development probe. */
const contexts = { created: 0, released: 0 };

const fileName = (planName: string, ext: string) => `${planName.replace(/\s+/g, "-").toLowerCase()}.${ext}`;

function download(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

export function createViewport(mount: HTMLElement, initialModel: PlanModel, initialMode: CameraMode): Viewport {
  // No preserveDrawingBuffer: keeping every frame's buffer costs on every frame, and the only
  // reader (the PNG snapshot) draws a frame and reads it back in the same task instead.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  contexts.created++;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDERER.toneMappingExposure;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE.background);
  scene.fog = new THREE.Fog(SCENE.fog.color, SCENE.fog.near, SCENE.fog.far);

  // ---- image-based lighting: soft indoor bounce for glass / metal / gloss ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, RENDERER.environmentSigma);
  room.dispose(); // only needed to bake the map
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = RENDERER.environmentIntensity;

  // ---- lighting: soft sky + warm sun ----
  scene.add(new THREE.HemisphereLight(LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity));
  const sun = new THREE.DirectionalLight(LIGHTS.sun.color, LIGHTS.sun.intensity);
  sun.position.set(...LIGHTS.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDERER.shadowMapSize, RENDERER.shadowMapSize);
  sun.shadow.camera.left = -RENDERER.shadowExtent;
  sun.shadow.camera.right = RENDERER.shadowExtent;
  sun.shadow.camera.top = RENDERER.shadowExtent;
  sun.shadow.camera.bottom = -RENDERER.shadowExtent;
  sun.shadow.bias = LIGHTS.sunShadowBias;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(LIGHTS.fill.color, LIGHTS.fill.intensity);
  fill.position.set(...LIGHTS.fill.position);
  scene.add(fill);

  // ---- content ----
  let model = initialModel;
  const plan = new PlanScene();
  scene.add(plan.root);
  plan.update(model);
  let blockers: Blockers = blockersFor(model);
  /** what a click can hit to swing a door */
  let doorMeshes: THREE.Object3D[] = [];
  const collectDoorMeshes = () => {
    doorMeshes = [];
    for (const leaf of plan.doors) leaf.hinge.traverse((c) => c instanceof THREE.Mesh && doorMeshes.push(c));
  };
  collectDoorMeshes();

  // ---- camera + controls ----
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, mount.clientWidth / mount.clientHeight, CAMERA.near, CAMERA.far);

  // ---- post: screen-space ambient occlusion for contact shading ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const ssao = new SSAOPass(scene, cam, mount.clientWidth, mount.clientHeight);
  ssao.kernelRadius = SSAO.kernelRadius;
  ssao.minDistance = SSAO.minDistance;
  ssao.maxDistance = SSAO.maxDistance;
  composer.addPass(ssao);
  composer.addPass(new OutputPass());

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = CONTROLS.dampingFactor;

  /** The plan's centre and size, for framing it. */
  const fit: { center: THREE.Vector3; radius: number } = { center: new THREE.Vector3(), radius: CAMERA.minFitRadius };
  const scratchBox = new THREE.Box3();
  const scratchSize = new THREE.Vector3();
  const refit = () => {
    plan.bounds(scratchBox);
    scratchBox.getCenter(fit.center);
    scratchBox.getSize(scratchSize);
    fit.radius = Math.max(scratchSize.x, scratchSize.z, CAMERA.minFitRadius);
  };
  refit();

  /** Where the walker is standing. Only WASD moves it; looking around never does. */
  const walkPos = new THREE.Vector3();
  let mode: CameraMode = initialMode;

  const applyCamera = (next: CameraMode) => {
    mode = next;
    const { center, radius } = fit;
    const framing = CAMERA_FRAMING[next];
    if (next === "top") {
      const top = CAMERA_FRAMING.top;
      cam.up.set(0, 0, -1); // north up, east right — matches the 2D editor exactly
      cam.position.set(center.x, radius * top.height, center.z + top.nudge);
      controls.target.set(center.x, 0, center.z);
    } else if (next === "walk") {
      const walk = CAMERA_FRAMING.walk;
      cam.up.set(0, 1, 0);
      cam.position.set(center.x, CAMERA.eyeHeight, center.z + radius * walk.startSouth); // inside the plan, facing north
      controls.target.set(center.x, CAMERA.eyeHeight - walk.lookDrop, center.z - WALK.lookAhead);
      walkPos.copy(cam.position);
    } else {
      const [east, up, south] = CAMERA_FRAMING.orbit.offset;
      cam.up.set(0, 1, 0);
      cam.position.set(center.x + radius * east, radius * up, center.z + radius * south);
      controls.target.set(center.x, CAMERA_FRAMING.orbit.targetHeight, center.z);
    }
    controls.maxPolarAngle = framing.maxPolar;
    controls.minDistance = framing.minDistance;
    controls.maxDistance = framing.maxDistance;
    controls.update();
  };
  applyCamera(mode);

  // ---- walking: scratch vectors reused every frame a key is held ----
  const keys = new WalkKeys();
  const UP = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const back = new THREE.Vector3();
  const step: [number, number] = [0, 0];

  const walk = (dt: number) => {
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, UP);
    move.set(0, 0, 0);
    if (keys.held("forward")) move.add(fwd);
    if (keys.held("back")) move.sub(fwd);
    if (keys.held("left")) move.sub(right);
    if (keys.held("right")) move.add(right);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(WALK.speed * dt);
    // full move first; if that lands in something, slide along whichever axis is free
    const [dx, dz] = slide(blockers, cam.position.x, cam.position.z, move.x, move.z, plan.openness, step);
    walkPos.x += dx;
    walkPos.z += dz;
    controls.target.x += dx;
    controls.target.z += dz;
    walkPos.y = CAMERA.eyeHeight;
  };

  /* OrbitControls orbits the camera around its target, which in first person means a look
   * turns into a four-metre arc — you swing through the furniture and, pressed against a
   * table, cannot turn at all. Re-anchor it every frame: keep the heading the drag produced,
   * but put the camera back where the walker is standing and hang the target in front of it.
   * Looking becomes a pivot in place; only WASD moves. */
  const anchorWalker = () => {
    back.subVectors(cam.position, controls.target).normalize();
    cam.position.copy(walkPos);
    controls.target.copy(walkPos).addScaledVector(back, -WALK.lookAhead);
  };

  // ---- the frame loop: a frame is drawn when asked for, and asks for the next while in motion ----
  const loop = frameLoop((dt) => {
    let again = false;
    if (mode === "walk" && keys.any) {
      walk(dt);
      again = true; // a held key walks on every frame until it is let go
    }
    if (plan.stepDoors(dt)) again = true;
    // true while the camera is still easing after a drag (damping)
    if (controls.update()) again = true;
    if (mode === "walk") anchorWalker();
    composer.render();
    return again;
  });
  const invalidate = () => loop.invalidate();
  controls.addEventListener("change", invalidate);

  // ---- keys ----
  // only walk mode walks, and only on keys not typed into a field (walk.ts → WalkKeys)
  const kd = (e: KeyboardEvent) => {
    if (keys.down(e, mode === "walk")) invalidate();
  };
  const ku = (e: KeyboardEvent) => keys.up(e);
  const blur = () => keys.clear();
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);

  // ---- click to place furniture, click to swing a door ----
  const ray = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_TOP);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const aim = (e: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  };
  // a click that ended an orbit drag must not toggle a door
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: MouseEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  };
  const onClick = (e: MouseEvent) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_SLOP_PX) return;
    const { drawMode, placingKind } = store.getState().editor;
    const kind = drawMode === "place" ? placingKind : null;
    aim(e);
    if (!kind) {
      // no placement in progress: a click on a leaf swings that door open / shut through
      // set_doors, the tool an agent uses for the same thing, so the click is logged as the
      // human's set_doors call and swings the leaf through the same bus event
      const hits = ray.intersectObjects(doorMeshes, false);
      const doorId = hits.length > 0 ? plan.doorOf(hits[0].object) : null;
      if (doorId) void runToolManually("set_doors", { state: "toggle", id: doorId });
      return;
    }
    if (ray.ray.intersectPlane(floorPlane, hit)) {
      dispatch({ type: "place_item", kind, x: hit.x, y: hit.z, rotation: 0 }, { actor: "human" });
      pageActions.setDrawMode("select");
    }
  };
  const onMove = (e: MouseEvent) => {
    if (store.getState().editor.drawMode === "place") return;
    aim(e);
    renderer.domElement.style.cursor = ray.intersectObjects(doorMeshes, false).length > 0 ? "pointer" : "";
  };
  renderer.domElement.addEventListener("mousedown", onDown);
  renderer.domElement.addEventListener("click", onClick);
  renderer.domElement.addEventListener("mousemove", onMove);

  // ---- bus: doors, exports ----
  const offDoors = bus.on(EVENTS.SET_DOORS, (p) => {
    if (plan.setDoors(p as SetDoorsPayload)) invalidate();
  });
  const offObj = bus.on(EVENTS.EXPORT_OBJ, () => {
    const url = URL.createObjectURL(new Blob([new OBJExporter().parse(plan.root)], { type: "text/plain" }));
    download(url, fileName(model.name, "obj"));
    URL.revokeObjectURL(url);
  });
  const offPng = bus.on(EVENTS.EXPORT_PNG, () => {
    // the frame is drawn and read back in this task, before the browser may clear the buffer
    loop.renderNow();
    download(renderer.domElement.toDataURL("image/png"), fileName(model.name, "png"));
  });

  // ---- resize: drawn at once, so the cleared canvas is never shown ----
  const ro = new ResizeObserver(() => {
    cam.aspect = mount.clientWidth / mount.clientHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    composer.setSize(mount.clientWidth, mount.clientHeight);
    ssao.setSize(mount.clientWidth, mount.clientHeight);
    loop.renderNow();
  });
  ro.observe(mount);

  // ---- the development probe (testHookHandle.ts → sceneStats) ----
  const stats = (): SceneStats => ({
    contextsCreated: contexts.created,
    contextsLive: contexts.created - contexts.released,
    frames: loop.frames,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    entities: plan.size,
    materials: plan.materials.size,
  });
  sceneProbe.read = stats;

  loop.invalidate();

  return {
    setModel(next) {
      if (next === model) return;
      model = next;
      const hadContent = plan.hasContent;
      const change = plan.update(next);
      blockers = blockersFor(next);
      collectDoorMeshes();
      refit();
      // a plan that replaced the one on screen (the demo loaded, a blank canvas drawn on) is
      // framed afresh; an edit to the plan on screen leaves the camera where the human put it
      if (plan.hasContent && (!hadContent || change.kept + change.moved + change.rebuilt === 0)) applyCamera(mode);
      invalidate();
    },
    setCamera(next) {
      applyCamera(next);
      invalidate();
    },
    dispose() {
      loop.stop();
      ro.disconnect();
      offDoors();
      offObj();
      offPng();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("mousedown", onDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mousemove", onMove);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      if (sceneProbe.read === stats) sceneProbe.read = null;
      plan.dispose();
      envRT.dispose();
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      // release the context now rather than whenever the canvas is collected: browsers cap
      // the live ones and drop the oldest past the cap
      renderer.forceContextLoss();
      contexts.released++;
      mount.removeChild(renderer.domElement);
    },
  };
}
