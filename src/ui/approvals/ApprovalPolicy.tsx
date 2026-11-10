/**
 * The approval policy in words, under the queue in Activity: what your agent may do without
 * asking, and a Change link that opens the switch right there. The same switch is in
 * Properties; both set the store's requireApproval, and both take their words from
 * src/ui/inspector/policy.ts, which reads them off the tools.
 */

import "./approvals.css";
import { pageActions } from "../../model/store";
import { DESTRUCTIVE_TOOL_NAMES } from "../../mcp/tools";
import { useAppStore } from "../useAppStore";
import { IconAgent, IconWarning, Switch } from "../primitives";
import { Popover } from "../primitives/astryx";
import { approvalPolicySentence, POLICY_SWITCH_LABEL, policySentence } from "../inspector/policy";

/** The policy switch with what it covers, in a popover. */
function PolicyForm() {
  const ask = useAppStore((s) => s.requireApproval);
  return (
    <div className="policy-form">
      <Switch label={POLICY_SWITCH_LABEL} value={ask} onChange={(on) => pageActions.setRequireApproval(on)} />
      <p className="policy-form__help">{approvalPolicySentence(ask)}</p>
      <p className="policy-form__tools">
        Tools that ask:{" "}
        {DESTRUCTIVE_TOOL_NAMES.map((name, i) => (
          <span key={name}>
            {i > 0 ? ", " : null}
            <code className="code">{name}</code>
          </span>
        ))}
      </p>
    </div>
  );
}

/** The link that opens the policy switch: "Change" in Activity, "Settings" on the request card. */
export function PolicyLink({ children = "Change" }: { children?: string }) {
  return (
    <Popover content={<PolicyForm />} label="Approval policy" placement="above" alignment="end" width="var(--size-activity)" padding={4}>
      {(trigger) => (
        <button {...trigger} type="button" className="text-link">
          {children}
        </button>
      )}
    </Popover>
  );
}

export function ApprovalPolicy() {
  const ask = useAppStore((s) => s.requireApproval);
  const Icon = ask ? IconAgent : IconWarning;
  return (
    <p className={`policy${ask ? "" : " policy--off"}`}>
      <Icon size="xs" className="policy__icon" />
      <span className="policy__text">{policySentence(ask)}</span>
      <PolicyLink />
    </p>
  );
}
