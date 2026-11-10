/**
 * Scene3D — the "alzado". The React side of the 3D view: it mounts one viewport (viewport.ts)
 * for as long as the view is on screen and feeds it the plan and the camera mode, and floats
 * the view's own chrome over it (overlays/SceneOverlays.tsx: the camera switch and the hint
 * bar). Export lives in the top bar's Export menu, which reaches the viewport over the bus.
 *
 * The viewport is created in a mount-only effect, so a change to the plan never creates a
 * renderer or a WebGL context. Changes reach it through a store subscription, outside React's
 * render: an agent's run of edits updates the scene without re-rendering this component, which
 * reads from the store only the little its own markup shows.
 *
 * If the scene cannot start (no WebGL) or stops, the failure stays inside the canvas and says
 * so (overlays/SceneStates.tsx), instead of being reported as a failed download.
 *
 * Loaded on demand (src/ui/shell/CanvasRegion.tsx), so three.js is not part of the page's
 * first chunk.
 */

import { useEffect, useRef } from "react";
import { pageActions, store } from "../model/store";
import { isInsideOverlay, isTypingTarget } from "../ui/keys";
import { placeInMiddle } from "../editor/canvasState";
import { createViewport } from "./viewport";
import { SceneOverlays } from "./overlays/SceneOverlays";
import { SceneErrorBoundary } from "./overlays/SceneStates";

function SceneView() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const { model, editor } = store.getState();
    // throws when the browser cannot give the page a WebGL context; SceneErrorBoundary says so
    const viewport = createViewport(mount, model, editor.camera);
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.model !== prev.model) viewport.setModel(s.model);
      if (s.editor.camera !== prev.editor.camera) viewport.setCamera(s.editor.camera);
    });
    return () => {
      unsubscribe();
      viewport.dispose();
    };
  }, []);

  // While a piece is being placed, Esc stops and Enter puts it down in the middle of the view,
  // as on the plan (the 2D editor is not mounted while the 3D view is, so it cannot hear the
  // keys). Neither acts on a key typed into a field, pressed on a control of its own, or
  // pressed inside a dialog, a menu or a popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "Escape" && e.key !== "Enter") || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target) || isInsideOverlay(e.target)) return;
      if (store.getState().editor.drawMode !== "place") return;
      if (e.key === "Enter") {
        if (e.target instanceof Element && e.target.closest("button, a[href], [role]")) return;
        e.preventDefault();
        placeInMiddle();
        return;
      }
      e.preventDefault();
      pageActions.setDrawMode("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scene3d-wrap">
      <div ref={mountRef} className="scene3d" />
      <SceneOverlays />
    </div>
  );
}

export function Scene3D() {
  return (
    <SceneErrorBoundary>
      <SceneView />
    </SceneErrorBoundary>
  );
}
