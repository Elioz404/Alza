/**
 * Top right of the plan: the north arrow, and, when the drawing carries marks, the legend that
 * says what they mean with its "Show agent marks" switch. The marks themselves are drawn by the
 * editor (src/editor/Editor.tsx): a numbered revision cloud on what the agent changed lately,
 * matching the activity feed's numbers, and a red hatch on what a pending request would remove.
 */
import "./canvas.css";
import { useStore } from "zustand";
import { Switch } from "../primitives";
import { useAppStore } from "../useAppStore";
import { agentMarks, provenance } from "../../model/provenance";
import { RECENT_AGENT_REVISIONS, setShowAgentMarks, useCanvas } from "../../editor/canvasState";
import { cloudPath, deltaPath } from "../../editor/drawing";

/** Swatch box, in the swatch's own units (the stylesheet sizes it). */
const SW = { w: 28, h: 18 } as const;

function NorthArrow() {
  return (
    <svg className="north" viewBox="0 0 36 50" aria-hidden="true">
      <text className="north__letter" x="18" y="11">
        N
      </text>
      <circle className="north__ring" cx="18" cy="32" r="15" />
      <path className="north__fill" d="M18 20L23 38L18 34Z" />
      <path className="north__ring" d="M18 20L13 38L18 34" />
    </svg>
  );
}

function CloudSwatch() {
  return (
    <svg className="legend__swatch" viewBox={`0 0 ${SW.w} ${SW.h}`} aria-hidden="true">
      <path className="legend__cloud" d={cloudPath(3, 5, 18, 10, 6)} />
      <path className="legend__delta" d={deltaPath(22, 5, 4.5)} />
    </svg>
  );
}

function HatchSwatch() {
  return (
    <svg className="legend__swatch" viewBox={`0 0 ${SW.w} ${SW.h}`} aria-hidden="true">
      <path className="legend__hatch" d="M4 15L11 4M10 15L17 4M16 15L23 4" />
      <rect className="legend__pending" x="3" y="4" width="22" height="11" rx="1.5" />
    </svg>
  );
}

export function Legend() {
  const is2d = useAppStore((s) => s.editor.view === "2d");
  const hasPending = useAppStore((s) => s.approvals.some((a) => a.targets.length > 0));
  const revisions = useStore(provenance, (s) => s.revisions);
  const showAgentMarks = useCanvas((s) => s.showAgentMarks);
  if (!is2d) return null;
  const hasMarks = agentMarks(revisions, RECENT_AGENT_REVISIONS).length > 0;
  return (
    <div className="legend-dock">
      <NorthArrow />
      {hasMarks || hasPending ? (
        <section className="legend" aria-label="Plan marks">
          <ul className="legend__keys">
            {hasMarks ? (
              <li className="legend__key">
                <CloudSwatch />
                Changed by your agent
              </li>
            ) : null}
            {hasPending ? (
              <li className="legend__key">
                <HatchSwatch />
                Waiting for your decision
              </li>
            ) : null}
          </ul>
          {hasMarks ? (
            <div className="legend__switch">
              <Switch label="Show agent marks" value={showAgentMarks} onChange={(on) => setShowAgentMarks(on)} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
