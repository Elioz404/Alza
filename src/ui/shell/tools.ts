/**
 * The tool rail's tools, each over an action that already exists: the editor's draw modes
 * (pageActions.setDrawMode), the 3D camera (pageActions.setCamera) and the Library (placing
 * furniture starts from a catalogue card). The rail shows the 2D set in Plan view and the 3D
 * set in 3D view, in the same place, in groups with a rule between them: moving around (Select,
 * Pan), drawing (Walls, Room, Door, Window, Stair), furnishing; in 3D the cameras, then furnishing.
 *
 * Pan, Add a door, Add a window and Add a stair are the editor's own tools (src/editor/canvasState.ts),
 * which sit beside the store's draw modes: while one is set the draw mode is "select".
 *
 * The shortcut is a single key in Kbd notation. 3D tools use digits: W, A, S and D walk.
 * The editor also listens for H, D, N, S and V while it is mounted and marks the key handled, so
 * the shell's listener stands aside; both do the same thing, so whichever runs first is right.
 * A tool that needs new editor behaviour (measure) is added here together with that behaviour,
 * never ahead of it.
 */

import { pageActions, type EditorState } from "../../model/store";
import { activeTool, setPlanTool, type PlanTool } from "../../editor/canvasState";
import { focusCanvasRegion } from "./ids";
import { DOOR_DEFAULTS, WINDOW_DEFAULTS, type CameraMode } from "../../model/limits";
import {
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
  /** whether the tool is in use, given the store's editor state and the editor's own tool */
  isActive(editor: EditorState, planTool: PlanTool | null): boolean;
  run(shell: ShellState): void;
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
    // the placing tools aim and place from the plan's keys (a stair: arrows aim, Enter places),
    // which the rail's own arrow keys would otherwise keep: focus goes to the plan
    if (PLACING_TOOLS.has(id)) focusCanvasRegion();
  },
});

/** The editor's tools that place something, from the pointer or from the plan's keys. */
const PLACING_TOOLS: ReadonlySet<PlanTool> = new Set<PlanTool>(["door", "window", "stair"]);

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
  planTool("pan", "Pan", "Drag to move the plan; Space-drag pans with any tool", IconPan, "h"),
  drawTool("wall", "Draw walls", "Click each corner; Esc or right-click ends the chain", IconWall, "w"),
  drawTool("room", "Draw a room", "Drag a rectangle", IconRoom, "r"),
  planTool("door", "Add a door", `Click a wall to place a ${metres(DOOR_DEFAULTS.width)} door`, IconDoor, "d"),
  planTool("window", "Add a window", `Click a wall to place a ${metres(WINDOW_DEFAULTS.width)} window`, IconWindow, "n"),
  planTool("stair", "Add a stair", "Press where it starts, drag the way it climbs", IconStair, "s"),
  furniture("2d"),
  cameraTool("orbit", "Orbit", "Drag to orbit, scroll to zoom", IconOrbit, "1"),
  cameraTool("top", "Top view", "Drag to pan", IconTop, "2"),
  cameraTool("walk", "Walk", "W A S D or the arrow keys to walk, drag to look", IconWalk, "3"),
  furniture("3d"),
]);

export const toolsFor = (view: "2d" | "3d"): readonly RailTool[] => RAIL_TOOLS.filter((t) => t.view === view);

