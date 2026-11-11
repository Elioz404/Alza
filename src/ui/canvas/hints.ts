/**
 * What the hint bar says: the tool in use (or what is selected) and what the hand can do next,
 * each action with its key. Pure, from the state the bar reads, so the copy can be checked
 * without a page.
 */

import type { EditorState } from "../../model/store";
import type { PlanModel } from "../../model/types";
import { catalogOf } from "../../model/catalog";
import { COLUMN, DOOR_DEFAULTS, ROOM_SHAPE, SNAP, WINDOW_DEFAULTS } from "../../model/limits";
import { draftError } from "../../editor/roomDraft";
import { levelAbove, levelContents, levelSlice } from "../../model/levels";
import type { PlanTool } from "../../editor/canvasState";
import { climbWord } from "../../editor/drawing";
import { columnAim as aimColumn, type ColumnAim } from "../../model/columns";
import { columnName, wallName } from "../inspector/entities";

/** A part of a hint segment: words, or a key in Kbd notation. */
export type HintPart = string | { kbd: string };

export interface Hint {
  /** the tool or the selection, first and in the strong voice */
  title: string;
  /** one action each, kept apart by dividers, never dot-joined */
  segments: readonly (readonly HintPart[])[];
}

export interface HintInput {
  editor: Pick<EditorState, "drawMode" | "placingKind" | "pendingWallStart" | "selectedWallId" | "selectedRoomId" | "selectedItemId" | "selectedStairId"> &
    Partial<Pick<EditorState, "selectedColumnId">>;
  /** the whole plan; the hint speaks of what is on the level being worked on */
  model: PlanModel;
  /** the level being worked on (activeLevelId); the plan's first when not given */
  levelId?: string;
  tool: PlanTool | null;
  spacePan: boolean;
  /** with the door or window tool over a wall: whether the opening fits there */
  openingFits: boolean | null;
  /** with the stair tool: the way the next stair climbs (its rotation), as the arrows aim it */
  stairRotation?: number;
  /** with the room tool: the corners of the outline being drawn, or null */
  roomDraft?: readonly { x: number; y: number }[] | null;
  /** with the room tool: the keyboard's cross, once the arrows have brought it, or null */
  roomCursor?: { x: number; y: number } | null;
  /** with the column tool: its keyboard cross, once the arrows have brought it, or null */
  columnCursor?: { x: number; y: number } | null;
}

const centimetres = (m: number): string => `${Math.round(m * 100)} cm`;
const metres = (m: number): string => `${m.toFixed(2)} m`;

type At = { x: number; y: number };
const lengthTo = (p: At, q: At): string => metres(Math.hypot(q.x - p.x, q.y - p.y));

/** "Cross at X 3.40 m, Y 2.10 m", then the edge from the last corner to it and the one closing back to the first. */
export function crossWords(cross: At, corners: readonly At[] | null): string {
  const at = `Cross at X ${metres(cross.x)}, Y ${metres(cross.y)}`;
  if (!corners || corners.length === 0) return at;
  const last = corners[corners.length - 1];
  const edge = `${at}: edge ${corners.length} would be ${lengthTo(last, cross)}`;
  return corners.length < 2 ? edge : `${edge}, closing ${lengthTo(cross, corners[0])}`;
}

const NUDGE: readonly HintPart[] = [{ kbd: "left" }, { kbd: "right" }, { kbd: "up" }, { kbd: "down" }, `nudge ${centimetres(SNAP)}`];
export const REMOVE: readonly HintPart[] = [{ kbd: "delete" }, "remove"];
export const DESELECT: readonly HintPart[] = [{ kbd: "esc" }, "deselect"];

/**
 * What is selected, as both hint bars name it ("Wall selected", "Bedroom selected", "Desk
 * selected"); null when nothing that still exists is.
 */
export function selectionTitle(
  editor: Pick<EditorState, "selectedWallId" | "selectedRoomId" | "selectedItemId" | "selectedStairId"> & Partial<Pick<EditorState, "selectedColumnId">>,
  model: PlanModel,
): string | null {
  if (editor.selectedWallId && model.walls.some((w) => w.id === editor.selectedWallId)) return "Wall selected";
  if (editor.selectedRoomId) {
    const room = model.rooms.find((r) => r.id === editor.selectedRoomId);
    if (room) return `${room.label} selected`;
  }
  if (editor.selectedItemId) {
    const item = model.items.find((i) => i.id === editor.selectedItemId);
    if (item) return `${catalogOf(model).get(item.kind)?.label ?? "Piece"} selected`;
  }
  if (editor.selectedStairId) {
    const stair = model.stairs.find((s) => s.id === editor.selectedStairId);
    if (stair) return `${stair.shape === "l" ? "L-shaped stair" : "Stair"} selected`;
  }
  if (editor.selectedColumnId && model.columns.some((c) => c.id === editor.selectedColumnId)) return "Column selected";
  return null;
}

/**
 * Where the column tool's aim puts a column, in words: the point, what it was pulled to, and the
 * column it would stand in. What Enter would put down, so a reader hears it before pressing it.
 */
export function columnAimWords(model: Pick<PlanModel, "walls" | "columns">, aim: ColumnAim): string {
  const wall = aim.to === "corner" || aim.to === "wall" ? model.walls.find((w) => w.id === aim.ref) : undefined;
  const column = aim.to === "column" ? model.columns.find((c) => c.id === aim.ref) : undefined;
  const to = wall
    ? aim.to === "corner"
      ? `, on the end of ${wallName(model, wall)}`
      : `, on the axis of ${wallName(model, wall)}`
    : column
      ? `, in line with ${columnName(model, column)}`
      : ", on the grid";
  const over = aim.overlaps ? model.columns.find((c) => c.id === aim.overlaps) : undefined;
  return `Column at X ${metres(aim.x)}, Y ${metres(aim.y)}${to}${over ? `: it would overlap ${columnName(model, over)}` : ""}`;
}

export function hintFor({ editor, model, levelId = model.levels[0]?.id, tool, spacePan, openingFits, stairRotation = 0, roomDraft = null, roomCursor = null, columnCursor = null }: HintInput): Hint {
  if (spacePan) return { title: "Pan", segments: [["Drag to move the plan"], ["Let go of", { kbd: "space" }, "to go back"]] };

  switch (tool) {
    case "pan":
      return { title: "Pan", segments: [["Drag to move the plan"], ["Scroll to zoom"], [{ kbd: "v" }, "back to Select"]] };
    case "door":
    case "window": {
      const width = tool === "door" ? DOOR_DEFAULTS.width : WINDOW_DEFAULTS.width;
      const what = tool === "door" ? "door" : "window";
      const first: readonly HintPart[] =
        openingFits === false
          ? [`A ${metres(width)} ${what} does not fit here. Try a longer stretch of wall`]
          : [`Click a wall to place a ${metres(width)} ${what}`];
      return { title: tool === "door" ? "Add doors" : "Add windows", segments: [first, ["Select its wall to change the size"], [{ kbd: "esc" }, "finish"]] };
    }
    case "stair": {
      const first: readonly HintPart[] = ["Press where the stair starts, drag the way it climbs"];
      const reach: readonly HintPart[] =
        levelId !== undefined && levelAbove(model, levelId) === undefined ? ["There is no level above yet: add one for it to reach"] : [{ kbd: "enter" }, "put one in the middle"];
      // the title names the aim, so the polite status line says each change of it
      return { title: `Add a stair, climbing ${climbWord(stairRotation)}`, segments: [first, reach, [{ kbd: "left" }, { kbd: "right" }, { kbd: "up" }, { kbd: "down" }, "the way it climbs"], [{ kbd: "esc" }, "finish"]] };
    }
    case "column": {
      // where the cross's column would go is lettered (snapped, and any column it would stand in),
      // so the polite status line reads each arrow step out as what Enter would do
      const aim = columnCursor && levelId !== undefined ? aimColumn(columnCursor, levelSlice(model, levelId)) : null;
      const where: readonly HintPart[] = aim ? [columnAimWords(model, aim)] : [`Click to place a ${metres(COLUMN.defaults.size)} column`];
      return {
        title: "Add columns",
        segments: [
          where,
          ["Snaps to wall corners, wall axes and other columns"],
          [{ kbd: "left" }, { kbd: "right" }, { kbd: "up" }, { kbd: "down" }, "move the cross"],
          [{ kbd: "enter" }, "put one there"],
          [{ kbd: "esc" }, "finish"],
        ],
      };
    }
    default:
      break;
  }

  switch (editor.drawMode) {
    case "wall":
      return editor.pendingWallStart
        ? {
            title: "Draw walls",
            segments: [["Click the next corner"], [{ kbd: "shift" }, "keep it straight"], [{ kbd: "esc" }, "finish the run"]],
          }
        : { title: "Draw walls", segments: [["Click where the first corner goes"], ["Ends snap to other walls"], [{ kbd: "esc" }, "finish"]] };
    case "room": {
      // the keyboard's cross, lettered: where it is and, with corners down, how long the edge to
      // it and the edge closing back to the first corner would be. The bar is a live region, so
      // each arrow step and each corner is read out
      const cross: readonly HintPart[] | null = roomCursor ? [crossWords(roomCursor, roomDraft)] : null;
      if (roomDraft && roomDraft.length > 0) {
        const why = draftError(roomDraft);
        const close: readonly HintPart[] =
          why === null ? [{ kbd: "enter" }, "or click the first corner to close it"] : roomDraft.length < ROOM_SHAPE.vertices.min ? [why] : [`${why}: it cannot close yet`];
        const next: readonly HintPart[] = cross ?? ["Click the next corner"];
        const put: readonly (readonly HintPart[])[] = cross ? [[{ kbd: "c" }, "put a corner there"]] : [];
        return {
          title: `Draw a room, ${roomDraft.length} ${roomDraft.length === 1 ? "corner" : "corners"}`,
          segments: [next, ...put, close, [{ kbd: "backspace" }, "take the last one back"], [{ kbd: "esc" }, "cancel"]],
        };
      }
      if (cross) return { title: "Draw a room", segments: [cross, [{ kbd: "c" }, "put a corner there"], [{ kbd: "esc" }, "cancel"]] };
      // the keys' whole path (arrows, C, Enter) is on the shortcut sheet; the first arrow brings the cross
      return {
        title: "Draw a room",
        segments: [["Drag a rectangle, or click corner by corner"], [{ kbd: "up" }, "draw from the keys"], [{ kbd: "esc" }, "cancel"]],
      };
    }
    case "place": {
      const label = editor.placingKind ? (catalogOf(model).get(editor.placingKind)?.label ?? "furniture") : "furniture";
      return {
        title: `Place ${label.toLowerCase()}`,
        segments: [["Click the plan to place it"], [{ kbd: "enter" }, "put one in the middle"], [{ kbd: "esc" }, "stop placing"]],
      };
    }
    default:
      break;
  }

  const selected = selectionTitle(editor, model);
  if (selected) {
    const wall = model.walls.some((w) => w.id === editor.selectedWallId);
    const room = !wall && model.rooms.some((r) => r.id === editor.selectedRoomId);
    if (wall) return { title: selected, segments: [["Drag an end to move it"], ["Drag the middle to bend it"], NUDGE, REMOVE, DESELECT] };
    if (room) {
      return {
        title: selected,
        segments: [["Drag to move, a corner to reshape"], ["Drag an edge's middle to bend it,", { kbd: "shift" }, "to add a corner"], ["Double-click a corner to remove it"], NUDGE, REMOVE, DESELECT],
      };
    }
    return { title: selected, segments: [["Drag to move"], NUDGE, REMOVE, DESELECT] };
  }

  const levels: readonly HintPart[] = [{ kbd: "pageup" }, { kbd: "pagedown" }, "the level above or below"];
  const here = levelId === undefined ? model : levelContents(model, levelId);
  const empty = here.walls.length === 0 && here.rooms.length === 0 && here.items.length === 0 && here.stairs.length === 0 && here.columns.length === 0;
  if (model.levels.length > 1) {
    return {
      title: "Select",
      segments: [[empty ? "Nothing on this level yet: pick a tool to draw on it" : "Click a wall, room, piece or stair to select it"], levels, [{ kbd: "space" }, "drag to pan"]],
    };
  }
  if (empty) {
    return {
      title: "Select",
      segments: [["Pick a tool, or press", { kbd: "r" }, "to draw a room"], [{ kbd: "space" }, "drag to pan"]],
    };
  }
  return {
    title: "Select",
    segments: [["Click a wall, room, piece or stair to select it"], [{ kbd: "space" }, "drag to pan"], ["Scroll to zoom"]],
  };
}
