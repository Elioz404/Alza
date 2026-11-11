/**
 * Scene3D — the "alzado". The React side of the 3D view: it mounts one viewport (viewport.ts)
 * for as long as the view is on screen and feeds it the plan, the camera mode, the drawing
 * style, the selection and the pending requests; it holds the layer the room names are set in
 * (labels.ts), and floats the view's own chrome over it (overlays/SceneOverlays.tsx: the camera
 * switch, the View settings and the hint bar). Export lives in the top bar's Export menu, which reaches the viewport over the bus.
 *
 * The viewport is created in a mount-only effect, so a change to the plan never creates a
 * renderer or a WebGL context. Changes reach it through a store subscription, outside React's
 * render: an agent's run of edits updates the scene without re-rendering this component, which
 * reads from the store only the little its own markup shows.
 *
 * If the scene cannot start (no WebGL) or stops, the failure stays inside the canvas and says
 * so (overlays/SceneStates.tsx), instead of being reported as a failed download.
 *
 * The viewport holds the whole plan, every storey of it, and is told which level is being
 * worked on and which levels the View panel shows (levelView.ts). PageUp and PageDown step the
 * level being worked on in this view too, through the shell's shortcuts (src/ui/shell/shortcuts.ts),
 * which listen in both views.
 *
 * Loaded on demand (src/ui/shell/CanvasRegion.tsx), so three.js is not part of the page's
 * first chunk.
 */

import { useEffect, useRef } from "react";
import { activeLevelId, pageActions, store, type EditorState } from "../model/store";
import { isInsideOverlay, isTypingTarget } from "../ui/keys";
import { placeInMiddle } from "../editor/canvasState";
import { deselectAll, handleSelectionKey } from "../editor/selectionKeys";
import { createViewport } from "./viewport";
import { levelsShown, onLevelsShown } from "./levelView";
import type { Selected } from "./marks";
import { SceneOverlays } from "./overlays/SceneOverlays";
import { presence, type PresenceState } from "../model/presence";
import { entityInfo } from "../model/places";
import type { Focused } from "./marks";
import { SceneErrorBoundary } from "./overlays/SceneStates";

/** What the agent is touching, and what it points at, as the 3D view outlines them in its colour. */
function focusOf(p: PresenceState): Focused[] {
  const model = store.getState().model;
  const ids = [...new Set([...p.agent.focus, ...p.points.map((m) => m.entityId)])];
  return ids.flatMap((id) => {
    const info = entityInfo(model, id);
    return info ? [{ type: info.type, id }] : [];
  });
}

/** The store's selection, as the 3D view outlines it. */
function selectedOf(editor: EditorState): Selected | null {
  if (editor.selectedWallId) return { type: "wall", id: editor.selectedWallId };
  if (editor.selectedRoomId) return { type: "room", id: editor.selectedRoomId };
  if (editor.selectedItemId) return { type: "item", id: editor.selectedItemId };
  if (editor.selectedStairId) return { type: "stair", id: editor.selectedStairId };
  if (editor.selectedColumnId) return { type: "column", id: editor.selectedColumnId };
  return null;
}

function SceneView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const state = store.getState();
    const { model, editor, approvals } = state;
    // throws when the browser cannot give the page a WebGL context; SceneErrorBoundary says so
    const viewport = createViewport(mount, model, editor.camera, {
      labels: labelsRef.current,
      style: editor.scene,
      selected: selectedOf(editor),
      approvals,
      activeLevelId: activeLevelId(state),
      levelsShown: levelsShown(),
    });
    const offShown = onLevelsShown(() => viewport.setLevelsShown(levelsShown()));
    viewport.setFocus(focusOf(presence.getState()));
    const offPresence = presence.subscribe((p, prev) => {
      if (p.agent !== prev.agent || p.points !== prev.points) viewport.setFocus(focusOf(p));
    });
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.model !== prev.model) viewport.setModel(s.model);
      const active = activeLevelId(s);
      if (active !== activeLevelId(prev)) viewport.setActiveLevel(active);
      if (s.editor.camera !== prev.editor.camera) viewport.setCamera(s.editor.camera);
      if (s.editor.scene !== prev.editor.scene) viewport.setStyle(s.editor.scene);
      if (s.approvals !== prev.approvals) viewport.setPending(s.approvals);
      if (s.model !== prev.model) viewport.setFocus(focusOf(presence.getState()));
      const e = s.editor;
      const p = prev.editor;
      if (
        e.selectedWallId !== p.selectedWallId ||
        e.selectedRoomId !== p.selectedRoomId ||
        e.selectedItemId !== p.selectedItemId ||
        e.selectedStairId !== p.selectedStairId ||
        e.selectedColumnId !== p.selectedColumnId ||
        s.model !== prev.model
      ) {
        viewport.setSelection(selectedOf(e));
      }
    });
    return () => {
      unsubscribe();
      offPresence();
      offShown();
      viewport.dispose();
    };
  }, []);

  // The plan's keys, here too (the 2D editor is not mounted while the 3D view is, so it cannot
  // hear them): Delete removes what a click on the model selected and Ctrl/Cmd+Z undoes, as on
  // the plan (src/editor/selectionKeys.ts); while a piece is being placed, Esc stops and Enter
  // puts it down in the middle of the view, and otherwise Esc lets go of the selection. None
  // acts on a key typed into a field or pressed inside a dialog, a menu or a popover, nor on one
  // something else already answered (the View panel's Escape); Enter not on a control either.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || isInsideOverlay(e.target)) return;
      if (handleSelectionKey(e)) return;
      if ((e.key !== "Escape" && e.key !== "Enter") || e.ctrlKey || e.metaKey || e.altKey) return;
      const placing = store.getState().editor.drawMode === "place";
      if (e.key === "Enter") {
        if (!placing || (e.target instanceof Element && e.target.closest("button, a[href], [role]"))) return;
        e.preventDefault();
        placeInMiddle();
        return;
      }
      const { selectedWallId, selectedRoomId, selectedItemId, selectedStairId, selectedColumnId } = store.getState().editor;
      if (!placing && !selectedWallId && !selectedRoomId && !selectedItemId && !selectedStairId && !selectedColumnId) return;
      e.preventDefault();
      if (placing) pageActions.setDrawMode("select");
      else deselectAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scene3d-wrap">
      <div ref={mountRef} className="scene3d" />
      {/* the room names, placed over the model by the viewport (labels.ts); aria-hidden there */}
      <div ref={labelsRef} className="scene-labels" />
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
