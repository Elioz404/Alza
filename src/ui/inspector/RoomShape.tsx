/**
 * A room's outline from the keyboard: each corner's position, each edge's bend, adding a corner
 * on an edge, removing one, and fitting the room to the walls round it. Every field dispatches
 * one reshape_room or update_room command, as the plan's handles do (an agent has no reshape_room
 * tool: it gives update_room the whole outline, points and arcs); corner and edge
 * numbers are the outline's as the plan letters them, from 1.
 */

import { useRef } from "react";
import { useAppStore } from "../useAppStore";
import { COORD, ROOM_SHAPE, SNAP } from "../../model/limits";
import type { Room } from "../../model/types";
import type { RoomReshape } from "../../model/store";
import { levelSlice } from "../../model/levels";
import { edgeArc, edgeLength, outlineAnchor, outlineEdges, pointOnEdge, sagittaOf } from "../../model/shapes";
import { Button, IconPlus, IconTrash, Section } from "../primitives";
import { useCommit } from "./parts";
import { useNotify } from "../shell/useNotify";
import { MeasureField, PointFields } from "./measure";
import { metres } from "./entities";

export function RoomShape({ room }: { room: Room }) {
  const commit = useCommit();
  const notify = useNotify();
  const plan = useAppStore((s) => s.model);
  const reshape = (change: RoomReshape) => commit({ type: "reshape_room", id: room.id, change });
  const edges = outlineEdges(room.points);
  const canRemove = room.points.length > ROOM_SHAPE.vertices.min;
  const canAdd = room.points.length < ROOM_SHAPE.vertices.max;
  const listRef = useRef<HTMLOListElement>(null);
  /**
   * After a corner is added or removed the rows shift under the button pressed, so focus goes on
   * to a field that means something: the X of the corner now at `index` (the one just added, or
   * the one that took a removed corner's place). The count beside the title announces the change.
   */
  const focusCorner = (index: number) => {
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>(".insp-shape__corner");
      if (!rows || rows.length === 0) return;
      rows[Math.min(index, rows.length - 1)].querySelector<HTMLElement>("input")?.focus();
    });
  };

  const addCorner = (i: number) => {
    const m = pointOnEdge(edges[i], 0.5);
    reshape({ op: "insert_vertex", edge: i, x: m.x, y: m.y });
    focusCorner(i + 1);
  };
  const removeCorner = (i: number) => {
    reshape({ op: "remove_vertex", index: i });
    focusCorner(i);
  };

  const fit = async () => {
    // fetched when asked for (enclose.ts is a chunk of its own)
    const { enclosedOutline } = await import("../../model/enclose");
    const at = outlineAnchor(room.points);
    const points = enclosedOutline(levelSlice(plan, room.levelId).walls, at);
    if (points) commit({ type: "update_room", id: room.id, patch: { points } });
    else notify({ body: `No walls close round ${room.label}: draw them all the way round first`, type: "error" });
  };

  return (
    <Section
      title="Shape"
      action={
        <span className="insp-aside num" aria-live="polite">
          {room.points.length} corners
        </span>
      }
    >
      <ol className="insp-shape" ref={listRef}>
        {room.points.map((p, i) => {
          const e = edges[i];
          const arc = edgeArc(e);
          const half = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) / 2;
          return (
            <li key={i} className="insp-shape__corner">
              <PointFields label={`Corner ${i + 1}`} x={p.x} y={p.y} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(q) => reshape({ op: "move_vertex", index: i, x: q.x ?? p.x, y: q.y ?? p.y })} />
              <MeasureField
                label={`Edge ${i + 1} bend, out of the room`}
                value={sagittaOf(e)}
                min={-half}
                max={half}
                step={SNAP}
                onCommit={(v) => reshape({ op: "bend_edge", edge: i, curve: { sagitta: v } })}
              />
              <p className="insp-help num">
                Edge {i + 1}: {metres(edgeLength(e))}
                {arc ? `, an arc of radius ${metres(arc.radius)}` : ""}
              </p>
              {/* one row that never wraps: two small buttons stacked would lay their 44 px touch
                  bands over each other; the corner and edge they act on are in their names */}
              <div className="insp-row insp-shape__actions">
                <Button size="sm" variant="ghost" icon={IconPlus} aria-label={`Add a corner on edge ${i + 1}`} disabledReason={canAdd ? null : `A room has at most ${ROOM_SHAPE.vertices.max} corners`} onClick={() => addCorner(i)}>
                  Add corner
                </Button>
                <Button size="sm" variant="danger-quiet" icon={IconTrash} aria-label={`Remove corner ${i + 1}`} disabledReason={canRemove ? null : `A room has at least ${ROOM_SHAPE.vertices.min} corners`} onClick={() => removeCorner(i)}>
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="insp-row">
        <Button size="sm" onClick={() => void fit()}>
          Fit to the walls
        </Button>
      </div>
      <p className="insp-help">A positive bend bows the edge out of the room, 0 is straight. On the plan, drag a corner, or an edge's middle to bend it.</p>
    </Section>
  );
}
