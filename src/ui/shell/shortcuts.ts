/**
 * Keyboard shortcuts: the shell's own (rail tools, the shortcut sheet) and the full sheet the
 * help dialog lists, which also names the ones other parts of the page own (the editor's Esc,
 * Delete and Ctrl+Z in src/editor/Editor.tsx, the walker's keys in src/three/walk.ts).
 *
 * The shell's listener stands aside for anything typed into a field (keys.ts), for any key
 * pressed inside a dialog, a menu or a popover or behind a modal one (keys.ts), for any chord
 * with Ctrl, Cmd or Alt (those belong to the editor and the browser), and for an event
 * something else has already handled.
 */

import { useEffect } from "react";
import { pageActions, store } from "../../model/store";
import { SNAP } from "../../model/limits";
import { NUDGE_SHIFT_FACTOR } from "../../editor/canvasState";
import { isInsideOverlay, isTypingTarget } from "../keys";
import { toolsFor } from "./tools";
import { CANVAS_REGION_ID, SCROLL_REGION_ATTR } from "./ids";
import type { ShellState } from "./ShellContext";

/** A length in whole centimetres, as the sheet writes a step. */
const cm = (m: number): string => `${Math.round(m * 100)} cm`;

/** Which way PageUp and PageDown step through the levels. */
const LEVEL_KEYS: Readonly<Record<string, 1 | -1>> = Object.freeze({ PageUp: 1, PageDown: -1 });

/** Overflow that lets an element scroll, and so page with Page Up and Page Down. */
const SCROLLS = new Set(["auto", "scroll"]);

/**
 * Is the key aimed at something that pages with Page Up and Page Down itself? A region marked
 * as scrolling (the side panel's tab panels, the activity feed: SCROLL_REGION_ATTR) or any
 * element between the target and the page that scrolls now: its overflow lets it, and it holds
 * more than it shows. The canvas region is no scroller — there the keys step the levels.
 */
export function inScrollingRegion(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body && el.id !== CANVAS_REGION_ID; el = el.parentElement) {
    if (el.matches(`[role="tabpanel"], [${SCROLL_REGION_ATTR}]`)) return true;
    if (SCROLLS.has(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

/** The key a rail shortcut is written with, as KeyboardEvent.key reports it. */
const keyOf = (shortcut: string) => shortcut.toLowerCase();

/** Handle one keydown for the shell. Returns true when it acted. Exported for the tests. */
export function handleShellKey(e: KeyboardEvent, shell: ShellState): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isTypingTarget(e.target) || isInsideOverlay(e.target)) return false;
  if (e.key === "?") {
    shell.setHelpOpen(true);
    return true;
  }
  const step = LEVEL_KEYS[e.key];
  if (step !== undefined) {
    // the level above or below, in either view; refused (and left to the page) at the ends
    if (inScrollingRegion(e.target)) return false;
    return pageActions.stepActiveLevel(step).ok;
  }
  const view = store.getState().editor.view;
  const tool = toolsFor(view).find((t) => keyOf(t.shortcut) === e.key.toLowerCase());
  if (!tool) return false;
  if (tool.runByKey) tool.runByKey(shell);
  else tool.run(shell);
  return true;
}

/** Listen for the shell's shortcuts for as long as the shell is mounted. */
export function useShellShortcuts(shell: ShellState): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (handleShellKey(e, shell)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell]);
}

export interface ShortcutRow {
  /** Kbd notation, one entry per alternative ("delete" or "backspace") */
  keys: readonly string[];
  /** the keys work together as a set (W A S D) rather than as alternatives */
  isSet?: boolean;
  /** or a pointer gesture, in words */
  gesture?: string;
  does: string;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

/** Everything the help dialog lists. Keep it true: each row names something the page does. */
export const SHORTCUT_SHEET: readonly ShortcutGroup[] = Object.freeze([
  {
    title: "Tools",
    rows: [
      ...toolsFor("2d").map((t) => ({ keys: [t.shortcut], does: t.label })),
      { keys: ["?"], does: "Show these shortcuts" },
    ],
  },
  {
    title: "Editing the plan",
    rows: [
      { keys: ["esc"], does: "Back to Select; while a room's outline is being drawn, drop the outline first" },
      { keys: ["esc"], does: "In Select, clear the selection" },
      { keys: [], gesture: "Right-click", does: "Back to Select" },
      { keys: ["shift"], does: "Hold while drawing walls to keep them straight" },
      { keys: [], gesture: "Drag a selected wall's end", does: "Move that end" },
      { keys: [], gesture: "Drag a selected wall's middle", does: "Bend it into an arc; back onto the straight line to straighten it" },
      { keys: [], gesture: "Draw a room: click each corner", does: "Draw any outline; click the first corner or double-click to close it (a drag still draws a rectangle)" },
      { keys: ["enter"], does: "With Draw a room, close the outline being drawn" },
      { keys: ["backspace"], does: "With Draw a room, take the last corner back" },
      { keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], isSet: true, does: `With Draw a room, move the cross ${cm(SNAP)} (with Shift, ${cm(SNAP * NUDGE_SHIFT_FACTOR)})` },
      { keys: ["c"], does: "With Draw a room, put a corner down at the cross" },
      { keys: [], gesture: "Drag a selected room's corner", does: "Move it; double-click a corner to remove it" },
      { keys: [], gesture: "Drag the middle of a selected room's edge", does: "Bend the edge; with Shift, add a corner there and move it" },
      { keys: [], gesture: "Properties → Shape", does: "Move, add and remove a room's corners and bend its edges from the keyboard" },
      { keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], isSet: true, does: `Nudge the selection ${cm(SNAP)} (with Shift, ${cm(SNAP * NUDGE_SHIFT_FACTOR)})` },
      { keys: ["delete", "backspace"], does: "Remove the selected wall, room, item, stair or column" },
      { keys: ["enter"], does: "While placing furniture, put one in the middle of the view, selected" },
      { keys: [], gesture: "Add a stair: press, then drag", does: "Start the stair where you press, climbing the way you drag" },
      { keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], isSet: true, does: "With Add a stair, choose the way it climbs (Enter puts it in the middle of the view)" },
      { keys: [], gesture: "Add a column: click", does: "Put a column down, pulled to a wall's corner or axis, or in line with another column" },
      { keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], isSet: true, does: `With Add a column, move the cross ${cm(SNAP)} (with Shift, ${cm(SNAP * NUDGE_SHIFT_FACTOR)})` },
      { keys: ["enter"], does: "With Add a column, put a column down at the cross" },
      { keys: [], gesture: "Properties → On the plan", does: "Select any wall, room, door, window, piece, stair or column from a list" },
      { keys: ["mod+z"], does: "Undo" },
    ],
  },
  {
    title: "Moving around the plan",
    rows: [
      { keys: [], gesture: "Scroll", does: "Zoom" },
      { keys: ["+", "-"], isSet: true, does: "Zoom in, zoom out" },
      { keys: ["shift+1"], does: "Fit the plan" },
      { keys: ["pageup", "pagedown"], does: "Work on the level above, or the one below (in 3D too)" },
      { keys: ["space"], does: "Hold and drag to pan, with any tool" },
      { keys: [], gesture: "Middle-drag, Alt+drag, or drag empty space in Select", does: "Pan" },
    ],
  },
  {
    title: "3D view",
    rows: [
      ...toolsFor("3d")
        .filter((t) => !t.id.startsWith("place-"))
        .map((t) => ({ keys: [t.shortcut], does: t.label })),
      { keys: ["w", "a", "s", "d"], isSet: true, does: "Walk, in Walk view (the arrow keys too)" },
      { keys: [], gesture: "Click a door", does: "Open or close it" },
      { keys: [], gesture: "Click a wall, room or piece", does: "Select it, as on the plan (from the keyboard: Properties, On the plan)" },
      { keys: ["delete"], does: "Remove what is selected, as on the plan (Ctrl Z undoes it)" },
      { keys: [], gesture: "View, beside the cameras", does: "Ink edges, and a cutaway at a height you set" },
      { keys: [], gesture: "Swing the doors, in the hint bar", does: "Open or close every door" },
      { keys: ["enter"], does: "While placing furniture, put it in the middle of the view" },
      { keys: ["esc"], does: "Stop placing furniture, or let go of the selection" },
    ],
  },
]);
