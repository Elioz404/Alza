/**
 * The first-run state on an empty sheet: it shows only while there is nothing to look at, its
 * two draw buttons pick the rail's draw modes (and hand the sheet back to the drawing), and the
 * demo link loads Sunset Loft as the human, with Undo to bring the empty plan back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pageActions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { resetStore } from "./support/store";

vi.mock("../src/ui/SupplierBridge", () => ({ SupplierBridge: () => null }));

// happy-dom's Animation.cancel() rejects a promise nobody observes when Astryx's segmented
// control unmounts (see tests/shell.test.ts).
const animate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, "animate", { value: undefined, configurable: true, writable: true });
});
afterAll(() => {
  if (animate) Object.defineProperty(Element.prototype, "animate", animate);
});

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetStore();
  dispatch({ type: "clear_model" }, { actor: "system", undoable: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const { App } = await import("../src/ui/App");
  await act(async () => root.render(createElement(App)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const firstRun = () => host.querySelector(".first-run");
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".first-run button")].find((b) => b.textContent?.startsWith(label));

describe("the first-run state", () => {
  it("shows on an empty plan, with one primary action", () => {
    expect(firstRun()?.textContent).toContain("Draw your space at true size");
    expect(host.querySelectorAll(".first-run .btn--primary")).toHaveLength(1);
    expect(button("Draw a room")?.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(button("Draw walls")?.getAttribute("aria-keyshortcuts")).toBe("W");
  });

  it("hands the sheet to the tool it picks, and comes back on Select", async () => {
    await act(async () => button("Draw a room")?.click());
    expect(store.getState().editor.drawMode).toBe("room");
    expect(firstRun()).toBeNull();
    await act(async () => pageActions.setDrawMode("select"));
    expect(firstRun()).not.toBeNull();
    await act(async () => button("Draw walls")?.click());
    expect(store.getState().editor.drawMode).toBe("wall");
  });

  it("loads the demo as the human, and Undo brings the empty plan back", async () => {
    await act(async () => button("Open the Sunset Loft demo")?.click());
    expect(store.getState().model.walls.length).toBe(seedLoft().walls.length);
    expect(store.getState().activity.at(-1)?.source).toBe("human");
    expect(firstRun()).toBeNull();
    await act(async () => dispatch({ type: "undo" }, { actor: "human" }));
    expect(firstRun()).not.toBeNull();
  });

  it("states the approval policy as it is", async () => {
    expect(firstRun()?.textContent).toContain("Anything destructive waits for your approval.");
    await act(async () => pageActions.setRequireApproval(false));
    expect(firstRun()?.textContent).toContain("Destructive changes run without asking");
  });

  it("stays away from a plan with anything on it", async () => {
    await act(async () => dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, { actor: "human" }));
    expect(firstRun()).toBeNull();
  });
});
