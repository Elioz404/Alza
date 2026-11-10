/**
 * The canvas: the 2D editor or the 3D view, and above either one the overlay layer whose slots
 * the canvas, approvals and firstRun surfaces fill (zoom bottom left, hint bottom centre,
 * legend top right, the first-run state centred, plan marks over the drawing).
 *
 * The 3D view, and three.js with it, is fetched the first time it is shown (LazyView); if that
 * fails, only this region says so and offers to try again (src/three/overlays/SceneStates.tsx,
 * which does not import three.js, so it is in the first chunk).
 */

import { Editor } from "../../editor/Editor";
import { LazyView, type ViewLoader } from "../LazyView";
import { useAppStore } from "../useAppStore";
import { SceneLoadFailed, SceneLoading } from "../../three/overlays/SceneStates";
import { HintBar } from "../canvas/HintBar";
import { ZoomControl } from "../canvas/ZoomControl";
import { Legend } from "../canvas/Legend";
import { FirstRun } from "../firstRun/FirstRun";
import { PlanMarks } from "../approvals/PlanMarks";
import { CANVAS_REGION_ID } from "./ids";

const loadScene3D: ViewLoader = () => import("../../three/Scene3D").then((m) => ({ default: m.Scene3D }));

export function CanvasRegion() {
  const view = useAppStore((s) => s.editor.view);
  return (
    // tabIndex -1: the skip link moves focus here, so the next Tab starts inside and the region is announced
    <main id={CANVAS_REGION_ID} className="canvas" data-view={view} aria-label={view === "2d" ? "Plan" : "3D view"} tabIndex={-1}>
      {view === "2d" ? <Editor /> : <LazyView load={loadScene3D} loading={<SceneLoading />} failed={(retry) => <SceneLoadFailed retry={retry} />} />}
      <div className="canvas__overlays">
        <div className="canvas__slot canvas__slot--marks">
          <PlanMarks />
        </div>
        <div className="canvas__slot canvas__slot--legend">
          <Legend />
        </div>
        <div className="canvas__slot canvas__slot--center">
          <FirstRun />
        </div>
        <div className="canvas__slot canvas__slot--zoom">
          <ZoomControl />
        </div>
        <div className="canvas__slot canvas__slot--hint">
          <HintBar />
        </div>
      </div>
    </main>
  );
}
