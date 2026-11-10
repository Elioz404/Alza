/**
 * Activity and approvals, rendered: the request card shows the page's account of a request
 * (never what the caller typed) and answers it with its buttons and keys; the queue and the
 * activity rows point at the same request; feed lines name entities, not ids; the tool count is
 * read off the tools.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { executeWrapped } from "../src/mcp/registry";
import { TOOLS } from "../src/mcp/tools";
import { seedLoft } from "../src/model/seed";
import { ThemeRoot } from "../src/ui/theme";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { PlanMarks } from "../src/ui/approvals/PlanMarks";
import { ApprovalQueue } from "../src/ui/approvals/ApprovalQueue";
import { ApprovalPolicy } from "../src/ui/approvals/ApprovalPolicy";
import { policySentence } from "../src/ui/inspector/policy";
import { ActivityList } from "../src/ui/activity/Activity";
import { DeveloperTools } from "../src/ui/activity/DeveloperTools";
import { segmentsOf } from "../src/ui/activity/entities";
import { wallName } from "../src/ui/inspector/entities";
import { kindOf } from "../src/ui/activity/revisions";
import { provenance } from "../src/model/provenance";
import { requestText } from "../src/ui/approvals/describe";
import { flush, resetStore } from "./support/store";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(...children: (() => ReactNode)[]): Promise<HTMLDivElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  await act(async () =>
    root!.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, ...children.map((c, i) => createElement(c, { key: i }))))),
  );
  return el;
}

const click = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const press = async (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const buttonNamed = (el: Element, name: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  actions.loadModel(seedLoft());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe("feed lines name entities, not ids", () => {
  it("folds a type word and an id into the entity's name", () => {
    const model = store.getState().model;
    const segs = segmentsOf("Wall wall_e updated.", model);
    // the name Properties and Issues give it: "Wall N", by its place in the plan
    const wallE = wallName(model, model.walls.find((w) => w.id === "wall_e")!);
    expect(wallE).toMatch(/^Wall \d+$/);
    expect(segs.map((s) => s.text).join("")).toBe(`${wallE} updated.`);
    expect(segs.find((s) => s.kind === "entity")).toMatchObject({ ref: { type: "wall", id: "wall_e" } });
    expect(segmentsOf("Item item_sofa moved to (3.00, 5.00).", model).map((s) => s.text).join("")).toBe("Sofa moved to (3.00, 5.00).");
  });

  it("links a room named by its label, and leaves a removed id as code", () => {
    const model = store.getState().model;
    expect(segmentsOf('Room "Bedroom" updated.', model)).toContainEqual({ kind: "entity", ref: { type: "room", id: "room_bed" }, text: "Bedroom" });
    expect(segmentsOf("Wall wall_gone removed.", model)).toContainEqual({ kind: "code", text: "wall_gone" });
    expect(segmentsOf("Wall added (3.20 m).", model)).toEqual([{ kind: "text", text: "Wall added (3.20 m)." }]);
  });
});

describe("the request card", () => {
  it("shows the resolved entity, not the reference the caller sent, and Keep refuses it", async () => {
    const call = executeWrapped(tool("remove_room"), { id: "BeDrOoM" });
    await flush();
    const el = await render(PlanMarks);
    const card = el.querySelector('[role="alertdialog"]')!;
    const text = card.textContent ?? "";
    expect(text).toContain("Your agent wants to remove a room");
    expect(text).toContain("room_bed");
    expect(card.querySelector("q")?.textContent).toBe("Bedroom");
    expect(text).not.toContain("BeDrOoM");
    // the name someone typed is never the action
    expect(buttonNamed(card, "Remove room")).not.toBeNull();
    await click(buttonNamed(card, "Keep room")!);
    expect((await call).ok).toBe(false);
    expect(store.getState().approvals).toHaveLength(0);
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("lists the side effects the page counted, and Ctrl+Enter confirms", async () => {
    const call = executeWrapped(tool("remove_wall"), { id: "wall_e" });
    await flush();
    const el = await render(PlanMarks);
    expect(el.querySelector(".approval-card__effect")?.textContent).toMatch(/2 openings on it/);
    // from the page, with focus outside the card
    await press(document.body, "Enter", { ctrlKey: true });
    expect((await call).ok).toBe(true);
    expect(store.getState().model.openings.some((o) => o.wallId === "wall_e")).toBe(false);
  });

  it("Escape on the card keeps; Ctrl+Enter typed into a field elsewhere does nothing", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "item_sofa" });
    await flush();
    const el = await render(PlanMarks);
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    await press(field, "Enter", { ctrlKey: true });
    expect(store.getState().approvals).toHaveLength(1);
    field.remove();
    await press(el.querySelector('[role="alertdialog"]')!, "Escape");
    expect((await call).ok).toBe(false);
    expect(store.getState().model.items.some((i) => i.id === "item_sofa")).toBe(true);
  });

  it("Escape keeps from anywhere on the page too, as Ctrl+Enter confirms from anywhere", async () => {
    const call = executeWrapped(tool("remove_wall"), { id: "wall_n" });
    await flush();
    await render(PlanMarks);
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    await press(elsewhere, "Escape");
    elsewhere.remove();
    expect((await call).ok).toBe(false);
    expect(store.getState().model.walls.some((w) => w.id === "wall_n")).toBe(true);
  });

  it("neither answers from inside another dialog or a menu, where the request cannot be seen", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "item_sofa" });
    await flush();
    await render(PlanMarks);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const inDialog = document.createElement("button");
    dialog.appendChild(inDialog);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    menu.appendChild(item);
    document.body.append(dialog, menu);
    await press(inDialog, "Enter", { ctrlKey: true });
    await press(item, "Enter", { ctrlKey: true });
    await press(item, "Escape");
    expect(store.getState().approvals).toHaveLength(1);
    dialog.remove();
    menu.remove();
    await act(async () => void actions.resolveApproval(store.getState().approvals[0].id, false));
    expect((await call).ok).toBe(false);
  });

  it("pages through several requests, oldest first", async () => {
    const first = executeWrapped(tool("remove_room"), { id: "room_bath" });
    const second = executeWrapped(tool("remove_item"), { id: "item_plant" });
    await flush();
    const el = await render(PlanMarks);
    expect(el.querySelector(".approval-card__meta")?.textContent).toContain("1 of 2");
    await click(buttonNamed(el.querySelector('[role="alertdialog"]')!, "Keep room")!);
    expect((await first).ok).toBe(false);
    expect(el.querySelector(".approval-card__title")?.textContent).toBe(requestText(store.getState().approvals[0]).title);
    await click(buttonNamed(el.querySelector('[role="alertdialog"]')!, "Remove item")!);
    expect((await second).ok).toBe(true);
  });
});

describe("Waiting for you and Activity", () => {
  it("the queue and the activity row show the same request, waiting, with Review", async () => {
    const call = executeWrapped(tool("remove_room"), { id: "room_bath" });
    await flush();
    const el = await render(ApprovalQueue, ActivityList);
    const queue = el.querySelector(".queue")!;
    expect(queue.hasAttribute("hidden")).toBe(false);
    expect(queue.textContent).toContain("Remove a room");
    expect(queue.querySelector("q")?.textContent).toBe("Bathroom");
    expect(buttonNamed(queue, "Review")).not.toBeNull();
    const pending = el.querySelector(".act-row--pending")!;
    expect(pending.textContent).toContain("Waiting for you");
    expect(buttonNamed(pending, "Review")).not.toBeNull();
    await act(async () => void actions.resolveApproval(store.getState().approvals[0].id, false));
    expect((await call).ok).toBe(false);
    expect(el.querySelector(".act-row--pending")).toBeNull();
    expect(queue.hasAttribute("hidden")).toBe(true);
  });

  it("numbers a change as the drawing does, and not a read", async () => {
    dispatch({ type: "edit_wall", id: "wall_e", patch: { height: 2.8 } }, { actor: "agent" });
    await executeWrapped(tool("get_issues"), {});
    const [edit, read] = store.getState().activity.slice(-2);
    expect(kindOf(edit)).toBe("revision");
    expect(kindOf(read)).toBe("read");
    const n = provenance.getState().revisions.find((r) => r.entryId === edit.id)?.n;
    expect(n).toBeGreaterThan(0);
    const el = await render(ActivityList);
    const rows = el.querySelectorAll(".act-row");
    expect(rows[1].querySelector(".delta__num")?.textContent).toBe(String(n));
    expect(rows[0].querySelector(".delta__num")).toBeNull();
  });

  it("a linked name selects the entity", async () => {
    dispatch({ type: "edit_wall", id: "wall_e", patch: { height: 2.8 } }, { actor: "agent" });
    const el = await render(ActivityList);
    const model = store.getState().model;
    const name = wallName(model, model.walls.find((w) => w.id === "wall_e")!);
    const link = [...el.querySelectorAll(".entity-link")].find((b) => b.textContent === name)!;
    await click(link);
    expect(store.getState().editor.selectedWallId).toBe("wall_e");
  });

  it("the policy line says what the switch is set to", async () => {
    const el = await render(ApprovalPolicy);
    expect(el.textContent).toContain(policySentence(true));
    await act(async () => store.setState({ requireApproval: false }));
    expect(el.textContent).toContain(policySentence(false));
  });

  it("announces a new entry once, and not the old rows a filter reveals", async () => {
    dispatch({ type: "edit_wall", id: "wall_e", patch: { height: 2.8 } }, { actor: "agent" });
    const el = await render(ActivityList);
    expect(el.querySelector(".act__rows")?.hasAttribute("aria-live")).toBe(false);
    const live = el.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("");
    const you = [...el.querySelectorAll('[role="radio"], button')].find((r) => r.textContent?.trim() === "You")!;
    await click(you);
    expect(live.textContent).toBe("");
    await act(async () => void dispatch({ type: "set_plan_name", name: "Flat" }, { actor: "agent" }));
    expect(live.textContent).toMatch(/^Agent: /);
  });

  it("Developer tools labels each tool by what it is, and says which ask first", async () => {
    const el = await render(DeveloperTools);
    const options = [...el.querySelectorAll("option")].map((o) => o.textContent ?? "");
    expect(options).toContain("get_model (reads)");
    expect(options).toContain("set_camera (edits)");
    expect(options).toContain("remove_wall (removes, asks first)");
    await act(async () => store.setState({ requireApproval: false }));
    expect([...el.querySelectorAll("option")].map((o) => o.textContent)).toContain("remove_wall (removes)");
  });

  it("Developer tools counts the tools from the list", async () => {
    const el = await render(DeveloperTools);
    expect(el.querySelector(".dev-tools__intro")?.textContent).toContain(`${TOOLS.length} tools`);
  });
});
