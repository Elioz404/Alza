/**
 * The handles a selected shape is edited by on the plan, and the measures that go with them.
 *
 *  - A room: a square handle on each corner (drag to move it, snapping as the room tool does;
 *    double-click to remove it) and a round one at the middle of each edge (drag to bend the edge
 *    through the pointer, back onto its chord to straighten it; Shift and drag to add a corner
 *    there and move it; double-click to add a corner at the middle). Each edge is lettered with
 *    its length along it, an arc's with its radius too.
 *  - A wall: a round handle at its middle (drag to bend it into an arc through the pointer, back
 *    onto its chord to straighten it), and a curved wall's radius drawn from its centre.
 *
 * Every drag is one gesture (useGesture): one undo step and one line in the feed. A room's drag
 * dispatches the reshape_room command (the person's own; an agent reshapes a room by giving
 * update_room its whole outline, points and arcs), a wall's the edit_wall command an agent's
 * edit_wall tool runs too. A corner is followed by where it was last
 * put, not by its index, so a drag that turns the outline over (normalizeOutline rewinds it)
 * keeps hold of the same corner.
 *
 * Fetched after the first paint (Editor.tsx); from the keyboard, the selection's Properties
 * edit the same corners, edges and bend in labelled fields.
 */

import "../ui/canvas/shapes.css";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { store } from "../model/store";
import type { Room, RoomVertex, Wall } from "../model/types";
import { snap, type Pt } from "../model/geometry";
import { chordNormal, edgeArc, edgeLength, outlineEdges, pointOnEdge, wallArc, wallPointAt, type Edge } from "../model/shapes";
import { useGesture } from "../ui/useGesture";
import { LETTER, MARK, metres, textWidth } from "./drawing";

export interface ShapeHandlesProps {
  room?: Room;
  wall?: Wall;
  S: number;
  /** the plan point under a client pixel */
  toWorld: (clientX: number, clientY: number) => Pt;
  /** a plan point as the editor snaps it: to a wall end within reach, else the grid */
  snapPoint: (p: Pt) => Pt;
}

const NEAR = 1e-6;
const near = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) < NEAR;

/**
 * How far p stands off the chord from a to b toward its positive side (chordNormal), snapped to
 * the grid's step and held within a half circle's: the sagitta a bend through p asks for.
 */
export function sagittaToward(a: Pt, b: Pt, p: Pt): number {
  const n = chordNormal(a, b);
  const raw = n.x * (p.x - (a.x + b.x) / 2) + n.y * (p.y - (a.y + b.y) / 2);
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const s = snap(raw);
  return Math.max(-half, Math.min(half, s));
}

/** An edge's lettering: its length along it, and an arc's radius. */
export function edgeMeasure(e: Edge): string {
  const arc = edgeArc(e);
  return arc ? `${metres(edgeLength(e))} · R ${metres(arc.radius)}` : metres(edgeLength(e));
}

/** The index of the corner at p in a room's outline as it is now, or -1. */
const cornerAt = (points: readonly RoomVertex[], p: Pt): number => points.findIndex((q) => near(q, p));

/** The index of the edge from a to b in a room's outline as it is now, or -1. */
const edgeFrom = (points: readonly RoomVertex[], a: Pt, b: Pt): number =>
  points.findIndex((q, i) => near(q, a) && near(points[(i + 1) % points.length], b));

const roomNow = (id: string): Room | undefined => store.getState().model.rooms.find((r) => r.id === id);

type Hold =
  | { kind: "corner"; at: Pt }
  | { kind: "edge"; a: Pt; b: Pt }
  /** Shift on an edge's middle: the corner is added on the first move, then held like any other */
  | { kind: "insert"; a: Pt; b: Pt }
  | { kind: "wall" };

export function ShapeHandles({ room, wall, S, toWorld, snapPoint }: ShapeHandlesProps) {
  const gesture = useGesture();
  const hold = useRef<Hold | null>(null);

  const grab = (h: Hold, e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    hold.current = h;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer: the drag still follows while the pointer stays over the handle
    }
  };

  const move = (e: ReactPointerEvent<SVGGElement>) => {
    const h = hold.current;
    if (!h) return;
    e.stopPropagation();
    const raw = toWorld(e.clientX, e.clientY);
    if (h.kind === "wall") {
      if (!wall) return;
      const a = { x: wall.ax, y: wall.ay };
      const b = { x: wall.bx, y: wall.by };
      gesture.update({ type: "edit_wall", id: wall.id, patch: { curve: { sagitta: sagittaToward(a, b, raw) } } });
      return;
    }
    if (!room) return;
    const now = roomNow(room.id);
    if (!now) return;
    if (h.kind === "edge") {
      const edge = edgeFrom(now.points, h.a, h.b);
      if (edge < 0) return;
      gesture.update({ type: "reshape_room", id: room.id, change: { op: "bend_edge", edge, curve: { sagitta: sagittaToward(h.a, h.b, raw) } } });
      return;
    }
    const p = snapPoint(raw);
    if (h.kind === "insert") {
      const edge = edgeFrom(now.points, h.a, h.b);
      if (edge < 0) return;
      const before = now.points;
      const r = gesture.update({ type: "reshape_room", id: room.id, change: { op: "insert_vertex", edge, x: p.x, y: p.y } });
      if (!r.ok) return;
      const added = roomNow(room.id)?.points.find((q) => !before.some((o) => near(o, q)));
      hold.current = added ? { kind: "corner", at: { x: added.x, y: added.y } } : null;
      return;
    }
    const index = cornerAt(now.points, h.at);
    const to = { x: snap(p.x), y: snap(p.y) };
    if (index < 0 || near(to, h.at)) return;
    const r = gesture.update({ type: "reshape_room", id: room.id, change: { op: "move_vertex", index, x: p.x, y: p.y } });
    if (r.ok) hold.current = { kind: "corner", at: to };
  };

  const release = (e: ReactPointerEvent<SVGGElement>) => {
    if (!hold.current) return;
    e.stopPropagation();
    hold.current = null;
    gesture.end();
  };

  const drag = { onPointerMove: move, onPointerUp: release, onPointerCancel: release };

  const removeCorner = (at: Pt) => {
    const now = room && roomNow(room.id);
    const index = now ? cornerAt(now.points, at) : -1;
    if (index < 0 || !room) return;
    gesture.update({ type: "reshape_room", id: room.id, change: { op: "remove_vertex", index } });
    gesture.end();
  };
  const addCorner = (a: Pt, b: Pt, at: Pt) => {
    const now = room && roomNow(room.id);
    const edge = now ? edgeFrom(now.points, a, b) : -1;
    if (edge < 0 || !room) return;
    gesture.update({ type: "reshape_room", id: room.id, change: { op: "insert_vertex", edge, x: at.x, y: at.y } });
    gesture.end();
  };

  const reach = MARK.touchReach;
  return (
    <g className="pl-shape-handles">
      {room
        ? outlineEdges(room.points).map((e, i) => {
            const px = edgeLength(e) * S;
            const mid = pointOnEdge(e, 0.5);
            const text = edgeMeasure(e);
            // lettered just inside the room, off the edge's middle (and its handle): further in
            // across an edge that runs up the sheet, the lettering being wider than it is tall
            const n = chordNormal(e.a, e.b);
            const inset = MARK.edgeDimInset + (Math.abs(n.x) * textWidth(text, LETTER.small)) / 2;
            const lx = mid.x * S - n.x * inset;
            const ly = mid.y * S - n.y * inset;
            return (
              <g key={`e${i}`}>
                {px >= Math.max(MARK.edgeDimRoom, textWidth(text, LETTER.small) + 2 * MARK.pillPad) ? (
                  <text className="pl-edge-dim pl-halo" x={lx} y={ly + LETTER.small / 3}>
                    {text}
                  </text>
                ) : null}
                {px >= MARK.midHandleRoom ? (
                  <g
                    className="pl-edge-handle"
                    data-edge={i}
                    onPointerDown={(ev) => grab(ev.shiftKey ? { kind: "insert", a: e.a, b: e.b } : { kind: "edge", a: e.a, b: e.b }, ev)}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation();
                      addCorner(e.a, e.b, mid);
                    }}
                    {...drag}
                  >
                    <title>{`Edge ${i + 1}, ${text} m: drag to bend it, Shift and drag to add a corner, double-click to add one here`}</title>
                    <circle className="pl-handle-reach" cx={mid.x * S} cy={mid.y * S} r={reach} />
                    <circle className="pl-mid-handle" cx={mid.x * S} cy={mid.y * S} r={MARK.midHandle} />
                  </g>
                ) : null}
              </g>
            );
          })
        : null}
      {room
        ? room.points.map((p, i) => (
            <g
              key={`c${i}`}
              className="pl-corner-handle"
              data-corner={i}
              onPointerDown={(ev) => grab({ kind: "corner", at: { x: p.x, y: p.y } }, ev)}
              onDoubleClick={(ev) => {
                ev.stopPropagation();
                removeCorner(p);
              }}
              {...drag}
            >
              <title>{`Corner ${i + 1}: drag to move it, double-click to remove it`}</title>
              <circle className="pl-handle-reach" cx={p.x * S} cy={p.y * S} r={reach} />
              <rect className="pl-handle" x={p.x * S - MARK.handle / 2} y={p.y * S - MARK.handle / 2} width={MARK.handle} height={MARK.handle} rx={MARK.handleRadius} />
            </g>
          ))
        : null}
      {wall ? <WallBend wall={wall} S={S} onGrab={(ev) => grab({ kind: "wall" }, ev)} drag={drag} /> : null}
    </g>
  );
}

/** A selected wall's bend handle at its middle, and a curved wall's radius from its centre. */
function WallBend({
  wall,
  S,
  onGrab,
  drag,
}: {
  wall: Wall;
  S: number;
  onGrab: (e: ReactPointerEvent<SVGGElement>) => void;
  drag: Record<string, (e: ReactPointerEvent<SVGGElement>) => void>;
}) {
  const mid = wallPointAt(wall, 0.5);
  const arc = wallArc(wall);
  const chord = Math.hypot(wall.bx - wall.ax, wall.by - wall.ay) * S;
  if (chord < MARK.midHandleRoom) return null;
  const radius = arc ? `R ${metres(arc.radius)}` : "";
  return (
    <g>
      {arc ? (
        <g className="pl-radius" aria-hidden="true">
          <path className="pl-radius-line" d={`M${arc.center.x * S} ${arc.center.y * S}L${mid.x * S} ${mid.y * S}`} />
          {/* the radius itself is lettered on the wall's pill (Editor.tsx), clear of the room's name */}
          <circle className="pl-radius-centre" cx={arc.center.x * S} cy={arc.center.y * S} r={MARK.cursorRing} />
        </g>
      ) : null}
      <g className="pl-edge-handle pl-bend-handle" data-bend={wall.id} onPointerDown={onGrab} {...drag}>
        <title>{arc ? `Curved wall, ${radius} m: drag its middle to change the bend, onto the straight line to straighten it` : "Drag the wall's middle to bend it into an arc"}</title>
        <circle className="pl-handle-reach" cx={mid.x * S} cy={mid.y * S} r={MARK.touchReach} />
        <circle className="pl-mid-handle" cx={mid.x * S} cy={mid.y * S} r={MARK.midHandle} />
      </g>
    </g>
  );
}
