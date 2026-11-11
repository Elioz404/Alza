/**
 * The shared session on the plan: a layer of the drawing, over everything else on it.
 *
 *  - The agent: a soft highlight in its colour on what its call is touching, and its marker —
 *    a diamond with a label naming what it does ("Agent · moving Sofa") — on the first of them,
 *    gliding there from where it was (session.css; at once for whoever asks for less motion).
 *  - What the agent pointed at (point_at): a ring round it with the agent's message.
 *  - The other tabs on the plan: each one's pointer, as a cursor in its tab's colour with its
 *    name, while that person shares it and is on the level shown here.
 *
 * It is drawn for the eye only (aria-hidden): the presence indicator in the top bar says the same
 * in words, what the agent points at with its message included (and the feed keeps that). Fetched after the first paint (Editor.tsx), as nothing here is there before an agent
 * or another tab is.
 */

import "../ui/session/session.css";
import { useEffect } from "react";
import { useStore } from "zustand";
import { useAppStore } from "../ui/useAppStore";
import { presence, setViewport, type PeerPresence, type PointMark } from "../model/presence";
import { useCanvas } from "./canvasState";
import { placeOf, type Place } from "../model/places";
import { stairGeometryIn } from "../model/levels";
import { catalogOf } from "../model/catalog";
import type { PlanModel } from "../model/types";
import { PRESENCE_MARK } from "./drawing";
import { AGENT_COLOUR, agentLabel, agentShows, firstPlace, peerColour, tabName } from "../ui/session/participants";
import { usePlaced } from "../ui/session/place";

const P = PRESENCE_MARK;

/** A soft highlight round what `id` names, drawn at `S` pixels per metre. */
function Highlight({ model, id, S, className }: { model: PlanModel; id: string; S: number; className: string }) {
  const w = model.walls.find((x) => x.id === id);
  if (w) return <line className={className} x1={w.ax * S} y1={w.ay * S} x2={w.bx * S} y2={w.by * S} strokeWidth={w.thickness * S + 2 * P.pad} />;
  const r = model.rooms.find((x) => x.id === id);
  if (r) return <rect className={className} x={r.x * S - P.pad} y={r.y * S - P.pad} width={r.w * S + 2 * P.pad} height={r.h * S + 2 * P.pad} />;
  const it = model.items.find((x) => x.id === id);
  const def = it && catalogOf(model).get(it.kind);
  if (it && def) {
    const [hw, hd] = [(def.w * S) / 2 + P.pad, (def.d * S) / 2 + P.pad];
    return <rect className={className} x={-hw} y={-hd} width={2 * hw} height={2 * hd} transform={`translate(${it.x * S} ${it.y * S}) rotate(${-it.rotation})`} />;
  }
  const st = model.stairs.find((x) => x.id === id);
  const g = st && stairGeometryIn(model, st);
  if (g) {
    const { minX, minY, maxX, maxY } = g.box;
    return <rect className={className} x={minX * S - P.pad} y={minY * S - P.pad} width={(maxX - minX) * S + 2 * P.pad} height={(maxY - minY) * S + 2 * P.pad} />;
  }
  const o = model.openings.find((x) => x.id === id);
  const at = o && placeOf(model, id);
  if (o && at) return <circle className={className} cx={at.x * S} cy={at.y * S} r={(o.width * S) / 2 + P.pad} />;
  return null;
}

const shownOn = (where: Place | null, levelId: string): where is Place => where !== null && (where.levelId === undefined || where.levelId === levelId);

function AgentMarker({ x, y, label, entity, waiting }: { x: number; y: number; label: string; entity: string; waiting: boolean }) {
  const ref = usePlaced<SVGGElement>(x, y, AGENT_COLOUR);
  return (
    <g ref={ref} className="ss-agent" data-session="agent" data-entity={entity} data-waiting={waiting || undefined}>
      <path className="ss-agent__marker" d={`M0 ${-P.marker}L${P.marker} 0L0 ${P.marker}L${-P.marker} 0Z`} />
      <text className="ss-label" x={P.labelDx} y={P.labelDy}>
        {label}
      </text>
    </g>
  );
}

/** The ring stands where markerOf says (in a room, in from its corner, clear of its name), the message beside it. */
function PointRing({ mark, x, y, r }: { mark: PointMark; x: number; y: number; r: number }) {
  const ref = usePlaced<SVGGElement>(x, y, AGENT_COLOUR);
  return (
    <g ref={ref} className="ss-point" data-session="point" data-entity={mark.entityId}>
      <circle className="ss-point__ring" r={r} />
      <text className="ss-label" x={r + P.labelDx / 2} y={-r}>
        {mark.message}
      </text>
    </g>
  );
}

function PeerCursor({ peer, x, y }: { peer: PeerPresence; x: number; y: number }) {
  const colour = peerColour(peer);
  const ref = usePlaced<SVGGElement>(x, y, colour);
  return (
    <g ref={ref} className="ss-cursor" data-session="cursor" data-tab={peer.ordinal}>
      <path className="ss-cursor__arrow" d={`M0 0L0 ${P.cursor}L${P.cursor * 0.3} ${P.cursor * 0.72}L${P.cursor * 0.72} ${P.cursor * 0.72}Z`} />
      <text className="ss-label ss-label--tab" x={P.tagDx} y={P.tagDy}>
        {tabName(peer)}
      </text>
    </g>
  );
}

/** The part of the plan the canvas shows, in metres, told to the presence store while the plan is up. */
function useViewportShared(): void {
  const view = useCanvas((s) => s.view);
  const size = useCanvas((s) => s.size);
  useEffect(() => {
    if (size && size.w > 0) setViewport({ minX: view.x, minY: view.y, maxX: view.x + size.w / view.scale, maxY: view.y + size.h / view.scale });
  }, [view, size]);
  useEffect(() => () => setViewport(null), []);
}

export function PlanPresence({ S, levelId }: { S: number; levelId: string }) {
  useViewportShared();
  const model = useAppStore((s) => s.model);
  const agent = useStore(presence, (s) => s.agent);
  const points = useStore(presence, (s) => s.points);
  const peers = useStore(presence, (s) => s.peers);
  const agentAt = agentShows(agent) ? firstPlace(model, agent.focus, agent.seenIn) : null;
  const onLevel = (id: string) => shownOn(placeOf(model, id), levelId);
  return (
    <g className="ss-layer" aria-hidden="true">
      {agentAt
        ? agent.focus.filter(onLevel).map((id) => <Highlight key={`agent:${id}`} model={model} id={id} S={S} className="ss-highlight" />)
        : null}
      {points.map((mark) => {
        const at = firstPlace(model, [mark.entityId], mark.seenIn)?.at ?? null;
        if (!shownOn(at, levelId)) return null;
        return [
          <Highlight key={`hl:${mark.id}`} model={model} id={mark.entityId} S={S} className="ss-highlight ss-highlight--point" />,
          <PointRing key={mark.id} mark={mark} x={at.x * S} y={at.y * S} r={P.ring} />,
        ];
      })}
      {peers.map((peer) =>
        peer.pointer && peer.view === "2d" && peer.levelId === levelId ? <PeerCursor key={peer.id} peer={peer} x={peer.pointer.x * S} y={peer.pointer.y * S} /> : null,
      )}
      {agentAt && shownOn(agentAt.at, levelId) ? (
        <AgentMarker x={agentAt.at.x * S} y={agentAt.at.y * S} label={agentLabel(agent, model)} entity={agentAt.id} waiting={agent.state === "waiting"} />
      ) : null}
    </g>
  );
}
