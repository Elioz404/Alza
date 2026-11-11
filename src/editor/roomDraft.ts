/**
 * The room tool's outline, drawn one corner at a time: a click puts a corner down, a click on
 * the first corner (or Enter, or a double-click) closes the outline into a room, Backspace takes
 * the last corner back and Esc drops the outline. A drag from empty paper still draws a
 * rectangle (Editor.tsx); a click without a drag starts an outline here instead.
 *
 * From the keyboard: the arrow keys move a cross (one snap step, ten with Shift) from the middle
 * of the view, C puts a corner down at it, and Enter closes the outline as for the pointer.
 *
 * The outline is page state (canvasState.ts) until it closes; closing it is one add_room, as the
 * human, so it is one undo step and one line in the feed, and the store judges it as it judges
 * an agent's outline (no crossing itself, no edge or area under ROOM_SHAPE's minimums).
 */

import { activeLevelId, store } from "../model/store";
import { dispatch } from "../model/commands";
import type { ActionResult } from "../model/store";
import type { Pt } from "../model/geometry";
import type { RoomVertex } from "../model/types";
import { levelSlice } from "../model/levels";
import { DEFAULT_FLOOR, ROOM_SHAPE, ROOM_SIZE } from "../model/limits";
import { outlineFault } from "../model/shapes";
import { canvasStore } from "./canvasState";

/** Two corners closer than this (metres) are the same corner: a second click of a double-click. */
const SAME = 1e-6;

const same = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) < SAME;

/** The outline being drawn, or null. */
export const roomDraft = (): readonly Pt[] | null => canvasStore.getState().roomDraft;

/** The outline the corners would make, closed (with `next`, where the pointer is, as one more). */
export function draftOutline(corners: readonly Pt[], next?: Pt | null): RoomVertex[] {
  const all = next && !(corners.length > 0 && (same(corners[corners.length - 1], next) || same(corners[0], next))) ? [...corners, next] : corners;
  return all.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Why these corners cannot close into a room yet, in the hint bar's words, or null when they can:
 * too few corners, or what the store would refuse (outlineFault). Judged on the corners in the
 * order they were put down, not as the store rewinds them (every check reads the same either way
 * round), so an edge is named as the person drew it, counted from 1: edge 1 runs from the first
 * corner to the second, and the closing edge is the last.
 */
export function draftError(corners: readonly Pt[]): string | null {
  if (corners.length < ROOM_SHAPE.vertices.min) return `A room needs at least ${ROOM_SHAPE.vertices.min} corners`;
  const fault = outlineFault(draftOutline(corners), ROOM_SIZE.min);
  if (!fault) return null;
  const n = corners.length;
  const edge = (i: number) => (i === n - 1 ? `the closing edge (${n})` : `edge ${i + 1}`);
  switch (fault.kind) {
    case "short":
      return `${capital(edge(fault.edges[0]))} is ${centimetres(fault.length)} long (min ${centimetres(ROOM_SHAPE.minEdge)})`;
    case "crossing":
      return `${capital(edge(fault.edges[0]))} and ${edge(fault.edges[1])} cross or touch`;
    case "area":
      return `It encloses ${fault.area.toFixed(2)} m² (min ${ROOM_SHAPE.minArea} m²)`;
    case "narrow":
      return `It is at most ${fault.width.toFixed(2)} m wide (min ${ROOM_SIZE.min} m)`;
    default:
      return fault.message.replace(/\.$/, "");
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const centimetres = (m: number): string => `${Number((m * 100).toFixed(1))} cm`;

/** The name the next room drawn on the level being worked on gets. */
export function nextRoomLabel(): string {
  const state = store.getState();
  return `Room ${levelSlice(state.model, activeLevelId(state)).rooms.length + 1}`;
}

/**
 * Put a corner down at p. A click on the last corner again does nothing (the second click of a
 * double-click); a click on the first corner, with enough corners down, closes the outline.
 * Returns what happened.
 */
export function addDraftCorner(p: Pt): "started" | "added" | "same" | "closed" | "refused" {
  const corners = roomDraft();
  if (!corners || corners.length === 0) {
    canvasStore.setState({ roomDraft: [{ x: p.x, y: p.y }] });
    return "started";
  }
  if (same(corners[corners.length - 1], p)) return "same";
  if (same(corners[0], p)) return closeRoomDraft()?.ok ? "closed" : "refused";
  if (corners.length >= ROOM_SHAPE.vertices.max) return "refused";
  canvasStore.setState({ roomDraft: [...corners, { x: p.x, y: p.y }] });
  return "added";
}

/** Take the last corner back; the outline is dropped with its first. True when there was one. */
export function removeLastCorner(): boolean {
  const corners = roomDraft();
  if (!corners) return false;
  canvasStore.setState({ roomDraft: corners.length > 1 ? corners.slice(0, -1) : null });
  return true;
}

/** Drop the outline being drawn (and the keyboard's cross). True when there was one. */
export function cancelRoomDraft(): boolean {
  const had = roomDraft() !== null || canvasStore.getState().roomCursor !== null;
  if (had) canvasStore.setState({ roomDraft: null, roomCursor: null });
  return had;
}

/**
 * Close the outline into a room: one add_room as the human. The outline stays to be put right
 * when the store refuses it (the hint bar says why). Null when there is no outline to close.
 */
export function closeRoomDraft(): ActionResult | null {
  const corners = roomDraft();
  if (!corners || corners.length < ROOM_SHAPE.vertices.min) return null;
  const r = dispatch({ type: "add_room", points: draftOutline(corners), label: nextRoomLabel(), floor: DEFAULT_FLOOR }, { actor: "human" });
  if (r.ok) canvasStore.setState({ roomDraft: null, roomCursor: null });
  return r;
}

/** Move the keyboard's cross by (dx, dy) metres, from `from` when it has not been placed yet. */
export function moveRoomCursor(dx: number, dy: number, from: Pt): void {
  const at = canvasStore.getState().roomCursor ?? from;
  canvasStore.setState({ roomCursor: { x: at.x + dx, y: at.y + dy } });
}
