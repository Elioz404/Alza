/**
 * The agent's status in the top bar: whether this browser gives an agent the plan's tools, and
 * how many of its requests are waiting for you. With requests waiting it opens the first one
 * on the plan; otherwise it opens the panel, where Activity shows what the agent did.
 *
 * "Agent tools on" is what the page can know: a WebMCP runtime took the tools. Whether an agent
 * is using them right now, the page cannot tell, so it does not claim it.
 */

import "./approvals.css";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import { Tip } from "../primitives";
import { requestReview } from "./review";

export function AgentStatus() {
  const live = useAppStore((s) => s.webmcpStatus === "live");
  const approvals = useAppStore((s) => s.approvals);
  const shell = useShell();
  const drawer = useBreakpoint("drawer");
  const waiting = approvals.length;
  const text = live ? "Agent tools on" : "Agent tools off";
  const count = `${waiting} ${waiting === 1 ? "request" : "requests"}`;
  const tip = live
    ? "This browser gives your agent the plan’s tools. Anything destructive it asks for waits for you."
    : "This browser has no agent runtime. You can run every tool by hand under Developer tools, in Activity.";

  const open = () => {
    if (waiting === 0) {
      shell.openPanel();
      return;
    }
    // the first request's card on the plan takes focus; the queue in Activity lists the rest
    // (the drawer would cover the plan on narrow screens, so it closes there)
    if (drawer) shell.setPanelOpen(false);
    else shell.setActivityOpen(true);
    requestReview(approvals[0].id);
  };

  return (
    <Tip content={tip}>
      <button
        type="button"
        className={`presence${live ? " presence--live" : ""}${waiting > 0 ? " presence--waiting" : ""}`}
        aria-label={waiting > 0 ? `${text}, ${count} waiting for you` : text}
        onClick={open}
      >
        <span className="presence__dot" aria-hidden="true" />
        <span className="presence__text" aria-hidden="true">
          {text}
        </span>
        {waiting > 0 ? (
          <span className="presence__count" aria-hidden="true">
            <span className="num">{waiting}</span>
            <span className="presence__unit"> {waiting === 1 ? "request" : "requests"}</span>
          </span>
        ) : null}
      </button>
    </Tip>
  );
}
