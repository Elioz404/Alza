/**
 * Presence: who is on the plan right now, and where. The person at this tab (their pointer on
 * the plan, what is under it, the part of the plan their screen shows, what their hand is
 * editing), the agent calling this tab's tools (the tool it is running, the entities it is
 * touching, what it touched last), the points it asked the page to show, and the other tabs of
 * this browser on the same plan (src/session/).
 *
 * All of it is ephemeral: a store of its own, never in the plan, never saved, never in the undo
 * history. It is fed by the one change pipeline — dispatch() and the tool runner write the
 * agent's part (model/commands.ts, mcp/registry.ts), a gesture writes what the hand holds — so a
 * tool author does nothing for the agent to be seen.
 *
 * What the person shares of their pointer and view is theirs to switch off (`sharing`, kept per
 * browser); what their hand is editing is always known, because the agent must not edit it.
 */

import { createStore } from "zustand/vanilla";
import { SESSION, type ParticipantKind } from "./limits";
import type { PlanModel } from "./types";

/** A point on the plan, metres. */
export interface PlanPoint {
  x: number;
  y: number;
}

/** The part of the plan a screen shows, metres. */
export interface PlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What the agent is doing, as the page sees it from its calls. */
export interface AgentPresence {
  /**
   * "working": a call is running; "waiting": its last change was held back because the person
   * is editing what it would touch (it is told to call again); "idle": nothing is running.
   */
  state: "idle" | "working" | "waiting";
  /** the tool it is running (or ran last, while its marker lingers) */
  tool: string | null;
  /** the entities its call is touching; empty once its marker has gone */
  focus: readonly string[];
  /** the plan as it was before its change: where to find what the call removed */
  seenIn: PlanModel | null;
  /** what it changed last, newest first */
  lastEdited: readonly string[];
  /** when the state last changed */
  at: number;
}

/** A thing the agent asked the page to show the person (point_at). */
export interface PointMark {
  id: string;
  entityId: string;
  message: string;
  /** the plan it was pointed at in */
  seenIn: PlanModel;
  until: number;
}

/** What one participant is doing, as another tab shares it (src/session/). */
export interface PeerPresence {
  /** the tab's id in the session */
  id: string;
  kind: ParticipantKind;
  /** its place in the order the tabs joined, from 1: what it is called ("Tab 2") and its colour */
  ordinal: number;
  view: "2d" | "3d";
  levelId: string | null;
  selection: string | null;
  /** null when that person does not share their pointer */
  pointer: PlanPoint | null;
  editing: readonly string[];
  /** that tab's agent, while it works */
  agent: { state: AgentPresence["state"]; tool: string | null; focus: readonly string[] } | null;
  /** when it was last heard from */
  seenAt: number;
}

export interface PresenceState {
  /** whether the person shares their pointer and view with the agent and the other tabs */
  sharing: boolean;
  /** the person at this tab: null members while their pointer is off the plan */
  person: { pointer: PlanPoint | null; hoverId: string | null; viewport: PlanBounds | null };
  /** the entities the person's hand is editing right now (a drag, a run of nudges, typing a field) */
  editing: readonly string[];
  agent: AgentPresence;
  points: readonly PointMark[];
  /** the shared session: off until it starts, joining while it looks for the other tabs */
  session: { state: "off" | "joining" | "live"; ordinal: number };
  peers: readonly PeerPresence[];
  /** the last join or leave, said once by the presence indicator */
  announcement: string;
}

/** Where the sharing choice is kept, per browser (set from the indicator, through presenceShows.ts). */
export const SHARING_KEY = "alza.presence.sharing";

function readSharing(): boolean {
  try {
    return globalThis.localStorage?.getItem(SHARING_KEY) !== "off";
  } catch {
    return true;
  }
}

const IDLE_AGENT: AgentPresence = { state: "idle", tool: null, focus: [], seenIn: null, lastEdited: [], at: 0 };

export const presence = createStore<PresenceState>(() => ({
  sharing: readSharing(),
  person: { pointer: null, hoverId: null, viewport: null },
  editing: [],
  agent: IDLE_AGENT,
  points: [],
  session: { state: "off", ordinal: 1 },
  peers: [],
  announcement: "",
}));

// The choice is the browser's, not the tab's: switched in one tab, it holds in every other one
// at once (a storage event reaches the others), so a pointer kept private in one is in all.
globalThis.addEventListener?.("storage", (e: StorageEvent) => {
  if (e.key !== SHARING_KEY && e.key !== null) return;
  const sharing = readSharing();
  if (sharing !== presence.getState().sharing) presence.setState({ sharing });
});

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------- the person

export function setPointer(pointer: PlanPoint | null): void {
  const { person } = presence.getState();
  if (pointer === person.pointer || (pointer && person.pointer && pointer.x === person.pointer.x && pointer.y === person.pointer.y)) return;
  presence.setState({ person: { ...person, pointer } });
}

export function setHover(hoverId: string | null): void {
  const { person } = presence.getState();
  if (person.hoverId !== hoverId) presence.setState({ person: { ...person, hoverId } });
}

export function setViewport(viewport: PlanBounds | null): void {
  const { person } = presence.getState();
  presence.setState({ person: { ...person, viewport } });
}

/** What each open gesture of the hand holds, by gesture. */
const held = new Map<symbol, readonly string[]>();

const publishEditing = () => {
  const editing = [...new Set([...held.values()].flat())];
  if (!same(editing, presence.getState().editing)) presence.setState({ editing });
}

/** A gesture of the hand now edits `ids` (model/commands.ts, beginGesture). */
export function holdEditing(gesture: symbol, ids: readonly string[]): void {
  const before = held.get(gesture) ?? [];
  const next = [...new Set([...before, ...ids])];
  if (same(next, before)) return;
  held.set(gesture, next);
  publishEditing();
}

/** The hand let go. */
export function releaseEditing(gesture: symbol): void {
  if (held.delete(gesture)) publishEditing();
}

/**
 * Of `touched` (the entities a change would touch, or "all" of them), those a person is
 * editing right now: here, or in another tab of the session.
 */
export function heldByPerson(touched: readonly string[] | "all"): string[] {
  const { editing, peers } = presence.getState();
  const editingNow = [...new Set([...editing, ...peers.flatMap((p) => p.editing)])];
  return touched === "all" ? editingNow : touched.filter((id) => editingNow.includes(id));
}

// ---------------------------------------------------------------------------- the agent

let lingering: ReturnType<typeof setTimeout> | undefined;

const setAgent = (patch: Partial<AgentPresence>) => {
  clearTimeout(lingering);
  presence.setState((s) => ({ agent: { ...s.agent, ...patch, at: Date.now() } }));
};

/** The agent started a call; `focus` is what its resolve step found in `seenIn`, when it has one. */
export function agentBegan(tool: string, focus: readonly string[] = [], seenIn: PlanModel | null = null): void {
  setAgent({ state: "working", tool, ...(focus.length > 0 ? { focus, seenIn } : {}) });
}

/** The agent's change (`tool`, or the command it dispatched) changed `ids`, in the plan `seenIn` was before it. */
export function agentTouched(tool: string, ids: readonly string[], seenIn: PlanModel): void {
  if (ids.length === 0) return;
  const lastEdited = [...new Set([...ids, ...presence.getState().agent.lastEdited])].slice(0, SESSION.lastEdited);
  setAgent({ state: "working", tool, focus: ids, seenIn, lastEdited });
}

/**
 * The agent's change was held back: the person is editing `ids`. It is seen waiting on them for
 * as long as the person holds them, not only while its call runs (below).
 */
export function agentWaiting(ids: readonly string[], seenIn: PlanModel): void {
  setAgent({ state: "waiting", focus: ids, seenIn });
}

/**
 * The call is done: its marker stays a moment on what it touched, then goes. A call that was
 * held back leaves the agent waiting on what the person holds until they let go.
 */
export function agentEnded(): void {
  if (presence.getState().agent.state === "waiting") return;
  setAgent({ state: "idle" });
  lingering = setTimeout(() => presence.setState((s) => ({ agent: { ...s.agent, focus: [], seenIn: null } })), SESSION.agentLingerMs);
}

// Once nobody holds what the agent waits on (the hand here let go, another tab's did or it left),
// it no longer waits; it changed none of it, so its marker has nothing to stay on.
presence.subscribe((s, prev) => {
  if (s.agent.state !== "waiting" || (s.editing === prev.editing && s.peers === prev.peers)) return;
  if (heldByPerson(s.agent.focus).length === 0) setAgent({ state: "idle", focus: [], seenIn: null });
});
