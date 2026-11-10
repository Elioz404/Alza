/**
 * The 3D view's states other than the scene itself, all on the scene's own backdrop so the
 * swap to the loaded view never flashes:
 *
 *  - SceneLoading: the view's code is on its way. A skeleton of the chrome that is coming (the
 *    camera switch, the hint bar) and one quiet line, never a spinner in the middle.
 *  - SceneLoadFailed: the code could not be fetched. What broke, what to do, Try again.
 *  - SceneErrorBoundary: the view loaded but could not run (no WebGL, a lost context, a bug).
 *    It keeps the failure inside the canvas, says so in words, and offers Try again and a way
 *    back to the plan.
 *
 * None of this imports three.js, so the loading and load-failed states can ship in the page's
 * first chunk (src/ui/shell/CanvasRegion.tsx passes them to LazyView).
 */

import { Component, type ReactNode } from "react";
import { pageActions } from "../../model/store";
import { Button, IconError, IconPlan } from "../../ui/primitives";
import "./overlays.css";

/** While the 3D view's code loads. */
export function SceneLoading() {
  return (
    <div className="scene3d-wrap">
      <div className="scene3d scene-state scene-state--loading" role="status">
        <span className="scene-skeleton scene-skeleton--toolbar" aria-hidden="true" />
        <span className="scene-state__line">Loading the 3D view</span>
        <span className="scene-skeleton scene-skeleton--hint" aria-hidden="true" />
      </div>
    </div>
  );
}

interface CardProps {
  title: string;
  body: ReactNode;
  actions: ReactNode;
}

function ErrorCard({ title, body, actions }: CardProps) {
  return (
    <div className="scene-state__card" role="alert">
      <IconError size="lg" className="scene-state__icon" />
      <div className="scene-state__text">
        <h2 className="scene-state__title">{title}</h2>
        <p className="scene-state__body">{body}</p>
        <div className="scene-state__actions">{actions}</div>
      </div>
    </div>
  );
}

const backToPlan = (
  <Button variant="ghost" icon={IconPlan} onClick={() => pageActions.setView("2d")}>
    Back to the plan
  </Button>
);

/** When the 3D view's code could not be fetched. */
export function SceneLoadFailed({ retry }: { retry: () => void }) {
  return (
    <div className="scene3d-wrap">
      <div className="scene3d scene-state">
        <ErrorCard
          title="Could not load the 3D view"
          body="The page could not fetch it. Check the connection, then try again. Your plan is unchanged."
          actions={
            <>
              <Button variant="primary" onClick={retry}>
                Try again
              </Button>
              {backToPlan}
            </>
          }
        />
      </div>
    </div>
  );
}

/** Does this error say the browser could not give the page a WebGL context? */
const isWebGLFailure = (error: unknown): boolean => /webgl|context/i.test(error instanceof Error ? error.message : String(error));

interface BoundaryProps {
  children: ReactNode;
}

/**
 * Catches what the scene throws while it starts or runs (the renderer is created in an effect;
 * React routes an effect's error here too). Try again mounts the scene afresh.
 */
export class SceneErrorBoundary extends Component<BoundaryProps, { error: unknown; attempt: number }> {
  state: { error: unknown; attempt: number } = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.warn("[alza] the 3D view stopped", error);
  }

  private retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    const { error, attempt } = this.state;
    if (!error) return <Inner key={attempt}>{this.props.children}</Inner>;
    const webgl = isWebGLFailure(error);
    return (
      <div className="scene3d-wrap">
        <div className="scene3d scene-state">
          <ErrorCard
            title={webgl ? "This browser could not start 3D graphics" : "The 3D view stopped"}
            body={
              webgl
                ? "It needs WebGL, which is off or unavailable here. Turn on hardware acceleration in the browser's settings, or open Alza in another browser. Your plan is unchanged."
                : "Something went wrong while drawing the scene. Your plan is unchanged; try again, or keep working on the plan."
            }
            actions={
              <>
                <Button variant="primary" onClick={this.retry}>
                  Try again
                </Button>
                {backToPlan}
              </>
            }
          />
        </div>
      </div>
    );
  }
}

/** A keyed wrapper, so Try again remounts the scene (and creates a new renderer). */
function Inner({ children }: { children: ReactNode }) {
  return children;
}
