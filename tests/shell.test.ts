/**
 * The shell: the rail's tools act through the actions that already exist, the shell's
 * shortcuts stand aside for typing and for the walker's keys, the top bar states what can and
 * cannot happen (3D on an empty plan, Undo with nothing to undo, Export in 2D), and the page
 * renders with no <style> element, which the CSP would refuse.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { handleShellKey, SHORTCUT_SHEET } from "../src/ui/shell/shortcuts";
import { RAIL_TOOLS, toolsFor } from "../src/ui/shell/tools";
import { getPlanTool } from "../src/editor/canvasState";
import { Kbd } from "../src/ui/primitives/Kbd";
import { noThreeDReason } from "../src/ui/shell/TopBar";
import type { ShellState } from "../src/ui/shell/ShellContext";
import { resetStore } from "./support/store";
import { loadDeferred } from "./support/deferred";
import indexHtml from "../index.html?raw";

vi.mock("../src/ui/SupplierBridge", () => ({ SupplierBridge: () => null }));

const fakeShell = (): ShellState => ({
  tab: "properties",
  setTab: vi.fn(),
  panelOpen: false,
  setPanelOpen: vi.fn(),
  openPanel: vi.fn(),
  activityOpen: true,
  setActivityOpen: vi.fn(),
  focusApprovals: vi.fn(),
  helpOpen: false,
  setHelpOpen: vi.fn(),
});

const key = (k: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
});

describe("the rail's shortcuts", () => {
  it("pick the editor's draw modes in Plan view", () => {
    const shell = fakeShell();
    expect(handleShellKey(key("w"), shell)).toBe(true);
    expect(store.getState().editor.drawMode).toBe("wall");
    expect(handleShellKey(key("R"), shell)).toBe(true);
    expect(store.getState().editor.drawMode).toBe("room");
    expect(handleShellKey(key("v"), shell)).toBe(true);
    expect(store.getState().editor.drawMode).toBe("select");
  });

  it("pick the editor's own tools (door, window, pan), and Select puts them down", () => {
    const shell = fakeShell();
    const pressed = () => toolsFor("2d").filter((t) => t.isActive(store.getState().editor, getPlanTool())).map((t) => t.id);
    expect(handleShellKey(key("d"), shell)).toBe(true);
    expect(getPlanTool()).toBe("door");
    expect(pressed()).toEqual(["door"]);
    handleShellKey(key("n"), shell);
    expect(pressed()).toEqual(["window"]);
    handleShellKey(key("h"), shell);
    expect(pressed()).toEqual(["pan"]);
    handleShellKey(key("w"), shell);
    expect(getPlanTool()).toBeNull();
    expect(pressed()).toEqual(["wall"]);
    handleShellKey(key("d"), shell);
    expect(store.getState().editor.drawMode).toBe("select");
    handleShellKey(key("v"), shell);
    expect(getPlanTool()).toBeNull();
    expect(pressed()).toEqual(["select"]);
  });

  it("F opens the Library, where placing starts", () => {
    const shell = fakeShell();
    handleShellKey(key("f"), shell);
    expect(shell.openPanel).toHaveBeenCalledWith("library");
  });

  it("leave W alone in 3D, where it walks, and use digits for the cameras", () => {
    store.setState((s) => ({ editor: { ...s.editor, view: "3d" } }));
    const shell = fakeShell();
    expect(handleShellKey(key("w"), shell)).toBe(false);
    expect(handleShellKey(key("3"), shell)).toBe(true);
    expect(store.getState().editor.camera).toBe("walk");
  });

  it("stand aside while the person types, and for chords", () => {
    const shell = fakeShell();
    const input = document.createElement("input");
    expect(handleShellKey(key("w", {}, input), shell)).toBe(false);
    expect(handleShellKey(key("z", { ctrlKey: true }), shell)).toBe(false);
    expect(store.getState().editor.drawMode).toBe("select");
  });

  it("? opens the shortcut sheet", () => {
    const shell = fakeShell();
    handleShellKey(key("?"), shell);
    expect(shell.setHelpOpen).toHaveBeenCalledWith(true);
  });

  it("each tool has its own key within its view", () => {
    for (const view of ["2d", "3d"] as const) {
      const keys = toolsFor(view).map((t) => t.shortcut);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(RAIL_TOOLS.filter((t) => t.view === "3d").map((t) => t.shortcut)).not.toContain("w");
  });

  it("the shortcut sheet lists every rail tool", () => {
    const listed = SHORTCUT_SHEET.flatMap((g) => g.rows.map((r) => r.does));
    for (const t of RAIL_TOOLS) expect(listed).toContain(t.label);
  });
});

describe("the top bar says why", () => {
  it("3D needs a wall", () => {
    expect(noThreeDReason(0)).toMatch(/wall/);
    expect(noThreeDReason(3)).toBeNull();
  });
});

describe("the rendered shell", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it("mounts every region, the four tabs and Activity, and writes no <style>", async () => {
    // the page's own head: its marker is what keeps Astryx's anchored layers from injecting their rules
    document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(indexHtml)![1];
    const { App } = await import("../src/ui/App");
    await act(async () => root.render(createElement(App)));
    // Activity's details (with Developer tools) arrive after the first paint
    await loadDeferred();
    expect(host.querySelector(".topbar")).not.toBeNull();
    expect(host.querySelector('.rail[role="toolbar"]')).not.toBeNull();
    expect(host.querySelector(".editor-svg")).not.toBeNull();
    const tabs = [...host.querySelectorAll('.side [role="tab"]')].map((t) => t.textContent ?? "");
    expect(tabs).toHaveLength(4);
    ["Properties", "Library", "Issues", "Notes"].forEach((label, i) => expect(tabs[i].startsWith(label)).toBe(true));
    expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(host.querySelector(".activity")?.textContent).toContain("Activity");
    expect(host.querySelector(".dev-tools")?.textContent).toContain("Developer tools");
    expect([...document.querySelectorAll("style")].map((s) => s.id || s.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("keys pressed inside the shortcut sheet never reach the plan behind it", async () => {
    const { App } = await import("../src/ui/App");
    await act(async () => root.render(createElement(App)));
    const wall = store.getState().model.walls[0].id;
    await act(async () => store.setState((s) => ({ editor: { ...s.editor, selectedWallId: wall } })));
    await act(async () => document.body.dispatchEvent(key("?")));
    // the sheet's code arrives the first time it opens
    for (let i = 0; i < 50 && !document.querySelector("dialog[open]"); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
    const sheet = document.querySelector("dialog[open]");
    expect(sheet?.textContent).toContain("Keyboard shortcuts");
    const inside = sheet!.querySelector("button") ?? sheet!;
    for (const k of ["w", "d", "Delete"]) await act(async () => inside.dispatchEvent(key(k)));
    await act(async () => inside.dispatchEvent(key("z", { ctrlKey: true })));
    expect(store.getState().editor.drawMode).toBe("select");
    expect(getPlanTool()).toBeNull();
    expect(store.getState().model.walls.some((w) => w.id === wall)).toBe(true);
    expect(store.getState().editor.selectedWallId).toBe(wall);
  });

  it("the rail shows each tool's key and groups Select with Pan", async () => {
    const { App } = await import("../src/ui/App");
    await act(async () => root.render(createElement(App)));
    const rail = host.querySelector('.rail[role="toolbar"]')!;
    const labels = [...rail.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels.slice(0, 2)).toEqual(["Select", "Pan"]);
    expect([...rail.querySelectorAll(".rail__key")].map((k) => k.textContent)).toEqual(toolsFor("2d").map((t) => t.shortcut.toUpperCase()));
    expect(rail.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(rail.querySelector(".rail__key")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the note composer sits outside Activity's scrolling body, and stays when Activity folds", async () => {
    const { App } = await import("../src/ui/App");
    await act(async () => root.render(createElement(App)));
    const activity = host.querySelector(".activity")!;
    const composer = activity.querySelector(".note-form--activity")!;
    expect(composer).not.toBeNull();
    expect(activity.querySelector(".activity__body")?.contains(composer)).toBe(false);
    await act(async () => (activity.querySelector(".activity__toggle") as HTMLButtonElement).click());
    expect(activity.querySelector(".activity__body")?.hasAttribute("hidden")).toBe(true);
    expect(activity.querySelector(".note-form--activity")).not.toBeNull();
  });

  it("Undo is disabled with its reason until there is something to undo", async () => {
    const { App } = await import("../src/ui/App");
    await act(async () => root.render(createElement(App)));
    const undo = host.querySelector('button[aria-label="Undo"]')!;
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(host.textContent).toContain("Nothing to undo");
    await act(async () => {
      dispatch({ type: "set_plan_name", name: "Flat" }, { actor: "human" });
    });
    expect(undo.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("shortcut chips", () => {
  it("draw one chip per key, with one spoken name for the shortcut", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () =>
      r.render(createElement("div", null, createElement(Kbd, { keys: "mod+z" }), createElement(Kbd, { keys: "shift++" }), createElement(Kbd, { keys: "esc" }))),
    );
    const [undo, zoomIn, esc] = [...host.querySelectorAll<HTMLElement>('[role="img"]')];
    // happy-dom is not an Apple platform: the modifier is Control, written Ctrl
    expect([...undo.querySelectorAll(".kbd__key")].map((k) => k.textContent)).toEqual(["Ctrl", "Z"]);
    expect(undo.getAttribute("aria-label")).toBe("Control + Z");
    expect(zoomIn.getAttribute("aria-label")).toBe("Shift + Plus");
    expect(esc.textContent).toBe("Esc");
    expect(esc.getAttribute("aria-label")).toBe("Escape");
    // the chips themselves are not read: the shortcut's name is
    for (const key of host.querySelectorAll(".kbd__key")) expect(key.getAttribute("aria-hidden")).toBe("true");
    await act(async () => r.unmount());
    host.remove();
  });

  it("write word keys as a keyboard does, not in capitals", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => r.render(createElement("div", null, createElement(Kbd, { keys: "del" }), createElement(Kbd, { keys: "space" }))));
    expect([...host.querySelectorAll(".kbd__key")].map((k) => k.textContent)).toEqual(["Del", "Space"]);
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Del");
    await act(async () => r.unmount());
    host.remove();
  });
});
