/**
 * Which pending request the card on the plan shows, shared by everything that can point at one:
 * the "Waiting for you" queue's Review, the activity row's Review, the agent status in the top
 * bar. Asking to review a request also asks the card to take focus.
 *
 * Page chrome only, kept outside the store: it is not part of the plan and never reaches the
 * agent.
 */

import { useSyncExternalStore } from "react";

export interface ReviewState {
  /** the request the card shows; the oldest pending one when null or no longer pending */
  currentId: string | null;
  /** bumped on every review request, so the card can tell a new ask from a re-render */
  focusToken: number;
}

let state: ReviewState = { currentId: null, focusToken: 0 };
const listeners = new Set<() => void>();
const set = (next: ReviewState) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => state;

/** Show this request on the card and move focus to it. */
export const requestReview = (id: string | null): void => set({ currentId: id, focusToken: state.focusToken + 1 });

/** Show this request on the card, leaving focus where it is (paging with the card's arrows). */
export const showRequest = (id: string | null): void => set({ ...state, currentId: id });

export const useReview = (): ReviewState => useSyncExternalStore(subscribe, get, get);
