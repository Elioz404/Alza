/**
 * The human-in-the-loop gate.
 *
 * The WebMCP explainer lists per-call user confirmation as an open question. Alza's answer:
 * a tool the agent calls with `destructiveHint` does not run — it becomes a request on the
 * page, and the human is the one who lets it through. The agent's execute() stays pending
 * until then, so the answer it gets back is the truth about what happened.
 *
 * Everything shown is what the page found in the model, never what the caller wrote: the
 * sentence is built from entity types and ids, each entity is listed with its own name, and the
 * side effects are counted by the page. An entity's name (a room label, say) is still text
 * someone typed, so it is shown apart from the sentence, quoted, and never as the action.
 */

import { pageActions } from "../model/store";
import { useAppStore } from "./useAppStore";

export function ApprovalBar() {
  const approvals = useAppStore((s) => s.approvals);
  if (approvals.length === 0) return null;

  return (
    <div className="approval-bar">
      {approvals.map((a) => (
        <div key={a.id} className="approval">
          <span className="approval-badge">{a.actor === "agent" ? "AGENT WANTS TO" : "TOOL RUNNER WANTS TO"}</span>
          <span className="approval-text">
            {a.request}
            <span className="approval-tool">{a.tool}</span>
            <span className="approval-targets">
              {a.targets.map((t) => (
                <span key={`${t.type}:${t.id}`} className="approval-target">
                  <span className="approval-target-type">{t.type}</span> <code>{t.id}</code>
                  {t.label && <span className="approval-target-label">“{t.label}”</span>}
                </span>
              ))}
            </span>
            {a.effects.map((e) => (
              <span key={e} className="approval-effect">
                {e}
              </span>
            ))}
          </span>
          <div className="approval-actions">
            <button className="reject" onClick={() => pageActions.resolveApproval(a.id, false)}>
              Reject
            </button>
            <button className="approve" onClick={() => pageActions.resolveApproval(a.id, true)}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
