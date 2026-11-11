/**
 * Editor: the 2D plan, drawn as a drafting sheet and edited in place.
 *
 * Walls in solid poché, openings cut through them (door leaves with their swing, windows with
 * their glass line), rooms with their floor and their name and area, furniture as plan symbols,
 * dimension chains with ticks outside the walls. Chained wall drawing, rooms, doors and windows
 * placed on a wall, furniture, stairs, columns, a blueprint underlay, 5 cm snap (and wall ends
 * snap to wall ends), pan and zoom.
 *
 * Columns are drawn as walls are, in solid poché: a column cut by the plan is structure in
 * section, and a column standing in a wall reads as one solid with it (the same fill and pen, so
 * no line is drawn where they overlap). No cross is drawn in it: on a plan a cross marks a void
 * (a shaft, an opening through the floor), never something solid. The column tool snaps a new
 * one to wall corners, wall axes, the other columns' axes and the grid (columns.ts
 * snapColumnPoint); the columns of a level are dimensioned axis to axis below and to the right
 * of its walls, as a structural grid is. An open space (a carport, a porch) carries a lighter
 * hatch, and a fine rim along its open sides, where no wall's poché marks its edge (SlabMarks.tsx);
 * a garage door is drawn with its
 * closed panels in the wall and, dashed, where they lie raised under the ceiling, with no swing;
 * the slab of the level above, where it stands over open ground here, is outlined in long
 * dashes, the convention for what is overhead (SlabMarks.tsx).
 *
 * It shows one level of the plan at a time, the one being worked on (activeLevelId), with the
 * level below drawn faintly underneath to line walls up with. A stair is drawn with its plan
 * symbol on the level it stands on, and its stairwell on the level it arrives at
 * (stairSymbol.ts). The agent's recent changes carry numbered revision clouds that match the activity
 * feed; whatever a pending destructive request would remove is hatched in the error colour.
 *
 * Every change goes through dispatch() as the human, the same path the agent's tools take; a drag
 * or a run of nudges is one gesture, so one undo step and one feed line. The view (pan, zoom) and
 * the editor's own tools live in canvasState.ts, where the canvas overlays read them too.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { activeLevelId, store, pageActions } from "../model/store";
import { levelBelow, levelInfo, levelSlice, stairGeometryIn, stairwellsOf } from "../model/levels";
import { stairGeometry, type StairGeometry } from "../model/stairs";
import { useAppStore } from "../ui/useAppStore";
import { dispatch, type Command } from "../model/commands";
import type { ApprovalTarget, Column, Item, Opening, PlanModel, Room, Stair, Wall } from "../model/types";
import { rectCorners, snap, segLen, segPoint, type Pt } from "../model/geometry";
import { clampOpeningT, doorLeaves, isGarageDoor, isOpenRoom, openingArcError, openingSpan, parkingClearance } from "../model/issues";
import { chordNormal, closestOnEdge, outlineAnchor, outlineBounds, outlinePath, outlineRect, roomArea, wallArc, wallEdge, wallLength, wallPointAt } from "../model/shapes";
import { columnAim, columnBox, columnFootprint, snapColumnPoint, type ColumnAim } from "../model/columns";
import { catalogOf } from "../model/catalog";
import { assetUrl } from "../model/assets";
import { agentMarks, provenance } from "../model/provenance";
import { useGesture } from "../ui/useGesture";
import { bus, EVENTS } from "../model/sceneBus";
import { isInsideOverlay, isTypingTarget } from "../ui/keys";
import { deselectAll, handleSelectionKey } from "./selectionKeys";
import { setHover, setPointer as sharePointer } from "../model/presence";
import {
  COLUMN,
  DEFAULT_FLOOR,
  DOOR_DEFAULTS,
  LEVEL_DEFAULTS,
  ROOM_SIZE,
  SNAP,
  STAIR,
  STAIR_DEFAULTS,
  WALL_DEFAULTS,
  WALL_MIN_LENGTH,
  WINDOW_DEFAULTS,
} from "../model/limits";
import {
  activeTool,
  canvasStore,
  fitPlan,
  placeColumnAt,
  placeHeldPieceAt,
  placeStairAt,
  setColumnCursor,
  pickColumnToolByKey,
  setCanvasSize,
  setOpeningFits,
  setPlanTool,
  setSpacePan,
  setStairRotation,
  setView,
  useCanvas,
  viewCentre,
  worldAt,
  zoomBy,
  zoomIn,
  zoomOut,
  ZOOM,
  RECENT_AGENT_REVISIONS,
  type ActiveTool,
  NUDGE_SHIFT_FACTOR,
} from "./canvasState";
import { furnitureSymbol, hasSymbol } from "./symbols";
import type { StairDrawingProps } from "./StairDrawing";
import { deferred } from "../ui/deferred";
import {
  ARROW_CLIMB,
  aimRotation,
  FLOOR_PATTERN,
  LETTER,
  MARK,
  chainStops,
  cloudPath,
  garageInside,
  deltaPath,
  footprintCorners,
  metres,
  bandPath,
  belowCut,
  openingCorners,
  pixelBox,
  polygonPoints,
  textWidth,
  wallCorners,
  wallOffsetAt,
  wallPathD,
  wallTone,
} from "./drawing";
import type { WallPocheProps } from "./WallPoche";
import type { ShapeHandlesProps } from "./ShapeHandles";
import type { SlabMarksProps } from "./SlabMarks";
import type { ColumnChainsProps, ColumnGhostProps, ColumnMarkProps } from "./ColumnMarks";
import { ColumnShape } from "./ColumnShape";
import { addDraftCorner, cancelRoomDraft, closeRoomDraft, draftError, draftOutline, moveRoomCursor, removeLastCorner } from "./roomDraft";

/** Canvas size assumed until the SVG has been laid out and measured. */
const UNMEASURED_CANVAS = { w: 1200, h: 800 } as const;

/**
 * A stair's plan symbol (StairDrawing.tsx), fetched after the first paint with the rest of
 * what it does not need: until it is here, and if it cannot be fetched, the stair is still
 * drawn, as its footprint's outline.
 */
const StairDrawing = deferred<StairDrawingProps>(
  "the stair symbols",
  () => import("./StairDrawing").then((m) => m.StairDrawing),
  ({ geometry, S, className }) => <StairOutline geometry={geometry} S={S} className={`${className} pl-stair-pending`} />,
);

/**
 * The shared session's layer (PlanPresence.tsx): the agent's marker and highlight, what it points
 * at, the other tabs' cursors. Fetched after the first paint; until then there is nothing to show.
 */
const PlanPresence = deferred<{ S: number; levelId: string }>(
  "the session's plan layer",
  () => import("./PlanPresence").then((m) => m.PlanPresence),
  () => null,
);

/**
 * The walls' mitred footprints (WallPoche.tsx), fetched after the first paint with the joints
 * they are worked out by; until then each wall is its centreline stroked to its thickness.
 */
const WallPoche = deferred<WallPocheProps>(
  "the walls' footprints",
  () => import("./WallPoche").then((m) => m.WallPoche),
  (props) => <WallStrokes {...props} />,
);

/**
 * A selected room's corner and edge handles, a selected wall's bend handle, and their measures
 * (ShapeHandles.tsx): fetched after the first paint. Until they are here a room still moves by
 * dragging it, and a wall's ends by theirs.
 */
const ShapeHandles = deferred<ShapeHandlesProps>(
  "the shape handles",
  () => import("./ShapeHandles").then((m) => m.ShapeHandles),
  () => null,
);

/**
 * The slab of the level above where it stands over open ground here, and the stretches of an
 * upper floor nothing carries (SlabMarks.tsx): fetched after the first paint with the floors'
 * outlines they are worked out from; until then they are not drawn.
 */
const SlabMarks = deferred<SlabMarksProps>(
  "the slabs' marks",
  () => import("./SlabMarks").then((m) => m.SlabMarks),
  () => null,
);

/**
 * The columns' marks beyond their poché (ColumnMarks.tsx): a selected or hovered column's outline
 * and section pill, the column tool's aim, the columns' axes dimensioned. Fetched after the first
 * paint; until they are here, columns are drawn, selected and placed without them.
 */
const columnMarks = () => import("./ColumnMarks");
const ColumnOutline = deferred<ColumnMarkProps & { className: string }>("the columns' outlines", () => columnMarks().then((m) => m.ColumnOutline), () => null);
const ColumnPill = deferred<ColumnMarkProps>("the columns' pills", () => columnMarks().then((m) => m.ColumnPill), () => null);
const ColumnGhost = deferred<ColumnGhostProps>("the column tool's aim", () => columnMarks().then((m) => m.ColumnGhost), () => null);
const ColumnChains = deferred<ColumnChainsProps>("the columns' dimensions", () => columnMarks().then((m) => m.ColumnChains), () => null);


const ARROWS: Readonly<Record<string, Pt>> = Object.freeze({
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
});

/** A point the pointer snapped to: the 5 cm grid, or the end of a wall. */
interface Snapped extends Pt {
  to: "grid" | "end";
}

/** Where the pointer is, in metres: as it is and as it snaps. */
interface Pointer {
  raw: Pt;
  at: Snapped;
}

/** With the door or window tool: the wall under the pointer and where the opening would go. */
interface OpeningAim {
  wall: Wall;
  /** null when the opening does not fit there */
  t: number | null;
  /** where along the wall the pointer is, for drawing a refused opening */
  rawT: number;
}

/** Is the key event aimed at a control that has its own use for Space or the arrows? */
const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("button, a[href], input, textarea, select, [contenteditable], [role]") !== null;

const nudgeCommand = (dx: number, dy: number): Command | null => {
  const { model, editor } = store.getState();
  if (editor.selectedColumnId) {
    // by the step from where it is: a column on a wall's axis keeps its offset from it
    const c = model.columns.find((i) => i.id === editor.selectedColumnId);
    return c ? { type: "move_column", id: c.id, x: c.x + dx, y: c.y + dy } : null;
  }
  if (editor.selectedStairId) {
    const st = model.stairs.find((i) => i.id === editor.selectedStairId);
    return st ? { type: "move_stair", id: st.id, x: snap(st.x + dx), y: snap(st.y + dy) } : null;
  }
  if (editor.selectedItemId) {
    const it = model.items.find((i) => i.id === editor.selectedItemId);
    return it ? { type: "move_item", id: it.id, x: snap(it.x + dx), y: snap(it.y + dy) } : null;
  }
  if (editor.selectedRoomId) {
    const r = model.rooms.find((i) => i.id === editor.selectedRoomId);
    if (!r) return null;
    // the outline moves by a step of the grid, so corners on the grid stay on it
    const b = outlineBounds(r.points);
    return { type: "update_room", id: r.id, patch: { x: b.x + snap(dx), y: b.y + snap(dy) } };
  }
  if (editor.selectedWallId) {
    const w = model.walls.find((i) => i.id === editor.selectedWallId);
    return w ? { type: "edit_wall", id: w.id, patch: { ax: snap(w.ax + dx), ay: snap(w.ay + dy), bx: snap(w.bx + dx), by: snap(w.by + dy) } } : null;
  }
  return null;
};


/** Put the held piece down in the middle of the plan as it is shown (Enter, or Library's button). */
const placeInView = (): boolean => {
  const c = viewCentre();
  return placeHeldPieceAt(c.x, c.y);
};

/**
 * The room tool's keys (roomDraft.ts): the arrows move the keyboard's cross a snap step (ten
 * with Shift), C puts a corner down at it, Enter closes the outline under way, Backspace takes its
 * last corner back. True when the key was the tool's.
 */
function handleRoomKey(e: KeyboardEvent): boolean {
  const draft = canvasStore.getState().roomDraft;
  if (e.key === "Backspace" && draft) return removeLastCorner();
  if (e.key === "Enter" && draft) {
    closeRoomDraft();
    return true;
  }
  const arrow = ARROWS[e.key];
  if (arrow) {
    const step = SNAP * (e.shiftKey ? NUDGE_SHIFT_FACTOR : 1);
    moveRoomCursor(arrow.x * step, arrow.y * step, viewCentre());
    return true;
  }
  if (e.key.toLowerCase() === "c" && !e.repeat) {
    const at = canvasStore.getState().roomCursor ?? viewCentre();
    canvasStore.setState({ roomCursor: at });
    addDraftCorner(at);
    return true;
  }
  return false;
}

/** Where the column tool would put a column for a point on the level being worked on: aimed as columns.ts says. */
const columnAimAt = (p: Pt): ColumnAim => {
  const s = store.getState();
  return columnAim(p, levelSlice(s.model, activeLevelId(s)));
};

/**
 * The column tool's keys: the arrows move its cross a snap step (ten with Shift), from the middle
 * of the view; Enter puts a column down where the cross is, pulled to a wall or another column's
 * axis as a click would be. The tool stays in hand. True when the key was the tool's.
 */
function handleColumnKey(e: KeyboardEvent): boolean {
  const arrow = ARROWS[e.key];
  if (arrow) {
    const step = SNAP * (e.shiftKey ? NUDGE_SHIFT_FACTOR : 1);
    const from = canvasStore.getState().columnCursor ?? viewCentre();
    setColumnCursor({ x: snap(from.x + arrow.x * step), y: snap(from.y + arrow.y * step) });
    return true;
  }
  if (e.key === "Enter") {
    const at = canvasStore.getState().columnCursor ?? viewCentre();
    const aim = columnAimAt(at);
    // a refusal is in the feed and the notice like any other change's; the cross stays to try again
    placeColumnAt(aim.x, aim.y);
    if (!canvasStore.getState().columnCursor) setColumnCursor(at);
    return true;
  }
  return false;
}

/** The stair the stair tool would add with its bottom riser at `at`, on a level `rise` metres high. */
const aimedStair = (at: Pt, rotation: number, levelId: string, rise: number): StairGeometry =>
  stairGeometry({ id: "aim", levelId, shape: STAIR_DEFAULTS.shape, x: at.x, y: at.y, rotation, width: STAIR.defaultWidth } satisfies Stair, rise);

export function Editor() {
  // the level being worked on: the plan shows its walls, rooms, pieces and stairs, over a ghost
  // of the level below, and the stairwells of the stairs that arrive from there
  const plan = useAppStore((s) => s.model);
  const levelId = useAppStore(activeLevelId);
  const model = levelSlice(plan, levelId);
  const below = levelBelow(plan, levelId);
  const ghost = below ? levelSlice(plan, below.level.id) : null;
  const wells = useMemo(() => stairwellsOf(plan, levelId), [plan, levelId]);
  const rise = levelInfo(plan, levelId)?.level.height ?? LEVEL_DEFAULTS.height;
  const editor = useAppStore((s) => s.editor);
  const approvals = useAppStore((s) => s.approvals);
  const revisions = useStore(provenance, (s) => s.revisions);
  const view = useCanvas((s) => s.view);
  const size = useCanvas((s) => s.size);
  const tool = useCanvas((s) => s.tool);
  const spacePan = useCanvas((s) => s.spacePan);
  const showAgentMarks = useCanvas((s) => s.showAgentMarks);
  const stairRotation = useCanvas((s) => s.stairRotation);
  const roomDraft = useCanvas((s) => s.roomDraft);
  const roomCursor = useCanvas((s) => s.roomCursor);
  const columnCursor = useCanvas((s) => s.columnCursor);

  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [dragRoom, setDragRoom] = useState<{ id: string; dx: number; dy: number; x0: number; y0: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ id: string; end: "a" | "b" } | null>(null);
  const [dragStair, setDragStair] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [dragColumn, setDragColumn] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [roomStart, setRoomStart] = useState<Pt | null>(null);
  /** with the stair tool: where the press went down, the stair's bottom riser */
  const [stairStart, setStairStart] = useState<Pt | null>(null);
  const [panning, setPanning] = useState<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const drag = useGesture();
  const nudge = useGesture();
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `plan-${name}-${uid}`;

  // The viewBox and the grid need the canvas size in pixels; observing it keeps the size in
  // state, where the overlays (zoom, scale bar) see it too. The first size places the view.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setCanvasSize(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom about the pointer. A native listener, so it can keep the page itself from zooming
  // on a trackpad pinch (which arrives as Ctrl+wheel).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // What the person points at, for the shared session (model/presence.ts): the entity under the
  // pointer (the pointer itself is told as it moves, and the part of the plan the canvas shows by
  // the session's layer, PlanPresence.tsx)
  useEffect(() => setHover(hoverId), [hoverId]);
  useEffect(
    () => () => {
      setHover(null);
      sharePointer(null);
    },
    [],
  );

  // ---- keyboard ----
  // Subscribed once: the handler reads the selection and the tool from the stores when a key is
  // pressed. (The rail's own letters, V W R F and ?, are the shell's: src/ui/shell/shortcuts.ts.)
  // It stands aside for a key typed into a field, pressed inside a dialog, a menu or a popover
  // (or while a modal dialog is open), and one something else already answered: an Escape that
  // closed a tooltip or kept a pending request is not also "back to Select".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || isInsideOverlay(e.target)) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      const roomTool = store.getState().editor.drawMode === "room" && !canvasStore.getState().tool;
      if (e.key === "Escape" && roomTool && canvasStore.getState().roomDraft) {
        // Esc drops the outline under way; another goes back to Select
        cancelRoomDraft();
        return;
      }
      if (roomTool && plain && !isControlTarget(e.target) && handleRoomKey(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        const { drawMode, pendingWallStart } = store.getState().editor;
        const hadTool = canvasStore.getState().tool;
        if (drawMode === "select" && !hadTool && !pendingWallStart) deselectAll();
        setPlanTool(null);
        pageActions.setDrawMode("select");
        setRoomStart(null);
        setStairStart(null);
        return;
      }
      // Delete removes the selection, Ctrl/Cmd+Z undoes: the same keys as in the 3D view
      if (handleSelectionKey(e)) return;
      if (!plain) return;
      if (e.key === "Enter" && !isControlTarget(e.target) && store.getState().editor.drawMode === "place") {
        // the keyboard's click: the piece goes in the middle of the view, selected for nudging
        e.preventDefault();
        placeInView();
        return;
      }
      if (canvasStore.getState().tool === "column" && !isControlTarget(e.target) && handleColumnKey(e)) {
        e.preventDefault();
        return;
      }
      if (canvasStore.getState().tool === "stair" && !isControlTarget(e.target)) {
        // the stair tool from the keyboard: the arrows aim it, Enter puts it in the middle of the view
        if (e.key === "Enter") {
          e.preventDefault();
          const c = viewCentre();
          placeStairAt(c.x, c.y);
          return;
        }
        const climb = ARROW_CLIMB[e.key];
        if (climb !== undefined) {
          e.preventDefault();
          setStairRotation(climb);
          return;
        }
      }
      const arrow = ARROWS[e.key];
      if (arrow && !isControlTarget(e.target)) {
        const step = SNAP * (e.shiftKey ? NUDGE_SHIFT_FACTOR : 1);
        const command = store.getState().editor.drawMode === "select" ? nudgeCommand(arrow.x * step, arrow.y * step) : null;
        if (command) {
          e.preventDefault();
          nudge.update(command);
        }
        return;
      }
      if (e.key === " " && !isControlTarget(e.target)) {
        e.preventDefault();
        setSpacePan(true);
        return;
      }
      if (e.code === "Digit1" && e.shiftKey) {
        e.preventDefault();
        fitPlan();
        return;
      }
      if (e.repeat) return;
      switch (e.key.toLowerCase()) {
        case "h":
          setPlanTool("pan");
          break;
        case "d":
          setPlanTool("door");
          break;
        case "n":
          setPlanTool("window");
          break;
        case "s":
          setPlanTool("stair");
          break;
        case "p":
          pickColumnToolByKey();
          break;
        case "v":
          // the same as the rail's Select (src/ui/shell/tools.ts), whichever listener runs first
          setPlanTool(null);
          pageActions.setDrawMode("select");
          break;
        case "+":
        case "=":
          zoomIn();
          break;
        case "-":
        case "_":
          zoomOut();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpacePan(false);
      if (ARROWS[e.key]) nudge.end(); // a run of nudges is one step, one feed line
    };
    const onBlur = () => {
      setSpacePan(false);
      nudge.end();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const offPlace = bus.on(EVENTS.PLACE_AT_CENTRE, placeInView);
    return () => {
      offPlace();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setSpacePan(false);
      setOpeningFits(null);
    };
  }, [nudge]);

  const S = view.scale;
  const canvas = size && size.w > 0 ? size : UNMEASURED_CANVAS;
  const tool$: ActiveTool = activeTool(editor.drawMode, tool);
  const selecting = tool$ === "select" && !spacePan;
  const catalog = useMemo(() => catalogOf(model), [model]);
  const wallById = useMemo(() => new Map(model.walls.map((w) => [w.id, w])), [model.walls]);

  const toWorld = (clientX: number, clientY: number): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return worldAt(canvasStore.getState().view, clientX - rect.left, clientY - rect.top);
  };

  /** Snap a point: to a wall end within reach (except the one being dragged), else the grid. */
  const snapPoint = (p: Pt, skip?: { id: string; end: "a" | "b" }): Snapped => {
    const reach = MARK.snapReach / S;
    let best: Snapped | null = null;
    let bestD = reach;
    // the corners of an outline being drawn (its first closes it), then the walls' ends
    for (const q of roomDraft ?? []) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { x: q.x, y: q.y, to: "end" };
      }
    }
    for (const w of model.walls) {
      for (const end of ["a", "b"] as const) {
        if (skip && skip.id === w.id && skip.end === end) continue;
        const q = end === "a" ? { x: w.ax, y: w.ay } : { x: w.bx, y: w.by };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= bestD) {
          bestD = d;
          best = { ...q, to: "end" };
        }
      }
    }
    return best ?? { x: snap(p.x), y: snap(p.y), to: "grid" };
  };

  /** Shift keeps a wall straight: the end follows the dominant axis from the start. */
  const straighten = (from: Pt, p: Snapped, shift: boolean): Snapped => {
    if (!shift) return p;
    return Math.abs(p.x - from.x) >= Math.abs(p.y - from.y) ? { x: p.x, y: from.y, to: "grid" } : { x: from.x, y: p.y, to: "grid" };
  };

  const aimOpening = (p: Pt): OpeningAim | null => {
    if (tool$ !== "door" && tool$ !== "window") return null;
    let best: Wall | null = null;
    let bestD = Infinity;
    let bestT = 0;
    for (const w of model.walls) {
      const near = closestOnEdge(wallEdge(w), p);
      if (near.distance < bestD && near.distance <= w.thickness / 2 + MARK.hitReach / S) {
        best = w;
        bestD = near.distance;
        bestT = near.t;
      }
    }
    if (!best) return null;
    // along the centreline (an arc's length on a curved wall), snapped to the grid's step
    const len = wallLength(best);
    const rawT = Math.min(1, Math.max(0, snap(bestT * len) / len));
    const kind = tool$ === "door" ? "door" : "window";
    const width = kind === "door" ? DOOR_DEFAULTS.width : WINDOW_DEFAULTS.width;
    // a straight leaf or pane that would stand out of a tight bend does not fit either
    const fits = openingArcError(best, width, kind) === null;
    return { wall: best, t: fits ? clampOpeningT(best, width, rawT) : null, rawT };
  };

  const aim = pointer ? aimOpening(pointer.raw) : null;

  const capture = (e: React.PointerEvent) => {
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic or already-released pointer: the drag still works while the pointer stays over the plan
    }
  };

  // ---- pointer handlers ----
  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toWorld(e.clientX, e.clientY);
    sharePointer(raw);
    let at = snapPoint(raw, dragEnd ?? undefined);
    if (editor.drawMode === "wall" && editor.pendingWallStart) at = straighten(editor.pendingWallStart, at, e.shiftKey);
    setPointer({ raw, at });
    const target = aimOpening(raw);
    setOpeningFits(target ? target.t !== null : null);
    // the column tool follows whichever moved last: the pointer, or the keyboard's cross
    if (tool$ === "column" && canvasStore.getState().columnCursor) setColumnCursor(null);
    if (panning) {
      setView((v) => ({
        ...v,
        x: panning.vx - (e.clientX - panning.px) / v.scale,
        y: panning.vy - (e.clientY - panning.py) / v.scale,
      }));
      return;
    }
    if (stairStart && Math.hypot(raw.x - stairStart.x, raw.y - stairStart.y) * S >= MARK.stairAim) setStairRotation(aimRotation(stairStart, raw));
    if (dragStair) drag.update({ type: "move_stair", id: dragStair.id, x: snap(raw.x - dragStair.dx), y: snap(raw.y - dragStair.dy) });
    if (dragItem) drag.update({ type: "move_item", id: dragItem.id, x: snap(raw.x - dragItem.dx), y: snap(raw.y - dragItem.dy) });
    if (dragColumn) {
      // pulled to the walls and the other columns' axes as a new one is, never to itself
      const to = snapColumnPoint({ x: raw.x - dragColumn.dx, y: raw.y - dragColumn.dy }, model, COLUMN.snap, dragColumn.id);
      drag.update({ type: "move_column", id: dragColumn.id, x: to.x, y: to.y });
    }
    if (dragRoom) {
      // moved by whole grid steps from where it was picked up, so corners on the grid stay on it
      const patch = { x: dragRoom.x0 + snap(raw.x - dragRoom.dx - dragRoom.x0), y: dragRoom.y0 + snap(raw.y - dragRoom.dy - dragRoom.y0) };
      drag.update({ type: "update_room", id: dragRoom.id, patch });
    }
    if (dragEnd) {
      const patch = dragEnd.end === "a" ? { ax: at.x, ay: at.y } : { bx: at.x, by: at.y };
      drag.update({ type: "edit_wall", id: dragEnd.id, patch });
    }
  };

  const startPan = (e: React.PointerEvent) => {
    const v = canvasStore.getState().view;
    setPanning({ px: e.clientX, py: e.clientY, vx: v.x, vy: v.y });
    capture(e);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const raw = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && e.altKey) || spacePan || tool$ === "pan") {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (editor.drawMode === "wall") {
      const start = editor.pendingWallStart;
      const sp = start ? straighten(start, snapPoint(raw), e.shiftKey) : snapPoint(raw);
      if (!start) {
        pageActions.setPendingWallStart({ x: sp.x, y: sp.y });
      } else if (Math.hypot(sp.x - start.x, sp.y - start.y) >= WALL_MIN_LENGTH) {
        // the store's own minimum, so a click it would refuse is not sent and one it accepts is not skipped
        dispatch({ type: "add_wall", ax: start.x, ay: start.y, bx: sp.x, by: sp.y }, { actor: "human" });
        pageActions.setPendingWallStart({ x: sp.x, y: sp.y }); // chain
      }
      return;
    }
    if (editor.drawMode === "room") {
      const sp = snapPoint(raw);
      // an outline under way takes each click as its next corner; otherwise the press may be
      // the start of a rectangle's drag, or (let go where it went down) an outline's first corner
      if (roomDraft) addDraftCorner({ x: sp.x, y: sp.y });
      else {
        setRoomStart({ x: sp.x, y: sp.y });
        capture(e);
      }
      return;
    }
    if (editor.drawMode === "place" && editor.placingKind) {
      const sp = snapPoint(raw);
      dispatch({ type: "place_item", kind: editor.placingKind, x: sp.x, y: sp.y, rotation: 0 }, { actor: "human" });
      return;
    }
    if (tool$ === "stair") {
      // where the press goes down is the bottom riser; dragging away from it aims the climb
      const sp = snapPoint(raw);
      setStairStart({ x: sp.x, y: sp.y });
      capture(e);
      return;
    }
    if (tool$ === "column") {
      const at = columnAim(raw, model);
      placeColumnAt(at.x, at.y);
      return;
    }
    if (tool$ === "door" || tool$ === "window") {
      const target = aimOpening(raw);
      if (target && target.t !== null) dispatch({ type: tool$ === "door" ? "add_door" : "add_window", wallId: target.wall.id, t: target.t }, { actor: "human" });
      return;
    }
    // select: a click on empty paper clears the selection, a drag on it pans
    deselectAll();
    startPan(e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panning) setPanning(null);
    if (dragItem || dragRoom || dragEnd || dragStair || dragColumn) {
      drag.end(); // the whole drag: one undo step, one line in the feed (nothing, if it never moved)
      setDragItem(null);
      setDragRoom(null);
      setDragEnd(null);
      setDragStair(null);
      setDragColumn(null);
    }
    if (stairStart) {
      placeStairAt(stairStart.x, stairStart.y);
      setStairStart(null);
    }
    if (roomStart) {
      const sp = snapPoint(toWorld(e.clientX, e.clientY));
      const x = Math.min(roomStart.x, sp.x);
      const y = Math.min(roomStart.y, sp.y);
      const w = Math.abs(sp.x - roomStart.x);
      const h = Math.abs(sp.y - roomStart.y);
      if (w >= ROOM_SIZE.min && h >= ROOM_SIZE.min) {
        dispatch({ type: "add_room", x, y, w, h, label: `Room ${model.rooms.length + 1}`, floor: DEFAULT_FLOOR }, { actor: "human" });
      } else if (sp.x === roomStart.x && sp.y === roomStart.y) {
        // a click, not a drag: the first corner of an outline drawn corner by corner
        addDraftCorner(roomStart);
      }
      setRoomStart(null);
    }
  };

  const onWallDown = (w: Wall, e: React.PointerEvent) => {
    if (!selecting || e.button !== 0 || e.altKey) return; // other tools receive the press
    e.stopPropagation();
    pageActions.selectWall(w.id);
  };

  const onEndDown = (id: string, end: "a" | "b", e: React.PointerEvent) => {
    if (!selecting || e.button !== 0) return;
    e.stopPropagation();
    setDragEnd({ id, end });
    capture(e);
  };

  const onItemDown = (id: string, e: React.PointerEvent) => {
    if (!selecting || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    pageActions.selectItem(id);
    const p = toWorld(e.clientX, e.clientY);
    const it = model.items.find((i) => i.id === id)!;
    setDragItem({ id, dx: p.x - it.x, dy: p.y - it.y });
    capture(e);
  };

  const onStairDown = (id: string, e: React.PointerEvent) => {
    if (!selecting || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    pageActions.selectStair(id);
    const p = toWorld(e.clientX, e.clientY);
    const st = model.stairs.find((s) => s.id === id)!;
    setDragStair({ id, dx: p.x - st.x, dy: p.y - st.y });
    capture(e);
  };

  const onColumnDown = (id: string, e: React.PointerEvent) => {
    if (!selecting || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    pageActions.selectColumn(id);
    const p = toWorld(e.clientX, e.clientY);
    const c = model.columns.find((x) => x.id === id)!;
    setDragColumn({ id, dx: p.x - c.x, dy: p.y - c.y });
    capture(e);
  };

  const onRoomDown = (id: string, e: React.PointerEvent) => {
    if (!selecting || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    pageActions.selectRoom(id);
    const p = toWorld(e.clientX, e.clientY);
    const room = model.rooms.find((r) => r.id === id)!;
    const b = outlineBounds(room.points);
    setDragRoom({ id, dx: p.x - b.x, dy: p.y - b.y, x0: b.x, y0: b.y });
    capture(e);
  };

  const hover = (id: string) => ({
    onPointerEnter: () => setHoverId(id),
    onPointerLeave: () => setHoverId((h) => (h === id ? null : h)),
  });

  // ---- what the drawing marks ----
  const marks = useMemo(() => (showAgentMarks ? agentMarks(revisions, RECENT_AGENT_REVISIONS) : []), [revisions, showAgentMarks]);
  const pending = useMemo(() => {
    const byId = new Map<string, { target: ApprovalTarget; removal: boolean }>();
    // a file a request would download is no entity of the plan, whatever its name
    for (const a of approvals) for (const t of a.targets) if (t.type !== "file") byId.set(t.id, { target: t, removal: a.tool.startsWith("remove") || a.tool.startsWith("clear") });
    return byId;
  }, [approvals]);
  const planPending = [...pending.values()].some((p) => p.target.type === "plan");

  // ---- rendering helpers ----
  const underlayUrl = model.underlay ? assetUrl(model.underlay.assetId) : null;
  const left = view.x * S;
  const top = view.y * S;

  const renderOpening = (o: Opening): ReactNode => {
    const wall = wallById.get(o.wallId);
    if (!wall) return null;
    return <OpeningSymbol key={o.id} wall={wall} opening={o} rooms={model.rooms} S={S} />;
  };

  const rugsFirst = [...model.items].sort((a, b) => Number(catalog.get(b.kind)?.isRug ?? false) - Number(catalog.get(a.kind)?.isRug ?? false));

  const selectedWall = editor.selectedWallId ? wallById.get(editor.selectedWallId) : undefined;
  const selectedRoom = editor.selectedRoomId ? model.rooms.find((r) => r.id === editor.selectedRoomId) : undefined;
  const selectedItem = editor.selectedItemId ? model.items.find((i) => i.id === editor.selectedItemId) : undefined;
  const selectedStair = editor.selectedStairId ? model.stairs.find((s) => s.id === editor.selectedStairId) : undefined;
  const selectedStairGeometry = selectedStair ? stairGeometryIn(plan, selectedStair) : null;
  const hoveredStair = hoverId && selecting && hoverId !== editor.selectedStairId ? model.stairs.find((s) => s.id === hoverId) : undefined;
  const hoveredStairGeometry = hoveredStair ? stairGeometryIn(plan, hoveredStair) : null;
  // with no pointer over the plan (the keyboard's way), the aim shows where Enter would put it
  const stairAt = stairStart ?? (pointer ? pointer.at : tool$ === "stair" ? viewCentre() : null);
  const aimed = tool$ === "stair" && stairAt && !panning ? aimedStair(stairAt, stairRotation, levelId, rise) : null;
  const hoveredWall = hoverId && selecting && hoverId !== editor.selectedWallId ? wallById.get(hoverId) : undefined;
  const selectedColumn = editor.selectedColumnId ? model.columns.find((c) => c.id === editor.selectedColumnId) : undefined;
  const hoveredColumn = hoverId && selecting && hoverId !== editor.selectedColumnId ? model.columns.find((c) => c.id === hoverId) : undefined;
  // the column tool's aim: the keyboard's cross while the arrows move it, else where the pointer is
  const columnAt = tool$ === "column" && !panning ? (columnCursor ?? pointer?.raw ?? null) : null;
  const aimedColumn = columnAt ? columnAim(columnAt, model) : null;

  const placing = editor.drawMode === "place" && editor.placingKind ? catalog.get(editor.placingKind) : undefined;
  const drawing = tool$ === "wall" || tool$ === "room" || tool$ === "place" || tool$ === "stair";
  const parkingOf = (it: Item | undefined) => {
    const k = it ? catalog.get(it.kind) : undefined;
    return it && k?.parking ? parkingCorners(it.x, it.y, k.w, k.d, it.rotation) : null;
  };
  const selectedParking = parkingOf(selectedItem);

  return (
    <svg
      ref={svgRef}
      className="editor-svg"
      data-tool={spacePan ? "pan" : tool$}
      data-panning={panning ? "" : undefined}
      viewBox={`${left} ${top} ${canvas.w} ${canvas.h}`}
      role="img"
      aria-label={planDescription(model, plan.levels.length > 1 ? (levelInfo(plan, levelId)?.level.name ?? null) : null)}
      data-level={levelId}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        if (panning || dragItem || dragRoom || dragEnd || dragStair || dragColumn || stairStart) return;
        sharePointer(null);
        setPointer(null);
        setOpeningFits(null);
      }}
      onDoubleClick={() => {
        // the room tool: a double-click puts the last corner down (its first click did) and closes the outline
        if (editor.drawMode === "room" && roomDraft) closeRoomDraft();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setPlanTool(null);
        pageActions.setDrawMode("select");
      }}
    >
      <PlanPatterns refOf={ref} S={S} />
      <rect className="pl-paper" x={left} y={top} width={canvas.w} height={canvas.h} />
      {S / 2 >= MARK.minorGrid ? <rect x={left} y={top} width={canvas.w} height={canvas.h} fill={`url(#${ref("grid-minor")})`} /> : null}
      <rect x={left} y={top} width={canvas.w} height={canvas.h} fill={`url(#${ref("grid-major")})`} />

      {/* blueprint underlay */}
      {underlayUrl && model.underlay && (
        <image
          href={underlayUrl}
          x={model.underlay.x * S}
          y={model.underlay.y * S}
          width={model.underlay.w * S}
          height={model.underlay.h * S}
          opacity={model.underlay.opacity}
          preserveAspectRatio="none"
        />
      )}

      {/* rooms: the floor */}
      {model.rooms.map((r) => (
        <g key={r.id} className="pl-room" data-selected={editor.selectedRoomId === r.id || undefined} onPointerDown={(e) => onRoomDown(r.id, e)} {...hover(r.id)}>
          <path className={`pl-floor pl-floor--${r.floor}`} d={outlinePath(r.points, S)} fill={floorFill(r, ref)} />
          {isOpenRoom(r) ? (
            <path data-open-space="" d={outlinePath(r.points, S)} fill={`url(#${ref("open")})`} />
          ) : null}
          {pending.has(r.id) ? <path className="pl-pending" d={outlinePath(r.points, S)} fill={`url(#${ref("hatch")})`} /> : null}
        </g>
      ))}

      {/* an open space's open sides: its floor's edge, where no wall closes it off */}
      <SlabMarks plan={plan} levelId={levelId} S={S} hatch={`url(#${ref("warn")})`} part="open" />

      {/* the level above's slab, where it stands over open ground here: its edge, dashed */}
      <SlabMarks plan={plan} levelId={levelId} S={S} hatch={`url(#${ref("warn")})`} part="overhead" />

      {/* the level below, faintly, to line this one up with */}
      {ghost ? <GhostLevel model={ghost} S={S} /> : null}

      {/* stairwells: the stairs arriving from below, seen through the void in this floor */}
      {wells.map(({ stair, geometry }) => (
        <StairDrawing key={`well:${stair.id}`} geometry={geometry} side="upper" S={S} className="pl-stair pl-stair--well" />
      ))}

      {/* stairs on this level */}
      {model.stairs.map((st) => {
        const g = stairGeometryIn(plan, st);
        if (!g) return null;
        return (
          <g key={st.id} className="pl-stair-hit" data-stair={st.id} onPointerDown={(e) => onStairDown(st.id, e)} {...hover(st.id)}>
            <StairDrawing geometry={g} side="lower" S={S} className={editor.selectedStairId === st.id ? "pl-stair pl-stair--selected" : "pl-stair"} />
            {pending.has(st.id) ? <StairOutline geometry={g} S={S} className="pl-pending" fill={`url(#${ref("hatch")})`} /> : null}
          </g>
        );
      })}

      {/* furniture */}
      {rugsFirst.map((it) => {
        const k = catalog.get(it.kind);
        if (!k) return null;
        return (
          <g
            key={it.id}
            className="pl-item"
            transform={`translate(${it.x * S} ${it.y * S}) rotate(${-it.rotation})`}
            onPointerDown={(e) => onItemDown(it.id, e)}
            {...hover(it.id)}
          >
            {furnitureSymbol(it.kind, k.w, k.d, S)}
            <ItemLabel item={it} label={k.label} w={k.w} d={k.d} S={S} always={!hasSymbol(it.kind)} />
          </g>
        );
      })}

      {/* walls: solid poché, the selected one in the selection colour, on top */}
      <WallPoche walls={model.walls} S={S} selectedId={editor.selectedWallId} hoverId={selecting ? hoverId : null} />
      {model.walls.map((w) => (
        <g key={w.id} className="pl-wall-hit" data-wall={w.id} onPointerDown={(e) => onWallDown(w, e)} {...hover(w.id)}>
          <path className="pl-hit" d={wallPathD(w, S)} strokeWidth={Math.max(2 * MARK.hitReach, w.thickness * S)} />
        </g>
      ))}

      {/* columns: solid poché, one solid with a wall they stand in; each takes a press within a touch target */}
      {model.columns.map((c) => (
        <g key={c.id} className="pl-column-hit" data-column={c.id} onPointerDown={(e) => onColumnDown(c.id, e)} {...hover(c.id)}>
          <ColumnReach column={c} S={S} />
          <ColumnShape column={c} S={S} className={`pl-column ${c.id === editor.selectedColumnId ? "pl-column--selected" : selecting && c.id === hoverId ? "pl-column--hover" : ""}`} />
        </g>
      ))}

      {/* openings, cut through their walls */}
      <g className="pl-openings">{model.openings.map(renderOpening)}</g>

      {/* room lettering */}
      <g className="pl-letters">
        {model.rooms.map((r) => (
          <RoomLabel key={r.id} room={r} S={S} flag={pending.get(r.id)?.removal ? "Removal pending" : pending.has(r.id) ? "Change pending" : null} />
        ))}
      </g>

      {/* dimension chains outside the walls; the columns' axes below and to the right */}
      <DimensionChains walls={model.walls} S={S} />
      <ColumnChains columns={model.columns} walls={model.walls} S={S} />

      {/* a stretch of this floor nothing under it carries (Issues: slab_unsupported), over what stands on it */}
      <SlabMarks plan={plan} levelId={levelId} S={S} hatch={`url(#${ref("warn")})`} part="unsupported" />

      {/* pending destructive requests: the target hatched and outlined in the error colour */}
      <g className="pl-pending-marks">
        {[...pending.values()].map(({ target }) => (
          <PendingMark key={`${target.type}:${target.id}`} target={target} model={model} wallById={wallById} S={S} hatch={`url(#${ref("hatch")})`} />
        ))}
        {planPending || pending.has(levelId) ? <PlanPendingMark model={model} S={S} /> : null}
      </g>

      {/* selection */}
      {selectedRoom ? <path className="pl-sel-outline" d={outlinePath(selectedRoom.points, S)} /> : null}
      {selectedItem && catalog.get(selectedItem.kind) ? (
        <ItemOutline item={selectedItem} w={catalog.get(selectedItem.kind)!.w} d={catalog.get(selectedItem.kind)!.d} S={S} className="pl-sel-outline" />
      ) : null}
      {hoverId && selecting && hoverId !== editor.selectedItemId && model.items.some((i) => i.id === hoverId)
        ? (() => {
            const it = model.items.find((i) => i.id === hoverId)!;
            const k = catalog.get(it.kind);
            return k ? <ItemOutline item={it} w={k.w} d={k.d} S={S} className="pl-hover-outline" /> : null;
          })()
        : null}
      {selectedParking ? <polygon className="pl-parking" points={polygonPoints(selectedParking, S)} /> : null}
      {selectedColumn ? <ColumnOutline column={selectedColumn} S={S} className="pl-sel-outline" /> : null}
      {selectedColumn ? <ColumnPill column={selectedColumn} S={S} /> : null}
      {hoveredColumn ? <ColumnOutline column={hoveredColumn} S={S} className="pl-hover-outline" /> : null}
      {selectedStairGeometry ? <StairOutline geometry={selectedStairGeometry} S={S} className="pl-sel-outline" /> : null}
      {hoveredStairGeometry ? <StairOutline geometry={hoveredStairGeometry} S={S} className="pl-hover-outline" /> : null}
      {hoveredWall ? <WallPill wall={hoveredWall} S={S} tone="quiet" /> : null}
      {selecting && (selectedRoom || selectedWall) ? (
        <ShapeHandles room={selectedRoom} wall={selectedWall} S={S} toWorld={toWorld} snapPoint={(p) => snapPoint(p)} />
      ) : null}
      {selectedWall ? (
        <g className="pl-selection">
          <WallPill wall={selectedWall} S={S} tone="selection" />
          {(["a", "b"] as const).map((end) => {
            const x = (end === "a" ? selectedWall.ax : selectedWall.bx) * S;
            const y = (end === "a" ? selectedWall.ay : selectedWall.by) * S;
            return (
              <g key={end} className="pl-handle-hit" onPointerDown={(e) => onEndDown(selectedWall.id, end, e)}>
                <rect className="pl-handle-reach" x={x - MARK.hitReach} y={y - MARK.hitReach} width={2 * MARK.hitReach} height={2 * MARK.hitReach} />
                <rect className="pl-handle" x={x - MARK.handle / 2} y={y - MARK.handle / 2} width={MARK.handle} height={MARK.handle} rx={MARK.handleRadius} />
              </g>
            );
          })}
        </g>
      ) : null}

      {/* the agent's recent changes: a revision cloud and its number, as in the activity feed */}
      <g className="pl-revisions">
        {marks.map((m) => {
          const box = markBox(m.id, model, wallById, catalog, S);
          if (!box) return null;
          return (
            <g key={m.id} className="pl-revision">
              <title>{`Changed by your agent, change ${m.n}`}</title>
              <path className="pl-cloud" d={cloudPath(box.x, box.y, box.w, box.h)} />
              <path className="pl-delta" d={deltaPath(box.x + box.w, box.y)} />
              <text className="pl-delta-num" x={box.x + box.w} y={box.y + MARK.delta * 0.5}>
                {m.n}
              </text>
            </g>
          );
        })}
      </g>

      {/* drawing previews and their live measurements */}
      {editor.drawMode === "wall" && editor.pendingWallStart && pointer ? (
        <g className="pl-preview-wall">
          <line
            className="pl-preview"
            x1={editor.pendingWallStart.x * S}
            y1={editor.pendingWallStart.y * S}
            x2={pointer.at.x * S}
            y2={pointer.at.y * S}
            strokeWidth={Math.max(MARK.minWall, WALL_DEFAULTS.thickness * S)}
          />
          <circle className="pl-preview-dot" cx={editor.pendingWallStart.x * S} cy={editor.pendingWallStart.y * S} r={MARK.cursorRing} />
          <LengthPill a={editor.pendingWallStart} b={pointer.at} S={S} tone="live" />
        </g>
      ) : null}
      {roomStart && pointer ? <RoomPreview a={roomStart} b={pointer.at} S={S} /> : null}
      {roomDraft && tool$ === "room" ? <DraftPreview corners={roomDraft} next={pointer?.at ?? roomCursor} S={S} /> : null}
      {tool$ === "room" && roomCursor && !pointer ? <SnapCursor at={{ ...roomCursor, to: "grid" }} S={S} /> : null}
      {aim ? <OpeningGhost aim={aim} kind={tool$ === "door" ? "door" : "window"} S={S} /> : null}
      {aimed ? <StairDrawing geometry={aimed} side="lower" S={S} className="pl-stair pl-ghost-stair" /> : null}
      {placing && pointer && !dragItem ? (
        <g className="pl-ghost-item" transform={`translate(${pointer.at.x * S} ${pointer.at.y * S})`}>
          {furnitureSymbol(placing.kind, placing.w, placing.d, S)}
          {placing.parking ? <polygon className="pl-parking" points={polygonPoints(parkingCorners(0, 0, placing.w, placing.d, 0), S)} /> : null}
        </g>
      ) : null}
      {aimedColumn ? <ColumnGhost aim={aimedColumn} columns={model.columns} S={S} /> : null}

      {/* the snap cursor: where a click lands */}
      {pointer && drawing && !panning ? <SnapCursor at={pointer.at} S={S} /> : null}
      {aimedColumn ? <SnapCursor at={{ x: aimedColumn.x, y: aimedColumn.y, to: aimedColumn.to === "corner" || aimedColumn.to === "wall" ? "end" : "grid" }} S={S} /> : null}

      {/* the shared session: the agent at work, what it points at, the other tabs' cursors */}
      <PlanPresence S={S} levelId={levelId} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pieces of the drawing
// ---------------------------------------------------------------------------

/** One sentence for assistive technology: what the plan holds. */
function planDescription(model: PlanModel, level: string | null): string {
  const of = `Plan of ${model.name}${level ? `, ${level}` : ""}`;
  if (model.walls.length === 0 && model.rooms.length === 0 && model.items.length === 0 && model.stairs.length === 0 && model.columns.length === 0) return `${of}, empty`;
  const rooms = model.rooms.map((r) => `${r.label}${isOpenRoom(r) ? " (open)" : ""} ${roomArea(r).toFixed(1)} square metres`).join(", ");
  const stairs = model.stairs.length > 0 ? `, ${model.stairs.length} ${model.stairs.length === 1 ? "stair" : "stairs"}` : "";
  const columns = model.columns.length > 0 ? `, ${model.columns.length} ${model.columns.length === 1 ? "column" : "columns"}` : "";
  const counts = `${model.walls.length} walls, ${model.openings.length} doors and windows, ${model.items.length} pieces of furniture${stairs}${columns}`;
  return `${of}: ${counts}${rooms ? `. Rooms: ${rooms}` : ""}`;
}

const floorFill = (r: Room, ref: (name: string) => string): string | undefined =>
  r.floor === "oak" ? `url(#${ref("oak")})` : r.floor === "tile" ? `url(#${ref("tile")})` : undefined;

/** The sheet's patterns: the grid, oak planks, tile joints, the destructive hatch. */
function PlanPatterns({ refOf, S }: { refOf: (name: string) => string; S: number }) {
  const half = S / 2;
  const plank = FLOOR_PATTERN.plankWidth * S;
  const run = FLOOR_PATTERN.plankRun * S;
  const tile = FLOOR_PATTERN.tile * S;
  const open = Math.max(FLOOR_PATTERN.openHatch * S, MARK.hatch);
  const joints = FLOOR_PATTERN.plankJoints;
  return (
    <defs>
      <pattern id={refOf("grid-minor")} patternUnits="userSpaceOnUse" width={half} height={half}>
        <path className="pl-grid-minor" d={`M0 0.5H${half}M0.5 0V${half}`} />
      </pattern>
      <pattern id={refOf("grid-major")} patternUnits="userSpaceOnUse" width={S} height={S}>
        <path className="pl-grid-major" d={`M0 0.5H${S}M0.5 0V${S}`} />
      </pattern>
      <pattern id={refOf("oak")} patternUnits="userSpaceOnUse" width={run} height={plank * 4}>
        <rect className="pl-oak-base" width={run} height={plank * 4} />
        {plank >= MARK.minWall * 2
          ? joints.map((j, r) => <path key={r} className="pl-oak-grain" d={`M0 ${(r + 1) * plank}H${run}M${j * S} ${r * plank}V${(r + 1) * plank}`} />)
          : null}
      </pattern>
      <pattern id={refOf("tile")} patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <rect className="pl-tile-base" width={tile} height={tile} />
        {tile >= MARK.minorGrid ? <path className="pl-tile-joint" d={`M0 0.5H${tile}M0.5 0V${tile}`} /> : null}
      </pattern>
      <pattern id={refOf("hatch")} patternUnits="userSpaceOnUse" width={MARK.hatch} height={MARK.hatch} patternTransform="rotate(45)">
        <path className="pl-hatch" d={`M0 0V${MARK.hatch}`} />
      </pattern>
      <pattern id={refOf("warn")} patternUnits="userSpaceOnUse" width={MARK.hatch} height={MARK.hatch} patternTransform="rotate(-45)">
        <path className="pl-warn-hatch" d={`M0 0V${MARK.hatch}`} />
      </pattern>
      {/* an open space's hatch is in metres, as a floor's pattern is: it scales with the plan, never denser than the grid */}
      <pattern id={refOf("open")} patternUnits="userSpaceOnUse" width={open} height={open} patternTransform="rotate(45)">
        <path className="pl-open-hatch" d={`M0 0V${open}`} />
      </pattern>
    </defs>
  );
}



/** A door or a window, cut through its wall, in the wall's own frame (A end to the left). */
function OpeningSymbol({ wall, opening: o, rooms = [], S }: { wall: Wall; opening: Opening; rooms?: readonly Room[]; S: number }) {
  // the vano runs along the centreline, from t0 to t1 (an arc's length on a curved wall); the
  // cut is that stretch of the wall's band, its jambs square to the wall at each end
  const [t0, t1] = openingSpan(wall, o);
  const ht = Math.max(MARK.minWall, wall.thickness * S) / 2 / S;
  // the cut runs half a pixel past each face, so the poché's own pen does not show through it
  const gap = bandPath(wall, t0, t1, ht + 0.5 / S, S);
  const jamb = (t: number) => {
    const p = wallOffsetAt(wall, t, ht);
    const q = wallOffsetAt(wall, t, -ht);
    return `M${p.x * S} ${p.y * S}L${q.x * S} ${q.y * S}`;
  };
  const cut = (
    <>
      <path className="pl-gap" d={gap} />
      <path className="pl-jamb" d={jamb(t0) + jamb(t1)} />
    </>
  );
  const p0 = wallPointAt(wall, t0);
  const p1 = wallPointAt(wall, t1);
  if (isGarageDoor(o)) {
    // An overhead door, as a plan draws one: no leaf and no swing. Its closed panels are a bold
    // line across the vano (along the chord on a curved wall: a sectional door is straight) and,
    // in long dashes, the rectangle they fill raised under the ceiling inside — the door's width,
    // and as deep as it is high, since its sections run back along the tracks by their height.
    const face = wall.thickness / 2;
    const sign = garageInside(p0, p1, face, o.height, rooms);
    const n = chordNormal(p0, p1);
    const off = (p: Pt, k: number) => `${(p.x + n.x * k * sign) * S} ${(p.y + n.y * k * sign) * S}`;
    const deep = face + o.height;
    return (
      <g data-opening={o.id} data-style="garage">
        {cut}
        <path className="pl-garage-panel" d={`M${p0.x * S} ${p0.y * S}L${p1.x * S} ${p1.y * S}`} />
        <path className="pl-garage-overhead" d={`M${off(p0, face)}L${off(p0, deep)}L${off(p1, deep)}L${off(p1, face)}`} />
      </g>
    );
  }
  if (o.kind === "window") {
    // the frame is the band; the pane is straight, across the vano's chord (inside the wall: openingArcError)
    return (
      <g data-opening={o.id}>
        {cut}
        <path className="pl-window" d={bandPath(wall, t0, t1, ht, S)} />
        <path className="pl-glass" d={`M${p0.x * S} ${p0.y * S}L${p1.x * S} ${p1.y * S}`} />
      </g>
    );
  }
  // the leaves as the checker tests them (issues.ts doorLeaves), hinged on the drawn face
  return (
    <g data-opening={o.id}>
      {cut}
      {doorLeaves(wall, o, ht).map(({ hinge: h, shut, open: tip, r }, i) => {
        // from the open leaf's tip to where it shuts, the short way round (SVG's sweep 1 turns
        // the way the y-down sheet's angles grow)
        const cross = (tip.x - h.x) * (shut.y - h.y) - (tip.y - h.y) * (shut.x - h.x);
        const R = r * S;
        return (
          <g key={i}>
            <path className="pl-swing" d={`M${tip.x * S} ${tip.y * S}A${R} ${R} 0 0 ${cross > 0 ? 1 : 0} ${shut.x * S} ${shut.y * S}`} />
            <path className="pl-leaf" d={`M${h.x * S} ${h.y * S}L${tip.x * S} ${tip.y * S}`} />
          </g>
        );
      })}
    </g>
  );
}

/** A room's name and area at its anchor (its most interior point), when there is room for them. */
function RoomLabel({ room: r, S, flag }: { room: Room; S: number; flag: string | null }) {
  const anchor = outlineAnchor(r.points);
  const cx = anchor.x * S;
  const cy = anchor.y * S;
  // an open space says so beside its area: its sides need no walls
  const area = `${roomArea(r).toFixed(2)} m²${isOpenRoom(r) ? ", open" : ""}`;
  // a rectangle's lettering may run its whole width; any other outline's, the widest circle inside it
  const rect = outlineRect(r.points);
  const span = rect ?? { w: anchor.clearance * 2, h: anchor.clearance * 2 };
  const roomW = span.w * S - 2 * MARK.roomLabelPad;
  const roomH = span.h * S - 2 * MARK.roomLabelPad;
  if (roomW < textWidth(r.label, LETTER.name) || roomH < LETTER.name) return null;
  const withArea = roomW >= textWidth(area, LETTER.small) && roomH >= LETTER.name + LETTER.small * 2;
  const withFlag = flag !== null && roomH >= LETTER.name + LETTER.small * 4;
  const halo = `pl-halo pl-halo--${r.floor}`;
  const y0 = cy - (withArea ? LETTER.small / 2 : -LETTER.name / 3);
  return (
    <g>
      <text className={`pl-room-name ${halo}`} x={cx} y={y0}>
        {r.label}
      </text>
      {withArea ? (
        <text className={`pl-room-area ${halo}`} x={cx} y={y0 + LETTER.small + LETTER.small / 3}>
          {area}
        </text>
      ) : null}
      {withFlag ? (
        <text className={`pl-room-flag ${halo}`} x={cx} y={y0 + 2 * (LETTER.small + LETTER.small / 3) + LETTER.small / 3}>
          {flag}
        </text>
      ) : null}
    </g>
  );
}

/** A piece's name, upright, when the piece is big enough on screen to carry it. */
function ItemLabel({ item, label, w, d, S, always }: { item: Item; label: string; w: number; d: number; S: number; always: boolean }) {
  if (!always && S < MARK.itemLabelScale) return null;
  const across = Math.max(w, d) * S - 2 * MARK.outline;
  const deep = Math.min(w, d) * S;
  if (textWidth(label, LETTER.tiny) > across || deep < LETTER.tiny * 2) return null;
  return (
    <text className="pl-item-label pl-halo pl-halo--furniture" x={0} y={0} transform={`rotate(${item.rotation})`}>
      {label}
    </text>
  );
}

function ItemOutline({ item, w, d, S, className }: { item: Item; w: number; d: number; S: number; className: string }) {
  const o = MARK.outline;
  return (
    <rect
      className={className}
      transform={`translate(${item.x * S} ${item.y * S}) rotate(${-item.rotation})`}
      x={(-w / 2) * S - o}
      y={(-d / 2) * S - o}
      width={w * S + 2 * o}
      height={d * S + 2 * o}
      rx={MARK.pillRadius}
    />
  );
}

/** A length in metres on a pill at the middle of a segment: the selected wall, the wall being drawn. */
function LengthPill({ a, b, S, tone }: { a: Pt; b: Pt; S: number; tone: "selection" | "live" | "quiet" }) {
  const len = segLen(a.x, a.y, b.x, b.y);
  if (len < SNAP) return null;
  const text = `${metres(len)} m`;
  const mid = segPoint(a, b, 0.5);
  const w = textWidth(text, LETTER.small) + 2 * MARK.pillPad;
  return (
    <g className={`pl-pill pl-pill--${tone}`} transform={`translate(${mid.x * S} ${mid.y * S})`}>
      <rect className="pl-pill-box" x={-w / 2} y={-MARK.pillH / 2} width={w} height={MARK.pillH} rx={MARK.pillRadius} />
      <text className="pl-pill-text" x={0} y={LETTER.small / 3}>
        {text}
      </text>
    </g>
  );
}

/**
 * A wall's length along it (a curved wall's arc, with its radius) on a pill beside its middle,
 * clear of the bend handle there.
 */
function WallPill({ wall, S, tone }: { wall: Wall; S: number; tone: "selection" | "quiet" }) {
  const len = wallLength(wall);
  if (len < SNAP) return null;
  const arc = wallArc(wall);
  const text = arc ? `${metres(len)} m · R ${metres(arc.radius)}` : `${metres(len)} m`;
  const off = -(Math.max(MARK.minWall, wall.thickness * S) / 2 + MARK.pillH / 2 + MARK.outline) / S;
  const at = wallOffsetAt(wall, 0.5, off);
  const w = textWidth(text, LETTER.small) + 2 * MARK.pillPad;
  return (
    <g className={`pl-pill pl-pill--${tone}`} transform={`translate(${at.x * S} ${at.y * S})`}>
      <rect className="pl-pill-box" x={-w / 2} y={-MARK.pillH / 2} width={w} height={MARK.pillH} rx={MARK.pillRadius} />
      <text className="pl-pill-text" x={0} y={LETTER.small / 3}>
        {text}
      </text>
    </g>
  );
}

/** The walls until their footprints arrive (WallPoche.tsx): each centreline stroked to its thickness. */
function WallStrokes({ walls, S, selectedId, hoverId }: WallPocheProps) {
  return (
    <g className="pl-poche" aria-hidden="true">
      {walls.map((w) =>
        // below the plan's cut (a parapet), seen in projection: its band's outline, as WallPoche draws it
        belowCut(w) ? (
          <path key={w.id} className={`pl-wall pl-wall--below-cut ${wallTone(w.id, selectedId, hoverId)}`} data-wall={w.id} d={bandPath(w, 0, 1, w.thickness / 2, S)} />
        ) : (
          <path key={w.id} className={`pl-wall ${wallTone(w.id, selectedId, hoverId)}`} data-wall={w.id} d={wallPathD(w, S)} strokeWidth={Math.max(MARK.minWall, w.thickness * S)} />
        ),
      )}
    </g>
  );
}

/**
 * The outline the room tool is drawing: its corners so far, closed through `next` (where the
 * pointer or the keyboard's cross is), refused in the quiet tone while the store would refuse it,
 * with the first corner ringed (a click there closes it) and the edge being drawn measured.
 */
function DraftPreview({ corners, next, S }: { corners: readonly Pt[]; next: Pt | null; S: number }) {
  const outline = draftOutline(corners, next);
  const refused = outline.length >= 3 && draftError(outline) !== null;
  const last = corners[corners.length - 1];
  return (
    <g className="pl-preview-room pl-preview-draft" data-refused={refused ? "" : undefined} data-corners={corners.length}>
      {outline.length >= 2 ? <path className="pl-preview-area" d={outlinePath(outline, S)} /> : null}
      {corners.map((c, i) =>
        i === 0 ? (
          <circle key={i} className="pl-draft-start" cx={c.x * S} cy={c.y * S} r={MARK.handle / 2} />
        ) : (
          <circle key={i} className="pl-draft-corner" cx={c.x * S} cy={c.y * S} r={MARK.cursorRing} />
        ),
      )}
      {next ? <LengthPill a={last} b={next} S={S} tone="live" /> : null}
    </g>
  );
}

function RoomPreview({ a, b, S }: { a: Pt; b: Pt; S: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const text = `${metres(w)} × ${metres(h)} m`;
  const pw = textWidth(text, LETTER.small) + 2 * MARK.pillPad;
  const ok = w >= ROOM_SIZE.min && h >= ROOM_SIZE.min;
  return (
    <g className="pl-preview-room" data-refused={ok ? undefined : ""}>
      <rect className="pl-preview-area" x={x * S} y={y * S} width={w * S} height={h * S} />
      <g className="pl-pill pl-pill--live" transform={`translate(${(x + w / 2) * S} ${(y + h / 2) * S})`}>
        <rect className="pl-pill-box" x={-pw / 2} y={-MARK.pillH / 2} width={pw} height={MARK.pillH} rx={MARK.pillRadius} />
        <text className="pl-pill-text" x={0} y={LETTER.small / 3}>
          {text}
        </text>
      </g>
    </g>
  );
}

/** The opening the door or window tool would add where the pointer is (red when it does not fit). */
function OpeningGhost({ aim, kind, S }: { aim: OpeningAim; kind: "door" | "window"; S: number }) {
  const width = kind === "door" ? DOOR_DEFAULTS.width : WINDOW_DEFAULTS.width;
  const ghost: Opening = { id: "ghost", kind, wallId: aim.wall.id, t: aim.t ?? aim.rawT, width, sill: 0, height: 0 };
  return (
    <g className="pl-ghost-opening" data-refused={aim.t === null ? "" : undefined}>
      <OpeningSymbol wall={aim.wall} opening={ghost} S={S} />
      <polygon className="pl-ghost-outline" points={polygonPoints(openingCorners(aim.wall, ghost), S)} />
    </g>
  );
}

function SnapCursor({ at, S }: { at: Snapped; S: number }) {
  const x = at.x * S;
  const y = at.y * S;
  const arm = MARK.cursorArm;
  return (
    <g className="pl-cursor" data-to={at.to}>
      <path className="pl-cursor-arms" d={`M${x - arm} ${y}H${x + arm}M${x} ${y - arm}V${y + arm}`} />
      {at.to === "end" ? (
        <rect className="pl-cursor-end" x={x - MARK.handle / 2} y={y - MARK.handle / 2} width={MARK.handle} height={MARK.handle} />
      ) : (
        <circle className="pl-cursor-ring" cx={x} cy={y} r={MARK.cursorRing} />
      )}
    </g>
  );
}

/** Dimension chains along the top and the left of the walls: each run between wall ends, then the overall. */
function DimensionChains({ walls, S }: { walls: readonly Wall[]; S: number }) {
  if (walls.length === 0) return null;
  const xs = chainStops(walls.flatMap((w) => [w.ax, w.bx]));
  const ys = chainStops(walls.flatMap((w) => [w.ay, w.by]));
  const face = (Math.max(...walls.map((w) => w.thickness)) / 2) * S;
  const minX = xs[0] * S - face;
  const minY = ys[0] * S - face;
  const chains: ReactNode[] = [];
  const horizontal = (key: string, stops: number[], at: number) => {
    const t = MARK.dimTick;
    const d = `M${stops[0] * S - MARK.dimOverrun} ${at}H${stops[stops.length - 1] * S + MARK.dimOverrun}`;
    let ext = "";
    let ticks = "";
    for (const m of stops) {
      ext += `M${m * S} ${minY - MARK.dimExtGap}V${at + MARK.dimExtOver}`;
      ticks += `M${m * S - t} ${at + t}L${m * S + t} ${at - t}`;
    }
    chains.push(
      <g key={key}>
        <path className="pl-dim-ext" d={ext} />
        <path className="pl-dim-line" d={d} />
        <path className="pl-dim-tick" d={ticks} />
        {stops.slice(1).map((m, i) => {
          const span = (m - stops[i]) * S;
          const text = metres(m - stops[i]);
          if (span < textWidth(text, LETTER.small) + 2 * MARK.dimTick) return null;
          return (
            <text key={i} className="pl-dim-text pl-halo" x={((stops[i] + m) / 2) * S} y={at - MARK.dimText}>
              {text}
            </text>
          );
        })}
      </g>,
    );
  };
  const vertical = (key: string, stops: number[], at: number) => {
    const t = MARK.dimTick;
    let ext = "";
    let ticks = "";
    for (const m of stops) {
      ext += `M${minX - MARK.dimExtGap} ${m * S}H${at - MARK.dimExtOver}`;
      ticks += `M${at - t} ${m * S + t}L${at + t} ${m * S - t}`;
    }
    chains.push(
      <g key={key}>
        <path className="pl-dim-ext" d={ext} />
        <path className="pl-dim-line" d={`M${at} ${stops[0] * S - MARK.dimOverrun}V${stops[stops.length - 1] * S + MARK.dimOverrun}`} />
        <path className="pl-dim-tick" d={ticks} />
        {stops.slice(1).map((m, i) => {
          const span = (m - stops[i]) * S;
          const text = metres(m - stops[i]);
          if (span < textWidth(text, LETTER.small) + 2 * MARK.dimTick) return null;
          const cy = ((stops[i] + m) / 2) * S;
          return (
            <text key={i} className="pl-dim-text pl-halo" transform={`translate(${at - MARK.dimText} ${cy}) rotate(-90)`}>
              {text}
            </text>
          );
        })}
      </g>,
    );
  };
  if (xs.length > 1) {
    horizontal("x", xs, minY - MARK.dimOffset);
    if (xs.length > 2) horizontal("x-all", [xs[0], xs[xs.length - 1]], minY - MARK.dimOffset - MARK.dimStep);
  }
  if (ys.length > 1) {
    vertical("y", ys, minX - MARK.dimOffset);
    if (ys.length > 2) vertical("y-all", [ys[0], ys[ys.length - 1]], minX - MARK.dimOffset - MARK.dimStep);
  }
  return <g className="pl-dims">{chains}</g>;
}

/** The world corners an entity occupies on the plan, by id. */
function entityCorners(id: string, model: PlanModel, wallById: Map<string, Wall>, catalog: ReturnType<typeof catalogOf>): Pt[] | null {
  const wall = wallById.get(id);
  if (wall) return wallCorners(wall);
  const room = model.rooms.find((r) => r.id === id);
  if (room) {
    const b = outlineBounds(room.points);
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ];
  }
  const item = model.items.find((i) => i.id === id);
  if (item) {
    const k = catalog.get(item.kind);
    return k ? footprintCorners(item.x, item.y, k.w, k.d, item.rotation) : null;
  }
  const stair = model.stairs.find((s) => s.id === id);
  if (stair) {
    const g = stairGeometryIn(model, stair);
    return g ? g.footprint.flatMap(rectCorners) : null;
  }
  const column = model.columns.find((c) => c.id === id);
  if (column) return columnFootprint(column);
  const opening = model.openings.find((o) => o.id === id);
  const host = opening ? wallById.get(opening.wallId) : undefined;
  return opening && host ? openingCorners(host, opening) : null;
}

/** The pixel box a revision cloud draws around: inside a room's edges, around anything else. */
function markBox(id: string, model: PlanModel, wallById: Map<string, Wall>, catalog: ReturnType<typeof catalogOf>, S: number) {
  const corners = entityCorners(id, model, wallById, catalog);
  if (!corners) return null;
  const isRoom = model.rooms.some((r) => r.id === id);
  const inset = isRoom ? -MARK.cloudPad * 2 : MARK.cloudPad;
  const box = pixelBox(corners, S, inset);
  return box.w > MARK.cloudStep && box.h > MARK.cloudStep ? box : pixelBox(corners, S, MARK.cloudPad);
}

function PendingMark({
  target,
  model,
  wallById,
  S,
  hatch,
}: {
  target: ApprovalTarget;
  model: PlanModel;
  wallById: Map<string, Wall>;
  S: number;
  hatch: string;
}) {
  // a level is outlined whole (PlanPendingMark), a stair hatched with the stair itself; a file is on no plan
  if (target.type === "plan" || target.type === "level" || target.type === "stair" || target.type === "file") return null;
  if (target.type === "room") {
    const r = model.rooms.find((i) => i.id === target.id);
    return r ? <path className="pl-pending-outline" fill="none" d={outlinePath(r.points, S)} /> : null;
  }
  const corners = entityCorners(target.id, model, wallById, catalogOf(model));
  if (!corners) return null;
  return <polygon className="pl-pending pl-pending-outline" points={polygonPoints(corners, S)} fill={hatch} />;
}

/** A request to clear or replace the whole plan: the plan's extent, outlined in the error colour. */
function PlanPendingMark({ model, S }: { model: PlanModel; S: number }) {
  const pts = [
    ...model.walls.flatMap(wallCorners),
    ...model.rooms.flatMap((r) => {
      const b = outlineBounds(r.points);
      return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }];
    }),
  ];
  if (pts.length === 0) return null;
  const box = pixelBox(pts, S, MARK.cloudPad * 2);
  return <rect className="pl-pending-outline pl-pending-outline--plan" x={box.x} y={box.y} width={box.w} height={box.h} rx={MARK.pillRadius} />;
}

// ---------------------------------------------------------------------------
// Levels and stairs
// ---------------------------------------------------------------------------

/** The level below the one shown, faintly: its walls' outlines and its rooms', to line up with. */
function GhostLevel({ model, S }: { model: PlanModel; S: number }) {
  return (
    <g className="pl-ghost-level" aria-hidden="true">
      {model.rooms.map((r) => (
        <path key={r.id} className="pl-ghost-room" d={outlinePath(r.points, S)} />
      ))}
      {model.walls.map((w) => (
        <polygon key={w.id} className="pl-ghost-wall" points={polygonPoints(wallCorners(w), S)} />
      ))}
    </g>
  );
}

/** A stair's footprint outlined (selected, hovered) or hatched (a pending removal). */
function StairOutline({ geometry, S, className, fill }: { geometry: StairGeometry; S: number; className: string; fill?: string }) {
  return (
    <g className={className} fill={fill}>
      {geometry.footprint.map((r, i) => (
        <polygon key={i} className={fill ? "pl-pending-outline" : undefined} points={polygonPoints(rectCorners(r), S)} />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Columns and cars
// ---------------------------------------------------------------------------

/** The corners of a parked car's clear floor (issues.ts parkingClearance), in metres. */
function parkingCorners(x: number, y: number, w: number, d: number, rotation: number): Pt[] {
  return rectCorners(parkingClearance({ cx: x, cy: y, hw: w / 2, hd: d / 2, rot: (-rotation * Math.PI) / 180 }));
}


/** What takes a press on a column: its section, or a touch target round its centre when the section is smaller on screen. */
function ColumnReach({ column: c, S }: { column: Column; S: number }) {
  const b = columnBox(c);
  const half = Math.max(((b.maxX - b.minX) / 2) * S, ((b.maxY - b.minY) / 2) * S, MARK.touchReach);
  return <rect className="pl-column-reach" x={c.x * S - half} y={c.y * S - half} width={2 * half} height={2 * half} />;
}
