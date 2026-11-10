/** Sidebar — Model / Check / Catalog / Notes tabs. */

import { useMemo, useState } from "react";
import { pageActions } from "../model/store";
import { useAppStore } from "./useAppStore";
import { dispatch } from "../model/commands";
import { checkModel } from "../model/issues";
import { catalogFor } from "../model/catalog";
import { DESTRUCTIVE_TOOL_NAMES, TOOLS } from "../mcp/tools";
import { seedLoft } from "../model/seed";
import { ToolRunner } from "./ToolRunner";
import { SupplierPanel } from "./SupplierPanel";
import { thumbnailFor } from "../three/thumbnails";
import { OPACITY, TEXT, UNDERLAY } from "../model/limits";
import { decodeUnderlay } from "./underlay";
import { useGesture } from "./useGesture";

type Tab = "model" | "check" | "catalog" | "supplier" | "notes" | "tools";

export function Sidebar() {
  const [tab, setTab] = useState<Tab>("catalog");
  const model = useAppStore((s) => s.model);
  const notes = useAppStore((s) => s.notes);
  const selectedWallId = useAppStore((s) => s.editor.selectedWallId);
  const requireApproval = useAppStore((s) => s.requireApproval);
  const supplierTools = useAppStore((s) => s.supplierTools);
  const [noteText, setNoteText] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  // the model is immutable, so a new check is needed exactly when it is a new object
  const issues = useMemo(() => checkModel(model), [model]);
  const catalog = catalogFor(model.kinds);
  const nameEdit = useGesture();
  const opacityEdit = useGesture();

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "model", label: "Model" },
    { id: "check", label: "Check", badge: issues.length },
    { id: "catalog", label: "Catalog" },
    { id: "supplier", label: "Supplier", badge: supplierTools.length || undefined },
    { id: "notes", label: "Notes", badge: notes.length },
    { id: "tools", label: "Tools" },
  ];

  const onUploadBlueprint = async (file: File) => {
    // checked, bounded and re-encoded to a small JPEG before it reaches the model (see underlay.ts)
    setUploadError(null);
    let underlay;
    try {
      underlay = await decodeUnderlay(file);
    } catch (err) {
      // the file never became an underlay, so there is no change to dispatch: say so here
      setUploadError(`Blueprint not loaded: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const r = dispatch({ type: "set_underlay", underlay }, { actor: "human" });
    if (!r.ok) setUploadError(`Blueprint not loaded: ${r.summary}`);
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
                maxLength={TEXT.planName}
                onChange={(e) => nameEdit.update({ type: "set_plan_name", name: e.target.value })}
                onBlur={nameEdit.end}
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
            <button onClick={() => dispatch({ type: "load_model", model: seedLoft() }, { actor: "human" })}>
              Load Sunset Loft demo
            </button>
            <button className="danger" onClick={() => dispatch({ type: "clear_model" }, { actor: "human" })}>
              Clear plan
            </button>
            <label className="toggle-row" title="When on, any destructive tool an agent calls is parked on the page until you approve it">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => pageActions.setRequireApproval(e.target.checked)}
              />
              <span>
                Ask me before destructive agent actions
                <small>{DESTRUCTIVE_TOOL_NAMES.join(", ")}</small>
              </span>
            </label>
            <div className="field">
              Blueprint underlay
              <input
                type="file"
                accept={UNDERLAY.acceptedTypes.join(",")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onUploadBlueprint(file);
                }}
              />
              {uploadError && <p className="field-error">{uploadError}</p>}
              {model.underlay && (
                <>
                  <input
                    type="range"
                    min={OPACITY.min}
                    max={OPACITY.max}
                    step={0.05}
                    value={model.underlay.opacity}
                    onChange={(e) => {
                      // one gesture per slide: the plan follows every step, the feed and undo get
                      // one entry, and a refusal is reported there rather than swallowed
                      if (model.underlay) {
                        opacityEdit.update({ type: "set_underlay", underlay: { ...model.underlay, opacity: Number(e.target.value) } });
                      }
                    }}
                    onPointerUp={opacityEdit.end}
                    onKeyUp={opacityEdit.end}
                    onBlur={opacityEdit.end}
                  />
                  <button onClick={() => dispatch({ type: "set_underlay", underlay: null }, { actor: "human" })}>
                    Remove underlay
                  </button>
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
          <div className="panel catalog-grid">
            {catalog.entries.map((c) => {
              const thumb = thumbnailFor(c);
              return (
                <button
                  key={c.kind}
                  className="catalog-card"
                  onClick={() => pageActions.setDrawMode("place", c.kind)}
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
                maxLength={TEXT.note}
              />
              <button
                onClick={() => {
                  if (!noteText.trim()) return;
                  // signed by the actor: a note the human writes here is the human's
                  const r = dispatch({ type: "leave_note", text: noteText.trim() }, { actor: "human" });
                  if (r.ok) setNoteText("");
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
