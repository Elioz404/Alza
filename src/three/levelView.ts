/**
 * Which storeys the 3D view shows: every level from the ground up to the one the View panel
 * names — "active" (the level being worked on, the default, so the storey on the plan is the one
 * on top in the model and the cutaway slices it), "all", or a level by id. A view setting of
 * this view alone, kept for the page's life (the 3D view mounts and unmounts, the choice stays),
 * never part of the plan or its undo history.
 *
 * Walking shows every level and slices none: the walker climbs the stairs into the storeys
 * above, and sees up the stairwell as one would.
 */

import type { PlanModel } from "../model/types";
import { levelAbove, levelsOf, type LevelInfo } from "../model/levels";
import { LEVELS_VIEW } from "./config";

/** What the "Levels shown" control holds: up to the active level, every level, or up to a level by id. */
export type LevelsShown = "active" | "all" | (string & {});

let shown: LevelsShown = LEVELS_VIEW.defaultShown;
const listeners = new Set<() => void>();

export const levelsShown = (): LevelsShown => shown;

export function setLevelsShown(next: LevelsShown): void {
  if (next === shown) return;
  shown = next;
  for (const fn of listeners) fn();
}

/** Hear every change of the setting (useSyncExternalStore's shape). Returns the unsubscribe. */
export function onLevelsShown(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The levels the view shows, ground first: up to `upTo` (a level that is gone counts as the
 * active one), or all of them while `walking`.
 */
export function shownLevels(model: Pick<PlanModel, "levels">, activeId: string, upTo: LevelsShown, walking = false): readonly LevelInfo[] {
  const levels = levelsOf(model);
  if (walking || upTo === "all") return levels;
  const id = upTo === "active" || !levels.some((l) => l.level.id === upTo) ? activeId : upTo;
  const top = levels.findIndex((l) => l.level.id === id);
  return top < 0 ? levels : levels.slice(0, top + 1);
}

/**
 * Whether a storey in `shown` stands over level `levelId`: its floor then covers that level's
 * rooms from above, so nothing of them (a room's name at the top of its walls) shows through it.
 */
export function coveredByShown(model: Pick<PlanModel, "levels">, shown: ReadonlySet<string>, levelId: string): boolean {
  const above = levelAbove(model, levelId);
  return above !== undefined && shown.has(above.level.id);
}
