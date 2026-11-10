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
import { pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { resetStore } from "./support/store";

const viewport = vi.hoisted(() => ({
  created: 0,
  disposed: 0,
  models: [] as unknown[],
  cameras: [] as string[],
  /** when set, creating a viewport throws this, as WebGLRenderer does without a context */
  failWith: null as Error | null,
}));

vi.mock("../src/three/viewport", () => ({
  createViewport: () => {
    if (viewport.failWith) throw viewport.failWith;
    viewport.created++;
    return {
      setModel: (m: unknown) => viewport.models.push(m),
      setCamera: (c: string) => viewport.cameras.push(c),
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
  Object.assign(viewport, { created: 0, disposed: 0, models: [], cameras: [], failWith: null });
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

  it("leaves Esc alone when nothing is being placed", async () => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
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
