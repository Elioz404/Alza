/**
 * Short notices at the edge of the page, on Astryx's toast (a polite live region, swipe and
 * Escape to dismiss). Use them for what the canvas cannot show by itself: a failure with its
 * reason and the way out, or an undo offer after a change that replaced or removed a lot.
 * Success the canvas already shows needs no notice.
 *
 *   const notify = useNotify();
 *   notify({ body: "Plan cleared", undoable: true });
 *   notify({ body: r.summary, type: "error" });
 *
 * An undo offer stays for MOTION.undoOfferMs and its Undo goes through dispatch as the human,
 * exactly like the Undo button.
 *
 * Asking for a notice needs nothing from Astryx: the toast itself is drawn by the notice host
 * (NoticeHost.tsx), which the shell mounts and which arrives after the first paint
 * (src/ui/deferred.tsx). A notice asked for before the host is here waits for it, as long as it
 * would have stayed on screen.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { MOTION } from "../theme/tokens";

export interface Notice {
  body: ReactNode;
  type?: "info" | "error";
  /** offer an Undo button that undoes the last change */
  undoable?: boolean;
}

type Show = (notice: Notice) => void;

let show: Show | null = null;
/** the notices asked for before the host was here, with when each was asked for */
let waiting: readonly { notice: Notice; at: number }[] = [];
const listeners = new Set<() => void>();
const setWaiting = (next: typeof waiting) => {
  waiting = next;
  for (const listener of listeners) listener();
};

/**
 * The waiting notices still worth showing. A notice is on screen for MOTION.undoOfferMs, so one
 * that waited longer than that would have gone by now: it is dropped, and with it an Undo that
 * would by then undo whatever was changed since, not the change it offered to undo.
 */
const fresh = (now: number) => waiting.filter((w) => now - w.at < MOTION.undoOfferMs);

/** Show a notice now, or as soon as the notice host is here. */
export function notify(notice: Notice): void {
  if (show) show(notice);
  else {
    const now = Date.now();
    setWaiting([...fresh(now), { notice, at: now }]);
  }
}

/** The notice host's side: it shows every notice from now on, and the ones still worth showing that waited for it. */
export function connectNoticeHost(next: Show): () => void {
  show = next;
  const due = fresh(Date.now());
  setWaiting([]);
  for (const { notice } of due) next(notice);
  return () => {
    if (show === next) show = null;
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const waitingCount = () => waiting.length;

/**
 * How many notices wait for the host (0 once it is here): what tells the shell its host is
 * needed, and is missing if its code could not be fetched (AppShell.tsx).
 */
export const useWaitingNotices = (): number => useSyncExternalStore(subscribe, waitingCount, waitingCount);

/** The function that shows a notice (the same one on every render). */
export function useNotify(): (notice: Notice) => void {
  return notify;
}
