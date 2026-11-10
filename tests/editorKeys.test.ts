/**
 * The 2D editor's keyboard handler is subscribed once for the editor's lifetime and reads the
 * selection from the store when a key is pressed — re-subscribing it on every change to the
 * editor state added and removed a window listener per click, and a handler that captured the
 * state it was made with could act on a selection that had already changed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { Editor } from "../src/editor/Editor";
import { resetStore } from "./support/store";

let root: Root;
let added: { mock: { calls: unknown[][] } };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
  added = vi.spyOn(window, "addEventListener");
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Editor)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

const keydowns = () => added.mock.calls.filter((call) => call[0] === "keydown").length;
const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key }));

describe("Editor keyboard", () => {
  it("subscribes once, whatever the editor and the plan do", async () => {
    expect(keydowns()).toBe(1);
    const walls = store.getState().model.walls;
    await act(async () => {
      for (const w of walls) pageActions.selectWall(w.id);
      pageActions.setDrawMode("wall");
      pageActions.setDrawMode("select");
      dispatch({ type: "add_wall", ax: 20, ay: 0, bx: 24, by: 0 }, { actor: "agent" });
    });
    expect(keydowns()).toBe(1);
  });

  it("acts on the selection as it is when the key is pressed", async () => {
    const [first, second] = store.getState().model.walls;
    await act(async () => pageActions.selectWall(first.id));
    // the selection moves without React rendering in between
    pageActions.selectWall(second.id);
    await act(async () => press("Delete"));
    const ids = store.getState().model.walls.map((w) => w.id);
    expect(ids).toContain(first.id);
    expect(ids).not.toContain(second.id);
  });
});
