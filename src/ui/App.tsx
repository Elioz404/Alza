/** App shell — header (view/camera/tools status), editor or 3D scene, sidebar, activity feed. */

import { pageActions } from "../model/store";
import { useAppStore } from "./useAppStore";
import { dispatch } from "../model/commands";
import { Editor } from "../editor/Editor";
import { Sidebar } from "./Sidebar";
import { ActivityFeed } from "./ActivityFeed";
import { ApprovalBar } from "./ApprovalBar";
import { SupplierBridge } from "./SupplierBridge";
import { LazyView, type ViewLoader } from "./LazyView";
import { bus, EVENTS } from "../model/sceneBus";
import { CAMERA_MODES } from "../model/limits";

/**
 * The 3D view, and three.js with it, is fetched the first time it is shown: the 2D editor the
 * page opens on does not wait for a 3D engine it does not use. If the fetch fails, only the
 * canvas area says so (LazyView); the header, the sidebar and the way back to 2D stay.
 */
const loadScene3D: ViewLoader = () => import("../three/Scene3D").then((m) => ({ default: m.Scene3D }));

/** What the canvas area shows while the 3D view is on its way. */
const sceneLoading = (
  <div className="scene3d-wrap">
    <div className="scene3d scene3d-loading">Loading 3D…</div>
  </div>
);

/** What it shows when the 3D view could not be fetched. */
const sceneFailed = (retry: () => void) => (
  <div className="scene3d-wrap">
    <div className="scene3d scene3d-loading scene3d-failed" role="alert">
      <span>Could not load the 3D view.</span>
      <button onClick={retry}>Retry</button>
    </div>
  </div>
);

export function App() {
  const view = useAppStore((s) => s.editor.view);
  const camera = useAppStore((s) => s.editor.camera);
  const drawMode = useAppStore((s) => s.editor.drawMode);
  const webmcpStatus = useAppStore((s) => s.webmcpStatus);
  const planName = useAppStore((s) => s.model.name);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">▲</span>
          <span className="brand-name">Alza</span>
          <span className="brand-plan">{planName}</span>
        </div>

        <div className="header-group">
          {view === "2d" ? (
            <>
              <button className={drawMode === "select" ? "active" : ""} onClick={() => pageActions.setDrawMode("select")}>
                Select
              </button>
              <button className={drawMode === "wall" ? "active" : ""} onClick={() => pageActions.setDrawMode("wall")}>
                + Wall
              </button>
              <button className={drawMode === "room" ? "active" : ""} onClick={() => pageActions.setDrawMode("room")}>
                + Room
              </button>
              <button onClick={() => dispatch({ type: "undo" }, { actor: "human" })}>Undo</button>
            </>
          ) : (
            <>
              {CAMERA_MODES.map((m) => (
                <button key={m} className={camera === m ? "active" : ""} onClick={() => pageActions.setCamera(m)}>
                  {m === "orbit" ? "Orbit" : m === "top" ? "Top" : "Walk"}
                </button>
              ))}
              <button onClick={() => bus.emit(EVENTS.EXPORT_OBJ)}>Export OBJ</button>
              <button onClick={() => bus.emit(EVENTS.EXPORT_PNG)}>Snapshot PNG</button>
            </>
          )}
        </div>

        <div className="header-group">
          <button className="primary" onClick={() => (view === "2d" ? pageActions.build3d() : pageActions.setView("2d"))}>
            {view === "2d" ? "Build 3D ▲" : "Back to 2D"}
          </button>
          <span className={`pill ${webmcpStatus}`} title={webmcpStatus === "live" ? "WebMCP runtime detected — tools are live for your agent" : "No WebMCP runtime — use the Tools tab to run tools manually"}>
            {webmcpStatus === "live" ? "● Site tools live" : "○ Site tools off"}
          </span>
        </div>
      </header>

      <main className="main">
        <div className="canvas-area">
          {view === "2d" ? (
            <Editor />
          ) : (
            <LazyView load={loadScene3D} loading={sceneLoading} failed={sceneFailed} />
          )}
        </div>
        <Sidebar />
      </main>

      <SupplierBridge />
      <ApprovalBar />
      <ActivityFeed />
    </div>
  );
}
