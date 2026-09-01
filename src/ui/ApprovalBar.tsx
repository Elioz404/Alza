/**
 * The human-in-the-loop gate.
 *
 * The WebMCP explainer lists per-call user confirmation as an open question. Alza's answer:
 * a tool the agent calls with `destructiveHint` does not run — it becomes a request on the
 * page, and the human is the one who lets it through. The agent's execute() stays pending
 * until then, so the answer it gets back is the truth about what happened.
 */

import { useAppStore, actions } from "../model/store";

export function ApprovalBar() {
  const approvals = useAppStore((s) => s.approvals);
  if (approvals.length === 0) return null;

  return (
    <div className="approval-bar">
      {approvals.map((a) => (
        <div key={a.id} className="approval">
          <span className="approval-badge">AGENT WANTS TO</span>
          <span className="approval-text">
            {a.request}
            <span className="approval-tool">{a.tool}</span>
          </span>
          <div className="approval-actions">
            <button className="reject" onClick={() => actions.resolveApproval(a.id, false)}>
              Reject
            </button>
            <button className="approve" onClick={() => actions.resolveApproval(a.id, true)}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
