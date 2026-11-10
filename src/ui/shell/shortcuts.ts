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
import { store } from "../../model/store";
import { SNAP } from "../../model/limits";
import { NUDGE_SHIFT_FACTOR } from "../../editor/canvasState";
import { isInsideOverlay, isTypingTarget } from "../keys";
import { toolsFor } from "./tools";
import type { ShellState } from "./ShellContext";

/** A length in whole centimetres, as the sheet writes a step. */
const cm = (m: number): string => `${Math.round(m * 100)} cm`;

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
  const view = store.getState().editor.view;
  const tool = toolsFor(view).find((t) => keyOf(t.shortcut) === e.key.toLowerCase());
  if (!tool) return false;
  tool.run(shell);
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
      { keys: ["esc"], does: "Back to Select, and cancel a room being drawn" },
      { keys: ["esc"], does: "In Select, clear the selection" },
      { keys: [], gesture: "Right-click", does: "Back to Select" },
      { keys: ["shift"], does: "Hold while drawing walls to keep them straight" },
      { keys: [], gesture: "Drag a selected wall's end", does: "Move that end" },
      { keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], isSet: true, does: `Nudge the selection ${cm(SNAP)} (with Shift, ${cm(SNAP * NUDGE_SHIFT_FACTOR)})` },
      { keys: ["delete", "backspace"], does: "Remove the selected wall, room or item" },
      { keys: ["enter"], does: "While placing furniture, put one in the middle of the view, selected" },
      { keys: [], gesture: "Properties → On the plan", does: "Select any wall, room, door, window or piece from a list" },
      { keys: ["mod+z"], does: "Undo" },
    ],
  },
  {
    title: "Moving around the plan",
    rows: [
      { keys: [], gesture: "Scroll", does: "Zoom" },
      { keys: ["+", "-"], isSet: true, does: "Zoom in, zoom out" },
      { keys: ["shift+1"], does: "Fit the plan" },
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
      { keys: [], gesture: "Swing the doors, in the hint bar", does: "Open or close every door" },
      { keys: ["enter"], does: "While placing furniture, put it in the middle of the view" },
      { keys: ["esc"], does: "Stop placing furniture" },
    ],
  },
]);
