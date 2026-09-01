/** Tiny event bus so header buttons / tools can trigger scene-level actions (OBJ export, PNG snapshot, doors). */

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
  state: "open" | "closed" | "toggle";
  id?: string;
}
