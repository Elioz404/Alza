/** App shell — header (view/camera/tools status), editor or 3D scene, sidebar, activity feed. */

import { useAppStore, actions, logActivity } from "../model/store";
import { Editor } from "../editor/Editor";
import { Scene3D } from "../three/Scene3D";
import { Sidebar } from "./Sidebar";
import { ActivityFeed } from "./ActivityFeed";
import { ApprovalBar } from "./ApprovalBar";
import { SupplierBridge } from "./SupplierBridge";
import { bus, EVENTS } from "../three/exportBus";

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
              <button className={drawMode === "select" ? "active" : ""} onClick={() => actions.setDrawMode("select")}>
                Select
              </button>
              <button className={drawMode === "wall" ? "active" : ""} onClick={() => actions.setDrawMode("wall")}>
                + Wall
              </button>
              <button className={drawMode === "room" ? "active" : ""} onClick={() => actions.setDrawMode("room")}>
                + Room
              </button>
              <button
                onClick={() => {
                  const r = actions.undo();
                  logActivity("human", "undo", r.summary, r.ok);
                }}
              >
                Undo
              </button>
            </>
          ) : (
            <>
              {(["orbit", "top", "walk"] as const).map((m) => (
                <button key={m} className={camera === m ? "active" : ""} onClick={() => actions.setCamera(m)}>
                  {m === "orbit" ? "Orbit" : m === "top" ? "Top" : "Walk"}
                </button>
              ))}
              <button onClick={() => bus.emit(EVENTS.EXPORT_OBJ)}>Export OBJ</button>
              <button onClick={() => bus.emit(EVENTS.EXPORT_PNG)}>Snapshot PNG</button>
            </>
          )}
        </div>

        <div className="header-group">
          <button className="primary" onClick={() => (view === "2d" ? actions.build3d() : actions.setView("2d"))}>
            {view === "2d" ? "Build 3D ▲" : "Back to 2D"}
          </button>
          <span className={`pill ${webmcpStatus}`} title={webmcpStatus === "live" ? "WebMCP runtime detected — tools are live for your agent" : "No WebMCP runtime — use the Tools tab to run tools manually"}>
            {webmcpStatus === "live" ? "● Site tools live" : "○ Site tools off"}
          </span>
        </div>
      </header>

      <main className="main">
        <div className="canvas-area">{view === "2d" ? <Editor /> : <Scene3D key={JSON.stringify([view])} />}</div>
        <Sidebar />
      </main>

      <SupplierBridge />
      <ApprovalBar />
      <ActivityFeed />
    </div>
  );
}
