/**
 * What the hint bar says: the tool in use (or what is selected) and what the hand can do next,
 * each action with its key. Pure, from the state the bar reads, so the copy can be checked
 * without a page.
 */

import type { EditorState } from "../../model/store";
import type { PlanModel } from "../../model/types";
import { catalogOf } from "../../model/catalog";
import { DOOR_DEFAULTS, SNAP, WINDOW_DEFAULTS } from "../../model/limits";
import type { PlanTool } from "../../editor/canvasState";

/** A part of a hint segment: words, or a key in Kbd notation. */
export type HintPart = string | { kbd: string };

export interface Hint {
  /** the tool or the selection, first and in the strong voice */
  title: string;
  /** one action each, kept apart by dividers, never dot-joined */
  segments: readonly (readonly HintPart[])[];
}

export interface HintInput {
  editor: Pick<EditorState, "drawMode" | "placingKind" | "pendingWallStart" | "selectedWallId" | "selectedRoomId" | "selectedItemId">;
  model: PlanModel;
  tool: PlanTool | null;
  spacePan: boolean;
  /** with the door or window tool over a wall: whether the opening fits there */
  openingFits: boolean | null;
}

const centimetres = (m: number): string => `${Math.round(m * 100)} cm`;
const metres = (m: number): string => `${m.toFixed(2)} m`;

const NUDGE: readonly HintPart[] = [{ kbd: "left" }, { kbd: "right" }, { kbd: "up" }, { kbd: "down" }, `nudge ${centimetres(SNAP)}`];
const REMOVE: readonly HintPart[] = [{ kbd: "delete" }, "remove"];
const DESELECT: readonly HintPart[] = [{ kbd: "esc" }, "deselect"];

export function hintFor({ editor, model, tool, spacePan, openingFits }: HintInput): Hint {
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

  if (editor.selectedWallId && model.walls.some((w) => w.id === editor.selectedWallId)) {
    return { title: "Wall selected", segments: [["Drag an end to move it"], NUDGE, REMOVE, DESELECT] };
  }
  if (editor.selectedRoomId) {
    const room = model.rooms.find((r) => r.id === editor.selectedRoomId);
    if (room) return { title: `${room.label} selected`, segments: [["Drag to move"], NUDGE, REMOVE, DESELECT] };
  }
  if (editor.selectedItemId) {
    const item = model.items.find((i) => i.id === editor.selectedItemId);
    if (item) {
      const label = catalogOf(model).get(item.kind)?.label ?? "Piece";
      return { title: `${label} selected`, segments: [["Drag to move"], NUDGE, REMOVE, DESELECT] };
    }
  }

  const empty = model.walls.length === 0 && model.rooms.length === 0 && model.items.length === 0;
  if (empty) {
    return {
      title: "Select",
      segments: [["Pick a tool, or press", { kbd: "r" }, "to draw a room"], [{ kbd: "space" }, "drag to pan"]],
    };
  }
  return {
    title: "Select",
    segments: [["Click a wall, room or piece to select it"], [{ kbd: "space" }, "drag to pan"], ["Scroll to zoom"]],
  };
}
