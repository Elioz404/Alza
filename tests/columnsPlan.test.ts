/**
 * Columns, open spaces, garage doors and the car on the plan: columns drawn in solid poché (one
 * solid with a wall they stand in) and dimensioned axis to axis; the column tool by pointer and by
 * keyboard, snapping to wall corners, wall axes and other columns; selecting, dragging, nudging
 * and removing a column; an open space's lighter hatch; the garage door's overhead symbol with no
 * swing; the car's plan symbol and parking clearance; the level above's slab drawn dashed over the
 * open ground it overhangs, and an upper floor nothing carries hatched; the column inspector, the
 * open-space switch and the garage door's style in Properties; the rail, the hint bar and the
 * shortcut sheet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { activeLevelId, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID } from "../src/model/demoCrescent";
import { COLUMN, GARAGE_DOOR, GROUND_LEVEL_ID, PARKING, SNAP } from "../src/model/limits";
import { columnAim, snapColumnPoint } from "../src/model/columns";
import { levelSlice } from "../src/model/levels";
import { catalogOf } from "../src/model/catalog";
import { Editor } from "../src/editor/Editor";
import { garageInside } from "../src/editor/drawing";
import { canvasStore, getPlanTool, planBounds, setPlanTool, ZOOM } from "../src/editor/canvasState";
import { furnitureSymbol, hasSymbol } from "../src/editor/symbols";
import { overheadPath, unsupportedPath } from "../src/editor/SlabMarks";
import { hintFor, selectionTitle } from "../src/ui/canvas/hints";
import { handleShellKey, SHORTCUT_SHEET } from "../src/ui/shell/shortcuts";
import { toolsFor } from "../src/ui/shell/tools";
import type { ShellState } from "../src/ui/shell/ShellContext";
import { ThemeRoot } from "../src/ui/theme/ThemeRoot";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { Inspector } from "../src/ui/inspector/Inspector";
import canvasCss from "../src/ui/canvas/canvas.css?raw";
import { resetStore } from "./support/store";
import { loadDeferred } from "./support/deferred";

let root: Root;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dispatch({ type: "load_model", model: seedCrescent() }, { actor: "system", undoable: false });
  setPlanTool(null);
  canvasStore.setState({ view: { x: 0, y: 0, scale: ZOOM.unit } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (node: () => unknown) => {
  await act(async () => root.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, createElement(node as () => null)))));
  await loadDeferred();
};
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
const release = (key: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  });
const svg = () => host.querySelector("svg.editor-svg")!;
/** A pointer event at a plan point: the view is at the origin, one metre is ZOOM.unit pixels. */
const pointerAt = (target: Element, type: string, x: number, y: number) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x * ZOOM.unit, clientY: y * ZOOM.unit, pointerId: 1 }));
  });
const pointer = (type: string, x: number, y: number) => pointerAt(svg(), type, x, y);
const model = () => store.getState().model;
const column = (id: string) => model().columns.find((c) => c.id === id)!;
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttonNamed = (text: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === text)!;

describe("columns on the plan", () => {
  it("are drawn in solid poché on their own level only, each a press target", async () => {
    await mount(Editor);
    const drawn = [...host.querySelectorAll("[data-column]")].map((g) => g.getAttribute("data-column"));
    expect(drawn).toEqual(["g_column_1", "g_column_2", "g_column_3"]);
    for (const g of host.querySelectorAll("[data-column]")) expect(g.querySelector(".pl-column")).not.toBeNull();
    // the poché is the walls' ink, with no cross in it (a cross marks a void on a plan)
    expect(/\.pl-column\s*\{([^}]*)\}/.exec(canvasCss)?.[1]).toContain("fill: var(--plan-column)");
    // the press target is at least the 44 px touch target, whatever the section on screen
    canvasStore.setState({ view: { x: 0, y: 0, scale: ZOOM.min } });
    await act(async () => {});
    const reach = host.querySelector("[data-column='g_column_1'] .pl-column-reach")!;
    expect(Number(reach.getAttribute("width"))).toBeGreaterThanOrEqual(44);
    await act(async () => void pageActions.setActiveLevel(CRESCENT_FIRST_LEVEL_ID));
    expect(host.querySelectorAll("[data-column]")).toHaveLength(0);
  });

  it("a round column is drawn as a circle of its diameter", async () => {
    dispatch({ type: "update_column", id: "g_column_2", patch: { shape: "circle", w: 0.4 } }, { actor: "human" });
    await mount(Editor);
    const circle = host.querySelector("[data-column='g_column_2'] circle.pl-column")!;
    expect(Number(circle.getAttribute("r"))).toBeCloseTo(0.2 * ZOOM.unit, 6);
  });

  it("dimensions the columns' axes as a structural grid, once two of them differ", async () => {
    await mount(Editor);
    // three columns in a line north to south: one chain, of the two bays between them
    const axes = host.querySelector("[data-column-axes]")!;
    expect([...axes.querySelectorAll(".pl-dim-text")].map((t) => t.textContent)).toEqual(["2.75", "2.75"]);
  });

  it("are selected with a press, moved by a drag as one step, nudged by the arrows and removed by Delete", async () => {
    await mount(Editor);
    const g = host.querySelector("[data-column='g_column_2']")!;
    await pointerAt(g, "pointerdown", 16.15, -0.2);
    expect(store.getState().editor.selectedColumnId).toBe("g_column_2");
    expect(selectionTitle(store.getState().editor, model())).toBe("Column selected");
    expect(host.querySelector("[data-column-pill]")?.textContent).toBe("0.30 × 0.30 m");
    // dragged off any axis: it goes to the grid; one undo step for the whole drag
    const undo = store.getState().undoStack.length;
    await pointer("pointermove", 15.03, 0.52);
    await pointer("pointermove", 15.02, 0.51);
    await pointer("pointerup", 15.02, 0.51);
    expect(column("g_column_2")).toMatchObject({ x: 15, y: 0.5 });
    expect(store.getState().undoStack.length).toBe(undo + 1);
    await press("ArrowRight");
    await release("ArrowRight");
    expect(column("g_column_2").x).toBeCloseTo(15 + SNAP, 9);
    await press("Delete");
    expect(model().columns.map((c) => c.id)).toEqual(["g_column_1", "g_column_3"]);
    expect(store.getState().editor.selectedColumnId).toBeNull();
  });

  it("a dragged column is pulled onto the other columns' axis, never its own", async () => {
    await mount(Editor);
    await pointerAt(host.querySelector("[data-column='g_column_2']")!, "pointerdown", 16.15, -0.2);
    await pointer("pointermove", 16.1, 0.9);
    await pointer("pointerup", 16.1, 0.9);
    // in line with columns 1 and 3 (x 16.15), y on the grid
    expect(column("g_column_2")).toMatchObject({ x: 16.15, y: 0.9 });
  });
});

describe("the column tool", () => {
  it("is on the rail as P, and P picks it on the plan", async () => {
    const tool = toolsFor("2d").find((t) => t.id === "column")!;
    expect(tool.shortcut).toBe("p");
    expect(tool.label).toBe("Add a column");
    expect(new Set(toolsFor("2d").map((t) => t.shortcut)).size).toBe(toolsFor("2d").length);
    const shell = { setHelpOpen: vi.fn(), openPanel: vi.fn() } as unknown as ShellState;
    expect(handleShellKey(new KeyboardEvent("keydown", { key: "p", cancelable: true }), shell)).toBe(true);
    expect(getPlanTool()).toBe("column");
    setPlanTool(null);
    await mount(Editor);
    await press("p");
    expect(getPlanTool()).toBe("column");
    expect(svg().getAttribute("data-tool")).toBe("column");
  });

  it("puts a column down where a click lands, pulled to a wall's corner, and stays in hand", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("column"));
    // within reach of the carport's north-west corner (12, -3)
    await pointer("pointermove", 12.1, -2.9);
    expect(host.querySelector(".pl-ghost-column")?.getAttribute("data-to")).toBe("corner");
    await pointer("pointerdown", 12.1, -2.9);
    const added = model().columns.at(-1)!;
    expect(added).toMatchObject({ x: 12, y: -3, levelId: GROUND_LEVEL_ID, shape: COLUMN.defaults.shape, w: COLUMN.defaults.size });
    expect(model().columns).toHaveLength(4);
    expect(getPlanTool()).toBe("column");
    expect(store.getState().activity.at(-1)?.source).toBe("human");
  });

  it("onto a wall's axis, onto another column's axis, else the grid", async () => {
    const slice = levelSlice(model(), GROUND_LEVEL_ID);
    // beside the carport's west wall (x 12), away from its ends
    expect(snapColumnPoint({ x: 12.15, y: -1.43 }, slice)).toMatchObject({ x: 12, to: "wall", ref: "g_carport_w" });
    // in the open carport, level with column 2 (y -0.2): its y is taken, x goes to the grid
    const lined = snapColumnPoint({ x: 14.02, y: -0.1 }, slice);
    expect(lined).toMatchObject({ to: "column", ref: "g_column_2" });
    expect(lined.y).toBeCloseTo(-0.2, 9);
    expect(lined.x).toBeCloseTo(14, 9);
    await mount(Editor);
    await act(async () => setPlanTool("column"));
    await pointer("pointermove", 14.02, -0.1);
    // the guide is drawn to the column it lined up with
    expect(host.querySelector(".pl-ghost-column[data-to='column'] .pl-snap-guide")).not.toBeNull();
  });

  it("is refused in the error tone where it would stand in another column", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("column"));
    await pointer("pointermove", 16.3, -0.2);
    expect(host.querySelector(".pl-ghost-column")?.hasAttribute("data-refused")).toBe(true);
  });

  it("from the keyboard: the arrows move its cross, Enter puts one there, and the hint letters where it goes", async () => {
    await mount(Editor);
    await press("p");
    // picked from the keyboard, the cross starts in the view's middle: the aim is drawn before any arrow
    expect(canvasStore.getState().columnCursor).not.toBeNull();
    expect(host.querySelector(".pl-ghost-column")).not.toBeNull();
    await press("ArrowRight");
    const first = canvasStore.getState().columnCursor!;
    await press("ArrowRight", { shiftKey: true });
    const cross = canvasStore.getState().columnCursor!;
    expect(cross.x - first.x).toBeCloseTo(SNAP * 10, 9);
    expect(cross.y).toBeCloseTo(first.y, 9);
    expect(host.querySelector(".pl-ghost-column")).not.toBeNull();
    const { editor } = store.getState();
    const hint = hintFor({ editor, model: model(), levelId: GROUND_LEVEL_ID, tool: "column", spacePan: false, openingFits: null, columnCursor: cross });
    expect(hint.title).toBe("Add columns");
    const aim = snapColumnPoint(cross, levelSlice(model(), GROUND_LEVEL_ID));
    // the hint letters where the column goes (snapped), not the raw cross
    expect(hint.segments[0][0]).toMatch(new RegExp(`^Column at X ${aim.x.toFixed(2)} m, Y ${aim.y.toFixed(2)} m, `));
    await press("Enter");
    const added = model().columns.at(-1)!;
    expect(model().columns).toHaveLength(4);
    expect(added.x).toBeCloseTo(aim.x, 3);
    expect(added.y).toBeCloseTo(aim.y, 3);
    // still in hand, cross where it was; Esc puts the tool and its cross away
    expect(getPlanTool()).toBe("column");
    await press("Escape");
    expect(getPlanTool()).toBeNull();
    expect(canvasStore.getState().columnCursor).toBeNull();
  });

  it("letters what the cross's column snaps to and the column it would overlap, as Enter would put it", () => {
    const m = model();
    const words = (x: number, y: number) => {
      const hint = hintFor({ editor: store.getState().editor, model: m, levelId: GROUND_LEVEL_ID, tool: "column", spacePan: false, openingFits: null, columnCursor: { x, y } });
      return hint.segments[0][0] as string;
    };
    const slice = levelSlice(m, GROUND_LEVEL_ID);
    // near the carport's north-west corner: pulled onto a wall's end, both axes moved
    const corner = columnAim({ x: 12.1, y: -2.9 }, slice);
    expect(corner.to).toBe("corner");
    const cornerWall = m.walls.find((w) => w.id === corner.ref)!;
    expect(words(12.1, -2.9)).toBe(`Column at X ${corner.x.toFixed(2)} m, Y ${corner.y.toFixed(2)} m, on the end of Wall ${m.walls.indexOf(cornerWall) + 1}`);
    // level with column 2, in the open: in line with it
    expect(words(14.02, -0.1)).toBe("Column at X 14.00 m, Y -0.20 m, in line with Column 2");
    // on column 2 itself: it would stand in it, said in words as well as drawn
    const on = columnAim({ x: 16.2, y: -0.2 }, slice);
    expect(on.overlaps).toBe("g_column_2");
    expect(words(16.2, -0.2)).toMatch(/: it would overlap Column 2$/);
  });

  it("crosses out a refused aim, so the refusal is not in its colour alone", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("column"));
    await pointer("pointermove", 16.3, -0.2);
    expect(host.querySelector(".pl-ghost-column[data-refused] .pl-ghost-refused")).not.toBeNull();
    await pointer("pointermove", 14, 1);
    expect(host.querySelector(".pl-ghost-refused")).toBeNull();
  });

  it("the pointer takes over from the cross when it moves", async () => {
    await mount(Editor);
    await press("p");
    await press("ArrowDown");
    expect(canvasStore.getState().columnCursor).not.toBeNull();
    await pointer("pointermove", 14, 1);
    expect(canvasStore.getState().columnCursor).toBeNull();
  });

  it("is on the shortcut sheet with its keys, and the plan's extent counts the columns", () => {
    const rows = SHORTCUT_SHEET.flatMap((g) => g.rows);
    expect(rows.some((r) => r.keys.includes("p") && r.does === "Add a column")).toBe(true);
    expect(rows.some((r) => r.does.startsWith("With Add a column, move the cross"))).toBe(true);
    expect(rows.some((r) => r.keys.includes("enter") && r.does === "With Add a column, put a column down at the cross")).toBe(true);
    const alone = { ...model(), walls: [], rooms: [], items: [], stairs: [], openings: [] };
    const b = planBounds(alone)!;
    expect(b.minX).toBeCloseTo(16.15 - 0.15, 9);
    expect(b.maxX).toBeCloseTo(16.15 + 0.15, 9);
  });
});

describe("open spaces, the garage door and the car", () => {
  it("an open space carries the lighter hatch over its floor and says it is open", async () => {
    await mount(Editor);
    const carport = [...host.querySelectorAll("[data-open-space]")];
    expect(carport).toHaveLength(1);
    expect(carport[0].getAttribute("fill")).toMatch(/^url\(#plan-open-/);
    expect(host.querySelector(".pl-letters")?.textContent).toContain("m², open");
    // an enclosed room has none
    dispatch({ type: "update_room", id: "g_room_carport", patch: { kind: "enclosed" } }, { actor: "human" });
    await act(async () => {});
    expect(host.querySelectorAll("[data-open-space]")).toHaveLength(0);
  });

  it("a garage door has no leaf and no swing: its panels in the wall, and dashed where they lie raised, inside", async () => {
    await mount(Editor);
    const door = host.querySelector("[data-opening='g_garage_door']")!;
    expect(door.getAttribute("data-style")).toBe("garage");
    expect(door.querySelector(".pl-swing")).toBeNull();
    expect(door.querySelector(".pl-leaf")).toBeNull();
    expect(door.querySelector(".pl-garage-panel")).not.toBeNull();
    // the raised panels are on the carport's side (south of its north wall, y -3), as deep as the door is high
    const d = door.querySelector(".pl-garage-overhead")!.getAttribute("d")!;
    const ys = [...d.matchAll(/[ML](-?[\d.e-]+) (-?[\d.e-]+)/g)].map((m) => Number(m[2]) / ZOOM.unit);
    const o = model().openings.find((x) => x.id === "g_garage_door")!;
    expect(Math.min(...ys)).toBeCloseTo(-3 + 0.1, 6);
    expect(Math.max(...ys)).toBeCloseTo(-3 + 0.1 + o.height, 6);
    expect(/\.pl-garage-overhead\s*\{([^}]*)\}/.exec(canvasCss)?.[1]).toContain("var(--dash-overhead)");
  });

  it("the raised panels go to the side a room is on, else the wall's left", () => {
    const room = { id: "r", levelId: "g", label: "Garage", floor: "concrete" as const, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 0, y: 6 }] };
    // a wall along y = 0, walked west to east: its chord's normal points to -y
    expect(garageInside({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.1, 2.1, [room])).toBe(-1);
    expect(garageInside({ x: 4, y: 0 }, { x: 0, y: 0 }, 0.1, 2.1, [room])).toBe(1);
    expect(garageInside({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.1, 2.1, [])).toBe(1);
  });

  it("the car has a plan symbol of its own, and shows its parking clearance when selected", async () => {
    expect(hasSymbol("car")).toBe(true);
    const car = catalogOf(model()).get("car")!;
    expect(car.parking).toBe(true);
    expect([furnitureSymbol("car", car.w, car.d, ZOOM.unit)].flat().length).toBeGreaterThan(3);
    pageActions.selectItem("g_car");
    await mount(Editor);
    const zone = host.querySelector(".pl-parking")!;
    const pts = zone.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number));
    const xs = pts.map(([x]) => x / ZOOM.unit);
    const ys = pts.map(([, y]) => y / ZOOM.unit);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(car.w + 2 * PARKING.side, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(car.d + 2 * PARKING.end, 6);
  });
});

describe("the slab of the level above, and what carries it", () => {
  it("over the open carport, the studio's slab edge is drawn dashed: its open sides only, not where it meets the walls", async () => {
    const d = overheadPath(model(), GROUND_LEVEL_ID, 1);
    const segments = [...d.matchAll(/M(-?[\d.e-]+) (-?[\d.e-]+)L(-?[\d.e-]+) (-?[\d.e-]+)/g)].map((m) => m.slice(1).map(Number));
    expect(segments.length).toBeGreaterThan(0);
    // the studio's outer east face (16.3) and south face (2.7) are its edge, seen from the carport
    expect(segments.some(([x1, , x2]) => Math.abs(x1 - 16.3) < 1e-6 && Math.abs(x2 - 16.3) < 1e-6)).toBe(true);
    expect(segments.some(([, y1, , y2]) => Math.abs(y1 - 2.7) < 1e-6 && Math.abs(y2 - 2.7) < 1e-6)).toBe(true);
    // nothing along the carport's west wall, which the slab runs on over
    expect(segments.some(([x1, , x2]) => Math.abs(x1 - 12.1) < 1e-6 && Math.abs(x2 - 12.1) < 1e-6)).toBe(false);
    // the top level has nothing over it
    expect(overheadPath(model(), CRESCENT_FIRST_LEVEL_ID, 1)).toBe("");
    await mount(Editor);
    expect(host.querySelector(".pl-overhead-rim")?.getAttribute("d")).toBe(overheadPath(model(), GROUND_LEVEL_ID, ZOOM.unit));
    expect(/\.pl-overhead-rim\s*\{([^}]*)\}/.exec(canvasCss)?.[1]).toContain("var(--dash-overhead)");
  });

  it("an upper floor with nothing near enough under it is hatched in the warning colour", async () => {
    expect(unsupportedPath(model(), CRESCENT_FIRST_LEVEL_ID, 1)).toBe("");
    for (const id of ["g_column_1", "g_column_2", "g_column_3"]) dispatch({ type: "remove_column", id }, { actor: "human" });
    expect(unsupportedPath(model(), CRESCENT_FIRST_LEVEL_ID, 1)).not.toBe("");
    await mount(Editor);
    expect(host.querySelector(".pl-unsupported")).toBeNull();
    await act(async () => void pageActions.setActiveLevel(CRESCENT_FIRST_LEVEL_ID));
    expect(host.querySelector(".pl-unsupported path[fill]")?.getAttribute("fill")).toMatch(/^url\(#plan-warn-/);
  });
});

describe("in Properties", () => {
  it("a column's inspector names it, changes its section and turns it, and deletes it", async () => {
    pageActions.selectColumn("g_column_1");
    await mount(Inspector);
    expect(host.querySelector(".insp-head__title")?.textContent).toBe("Column 1");
    expect(host.textContent).toContain("Square column, 0.30 × 0.30 m");
    // it stands in the end of the carport's north wall
    expect(host.textContent).toMatch(/In Wall \d+/);
    const rect = [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Rectangle")!;
    await click(rect);
    expect(column("g_column_1").shape).toBe("rectangle");
    expect([...host.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Depth"))).toBe(true);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Turn"))!);
    expect(column("g_column_1").rotation).toBe(90);
    // the height: up to the slab by default; switched off, it keeps the height it had
    const sw = host.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(sw.checked).toBe(true);
    await click(sw);
    expect(column("g_column_1").height).toBeCloseTo(2.7, 6);
    await click(buttonNamed("Delete column"));
    expect(model().columns.some((c) => c.id === "g_column_1")).toBe(false);
    expect(store.getState().editor.selectedColumnId).toBeNull();
  });

  it("a room can be made an open space, and back", async () => {
    pageActions.selectRoom("g_room_carport");
    await mount(Inspector);
    expect(host.textContent).toContain("Open space, concrete floor");
    const sw = [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find((i) => i.closest(".switch-field")?.textContent?.includes("Open space"))!;
    expect(sw.checked).toBe(true);
    await click(sw);
    expect(model().rooms.find((r) => r.id === "g_room_carport")!.kind).toBeUndefined();
  });

  it("a door opens as a hinged leaf or as a garage door, sized as one", async () => {
    pageActions.selectWall("g_carport_n");
    await mount(Inspector);
    expect(host.textContent).toContain("Garage door, 2.60 m wide");
    await click(buttonNamed(`Edit ${host.querySelector(".insp-opening__name")!.textContent}`));
    expect(host.textContent).toContain("A sectional door");
    // no hinge or swing side for a garage door
    expect(host.querySelector('[role="radiogroup"][aria-label="Hinged at"]')).toBeNull();
    await click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Hinged door")!);
    const o = () => model().openings.find((x) => x.id === "g_garage_door")!;
    expect(o().style).toBeUndefined();
    expect(o().hinge).toBeDefined();
    await click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Garage door")!);
    expect(o().style).toBe("garage");
    expect(o().width).toBeGreaterThanOrEqual(GARAGE_DOOR.width.min);
  });

  it("an opening's fields are named for it: none reads as the wall's own Height", async () => {
    pageActions.selectWall("g_carport_n");
    await mount(Inspector);
    await click(buttonNamed(`Edit ${host.querySelector(".insp-opening__name")!.textContent}`));
    const nameOf = (input: Element): string => {
      const own = input.getAttribute("aria-label");
      if (own) return own;
      const by = input.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => host.querySelector(`[id="${id}"]`)?.textContent ?? "").join(" ").trim();
      return host.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? "";
    };
    const names = [...host.querySelectorAll("input")].filter((i) => i.getAttribute("type") !== "checkbox" && i.getAttribute("role") !== "switch").map(nameOf);
    expect(names).toContain("Height");
    expect(names).toContain("Door height");
    expect(names).toContain("Door width");
    expect(new Set(names).size).toBe(names.length);
    // the editor is a group named after the opening
    const group = host.querySelector('[role="group"][aria-label]')!;
    expect(group.getAttribute("aria-label")).toBe(host.querySelector(".insp-opening__name")!.textContent);
    expect(group.querySelector("input")).not.toBeNull();
  });

  it("the plan's list reaches the columns of the level shown", async () => {
    await mount(Inspector);
    const group = [...host.querySelectorAll(".insp-elements__group")].find((g) => g.querySelector(".insp-elements__title")?.textContent === "Columns")!;
    expect(group.querySelector(".insp-elements__count")?.textContent).toBe("3");
    expect(activeLevelId(store.getState())).toBe(GROUND_LEVEL_ID);
  });
});
