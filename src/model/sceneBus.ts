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
  /** plan entities in the scene, and shared materials the scene holds */
  entities: number;
  materials: number;
}

/**
 * Where the mounted 3D view, if any, answers what it holds. The view sets `read` while it is
 * mounted and clears it when it goes; it is here, at the bottom layer, so the test hook can ask
 * without importing three.js into the page's first chunk.
 */
export const sceneProbe: { read: (() => SceneStats) | null } = { read: null };
