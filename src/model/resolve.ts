/**
 * How a reference names an entity — the one rule every action and tool uses.
 *
 * Agents address things by id or by a human name ("bedroom", "sofa"), so a reference is
 * matched in two steps: an exact id wins outright; otherwise the reference must match exactly
 * ONE entity case-insensitively, on its id or on its own name. Zero matches is "not found" and
 * two or more is "ambiguous", answered with the candidates so the caller can pick an id.
 *
 * There is no substring matching and no "first match": "_" used to resolve to whichever wall
 * id happened to contain an underscore, and "remove the sofa" deleted the first sofa of three.
 */

import type { Column, Item, Level, Opening, PlanModel, Room, Stair, Wall } from "./types";
import { catalogOf, kindName } from "./catalog";
import { MAX_CANDIDATES, VALIDATION_REPORT } from "./limits";
import { clip } from "./schemas";

/** An entity a failed lookup offers instead: its id and, when it has one, its own name. */
export interface Candidate {
  id: string;
  label?: string;
}

export type Lookup<T> = { ok: true; entity: T } | { ok: false; summary: string; candidates: Candidate[] };

const quoted = (ref: string): string => JSON.stringify(clip(ref, VALIDATION_REPORT.maxRefChars));

interface Kind<T> {
  /** singular and plural, for messages */
  noun: string;
  nouns: string;
  /** the names, besides the id, an entity answers to */
  names: (entity: T) => readonly string[];
  /** how a candidate is introduced to the caller */
  label?: (entity: T) => string;
}

function lookup<T extends { id: string }>(entities: readonly T[], ref: string, kind: Kind<T>): Lookup<T> {
  const exact = entities.find((e) => e.id === ref);
  if (exact) return { ok: true, entity: exact };
  const q = ref.trim().toLowerCase();
  const matches = entities.filter((e) => e.id.toLowerCase() === q || kind.names(e).some((n) => n.trim().toLowerCase() === q));
  if (matches.length === 1) return { ok: true, entity: matches[0] };
  const Noun = kind.noun[0].toUpperCase() + kind.noun.slice(1);
  if (matches.length === 0) return { ok: false, summary: `${Noun} ${quoted(ref)} not found.`, candidates: [] };
  const candidates = matches.slice(0, MAX_CANDIDATES).map((e) => (kind.label ? { id: e.id, label: kind.label(e) } : { id: e.id }));
  const more = matches.length - candidates.length;
  return {
    ok: false,
    summary:
      `${quoted(ref)} matches ${matches.length} ${kind.nouns} — nothing was changed. Name one by id: ` +
      `${candidates.map((c) => c.id).join(", ")}${more > 0 ? ` and ${more} more` : ""}.`,
    candidates,
  };
}

const NO_NAMES = (): readonly string[] => [];

export const lookupWall = (model: PlanModel, ref: string): Lookup<Wall> =>
  lookup(model.walls, ref, { noun: "wall", nouns: "walls", names: NO_NAMES });

export const lookupOpening = (model: PlanModel, ref: string): Lookup<Opening> =>
  lookup(model.openings, ref, {
    noun: "opening",
    nouns: "openings",
    names: NO_NAMES,
    label: (o) => `${o.kind} on wall ${o.wallId}`,
  });

export const lookupRoom = (model: PlanModel, ref: string): Lookup<Room> =>
  lookup(model.rooms, ref, { noun: "room", nouns: "rooms", names: (r) => [r.label], label: (r) => r.label });

/** An item answers to its id, its kind ("sofa") and its kind's catalogue label ("Double bed"). */
export function lookupItem(model: PlanModel, ref: string): Lookup<Item> {
  const catalog = catalogOf(model);
  return lookup(model.items, ref, {
    noun: "item",
    nouns: "items",
    names: (i) => {
      const def = catalog.get(i.kind);
      return def ? [i.kind, def.label] : [i.kind];
    },
    label: (i) => {
      const def = catalog.get(i.kind);
      return def ? kindName(def) : i.kind;
    },
  });
}

/** A level answers to its id and its name ("First floor"). */
export const lookupLevel = (model: PlanModel, ref: string): Lookup<Level> =>
  lookup(model.levels, ref, { noun: "level", nouns: "levels", names: (l) => [l.name], label: (l) => l.name });

/** A stair answers to its id. */
export const lookupStair = (model: PlanModel, ref: string): Lookup<Stair> =>
  lookup(model.stairs, ref, { noun: "stair", nouns: "stairs", names: NO_NAMES, label: (s) => `${s.shape} stair on ${s.levelId}` });

/** A column answers to its id. */
export const lookupColumn = (model: PlanModel, ref: string): Lookup<Column> =>
  lookup(model.columns, ref, { noun: "column", nouns: "columns", names: NO_NAMES, label: (c) => `${c.shape} column on ${c.levelId}` });
