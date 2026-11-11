/**
 * The shared session: the tabs of this browser that have the studio open work on one plan, and
 * each sees where the others are.
 *
 * How a tab joins: it says hello and listens for SESSION.joinWaitMs. A tab that already holds
 * the plan answers with a snapshot of its registers (replica.ts), and the new tab takes that plan
 * up — once, while it joins. What its person or agent changed before then (from the plan the page
 * opened with, `origin`, on) is written over the plan it takes up, not lost under it. If no tab
 * answers, it is the first, and its own plan is the session's. Two tabs opening at once settle it
 * by age: the younger adopts the older's. A snapshot that comes once the tab is live (every tab
 * answers a hello, and the answers come in any order) is merged like any change, last writer
 * wins, never taken up whole: it can only bring in what this tab has not heard yet.
 *
 * How a change travels: every change to the plan, whatever made it — a drag, a tool call, an
 * undo — is a change of the store's plan; the replica turns it into writes stamped with this
 * tab's Lamport clock, sent with what the change was (its tool or command, its summary, the
 * gesture it is a frame of). Another tab merges the writes (last writer wins, per entity) and
 * applies the merged plan through dispatch(), as the "peer" actor, as one feed line — a whole
 * drag as one, as it was there. It records no undo step: Undo in a tab takes back that tab's own
 * changes, and every step it keeps has the other tabs' changes folded in (rebase), so undoing it
 * puts back only what that step changed. Nothing a tab hears is applied unchecked (messages.ts),
 * and nothing it applies is sent back.
 *
 * What a person's hand holds travels ahead of the changes it makes: a drag's first frame tells
 * the others what it edits before the frame's own writes go, so another tab's agent is refused
 * from the first frame on, not told its change was made and then have it overwritten.
 *
 * What a tab shares besides: its person's level, view, selection, what their hand is editing and,
 * unless they switched it off, their pointer; what its agent is doing. It is said when it
 * changes (at most every SESSION.presenceIntervalMs, the last of a burst always) and on every
 * heartbeat; a message that says nothing new is not sent, and one heard that says nothing new
 * only tells this tab the other is still there. A tab not heard from for SESSION.peerTimeoutMs is
 * gone. All of it lands in the presence store (model/presence.ts), which the indicator, the
 * cursors and get_presence read.
 *
 * The transport is BroadcastChannel by default (transport.ts), which is where a network relay
 * would plug in.
 */

import { activeLevelId, store } from "../model/store";
import { beginGesture, dispatch, onApplied, type Gesture } from "../model/commands";
import { presence, type PeerPresence } from "../model/presence";
import { SESSION } from "../model/limits";
import { clip } from "../model/schemas";
import { diff, rebase, Replica, type Merge, type PlanState, type Write } from "./replica";
import { broadcastTransport, type Transport } from "./transport";
import { APP, parseMessage, type ChangeMeta, type PresenceStateMessage, type SessionMessage } from "./messages";

export interface SessionOptions {
  /** how the tabs reach each other; the BroadcastChannel by default */
  transport?: Transport | null;
  /**
   * The plan the page opened with, before anyone changed it (main.tsx): what changed since is
   * this tab's own work, kept when it takes up the others' plan. The plan as it is by default.
   */
  origin?: PlanState;
}

export interface Session {
  readonly tabId: string;
  /** leave the session: say goodbye, stop listening, forget the others */
  stop(): void;
}

/** Bytes in a tab's id. */
const TAB_ID_BYTES = 8;
const newTabId = (): string => [...crypto.getRandomValues(new Uint8Array(TAB_ID_BYTES))].map((b) => b.toString(16).padStart(2, "0")).join("");

const current = (): PlanState => {
  const { model, notes } = store.getState();
  return { model, notes };
};

/** What this tab's person and agent are doing, as the others are told. */
function ownPresence(): PresenceStateMessage {
  const s = store.getState();
  const p = presence.getState();
  const e = s.editor;
  const agent = p.agent.state !== "idle" || p.agent.focus.length > 0 ? { state: p.agent.state, tool: p.agent.tool, focus: p.agent.focus.slice(0, SESSION.maxFocus) } : null;
  return {
    kind: "person",
    view: e.view,
    levelId: activeLevelId(s),
    selection: e.selectedWallId ?? e.selectedItemId ?? e.selectedRoomId ?? e.selectedStairId,
    pointer: p.sharing && e.view === "2d" ? p.person.pointer : null,
    editing: p.editing.slice(0, SESSION.maxFocus),
    agent,
  };
}

export function startSession(options: SessionOptions = {}): Session {
  const tabId = newTabId();
  const transport = options.transport === undefined ? broadcastTransport(SESSION.channel) : options.transport;
  if (!transport) return { tabId, stop: () => undefined };

  const startedAt = Date.now();
  let phase: "joining" | "live" = "joining";
  const replica = new Replica(tabId, options.origin ?? current());
  presence.setState({ session: { state: "joining", ordinal: 1 } });

  const send = (m: Record<string, unknown>) => transport.send({ app: APP, protocol: SESSION.protocol, from: tabId, ...m });

  // ---------------------------------------------------------------- this tab's changes
  let applying = false;
  let scheduled = false;
  let meta: ChangeMeta | null = null;
  const gestureNames = new WeakMap<object, string>();
  let gestureCount = 0;
  const gestureName = (g: object): string => {
    let name = gestureNames.get(g);
    if (!name) gestureNames.set(g, (name = `${tabId}.${++gestureCount}`));
    return name;
  };
  const offApplied = onApplied(({ command, ctx, result, gesture }) => {
    if (ctx.actor === "peer" || !result.ok) return;
    meta = { actor: ctx.actor, as: ctx.as ?? command.type, summary: clip(result.summary, SESSION.maxSummary), gesture: gesture ? gestureName(gesture) : null };
  });
  /** this tab's changes made before it went live, by register: sent (restamped, if it took up a plan) once it is */
  const unsent = new Map<string, Write>();
  let unsentMeta: ChangeMeta | null = null;
  const CHANGE: ChangeMeta = { actor: "human", as: "change", summary: "", gesture: null };
  const flush = () => {
    scheduled = false;
    const writes = replica.local(current());
    const said = meta;
    meta = null;
    if (writes.length === 0) return;
    if (phase === "live") {
      send({ type: "ops", writes, meta: said ?? CHANGE });
      return;
    }
    for (const w of writes) unsent.set(w.k, w);
    unsentMeta = said ? { ...said, gesture: null } : (unsentMeta ?? CHANGE);
  };
  const offStore = store.subscribe((s, prev) => {
    if ((s.model === prev.model && s.notes === prev.notes) || applying) return;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  });

  // ---------------------------------------------------------------- the others' changes
  /** another tab's open gesture, folded into one step here as it was there */
  const remoteGestures = new Map<string, { name: string; gesture: Gesture; timer: ReturnType<typeof setTimeout> }>();
  const endGesture = (from: string) => {
    const open = remoteGestures.get(from);
    if (!open) return;
    clearTimeout(open.timer);
    remoteGestures.delete(from);
    applying = true;
    try {
      open.gesture.end();
    } finally {
      applying = false;
    }
  };
  const gestureFor = (from: string, m: ChangeMeta & { gesture: string }): Gesture => {
    let open = remoteGestures.get(from);
    if (open && open.name !== m.gesture) {
      endGesture(from);
      open = undefined;
    }
    if (open) clearTimeout(open.timer);
    const gesture = open?.gesture ?? beginGesture({ actor: "peer", as: m.as, undoable: false });
    remoteGestures.set(from, { name: m.gesture, gesture, timer: setTimeout(() => endGesture(from), SESSION.gestureIdleMs) });
    return gesture;
  };

  /**
   * Apply a merge another tab's writes made: as that tab's change (one feed line, a gesture's
   * frames folded into one), with this tab's undo steps rebased under it. A merge the plan
   * refuses (none should be: materialize keeps every limit the plan checks) is not kept, and is
   * said in the feed and the console, never dropped without a trace.
   */
  const apply = (merge: Merge, from: string, meta: ChangeMeta) => {
    const { model, notes } = merge.state;
    applying = true;
    try {
      const changes = diff(current(), merge.state);
      const history = store.getState().undoStack.map((step) => {
        const moved = rebase(step, changes);
        return moved === step ? step : { key: step.key, model: moved.model, notes: moved.notes };
      });
      const command = { type: "sync_remote", model, notes, summary: meta.summary || "Changed the plan.", history } as const;
      const ctx = { actor: "peer", as: meta.as, undoable: false } as const;
      const g = meta.gesture;
      if (g === null) endGesture(from);
      const result = g === null ? dispatch(command, ctx) : gestureFor(from, { ...meta, gesture: g }).update(command);
      if (result.ok) merge.commit();
      else console.warn(`[alza] another tab's change could not be applied here: ${result.summary}`);
    } finally {
      applying = false;
      replica.settle(current());
    }
  };

  // ---------------------------------------------------------------- the others
  /** every other tab: when it started, what it last said of itself (and that, as sent), when it was last heard */
  const known = new Map<string, { startedAt: number; peer: PeerPresence | null; seenAt: number; said: string }>();
  const older = (a: { startedAt: number; id: string }, b: { startedAt: number; id: string }) => a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id);
  let lastAnnounced = { text: "", at: 0 };
  const announce = (text: string) => {
    const now = Date.now();
    if (text === lastAnnounced.text && now - lastAnnounced.at < SESSION.announceMs) return;
    lastAnnounced = { text, at: now };
    presence.setState({ announcement: text });
  };
  /** Number every tab by when it started, this one included, and publish the others. */
  const publishPeers = () => {
    const all = [{ id: tabId, startedAt }, ...[...known].map(([id, k]) => ({ id, startedAt: k.startedAt }))].sort((a, b) => (older(a, b) ? -1 : 1));
    const ordinal = new Map(all.map((t, i) => [t.id, i + 1]));
    const peers = [...known].flatMap(([id, k]) => (k.peer ? [{ ...k.peer, ordinal: ordinal.get(id) ?? 0 }] : []));
    const session = { state: phase === "live" ? "live" : "joining", ordinal: ordinal.get(tabId) ?? 1 } as const;
    const was = presence.getState().session;
    presence.setState({ peers, ...(was.state === session.state && was.ordinal === session.ordinal ? {} : { session }) });
  };
  const nameOf = (id: string): string => `Tab ${presence.getState().peers.find((p) => p.id === id)?.ordinal ?? ""}`.trim();
  const forget = (id: string) => {
    if (!known.has(id)) return;
    const name = nameOf(id);
    known.delete(id);
    endGesture(id);
    publishPeers();
    announce(`${name} left the plan.`);
  };

  const shareSnapshot = (to: string) => {
    if (scheduled) flush();
    send({ type: "snapshot", to, startedAt, established: phase === "live", writes: replica.snapshot() });
  };

  /** ops heard while joining: applied once the plan this tab works on is settled */
  const heldBack: Extract<SessionMessage, { type: "ops" }>[] = [];
  const mergeWrites = (writes: readonly Write[], from: string, meta: ChangeMeta) => {
    if (scheduled) flush();
    const merged = replica.receive(writes, current());
    if (merged) apply(merged, from, meta);
  };
  const mergeOps = (m: Extract<SessionMessage, { type: "ops" }>) => mergeWrites(m.writes, m.from, m.meta);

  const goLive = () => {
    clearTimeout(joinTimer);
    if (phase === "live") return;
    if (scheduled) flush();
    phase = "live";
    publishPeers();
    for (const m of heldBack.splice(0)) mergeOps(m);
    sharePresence({ now: true });
    // what this tab changed while it joined, for the others: it is part of the session's plan now
    if (unsent.size > 0) send({ type: "ops", writes: [...unsent.values()], meta: unsentMeta ?? CHANGE });
    unsent.clear();
    unsentMeta = null;
  };

  const onMessage = (data: unknown) => {
    const m = parseMessage(data, tabId);
    if (!m) return;
    switch (m.type) {
      case "hello":
        if (!known.has(m.from)) known.set(m.from, { startedAt: m.startedAt, peer: null, seenAt: Date.now(), said: "" });
        shareSnapshot(m.from);
        sharePresence({ now: true, beat: true });
        return;
      case "snapshot": {
        // once live, a snapshot is one more tab's writes, merged (last writer wins), never taken up
        // whole: it is another tab's answer to this tab's hello, perhaps older than what was heard since
        if (phase === "live") {
          mergeWrites(m.writes, m.from, { actor: "system", as: "sync", summary: "Brought in changes another tab had made.", gesture: null });
          return;
        }
        // a tab still joining takes up the plan of one that holds it, or of an older one also joining,
        // with what it changed itself meanwhile written over it
        const holder = m.established || older({ startedAt: m.startedAt, id: m.from }, { startedAt, id: tabId });
        if (!holder) return;
        if (scheduled) flush();
        const adopted = replica.adopt(m.writes, current(), [...unsent.values()]);
        if (adopted) {
          unsent.clear();
          for (const w of adopted.own) unsent.set(w.k, w);
          apply(adopted, m.from, { actor: "system", as: "join", summary: "Took up the plan the other tabs are working on.", gesture: null });
        }
        goLive();
        return;
      }
      case "ops":
        if (phase === "joining") heldBack.push(m);
        else mergeOps(m);
        return;
      case "presence": {
        const held = known.get(m.from);
        const said = JSON.stringify(m.state);
        // the same again (a heartbeat): only that the tab is still there
        if (held?.peer && held.said === said && held.startedAt === m.startedAt) {
          held.seenAt = Date.now();
          return;
        }
        const s = m.state;
        known.set(m.from, {
          startedAt: m.startedAt,
          seenAt: Date.now(),
          said,
          peer: { id: m.from, kind: s.kind, ordinal: 0, view: s.view, levelId: s.levelId, selection: s.selection, pointer: s.pointer, editing: s.editing, agent: s.agent, seenAt: Date.now() },
        });
        publishPeers();
        if (!held?.peer) announce(`${nameOf(m.from)} joined the plan.`);
        return;
      }
      case "bye":
        forget(m.from);
        return;
    }
  };
  const offTransport = transport.subscribe(onMessage);

  // ---------------------------------------------------------------- what this tab shares
  let lastShared = 0;
  let lastSaid = "";
  let shareTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Tell the others what this tab's person and agent are doing: at once (`now`), or at most every
   * SESSION.presenceIntervalMs, the last of a burst always. Only when it changed, unless it is a
   * heartbeat (`beat`), which says the tab is still there.
   */
  function sharePresence(how: { now?: boolean; beat?: boolean } = {}) {
    if (phase !== "live") return;
    const wait = lastShared + SESSION.presenceIntervalMs - Date.now();
    if (!how.now && wait > 0) {
      shareTimer ??= setTimeout(() => {
        shareTimer = undefined;
        sharePresence();
      }, wait);
      return;
    }
    const state = ownPresence();
    const said = JSON.stringify(state);
    if (said === lastSaid && !how.beat) return;
    clearTimeout(shareTimer);
    shareTimer = undefined;
    lastShared = Date.now();
    lastSaid = said;
    send({ type: "presence", startedAt, state });
  }
  const offPresence = presence.subscribe((s, prev) => {
    // what the hand holds goes at once, ahead of the writes of the frame that took hold of it
    if (s.editing !== prev.editing) sharePresence({ now: true });
    // the pointer and the view are nobody else's business while the person keeps them to themselves
    else if ((s.person !== prev.person && s.sharing) || s.agent !== prev.agent || s.sharing !== prev.sharing) sharePresence();
  });
  const offEditor = store.subscribe((s, prev) => {
    if (s.editor !== prev.editor) sharePresence();
  });
  const heartbeat = setInterval(() => {
    sharePresence({ now: true, beat: true });
    const now = Date.now();
    for (const [id, k] of known) if (k.peer && now - k.seenAt > SESSION.peerTimeoutMs) forget(id);
  }, SESSION.heartbeatMs);

  const onLeave = () => send({ type: "bye" });
  globalThis.addEventListener?.("pagehide", onLeave);

  // what changed between the page opening and the session starting is this tab's own work too
  flush();
  send({ type: "hello", startedAt, established: false });
  const joinTimer = setTimeout(goLive, SESSION.joinWaitMs);

  return {
    tabId,
    stop() {
      onLeave();
      clearTimeout(joinTimer);
      clearTimeout(shareTimer);
      clearInterval(heartbeat);
      for (const id of [...remoteGestures.keys()]) endGesture(id);
      globalThis.removeEventListener?.("pagehide", onLeave);
      offTransport();
      offApplied();
      offStore();
      offPresence();
      offEditor();
      transport.close();
      presence.setState({ peers: [], session: { state: "off", ordinal: 1 } });
    },
  };
}
