/**
 * The side panel's surfaces, rendered: Properties edits through commands as the human, Issues
 * names entities and selects them, Notes and the composer leave the human's note, the Library
 * starts placing, and the tool runner runs a tool as the human.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { store, actions } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { issuesOf } from "../src/model/issues";
import { DESTRUCTIVE_TOOL_NAMES, TOOLS } from "../src/mcp/tools";
import { ThemeRoot } from "../src/ui/theme/ThemeRoot";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { Inspector } from "../src/ui/inspector/Inspector";
import { Issues, describeIssue } from "../src/ui/issues/Issues";
import { Notes } from "../src/ui/notes/Notes";
import { NoteComposer } from "../src/ui/notes/NoteComposer";
import { Library } from "../src/ui/library/Library";
import { ToolRunner } from "../src/ui/activity/ToolRunner";
import { PLAN_NAME_FIELD_ID } from "../src/ui/shell/ids";
import { resetStore, flush } from "./support/store";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const animate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, "animate", { value: undefined, configurable: true, writable: true });
});
afterAll(() => {
  if (animate) Object.defineProperty(Element.prototype, "animate", animate);
});
beforeEach(() => {
  resetStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, node))));
  return host;
}
const click = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("right panel", () => {
  it("plan inspector shows the derived policy and the plan name field", async () => {
    const el = await render(createElement(Inspector));
    expect(el.querySelector(`#${PLAN_NAME_FIELD_ID}`)).not.toBeNull();
    expect(el.querySelector(".insp-policy__tools .code")?.textContent).toBe(DESTRUCTIVE_TOOL_NAMES.join(", "));
    expect(el.textContent).toContain("erase the whole plan");
    expect(el.textContent).toContain("Walls");
  });

  it("wall inspector edits through commands", async () => {
    actions.selectWall("wall_s");
    const el = await render(createElement(Inspector));
    expect(el.textContent).toContain("Openings on this wall");
    expect(el.textContent).toContain("Door 1");
    const addWindow = [...el.querySelectorAll("button")].find((b) => b.textContent === "Window")!;
    const before = store.getState().model.openings.length;
    await click(addWindow);
    expect(store.getState().model.openings.length).toBe(before + 1);
    expect(store.getState().activity.at(-1)?.tool).toBe("add_window");
    expect(store.getState().activity.at(-1)?.source).toBe("human");
    const del = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Delete wall"))!;
    await click(del);
    expect(store.getState().model.walls.some((w) => w.id === "wall_s")).toBe(false);
    expect(store.getState().editor.selectedWallId).toBeNull();
  });

  it("room and item inspectors render", async () => {
    actions.selectRoom("room_bed");
    let el = await render(createElement(Inspector));
    expect(el.textContent).toContain("Floor finish");
    await act(async () => root!.unmount());
    actions.selectItem(store.getState().model.items[0].id);
    el = await render(createElement(Inspector));
    expect(el.textContent).toContain("Rotation");
  });

  it("issues name entities, not ids", async () => {
    dispatch({ type: "add_wall", ax: 20, ay: 20, bx: 22, by: 20 }, { actor: "human" });
    const model = store.getState().model;
    const views = issuesOf(model).map((i) => describeIssue(model, i));
    const loose = views.find((v) => v.code === "wall_loose_end")!;
    expect(loose.sentence).toMatch(/^Wall 8 has a loose end/);
    const el = await render(createElement(Issues));
    expect(el.textContent).toContain("Warnings");
    const btn = [...el.querySelectorAll(".issue__button")].find((b) => b.textContent?.includes("Wall 8"))!;
    await click(btn);
    expect(store.getState().editor.selectedWallId).toBe(model.walls[7].id);
  });

  it("empty plan says nothing to check", async () => {
    dispatch({ type: "clear_model" }, { actor: "human" });
    const el = await render(createElement(Issues));
    expect(el.textContent).toContain("Nothing to check yet");
  });

  it("notes: composer adds a human note; composer hides on notes tab", async () => {
    const el = await render(createElement("div", null, createElement(Notes), createElement(NoteComposer)));
    // tab is properties: both composers present
    expect(el.querySelectorAll("form.note-form").length).toBe(2);
    const ta = el.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, "Check the north wall");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
    expect(store.getState().notes.at(-1)).toMatchObject({ author: "human", text: "Check the north wall" });
    expect(el.textContent).toContain("You");
  });

  it("library places a piece", async () => {
    const el = await render(createElement(Library));
    const sofa = [...el.querySelectorAll(".piece")].find((b) => b.textContent?.startsWith("Sofa"))!;
    await click(sofa);
    expect(store.getState().editor).toMatchObject({ drawMode: "place", placingKind: "sofa" });
    const chip = [...el.querySelectorAll(".chip")].find((b) => b.textContent === "Bath")!;
    await click(chip);
    expect(el.querySelectorAll(".piece").length).toBeGreaterThan(0);
    expect([...el.querySelectorAll(".piece")].every((p) => !p.textContent?.startsWith("Sofa"))).toBe(true);
  });

  it("tool runner lists every tool and runs one as the human", async () => {
    const el = await render(createElement(ToolRunner));
    expect(el.querySelectorAll("select option").length).toBe(TOOLS.length + 1);
    const run = [...el.querySelectorAll("button")].find((b) => b.textContent === "Run tool")!;
    await click(run);
    await act(async () => flush());
    expect(el.querySelector(".runner__result-body")?.textContent).toContain('"ok": true');
  });
});
