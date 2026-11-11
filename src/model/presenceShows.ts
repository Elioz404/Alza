/**
 * What changes the presence store only on request, kept apart from presence.ts so it is fetched
 * with what asks for it rather than with the first paint: the person's choice to share their
 * pointer and view (the presence indicator), and the points an agent shows them (point_at).
 */

import { presence, SHARING_KEY, type PointMark } from "./presence";
import { SESSION } from "./limits";
import type { PlanModel } from "./types";

/** Turn sharing the pointer and the view on or off; the choice is kept for this browser. */
export function setSharing(on: boolean): void {
  presence.setState({ sharing: on });
  try {
    globalThis.localStorage?.setItem(SHARING_KEY, on ? "on" : "off");
  } catch {
    // storage refused (a private window): the choice holds for this page
  }
}

let pointCount = 0;

/**
 * Show the person `entityId` (of the plan `seenIn`) with the agent's message, for
 * SESSION.pointMs, and say it (`said`, through the presence indicator's live region); beyond
 * SESSION.maxPoints at once, the oldest goes.
 */
export function addPoint(entityId: string, message: string, seenIn: PlanModel, said: string): PointMark {
  const mark: PointMark = { id: `point_${++pointCount}`, entityId, message, seenIn, until: Date.now() + SESSION.pointMs };
  presence.setState((s) => ({ points: [...s.points, mark].slice(-SESSION.maxPoints), announcement: said }));
  setTimeout(() => presence.setState((s) => ({ points: s.points.filter((p) => p.id !== mark.id) })), SESSION.pointMs);
  return mark;
}
