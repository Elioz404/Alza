/**
 * Who changed what: the entities each line of the activity feed touched.
 *
 * An activity entry says who acted and what the tool was, but not which walls, rooms or pieces
 * moved. Plans are replaced, never edited in place, and an entity that changes is a new object,
 * so comparing the plan before a change with the plan after it by identity names exactly the
 * entities the change touched (changedEntities, pure).
 *
 * The ledger below pairs each new feed line with the change that produced it. dispatch() records
 * an undo step (the plan before), then changes the plan, then writes the feed line, all in one
 * synchronous run; a gesture records its step on the first frame and its line on end(). So the
 * plan "before" a line is the step most recently recorded since the previous line, or, when no
 * step was recorded (an undo, the opening plan), the plan as the previous line left it.
 *
 * Every line that changed the plan for an actor gets a revision number, 1, 2, 3 … in order:
 * the drawing marks an entity with the number of the agent's change to it, and the activity
 * feed shows the same number on that line.
 */

import { createStore } from "zustand/vanilla";
import { store, type AppState } from "./store";
import type { ActivitySource, PlanModel } from "./types";

/** The plan's entity collections, by the name a revision lists them under. */
export type EntityCollection = "walls" | "openings" | "rooms" | "items";
const COLLECTIONS: readonly EntityCollection[] = ["walls", "openings", "rooms", "items"];

export interface EntityChange {
  /** ids that are new or changed, and still in the plan */
  readonly touched: readonly string[];
  /** ids that were in the plan before and are gone after */
  readonly removed: readonly string[];
}

/** The entities that differ between two plans. Pure: same plans in, same answer out. */
export function changedEntities(before: PlanModel, after: PlanModel): EntityChange {
  if (before === after) return { touched: [], removed: [] };
  const touched: string[] = [];
  const removed: string[] = [];
  for (const key of COLLECTIONS) {
    const was = new Map<string, unknown>(before[key].map((e) => [e.id, e]));
    for (const e of after[key]) {
      if (was.get(e.id) !== e) touched.push(e.id);
      was.delete(e.id);
    }
    removed.push(...was.keys());
  }
  return { touched, removed };
}

/** One feed line that changed the plan. */
export interface Revision {
  /** the ActivityEntry's id */
  readonly entryId: string;
  /** 1, 2, 3 … in the order the changes were made; 0 for the page's own (the opening plan) */
  readonly n: number;
  readonly source: ActivitySource;
  readonly touched: readonly string[];
  readonly removed: readonly string[];
}

/** A mark on the drawing: an entity, and the agent revision that last changed it. */
export interface AgentMark {
  readonly id: string;
  readonly n: number;
}

/**
 * The entities whose latest change came from the agent, among its `recent` latest revisions.
 * A later change by the human (an edit, or an Undo that puts the entity back) clears the mark.
 * Pure over the ledger.
 */
export function agentMarks(revisions: readonly Revision[], recent: number): AgentMark[] {
  const latest = new Map<string, Revision>();
  for (const r of revisions) {
    for (const id of r.touched) latest.set(id, r);
    for (const id of r.removed) latest.delete(id);
  }
  const agentRevisions = revisions.filter((r) => r.source === "agent" && r.touched.length > 0);
  const shown = new Set(agentRevisions.slice(-recent).map((r) => r.entryId));
  const marks: AgentMark[] = [];
  for (const [id, r] of latest) if (shown.has(r.entryId)) marks.push({ id, n: r.n });
  return marks;
}

/** The revision a feed line made, if it changed the plan. */
export const revisionOf = (revisions: readonly Revision[], entryId: string): Revision | undefined =>
  revisions.find((r) => r.entryId === entryId);

// ---------------------------------------------------------------------------
// The ledger, kept in step with the store
// ---------------------------------------------------------------------------

export interface ProvenanceState {
  /** oldest first; as many as the feed keeps */
  revisions: readonly Revision[];
}

export const provenance = createStore<ProvenanceState>(() => ({ revisions: [] }));

let counter = 0;
/** the plan as the previous feed line left it */
let base: PlanModel = store.getState().model;
/** the plan before the newest undo step recorded since the previous feed line */
let stepBefore: PlanModel | null = null;
let lastEntryId: string | null = null;

function onChange(s: AppState, prev: AppState): void {
  if (s.undoStack !== prev.undoStack) {
    const top = s.undoStack.at(-1);
    // a step was recorded (not taken off by an undo): its plan is the one before this change
    if (top && !prev.undoStack.includes(top)) stepBefore = top.model;
  }
  if (s.activity === prev.activity) return;

  const entries = s.activity;
  const at = lastEntryId === null ? -1 : entries.findIndex((e) => e.id === lastEntryId);
  if (entries.length === 0 || (lastEntryId !== null && at < 0)) {
    // the feed was replaced (a fresh page): start over from the plan as it is
    counter = 0;
    base = s.model;
    stepBefore = null;
    lastEntryId = entries.at(-1)?.id ?? null;
    provenance.setState({ revisions: [] });
    return;
  }
  const fresh = entries.slice(at + 1);
  if (fresh.length === 0) return;
  const entry = fresh[fresh.length - 1];
  const change = changedEntities(stepBefore ?? base, s.model);
  base = s.model;
  stepBefore = null;
  lastEntryId = entry.id;
  if (change.touched.length === 0 && change.removed.length === 0) return;

  const n = entry.source === "system" ? 0 : ++counter;
  const revision: Revision = { entryId: entry.id, n, source: entry.source, ...change };
  const kept = new Set(entries.map((e) => e.id));
  provenance.setState((p) => ({ revisions: [...p.revisions.filter((r) => kept.has(r.entryId)), revision] }));
}

store.subscribe(onChange);
