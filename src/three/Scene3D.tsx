/**
 * Scene3D — the "alzado". ACES tone mapping, soft shadows, hemisphere + sun lighting,
 * three camera modes (orbit / top / walk with WASD), click-to-place furniture,
 * OBJ + PNG export.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { store, useAppStore, actions, logActivity } from "../model/store";
import { buildPlan } from "./build";
import { buildFurniture } from "./furniture";
import { bus, EVENTS, type SetDoorsPayload } from "./exportBus";
import { catalogByKind } from "../model/catalog";

export function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const model = useAppStore((s) => s.model);
  const camera = useAppStore((s) => s.editor.camera);
  const placingKind = useAppStore((s) => (s.editor.drawMode === "place" ? s.editor.placingKind : null));
  const cameraRef = useRef<string>(camera);
  cameraRef.current = camera;

  // build / rebuild scene content when the model changes
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#24282c");
    scene.fog = new THREE.Fog("#24282c", 45, 120);

    // ---- image-based lighting: soft indoor bounce for glass / metal / gloss ----
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.3;

    // ---- lighting: soft sky + warm sun ----
    const hemi = new THREE.HemisphereLight("#e8f0fa", "#5a5044", 0.5);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff2dd", 2.1);
    sun.position.set(10, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    const fill = new THREE.DirectionalLight("#cfe0ff", 0.5);
    fill.position.set(-8, 10, -6);
    scene.add(fill);

    // ---- content ----
    const { group, bounds } = buildPlan(model);
    scene.add(group);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 4);

    for (const it of model.items) {
      const fg = buildFurniture(it.kind);
      if (!fg) continue;
      fg.position.set(it.x, 0.04, it.y);
      fg.rotation.y = (it.rotation * Math.PI) / 180;
      group.add(fg);
    }

    // ---- hinged doors: collect the leaf pivots so they can be opened / closed ----
    interface DoorRec {
      hinge: THREE.Object3D;
      swing: number;
      target: number;
      current: number;
      doorId: string;
    }
    const doors: DoorRec[] = [];
    const doorMeshes: THREE.Object3D[] = [];
    group.traverse((o) => {
      if (o.userData?.doorHinge) {
        doors.push({
          hinge: o,
          swing: o.userData.swing as number,
          target: 0,
          current: 0,
          doorId: o.userData.doorId as string,
        });
        o.traverse((c) => {
          if (c instanceof THREE.Mesh) doorMeshes.push(c);
        });
      }
    });
    const doorRecFor = (obj: THREE.Object3D): DoorRec | null => {
      let n: THREE.Object3D | null = obj;
      while (n) {
        const rec = doors.find((d) => d.hinge === n);
        if (rec) return rec;
        n = n.parent;
      }
      return null;
    };
    const setDoors = (payload: SetDoorsPayload) => {
      for (const d of doors) {
        if (payload.id && d.hinge.userData.doorId !== payload.id) continue;
        d.target = payload.state === "toggle" ? (d.target > 0.5 ? 0 : 1) : payload.state === "open" ? 1 : 0;
      }
    };
    const offDoors = bus.on(EVENTS.SET_DOORS, (p) => setDoors(p as SetDoorsPayload));

    // ---- camera + controls ----
    const cam = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 150);

    // ---- post: screen-space ambient occlusion for contact shading ----
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, cam));
    const ssao = new SSAOPass(scene, cam, mount.clientWidth, mount.clientHeight);
    ssao.kernelRadius = 0.2;
    ssao.minDistance = 0.03; // below a rug's thickness, so flat-on-flat surfaces do not self-occlude
    ssao.maxDistance = 0.08;
    composer.addPass(ssao);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.target.set(center.x, 0.8, center.z);

    /** Where the walker is standing. Only WASD moves it; looking around never does. */
    const walkPos = new THREE.Vector3();

    const applyCamera = (mode: string) => {
      if (mode === "top") {
        cam.up.set(0, 0, -1); // north up, east right — matches the 2D editor exactly
        cam.position.set(center.x, radius * 1.6, center.z + 0.01);
        controls.target.set(center.x, 0, center.z);
        controls.maxPolarAngle = 0.15;
        controls.minDistance = 2;
        controls.maxDistance = 60;
      } else if (mode === "walk") {
        cam.up.set(0, 1, 0);
        cam.position.set(center.x, 1.6, center.z + radius * 0.15); // inside the plan, facing north
        controls.target.set(center.x, 1.5, center.z - 2);
        walkPos.copy(cam.position);
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        controls.minDistance = 0.1;
        controls.maxDistance = 4;
      } else {
        cam.up.set(0, 1, 0);
        cam.position.set(center.x + radius * 0.9, radius * 0.85, center.z + radius * 1.1);
        controls.target.set(center.x, 0.8, center.z);
        controls.maxPolarAngle = Math.PI / 2 - 0.02;
        controls.minDistance = 1;
        controls.maxDistance = 80;
      }
      controls.update();
    };
    applyCamera(cameraRef.current);

    // ---- WASD walk ----
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        keys[down ? "add" : "delete"](e.key.length === 1 ? e.key.toLowerCase() : e.key);
        if (down) e.preventDefault();
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    // ---- click to place furniture ----
    const ray = new THREE.Raycaster();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.04);
    const ndcOf = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    // a click that ended an orbit drag must not toggle a door
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const kind = store.getState().editor.drawMode === "place" ? store.getState().editor.placingKind : null;
      ray.setFromCamera(ndcOf(e), cam);
      if (!kind) {
        // no placement in progress: a click on a leaf swings that door open / shut
        const hits = ray.intersectObjects(doorMeshes, false);
        const rec = hits.length > 0 ? doorRecFor(hits[0].object) : null;
        if (rec) {
          rec.target = rec.target > 0.5 ? 0 : 1;
          logActivity("human", "door", `Door ${rec.hinge.userData.doorId} ${rec.target > 0.5 ? "opened" : "closed"}.`, true);
        }
        return;
      }
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(floorPlane, hit)) {
        const r = actions.placeItem(kind, hit.x, hit.z, 0);
        logActivity("human", "place_item", r.summary, r.ok);
        actions.setDrawMode("select");
      }
    };
    const onMove = (e: MouseEvent) => {
      if (store.getState().editor.drawMode === "place") return;
      ray.setFromCamera(ndcOf(e), cam);
      renderer.domElement.style.cursor = ray.intersectObjects(doorMeshes, false).length > 0 ? "pointer" : "";
    };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("mousemove", onMove);

    // ---- exports ----
    const offObj = bus.on(EVENTS.EXPORT_OBJ, () => {
      const blob = new Blob([new OBJExporter().parse(group)], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${model.name.replace(/\s+/g, "-").toLowerCase()}.obj`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const offPng = bus.on(EVENTS.EXPORT_PNG, () => {
      composer.render();
      const a = document.createElement("a");
      a.href = renderer.domElement.toDataURL("image/png");
      a.download = `${model.name.replace(/\s+/g, "-").toLowerCase()}.png`;
      a.click();
    });

    // ---- resize ----
    const ro = new ResizeObserver(() => {
      cam.aspect = mount.clientWidth / mount.clientHeight;
      cam.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
      ssao.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);

    /* ---- walk collision ------------------------------------------------------
     * Walk mode used to be a free-flying point: it passed through walls, stood inside
     * the fridge, and left the building entirely. Here the camera is a disc of
     * PERSON_R that cannot enter a wall or a piece of furniture.
     *
     * Walls are solid except across a door's clear span, and only while that leaf is
     * actually open — a window is never walkable, since the wall under its sill is
     * solid at hip height. Rugs and anything ankle-low are ignored so you can walk
     * over them. Blocked moves are retried on each axis alone, which slides the
     * camera along a wall instead of gluing it there. */
    const PERSON_R = 0.3;
    const STEP_OVER = 0.25; // anything lower than this is walked over, not into

    const wallBlockers = model.walls.map((w) => {
      const dx = w.bx - w.ax;
      const dy = w.by - w.ay;
      const len = Math.hypot(dx, dy) || 1;
      return {
        ax: w.ax,
        ay: w.ay,
        ux: dx / len,
        uy: dy / len,
        len,
        half: w.thickness / 2,
        gaps: model.openings
          .filter((o) => o.wallId === w.id && o.kind === "door")
          .map((o) => ({ s: o.t * len - o.width / 2, e: o.t * len + o.width / 2, id: o.id })),
      };
    });

    const itemBlockers = model.items.flatMap((it) => {
      const c = catalogByKind(it.kind);
      if (!c || c.isRug || c.h < STEP_OVER) return [];
      const th = (it.rotation * Math.PI) / 180;
      return [{ cx: it.x, cy: it.y, hw: c.w / 2, hh: c.d / 2, cos: Math.cos(th), sin: Math.sin(th) }];
    });

    // how far each door leaf has swung, kept current by the animation loop
    const doorOpen = new Map<string, number>();

    const blocked = (x: number, z: number) => {
      for (const w of wallBlockers) {
        const px = x - w.ax;
        const pz = z - w.ay;
        const along = px * w.ux + pz * w.uy;
        const perp = Math.abs(px * -w.uy + pz * w.ux);
        if (perp > w.half + PERSON_R) continue;
        if (along < -PERSON_R || along > w.len + PERSON_R) continue;
        // inside the wall band — unless this is an open doorway
        const gap = w.gaps.find((g) => along > g.s + PERSON_R * 0.5 && along < g.e - PERSON_R * 0.5);
        if (gap && (doorOpen.get(gap.id) ?? 0) > 0.5) continue;
        return true;
      }
      for (const b of itemBlockers) {
        const dx = x - b.cx;
        const dz = z - b.cy;
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        if (Math.abs(lx) < b.hw + PERSON_R && Math.abs(lz) < b.hh + PERSON_R) return true;
      }
      return false;
    };

    const look = new THREE.Vector3();

    // ---- loop ----
    let raf = 0;
    const clock = new THREE.Clock();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      if (cameraRef.current === "walk" && keys.size > 0) {
        const speed = 2.2 * dt;
        cam.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        right.crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        const move = new THREE.Vector3();
        if (keys.has("w") || keys.has("ArrowUp")) move.add(fwd);
        if (keys.has("s") || keys.has("ArrowDown")) move.sub(fwd);
        if (keys.has("a") || keys.has("ArrowLeft")) move.sub(right);
        if (keys.has("d") || keys.has("ArrowRight")) move.add(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed);
          // full move first; if that lands in something, slide along whichever axis is free
          let dx = move.x;
          let dz = move.z;
          if (blocked(cam.position.x + dx, cam.position.z + dz)) {
            if (!blocked(cam.position.x + dx, cam.position.z)) dz = 0;
            else if (!blocked(cam.position.x, cam.position.z + dz)) dx = 0;
            else { dx = 0; dz = 0; } // cornered
          }
          if (dx !== 0 || dz !== 0) {
            walkPos.x += dx;
            walkPos.z += dz;
            controls.target.x += dx;
            controls.target.z += dz;
          }
          walkPos.y = 1.6;
        }
      }
      for (const d of doors) {
        doorOpen.set(d.doorId, d.current);
        if (Math.abs(d.target - d.current) > 0.001) {
          d.current += (d.target - d.current) * Math.min(1, dt * 7);
          d.hinge.rotation.y = d.current * d.swing;
        }
      }
      controls.update();
      /* OrbitControls orbits the camera around its target, which in first person means a
       * look turns into a four-metre arc — you swing through the furniture and, pressed
       * against a table, cannot turn at all. Re-anchor it every frame: keep the heading
       * the drag produced, but put the camera back where the walker is standing and hang
       * the target in front of it. Looking becomes a pivot in place; only WASD moves. */
      if (cameraRef.current === "walk") {
        // walkPos is seeded by applyCamera. If walk mode was entered in the same tick the
        // view switched to 3D, this scene had not mounted yet and neither applyCamera nor
        // the store subscription ran for it — without this the walker would be pinned to
        // the world origin, standing in the corner of the plan at floor level.
        if (walkPos.lengthSq() === 0) applyCamera("walk");
        const back = look.subVectors(cam.position, controls.target).normalize();
        cam.position.copy(walkPos);
        controls.target.copy(walkPos).addScaledVector(back, -2);
      }
      composer.render();
    };
    animate();

    // react to camera mode changes without rebuilding
    const unsub = store.subscribe((s, prev) => {
      if (s.editor.camera !== prev.editor.camera) applyCamera(s.editor.camera);
    });

    return () => {
      unsub();
      cancelAnimationFrame(raf);
      ro.disconnect();
      offObj();
      offPng();
      offDoors();
      envRT.dispose();
      pmrem.dispose();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      renderer.domElement.removeEventListener("mousedown", onDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mousemove", onMove);
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  return (
    <div className="scene3d-wrap">
      <div ref={mountRef} className="scene3d" />
      {placingKind && (
        <div className="placing-hint">
          Click on the floor to place: <strong>{catalogByKind(placingKind)?.label ?? placingKind}</strong> — Esc to cancel
        </div>
      )}
      <div className="camera-hint">
        {camera === "walk" ? "WASD / arrows to walk · drag to look · click a door to open it" : camera === "top" ? "Top view · drag to pan · click a door to open it" : "Drag to orbit · scroll to zoom · click a door to open it"}
      </div>
    </div>
  );
}
