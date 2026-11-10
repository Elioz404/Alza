/**
 * The 3D viewport: a warm studio (the tokens' paper as backdrop and fog, a ground that fades
 * into it), neutral tone mapping, an ambient sky with one soft-shadowed sun and a fill,
 * image-based bounce light, three camera modes (orbit / top / walk with WASD), click-to-place
 * furniture, clickable doors, OBJ + PNG export.
 *
 * There is no post-processing: contact shading is baked into the floors and the furniture's
 * footing (config.ts CONTACT), so a frame is one pass straight to the canvas. The backdrop and
 * the fog are then exactly the token's colour on screen, the colour the loading state paints,
 * and the PNG snapshot is the canvas as it is shown. The sun's shadow map is redrawn only when
 * something that casts a shadow changed (the plan, a door, the cut), never because the camera
 * moved.
 *
 * It carries the plan's drawing into the model: the store's selection outlined in the accent
 * (and a click on a wall, a room or a piece selects it, as on the plan), each room's name
 * lettered over its floor (labels.ts), a pending removal hatched in the error colour
 * (marks.ts), and optionally the plan's ink on every edge (edges.ts) and a dollhouse cut through
 * the walls (cutaway.ts). Switching camera, or framing a new plan, eases the camera there
 * (transitions.ts), at once under prefers-reduced-motion, and any input finishes the move.
 * Under reduced motion a drag does not glide on after it is let go, and a door is open or shut
 * at once rather than swinging.
 *
 * Everything that costs a WebGL context or a shader compile — the renderer, the environment
 * map, the lights, the controls — is created once, when the view mounts, and lives until it
 * unmounts. The plan's content is a PlanScene that setModel() keeps
 * in step with the model entity by entity, and the frame loop draws only when something
 * changed (frames.ts), so an idle 3D view, and a run of agent edits, cost what they should.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { store, pageActions } from "../model/store";
import { dispatch } from "../model/commands";
import { bus, EVENTS, sceneProbe, type ScenePoint, type SceneStats, type SetDoorsPayload } from "../model/sceneBus";
import { SCENE_STYLE_DEFAULTS, type CameraMode, type SceneStyle } from "../model/limits";
import type { PendingApproval, PlanModel } from "../model/types";
import { runToolManually } from "../mcp/tools";
import { placeHeldPieceAt, planBounds, planCentre } from "../editor/canvasState";
import { PlanScene } from "./planScene";
import { ceilingOf } from "./build";
import { frameLoop } from "./frames";
import { WalkKeys, blockersFor, slide, walkEntry, type Blockers } from "./walk";
import { CAMERA, CAMERA_FRAMING, CLICK_SLOP_PX, CONTROLS, FLOOR_TOP, LIGHTS, RENDERER, SCENE, SHADOWS, WALK } from "./config";
import { TONE_MAPPING } from "./surfaces";
import { isAid } from "./edges";
import { cutLevel, setCut } from "./cutaway";
import { SceneMarks, markBox, setMarkResolution, type Selected } from "./marks";
import { RoomLabels } from "./labels";
import { CameraMove, framedRadius, moveSeconds, newPose, prefersReducedMotion, type CameraPose } from "./transitions";

export interface Viewport {
  /** Show this plan: only what changed since the last one is rebuilt. */
  setModel(model: PlanModel): void;
  /** Move the camera to a mode: eased from where it is, at once under reduced motion. */
  setCamera(mode: CameraMode): void;
  /** Draw with or without ink edges, with or without the cutaway, and where it cuts. */
  setStyle(style: SceneStyle): void;
  /** Outline what the store has selected (null: nothing). */
  setSelection(selected: Selected | null): void;
  /** Hatch what the pending destructive requests would remove. */
  setPending(approvals: readonly PendingApproval[]): void;
  /** Free the context and everything on it. The viewport cannot be used afterwards. */
  dispose(): void;
}

export interface ViewportOptions {
  /** where the room names go: a layer over the canvas (none: no names) */
  labels?: HTMLElement | null;
  style?: SceneStyle;
  selected?: Selected | null;
  approvals?: readonly PendingApproval[];
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

export function createViewport(mount: HTMLElement, initialModel: PlanModel, initialMode: CameraMode, options: ViewportOptions = {}): Viewport {
  // No preserveDrawingBuffer: keeping every frame's buffer costs on every frame, and the only
  // reader (the PNG snapshot) draws a frame and reads it back in the same task instead.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  contexts.created++;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // the sun does not move with the camera: its shadow map is redrawn only when a caster did
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = TONE_MAPPING[RENDERER.toneMapping];
  renderer.toneMappingExposure = RENDERER.toneMappingExposure;
  // the cutaway's plane (cutaway.ts) slices the walls' materials
  renderer.localClippingEnabled = true;
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

  // ---- lighting: ambient sky over a warm bounce, one warm sun, a soft fill ----
  scene.add(new THREE.HemisphereLight(LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity));
  const sun = new THREE.DirectionalLight(LIGHTS.sun.color, LIGHTS.sun.intensity);
  const sunDirection = new THREE.Vector3(...LIGHTS.sun.position).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOWS.mapSize, SHADOWS.mapSize);
  sun.shadow.bias = SHADOWS.bias;
  sun.shadow.normalBias = SHADOWS.normalBias;
  scene.add(sun, sun.target);
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
  /** the walls: what can stand between the camera and a room's name */
  let walls = plan.walls;

  // ---- the plan's marks and names ----
  let style: SceneStyle = options.style ?? SCENE_STYLE_DEFAULTS;
  let selected: Selected | null = options.selected ?? null;
  let approvals: readonly PendingApproval[] = options.approvals ?? [];
  const marks = new SceneMarks();
  scene.add(marks.root);
  setMarkResolution(mount.clientWidth, mount.clientHeight);
  const labels = options.labels ? new RoomLabels(options.labels) : null;
  /**
   * Bring the marks and the names in step with the plan, the selection and the requests; a
   * room's marks are drawn again at the top of its walls, or at the cut.
   */
  const remark = (): boolean => {
    labels?.setRooms(model, selected?.type === "room" ? selected.id : null, approvals);
    return marks.update(
      model,
      selected,
      approvals.flatMap((a) => a.targets),
      cutLevel() ?? ceilingOf(model),
    );
  };
  remark();

  // ---- camera + controls ----
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, mount.clientWidth / mount.clientHeight, CAMERA.near, CAMERA.far);

  const controls = new OrbitControls(cam, renderer.domElement);
  /** a drag glides on after it is let go, unless the person asks for less motion (read at each press) */
  const glide = () => !prefersReducedMotion();
  controls.enableDamping = glide();
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
    // the sun's shadow covers the plan and its margin, from straight up the sun's direction
    const reach = scratchSize.length() / 2 + SHADOWS.margin;
    const shadowCam = sun.shadow.camera;
    shadowCam.left = shadowCam.bottom = -reach;
    shadowCam.right = shadowCam.top = reach;
    shadowCam.near = Math.max(0.1, SHADOWS.distance - reach);
    shadowCam.far = SHADOWS.distance + reach;
    shadowCam.updateProjectionMatrix();
    sun.target.position.copy(fit.center);
    sun.position.copy(fit.center).addScaledVector(sunDirection, SHADOWS.distance);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  };
  refit();

  /** Where the walker is standing. Only WASD moves it; looking around never does. */
  const walkPos = new THREE.Vector3();
  let mode: CameraMode = initialMode;

  /** Where a mode puts the camera, for the plan on screen. */
  const poseFor = (next: CameraMode, out: CameraPose): CameraPose => {
    const { center } = fit;
    // a view narrower than the framings are made for stands the camera back, to keep the width
    const radius = framedRadius(fit.radius, cam.aspect);
    if (next === "top") {
      const top = CAMERA_FRAMING.top;
      out.up.set(0, 0, -1); // north up, east right — matches the 2D editor exactly
      out.position.set(center.x, radius * top.height, center.z + top.nudge);
      out.target.set(center.x, 0, center.z);
    } else if (next === "walk") {
      const walk = CAMERA_FRAMING.walk;
      out.up.set(0, 1, 0);
      // inside the largest room, facing into it; with no room free to stand in, south of the
      // plan's centre, facing north
      const spot = walkEntry(model, blockers, plan.openness) ?? { x: center.x, z: center.z + fit.radius * walk.startSouth, dirX: 0, dirZ: -1 };
      out.position.set(spot.x, CAMERA.eyeHeight, spot.z);
      out.target.set(spot.x + spot.dirX * WALK.lookAhead, CAMERA.eyeHeight - walk.lookDrop, spot.z + spot.dirZ * WALK.lookAhead);
    } else {
      const [east, up, south] = CAMERA_FRAMING.orbit.offset;
      out.up.set(0, 1, 0);
      out.position.set(center.x + radius * east, radius * up, center.z + radius * south);
      out.target.set(center.x, CAMERA_FRAMING.orbit.targetHeight, center.z);
    }
    return out;
  };

  const pose = newPose();
  const destination = newPose();
  const move = new CameraMove();
  /**
   * A move keeps to the clock, not to the frames' steps (which are capped, so a stall cannot
   * throw the walker through a wall): on a slow machine it takes as long, in fewer frames.
   */
  let moveClock = 0;
  const putCamera = (p: CameraPose) => {
    cam.up.copy(p.up);
    cam.position.copy(p.position);
    controls.target.copy(p.target);
    cam.lookAt(p.target);
  };
  /** The mode's bounds on the controls, and the controls back in charge, once the camera is there. */
  const settle = () => {
    const framing = CAMERA_FRAMING[mode];
    controls.maxPolarAngle = framing.maxPolar;
    controls.minDistance = framing.minDistance;
    controls.maxDistance = framing.maxDistance;
    if (mode === "walk") walkPos.copy(cam.position);
    controls.enabled = true;
    controls.update();
  };

  /**
   * Where the cutaway slices the walls: nowhere while walking, where a cut would be the ceiling.
   * The pendants' fixtures show only while walking, from inside: from outside a cord hanging
   * from no ceiling would only cross the rooms and their names.
   */
  const applyCut = () => {
    // the cut walls cast cut shadows (and so do curtains put away, and pendants shown or hidden)
    let moved = setCut(style.cutaway && mode !== "walk" ? style.cutHeight : null);
    if (plan.setFixtures(mode === "walk")) moved = true;
    if (moved) renderer.shadowMap.needsUpdate = true;
    plan.setCut(cutLevel());
    // a room's marks stand at the cut
    remark();
  };

  /** Point the camera as `next` frames the plan: eased from where it is (`ease`), or at once. */
  const applyCamera = (next: CameraMode, ease: boolean) => {
    mode = next;
    applyCut();
    // spend what is left of a drag's glide now: it must not carry on past the move (a move
    // already under way spent it when it started, and the controls still hold its old bounds)
    if (!move.active) {
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = glide();
    }
    poseFor(next, destination);
    pose.position.copy(cam.position);
    pose.target.copy(controls.target);
    pose.up.copy(cam.up);
    // the walls a move to or from Walk has to rise over
    const wallTops = Math.max(0, ...model.walls.map((w) => w.height));
    if (ease && move.start(pose, destination, moveSeconds(prefersReducedMotion()), wallTops)) {
      moveClock = performance.now();
      // the controls stand aside while the camera travels; settle() hands it back to them
      controls.enabled = false;
      return;
    }
    move.finish(pose);
    putCamera(destination);
    settle();
  };
  applyCamera(mode, false);

  // ---- walking: scratch vectors reused every frame a key is held ----
  const keys = new WalkKeys();
  const UP = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const step3 = new THREE.Vector3();
  const back = new THREE.Vector3();
  const step: [number, number] = [0, 0];

  const walk = (dt: number) => {
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, UP);
    step3.set(0, 0, 0);
    if (keys.held("forward")) step3.add(fwd);
    if (keys.held("back")) step3.sub(fwd);
    if (keys.held("left")) step3.sub(right);
    if (keys.held("right")) step3.add(right);
    if (step3.lengthSq() === 0) return;
    step3.normalize().multiplyScalar(WALK.speed * dt);
    // full move first; if that lands in something, slide along whichever axis is free
    const [dx, dz] = slide(blockers, cam.position.x, cam.position.z, step3.x, step3.z, plan.openness, step);
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
  let width = mount.clientWidth;
  let height = mount.clientHeight;
  const loop = frameLoop((dt) => {
    let again = false;
    if (move.active) {
      // the camera is travelling to a mode: it goes where the move says, not where the controls do
      const now = performance.now();
      again = move.step((now - moveClock) / 1000, pose);
      moveClock = now;
      putCamera(pose);
      if (!again) settle();
    } else {
      if (mode === "walk" && keys.any) {
        walk(dt);
        again = true; // a held key walks on every frame until it is let go
      }
      // true while the camera is still easing after a drag (damping)
      if (controls.update()) again = true;
      if (mode === "walk") anchorWalker();
    }
    if (plan.stepDoors(dt)) {
      again = true;
      renderer.shadowMap.needsUpdate = true; // a swinging leaf moves its shadow
    }
    renderer.render(scene, cam);
    labels?.place(cam, width, height, walls, cutLevel(), ceilingOf(model));
    return again;
  });
  const invalidate = () => loop.invalidate();
  controls.addEventListener("change", invalidate);

  /** Finish a camera move under way at once: any input does, so nobody waits on the camera. */
  const finishMove = () => {
    if (!move.active) return;
    move.finish(pose);
    putCamera(pose);
    settle();
    invalidate();
  };

  // ---- keys ----
  // only walk mode walks, and only on keys not typed into a field (walk.ts → WalkKeys)
  const kd = (e: KeyboardEvent) => {
    if (keys.down(e, mode === "walk")) {
      finishMove();
      invalidate();
    }
  };
  const ku = (e: KeyboardEvent) => keys.up(e);
  const blur = () => keys.clear();
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);

  // ---- click to place furniture, click to swing a door, click to select ----
  const ray = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_TOP);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const aim = (e: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  };
  /** Was this hit on something drawn: shown, and not on a wall above the cut? */
  const drawn = (h: THREE.Intersection): boolean => {
    const cut = cutLevel();
    if (cut !== null && h.point.y > cut && plan.entityOf(h.object)?.type === "wall") return false;
    for (let n: THREE.Object3D | null = h.object; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  // a click that ended an orbit drag must not toggle a door or change the selection
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: MouseEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  };
  // a press or a scroll finishes a camera move at once, before the controls take it; and the
  // drag it starts glides on after release only if the person has not asked for less motion
  const interrupt = () => {
    finishMove();
    controls.enableDamping = glide();
  };
  const onClick = (e: MouseEvent) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_SLOP_PX) return;
    const { drawMode, placingKind } = store.getState().editor;
    const kind = drawMode === "place" ? placingKind : null;
    aim(e);
    if (!kind) {
      // no placement in progress: what the click meets first decides. A leaf swings that door
      // open / shut through set_doors, the tool an agent uses for the same thing, so the click
      // is logged as the human's set_doors call and swings the leaf through the same bus event
      // (a leaf seen only through the lintel over it is not what was clicked)
      const picked = ray.intersectObjects(plan.objects, true).find(drawn);
      const doorId = picked ? plan.doorOf(picked.object) : null;
      if (doorId) {
        void runToolManually("set_doors", { state: "toggle", id: doorId });
        return;
      }
      // anything else selects what was clicked, as a click on the plan does; the ground, nothing
      const entity = picked ? plan.entityOf(picked.object) : null;
      if (entity?.type === "wall") pageActions.selectWall(entity.id);
      else if (entity?.type === "room") pageActions.selectRoom(entity.id);
      else pageActions.selectItem(entity?.id ?? null);
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
    // the cheap test first: only a pointer over some leaf asks what it meets first
    const overLeaf = ray.intersectObjects(doorMeshes, false).some(drawn);
    const first = overLeaf ? ray.intersectObjects(plan.objects, true).find(drawn) : undefined;
    renderer.domElement.style.cursor = first && plan.doorOf(first.object) ? "pointer" : "";
  };
  renderer.domElement.addEventListener("pointerdown", interrupt, { capture: true });
  renderer.domElement.addEventListener("wheel", interrupt, { capture: true, passive: true });
  renderer.domElement.addEventListener("mousedown", onDown);
  renderer.domElement.addEventListener("click", onClick);
  renderer.domElement.addEventListener("mousemove", onMove);

  // ---- the keyboard's placement: the floor under the middle of the view ----
  // the point the camera looks at, where its centre ray meets the floor inside the plan's
  // extent; looking level (walking) or past the plan, the middle of the plan instead
  const offPlace = bus.on(EVENTS.PLACE_AT_CENTRE, () => {
    const current = store.getState().model;
    ndc.set(0, 0);
    ray.setFromCamera(ndc, cam);
    const b = planBounds(current);
    const onFloor = ray.ray.intersectPlane(floorPlane, hit) !== null;
    const inPlan = onFloor && b !== null && hit.x >= b.minX && hit.x <= b.maxX && hit.z >= b.minY && hit.z <= b.maxY;
    const at = inPlan ? { x: hit.x, y: hit.z } : planCentre(current);
    if (placeHeldPieceAt(at.x, at.y)) invalidate();
  });

  // ---- bus: doors, exports ----
  const offDoors = bus.on(EVENTS.SET_DOORS, (p) => {
    // under reduced motion a door is open or shut at once: its shadow is redrawn with it
    const instant = prefersReducedMotion();
    if (!plan.setDoors(p as SetDoorsPayload, instant)) return;
    if (instant) renderer.shadowMap.needsUpdate = true;
    invalidate();
  });
  const offObj = bus.on(EVENTS.EXPORT_OBJ, () => {
    // the model, not its contact shadows or its ink: drawing aids, not geometry anyone would import
    const aids: [THREE.Object3D, THREE.Object3D][] = [];
    plan.root.traverse((o) => {
      if (isAid(o) && o.parent) aids.push([o, o.parent]);
    });
    for (const [o, parent] of aids) parent.remove(o);
    const obj = new OBJExporter().parse(plan.root);
    for (const [o, parent] of aids) parent.add(o);
    const url = URL.createObjectURL(new Blob([obj], { type: "text/plain" }));
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
    width = mount.clientWidth;
    height = mount.clientHeight;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    renderer.setSize(width, height);
    setMarkResolution(width, height);
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
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    entities: plan.size,
    materials: plan.materials.size,
    marks: marks.counts,
    labels: labels?.counts ?? { total: 0, shown: 0 },
    cut: cutLevel(),
    edges: style.edges,
    moving: move.active,
  });
  sceneProbe.read = stats;
  const projected = new THREE.Vector3();
  const locate = (type: "wall" | "room" | "item", id: string): ScenePoint | null => {
    const b = markBox(type, id, model);
    if (!b) return null;
    const cut = cutLevel();
    projected.set(b.cx, cut === null ? b.y1 : Math.min(b.y1, cut), b.cz).project(cam);
    if (projected.z > 1) return null;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  };
  const look = (position: readonly [number, number, number], target: readonly [number, number, number]) => {
    finishMove();
    cam.position.set(...position);
    controls.target.set(...target);
    if (mode === "walk") walkPos.copy(cam.position);
    controls.update();
    invalidate();
  };
  sceneProbe.locate = locate;
  sceneProbe.look = look;

  loop.invalidate();
  // the ink is drawn on the second frame: the first one shows the model as soon as it can
  let inkTimer: number | null = null;
  let inkFrame: number | null = requestAnimationFrame(() => {
    inkFrame = null;
    inkTimer = window.setTimeout(() => {
      inkTimer = null;
      if (plan.setEdges(style.edges)) invalidate();
    });
  });
  /** Forget the ink still to come: the style was set since, or the view is going. */
  const inkNow = () => {
    if (inkFrame !== null) cancelAnimationFrame(inkFrame);
    if (inkTimer !== null) clearTimeout(inkTimer);
    inkFrame = inkTimer = null;
  };

  return {
    setModel(next) {
      if (next === model) return;
      model = next;
      const hadContent = plan.hasContent;
      const change = plan.update(next);
      blockers = blockersFor(next);
      collectDoorMeshes();
      walls = plan.walls;
      remark();
      refit(); // and redraws the shadow map: the casters changed
      // a plan that replaced the one on screen (the demo loaded, a blank canvas drawn on) is
      // framed afresh, eased from the old framing; an edit to the plan on screen leaves the
      // camera where the human put it
      if (plan.hasContent && (!hadContent || change.kept + change.moved + change.rebuilt === 0)) applyCamera(mode, hadContent);
      invalidate();
    },
    setCamera(next) {
      applyCamera(next, true);
      invalidate();
    },
    setStyle(next) {
      style = next;
      inkNow();
      plan.setEdges(next.edges);
      applyCut();
      invalidate();
    },
    setSelection(next) {
      selected = next;
      if (remark()) invalidate();
    },
    setPending(next) {
      approvals = next;
      remark();
      invalidate();
    },
    dispose() {
      inkNow();
      loop.stop();
      ro.disconnect();
      offDoors();
      offPlace();
      offObj();
      offPng();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      renderer.domElement.removeEventListener("pointerdown", interrupt, { capture: true });
      renderer.domElement.removeEventListener("wheel", interrupt, { capture: true });
      renderer.domElement.removeEventListener("mousedown", onDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mousemove", onMove);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      if (sceneProbe.read === stats) sceneProbe.read = null;
      if (sceneProbe.locate === locate) sceneProbe.locate = null;
      if (sceneProbe.look === look) sceneProbe.look = null;
      plan.dispose();
      marks.dispose();
      labels?.dispose();
      setCut(null);
      envRT.dispose();
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
