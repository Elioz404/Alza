/**
 * Who is on the plan, in the top bar: a dot for each — you, the agent, every other tab of this
 * browser on the same plan — in the colour each is drawn in on the plan. Pressing it shows the
 * list, with what each is doing ("Agent · moving Sofa", "Tab 2 · on First floor, in 3D"), and the
 * switch that shares your pointer and view with the agent and the other tabs (on by default, kept
 * for this browser).
 *
 * A disclosure (WAI-ARIA): the button says whether the list is open and which element it opens;
 * Escape closes it and gives focus back to the button, as a click outside closes it. Its name
 * says who is there and what an agent is doing ("the agent (working)"), and a busy dot is ringed
 * as well as breathing, so the state is there without motion and without looking. Who joins and
 * who leaves, and what the agent points at, is said once, politely (a live region), never each
 * move. Another tab's pointer moving does not redraw it: it shows no pointer.
 */

import "./session.css";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { useAppStore } from "../useAppStore";
import { presence, type PeerPresence } from "../../model/presence";
import { setSharing } from "../../model/presenceShows";
import { Switch } from "../primitives";
import { AGENT_COLOUR, PERSON_COLOUR, agentLabel, nameOf, peerColour, peersSeen, tabName } from "./participants";
import type { PlanModel } from "../../model/types";

interface Participant {
  key: string;
  name: string;
  what: string;
  colour: string;
  busy: boolean;
  /** what it is doing, for the button's name: "working", "waiting for you"; none when idle */
  state: string | null;
}

const stateOf = (agent: { state: "idle" | "working" | "waiting" }): string | null =>
  agent.state === "working" ? "working" : agent.state === "waiting" ? "waiting for you" : null;

function Dot({ colour, busy }: { colour: string; busy?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => ref.current?.style.setProperty("--ss-colour", colour), [colour]);
  return <span ref={ref} className="session__dot" data-busy={busy || undefined} aria-hidden="true" />;
}

const levelName = (model: PlanModel, id: string | null): string | null => (id ? (model.levels.find((l) => l.id === id)?.name ?? null) : null);

function peerWhat(peer: PeerPresence, model: PlanModel): string {
  const where = [levelName(model, peer.levelId) && model.levels.length > 1 ? `on ${levelName(model, peer.levelId)}` : null, peer.view === "2d" ? "in the plan" : "in 3D"].filter(Boolean).join(", ");
  const doing = peer.editing.length > 0 ? `, editing ${nameOf(model, peer.editing[0])}` : peer.selection ? `, ${nameOf(model, peer.selection)} selected` : "";
  return `${where.charAt(0).toUpperCase()}${where.slice(1)}${doing}`;
}

export function PresenceIndicator() {
  const model = useAppStore((s) => s.model);
  const live = useAppStore((s) => s.webmcpStatus === "live");
  const agent = useStore(presence, (s) => s.agent);
  // what the list shows of the other tabs, as one value: their pointers moving changes none of it
  useStore(presence, (s) => peersSeen(s.peers));
  const peers = presence.getState().peers;
  const sharing = useStore(presence, (s) => s.sharing);
  const session = useStore(presence, (s) => s.session);
  const announcement = useStore(presence, (s) => s.announcement);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    root.current?.addEventListener("keydown", onKey);
    const el = root.current;
    return () => {
      document.removeEventListener("pointerdown", onDown);
      el?.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const working = agent.state !== "idle";
  const tab = session.state === "off" ? "" : ` (tab ${session.ordinal})`;
  const people: Participant[] = [
    { key: "you", name: `You${tab}`, what: sharing ? "Sharing your pointer and view" : "Not sharing your pointer or view", colour: PERSON_COLOUR, busy: false, state: null },
    ...(live || agent.tool
      ? [{ key: "agent", name: "Agent", what: working || agent.focus.length > 0 ? agentLabel(agent, model).replace(/^Agent · /, "") : "Ready, nothing running", colour: AGENT_COLOUR, busy: working, state: stateOf(agent) }]
      : []),
    ...peers.flatMap((peer) => [
      { key: peer.id, name: tabName(peer), what: peerWhat(peer, model), colour: peerColour(peer), busy: false, state: null },
      ...(peer.agent
        ? [{ key: `${peer.id}:agent`, name: `Agent in ${tabName(peer)}`, what: agentLabel(peer.agent, model).replace(/^Agent · /, ""), colour: peerColour(peer), busy: peer.agent.state !== "idle", state: stateOf(peer.agent) }]
        : []),
    ]),
  ];
  const names = people
    .map((p) => `${p.key === "you" ? "you" : p.key === "agent" ? "the agent" : p.name}${p.state ? ` (${p.state})` : ""}`)
    .join(", ");

  return (
    <div className="session" ref={root}>
      <button
        ref={button}
        type="button"
        className="session__chip"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`On this plan: ${names}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="session__dots" aria-hidden="true">
          {people.map((p) => (
            <Dot key={p.key} colour={p.colour} busy={p.busy} />
          ))}
        </span>
        <span className="session__count" aria-hidden="true">
          {people.length}
        </span>
      </button>
      <div id={panelId} className="session__panel" hidden={!open} role="group" aria-label="Who is on the plan">
        <p className="session__title">On this plan</p>
        <ul className="session__list">
          {people.map((p) => (
            <li key={p.key} className="session__who">
              <Dot colour={p.colour} busy={p.busy} />
              <span className="session__name">{p.name}</span>
              <span className="session__what">{p.what}</span>
            </li>
          ))}
        </ul>
        <Switch
          label="Share my pointer and view"
          description="The agent and your other tabs see where your pointer is and what part of the plan you are looking at. What you select and edit is always shared, so nobody edits it under your hand."
          value={sharing}
          onChange={setSharing}
          labelSpacing="spread"
        />
        {session.state === "off" ? <p className="session__note">Other tabs cannot join from this browser.</p> : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
