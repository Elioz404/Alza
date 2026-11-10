/**
 * Scene3D — the "alzado". The React side of the 3D view: it mounts one viewport (viewport.ts)
 * for as long as the view is on screen and feeds it the plan and the camera mode.
 *
 * The viewport is created in a mount-only effect, so a change to the plan never creates a
 * renderer or a WebGL context. Changes reach it through a store subscription, outside React's
 * render: an agent's run of edits updates the scene without re-rendering this component, which
 * reads from the store only the little its own markup shows.
 *
 * Loaded on demand (ui/App.tsx), so three.js is not part of the page's first chunk.
 */

import { useEffect, useRef } from "react";
import { store } from "../model/store";
import { useAppStore } from "../ui/useAppStore";
import { catalogOf } from "../model/catalog";
import { createViewport } from "./viewport";

export function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const camera = useAppStore((s) => s.editor.camera);
  // a string, so a plan change that leaves it alone does not re-render the view
  const placingLabel = useAppStore((s) => {
    const kind = s.editor.drawMode === "place" ? s.editor.placingKind : null;
    return kind ? (catalogOf(s.model).get(kind)?.label ?? kind) : null;
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const { model, editor } = store.getState();
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

  return (
    <div className="scene3d-wrap">
      <div ref={mountRef} className="scene3d" />
      {placingLabel && (
        <div className="placing-hint">
          Click on the floor to place: <strong>{placingLabel}</strong> — Esc to cancel
        </div>
      )}
      <div className="camera-hint">
        {camera === "walk" ? "WASD / arrows to walk · drag to look · click a door to open it" : camera === "top" ? "Top view · drag to pan · click a door to open it" : "Drag to orbit · scroll to zoom · click a door to open it"}
      </div>
    </div>
  );
}
