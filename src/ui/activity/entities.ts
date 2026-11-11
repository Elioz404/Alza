/**
 * The plan's entities as the feed and the approval card name them, and the way back from a
 * feed line to the things it talks about.
 *
 * A feed line is written by the domain with ids in it ("Wall wall_e updated."). Shown as is,
 * the human reads ids; so the line is split into segments here and every id that still names
 * something in the plan becomes that thing's name, which selects it when clicked: "Wall 5
 * updated." An id that names nothing any more (a removed wall) stays, set as code.
 */

import type { PlanModel, TargetType } from "../../model/types";
import { catalogOf, kindName } from "../../model/catalog";
import { openingName, stairName, wallName, type EntityRef as NamedEntityRef } from "../inspector/entities";
import { stairGeometryIn } from "../../model/levels";

/** Something on the plan a line can point at: an entity, or one of its levels. */
export type EntityRef = Pick<NamedEntityRef, "id"> & { type: NamedEntityRef["type"] | "level" };

export type Segment =
  | { kind: "text"; text: string }
  /** an entity that is on the plan now: its name, linked */
  | { kind: "entity"; ref: EntityRef; text: string }
  /** an identifier with nothing to link to: a removed entity, a tool's name */
  | { kind: "code"; text: string };

/** The words for each type, singular, as a sentence uses them. */
export const TYPE_WORD: Record<TargetType, string> = {
  wall: "wall",
  door: "door",
  window: "window",
  room: "room",
  item: "item",
  stair: "stair",
  level: "level",
  plan: "plan",
  file: "file",
};

/**
 * An entity's name, as the human knows it and as Properties and Issues call it: "Wall 3",
 * "Door 1", a room's label, a piece's catalogue name. A partner's product is named by its kind
 * id, as every sentence the page writes names it (model/catalog.ts, kindName).
 */
export function entityName(model: PlanModel, ref: EntityRef): string | null {
  switch (ref.type) {
    case "wall": {
      const w = model.walls.find((x) => x.id === ref.id);
      return w ? wallName(model, w) : null;
    }
    case "door":
    case "window": {
      const o = model.openings.find((x) => x.id === ref.id);
      return o ? openingName(model, o) : null;
    }
    case "room":
      return model.rooms.find((x) => x.id === ref.id)?.label ?? null;
    case "item": {
      const it = model.items.find((x) => x.id === ref.id);
      if (!it) return null;
      const def = catalogOf(model).get(it.kind);
      return def ? kindName(def) : it.kind;
    }
    case "stair": {
      const st = model.stairs.find((x) => x.id === ref.id);
      return st ? stairName(model, st) : null;
    }
    case "level":
      return model.levels.find((x) => x.id === ref.id)?.name ?? null;
  }
}

/** Every id on the plan, with what it is. Built once per plan object. */
const indexes = new WeakMap<PlanModel, Map<string, EntityRef>>();
function indexOf(model: PlanModel): Map<string, EntityRef> {
  const cached = indexes.get(model);
  if (cached) return cached;
  const map = new Map<string, EntityRef>();
  for (const w of model.walls) map.set(w.id, { type: "wall", id: w.id });
  for (const o of model.openings) map.set(o.id, { type: o.kind, id: o.id });
  for (const r of model.rooms) map.set(r.id, { type: "room", id: r.id });
  for (const it of model.items) map.set(it.id, { type: "item", id: it.id });
  for (const st of model.stairs) map.set(st.id, { type: "stair", id: st.id });
  for (const l of model.levels) map.set(l.id, { type: "level", id: l.id });
  indexes.set(model, map);
  return map;
}

/**
 * What a line can name: a room by its label in quotes ('Room "Bedroom" updated.'), an entity
 * by its type word and id ("Wall wall_e", "on wall wall_e", "Item sofa2"), or a bare
 * identifier in snake_case (wall_e, item_mwa30iob_b, extend_selected_wall).
 */
const TOKEN =
  /\b(?:Room|room) "([^"]+)"|\b(Wall|wall|Door|door|Window|window|Item|item|Room|room|Stair|stair|Level|level) ([\w:.-]*\w)|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** Split a feed line into text, linked entity names and code. */
export function segmentsOf(summary: string, model: PlanModel): Segment[] {
  const index = indexOf(model);
  const out: Segment[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev?.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
  };
  for (const m of summary.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    const [whole, label, typeWord, typedId, bareId] = m;
    if (label !== undefined) {
      // a room named by its label: linked when exactly one room carries it
      const rooms = model.rooms.filter((r) => r.label === label);
      if (rooms.length !== 1) continue;
      pushText(summary.slice(last, start));
      out.push({ kind: "entity", ref: { type: "room", id: rooms[0].id }, text: label });
      last = start + whole.length;
      continue;
    }
    const id = typedId ?? bareId;
    const ref = index.get(id);
    // "Wall added": a type word before an ordinary word is just text
    if (!ref && !SNAKE.test(id)) continue;
    pushText(summary.slice(last, start));
    if (ref) {
      const name = entityName(model, ref) ?? id;
      const typed = typeWord !== undefined && typeWord.toLowerCase() === TYPE_WORD[ref.type];
      if (typeWord !== undefined && !typed) pushText(`${typeWord} `);
      // The type word folds into the name: "Room room_bed" reads "Bedroom", "Item item_3" reads
      // "Sofa", "Wall wall_e updated." reads "Wall 5 updated.", "on wall wall_e" "on Wall 5".
      out.push({ kind: "entity", ref, text: name });
    } else {
      if (typeWord !== undefined) pushText(`${typeWord} `);
      out.push({ kind: "code", text: id });
    }
    last = start + whole.length;
  }
  pushText(summary.slice(last));
  return out;
}

/** A point on the plan, in metres. */
export interface PlanPoint {
  x: number;
  y: number;
}

/** Where an entity sits on the plan: its centre. */
export function centreOf(model: PlanModel, ref: EntityRef): PlanPoint | null {
  switch (ref.type) {
    case "wall": {
      const w = model.walls.find((x) => x.id === ref.id);
      return w ? { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2 } : null;
    }
    case "door":
    case "window": {
      const o = model.openings.find((x) => x.id === ref.id);
      const w = o && model.walls.find((x) => x.id === o.wallId);
      return o && w ? { x: w.ax + (w.bx - w.ax) * o.t, y: w.ay + (w.by - w.ay) * o.t } : null;
    }
    case "room": {
      const r = model.rooms.find((x) => x.id === ref.id);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
    }
    case "item": {
      const it = model.items.find((x) => x.id === ref.id);
      return it ? { x: it.x, y: it.y } : null;
    }
    case "stair": {
      const st = model.stairs.find((x) => x.id === ref.id);
      const g = st ? stairGeometryIn(model, st) : null;
      return g ? { x: (g.box.minX + g.box.maxX) / 2, y: (g.box.minY + g.box.maxY) / 2 } : null;
    }
    case "level":
      return null;
  }
}

/** "… placed at (2.00, 3.50)." and "… moved to (2.00, 3.50).": the coordinates a line names. */
const AT_POINT = /\b(?:at|to) \((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)/;

/**
 * Where on the plan a feed line happened: the first entity it names that is still there, or
 * the point it names. Null when it names neither (a note, a rename).
 */
export function placeOf(summary: string, model: PlanModel): PlanPoint | null {
  for (const s of segmentsOf(summary, model)) {
    if (s.kind === "entity") return centreOf(model, s.ref);
  }
  const at = AT_POINT.exec(summary);
  return at ? { x: Number(at[1]), y: Number(at[2]) } : null;
}
