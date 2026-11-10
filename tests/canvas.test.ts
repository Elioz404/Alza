/**
 * The plan canvas: the drawing carries its dimensions, the agent's numbered revision marks and
 * the hatch of a pending removal; the editor's own keys pick the pan, door and window tools and
 * nudge a selection in one undo step; the zoom group moves the shared view; the hint bar names
 * the tool and what to do next.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actions, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { SNAP } from "../src/model/limits";
import { Editor } from "../src/editor/Editor";
import { canvasStore, getPlanTool, setPlanTool, setShowAgentMarks, ZOOM } from "../src/editor/canvasState";
import { ZoomControl } from "../src/ui/canvas/ZoomControl";
import { Legend } from "../src/ui/canvas/Legend";
import { hintFor, type HintInput } from "../src/ui/canvas/hints";
import { HintBar } from "../src/ui/canvas/HintBar";
import { resetStore } from "./support/store";

let root: Root;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
  setPlanTool(null);
  setShowAgentMarks(true);
  canvasStore.setState({ view: { x: -1.5, y: -1.5, scale: ZOOM.initial } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mount = (...components: (() => unknown)[]) =>
  act(async () => root.render(createElement("div", null, ...components.map((c, i) => createElement(c as () => null, { key: i })))));
const press = (key: string, type: "keydown" | "keyup" = "keydown", init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init }));
  });
const texts = (selector: string) => [...host.querySelectorAll(selector)].map((n) => n.textContent);

describe("the drawing", () => {
  it("dimensions the walls in chains, each run and the overall", async () => {
    await mount(Editor);
    expect(texts(".pl-dim-text")).toEqual(expect.arrayContaining(["5.00", "3.00", "8.00", "3.40", "2.60", "6.00"]));
  });

  it("letters each room with its name and area", async () => {
    await mount(Editor);
    expect(texts(".pl-room-name")).toEqual(["Living & Kitchen", "Bedroom", "Bathroom"]);
    expect(texts(".pl-room-area")).toContain("6.98 m²");
  });

  it("marks the agent's change with the number the feed gives it, and hides marks on request", async () => {
    await mount(Editor, Legend);
    await act(async () => {
      dispatch({ type: "move_item", id: "item_sofa", x: 3, y: 5.2 }, { actor: "agent" });
    });
    expect(texts(".pl-delta-num")).toEqual(["1"]);
    expect(host.querySelector(".legend")?.textContent).toContain("Changed by your agent");
    await act(async () => setShowAgentMarks(false));
    expect(host.querySelector(".pl-revision")).toBeNull();
  });

  it("hatches what a pending request would remove, in the error colour", async () => {
    await mount(Editor, Legend);
    await act(async () => {
      void actions.requestApproval({
        tool: "remove_room",
        actor: "agent",
        request: "Remove the room Bathroom",
        targets: [{ type: "room", id: "room_bath", label: "Bathroom" }],
        effects: [],
      });
    });
    expect(host.querySelector(".pl-pending")).not.toBeNull();
    expect(texts(".pl-room-flag")).toEqual(["Removal pending"]);
    expect(host.querySelector(".legend")?.textContent).toContain("Waiting for your decision");
  });

  it("draws a selected wall with its length and end handles", async () => {
    await mount(Editor);
    await act(async () => pageActions.selectWall("wall_bed_s"));
    expect(texts(".pl-pill-text")).toEqual(["3.00 m"]);
    expect(host.querySelectorAll(".pl-handle")).toHaveLength(2);
  });
});

describe("the editor's keys", () => {
  it("pick pan, door and window, and Esc puts them down", async () => {
    await mount(Editor);
    await press("h");
    expect(getPlanTool()).toBe("pan");
    await press("d");
    expect(getPlanTool()).toBe("door");
    expect(store.getState().editor.drawMode).toBe("select");
    await press("n");
    expect(getPlanTool()).toBe("window");
    await press("Escape");
    expect(getPlanTool()).toBeNull();
  });

  it("drop their own tool when a draw mode is chosen", async () => {
    await mount(Editor);
    await press("d");
    await act(async () => pageActions.setDrawMode("wall"));
    expect(getPlanTool()).toBeNull();
  });

  it("Esc in Select clears the selection", async () => {
    await mount(Editor);
    await act(async () => pageActions.selectItem("item_sofa"));
    await press("Escape");
    expect(store.getState().editor.selectedItemId).toBeNull();
  });

  it("nudge the selection 5 cm a press, and a run of presses is one undo step and one feed line", async () => {
    await mount(Editor);
    const sofa = store.getState().model.items.find((i) => i.id === "item_sofa")!;
    await act(async () => pageActions.selectItem("item_sofa"));
    const steps = store.getState().undoStack.length;
    const lines = store.getState().activity.length;
    await press("ArrowRight");
    await press("ArrowRight", "keydown", { repeat: true });
    await press("ArrowRight", "keyup");
    const moved = store.getState().model.items.find((i) => i.id === "item_sofa")!;
    expect(moved.x).toBeCloseTo(sofa.x + 2 * SNAP, 6);
    expect(store.getState().undoStack.length).toBe(steps + 1);
    expect(store.getState().activity.length).toBe(lines + 1);
  });

  it("zoom with + and -", async () => {
    await mount(Editor);
    await press("+");
    expect(canvasStore.getState().view.scale).toBeCloseTo(ZOOM.initial * ZOOM.step, 6);
    await press("-");
    expect(canvasStore.getState().view.scale).toBeCloseTo(ZOOM.initial, 6);
  });
});

describe("the zoom group", () => {
  it("reads the zoom as a percentage and moves the shared view", async () => {
    await mount(ZoomControl);
    const value = host.querySelector<HTMLButtonElement>(".zoom__value")!;
    expect(value.textContent).toBe("90%");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
    expect(canvasStore.getState().view.scale).toBeGreaterThan(ZOOM.initial);
    await act(async () => value.click());
    expect(canvasStore.getState().view.scale).toBeCloseTo(ZOOM.unit, 6);
    expect(host.querySelector(".scalebar")?.getAttribute("aria-label")).toMatch(/^Scale bar, [\d.]+ m$/);
  });

  it("is not shown in 3D", async () => {
    store.setState((s) => ({ editor: { ...s.editor, view: "3d" } }));
    await mount(ZoomControl);
    expect(host.querySelector(".zoom")).toBeNull();
  });
});

describe("the hint bar", () => {
  const base = (): HintInput => ({ editor: store.getState().editor, model: store.getState().model, tool: null, spacePan: false, openingFits: null });
  const words = (h: ReturnType<typeof hintFor>) => h.segments.map((s) => s.map((p) => (typeof p === "string" ? p : `[${p.kbd}]`)).join(" "));

  it("names the selection and what to do with it", () => {
    pageActions.selectWall("wall_bed_s");
    const h = hintFor(base());
    expect(h.title).toBe("Wall selected");
    expect(words(h)).toEqual(["Drag an end to move it", "[left] [right] [up] [down] nudge 5 cm", "[delete] remove", "[esc] deselect"]);
  });

  it("says why a door cannot go where the pointer is", () => {
    const h = hintFor({ ...base(), tool: "door", openingFits: false });
    expect(h.title).toBe("Add doors");
    expect(words(h)[0]).toBe("A 0.90 m door does not fit here. Try a longer stretch of wall");
  });

  it("starts an empty plan with the room tool", () => {
    dispatch({ type: "clear_model" }, { actor: "human" });
    expect(words(hintFor(base()))[0]).toBe("Pick a tool, or press [r] to draw a room");
  });

  it("shows in Plan view, and gives way in 3D to the scene's own hint bar", async () => {
    await mount(HintBar);
    expect(host.querySelector(".hint")).not.toBeNull();
    await act(async () => store.setState((s) => ({ editor: { ...s.editor, view: "3d", camera: "walk" } })));
    expect(host.querySelector(".hint")).toBeNull();
  });
});
