/**
 * The shared session in words and colours: what each participant is called, what the agent's
 * label says it is doing ("Agent · moving Sofa"), and the colour each one is drawn in. The
 * indicator, the plan's cursors and the 3D view's markers all read it, so they agree.
 */

import type { PlanModel } from "../../model/types";
import type { AgentPresence, PeerPresence } from "../../model/presence";
import { PRESENCE_COLOUR, tabColour } from "../theme/tokens";
import { entityName, refOf } from "../activity/entities";
import { markerOf, type Place } from "../../model/places";

/** Tools whose verb reads better said another way than with -ing. */
const SAID: Readonly<Record<string, string>> = Object.freeze({ get: "reading", list: "reading", measure: "measuring", set: "setting", build: "building", point: "pointing at" });

/** "move_item" → "moving", "add_door" → "adding", "get_model" → "reading". */
export function verbOf(tool: string): string {
  const head = tool.split("_")[0] ?? tool;
  // its own entries only: a name like "constructor_x" is a verb to make, not Object's
  if (Object.hasOwn(SAID, head)) return SAID[head];
  if (head.endsWith("e") && !head.endsWith("ee")) return `${head.slice(0, -1)}ing`;
  return `${head}ing`;
}

/** What the person knows an entity by, or its id when it is no longer on the plan. */
export function nameOf(model: PlanModel, id: string): string {
  const ref = refOf(model, id);
  return (ref && entityName(model, ref)) ?? id;
}

/** "Agent · moving Sofa", "Agent · waiting for you", "Agent · reading the plan". */
export function agentLabel(agent: Pick<AgentPresence, "state" | "tool" | "focus">, model: PlanModel): string {
  if (agent.state === "waiting") return "Agent · waiting for you";
  const what = agent.focus.length > 0 ? nameOf(model, agent.focus[0]) : null;
  if (!agent.tool) return what ? `Agent · ${what}` : "Agent";
  const verb = verbOf(agent.tool);
  return what ? `Agent · ${verb} ${what}` : `Agent · ${verb} the plan`;
}

export const tabName = (peer: Pick<PeerPresence, "ordinal">): string => `Tab ${peer.ordinal}`;

/**
 * What a list of the other tabs shows of them, as one string: who they are, where, what they hold
 * and what their agent does — not their pointer, nor when they were last heard from. A view that
 * selects this redraws when one of those changes, never because a pointer moved.
 */
export const peersSeen = (peers: readonly PeerPresence[]): string =>
  JSON.stringify(peers.map((p) => [p.id, p.ordinal, p.kind, p.view, p.levelId, p.selection, p.editing, p.agent]));

export const PERSON_COLOUR = PRESENCE_COLOUR.person;
export const AGENT_COLOUR = PRESENCE_COLOUR.agent;
export const peerColour = (peer: Pick<PeerPresence, "ordinal">): string => tabColour(peer.ordinal);

/** Whether the agent's marker shows: while it works, and a moment after, on what it touched. */
export const agentShows = (agent: AgentPresence): boolean => agent.focus.length > 0;

/** The first of `ids` that stands somewhere, and where its marker goes: on the plan now, or in the plan it was seen in. */
export function firstPlace(model: PlanModel, ids: readonly string[], seenIn: PlanModel | null): { id: string; at: Place } | null {
  for (const id of ids) {
    const at = markerOf(model, id) ?? (seenIn ? markerOf(seenIn, id) : null);
    if (at) return { id, at };
  }
  return null;
}
