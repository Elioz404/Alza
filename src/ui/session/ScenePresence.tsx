/**
 * The shared session over the 3D view: the agent's marker with its label ("Agent · moving Sofa")
 * on top of what it is touching, what it points at with its message, and the other tabs' pointers
 * on the floor they are on. The model outlines what the agent touches in its colour itself
 * (three/marks.ts, through Scene3D.tsx); these are the words and the dots over it, in a layer of
 * the canvas's overlays (CanvasRegion.tsx) fetched after the first paint. It does not import
 * three.js: the mounted view answers where things are through the scene probe.
 *
 * A marker is placed where the viewport projects its point (model/sceneBus.ts, sceneProbe.locate
 * and project), through custom properties set on the element's CSSOM — no style attribute, no
 * re-render: once when what it marks changes, and after each frame the view draws (onSceneFrame),
 * so it follows the camera in the same frame and costs nothing while the view is at rest. A
 * marker whose point is behind the camera is hidden. Drawn for the eye (aria-hidden): the
 * presence indicator says the same in words, and says what the agent points at.
 */

import "./session.css";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { store } from "../../model/store";
import { SESSION } from "../../model/limits";
import { presence } from "../../model/presence";
import { entityInfo, markerOf, type Place } from "../../model/places";
import { onSceneFrame, sceneProbe, type SceneLocatable, type ScenePoint } from "../../model/sceneBus";
import type { PlanModel } from "../../model/types";
import { AGENT_COLOUR, agentLabel, agentShows, firstPlace, peerColour, tabName } from "./participants";

interface Marker {
  key: string;
  text: string;
  colour: string;
  agent: boolean;
  /** the entity it stands on, if it stands on one; else the point */
  entityId: string | null;
  /** where it stands when its entity is not on the plan (any more) */
  at: Place | null;
  up: number;
}

/** What stands on its own top; a room's marker stands in from its corner (markerOf), clear of its name. */
const LOCATABLE: ReadonlySet<string> = new Set<SceneLocatable>(["wall", "item", "stair"]);

/** Where a marker shows on the canvas now: on its entity's top where the view can say, else over its point. */
function screenOf(model: PlanModel, m: Marker): ScenePoint | null {
  const info = m.entityId ? entityInfo(model, m.entityId) : null;
  if (info && LOCATABLE.has(info.type)) return sceneProbe.locate?.(info.type as SceneLocatable, info.id) ?? null;
  const at = (m.entityId ? markerOf(model, m.entityId) : null) ?? m.at;
  return at ? (sceneProbe.project?.(at.x, at.y, at.levelId, m.up) ?? null) : null;
}

export function ScenePresence() {
  // read, not subscribed: a change to the plan moves the markers in the frame loop below
  const model = store.getState().model;
  const agent = useStore(presence, (s) => s.agent);
  const points = useStore(presence, (s) => s.points);
  const peers = useStore(presence, (s) => s.peers);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  const markers: Marker[] = [];
  const agentAt = agentShows(agent) ? firstPlace(model, agent.focus, agent.seenIn) : null;
  if (agentAt) {
    markers.push({ key: "agent", text: agentLabel(agent, model), colour: AGENT_COLOUR, agent: true, entityId: agentAt.id, at: agentAt.at, up: SESSION.markerUp.entity });
  }
  for (const mark of points) {
    const at = firstPlace(model, [mark.entityId], mark.seenIn)?.at ?? null;
    markers.push({ key: mark.id, text: mark.message, colour: AGENT_COLOUR, agent: true, entityId: mark.entityId, at, up: SESSION.markerUp.entity });
  }
  for (const peer of peers) {
    if (!peer.pointer || peer.view !== "2d") continue;
    const at: Place = { ...peer.pointer, levelId: peer.levelId ?? undefined };
    markers.push({ key: peer.id, text: tabName(peer), colour: peerColour(peer), agent: false, entityId: null, at, up: SESSION.markerUp.pointer });
  }
  const signature = JSON.stringify(markers);

  useEffect(() => {
    const list: Marker[] = JSON.parse(signature);
    if (list.length === 0) return;
    const place = () => {
      const plan = store.getState().model;
      for (const m of list) {
        const el = nodes.current.get(m.key);
        if (!el) continue;
        const p = screenOf(plan, m);
        el.hidden = p === null;
        if (!p) continue;
        el.style.setProperty("--ss-x", `${p.x}px`);
        el.style.setProperty("--ss-y", `${p.y}px`);
        el.style.setProperty("--ss-colour", m.colour);
      }
    };
    place();
    return onSceneFrame(place);
  }, [signature]);

  return (
    <div className="ss-scene" aria-hidden="true">
      {markers.map((m) => (
        <div
          key={m.key}
          ref={(el) => {
            if (el) nodes.current.set(m.key, el);
            else nodes.current.delete(m.key);
          }}
          className={`ss-scene__marker${m.agent ? " ss-scene__marker--agent" : ""}`}
          data-session={m.key === "agent" ? "agent" : m.agent ? "point" : "cursor"}
          data-entity={m.entityId ?? undefined}
          hidden
        >
          <span className="ss-scene__dot" />
          <span className="ss-scene__text">{m.text}</span>
        </div>
      ))}
    </div>
  );
}
