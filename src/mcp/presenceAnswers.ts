/**
 * What the shared session's tools answer (presenceTools.ts): what the person is doing right now
 * and who else is on the plan (get_presence), and the point an agent shows the person (point_at).
 * Fetched the first time an agent asks, so only the tools' descriptions are in the first load.
 */

import { activeLevel, store, type ActionResult } from "../model/store";
import { presence, type PlanBounds, type PlanPoint } from "../model/presence";
import { addPoint } from "../model/presenceShows";
import { entityInfo, type EntityInfo } from "../model/places";
import { lookupItem, lookupOpening, lookupRoom, lookupStair, lookupWall, type Candidate, type Lookup } from "../model/resolve";
import { sceneProbe } from "../model/sceneBus";
import { clip } from "../model/schemas";
import { NOTE_EXCERPT_CHARS } from "../model/limits";
import type { PlanModel } from "../model/types";

/** Millimetres are as fine as the plan is drawn. */
const MM = 1000;
const mm = (v: number): number => Math.round(v * MM) / MM;
const point = (p: PlanPoint | null) => (p ? { x: mm(p.x), y: mm(p.y) } : null);
const bounds = (b: PlanBounds | null) => (b ? { minX: mm(b.minX), minY: mm(b.minY), maxX: mm(b.maxX), maxY: mm(b.maxY) } : null);
const named = (model: PlanModel, id: string | null): EntityInfo | null => (id ? entityInfo(model, id) : null);
const describe = (e: EntityInfo): string => `${e.type} ${e.id}${e.label ? ` ("${clip(e.label, NOTE_EXCERPT_CHARS)}")` : ""}`;

/** What the person at this tab, and the other tabs on the plan, are doing right now. */
export function presenceForAgent(): ActionResult {
  const state = store.getState();
  const { model, editor } = state;
  const p = presence.getState();
  const level = activeLevel(state);
  const selected = editor.selectedWallId ?? editor.selectedItemId ?? editor.selectedRoomId ?? editor.selectedStairId;
  const inPlan = editor.view === "2d";
  const look = !inPlan && p.sharing ? (sceneProbe.camera?.() ?? null) : null;
  const person = {
    level: { id: level.id, name: level.name },
    view: inPlan ? "plan" : "3d",
    camera: inPlan ? null : editor.camera,
    selection: named(model, selected),
    dragging: p.editing.length > 0,
    editing: [...p.editing],
    sharing: p.sharing,
    pointer: p.sharing && inPlan ? point(p.person.pointer) : null,
    hover: p.sharing && inPlan ? named(model, p.person.hoverId) : null,
    viewport: p.sharing && inPlan ? bounds(p.person.viewport) : null,
    look: look && { eye: { x: mm(look.eye.x), y: mm(look.eye.y), z: mm(look.eye.z) }, target: { x: mm(look.target.x), y: mm(look.target.y), z: mm(look.target.z) } },
  };
  const tabs = p.peers.map((peer) => ({
    name: `Tab ${peer.ordinal}`,
    view: peer.view === "2d" ? "plan" : "3d",
    levelId: peer.levelId,
    selection: named(model, peer.selection),
    // the other tabs are this person's too: what they keep to themselves here, they keep there
    pointer: p.sharing ? point(peer.pointer) : null,
    editing: [...peer.editing],
    agent: peer.agent,
  }));
  const where = inPlan ? "the plan" : `the 3D view (${editor.camera})`;
  const parts = [
    `The person is on ${level.name}, in ${where}`,
    person.selection ? `, with ${describe(person.selection)} selected` : ", with nothing selected",
    person.dragging ? `, editing ${person.editing.join(", ")} right now (a change to it waits until they let go)` : "",
    !p.sharing ? "; they are not sharing their pointer or view" : person.hover ? `; the pointer is over ${describe(person.hover)}` : "",
    ".",
    tabs.length > 0 ? ` ${tabs.length} other tab(s) of this browser are on the plan.` : "",
  ];
  return { ok: true, summary: parts.join(""), person, tabs };
}

type Placed = { id: string };

/** The one wall, opening, room, piece or stair `target` (an id or a name) names on the plan. */
function findEntity(model: PlanModel, target: string): Lookup<Placed> {
  const tries: Lookup<Placed>[] = [lookupWall, lookupOpening, lookupRoom, lookupItem, lookupStair].map((lookup) => lookup(model, target));
  const found = tries.flatMap((t) => (t.ok ? [t.entity] : []));
  if (found.length === 1) return { ok: true, entity: found[0] };
  if (found.length > 1) {
    const candidates: Candidate[] = found.map((e) => ({ id: e.id }));
    return { ok: false, summary: `${JSON.stringify(clip(target, NOTE_EXCERPT_CHARS))} names ${found.length} things on the plan; pass one of their ids.`, candidates };
  }
  // nothing answers: the most telling refusal is an ambiguous one (it names candidates)
  const ambiguous = tries.find((t): t is Extract<Lookup<Placed>, { ok: false }> => !t.ok && t.candidates.length > 0);
  return ambiguous ?? { ok: false, summary: `Nothing on the plan answers to ${JSON.stringify(clip(target, NOTE_EXCERPT_CHARS))}.`, candidates: [] };
}

/** Point the person at `target` with the agent's `message`. */
export function pointAt(input: { target: string; message: string }): ActionResult {
  const { model } = store.getState();
  const found = findEntity(model, input.target);
  if (!found.ok) return { ok: false, summary: found.summary, ...(found.candidates.length > 0 ? { candidates: found.candidates } : {}) };
  const info = entityInfo(model, found.entity.id);
  // said to the person (the indicator's polite live region), not only drawn: the ring goes in a
  // moment, and the feed keeps the message as this line's summary
  const name = info ? (info.label ?? `the ${info.type}`) : found.entity.id;
  addPoint(found.entity.id, input.message, model, `The agent points at ${name}: ${input.message}`);
  return { ok: true, summary: `Pointed the person at ${info ? describe(info) : found.entity.id}: "${input.message}"`, id: found.entity.id };
}
