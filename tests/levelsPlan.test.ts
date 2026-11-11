/**
 * Levels and stairs on the plan: the plan shows one level at a time over a ghost of the one
 * below; a stair is drawn with its architectural symbol (treads below the cut, hidden ones and
 * the break line above it, the walking line with UP) on its own level and as a stairwell on the
 * level it reaches; the stair tool places one by pointer (press, drag the climb) or by keyboard
 * (arrows aim, Enter places); PageUp and PageDown step the levels; the level switcher, the
 * inspector, the hint bar, Issues and the activity feed name and reach stairs and levels.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { activeLevelId, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { FIRST_LEVEL_ID, seedLoft, seedTownhouse } from "../src/model/seed";
import { GROUND_LEVEL_ID, LEVEL_DEFAULTS, SNAP, STAIR } from "../src/model/limits";
import { stairGeometry } from "../src/model/stairs";
import { stairGuard } from "../src/model/stairGuard";
import type { Stair } from "../src/model/types";
import { Editor } from "../src/editor/Editor";
import { canvasStore, getPlanTool, setPlanTool, ZOOM } from "../src/editor/canvasState";
import { ARROW_CLIMB, aimRotation, STAIR_SYMBOL } from "../src/editor/drawing";
import { rectCorners } from "../src/model/geometry";
import stairsCss from "../src/ui/canvas/stairs.css?raw";
import { breakLine, cutIndex, splitPolyline, stairSymbol } from "../src/editor/stairSymbol";
import { hintFor, selectionTitle } from "../src/ui/canvas/hints";
import { handleShellKey, inScrollingRegion } from "../src/ui/shell/shortcuts";
import { toolsFor } from "../src/ui/shell/tools";
import { CANVAS_REGION_ID, SCROLL_REGION_ATTR } from "../src/ui/shell/ids";
import type { ShellState } from "../src/ui/shell/ShellContext";
import { ThemeRoot } from "../src/ui/theme/ThemeRoot";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { LevelSwitcher } from "../src/ui/canvas/LevelSwitcher";
import { Inspector } from "../src/ui/inspector/Inspector";
import { describeIssue } from "../src/ui/issues/Issues";
import { selectEntity } from "../src/ui/inspector/entities";
import { segmentsOf } from "../src/ui/activity/entities";
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
  dispatch({ type: "load_model", model: seedTownhouse() }, { actor: "system", undoable: false });
  setPlanTool(null);
  canvasStore.setState({ view: { x: 0, y: 0, scale: ZOOM.unit }, stairRotation: 0 });
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
const count = (selector: string) => host.querySelectorAll(selector).length;
const svg = () => host.querySelector("svg.editor-svg")!;
/** A pointer event at a plan point: the view is at the origin, one metre is ZOOM.unit pixels. */
const pointer = (type: string, x: number, y: number) =>
  act(async () => {
    svg().dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x * ZOOM.unit, clientY: y * ZOOM.unit, pointerId: 1 }));
  });
const mainStair = () => store.getState().model.stairs.find((s) => s.id === "stair_main")!;
const ground = () => store.getState().model.levels[0];

describe("the stair symbol", () => {
  const g = () => stairGeometry(mainStair(), ground().height);

  it("draws the treads below the plan's cut, hides the ones above it and breaks the flight where the cut passes", () => {
    const geometry = g();
    const k = cutIndex(geometry);
    // the first tread whose top is above the cut, and every one before it below
    expect(geometry.steps[k].top).toBeGreaterThan(STAIR_SYMBOL.cutHeight);
    expect(geometry.steps[k - 1].top).toBeLessThanOrEqual(STAIR_SYMBOL.cutHeight);
    const sym = stairSymbol(geometry, "lower");
    expect(sym.treads.length + sym.hidden.length).toBe(geometry.steps.length);
    expect(sym.treads).toHaveLength(k + 1);
    expect(sym.cut).toEqual(breakLine(geometry.steps[k].rect, geometry.steps[k].rect.hw * 2 * STAIR_SYMBOL.breakZig));
    expect(sym.label.text).toBe("UP");
    // the walking line runs from the bottom riser to the cut, and on (hidden) to the top riser
    expect(sym.walk.drawn[0]).toEqual(geometry.start);
    expect(sym.walk.rest.at(-1)).toEqual(geometry.end);
    expect(sym.walk.drawn.at(-1)).toEqual(sym.walk.rest[0]);
    expect(sym.arrow.tip).toEqual(geometry.end);
  });

  it("on the level above, outlines the stairwell and shows every tread through it, lettered DN", () => {
    const sym = stairSymbol(g(), "upper");
    expect(sym.hidden).toEqual([]);
    expect(sym.cut).toBeNull();
    expect(sym.treads).toHaveLength(g().steps.length);
    expect(sym.outlines).toHaveLength(g().footprint.length);
    expect(sym.label.text).toBe("DN");
    // the way down: from the top riser to an arrow at the bottom one
    expect(sym.dot).toEqual(g().end);
    expect(sym.arrow.tip).toEqual(g().start);
    expect(sym.arrow.dir.x * g().startDir.x + sym.arrow.dir.y * g().startDir.y).toBeCloseTo(-1, 6);
  });

  it("an L-shaped stair outlines both flights and its landing", () => {
    const l: Stair = { ...mainStair(), shape: "l", turn: "right" };
    const geometry = stairGeometry(l, LEVEL_DEFAULTS.height);
    const sym = stairSymbol(geometry, "lower");
    expect(geometry.landing).not.toBeNull();
    expect(sym.outlines).toHaveLength(3);
    expect(sym.walk.drawn.length + sym.walk.rest.length).toBeGreaterThanOrEqual(geometry.walkLine.length + 1);
  });

  it("a break line runs corner to corner of its tread with the zigzag in the middle", () => {
    const rect = { cx: 0, cy: 0, hw: 0.5, hd: 0.15, rot: 0 };
    const line = breakLine(rect, 0.1);
    expect(line).toHaveLength(6);
    expect(line[0]).toEqual({ x: -0.5, y: -0.15 });
    expect(line[5]).toEqual({ x: 0.5, y: 0.15 });
  });

  it("splits a polyline where a point meets it", () => {
    const [a, b] = splitPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 2 },
        { x: 2, y: 2 },
      ],
      { x: 1, y: 2 },
    );
    expect(a).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]);
    expect(b).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it("aims a stair the way a drag goes, a quarter turn at a time", () => {
    expect(aimRotation({ x: 0, y: 0 }, { x: 0, y: 2 })).toBe(0);
    expect(aimRotation({ x: 0, y: 0 }, { x: 2, y: 0.3 })).toBe(90);
    expect(aimRotation({ x: 0, y: 0 }, { x: 0.2, y: -2 })).toBe(180);
    expect(aimRotation({ x: 0, y: 0 }, { x: -2, y: 0 })).toBe(270);
  });
});

describe("the plan, level by level", () => {
  it("shows the ground floor's walls and its stair, with nothing beneath it", async () => {
    await mount(Editor);
    expect(count(".pl-wall-hit")).toBe(4);
    expect(count(".pl-ghost-wall")).toBe(0);
    expect(count(".pl-stair-hit")).toBe(1);
    expect(host.querySelector(".pl-stair-hit .pl-stair-label")?.textContent).toBe("UP");
    expect(count(".pl-stair-hit .pl-stair-hidden")).toBe(1);
    expect(count(".pl-stair-hit .pl-stair-cut")).toBe(1);
    expect(svg().getAttribute("aria-label")).toContain("Ground floor");
  });

  it("upstairs, draws the first floor over a ghost of the ground floor, and the stairwell the stair arrives through", async () => {
    await mount(Editor);
    await act(async () => void pageActions.setActiveLevel(FIRST_LEVEL_ID));
    expect(count(".pl-wall-hit")).toBe(5);
    expect(count(".pl-ghost-wall")).toBe(4);
    expect(count(".pl-stair-hit")).toBe(0);
    expect(count(".pl-stair--well")).toBe(1);
    expect(host.querySelector(".pl-stair--well .pl-stair-label")?.textContent).toBe("DN");
    expect(host.querySelector(".pl-ghost-level")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hatches a stair a pending request would remove", async () => {
    await mount(Editor);
    await act(async () => {
      void import("../src/model/store").then(({ actions }) =>
        actions.requestApproval({ tool: "remove_stair", actor: "agent", request: "Remove stair_main", targets: [{ type: "stair", id: "stair_main", label: "straight" }], effects: [] }),
      );
    });
    await act(async () => undefined);
    expect(count(".pl-stair-hit .pl-pending")).toBe(1);
  });
});

describe("the stair tool", () => {
  it("S picks it, Esc puts it down", async () => {
    await mount(Editor);
    await press("s");
    expect(getPlanTool()).toBe("stair");
    expect(svg().getAttribute("data-tool")).toBe("stair");
    await press("Escape");
    expect(getPlanTool()).toBeNull();
  });

  it("press where it starts, drag the way it climbs: one stair, one undo step, selected", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("stair"));
    const steps = store.getState().undoStack.length;
    await pointer("pointermove", 4, 4);
    expect(count(".pl-ghost-stair")).toBe(1);
    await pointer("pointerdown", 4, 4);
    await pointer("pointermove", 4, 2);
    await pointer("pointerup", 4, 2);
    const stairs = store.getState().model.stairs;
    expect(stairs).toHaveLength(2);
    const added = stairs[1];
    expect(added).toMatchObject({ x: 4, y: 4, rotation: 180, levelId: GROUND_LEVEL_ID, width: STAIR.defaultWidth });
    expect(store.getState().undoStack.length).toBe(steps + 1);
    expect(store.getState().editor.selectedStairId).toBe(added.id);
    expect(getPlanTool()).toBeNull();
  });

  it("from the keyboard: the arrows aim it, Enter puts it in the middle of the view", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("stair"));
    await press("ArrowRight");
    expect(canvasStore.getState().stairRotation).toBe(90);
    await press("Enter");
    const added = store.getState().model.stairs[1];
    expect(added.rotation).toBe(90);
    expect(store.getState().editor.selectedStairId).toBe(added.id);
  });

  it("puts a stair on the level being worked on", async () => {
    await mount(Editor);
    await act(async () => void pageActions.setActiveLevel(FIRST_LEVEL_ID));
    await act(async () => setPlanTool("stair"));
    await press("Enter");
    expect(store.getState().model.stairs[1].levelId).toBe(FIRST_LEVEL_ID);
  });
});

describe("a selected stair", () => {
  it("nudges 5 cm a press in one undo step, and Delete removes it", async () => {
    await mount(Editor);
    await act(async () => pageActions.selectStair("stair_main"));
    const x = mainStair().x;
    const steps = store.getState().undoStack.length;
    await press("ArrowRight");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    });
    expect(mainStair().x).toBeCloseTo(x + SNAP, 6);
    expect(store.getState().undoStack.length).toBe(steps + 1);
    expect(count(".pl-sel-outline polygon")).toBe(1);
    await press("Delete");
    expect(store.getState().model.stairs).toHaveLength(0);
  });

  it("is named in the hint bar and edited in Properties", async () => {
    pageActions.selectStair("stair_main");
    expect(selectionTitle(store.getState().editor, store.getState().model)).toBe("Stair selected");
    await mount(Inspector);
    expect(host.querySelector(".insp-head__title")?.textContent).toBe("Stair 1");
    expect(host.textContent).toContain("From Ground floor up to First floor");
    expect(host.textContent).toContain("Risers");
    const turn = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Turn"))!;
    await act(async () => turn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mainStair().rotation).toBe(270);
  });
});

describe("levels", () => {
  const shell = { setHelpOpen: vi.fn() } as unknown as ShellState;
  const key = (k: string) => new KeyboardEvent("keydown", { key: k, cancelable: true });

  it("PageUp and PageDown step through them, and stop at either end", () => {
    expect(handleShellKey(key("PageUp"), shell)).toBe(true);
    expect(activeLevelId(store.getState())).toBe(FIRST_LEVEL_ID);
    expect(handleShellKey(key("PageUp"), shell)).toBe(false);
    expect(handleShellKey(key("PageDown"), shell)).toBe(true);
    expect(activeLevelId(store.getState())).toBe(GROUND_LEVEL_ID);
    expect(handleShellKey(key("PageDown"), shell)).toBe(false);
  });

  it("the switcher lists them top first as one radio group, works on the one chosen and says so", async () => {
    await mount(LevelSwitcher);
    const group = host.querySelector('[role="radiogroup"][aria-label="Level"]')!;
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["First floor", "Ground floor"]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    await act(async () => radios[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(activeLevelId(store.getState())).toBe(FIRST_LEVEL_ID);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Working on First floor, floor at +2.90 m");
  });

  it("the switcher adds a level on top and starts working on it", async () => {
    await mount(LevelSwitcher);
    const add = host.querySelector('button[aria-label="Add a level"]')!;
    await act(async () => add.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const levels = store.getState().model.levels;
    expect(levels).toHaveLength(3);
    expect(activeLevelId(store.getState())).toBe(levels[2].id);
  });

  it("Properties lists them, top first, each with its name field and where its floor stands", async () => {
    await mount(Inspector);
    expect(host.textContent).toContain("Storeys, top first");
    expect(host.textContent).toContain("+2.90 m");
    const names = [...host.querySelectorAll<HTMLInputElement>(".insp-level input[type='text'], .insp-level input:not([type])")].map((i) => i.value);
    expect(names.filter((n) => n === "First floor" || n === "Ground floor")).toEqual(["First floor", "Ground floor"]);
    expect(host.querySelector('.insp-level[aria-current="true"]')?.textContent).toContain("Working on it");
  });

  it("the hint bar names PageUp and PageDown on a plan of several, and says when a stair has nowhere to go", () => {
    const { editor, model } = store.getState();
    const words = (h: ReturnType<typeof hintFor>) => h.segments.flat().map((p) => (typeof p === "string" ? p : `[${p.kbd}]`)).join(" ");
    expect(words(hintFor({ editor, model, levelId: GROUND_LEVEL_ID, tool: null, spacePan: false, openingFits: null }))).toContain("[pageup] [pagedown]");
    expect(words(hintFor({ editor, model, levelId: FIRST_LEVEL_ID, tool: "stair", spacePan: false, openingFits: null }))).toContain("no level above");
    expect(words(hintFor({ editor, model, levelId: GROUND_LEVEL_ID, tool: "stair", spacePan: false, openingFits: null }))).not.toContain("no level above");
  });
});

describe("naming and reaching stairs and levels", () => {
  it("Issues names the stair and the level a finding is on", () => {
    const view = describeIssue(store.getState().model, {
      code: "item_on_stair",
      severity: "error",
      message: "Sofa stands on stair stair_main.",
      refs: ["g_item_sofa", "stair_main"],
    });
    expect(view.sentence).toBe("Sofa stands on Stair 1.");
    expect(view.level).toBe("Ground floor");
    expect(view.targets.map((t) => t.type)).toEqual(["item", "stair"]);
  });

  it("a one-storey plan's findings carry no level", () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    const view = describeIssue(store.getState().model, { code: "x", severity: "warning", message: "Wall wall_n is loose.", refs: ["wall_n"] });
    expect(view.level).toBeNull();
  });

  it("selecting something on another level works on that level first", () => {
    selectEntity(store.getState().model, { type: "item", id: "f_item_bed" });
    expect(activeLevelId(store.getState())).toBe(FIRST_LEVEL_ID);
    expect(store.getState().editor.selectedItemId).toBe("f_item_bed");
    selectEntity(store.getState().model, { type: "stair", id: "stair_main" });
    expect(activeLevelId(store.getState())).toBe(GROUND_LEVEL_ID);
    expect(store.getState().editor.selectedStairId).toBe("stair_main");
  });

  it("the activity feed links a stair and a level by name", () => {
    const segs = segmentsOf("Stair stair_main updated on level_first.", store.getState().model);
    const linked = segs.filter((s) => s.kind === "entity").map((s) => s.text);
    expect(linked).toEqual(["Stair 1", "First floor"]);
  });
});

describe("the stair symbol's edges and guard", () => {
  const g = () => stairGeometry(mainStair(), ground().height);
  /** how far along the climb a point is from the cut tread's centre (positive: past the cut) */
  const past = (geometry: ReturnType<typeof g>, p: { x: number; y: number }) => {
    const cut = geometry.steps[cutIndex(geometry)].rect;
    const dir = { x: -Math.sin(cut.rot), y: Math.cos(cut.rot) };
    return (p.x - cut.cx) * dir.x + (p.y - cut.cy) * dir.y;
  };
  const length = (edges: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[]) =>
    edges.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);

  it("on its own level, draws the flight's edges up to the cut and hides them past it, all the way round", () => {
    const geometry = g();
    const sym = stairSymbol(geometry, "lower");
    expect(sym.hiddenEdges.length).toBeGreaterThan(0);
    // nothing drawn solid lies past the cut, and nothing hidden before it
    for (const [a, b] of sym.edges) {
      expect(past(geometry, a)).toBeLessThanOrEqual(1e-9);
      expect(past(geometry, b)).toBeLessThanOrEqual(1e-9);
    }
    for (const [a, b] of sym.hiddenEdges) {
      expect(past(geometry, a)).toBeGreaterThanOrEqual(-1e-9);
      expect(past(geometry, b)).toBeGreaterThanOrEqual(-1e-9);
    }
    // together they are the whole outline, split and nothing lost
    const rim = geometry.footprint.reduce((sum, r) => sum + 4 * (r.hw + r.hd), 0);
    expect(length(sym.edges) + length(sym.hiddenEdges)).toBeCloseTo(rim, 9);
    expect(sym.guard).toEqual([]);
  });

  it("an L stair cut in its first flight hides the landing and the second flight whole", () => {
    const geometry = stairGeometry({ ...mainStair(), shape: "l", turn: "right" }, LEVEL_DEFAULTS.height);
    expect(geometry.steps[cutIndex(geometry)].flight).toBe(0);
    const sym = stairSymbol(geometry, "lower");
    const same = (e: readonly [{ x: number; y: number }, { x: number; y: number }], f: readonly [{ x: number; y: number }, { x: number; y: number }]) =>
      Math.hypot(e[0].x - f[0].x, e[0].y - f[0].y) + Math.hypot(e[1].x - f[1].x, e[1].y - f[1].y) < 1e-9;
    for (const rect of [geometry.landing!.rect, geometry.flights[1]]) {
      const corners = rectCorners(rect);
      for (const [i, a] of corners.entries()) {
        const edge = [a, corners[(i + 1) % corners.length]] as const;
        expect(sym.hiddenEdges.some((h) => same(h, edge))).toBe(true);
        expect(sym.edges.some((h) => same(h, edge))).toBe(false);
      }
    }
  });

  it("on the level above, guards the stairwell inside its rim on every side but the way onto the floor", () => {
    const geometry = g();
    const sym = stairSymbol(geometry, "upper");
    expect(sym.edges).toEqual([]);
    const guard = stairGuard(geometry);
    expect(sym.guard).toHaveLength(guard.length);
    sym.guard.forEach(([a, b], i) => {
      const edge = guard[i];
      // the same stretch, moved into the void by the drawing's inset
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y), 9);
      expect((a.x - edge.a.x) * edge.out.x + (a.y - edge.a.y) * edge.out.y).toBeCloseTo(-STAIR_SYMBOL.guardInset, 9);
    });
  });

  it("draws the stairwell's rim as a visible edge, not in the dash of a preview", async () => {
    await mount(Editor);
    await act(async () => void pageActions.setActiveLevel(FIRST_LEVEL_ID));
    expect(count(".pl-stair--well .pl-stair-guard")).toBe(1);
    const well = /\.pl-stair--well \.pl-stair-flight\s*\{([^}]*)\}/.exec(stairsCss)?.[1] ?? "";
    expect(well).toContain("stroke: var(--plan-ink)");
    expect(well).not.toContain("dasharray");
    await act(async () => void pageActions.setActiveLevel(GROUND_LEVEL_ID));
    expect(count(".pl-stair-hit .pl-stair-edge--hidden")).toBe(1);
  });
});

describe("the stair tool from the keyboard alone", () => {
  /** The plan inside the canvas region, as the shell lays it out. */
  const mountInRegion = async () => {
    const region = document.createElement("main");
    region.id = CANVAS_REGION_ID;
    region.tabIndex = -1;
    host.append(region);
    const inner = createRoot(region);
    await act(async () => inner.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, createElement(Editor)))));
    await loadDeferred();
    return inner;
  };
  const frame = () => act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const keyOnFocus = (key: string) =>
    act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });

  it("choosing it on the rail hands focus to the plan, where the arrows aim it and Enter places it", async () => {
    const inner = await mountInRegion();
    const rail = document.createElement("button");
    host.append(rail);
    rail.focus();
    const tool = toolsFor("2d").find((t) => t.id === "stair")!;
    await act(async () => tool.run({ setHelpOpen: vi.fn() } as unknown as ShellState));
    await frame();
    expect(document.activeElement?.id).toBe(CANVAS_REGION_ID);
    await keyOnFocus("ArrowRight");
    await keyOnFocus("Enter");
    const added = store.getState().model.stairs[1];
    expect(added?.rotation).toBe(90);
    await act(async () => inner.unmount());
  });

  it("shows the stair it would place where Enter puts it, and says which way it climbs", async () => {
    await mount(Editor);
    await act(async () => setPlanTool("stair"));
    // no pointer over the plan: the aim is drawn all the same
    expect(count(".pl-ghost-stair")).toBe(1);
    const { editor, model } = store.getState();
    const title = (rotation: number) => hintFor({ editor, model, levelId: GROUND_LEVEL_ID, tool: "stair", spacePan: false, openingFits: null, stairRotation: rotation }).title;
    expect(title(0)).toBe("Add a stair, climbing down");
    expect(title(ARROW_CLIMB.ArrowRight)).toBe("Add a stair, climbing right");
    expect(title(ARROW_CLIMB.ArrowUp)).toBe("Add a stair, climbing up");
    expect(title(ARROW_CLIMB.ArrowLeft)).toBe("Add a stair, climbing left");
  });
});

describe("the levels in Properties", () => {
  it("names every storey's row, so its fields and buttons are told apart", async () => {
    await mount(Inspector);
    const groups = [...host.querySelectorAll('.insp-level [role="group"]')].map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["First floor", "Ground floor"]);
  });

  it("after a removal, hands focus to the storey now in its place", async () => {
    await mount(Inspector);
    const top = host.querySelector('.insp-level [role="group"][aria-label="First floor"]')!;
    const remove = [...top.querySelectorAll("button")].find((b) => b.textContent?.includes("Remove"))!;
    remove.focus();
    await act(async () => remove.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(store.getState().model.levels).toHaveLength(1);
    const focused = document.activeElement as HTMLInputElement;
    expect(focused.tagName).toBe("INPUT");
    expect(focused.closest('[role="group"]')?.getAttribute("aria-label")).toBe("Ground floor");
  });
});

describe("PageUp and PageDown beside a scroller", () => {
  const shell = { setHelpOpen: vi.fn() } as unknown as ShellState;

  it("leave the level alone from inside a region that scrolls, such as the activity feed", () => {
    const feed = document.createElement("section");
    feed.setAttribute(SCROLL_REGION_ATTR, "");
    const link = document.createElement("button");
    feed.append(link);
    host.append(feed);
    const e = new KeyboardEvent("keydown", { key: "PageUp", cancelable: true });
    Object.defineProperty(e, "target", { value: link });
    expect(inScrollingRegion(link)).toBe(true);
    expect(handleShellKey(e, shell)).toBe(false);
    expect(activeLevelId(store.getState())).toBe(GROUND_LEVEL_ID);
    // from the plan they step the levels
    const region = document.createElement("main");
    region.id = CANVAS_REGION_ID;
    host.append(region);
    expect(inScrollingRegion(region)).toBe(false);
  });

  it("the single-storey hint teaches that a stair is selected like the rest", () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    const { editor, model } = store.getState();
    const words = hintFor({ editor, model, tool: null, spacePan: false, openingFits: null }).segments.flat().filter((p) => typeof p === "string");
    expect(words).toContain("Click a wall, room, piece or stair to select it");
  });
});
