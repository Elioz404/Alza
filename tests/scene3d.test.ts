/**
 * The 3D view's lifecycle. Its renderer — a WebGL context — used to be created in an effect
 * that depended on the plan, so every change made a new context: forty agent edits, forty
 * contexts, past the browser's cap. The viewport is now created once per mount and fed the
 * plan through a store subscription, outside React's render.
 *
 * The viewport itself needs WebGL; here it is replaced by a recorder, which is all the
 * component's side of the contract needs. The recorder can also refuse to start, as
 * three.js does when the browser gives the page no WebGL context.
 *
 * The view's own chrome (the camera switch and the hint bar) is checked here too.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actions, pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { resetStore } from "./support/store";
import { CUT_HEIGHT, SCENE_STYLE_DEFAULTS } from "../src/model/limits";

const viewport = vi.hoisted(() => ({
  created: 0,
  disposed: 0,
  models: [] as unknown[],
  cameras: [] as string[],
  styles: [] as unknown[],
  selections: [] as unknown[],
  pending: [] as unknown[][],
  /** what the viewport was created with: its label layer and its first selection and style */
  options: null as null | { labels?: HTMLElement | null; style?: unknown; selected?: unknown },
  /** when set, creating a viewport throws this, as WebGLRenderer does without a context */
  failWith: null as Error | null,
}));

vi.mock("../src/three/viewport", () => ({
  createViewport: (_mount: unknown, _model: unknown, _mode: unknown, options: typeof viewport.options) => {
    if (viewport.failWith) throw viewport.failWith;
    viewport.created++;
    viewport.options = options;
    return {
      setModel: (m: unknown) => viewport.models.push(m),
      setCamera: (c: string) => viewport.cameras.push(c),
      setStyle: (s: unknown) => viewport.styles.push(s),
      setSelection: (s: unknown) => viewport.selections.push(s),
      setPending: (a: unknown[]) => viewport.pending.push(a),
      dispose: () => viewport.disposed++,
    };
  },
}));

const { Scene3D } = await import("../src/three/Scene3D");

let host: HTMLDivElement;
let root: Root;
let renders = 0;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
  Object.assign(viewport, { created: 0, disposed: 0, models: [], cameras: [], styles: [], selections: [], pending: [], options: null, failWith: null });
  renders = 0;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(Profiler, { id: "scene", onRender: () => void renders++ }, createElement(Scene3D))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("Scene3D", () => {
  it("creates one viewport for many plan changes, and feeds each change to it", async () => {
    await act(async () => {
      for (let i = 0; i < 40; i++) dispatch({ type: "add_wall", ax: 20, ay: i, bx: 24, by: i }, { actor: "agent" });
    });
    expect(viewport.created).toBe(1);
    expect(viewport.models).toHaveLength(40);
    expect(viewport.models.at(-1)).toBe(store.getState().model);
  });

  it("does not re-render for a plan change its own markup does not show", async () => {
    const before = renders;
    await act(async () => {
      for (let i = 0; i < 10; i++) dispatch({ type: "add_wall", ax: 20, ay: i, bx: 24, by: i }, { actor: "agent" });
    });
    expect(renders).toBe(before);
  });

  it("passes camera changes on without a new viewport", async () => {
    await act(async () => {
      pageActions.setCamera("walk");
      pageActions.setCamera("top");
    });
    expect(viewport.cameras).toEqual(["walk", "top"]);
    expect(viewport.created).toBe(1);
  });

  it("feeds the viewport the drawing style, the selection and the pending requests", async () => {
    expect(viewport.options?.labels).toBeInstanceOf(HTMLElement);
    expect(viewport.options?.selected).toBeNull();
    const wall = store.getState().model.walls[0];
    const room = store.getState().model.rooms[0];
    await act(async () => {
      pageActions.selectWall(wall.id);
      pageActions.selectRoom(room.id);
      pageActions.selectItem(null);
      pageActions.setSceneStyle({ edges: false, cutaway: true, cutHeight: 1.5 });
    });
    expect(viewport.options?.style).toEqual(SCENE_STYLE_DEFAULTS);
    expect(viewport.selections).toEqual([{ type: "wall", id: wall.id }, { type: "room", id: room.id }, null]);
    expect(viewport.styles).toEqual([{ edges: false, cutaway: true, cutHeight: 1.5 }]);
    expect(viewport.created).toBe(1);
  });

  it("passes a pending removal on to the viewport, and its end", async () => {
    const room = store.getState().model.rooms[0];
    let settle: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settle = actions.requestApproval({ tool: "remove_room", actor: "agent", request: "Remove a room", targets: [{ type: "room", id: room.id, label: room.label }], effects: [] });
    });
    expect(viewport.pending.at(-1)).toHaveLength(1);
    await act(async () => {
      pageActions.resolveApproval(store.getState().approvals[0].id, false);
      await settle;
    });
    expect(viewport.pending.at(-1)).toEqual([]);
  });

  it("disposes its viewport when it goes, and stops feeding it", async () => {
    await act(async () => root.unmount());
    expect(viewport.disposed).toBe(1);
    dispatch({ type: "add_wall", ax: 30, ay: 0, bx: 34, by: 0 }, { actor: "agent" });
    expect(viewport.models).toHaveLength(0);
    root = createRoot(document.createElement("div")); // for afterEach
  });
});

describe("the 3D view's chrome", () => {
  const hint = () => host.querySelector(".scene-hint")?.textContent ?? "";
  const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  it("offers the three cameras as one radio group, and follows the camera", async () => {
    const radios = [...host.querySelectorAll('[role="radiogroup"][aria-label="Camera"] [role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["Orbit", "Top view", "Walk"]);
    expect(radios.map((r) => r.getAttribute("aria-keyshortcuts"))).toEqual(["1", "2", "3"]);
    await act(async () => pageActions.setCamera("walk"));
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Walk");
  });

  it("teaches the current camera, and names doors only when the plan has one", async () => {
    expect(hint()).toContain("Drag to orbit");
    expect(hint()).toContain("Click a door to open or close it");
    await act(async () => pageActions.setCamera("walk"));
    expect(hint()).toContain("or the arrow keys to walk");
    expect([...host.querySelectorAll(".scene-hint kbd")].length).toBeGreaterThanOrEqual(4);
    await act(async () => {
      for (const o of store.getState().model.openings.filter((x) => x.kind === "door")) {
        dispatch({ type: "remove_opening", id: o.id }, { actor: "human" });
      }
    });
    expect(hint()).not.toContain("door");
  });

  it("says how to finish placing, and Esc or Cancel stops it", async () => {
    await act(async () => pageActions.setDrawMode("place", "sofa"));
    expect(hint()).toContain("Placing Sofa");
    await act(async () => press("Escape"));
    expect(store.getState().editor.drawMode).toBe("select");

    await act(async () => pageActions.setDrawMode("place", "sofa"));
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(store.getState().editor.drawMode).toBe("select");
  });

  it("teaches that a click selects", () => {
    expect(hint()).toContain("Click a wall, room or piece to select it");
  });

  it("opens the View settings, whose switches and slider set the 3D style, and Escape closes it", async () => {
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="View"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = host.querySelector('[role="group"][aria-label="View"]')!;
    const [edges, cutaway] = [...panel.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.disabled).toBe(true);
    expect(edges.checked).toBe(true);
    await act(async () => edges.click());
    await act(async () => cutaway.click());
    expect(store.getState().editor.scene).toMatchObject({ edges: false, cutaway: true });
    expect(slider.disabled).toBe(false);
    expect(Number(slider.min)).toBe(CUT_HEIGHT.min);
    expect(Number(slider.max)).toBe(CUT_HEIGHT.max);
    // React listens for the input event on a range
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "2");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(store.getState().editor.scene.cutHeight).toBe(2);
    expect(panel.textContent).toContain("2.00 m");
    // nothing about the plan changed, and nothing went into the history
    expect(store.getState().undoStack).toHaveLength(0);

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => slider.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="group"][aria-label="View"]')).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves Esc alone when nothing is being placed or selected", async () => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("answers the plan's keys for what a click on the model selected: Delete removes, Ctrl+Z undoes, Esc lets go", async () => {
    const items = () => store.getState().model.items.length;
    const before = items();
    await act(async () => pageActions.selectItem("item_dining"));
    // the selection is named in the hint, a polite status, with the keys that act on it
    const status = host.querySelector('.scene-hint[role="status"]')!;
    expect(status.textContent).toContain("Dining table selected");
    expect(status.textContent).toContain("remove");
    expect(status.textContent).toContain("deselect");
    await act(async () => press("Delete"));
    expect(items()).toBe(before - 1);
    expect(store.getState().editor.selectedItemId).toBeNull();
    const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(undo));
    expect(undo.defaultPrevented).toBe(true);
    expect(items()).toBe(before);
    await act(async () => pageActions.selectRoom("room_bed"));
    expect(status.textContent).toContain("selected");
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(store.getState().editor.selectedRoomId).toBeNull();
    expect(status.textContent).not.toContain("selected");
    // nor a key typed into a field
    await act(async () => pageActions.selectItem("item_dining"));
    const field = document.createElement("input");
    document.body.append(field);
    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
    field.remove();
    expect(items()).toBe(before);
  });

  it("says the cut height once: the slider's value text, its readout hidden from assistive tech", async () => {
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="View"]')!;
    await act(async () => toggle.click());
    const panel = host.querySelector('[role="group"][aria-label="View"]')!;
    expect(panel.querySelector("output")).toBeNull();
    const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.getAttribute("aria-valuetext")).toBe(`${store.getState().editor.scene.cutHeight.toFixed(2)} metres`);
    const readout = panel.querySelector(".scene-view__value")!;
    expect(readout.getAttribute("aria-hidden")).toBe("true");
    expect(panel.querySelector("[aria-live], [role=status]")).toBeNull();
  });
});

describe("the 3D view when the browser cannot draw it", () => {
  it("says so in the canvas, and Try again starts the scene afresh", async () => {
    await act(async () => root.unmount());
    Object.assign(viewport, { created: 0, failWith: new Error("Error creating WebGL context.") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    root = createRoot(host);
    await act(async () => root.render(createElement(Scene3D)));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This browser could not start 3D graphics");
    expect(viewport.created).toBe(0);

    viewport.failWith = null;
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    await act(async () => retry?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(viewport.created).toBe(1);
    warn.mockRestore();
    error.mockRestore();
  });

  it("offers the way back to the plan", async () => {
    await act(async () => root.unmount());
    Object.assign(viewport, { created: 0, failWith: new Error("Error creating WebGL context.") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => pageActions.build3d());
    root = createRoot(host);
    await act(async () => root.render(createElement(Scene3D)));
    const back = [...host.querySelectorAll("button")].find((b) => b.textContent === "Back to the plan");
    await act(async () => back?.click());
    expect(store.getState().editor.view).toBe("2d");
    warn.mockRestore();
    error.mockRestore();
  });
});
