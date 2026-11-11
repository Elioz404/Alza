/**
 * What a pending request says to the human, and where on the plan it would act.
 *
 * Everything here is built by the page from the request's types and ids and from the plan as
 * it is now, never from what the caller typed (see PendingApproval in model/types.ts). An
 * entity's own name (a room's label, the plan's name, a custom piece's name) is still text
 * someone typed: it is never part of the sentence or of a button, only shown in the target
 * list, quoted.
 */

import type { ApprovalTarget, PendingApproval, PlanModel } from "../../model/types";
import { segLen, segPoint } from "../../model/geometry";
import { openingSpan } from "../../model/issues";
import { catalogOf } from "../../model/catalog";
import { levelSlice, stairGeometryIn } from "../../model/levels";

/** The word for a target's type, as a button and a sentence use it. */
const NOUN: Record<ApprovalTarget["type"], string> = {
  wall: "wall",
  door: "door",
  window: "window",
  room: "room",
  item: "item",
  stair: "stair",
  level: "level",
  plan: "plan",
};

/** Types whose label is a name someone typed (shown quoted), rather than a size the page measured. */
const NAMED: ReadonlySet<ApprovalTarget["type"]> = new Set(["room", "item", "level", "plan"]);

const capitalise = (s: string): string => s[0].toUpperCase() + s.slice(1);

export interface RequestText {
  /** "Your agent wants to remove a room" */
  title: string;
  /** "Remove room": the confirm button */
  confirm: string;
  /** "Keep room": the button that declines */
  keep: string;
  /** "remove": the confirm key hint's verb */
  verb: string;
  /** the one-line version for lists: "Remove a room" */
  short: string;
}

export function requestText(a: PendingApproval): RequestText {
  const who = a.actor === "agent" ? "Your agent wants" : "Developer tools want";
  const type = a.targets[0]?.type ?? "plan";
  if (type === "plan") {
    return { title: `${who} to clear the whole plan`, confirm: "Clear plan", keep: "Keep plan", verb: "clear", short: "Clear the whole plan" };
  }
  const noun = NOUN[type];
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  return {
    title: `${who} to remove ${article} ${noun}`,
    confirm: `Remove ${noun}`,
    keep: `Keep ${noun}`,
    verb: "remove",
    short: `Remove ${article} ${noun}`,
  };
}

export interface TargetFact {
  /** "Room" */
  term: string;
  /** the entity's name or the page's description of it */
  value: string;
  /** a name someone typed: shown in quotes */
  quoted: boolean;
  /** the id, as data */
  id?: string;
}

/** The target list: each target, then what the page measures about it now (area, length). */
export function targetFacts(a: PendingApproval, model: PlanModel): TargetFact[] {
  const facts: TargetFact[] = [];
  for (const t of a.targets) {
    facts.push({ term: capitalise(NOUN[t.type]), value: t.label, quoted: NAMED.has(t.type), id: t.type === "plan" ? undefined : t.id });
    if (t.type === "room") {
      const r = model.rooms.find((x) => x.id === t.id);
      if (r) facts.push({ term: "Area", value: `${(r.w * r.h).toFixed(2)} m²`, quoted: false });
    }
  }
  return facts;
}

/** The consequence, in sentences: what else goes with it, and that Undo brings it back. */
export function consequenceOf(a: PendingApproval): string {
  // the page's own effects list says what else goes (a wall's openings, a plan's contents);
  // a room is only its floor area, which is the one thing people get wrong about it
  const base = a.targets[0]?.type === "room" ? "Only the floor area goes; its walls, doors and windows stay." : "";
  return [base, ...a.effects, "Undo brings it back."].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- where it would act

/** A target's outline on the plan, in metres. */
export type Shape =
  /** a rectangle centred on (cx, cy), turned `rotation` degrees counter-clockwise */
  | { kind: "rect"; cx: number; cy: number; w: number; h: number; rotation: number }
  /** a thick segment: a wall, or the stretch of wall an opening fills */
  | { kind: "segment"; ax: number; ay: number; bx: number; by: number; thickness: number };

/** The shapes a request would act on, as the plan holds them now. */
export function targetShapes(a: PendingApproval, model: PlanModel): Shape[] {
  const shapes: Shape[] = [];
  const catalog = catalogOf(model);
  for (const t of a.targets) {
    switch (t.type) {
      case "wall": {
        const w = model.walls.find((x) => x.id === t.id);
        if (w) shapes.push({ kind: "segment", ax: w.ax, ay: w.ay, bx: w.bx, by: w.by, thickness: w.thickness });
        break;
      }
      case "door":
      case "window": {
        const o = model.openings.find((x) => x.id === t.id);
        const w = o && model.walls.find((x) => x.id === o.wallId);
        if (o && w) {
          const [t0, t1] = openingSpan(w, o);
          const a0 = segPoint({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, t0);
          const a1 = segPoint({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, t1);
          shapes.push({ kind: "segment", ax: a0.x, ay: a0.y, bx: a1.x, by: a1.y, thickness: w.thickness });
        }
        break;
      }
      case "room": {
        const r = model.rooms.find((x) => x.id === t.id);
        if (r) shapes.push({ kind: "rect", cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rotation: 0 });
        break;
      }
      case "item": {
        const it = model.items.find((x) => x.id === t.id);
        const def = it && catalog.get(it.kind);
        if (it && def) shapes.push({ kind: "rect", cx: it.x, cy: it.y, w: def.w, h: def.d, rotation: it.rotation });
        break;
      }
      case "stair": {
        const st = model.stairs.find((x) => x.id === t.id);
        const g = st && stairGeometryIn(model, st);
        // each flight and the landing: the editor's rotate(-deg) is the rectangle's rot, in degrees, negated
        for (const r of g ? g.footprint : []) shapes.push({ kind: "rect", cx: r.cx, cy: r.cy, w: 2 * r.hw, h: 2 * r.hd, rotation: (-r.rot * 180) / Math.PI });
        break;
      }
      case "level": {
        const extent = extentOf(levelSlice(model, t.id));
        if (extent && model.levels.some((l) => l.id === t.id)) shapes.push(extent);
        break;
      }
      case "plan": {
        const extent = extentOf(model);
        if (extent) shapes.push(extent);
        break;
      }
    }
  }
  return shapes;
}

/** The rectangle around a plan's walls, rooms and items, or null when it has none. */
function extentOf(model: PlanModel): Shape | null {
  const xs = [...model.walls.flatMap((w) => [w.ax, w.bx]), ...model.rooms.flatMap((r) => [r.x, r.x + r.w]), ...model.items.map((i) => i.x)];
  const ys = [...model.walls.flatMap((w) => [w.ay, w.by]), ...model.rooms.flatMap((r) => [r.y, r.y + r.h]), ...model.items.map((i) => i.y)];
  if (xs.length === 0) return null;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { kind: "rect", cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rotation: 0 };
}

/** A shape's corners, in metres (a segment as the four corners of its thickness). */
export function cornersOf(s: Shape): { x: number; y: number }[] {
  if (s.kind === "rect") {
    // the editor turns items with rotate(-rotation) on a y-down sheet
    const a = (-s.rotation * Math.PI) / 180;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    return [
      [-s.w / 2, -s.h / 2],
      [s.w / 2, -s.h / 2],
      [s.w / 2, s.h / 2],
      [-s.w / 2, s.h / 2],
    ].map(([x, y]) => ({ x: s.cx + x * c - y * n, y: s.cy + x * n + y * c }));
  }
  const len = Math.max(segLen(s.ax, s.ay, s.bx, s.by), Number.EPSILON);
  const [nx, ny] = [(-(s.by - s.ay) / len) * (s.thickness / 2), ((s.bx - s.ax) / len) * (s.thickness / 2)];
  return [
    { x: s.ax + nx, y: s.ay + ny },
    { x: s.bx + nx, y: s.by + ny },
    { x: s.bx - nx, y: s.by - ny },
    { x: s.ax - nx, y: s.ay - ny },
  ];
}
