/** Domain model — all units are meters, plan lives on the XY plane (y grows downward in 2D view). */

export interface Wall {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thickness: number; // meters, e.g. 0.15
  height: number; // meters, e.g. 2.7
}

export type OpeningKind = "door" | "window";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  /** position along the wall, 0..1, measured to the CENTER of the opening */
  t: number;
  width: number; // meters (the clear span of the vano)
  sill: number; // height of the bottom edge (0 for doors, ~0.9 for windows)
  height: number; // clear height of the opening
  /** doors only — which jamb carries the hinges (default "a", the wall's A end) */
  hinge?: "a" | "b";
  /**
   * doors only — which side of the wall the leaf swings to, walking from the wall's
   * A endpoint to its B endpoint on the plan (default "right").
   */
  side?: "left" | "right";
}

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  floor: string; // floor finish key, e.g. "oak" | "tile" | "concrete" | "carpet"
}

export interface Item {
  id: string;
  kind: string; // catalog key
  x: number; // center
  y: number;
  rotation: number; // degrees, counterclockwise
}

export interface Underlay {
  dataUrl: string;
  opacity: number; // 0..1
  /** world-rect the image covers */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Pixel size of the copy THIS PAGE holds. The upload re-encodes to ≤1600 px, so it
   * rarely matches the file the human also pasted into their agent's conversation —
   * which is why get_underlay tells the agent to work in fractions, not pixels.
   */
  pw?: number;
  ph?: number;
}

/**
 * A destructive tool call an agent has asked for, parked until the human decides.
 * The WebMCP explainer flags user confirmation as an open question
 * (webmachinelearning/webmcp — "a way for a tool to prompt the user for confirmation");
 * this is Alza's answer to it.
 */
export interface PendingApproval {
  id: string;
  tool: string;
  /** plain-language sentence shown to the human */
  request: string;
  args: Record<string, unknown>;
  at: number;
}

export interface Note {
  id: string;
  author: "human" | "agent";
  text: string;
  at: number; // epoch ms
}

export interface PlanModel {
  name: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  underlay: Underlay | null;
}

export interface ActivityEntry {
  id: string;
  at: number;
  source: "human" | "agent" | "system";
  tool: string;
  summary: string;
  ok: boolean;
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  refs: string[]; // entity ids involved
}

export const emptyModel = (): PlanModel => ({
  name: "Untitled plan",
  walls: [],
  openings: [],
  rooms: [],
  items: [],
  underlay: null,
});
