/**
 * One tab's copy of the shared plan, and the rule that keeps every copy the same: last writer
 * wins, per entity, by Lamport clock.
 *
 * The plan is held as registers, one per entity (`walls:wall_n`, `notes:note_…`), one per
 * collection's order (`order:walls`) and one per setting of the plan (`plan:name`, `plan:id`).
 * Each register keeps the last value written to it — the entity, or null once it is removed —
 * and the version that wrote it: the writer's Lamport clock and its tab id. A tab's own change
 * becomes writes stamped with its next clock (local); another tab's writes replace a register
 * only when their version is newer (receive). The plan is then read back from the registers
 * (materialize), so two tabs that have heard the same writes, in any order, hold the same plan.
 *
 * What the rule settles: two tabs moving the same piece at once — the later clock wins
 * everywhere (the tab id breaks a tie); a piece removed in one tab while the other moves it — the
 * later of the two wins. Whatever the merge leaves pointing at nothing (an opening whose wall was
 * removed, a piece on a removed level) is left out as the plan is read back, the same in every
 * tab, as removing the wall or the level would have taken it. So is whatever goes past what a
 * plan holds (two tabs leaving the last note there is room for at once): the newest are kept.
 * A merged plan is therefore one every tab takes, never one refused in some and kept in others.
 *
 * A clock another tab sends raises this one only so far (SESSION.maxClock), so no write heard,
 * however high its clock, can push this tab's next one past what a message may carry.
 *
 * The underlay stays each tab's own: its image is in the tab's memory, not in the plan.
 */

import type { Note, PlanModel } from "../model/types";
import { MAX_NOTES, PLAN_FORMAT_VERSION, SESSION } from "../model/limits";

/** What a replica holds and a tab shows: the plan and its notes. */
export interface PlanState {
  model: PlanModel;
  notes: Note[];
}

/** One write: a register's new value (null: removed) and the version that wrote it. */
export interface Write {
  k: string;
  /** the writer's Lamport clock */
  c: number;
  /** the writer's tab id: breaks a tie between equal clocks */
  t: string;
  v: unknown;
}

/** The plan's collections, in the order the plan lists them. */
export const COLLECTIONS = ["levels", "walls", "openings", "rooms", "items", "stairs", "columns", "kinds", "notes"] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** The settings of the plan as a whole that the session keeps. */
export const PLAN_KEYS = ["name", "id"] as const;

type Entity = { id?: string; kind?: string };

/** An entity's key within its collection: its id, a kind's own name. */
const idOf = (collection: Collection, e: Entity): string => String(collection === "kinds" ? e.kind : e.id);

const listOf = (s: PlanState, collection: Collection): readonly Entity[] =>
  collection === "notes" ? s.notes : (s.model[collection] as readonly Entity[]);

export const entityKey = (collection: Collection, id: string): string => `${collection}:${id}`;
export const orderKey = (collection: Collection): string => `order:${collection}`;
export const planKey = (name: (typeof PLAN_KEYS)[number]): string => `plan:${name}`;

/** Whether write `a` is newer than `b`. */
export const newer = (a: Pick<Write, "c" | "t">, b: Pick<Write, "c" | "t">): boolean => a.c > b.c || (a.c === b.c && a.t > b.t);

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The writes that take `a` to `b`, unstamped: changed entities by object (the plan is immutable). */
export function diff(a: PlanState, b: PlanState): { k: string; v: unknown }[] {
  const out: { k: string; v: unknown }[] = [];
  for (const name of PLAN_KEYS) if (a.model[name] !== b.model[name]) out.push({ k: planKey(name), v: b.model[name] });
  for (const collection of COLLECTIONS) {
    const before = listOf(a, collection);
    const after = listOf(b, collection);
    if (before === after) continue;
    const old = new Map(before.map((e) => [idOf(collection, e), e]));
    const ids = after.map((e) => idOf(collection, e));
    for (const [i, e] of after.entries()) if (old.get(ids[i]) !== e) out.push({ k: entityKey(collection, ids[i]), v: e });
    const kept = new Set(ids);
    for (const id of old.keys()) if (!kept.has(id)) out.push({ k: entityKey(collection, id), v: null });
    if (!sameIds([...old.keys()], ids)) out.push({ k: orderKey(collection), v: ids });
  }
  return out;
}

/** Every register of `s`, at version (`c`, `t`). */
export function registersOf(s: PlanState, c: number, t: string): Write[] {
  return diff(EMPTY, s).filter((w) => w.v !== null).map((w) => ({ ...w, c, t }));
}

const EMPTY: PlanState = {
  model: { version: PLAN_FORMAT_VERSION, id: "", name: "", levels: [], walls: [], openings: [], rooms: [], items: [], stairs: [], columns: [], kinds: [], underlay: null },
  notes: [],
};

/**
 * The plan the registers hold, with `current`'s underlay. Each collection in its order register's
 * order, then whatever that order does not list (two tabs that added at once), by id. Null when
 * the registers hold no level, which no plan may be without.
 */
export function materialize(registers: ReadonlyMap<string, Write>, current: PlanState): PlanState | null {
  const lists = new Map<Collection, Entity[]>(COLLECTIONS.map((c) => [c, []]));
  const notes: Write[] = [];
  for (const [k, w] of registers) {
    if (w.v === null) continue;
    const at = k.indexOf(":");
    const collection = k.slice(0, at) as Collection;
    if (collection === "notes") notes.push(w);
    else lists.get(collection)?.push(w.v as Entity);
  }
  // past what a plan holds, the newest notes are kept (by version, then key: the same everywhere)
  if (notes.length > MAX_NOTES) notes.sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : a.k < b.k ? -1 : 1));
  lists.set("notes", notes.slice(0, MAX_NOTES).map((w) => w.v as Entity));
  for (const collection of COLLECTIONS) {
    const order = registers.get(orderKey(collection))?.v;
    const rank = new Map((Array.isArray(order) ? (order as string[]) : []).map((id, i) => [id, i]));
    lists.get(collection)!.sort((a, b) => {
      const ia = rank.get(idOf(collection, a));
      const ib = rank.get(idOf(collection, b));
      if (ia !== undefined && ib !== undefined) return ia - ib;
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return idOf(collection, a) < idOf(collection, b) ? -1 : 1;
    });
  }
  const list = <T,>(c: Collection) => lists.get(c) as unknown as T[];
  const levels = list<PlanModel["levels"][number]>("levels");
  if (levels.length === 0) return null;
  // what the merge leaves pointing at nothing is left out, the same in every tab
  const onLevel = new Set(levels.map((l) => l.id));
  const walls = list<PlanModel["walls"][number]>("walls").filter((w) => onLevel.has(w.levelId));
  const wallIds = new Set(walls.map((w) => w.id));
  const plan = (name: (typeof PLAN_KEYS)[number]): string => {
    const v = registers.get(planKey(name))?.v;
    return typeof v === "string" ? v : current.model[name];
  };
  return {
    model: {
      version: PLAN_FORMAT_VERSION,
      id: plan("id"),
      name: plan("name"),
      levels,
      walls,
      openings: list<PlanModel["openings"][number]>("openings").filter((o) => wallIds.has(o.wallId)),
      rooms: list<PlanModel["rooms"][number]>("rooms").filter((r) => onLevel.has(r.levelId)),
      items: list<PlanModel["items"][number]>("items").filter((i) => onLevel.has(i.levelId)),
      stairs: list<PlanModel["stairs"][number]>("stairs").filter((s) => onLevel.has(s.levelId)),
      columns: list<PlanModel["columns"][number]>("columns").filter((c) => onLevel.has(c.levelId)),
      kinds: list<PlanModel["kinds"][number]>("kinds"),
      underlay: current.model.underlay,
    },
    notes: list<Note>("notes"),
  };
}

/**
 * `s` with the writes `changes` made to another plan made to it too, read back as a merged plan
 * is (materialize): what an undo step of this tab becomes once another tab's change lands, so
 * undoing it later puts back only what this tab changed. `s` itself when nothing changed, or
 * when the writes would leave it without a level.
 */
export function rebase(s: PlanState, changes: readonly { k: string; v: unknown }[]): PlanState {
  if (changes.length === 0) return s;
  const registers = new Map(registersOf(s, 0, "").map((w) => [w.k, w]));
  for (const w of changes) registers.set(w.k, { k: w.k, v: w.v, c: 0, t: "" });
  return materialize(registers, s) ?? s;
}

/** A merge that won: the plan it makes, and commit() to keep it once the plan has taken it. */
export interface Merge {
  state: PlanState;
  commit(): void;
}

/** A joining tab's take on the others' plan: the merge, and its own changes restamped on top of it. */
export interface Adoption extends Merge {
  /** the tab's own changes made before it joined, stamped after everything in the plan it took up */
  own: Write[];
}

/** The clock `clock` reaches on hearing `writes`: their newest, but never past SESSION.maxClock. */
const heard = (clock: number, writes: readonly Write[]): number =>
  Math.max(clock, Math.min(SESSION.maxClock, writes.reduce((max, w) => Math.max(max, w.c), 0)));

export class Replica {
  private clock = 0;
  private registers: Map<string, Write>;
  /** the plan the registers describe, as the tab holds it */
  private base: PlanState;

  constructor(
    readonly tab: string,
    state: PlanState,
  ) {
    this.base = state;
    this.registers = new Map(registersOf(state, 0, tab).map((w) => [w.k, w]));
  }

  /** The tab's own change, from what the replica last saw to `next`: its writes, stamped with the next clock. */
  local(next: PlanState): Write[] {
    const changes = diff(this.base, next);
    this.base = next;
    if (changes.length === 0) return [];
    const c = ++this.clock;
    const writes = changes.map((w) => ({ ...w, c, t: this.tab }));
    for (const w of writes) this.registers.set(w.k, w);
    return writes;
  }

  /**
   * Another tab's writes, merged with what this tab holds (`current`, which local() has seen):
   * the plan they make, or null when none of them is newer than what is here — or when the plan
   * they would make has no level. Nothing is kept until the merge is committed.
   */
  receive(writes: readonly Write[], current: PlanState): Merge | null {
    this.clock = heard(this.clock, writes);
    const registers = new Map(this.registers);
    let won = false;
    for (const w of writes) {
      const held = registers.get(w.k);
      if (held && !newer(w, held)) continue;
      registers.set(w.k, w);
      won = true;
    }
    if (!won) return null;
    const state = materialize(registers, current);
    if (!state) return null;
    return {
      state,
      commit: () => {
        this.registers = registers;
      },
    };
  }

  /**
   * Take up another tab's registers whole — the plan a joining tab adopts — with `own`, the
   * changes this tab made before it joined (its writes not yet heard by anyone), written over
   * them with a clock past every one of theirs: what the person or the agent did while the tab
   * was joining is kept, not lost under the plan it takes up. Null when the registers hold no plan.
   */
  adopt(writes: readonly Write[], current: PlanState, own: readonly Write[] = []): Adoption | null {
    const registers = new Map(writes.map((w) => [w.k, w]));
    const clock = heard(this.clock, writes);
    const c = own.length > 0 ? clock + 1 : clock;
    const restamped = own.map((w) => ({ ...w, c, t: this.tab }));
    for (const w of restamped) registers.set(w.k, w);
    const state = materialize(registers, current);
    if (!state) return null;
    return {
      state,
      own: restamped,
      commit: () => {
        this.registers = registers;
        this.clock = c;
      },
    };
  }

  /** The plan as the tab now holds it, once a merge has been applied: what the next local change is measured from. */
  settle(state: PlanState): void {
    this.base = state;
  }

  /** Every register, for a tab that joins. */
  snapshot(): Write[] {
    return [...this.registers.values()];
  }

  /** The clock this tab has reached (for the tests). */
  get time(): number {
    return this.clock;
  }
}
