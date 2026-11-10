/**
 * The 3D view is fetched on demand, and a fetch can fail: a stale chunk after a redeploy, a
 * dropped connection. A rejected lazy import used to reach the root and unmount everything —
 * editor, side panel, approval queue — for the one view that failed. Now the failure stays in the
 * canvas area, which offers to try again.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LazyView, type ViewLoader } from "../src/ui/LazyView";
import { pageActions } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { resetStore } from "./support/store";

// the 3D view's chunk is gone (a redeploy replaced its hash), so importing it rejects
vi.mock("../src/three/Scene3D", () => {
  throw new Error("Failed to fetch dynamically imported module");
});
// the partner frame would load a page from another origin; it plays no part here
vi.mock("../src/ui/SupplierBridge", () => ({ SupplierBridge: () => null }));

const { App } = await import("../src/ui/App");

let host: HTMLDivElement;
let root: Root;

/** Let a rejected or resolved import reach React, and React re-render. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("a 3D view that cannot be loaded", () => {
  it("fails inside the canvas area and leaves the rest of the app mounted", async () => {
    await act(async () => root.render(createElement(App)));
    expect(host.querySelector(".editor-svg")).not.toBeNull();
    await act(async () => pageActions.setView("3d"));
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load the 3D view");
    expect(host.querySelector(".topbar")).not.toBeNull();
    expect(host.querySelector(".side")).not.toBeNull();

    // and the way back to the editor still works
    await act(async () => pageActions.setView("2d"));
    expect(host.querySelector(".editor-svg")).not.toBeNull();
    expect(host.querySelector(".side")).not.toBeNull();
  });
});

describe("LazyView", () => {
  it("tries the import again on Retry, and shows the view once it arrives", async () => {
    const Loaded = () => createElement("p", { className: "loaded" }, "here");
    const load = vi
      .fn<ViewLoader>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Loaded });
    const failed = (retry: () => void) => createElement("button", { className: "retry", onClick: retry }, "Retry");
    await act(async () => root.render(createElement(LazyView, { load, loading: "loading", failed })));
    await settle();
    expect(host.querySelector(".retry")).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => (host.querySelector(".retry") as HTMLButtonElement).click());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".loaded")?.textContent).toBe("here");
    expect(host.querySelector(".retry")).toBeNull();
  });
});
