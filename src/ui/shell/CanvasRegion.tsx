/**
 * The canvas: the 2D editor or the 3D view, and above either one the overlay layer whose slots
 * the canvas, approvals and firstRun surfaces fill (zoom bottom left, hint bottom centre,
 * legend top right, the levels top left, the first-run state centred, plan marks over the
 * drawing).
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
import { deferred, overlayPlaceholder } from "../deferred";
import { useShowsFirstRun } from "../firstRun/shows";
import { useReview } from "../approvals/review";
import { CANVAS_REGION_ID } from "./ids";

/**
 * While any request waits for an answer, a value that changes with each request that arrives
 * and each Review pressed (null when nothing waits): each one asks again for a card that could
 * not be fetched.
 */
function useReviewNeeded(): string | null {
  const ids = useAppStore((s) => s.approvals.map((a) => a.id).join(" "));
  const { focusToken } = useReview();
  return ids ? `${ids}#${focusToken}` : null;
}

// The page opens on the demo plan with nothing waiting, so neither the first-run state nor the
// approval marks and card show at first paint; they arrive with the idle prefetch. If either
// could not be fetched, it asks again and says so once it has something to show.
const FirstRun = deferred(
  "the first-run state",
  () => import("../firstRun/FirstRun").then((m) => m.FirstRun),
  overlayPlaceholder("The empty-plan guide", useShowsFirstRun),
);
const PlanMarks = deferred(
  "the approval marks",
  () => import("../approvals/PlanMarks").then((m) => m.PlanMarks),
  overlayPlaceholder("The agent's request card", useReviewNeeded),
);

/** Whether the plan is showing: the level switcher is the plan's. */
const useInPlanView = (): boolean => useAppStore((s) => s.editor.view === "2d");

// The level switcher (and the line that says a level changed) arrives with the idle prefetch:
// in Plan view it always has something to show, so a failed fetch says so there.
const LevelSwitcher = deferred(
  "the level switcher",
  () => import("../canvas/LevelSwitcher").then((m) => m.LevelSwitcher),
  overlayPlaceholder("The level switcher", useInPlanView),
);

/**
 * The shared session over the 3D view: the agent's marker, what it points at, the other tabs'
 * pointers (src/ui/session/ScenePresence.tsx). Fetched after the first paint; nothing stands in.
 */
const ScenePresence = deferred("the session's 3D markers", () => import("../session/ScenePresence").then((m) => m.ScenePresence), () => null);

const loadScene3D: ViewLoader = () => import("../../three/Scene3D").then((m) => ({ default: m.Scene3D }));

export function CanvasRegion() {
  const view = useAppStore((s) => s.editor.view);
  return (
    // tabIndex -1: the skip link moves focus here, so the next Tab starts inside and the region is announced
    <main id={CANVAS_REGION_ID} className="canvas" data-view={view} aria-label={view === "2d" ? "Plan" : "3D view"} tabIndex={-1}>
      {view === "2d" ? <Editor /> : <LazyView load={loadScene3D} loading={<SceneLoading />} failed={(retry) => <SceneLoadFailed retry={retry} />} />}
      <div className="canvas__overlays">
        {view === "3d" ? <ScenePresence /> : null}
        <div className="canvas__slot canvas__slot--marks">
          <PlanMarks />
        </div>
        <div className="canvas__slot canvas__slot--levels">
          <LevelSwitcher />
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
