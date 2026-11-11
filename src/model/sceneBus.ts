/**
 * Tiny event bus so header buttons and tools can ask the 3D scene for things that are not plan
 * changes: an OBJ export, a PNG snapshot, swinging the doors. It lives with the model, the
 * lowest layer, because both the tools and the UI emit on it and only the scene listens.
 */

import type { DoorState } from "./limits";

type Handler = (payload?: unknown) => void;

const handlers: Record<string, Handler[]> = {};

export const bus = {
  on(event: string, fn: Handler) {
    (handlers[event] ??= []).push(fn);
    return () => {
      handlers[event] = (handlers[event] ?? []).filter((f) => f !== fn);
    };
  },
  emit(event: string, payload?: unknown) {
    for (const fn of handlers[event] ?? []) fn(payload);
  },
};

export const EVENTS = {
  EXPORT_OBJ: "export-obj",
  EXPORT_PNG: "export-png",
  SET_DOORS: "set-doors",
  /** a panel locates an entity ({ type, id }): the plan brings it into view */
  FOCUS_ENTITY: "focus-entity",
  /** the keyboard's way to place: the view showing puts the held piece in its middle */
  PLACE_AT_CENTRE: "place-at-centre",
} as const;

export interface SetDoorsPayload {
  state: DoorState;
  id?: string;
}

/** What a mounted 3D view holds and has done, read by the scripts through the test hook. */
export interface SceneStats {
  /** WebGL contexts the page has created for 3D views, and how many of them are still live */
  contextsCreated: number;
  contextsLive: number;
  /** frames drawn since the view mounted */
  frames: number;
  /** the renderer's own count of geometries and textures it holds on the GPU */
  geometries: number;
  textures: number;
  programs: number;
  /** what the last frame drew: draw calls and triangles, its shadow pass included */
  drawCalls: number;
  triangles: number;
  /** plan entities in the scene, and shared materials the scene holds */
  entities: number;
  materials: number;
  /** the plan's marks on the model: the selection's outline, and the pending removals' hatches */
  marks: { selection: number; pending: number };
  /** what the agent is touching, outlined in its colour (the shared session) */
  agentMarks: number;
  /** the room names over the model, and how many of them show */
  labels: { total: number; shown: number };
  /** where the cutaway slices the walls (metres above the ground), null when it does not */
  cut: number | null;
  /** where the stairs stop: the underside of the slab over the topmost storey shown (metres up) */
  storeyTop: number | null;
  /** whether every corner of the storeys shown is inside the camera's frame */
  framed: boolean;
  /** whether the model is drawn with ink edges */
  edges: boolean;
  /** whether the camera is moving between modes */
  moving: boolean;
  /** the plan's levels, and the ids of those the view shows, ground first */
  levels: { total: number; shown: string[] };
  /** the stairs and the upper levels' floor slabs in the scene */
  stairs: number;
  slabs: number;
  /** walking: the level the walker is on, the height of the floor or tread under it, and its eye's; otherwise null */
  walker: { level: string; floor: number; eye: number } | null;
}

/** What the probe can find on the canvas. */
export type SceneLocatable = "wall" | "room" | "item" | "stair";

/**
 * Where the mounted 3D view, if any, answers what it holds, where an entity shows, and takes a
 * camera placed by a script. The view sets the members while it is mounted and clears them when
 * it goes; it is here, at the bottom layer, so the test hook can ask without importing three.js
 * into the page's first chunk.
 */
export const sceneProbe: SceneProbe = { read: null, locate: null, look: null, project: null, camera: null };

const frameListeners = new Set<() => void>();

/**
 * Hear every frame the mounted 3D view draws, right after it is drawn (the camera and the model
 * as the frame shows them): what places things over the canvas (the session's markers) follows
 * the view in the same frame, and does nothing while the view is at rest. Returns the way to stop.
 */
export function onSceneFrame(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** A frame was drawn (three/viewport.ts). */
export function sceneFrameDrawn(): void {
  for (const listener of frameListeners) listener();
}

/** Where an entity of the plan is on the 3D view's canvas: CSS pixels from its top left corner. */
export interface ScenePoint {
  x: number;
  y: number;
}

/** What the mounted 3D view answers the scripts while it is mounted (null members: none is). */
export interface SceneProbe {
  read: (() => SceneStats) | null;
  /**
   * Where a wall, room, piece or stair shows on the canvas: the middle of its top (a wall's, a
   * piece's) or of its floor (a room's), or null when it is not in the plan or behind the camera.
   */
  locate: ((type: SceneLocatable, id: string) => ScenePoint | null) | null;
  /** Put the camera at `position`, looking at `target` (metres, three.js axes), as a drag would leave it. */
  look: ((position: readonly [number, number, number], target: readonly [number, number, number]) => void) | null;
  /**
   * Where a point of the plan (metres) on the floor of a level, `up` metres over it, shows on the
   * canvas, or null when it is behind the camera: where the session's markers stand in 3D.
   */
  project: ((x: number, y: number, levelId: string | undefined, up: number) => ScenePoint | null) | null;
  /** Where the camera is and what it looks at, in plan metres: x and y on the plan, z up. */
  camera: (() => { eye: PlanSpacePoint; target: PlanSpacePoint }) | null;
}

/** A point over the plan: x and y on the plan, z up from the ground, metres. */
export interface PlanSpacePoint {
  x: number;
  y: number;
  z: number;
}
