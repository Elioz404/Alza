/**
 * The approval policy in words, read off the tools themselves: which agent actions wait for the
 * person is whatever TOOLS marks destructive, so adding or retiring such a tool can never leave
 * the page describing a different set.
 */

import { TOOLS } from "../../mcp/tools";
import { listOf } from "./entities";

/**
 * The DOM id of the approval switch's section in Properties (nothing selected). A "Change" link
 * elsewhere opens Properties with nothing selected, then scrolls to and focuses inside it.
 */
export const APPROVAL_POLICY_SECTION_ID = "approval-policy";

/** The tools whose calls wait for approval while the policy is on. */
export const GATED_TOOLS = TOOLS.filter((t) => t.annotations?.destructiveHint);

const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** "remove a wall, remove a door or window, …, or erase the whole plan" */
const gatedActions = listOf(
  GATED_TOOLS.map((t) => lowerFirst(t.title ?? t.name)),
  "or",
);

/** The switch's label, the same in Properties and in Activity's policy popover. */
export const POLICY_SWITCH_LABEL = "Ask before destructive agent actions";

/** The policy in a few words, for the line under the queue in Activity. */
export const policySentence = (ask: boolean): string =>
  ask ? "Your agent asks before removing anything." : "Your agent can remove things without asking.";

/** What the switch means, in the state it is in. */
export function approvalPolicySentence(on: boolean): string {
  return on
    ? `Before your agent can ${gatedActions}, it waits for your approval.`
    : `Your agent can ${gatedActions} without asking. Undo still brings each change back.`;
}
