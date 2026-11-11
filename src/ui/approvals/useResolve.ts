/**
 * Answer a pending request, and say how it ended.
 *
 * Approving lets the parked call run; it lands a moment later, attributed to whoever asked. The
 * page waits for that line in the feed and then offers Undo for the change (none for a download,
 * which changes nothing in the plan), or, if the plan had
 * moved and the call refused to run, says so with its reason). Keeping changes nothing, which the
 * plan already shows, so it gets no notice.
 */

import { useCallback } from "react";
import { pageActions, store } from "../../model/store";
import type { ActivityEntry, PendingApproval } from "../../model/types";
import { MOTION } from "../theme/tokens";
import { useNotify } from "../shell/useNotify";
import { APPROVED_PREFIX, REJECTED_PREFIX, REQUEST_PREFIX } from "../activity/revisions";

const NOUN: Record<PendingApproval["targets"][number]["type"], string> = {
  wall: "Wall",
  door: "Door",
  window: "Window",
  room: "Room",
  item: "Item",
  stair: "Stair",
  level: "Level",
  plan: "Plan",
  file: "File",
};

/** "Room “Bathroom” removed", "Plan cleared": what an approved request did, from the page's own account. */
export function doneText(a: PendingApproval): string {
  const t = a.targets[0];
  if (!t || t.type === "plan") return "Plan cleared";
  if (t.type === "file") return `File “${t.label}” downloaded`;
  const named = t.type === "room" || t.type === "item" || t.type === "level";
  return `${NOUN[t.type]}${named ? ` “${t.label}”` : ""} removed`;
}

/** The feed lines written after `afterId` (all of them when it has scrolled out). */
function linesAfter(activity: readonly ActivityEntry[], afterId: string | undefined): readonly ActivityEntry[] {
  const i = afterId ? activity.findIndex((e) => e.id === afterId) : -1;
  return i >= 0 ? activity.slice(i + 1) : activity;
}

const isAnswerLine = (e: ActivityEntry) =>
  e.summary.startsWith(APPROVED_PREFIX) || e.summary.startsWith(REJECTED_PREFIX) || e.summary.startsWith(REQUEST_PREFIX);

export function useResolveApproval(): (a: PendingApproval, granted: boolean) => void {
  const notify = useNotify();
  return useCallback(
    (a: PendingApproval, granted: boolean) => {
      const before = store.getState().activity.at(-1)?.id;
      const r = pageActions.resolveApproval(a.id, granted);
      if (!r.ok) {
        notify({ body: `${r.summary} It may have been withdrawn by whoever asked.`, type: "error" });
        return;
      }
      if (!granted) return;

      // the call runs once the approval reaches it; its own line in the feed is the outcome
      let stop = () => {};
      const look = () => {
        const outcome = linesAfter(store.getState().activity, before).find(
          (e) => e.tool === a.tool && e.source === a.actor && !isAnswerLine(e),
        );
        if (!outcome) return false;
        stop();
        // a downloaded file is the person's now: there is nothing in the plan to undo
        if (outcome.ok) notify({ body: doneText(a), undoable: a.targets[0]?.type !== "file" });
        else notify({ body: outcome.summary, type: "error" });
        return true;
      };
      if (look()) return;
      const unsubscribe = store.subscribe(() => void look());
      const timer = setTimeout(() => stop(), MOTION.undoOfferMs);
      stop = () => {
        unsubscribe();
        clearTimeout(timer);
      };
    },
    [notify],
  );
}
