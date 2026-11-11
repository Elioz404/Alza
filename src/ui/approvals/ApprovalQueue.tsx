/**
 * "Waiting for you": the pending requests, pinned at the top of Activity. Each one says what it
 * would do, on what, and who asked, in the error colour (every request here removes
 * something); Review brings up its card on the plan and moves focus there.
 *
 * The region carries APPROVALS_REGION_ID, which the agent status in the top bar focuses.
 */

import "./approvals.css";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import { APPROVALS_REGION_ID } from "../shell/ids";
import { Button, DeltaMark } from "../primitives";
import { requestText } from "./describe";
import { requestReview } from "./review";

const NAMED = new Set(["room", "item", "plan", "file"]);

export function ApprovalQueue() {
  const approvals = useAppStore((s) => s.approvals);
  const { setPanelOpen } = useShell();
  const drawer = useBreakpoint("drawer");

  const review = (id: string) => {
    // the card is on the plan, which the drawer covers on narrow screens
    if (drawer) setPanelOpen(false);
    requestReview(id);
  };

  return (
    <section id={APPROVALS_REGION_ID} className="queue" aria-labelledby={`${APPROVALS_REGION_ID}-title`} tabIndex={-1} hidden={approvals.length === 0}>
      <h3 id={`${APPROVALS_REGION_ID}-title`} className="queue__title">
        Waiting for you
        <span className="queue__count num">{approvals.length}</span>
      </h3>
      <ol className="queue__list">
        {approvals.map((a) => {
          const text = requestText(a);
          const t = a.targets[0];
          return (
            <li key={a.id} className="queue__row">
              <DeltaMark tone="destructive" />
              <div className="queue__body">
                <p className="queue__text">
                  {text.short}
                  {t ? (
                    <>
                      {" "}
                      {NAMED.has(t.type) ? <q className="queue__name">{t.label}</q> : <span className="queue__name num">{t.label}</span>}
                    </>
                  ) : null}
                </p>
                <p className="queue__meta">
                  <span className={`actor actor--${a.actor}`}>{a.actor === "agent" ? "Agent" : "You, from Developer tools"}</span>
                  <code className="code">{a.tool}</code>
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => review(a.id)} aria-label={`Review: ${text.short}`}>
                Review
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
