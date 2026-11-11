/**
 * What the hint bar says: the tool in use (or what is selected) and what the hand can do next,
 * each action with its key. Pure, from the state the bar reads, so the copy can be checked
 * without a page.
 */

import type { EditorState } from "../../model/store";
import type { PlanModel } from "../../model/types";
import { catalogOf } from "../../model/catalog";
import { DOOR_DEFAULTS, SNAP, WINDOW_DEFAULTS } from "../../model/limits";
import { levelAbove, levelContents } from "../../model/levels";
import type { PlanTool } from "../../editor/canvasState";
import { climbWord } from "../../editor/drawing";

/** A part of a hint segment: words, or a key in Kbd notation. */
export type HintPart = string | { kbd: string };

export interface Hint {
  /** the tool or the selection, first and in the strong voice */
  title: string;
  /** one action each, kept apart by dividers, never dot-joined */
  segments: readonly (readonly HintPart[])[];
}

export interface HintInput {
  editor: Pick<EditorState, "drawMode" | "placingKind" | "pendingWallStart" | "selectedWallId" | "selectedRoomId" | "selectedItemId" | "selectedStairId">;
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
}

const centimetres = (m: number): string => `${Math.round(m * 100)} cm`;
const metres = (m: number): string => `${m.toFixed(2)} m`;

const NUDGE: readonly HintPart[] = [{ kbd: "left" }, { kbd: "right" }, { kbd: "up" }, { kbd: "down" }, `nudge ${centimetres(SNAP)}`];
export const REMOVE: readonly HintPart[] = [{ kbd: "delete" }, "remove"];
export const DESELECT: readonly HintPart[] = [{ kbd: "esc" }, "deselect"];

/**
 * What is selected, as both hint bars name it ("Wall selected", "Bedroom selected", "Desk
 * selected"); null when nothing that still exists is.
 */
export function selectionTitle(editor: Pick<EditorState, "selectedWallId" | "selectedRoomId" | "selectedItemId" | "selectedStairId">, model: PlanModel): string | null {
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
  return null;
}

export function hintFor({ editor, model, levelId = model.levels[0]?.id, tool, spacePan, openingFits, stairRotation = 0 }: HintInput): Hint {
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
    case "room":
      return { title: "Draw a room", segments: [["Drag a rectangle"], [`Sizes snap to ${centimetres(SNAP)}`], [{ kbd: "esc" }, "cancel"]] };
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
    return { title: selected, segments: [[wall ? "Drag an end to move it" : "Drag to move"], NUDGE, REMOVE, DESELECT] };
  }

  const levels: readonly HintPart[] = [{ kbd: "pageup" }, { kbd: "pagedown" }, "the level above or below"];
  const here = levelId === undefined ? model : levelContents(model, levelId);
  const empty = here.walls.length === 0 && here.rooms.length === 0 && here.items.length === 0 && here.stairs.length === 0;
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
