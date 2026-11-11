/**
 * Free shapes on the plan: the room tool draws an outline corner by corner (pointer: click each
 * corner, the first or a double-click closes it; keyboard: the arrows move a cross, C puts a
 * corner down, Enter closes, Backspace takes one back, Esc drops it) with the rectangle drag
 * kept; a selected room's corner and edge handles move, add, remove corners and bend edges; a
 * selected wall's middle bends it; walls are drawn as their mitred footprints, curved ones with
 * true arcs, openings cut along the arc; floors fill (and so clip their pattern to) the outline;
 * labels stand at the outline's most interior point; edges and arcs are measured.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import type { Room, Wall } from "../src/model/types";
import { outlineAnchor, outlineArea, outlinePath, pointInOutline, polygonCentroid, roomArea, tessellateOutline, wallArc, wallPointAt } from "../src/model/shapes";
import { wallFootprint } from "../src/model/joints";
import { openingSpan } from "../src/model/issues";
import { Editor } from "../src/editor/Editor";
import { canvasStore, setPlanTool, ZOOM } from "../src/editor/canvasState";
import { bandPoints, PLAN_CUT, STAIR_SYMBOL, wallOffsetAt } from "../src/editor/drawing";
import { draftError } from "../src/editor/roomDraft";
import { edgeMeasure, sagittaToward } from "../src/editor/ShapeHandles";
import { hintFor } from "../src/ui/canvas/hints";
import { ThemeRoot } from "../src/ui/theme/ThemeRoot";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { Inspector } from "../src/ui/inspector/Inspector";
import { resetStore } from "./support/store";
import { loadDeferred } from "./support/deferred";

let root: Root;
let host: HTMLElement;
const S = ZOOM.unit;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dispatch({ type: "clear_model" }, { actor: "system", undoable: false });
  setPlanTool(null);
  canvasStore.setState({ view: { x: 0, y: 0, scale: S }, size: { w: 1000, h: 800 }, placed: true, roomDraft: null, roomCursor: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async () => {
  await act(async () => root.render(createElement(Editor)));
  await loadDeferred();
};
const svg = () => host.querySelector("svg.editor-svg")!;
/** A pointer event at a plan point on `target` (the plan by default): the view is at the origin, a metre is S pixels. */
const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}, target: Element = svg()) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x * S, clientY: y * S, pointerId: 1, ...init }));
  });
const click = async (x: number, y: number) => {
  await pointer("pointerdown", x, y);
  await pointer("pointerup", x, y);
};
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
const rooms = () => store.getState().model.rooms;
const draft = () => canvasStore.getState().roomDraft;
const steps = () => store.getState().undoStack.length;
const drawRooms = () => act(async () => pageActions.setDrawMode("room"));
const L = [
  [1, 1],
  [5, 1],
  [5, 3],
  [3, 3],
  [3, 5],
  [1, 5],
] as const;

describe("the room tool, corner by corner", () => {
  it("puts a corner down with each click and closes the outline on the first corner: one room, one undo step", async () => {
    await mount();
    await drawRooms();
    const before = steps();
    for (const [x, y] of L) await click(x, y);
    expect(draft()).toHaveLength(6);
    expect(host.querySelector(".pl-preview-draft")?.getAttribute("data-corners")).toBe("6");
    expect(rooms()).toHaveLength(0);
    // near the first corner is on it: the click snaps there and closes the outline
    await click(1.02, 0.99);
    expect(draft()).toBeNull();
    expect(rooms()).toHaveLength(1);
    expect(roomArea(rooms()[0])).toBeCloseTo(12, 6);
    expect(rooms()[0].points).toHaveLength(6);
    expect(steps()).toBe(before + 1);
  });

  it("closes on a double-click, the last corner being the double-click's", async () => {
    await mount();
    await drawRooms();
    await click(0, 0);
    await click(4, 0);
    await click(4, 3);
    await pointer("pointerdown", 4, 3);
    await pointer("pointerup", 4, 3);
    await act(async () => {
      svg().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 4 * S, clientY: 3 * S }));
    });
    expect(rooms()).toHaveLength(1);
    expect(roomArea(rooms()[0])).toBeCloseTo(6, 6);
  });

  it("takes the last corner back with Backspace, drops the outline with Esc and stays in the tool", async () => {
    await mount();
    await drawRooms();
    await click(0, 0);
    await click(4, 0);
    await click(4, 3);
    await press("Backspace");
    expect(draft()).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    await press("Escape");
    expect(draft()).toBeNull();
    expect(store.getState().editor.drawMode).toBe("room");
    await press("Escape");
    expect(store.getState().editor.drawMode).toBe("select");
  });

  it("keeps an outline that crosses itself open, and says why", async () => {
    await mount();
    await drawRooms();
    for (const [x, y] of [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ] as const)
      await click(x, y);
    await press("Enter");
    expect(rooms()).toHaveLength(0);
    expect(draft()).toHaveLength(4);
    expect(host.querySelector(".pl-preview-draft")?.hasAttribute("data-refused")).toBe(true);
    const words = hintFor({ editor: store.getState().editor, model: store.getState().model, tool: null, spacePan: false, openingFits: null, roomDraft: draft() })
      .segments.flat()
      .filter((p) => typeof p === "string")
      .join(" ");
    expect(words).toContain("cross");
    expect(words).toContain("cannot close yet");
  });

  it("still draws a rectangle with a drag", async () => {
    await mount();
    await drawRooms();
    await pointer("pointerdown", 1, 1);
    await pointer("pointermove", 4, 3);
    await pointer("pointerup", 4, 3);
    expect(draft()).toBeNull();
    expect(rooms()).toHaveLength(1);
    expect(roomArea(rooms()[0])).toBeCloseTo(6, 6);
  });

  it("draws from the keyboard: the arrows move the cross, C puts a corner down, Enter closes", async () => {
    await mount();
    await drawRooms();
    // the cross starts in the middle of the view: (5, 4) on a 1000 × 800 canvas at the origin
    await act(async () => canvasStore.setState({ size: { w: 1000, h: 800 } }));
    const big = { shiftKey: true };
    await press("c");
    for (let i = 0; i < 6; i++) await press("ArrowRight", big);
    await press("c");
    for (let i = 0; i < 4; i++) await press("ArrowDown", big);
    await press("c");
    expect(draft()).toEqual([
      { x: 5, y: 4 },
      { x: 8, y: 4 },
      { x: 8, y: 6 },
    ]);
    expect(host.querySelector(".pl-cursor")).not.toBeNull();
    await press("Enter");
    expect(rooms()).toHaveLength(1);
    expect(roomArea(rooms()[0])).toBeCloseTo(3, 6);
  });

  it("says what the next corner does in the hint bar", () => {
    const input = { editor: { ...store.getState().editor, drawMode: "room" as const }, model: store.getState().model, tool: null, spacePan: false, openingFits: null };
    expect(hintFor(input).segments[0]).toEqual(["Drag a rectangle, or click corner by corner"]);
    const h = hintFor({ ...input, roomDraft: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] });
    expect(h.title).toBe("Draw a room, 3 corners");
    expect(h.segments[1]).toEqual([{ kbd: "enter" }, "or click the first corner to close it"]);
    expect(draftError([{ x: 0, y: 0 }, { x: 2, y: 0 }])).toMatch(/at least 3 corners/);
  });

  it("names a refused outline's edges as they were drawn, from 1, whichever way round it was clicked", () => {
    // a bowtie: edge 2 (the second click to the third) crosses the closing edge, 4
    expect(draftError([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }])).toBe("Edge 2 and the closing edge (4) cross or touch");
    expect(draftError([{ x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 0 }])).toBe("Edge 2 and the closing edge (4) cross or touch");
    // a 2 cm edge, the second one drawn, clicked one way round and then the other
    const corners = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.02 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    expect(draftError(corners)).toMatch(/^Edge 2 is 2 cm long/);
    expect(draftError([...corners].reverse())).toMatch(/^Edge 3 is 2 cm long/);
  });

  it("letters the keyboard's cross, and the edges it would make, so each arrow step is read out", () => {
    const input = { editor: { ...store.getState().editor, drawMode: "room" as const }, model: store.getState().model, tool: null, spacePan: false, openingFits: null };
    const said = (h: ReturnType<typeof hintFor>) => h.segments.flat().filter((p) => typeof p === "string").join(" | ");
    expect(said(hintFor({ ...input, roomCursor: { x: 3.4, y: 2.1 } }))).toContain("Cross at X 3.40 m, Y 2.10 m");
    const one = hintFor({ ...input, roomCursor: { x: 3, y: 0 }, roomDraft: [{ x: 0, y: 0 }] });
    expect(said(one)).toContain("Cross at X 3.00 m, Y 0.00 m: edge 1 would be 3.00 m");
    const two = hintFor({ ...input, roomCursor: { x: 3, y: 4 }, roomDraft: [{ x: 0, y: 0 }, { x: 3, y: 0 }] });
    expect(said(two)).toContain("edge 2 would be 4.00 m, closing 5.00 m");
    expect(two.segments.some((s) => s.some((p) => typeof p !== "string" && p.kbd === "c"))).toBe(true);
    // moving the cross changes what the bar says: a live region announces it
    expect(said(hintFor({ ...input, roomCursor: { x: 3.05, y: 4 }, roomDraft: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }))).not.toBe(said(two));
  });
});

/** A room on an empty plan, selected. */
const selectedRoom = async (points: Room["points"]): Promise<string> => {
  const r = dispatch({ type: "add_room", points, label: "Studio" }, { actor: "human" });
  const id = r.id as string;
  await act(async () => pageActions.selectRoom(id));
  return id;
};
const roomById = (id: string) => rooms().find((r) => r.id === id)!;
const handle = (selector: string) => host.querySelector(selector)!;
/** Drag a handle from one plan point to another, as one gesture. */
const dragHandle = async (selector: string, from: [number, number], to: [number, number], init: PointerEventInit = {}) => {
  const h = handle(selector);
  await pointer("pointerdown", from[0], from[1], init, h);
  await pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, init, h);
  await pointer("pointermove", to[0], to[1], init, h);
  await pointer("pointerup", to[0], to[1], init, h);
};
const rect = [
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 5, y: 4 },
  { x: 1, y: 4 },
];

describe("a selected room's handles", () => {
  it("has a corner handle on each corner and a middle handle on each edge, as 44 px targets", async () => {
    await selectedRoom(rect);
    await mount();
    expect(host.querySelectorAll(".pl-corner-handle")).toHaveLength(4);
    expect(host.querySelectorAll(".pl-edge-handle")).toHaveLength(4);
    expect(Number(host.querySelector(".pl-corner-handle .pl-handle-reach")?.getAttribute("r")) * 2).toBeGreaterThanOrEqual(44);
  });

  it("moves a corner with a drag, snapped, in one undo step", async () => {
    const id = await selectedRoom(rect);
    await mount();
    const before = steps();
    await dragHandle('.pl-corner-handle[data-corner="2"]', [5, 4], [6.02, 5.01]);
    expect(roomById(id).points).toContainEqual({ x: 6, y: 5 });
    expect(steps()).toBe(before + 1);
  });

  it("bends an edge through the pointer from its middle, out of the room, and back straight", async () => {
    const id = await selectedRoom(rect);
    await mount();
    // the top edge, from (1, 1) to (5, 1): dragging its middle up bows it out of the room
    await dragHandle('.pl-edge-handle[data-edge="0"]', [3, 1], [3, 0]);
    const bent = roomById(id);
    expect(bent.points[0].bulge).toBeGreaterThan(0);
    expect(roomArea(bent)).toBeGreaterThan(12);
    // the edge's length along its arc and its radius are lettered
    expect([...host.querySelectorAll(".pl-edge-dim")].some((t) => /R \d/.test(t.textContent ?? ""))).toBe(true);
    await dragHandle('.pl-edge-handle[data-edge="0"]', [3, 0], [3, 1]);
    expect(roomById(id).points[0].bulge).toBeUndefined();
    expect(roomArea(roomById(id))).toBeCloseTo(12, 6);
  });

  it("adds a corner with a Shift-drag on an edge's middle and moves it in the same gesture", async () => {
    const id = await selectedRoom(rect);
    await mount();
    const before = steps();
    await dragHandle('.pl-edge-handle[data-edge="1"]', [5, 2.5], [6, 2.5], { shiftKey: true });
    expect(roomById(id).points).toHaveLength(5);
    expect(roomById(id).points).toContainEqual({ x: 6, y: 2.5 });
    expect(steps()).toBe(before + 1);
  });

  it("removes a corner on a double-click, adds one on an edge's middle with a double-click", async () => {
    const id = await selectedRoom([...rect, { x: 1, y: 2.5 }].slice(0, 4).concat([{ x: 0, y: 2.5 }]));
    await mount();
    expect(roomById(id).points).toHaveLength(5);
    const corner = roomById(id).points.findIndex((p) => p.x === 0);
    await act(async () => {
      handle(`.pl-corner-handle[data-corner="${corner}"]`).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(roomById(id).points).toHaveLength(4);
    await act(async () => {
      handle('.pl-edge-handle[data-edge="0"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(roomById(id).points).toHaveLength(5);
    expect(roomById(id).points).toContainEqual({ x: 3, y: 1 });
  });
});

describe("drawing shaped rooms", () => {
  it("fills the outline itself with the floor's pattern, so the pattern is clipped to it, arcs included", async () => {
    const id = await selectedRoom([{ x: 1, y: 1, bulge: 0.4 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }]);
    await act(async () => dispatch({ type: "update_room", id, patch: { floor: "oak" } }, { actor: "human" }));
    await mount();
    const floor = host.querySelector("path.pl-floor")!;
    expect(floor.getAttribute("d")).toBe(outlinePath(roomById(id).points, S));
    expect(floor.getAttribute("d")).toContain("A");
    expect(floor.getAttribute("fill")).toMatch(/^url\(#plan-oak-/);
  });

  it("letters an L at its most interior point, inside it and away from its centroid", async () => {
    const points = L.map(([x, y]) => ({ x, y }));
    dispatch({ type: "add_room", points, label: "Kitchen" }, { actor: "human" });
    await mount();
    const room = rooms()[0];
    const anchor = outlineAnchor(room.points);
    const name = host.querySelector(".pl-room-name")!;
    expect(Number(name.getAttribute("x"))).toBeCloseTo(anchor.x * S, 6);
    expect(pointInOutline(anchor, room.points)).toBe(true);
    const centroid = polygonCentroid(tessellateOutline(room.points));
    expect(Math.hypot(anchor.x - centroid.x, anchor.y - centroid.y)).toBeGreaterThan(0.2);
    expect(host.querySelector(".pl-room-area")?.textContent).toBe(`${Math.abs(outlineArea(room.points)).toFixed(2)} m²`);
  });
});

describe("curved and angled walls on the plan", () => {
  const add = (ax: number, ay: number, bx: number, by: number, curve?: { sagitta: number }) =>
    dispatch({ type: "add_wall", ax, ay, bx, by, ...(curve ? { curve } : {}) }, { actor: "human" }).id as string;
  const wall = (id: string): Wall => store.getState().model.walls.find((w) => w.id === id)!;

  it("draws each wall as its mitred footprint, at 30, 45 and 60 degrees as at 90", async () => {
    for (const [i, deg] of [30, 45, 60, 90].entries()) {
      const rad = (deg * Math.PI) / 180;
      const x0 = i * 6;
      add(x0, 0, x0 + 4, 0);
      add(x0, 0, x0 + 4 * Math.cos(rad), 4 * Math.sin(rad));
    }
    await mount();
    const walls = store.getState().model.walls;
    for (const w of walls) {
      const drawn = host.querySelector(`.pl-wall-fill[data-wall="${w.id}"]`);
      expect(drawn?.getAttribute("d")).toBe(outlinePath(wallFootprint(w, walls).outline, S));
    }
  });

  it("draws a wall lower than the plan's cut (a parapet) in projection, its outline, and a storey-high wall as poché", async () => {
    const tall = add(0, 0, 4, 0);
    const low = add(4, 0, 4, 3);
    dispatch({ type: "edit_wall", id: low, patch: { height: PLAN_CUT.height - 0.1 } }, { actor: "human" });
    await mount();
    const fill = (id: string) => host.querySelector(`.pl-wall-fill[data-wall="${id}"]`)!;
    expect(fill(low).classList.contains("pl-wall-fill--below-cut")).toBe(true);
    expect(fill(tall).classList.contains("pl-wall-fill--below-cut")).toBe(false);
    // at the cut, or above it, a wall is cut: poché
    dispatch({ type: "edit_wall", id: low, patch: { height: PLAN_CUT.height } }, { actor: "human" });
    await act(async () => {});
    expect(fill(low).classList.contains("pl-wall-fill--below-cut")).toBe(false);
    // the stair symbol cuts at the same height
    expect(STAIR_SYMBOL.cutHeight).toBe(PLAN_CUT.height);
  });

  it("draws a curved wall with arcs for faces, measures its arc and radius, and bends from its middle", async () => {
    const id = add(0, 0, 4, 0, { sagitta: 1 });
    await mount();
    expect(host.querySelector(`.pl-wall-fill[data-wall="${id}"]`)?.getAttribute("d")).toContain("A");
    await act(async () => pageActions.selectWall(id));
    const arc = wallArc(wall(id))!;
    expect(host.querySelector(".pl-pill--selection .pl-pill-text")?.textContent).toBe(`${arc.length.toFixed(2)} m · R ${arc.radius.toFixed(2)}`);
    expect(host.querySelector(".pl-radius")).not.toBeNull();
    // drag its middle back onto the chord: straight again, in one undo step
    const before = steps();
    const mid = wallPointAt(wall(id), 0.5);
    await dragHandle(`.pl-bend-handle[data-bend="${id}"]`, [mid.x, mid.y], [2, 0]);
    expect(wall(id).bulge ?? 0).toBe(0);
    expect(steps()).toBe(before + 1);
    // and out again the other way: a sagitta of half a metre toward the wall's right
    await dragHandle(`.pl-bend-handle[data-bend="${id}"]`, [2, 0], [2, 0.5]);
    expect(wall(id).bulge).toBeLessThan(0);
    expect(sagittaToward({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0.52 })).toBeCloseTo(-0.5, 9);
  });

  it("cuts a window along a curved wall's arc, its jambs on the faces, as the model places it", async () => {
    const id = add(0, 0, 6, 0, { sagitta: 1 });
    dispatch({ type: "add_window", wallId: id, t: 0.5 }, { actor: "human" });
    await mount();
    const w = wall(id);
    const o = store.getState().model.openings[0];
    const [t0, t1] = openingSpan(w, o);
    const arc = wallArc(w)!;
    // the cut's outline follows the faces, concentric with the wall's arc
    for (const p of bandPoints(w, t0, t1, w.thickness / 2)) {
      const r = Math.hypot(p.x - arc.center.x, p.y - arc.center.y);
      expect(Math.min(Math.abs(r - (arc.radius + w.thickness / 2)), Math.abs(r - (arc.radius - w.thickness / 2)))).toBeLessThan(1e-9);
    }
    const symbol = host.querySelector(`[data-opening="${o.id}"]`)!;
    expect(symbol.querySelector(".pl-gap")?.getAttribute("d")).toContain("A");
    // the pane runs straight across the vano's chord, from jamb to jamb
    const p0 = wallPointAt(w, t0);
    const p1 = wallPointAt(w, t1);
    expect(symbol.querySelector(".pl-glass")?.getAttribute("d")).toBe(`M${p0.x * S} ${p0.y * S}L${p1.x * S} ${p1.y * S}`);
    const jamb = wallOffsetAt(w, t0, w.thickness / 2);
    expect(symbol.querySelector(".pl-jamb")?.getAttribute("d")).toContain(`M${jamb.x * S} ${jamb.y * S}`);
  });

  it("swings a door on a curved wall from its hinge jamb, square to the vano's chord", async () => {
    const id = add(0, 0, 6, 0, { sagitta: 0.6 });
    dispatch({ type: "add_door", wallId: id, t: 0.5 }, { actor: "human" });
    await mount();
    const w = wall(id);
    const o = store.getState().model.openings[0];
    const [t0, t1] = openingSpan(w, o);
    const leaf = host.querySelector(`[data-opening="${o.id}"] .pl-leaf`)!.getAttribute("d")!;
    const [hx, hy, tx, ty] = leaf.match(/-?[\d.e-]+/g)!.map(Number).map((v) => v / S);
    const hinge = wallOffsetAt(w, t0, w.thickness / 2);
    expect(hx).toBeCloseTo(hinge.x, 6);
    expect(hy).toBeCloseTo(hinge.y, 6);
    const p0 = wallPointAt(w, t0);
    const p1 = wallPointAt(w, t1);
    const chord = { x: p1.x - p0.x, y: p1.y - p0.y };
    expect((tx - hx) * chord.x + (ty - hy) * chord.y).toBeCloseTo(0, 6);
    expect(Math.hypot(tx - hx, ty - hy)).toBeCloseTo(Math.hypot(chord.x, chord.y), 6);
  });

  it("letters an arc edge with its length and radius", () => {
    expect(edgeMeasure({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, bulge: 0 })).toBe("4.00");
    expect(edgeMeasure({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, bulge: 1 })).toBe(`${(2 * Math.PI).toFixed(2)} · R 2.00`);
  });
});

describe("the plans that were", () => {
  it("draws the loft as before: its rectangles, its walls and their handles", async () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    await mount();
    expect(host.querySelectorAll("path.pl-floor")).toHaveLength(store.getState().model.rooms.length);
    expect(host.querySelectorAll(".pl-wall-fill")).toHaveLength(store.getState().model.walls.length);
    await act(async () => pageActions.selectWall("wall_bed_s"));
    expect(host.querySelectorAll(".pl-handle-hit")).toHaveLength(2);
    expect(host.querySelectorAll(".pl-bend-handle")).toHaveLength(1);
  });
});

describe("shapes from the keyboard, in Properties", () => {
  const mountInspector = async () => {
    await act(async () => root.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, createElement(Inspector)))));
    await loadDeferred();
  };
  // a button by its accessible name: its aria-label, else its text
  const button = (name: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name)!;
  const tap = (b: Element) => act(async () => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  it("lists a room's corners and edges in labelled fields, and adds and removes corners", async () => {
    const id = await selectedRoom(rect);
    await mountInspector();
    const labels = [...host.querySelectorAll("label")].map((l) => l.textContent ?? "");
    expect(labels.some((t) => t.includes("Edge 1 bend, out of the room"))).toBe(true);
    expect(labels.some((t) => t.includes("Corner 4 X"))).toBe(true);
    expect(host.textContent).toContain("Edge 1: 4.00 m");
    await tap(button("Add a corner on edge 1"));
    expect(roomById(id).points).toHaveLength(5);
    expect(roomById(id).points).toContainEqual({ x: 3, y: 1 });
    await tap(button("Remove corner 2"));
    expect(roomById(id).points).toHaveLength(4);
  });

  it("keeps the keyboard in the Shape section when a corner is added or removed, even as Remove becomes blocked", async () => {
    const id = await selectedRoom(rect);
    await mountInspector();
    const frame = () => act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    const inShape = () => (document.activeElement as HTMLElement | null)?.closest(".insp-shape") !== null && document.activeElement !== document.body;
    // each corner's two buttons share one row
    const add = button("Add a corner on edge 1");
    expect(add.closest(".insp-shape__actions")).toBe(button("Remove corner 1").closest(".insp-shape__actions"));
    add.focus();
    await tap(add);
    await frame();
    expect(roomById(id).points).toHaveLength(5);
    expect(inShape()).toBe(true);
    // the new corner's X field: corner 2
    expect(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.closest(".insp-pair")?.textContent).toMatch(/Corner 2/);
    // a button that becomes blocked while it has focus stays the same element, focus and all
    const held = button("Remove corner 1");
    held.focus();
    await act(async () => {
      dispatch({ type: "reshape_room", id, change: { op: "remove_vertex", index: 1 } }, { actor: "human" });
      dispatch({ type: "reshape_room", id, change: { op: "remove_vertex", index: 3 } }, { actor: "human" });
    });
    expect(roomById(id).points).toHaveLength(3);
    expect(held.isConnected).toBe(true);
    expect(held.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(held);
    dispatch({ type: "undo" }, { actor: "human" });
    dispatch({ type: "undo" }, { actor: "human" });
    await act(async () => {});
    // 5 corners to 4, then 4 to 3: at 3 every Remove is blocked, and focus is not dropped to the page
    for (const n of [4, 3]) {
      const remove = button(`Remove corner ${n}`);
      remove.focus();
      await tap(remove);
      await frame();
      expect(roomById(id).points).toHaveLength(n);
      expect(inShape()).toBe(true);
    }
    expect(button("Remove corner 1").getAttribute("aria-disabled")).toBe("true");
    // a button that only became blocked stays the same element: pressing it again keeps focus there
    const blocked = button("Remove corner 1");
    blocked.focus();
    await tap(blocked);
    await frame();
    expect(document.activeElement).toBe(blocked);
  });

  it("bends and straightens a wall, naming its arc and radius", async () => {
    const id = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0, curve: { sagitta: 1 } }, { actor: "human" }).id as string;
    await act(async () => pageActions.selectWall(id));
    await mountInspector();
    expect(host.textContent).toContain("Length along the arc");
    expect(host.textContent).toContain("Radius");
    await tap(button("Straighten"));
    expect(store.getState().model.walls.find((w) => w.id === id)!.bulge ?? 0).toBe(0);
  });
});
