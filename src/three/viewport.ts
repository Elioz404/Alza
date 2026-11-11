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
 * A plan of several storeys stands stacked at the levels' elevations. The view shows the levels
 * from the ground up to the one the View panel names (levelView.ts: the level being worked on,
 * by default), and the cutaway slices the topmost one shown; walking shows them all, and the
 * walker climbs the stairs between them (walk.ts stride), the level it arrives on becoming the
 * one being worked on. A click on something on another level makes that level the active one,
 * and a piece placed with a click lands on the active level's floor. The OBJ export holds the
 * levels shown.
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
import { downloadFile, downloadHref, exportFileName } from "../export/download";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { store, pageActions } from "../model/store";
import { elevationOf, levelSlice, levelsOf, slabUnderside } from "../model/levels";
import { dispatch } from "../model/commands";
import { bus, EVENTS, sceneFrameDrawn, sceneProbe, type SceneLocatable, type ScenePoint, type SceneStats, type SetDoorsPayload } from "../model/sceneBus";
import { SCENE_STYLE_DEFAULTS, type CameraMode, type SceneStyle } from "../model/limits";
import type { PendingApproval, PlanModel } from "../model/types";
import { runToolManually } from "../mcp/tools";
import { placeHeldPieceAt, planBounds, planCentre } from "../editor/canvasState";
import { PlanScene } from "./planScene";
import { frameLoop } from "./frames";
import { WalkKeys, stride, surfaceAt, walkEntry, walkLevelAt, walkWorld, type Walker, type WalkWorld } from "./walk";
import { coveredByShown, shownLevels, type LevelsShown } from "./levelView";
import { CAMERA, CAMERA_FRAMING, CLICK_SLOP_PX, CONTROLS, FLOOR_TOP, LIGHTS, RENDERER, SCENE, SHADOWS, WALK } from "./config";
import { TONE_MAPPING } from "./surfaces";
import { isAid } from "./edges";
import { cutLevel, setCut, setStoreyTop, storeyTop } from "./cutaway";
import { SceneMarks, markBox, roomLid, setMarkResolution, type Focused, type Selected } from "./marks";
import { RoomLabels } from "./labels";
import { CameraMove, framedRadius, moveSeconds, newPose, orbitPose, prefersReducedMotion, type CameraPose } from "./transitions";

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
  /** Outline, in the agent's colour, what its call is touching (the shared session). */
  setFocus(focus: readonly Focused[]): void;
  /** Work on another level: it is shown (up to it, by default), placed on, and walked on. */
  setActiveLevel(levelId: string): void;
  /** Show the levels up to this one (levelView.ts). */
  setLevelsShown(upTo: LevelsShown): void;
  /** Free the context and everything on it. The viewport cannot be used afterwards. */
  dispose(): void;
}

export interface ViewportOptions {
  /** where the room names go: a layer over the canvas (none: no names) */
  labels?: HTMLElement | null;
  style?: SceneStyle;
  selected?: Selected | null;
  approvals?: readonly PendingApproval[];
  /** the level being worked on (default: the ground level) */
  activeLevelId?: string;
  /** the levels shown (default: up to the active one) */
  levelsShown?: LevelsShown;
}

/** WebGL contexts this page has created and released for 3D views, for the development probe. */
const contexts = { created: 0, released: 0 };


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
  let activeId = options.activeLevelId ?? model.levels[0]?.id ?? "";
  let upTo: LevelsShown = options.levelsShown ?? "active";
  let mode: CameraMode = initialMode;
  const plan = new PlanScene();
  scene.add(plan.root);
  plan.update(model);
  /** the levels the view shows now, by id, and how far up the topmost one's floor stands */
  let shownIds: ReadonlySet<string> = new Set();
  let topFloor = 0;
  /** the lowest shown level's floor: with topFloor, the height of the stack of storeys on screen */
  let bottomFloor = 0;
  /** the active level's floor, metres up */
  const activeFloor = () => elevationOf(model, activeId);
  /** Show the levels the setting (and the camera) asks for. Returns whether any came or went. */
  const applyLevels = (): boolean => {
    const shown = shownLevels(model, activeId, upTo, mode === "walk");
    shownIds = new Set(shown.map((l) => l.level.id));
    const top = shown[shown.length - 1];
    topFloor = top?.elevation ?? 0;
    bottomFloor = shown[0]?.elevation ?? 0;
    // the shown stack ends at the slab over its topmost storey: a stair there stops at it too
    const capped = setStoreyTop(top ? top.elevation + slabUnderside(top.level.height) : null);
    const changed = plan.setLevels(shownIds) || capped;
    if (changed) renderer.shadowMap.needsUpdate = true;
    return changed;
  };
  applyLevels();
  let world: WalkWorld = walkWorld(model);
  /** what a click can hit to swing a door */
  let doorMeshes: THREE.Object3D[] = [];
  const collectDoorMeshes = () => {
    doorMeshes = [];
    for (const leaf of plan.doors) leaf.hinge.traverse((c) => c instanceof THREE.Mesh && doorMeshes.push(c));
  };
  collectDoorMeshes();
  /** the walls and slabs shown: what can stand between the camera and a room's name */
  let occluders = plan.occluders;

  // ---- the plan's marks and names ----
  let style: SceneStyle = options.style ?? SCENE_STYLE_DEFAULTS;
  let selected: Selected | null = options.selected ?? null;
  let approvals: readonly PendingApproval[] = options.approvals ?? [];
  let focus: readonly Focused[] = [];
  const marks = new SceneMarks();
  scene.add(marks.root);
  setMarkResolution(mount.clientWidth, mount.clientHeight);
  const labels = options.labels ? new RoomLabels(options.labels) : null;
  /**
   * Bring the marks and the names in step with the plan, the selection and the requests; a
   * room's marks are drawn again at the top of its walls, or at the cut.
   */
  const lidOf = (levelId: string) => roomLid(model, levelId, cutLevel());
  const remark = (): boolean => {
    labels?.setRooms(model, selected?.type === "room" ? selected.id : null, approvals, shownIds);
    return marks.update(
      model,
      selected,
      approvals.flatMap((a) => a.targets),
      lidOf,
      shownIds,
      focus,
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

  /** Where the walker's eye is. Only WASD moves it; looking around never does. */
  const walkPos = new THREE.Vector3();
  /** Where the walker stands, and the height of the floor or tread under it. */
  const walker: Walker = { x: 0, z: 0, height: 0 };

  /** Where a mode puts the camera, for the plan on screen. */
  const poseFor = (next: CameraMode, out: CameraPose): CameraPose => {
    const { center } = fit;
    // a view narrower than the framings are made for stands the camera back, to keep the width
    const radius = framedRadius(fit.radius, cam.aspect);
    if (next === "top") {
      const top = CAMERA_FRAMING.top;
      out.up.set(0, 0, -1); // north up, east right — matches the 2D editor exactly
      out.position.set(center.x, topFloor + radius * top.height, center.z + top.nudge);
      out.target.set(center.x, topFloor, center.z);
    } else if (next === "walk") {
      const walk = CAMERA_FRAMING.walk;
      out.up.set(0, 1, 0);
      // on the active level: inside its largest room, facing into it, on a floor (not a stair);
      // with no room free to stand in, south of the plan's centre, facing north
      const floor = activeFloor();
      const index = Math.max(0, levelsOf(model).findIndex((l) => l.level.id === activeId));
      const here = world.levels[index];
      const free = (x: number, z: number) => surfaceAt(world, x, z, floor) === floor;
      const spot =
        (here && walkEntry(levelSlice(model, activeId), here.blockers, plan.openness, free)) ?? { x: center.x, z: center.z + fit.radius * walk.startSouth, dirX: 0, dirZ: -1 };
      walker.x = spot.x;
      walker.z = spot.z;
      walker.height = floor;
      out.position.set(spot.x, floor + CAMERA.eyeHeight, spot.z);
      out.target.set(spot.x + spot.dirX * WALK.lookAhead, floor + CAMERA.eyeHeight - walk.lookDrop, spot.z + spot.dirZ * WALK.lookAhead);
    } else {
      orbitPose(center, fit.radius, bottomFloor, topFloor, cam.aspect, out);
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
    if (mode === "walk") {
      walkPos.copy(cam.position);
      walker.x = walkPos.x;
      walker.z = walkPos.z;
    }
    controls.enabled = true;
    controls.update();
  };

  /**
   * Where the cutaway slices the walls: nowhere while walking, where a cut would be the ceiling.
   * The pendants' fixtures show only while walking, from inside: from outside a cord hanging
   * from no ceiling would only cross the rooms and their names.
   */
  const applyCut = () => {
    // the storeys shown first: the cut slices the topmost of them
    let moved = applyLevels();
    // the cut walls cast cut shadows (and so do curtains put away, and pendants shown or hidden)
    if (setCut(style.cutaway && mode !== "walk" ? style.cutHeight : null, topFloor)) moved = true;
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
    // the walls a move to or from Walk has to rise over: the tallest on the levels shown
    const wallTops = Math.max(0, ...model.walls.filter((w) => shownIds.has(w.levelId)).map((w) => elevationOf(model, w.levelId) + w.height));
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

  /** The level the walker is on, by id. */
  const walkerLevel = () => world.levels[walkLevelAt(world, walker.height)]?.id ?? activeId;

  /** Bring the eye to the height of what the walker stands on. Returns whether it is still on its way. */
  const climb = (dt: number): boolean => {
    const eye = walker.height + CAMERA.eyeHeight;
    const gap = eye - walkPos.y;
    if (Math.abs(gap) <= WALK.climbSettle || prefersReducedMotion()) {
      walkPos.y = eye;
      return false;
    }
    walkPos.y += gap * Math.min(1, dt * WALK.climbRate);
    return true;
  };

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
    // full stride first; if that lands in something (or off a stair), slide along whichever axis is free
    const was = walkerLevel();
    const x0 = walker.x;
    const z0 = walker.z;
    if (!stride(world, walker, step3.x, step3.z, plan.openness)) return;
    walkPos.x = walker.x;
    walkPos.z = walker.z;
    controls.target.x += walker.x - x0;
    controls.target.z += walker.z - z0;
    // up or down a stair onto another storey: that is the level being worked on now
    const now = walkerLevel();
    if (now !== was) {
      activeId = now;
      pageActions.setActiveLevel(now);
    }
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
      // the eye rises and falls with the treads, and asks for frames until it is there
      if (mode === "walk" && climb(dt)) again = true;
      // true while the camera is still easing after a drag (damping)
      if (controls.update()) again = true;
      if (mode === "walk") anchorWalker();
    }
    if (plan.stepDoors(dt)) {
      again = true;
      renderer.shadowMap.needsUpdate = true; // a swinging leaf moves its shadow
    }
    renderer.render(scene, cam);
    labels?.place(cam, width, height, occluders, cutLevel(), (room) => (coveredByShown(model, shownIds, room.levelId) ? null : lidOf(room.levelId)));
    // what stands over the canvas (the session's markers) is placed for this very frame
    sceneFrameDrawn();
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
  /** the active level's floor, where a click puts a piece down */
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_TOP);
  const placeFloor = () => {
    floorPlane.constant = -(activeFloor() + FLOOR_TOP);
  };
  placeFloor();
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
    const type = cut !== null && h.point.y > cut ? plan.entityOf(h.object)?.type : undefined;
    if (type === "wall" || type === "stair") return false;
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
      // anything else selects what was clicked, as a click on the plan does; the ground, nothing.
      // Something on another storey makes that storey the one being worked on first
      const entity = picked ? plan.entityOf(picked.object) : null;
      if (entity && entity.levelId !== activeId) pageActions.setActiveLevel(entity.levelId);
      if (entity?.type === "wall") pageActions.selectWall(entity.id);
      else if (entity?.type === "room") pageActions.selectRoom(entity.id);
      else if (entity?.type === "stair") pageActions.selectStair(entity.id);
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
    const b = planBounds(levelSlice(current, activeId));
    const onFloor = ray.ray.intersectPlane(floorPlane, hit) !== null;
    const inPlan = onFloor && b !== null && hit.x >= b.minX && hit.x <= b.maxX && hit.z >= b.minY && hit.z <= b.maxY;
    const at = inPlan ? { x: hit.x, y: hit.z } : planCentre(levelSlice(current, activeId));
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
    // and only the levels shown: a hidden storey is left out of the file as it is of the view
    for (const group of plan.levelGroups.values()) if (!group.visible) aids.push([group, plan.root]);
    for (const [o, parent] of aids) parent.remove(o);
    const obj = new OBJExporter().parse(plan.root);
    for (const [o, parent] of aids) parent.add(o);
    downloadFile(obj, exportFileName(model.name, "obj"), "text/plain");
  });
  const offPng = bus.on(EVENTS.EXPORT_PNG, () => {
    // the frame is drawn and read back in this task, before the browser may clear the buffer
    loop.renderNow();
    downloadHref(renderer.domElement.toDataURL("image/png"), exportFileName(model.name, "png"));
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
  const corner = new THREE.Vector3();
  /** Whether every corner of the box round the storeys shown projects inside the view. */
  const inFrame = (): boolean => {
    plan.bounds(scratchBox);
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? scratchBox.max.x : scratchBox.min.x, i & 2 ? scratchBox.max.y : scratchBox.min.y, i & 4 ? scratchBox.max.z : scratchBox.min.z).project(cam);
      if (Math.abs(corner.x) > 1 || Math.abs(corner.y) > 1) return false;
    }
    return true;
  };
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
    agentMarks: marks.agentCount,
    labels: labels?.counts ?? { total: 0, shown: 0 },
    cut: cutLevel(),
    storeyTop: storeyTop(),
    framed: inFrame(),
    edges: style.edges,
    moving: move.active,
    levels: { total: model.levels.length, shown: [...shownIds] },
    stairs: plan.counts.stairs,
    slabs: plan.counts.slabs,
    walker: mode === "walk" ? { level: walkerLevel(), floor: walker.height, eye: walkPos.y } : null,
  });
  sceneProbe.read = stats;
  const projected = new THREE.Vector3();
  const locate = (type: SceneLocatable, id: string): ScenePoint | null => {
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
    if (mode === "walk") {
      walkPos.copy(cam.position);
      walker.x = walkPos.x;
      walker.z = walkPos.z;
      walker.height = walkPos.y - CAMERA.eyeHeight;
    }
    controls.update();
    invalidate();
  };
  const project = (x: number, y: number, levelId: string | undefined, up: number): ScenePoint | null => {
    projected.set(x, elevationOf(model, levelId) + up, y).project(cam);
    if (projected.z > 1) return null;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  };
  // three.js axes to the plan's: x stays, three's z is the plan's y, three's y is up
  const camera = () => ({
    eye: { x: cam.position.x, y: cam.position.z, z: cam.position.y },
    target: { x: controls.target.x, y: controls.target.z, z: controls.target.y },
  });
  sceneProbe.locate = locate;
  sceneProbe.look = look;
  sceneProbe.project = project;
  sceneProbe.camera = camera;

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
      // a level that went: the store falls back to the ground, and so does the view
      if (!next.levels.some((l) => l.id === activeId)) activeId = next.levels[0]?.id ?? "";
      applyCut();
      world = walkWorld(next);
      placeFloor();
      collectDoorMeshes();
      occluders = plan.occluders;
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
    setFocus(next) {
      focus = next;
      if (remark()) invalidate();
    },
    setActiveLevel(next) {
      if (next === activeId) return;
      activeId = next;
      placeFloor();
      applyCut();
      occluders = plan.occluders;
      refit();
      // walking, the walker goes to the level asked for (unless it just walked there itself)
      if (mode === "walk" && walkerLevel() !== next) applyCamera("walk", true);
      invalidate();
    },
    setLevelsShown(next) {
      if (next === upTo) return;
      upTo = next;
      applyCut();
      occluders = plan.occluders;
      refit();
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
      if (sceneProbe.project === project) sceneProbe.project = null;
      if (sceneProbe.camera === camera) sceneProbe.camera = null;
      plan.dispose();
      marks.dispose();
      labels?.dispose();
      setCut(null);
      setStoreyTop(null);
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
