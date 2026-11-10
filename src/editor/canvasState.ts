/**
 * The plan canvas's own state, outside any component: where the view looks (pan and zoom), the
 * size of the canvas, the tool the editor adds to the store's draw modes (pan, door, window),
 * and whether the agent's revision marks are shown.
 *
 * It lives here rather than in Editor.tsx so the canvas overlays (zoom, hint bar, legend) and
 * anything that projects the plan onto the screen read the same view, and so the view survives
 * a trip to the 3D view and back. It is page state only: nothing here changes the plan.
 */

import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import { pageActions, store } from "../model/store";
import { dispatch } from "../model/commands";
import type { PlanModel } from "../model/types";
import { catalogOf } from "../model/catalog";
import { bus, EVENTS } from "../model/sceneBus";
import { centreOf, type EntityRef } from "../ui/activity/entities";

/** The view: the world point at the canvas's top-left corner and the zoom, in pixels per metre. */
export interface PlanView {
  x: number;
  y: number;
  scale: number;
}

/**
 * Zoom limits and steps, in pixels per metre. The zoom readout is the scale itself as a
 * percentage of `unit`: 100% draws one metre as 100 pixels.
 */
export const ZOOM = Object.freeze({ min: 15, max: 600, step: 1.12, unit: 100, initial: 90 });

/** Shift multiplies an arrow-key nudge (one snap step) by this. */
export const NUDGE_SHIFT_FACTOR = 10;

/** How many of the agent's latest changes keep their revision marks on the drawing. */
export const RECENT_AGENT_REVISIONS = 5;

/** Room left around the plan when it is fitted to the canvas, in pixels: dimension chains sit there. */
const FIT_MARGIN_PX = 96;

/**
 * The tools the editor has beyond the store's draw modes. While one is set, the store's draw
 * mode is "select"; choosing a draw mode clears it.
 */
export type PlanTool = "pan" | "door" | "window";

/** The tool in use, whichever of the two places holds it. */
export type ActiveTool = "select" | "wall" | "room" | "place" | PlanTool;

export interface CanvasState {
  view: PlanView;
  /** the canvas in CSS pixels, once measured */
  size: { w: number; h: number } | null;
  /** whether the view has been placed for this page (fitted or moved by hand) */
  placed: boolean;
  tool: PlanTool | null;
  /** Space is held: dragging pans whatever the tool */
  spacePan: boolean;
  showAgentMarks: boolean;
  /** with the door or window tool over a wall: whether the opening fits there (null: not over a wall) */
  openingFits: boolean | null;
}

export const canvasStore = createStore<CanvasState>(() => ({
  view: { x: -1.5, y: -1.5, scale: ZOOM.initial },
  size: null,
  placed: false,
  tool: null,
  spacePan: false,
  showAgentMarks: true,
  openingFits: null,
}));

/** Read a slice of the canvas state from React. */
export function useCanvas<T>(select: (s: CanvasState) => T): T {
  return useSyncExternalStore(
    canvasStore.subscribe,
    () => select(canvasStore.getState()),
    () => select(canvasStore.getState()),
  );
}

const entityCount = (m: PlanModel): number => m.walls.length + m.rooms.length + m.items.length;

store.subscribe((s, prev) => {
  // choosing a draw mode (the rail, a shortcut, the Library) puts the editor's own tool down
  if (s.editor.drawMode !== prev.editor.drawMode && s.editor.drawMode !== "select" && canvasStore.getState().tool) {
    canvasStore.setState({ tool: null });
  }
  // a whole plan arriving on an empty sheet (the demo, a loaded plan) is shown whole; a first
  // wall or room drawn by hand is one entity and leaves the view where the hand is
  if (!canvasStore.getState().size) return;
  const loaded = s.activity !== prev.activity && s.activity.at(-1)?.tool === "load_model" && s.activity.at(-1)?.ok;
  if (loaded || (s.model !== prev.model && entityCount(prev.model) === 0 && entityCount(s.model) > 1)) fitPlan(s.model);
});

/** The tool in use: the editor's own when one is set, the store's draw mode otherwise. */
export const activeTool = (drawMode: ActiveTool, tool: PlanTool | null): ActiveTool => tool ?? drawMode;

/** Pick one of the editor's own tools (or none, which leaves the store's draw mode in charge). */
export function setPlanTool(tool: PlanTool | null): void {
  if (tool) pageActions.setDrawMode("select");
  canvasStore.setState({ tool });
}

export const usePlanTool = (): PlanTool | null => useCanvas((s) => s.tool);
export const getPlanTool = (): PlanTool | null => canvasStore.getState().tool;

export function setShowAgentMarks(on: boolean): void {
  canvasStore.setState({ showAgentMarks: on });
}

export function setOpeningFits(fits: boolean | null): void {
  if (canvasStore.getState().openingFits !== fits) canvasStore.setState({ openingFits: fits });
}

export function setSpacePan(on: boolean): void {
  if (canvasStore.getState().spacePan !== on) canvasStore.setState({ spacePan: on });
}

const clampScale = (s: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, s));

/** Move the view by hand. */
export function setView(next: PlanView | ((v: PlanView) => PlanView)): void {
  canvasStore.setState((s) => ({ view: typeof next === "function" ? next(s.view) : next, placed: true }));
}

/** The world point under a canvas pixel. */
export const worldAt = (view: PlanView, px: number, py: number): { x: number; y: number } => ({
  x: view.x + px / view.scale,
  y: view.y + py / view.scale,
});

/** The canvas pixel over a world point; for overlays that point at something on the plan. */
export const screenOf = (view: PlanView, x: number, y: number): { x: number; y: number } => ({
  x: (x - view.x) * view.scale,
  y: (y - view.y) * view.scale,
});

/** Zoom by `factor` keeping the canvas pixel (px, py) still; the canvas centre when not given. */
export function zoomBy(factor: number, px?: number, py?: number): void {
  const { size } = canvasStore.getState();
  const cx = px ?? (size ? size.w / 2 : 0);
  const cy = py ?? (size ? size.h / 2 : 0);
  setView((v) => {
    const scale = clampScale(v.scale * factor);
    const p = worldAt(v, cx, cy);
    return { scale, x: p.x - cx / scale, y: p.y - cy / scale };
  });
}

/** Zoom to an exact scale around the canvas centre. */
export const zoomTo = (scale: number): void => zoomBy(scale / canvasStore.getState().view.scale);

export const zoomIn = (): void => zoomBy(ZOOM.step);
export const zoomOut = (): void => zoomBy(1 / ZOOM.step);

/** The extent of everything drawn on the plan, in metres, or null for an empty plan. */
export function planBounds(model: PlanModel): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of model.walls) {
    xs.push(w.ax, w.bx);
    ys.push(w.ay, w.by);
  }
  for (const r of model.rooms) {
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  const catalog = catalogOf(model);
  for (const it of model.items) {
    const k = catalog.get(it.kind);
    const reach = k ? Math.hypot(k.w, k.d) / 2 : 0;
    xs.push(it.x - reach, it.x + reach);
    ys.push(it.y - reach, it.y + reach);
  }
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Fit the whole plan into the canvas, centred, with room for its dimensions. */
export function fitPlan(model: PlanModel = store.getState().model): void {
  const { size } = canvasStore.getState();
  const b = planBounds(model);
  if (!size || !b) {
    setView((v) => ({ ...v, scale: ZOOM.initial }));
    return;
  }
  const planW = Math.max(b.maxX - b.minX, 1);
  const planH = Math.max(b.maxY - b.minY, 1);
  const scale = clampScale(Math.min((size.w - 2 * FIT_MARGIN_PX) / planW, (size.h - 2 * FIT_MARGIN_PX) / planH));
  setView({
    x: b.minX - (size.w / scale - planW) / 2,
    y: b.minY - (size.h / scale - planH) / 2,
    scale,
  });
}

/** Record the canvas size; the first time, place the view on the plan. */
export function setCanvasSize(w: number, h: number): void {
  const s = canvasStore.getState();
  if (s.size && s.size.w === w && s.size.h === h) return;
  canvasStore.setState({ size: { w, h } });
  if (!s.placed && w > 0 && h > 0 && planBounds(store.getState().model)) fitPlan();
}

/**
 * Bring a point of the plan into view: when it is outside the canvas (less the fit margin), pan
 * so it sits in the middle. The zoom stays where the person left it.
 */
export function revealPoint(x: number, y: number): void {
  const { size, view } = canvasStore.getState();
  if (!size) return;
  const p = screenOf(view, x, y);
  const inside = p.x >= FIT_MARGIN_PX && p.x <= size.w - FIT_MARGIN_PX && p.y >= FIT_MARGIN_PX && p.y <= size.h - FIT_MARGIN_PX;
  if (inside) return;
  setView((v) => ({ ...v, x: x - size.w / 2 / v.scale, y: y - size.h / 2 / v.scale }));
}

// a panel (Issues, an Activity line) locates an entity: show it on the plan
bus.on(EVENTS.FOCUS_ENTITY, (payload) => {
  const ref = payload as EntityRef | undefined;
  if (!ref || typeof ref.id !== "string") return;
  const at = centreOf(store.getState().model, ref);
  if (at) revealPoint(at.x, at.y);
});

// ---------------------------------------------------------------------------- placing by key

/** The middle of the plan's extent, or the origin while it is empty. */
export function planCentre(model: PlanModel): { x: number; y: number } {
  const b = planBounds(model);
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
}

/**
 * Put the piece being placed down at (x, y) as the human, and select it, so the arrow keys
 * nudge it and Delete takes it out again: the keyboard's way to place, where the pointer
 * clicks. Placing ends with it. True when a piece went down.
 */
export function placeHeldPieceAt(x: number, y: number): boolean {
  const { drawMode, placingKind } = store.getState().editor;
  if (drawMode !== "place" || !placingKind) return false;
  const r = dispatch({ type: "place_item", kind: placingKind, x, y, rotation: 0 }, { actor: "human" });
  if (!r.ok) return false;
  pageActions.setDrawMode("select");
  if (typeof r.id === "string") pageActions.selectItem(r.id);
  return true;
}

/** Ask the view that is showing (the plan or the 3D view) to put the held piece in its middle. */
export const placeInMiddle = (): void => bus.emit(EVENTS.PLACE_AT_CENTRE);
