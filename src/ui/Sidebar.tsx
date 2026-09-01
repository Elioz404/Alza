/** Sidebar — Model / Check / Catalog / Notes tabs. */

import { useState } from "react";
import { useAppStore, actions, logActivity } from "../model/store";
import { checkModel } from "../model/issues";
import { CATALOG } from "../model/catalog";
import { TOOLS } from "../mcp/tools";
import { seedLoft } from "../model/seed";
import { ToolRunner } from "./ToolRunner";
import { SupplierPanel } from "./SupplierPanel";
import { thumbnailFor } from "../three/thumbnails";

type Tab = "model" | "check" | "catalog" | "supplier" | "notes" | "tools";

export function Sidebar() {
  const [tab, setTab] = useState<Tab>("catalog");
  const model = useAppStore((s) => s.model);
  const notes = useAppStore((s) => s.notes);
  const selectedWallId = useAppStore((s) => s.editor.selectedWallId);
  const requireApproval = useAppStore((s) => s.requireApproval);
  const supplierTools = useAppStore((s) => s.supplierTools);
  const catalogRev = useAppStore((s) => s.catalogRev);
  const [noteText, setNoteText] = useState("");
  const issues = checkModel(model);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "model", label: "Model" },
    { id: "check", label: "Check", badge: issues.length },
    { id: "catalog", label: "Catalog" },
    { id: "supplier", label: "Supplier", badge: supplierTools.length || undefined },
    { id: "notes", label: "Notes", badge: notes.length },
    { id: "tools", label: "Tools" },
  ];

  const onUploadBlueprint = (file: File) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        // reencode to JPEG ≤1600 px (localStorage-friendly)
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const aspect = img.height / img.width;
        actions.setUnderlay({
          dataUrl, opacity: 0.55, x: 0, y: 0, w: 8, h: 8 * aspect,
          pw: canvas.width, ph: canvas.height,
        });
        logActivity("human", "set_underlay", `Blueprint loaded (${canvas.width}×${canvas.height}), opacity 55%. Drag walls over it to trace.`);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge ? <span className={`badge ${t.id === "check" ? "warn" : ""}`}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="sidebar-body">
        {tab === "model" && (
          <div className="panel">
            <label className="field">
              Plan name
              <input
                value={model.name}
                onChange={(e) => actions.setPlanName(e.target.value)}
              />
            </label>
            <div className="stat-grid">
              <div><strong>{model.walls.length}</strong> walls</div>
              <div><strong>{model.openings.filter((o) => o.kind === "door").length}</strong> doors</div>
              <div><strong>{model.openings.filter((o) => o.kind === "window").length}</strong> windows</div>
              <div><strong>{model.rooms.length}</strong> rooms</div>
              <div><strong>{model.items.length}</strong> items</div>
              <div><strong>{model.rooms.reduce((a, r) => a + r.w * r.h, 0).toFixed(1)}</strong> m²</div>
            </div>
            <button
              onClick={() => {
                actions.loadModel(seedLoft());
                logActivity("human", "load_seed", "Sunset Loft demo loaded.");
              }}
            >
              Load Sunset Loft demo
            </button>
            <button
              className="danger"
              onClick={() => {
                const r = actions.clearModel();
                logActivity("human", "clear_model", r.summary, r.ok);
              }}
            >
              Clear plan
            </button>
            <label className="toggle-row" title="When on, any destructive tool an agent calls is parked on the page until you approve it">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => actions.setRequireApproval(e.target.checked)}
              />
              <span>
                Ask me before destructive agent actions
                <small>clear_model, remove_wall, remove_room, remove_item, remove_opening</small>
              </span>
            </label>
            <div className="field">
              Blueprint underlay
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onUploadBlueprint(e.target.files[0])}
              />
              {model.underlay && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={model.underlay.opacity}
                    onChange={(e) =>
                      actions.setUnderlay({ ...model.underlay!, opacity: Number(e.target.value) })
                    }
                  />
                  <button onClick={() => actions.setUnderlay(null)}>Remove underlay</button>
                </>
              )}
            </div>
            {selectedWallId && (
              <p className="hint">
                Wall <code>{selectedWallId}</code> selected — the dynamic tool{" "}
                <code>extend_selected_wall</code> is published for your agent right now.
              </p>
            )}
          </div>
        )}

        {tab === "check" && (
          <div className="panel">
            {issues.length === 0 ? (
              <p className="ok-msg">✓ 0 issues — the plan is clean. Every wall connects, every vano fits, nothing blocks a door.</p>
            ) : (
              issues.map((i, idx) => (
                <div key={idx} className={`issue ${i.severity}`}>
                  <strong>{i.severity === "error" ? "Error" : "Warning"}</strong> · {i.message}
                  <div className="issue-refs">{i.refs.join(", ")}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "catalog" && (
          <div className="panel catalog-grid" key={catalogRev}>
            {CATALOG.map((c) => {
              const thumb = thumbnailFor(c.kind);
              return (
                <button
                  key={c.kind}
                  className="catalog-card"
                  onClick={() => actions.setDrawMode("place", c.kind)}
                  title={`${c.w} × ${c.d} × ${c.h} m — click, then click on the plan`}
                >
                  {thumb ? (
                    <img className="catalog-thumb" src={thumb} alt="" draggable={false} />
                  ) : (
                    <span className="catalog-swatch" style={{ background: c.color }} />
                  )}
                  <span className="catalog-label">{c.label}</span>
                  <span className="catalog-dims">{c.w} × {c.d} m</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "supplier" && <SupplierPanel />}

        {tab === "notes" && (
          <div className="panel">
            <div className="note-compose">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Leave a note for your agent (e.g. “make the bedroom bigger”)"
                rows={2}
              />
              <button
                onClick={() => {
                  if (!noteText.trim()) return;
                  actions.leaveNote("human", noteText.trim());
                  setNoteText("");
                }}
              >
                Add note
              </button>
            </div>
            {notes.length === 0 && <p className="hint">No notes yet. Agents read and write here too — it's the shared margin of the plan.</p>}
            {[...notes].reverse().map((n) => (
              <div key={n.id} className={`note ${n.author}`}>
                <span className="note-author">{n.author === "agent" ? "AGENT" : "YOU"}</span>
                {n.text}
              </div>
            ))}
          </div>
        )}

        {tab === "tools" && (
          <div className="panel">
            <p className="hint">
              These are the exact {TOOLS.length} tools your AI agent discovers via WebMCP, plus the dynamic
              one. Run them manually to test flows — every call is logged below in the activity feed.
            </p>
            <ToolRunner />
          </div>
        )}
      </div>
    </aside>
  );
}
