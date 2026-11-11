/**
 * The tool rail's tools, each over an action that already exists: the editor's draw modes
 * (pageActions.setDrawMode), the 3D camera (pageActions.setCamera) and the Library (placing
 * furniture starts from a catalogue card). The rail shows the 2D set in Plan view and the 3D
 * set in 3D view, in the same place, in groups with a rule between them: moving around (Select,
 * Pan), drawing (Walls, Room, Door, Window, Stair), furnishing; in 3D the cameras, then furnishing.
 *
 * Pan, Add a door, Add a window, Add a stair and Add a column are the editor's own tools (src/editor/canvasState.ts),
 * which sit beside the store's draw modes: while one is set the draw mode is "select".
 *
 * The shortcut is a single key in Kbd notation. 3D tools use digits: W, A, S and D walk.
 * The editor also listens for H, D, N, S, P and V while it is mounted and marks the key handled, so
 * the shell's listener stands aside; both do the same thing, so whichever runs first is right.
 * A tool that needs new editor behaviour (measure) is added here together with that behaviour,
 * never ahead of it.
 */

import { pageActions, type EditorState } from "../../model/store";
import { activeTool, pickColumnToolByKey, setPlanTool, type PlanTool } from "../../editor/canvasState";
import { focusCanvasRegion } from "./ids";
import { COLUMN, DOOR_DEFAULTS, WINDOW_DEFAULTS, type CameraMode } from "../../model/limits";
import {
  IconColumn,
  IconDoor,
  IconFurniture,
  IconOrbit,
  IconPan,
  IconRoom,
  IconSelect,
  IconStair,
  IconTop,
  IconWalk,
  IconWall,
  IconWindow,
  type IconComponent,
} from "../primitives/icons";
import type { ShellState } from "./ShellContext";

export type RailGroup = "navigate" | "draw" | "camera" | "furnish";

export interface RailTool {
  id: string;
  label: string;
  /** what the tooltip adds under the label */
  hint?: string;
  icon: IconComponent;
  shortcut: string;
  view: "2d" | "3d";
  /** the rail draws a rule between two tools of different groups */
  group: RailGroup;
  /**
   * false for a tool the phone's rail leaves out, so every other one fits a 390 px screen whole:
   * Pan, since there a drag on empty paper with Select pans the plan (its key still works).
   */
  phone?: false;
  /** whether the tool is in use, given the store's editor state and the editor's own tool */
  isActive(editor: EditorState, planTool: PlanTool | null): boolean;
  run(shell: ShellState): void;
  /** picked by its key rather than pressed on the rail: what the keyboard's way of it needs (the column tool's cross) */
  runByKey?(shell: ShellState): void;
}

const drawTool = (id: "select" | "wall" | "room", label: string, hint: string, icon: IconComponent, shortcut: string): RailTool => ({
  id,
  label,
  hint,
  icon,
  shortcut,
  view: "2d",
  group: id === "select" ? "navigate" : "draw",
  isActive: (e, planTool) => activeTool(e.drawMode, planTool) === id,
  run: () => {
    setPlanTool(null);
    pageActions.setDrawMode(id);
    if (KEYBOARD_PLACING.has(id)) focusCanvasRegion();
  },
});

const planTool = (id: PlanTool, label: string, hint: string, icon: IconComponent, shortcut: string): RailTool => ({
  id,
  label,
  hint,
  icon,
  shortcut,
  view: "2d",
  group: id === "pan" ? "navigate" : "draw",
  isActive: (e, tool) => activeTool(e.drawMode, tool) === id,
  run: () => {
    setPlanTool(id);
    if (KEYBOARD_PLACING.has(id)) focusCanvasRegion();
  },
});

/**
 * The tools that place something from the plan's keys as well as the pointer: a door, a window
 * or a stair (arrows aim, Enter places), a column (arrows move the cross, Enter places), a room
 * drawn corner by corner (arrows move the cross, C puts a corner down, Enter closes). The rail's
 * own arrow keys and Enter would otherwise keep
 * those keys, so choosing one of them sends focus to the plan, whichever factory built it.
 */
const KEYBOARD_PLACING: ReadonlySet<string> = new Set<PlanTool | "room">(["door", "window", "stair", "column", "room"]);

const metres = (m: number) => `${m.toFixed(2)} m`;

const cameraTool = (mode: CameraMode, label: string, hint: string, icon: IconComponent, shortcut: string): RailTool => ({
  id: mode,
  label,
  hint,
  icon,
  shortcut,
  view: "3d",
  group: "camera",
  isActive: (e) => e.camera === mode,
  run: () => {
    pageActions.setCamera(mode);
  },
});

const furniture = (view: "2d" | "3d"): RailTool => ({
  id: `place-${view}`,
  label: "Place furniture",
  hint: "Pick a piece in the Library, then click the plan",
  icon: IconFurniture,
  shortcut: "f",
  view,
  group: "furnish",
  isActive: (e) => e.drawMode === "place",
  run: (shell) => shell.openPanel("library"),
});

export const RAIL_TOOLS: readonly RailTool[] = Object.freeze([
  drawTool("select", "Select", "Click to select, drag to move or pan", IconSelect, "v"),
  { ...planTool("pan", "Pan", "Drag to move the plan; Space-drag pans with any tool", IconPan, "h"), phone: false },
  drawTool("wall", "Draw walls", "Click each corner; Esc or right-click ends the chain", IconWall, "w"),
  drawTool("room", "Draw a room", "Drag a rectangle, or click corner by corner and press Enter", IconRoom, "r"),
  planTool("door", "Add a door", `Click a wall to place a ${metres(DOOR_DEFAULTS.width)} door`, IconDoor, "d"),
  planTool("window", "Add a window", `Click a wall to place a ${metres(WINDOW_DEFAULTS.width)} window`, IconWindow, "n"),
  planTool("stair", "Add a stair", "Press where it starts, drag the way it climbs", IconStair, "s"),
  {
    ...planTool("column", "Add a column", `Click to place a ${metres(COLUMN.defaults.size)} column; it snaps to walls and other columns' axes`, IconColumn, "p"),
    runByKey: () => {
      pickColumnToolByKey();
      focusCanvasRegion();
    },
  },
  furniture("2d"),
  cameraTool("orbit", "Orbit", "Drag to orbit, scroll to zoom", IconOrbit, "1"),
  cameraTool("top", "Top view", "Drag to pan", IconTop, "2"),
  cameraTool("walk", "Walk", "W A S D or the arrow keys to walk, drag to look", IconWalk, "3"),
  furniture("3d"),
]);

export const toolsFor = (view: "2d" | "3d"): readonly RailTool[] => RAIL_TOOLS.filter((t) => t.view === view);

/** The tools the rail shows: the view's, less those a phone's rail leaves out when it is one. */
export const railToolsFor = (view: "2d" | "3d", phone: boolean): readonly RailTool[] => toolsFor(view).filter((t) => !phone || t.phone !== false);

