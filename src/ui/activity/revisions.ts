/**
 * What each line of the activity feed is, read off the line itself, and the revision numbers
 * the feed shares with the drawing.
 *
 * The feed (the store's `activity`) is a list of `{ source, tool, summary, ok }`. The numbers
 * come from the provenance ledger (model/provenance.ts), which numbers every line that changed
 * the plan, in order, and which the editor uses for the revision marks it draws: "Δ4" in the
 * list and Δ4 on the plan are one change. A line keeps its number when older lines go, and a
 * filter never renumbers.
 */

import { useMemo } from "react";
import { useStore } from "zustand";
import type { ActivityEntry, PendingApproval } from "../../model/types";
import { provenance } from "../../model/provenance";
import { TOOLS } from "../../mcp/tools";

/**
 * The lines the store writes around an approval (model/store.ts: requestApproval and
 * resolveApproval). The feed tells a request and a decision from an ordinary change by them.
 */
export const REQUEST_PREFIX = "Waiting for your approval: ";
export const APPROVED_PREFIX = "Approved: ";
export const REJECTED_PREFIX = "Rejected: ";

/** Tools that only read the plan: they never change it. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name));

/** Tools that move the view rather than the plan (point_at shows the person something). */
const VIEW_TOOLS: ReadonlySet<string> = new Set(["build_3d", "set_camera", "set_3d_style", "set_doors", "point_at"]);

export type EntryKind =
  /** a change to the plan (numbered when it touched walls, openings, rooms or pieces) */
  | "revision"
  /** a destructive call parked for approval */
  | "request"
  /** the human's answer to a request */
  | "decision"
  | "note"
  | "undo"
  /** a read, a view change or a setting: nothing on the plan moved */
  | "read"
  /** the page itself: the plan it opened with, the agent runtime */
  | "system"
  /** refused or failed: nothing was changed */
  | "failure";

export function kindOf(entry: ActivityEntry): EntryKind {
  if (entry.summary.startsWith(APPROVED_PREFIX) || entry.summary.startsWith(REJECTED_PREFIX)) return "decision";
  if (!entry.ok) return "failure";
  if (entry.source === "system") return "system";
  if (entry.summary.startsWith(REQUEST_PREFIX)) return "request";
  if (entry.tool === "leave_note") return "note";
  if (entry.tool === "undo") return "undo";
  if (entry.tool === "approval_policy" || READ_ONLY_TOOLS.has(entry.tool) || VIEW_TOOLS.has(entry.tool)) return "read";
  return "revision";
}

/** Every numbered line's revision number, by line id, as the drawing numbers it. */
export function useRevisionNumbers(): ReadonlyMap<string, number> {
  const revisions = useStore(provenance, (s) => s.revisions);
  return useMemo(() => new Map(revisions.filter((r) => r.n > 0).map((r) => [r.entryId, r.n])), [revisions]);
}

/** The feed line that announced `approval`: the request line written when it was parked. */
export function requestLineOf(
  approval: PendingApproval,
  activity: readonly ActivityEntry[],
  taken: ReadonlySet<string> = new Set(),
): ActivityEntry | undefined {
  const summary = `${REQUEST_PREFIX}${approval.request}`;
  // the line is written right after the request is parked, so it is the first match from then on
  return activity.find(
    (e) => e.at >= approval.at && !taken.has(e.id) && e.summary === summary && e.tool === approval.tool && e.source === approval.actor,
  );
}

/** The request lines still waiting for an answer, each with its approval, by line id. */
export function pendingByLine(
  approvals: readonly PendingApproval[],
  activity: readonly ActivityEntry[],
): ReadonlyMap<string, PendingApproval> {
  const map = new Map<string, PendingApproval>();
  const taken = new Set<string>();
  for (const a of approvals) {
    const line = requestLineOf(a, activity, taken);
    if (line) taken.add(line.id);
    if (line) map.set(line.id, a);
  }
  return map;
}
