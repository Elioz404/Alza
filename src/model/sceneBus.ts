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
