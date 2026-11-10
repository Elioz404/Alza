/**
 * The 3D view's lifecycle. Its renderer — a WebGL context — used to be created in an effect
 * that depended on the plan, so every change made a new context: forty agent edits, forty
 * contexts, past the browser's cap. The viewport is now created once per mount and fed the
 * plan through a store subscription, outside React's render.
 *
 * The viewport itself needs WebGL; here it is replaced by a recorder, which is all the
 * component's side of the contract needs.
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
}));

vi.mock("../src/three/viewport", () => ({
  createViewport: () => {
    viewport.created++;
    return {
      setModel: (m: unknown) => viewport.models.push(m),
      setCamera: (c: string) => viewport.cameras.push(c),
      dispose: () => viewport.disposed++,
    };
  },
}));

const { Scene3D } = await import("../src/three/Scene3D");

let root: Root;
let renders = 0;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
  Object.assign(viewport, { created: 0, disposed: 0, models: [], cameras: [] });
  renders = 0;
  root = createRoot(document.createElement("div"));
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
