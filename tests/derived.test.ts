/**
 * What the page shows about its tools is read off the tools. The approval toggle lists the
 * destructive tools and the Tools tab counts them from TOOLS, so adding or retiring a tool can
 * never leave the page describing a different set. The approval bar, rendered, shows the page's
 * account of a request and nothing the caller typed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actions, store } from "../src/model/store";
import { executeWrapped } from "../src/mcp/registry";
import { DESTRUCTIVE_TOOL_NAMES, TOOLS } from "../src/mcp/tools";
import { seedLoft } from "../src/model/seed";
import { Sidebar } from "../src/ui/Sidebar";
import { ApprovalBar } from "../src/ui/ApprovalBar";
import { flush, resetStore } from "./support/store";
// the sources themselves, as text, for the hand-written lists they must no longer carry
import toolsSource from "../src/mcp/tools.ts?raw";
import sidebarSource from "../src/ui/Sidebar.tsx?raw";
import appSource from "../src/ui/App.tsx?raw";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(component: () => ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  await act(async () => root!.render(component()));
  return el;
}

const click = async (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const tab = (el: Element, label: string) => [...el.querySelectorAll(".sidebar-tabs button")].find((b) => b.textContent?.startsWith(label))!;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  // the test DOM has no WebGL, so the catalogue thumbnails fall back to swatches (and say why)
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe("lists the page derives from TOOLS", () => {
  it("the destructive tools are exactly the ones annotated so", () => {
    expect(DESTRUCTIVE_TOOL_NAMES).toEqual(TOOLS.filter((t) => t.annotations?.destructiveHint).map((t) => t.name));
  });

  it("the approval toggle lists them", async () => {
    const el = await render(() => createElement(Sidebar));
    await click(tab(el, "Model"));
    const small = el.querySelector(".toggle-row small");
    expect(small?.textContent).toBe(DESTRUCTIVE_TOOL_NAMES.join(", "));
  });

  it("the Tools tab counts them", async () => {
    const el = await render(() => createElement(Sidebar));
    await click(tab(el, "Tools"));
    expect(el.querySelector(".panel .hint")?.textContent).toContain(`exact ${TOOLS.length} tools`);
  });

  it("no source file states a tool count or the destructive list by hand", () => {
    expect(toolsSource).not.toMatch(/\b\d+ (WebMCP )?tools\b/);
    expect(sidebarSource).not.toContain("clear_model, remove_wall");
    // a key that is constant while the component is mounted did nothing
    expect(appSource).not.toMatch(/<Scene3D key=/);
  });
});

describe("the approval bar", () => {
  it("shows the resolved entity, not the reference the caller sent", async () => {
    actions.loadModel(seedLoft());
    const call = executeWrapped(TOOLS.find((t) => t.name === "remove_room")!, { id: "BeDrOoM" });
    await flush();
    const el = await render(() => createElement(ApprovalBar));
    const text = el.textContent ?? "";
    expect(text).toContain("AGENT WANTS TO");
    expect(text).toContain("Remove room room_bed");
    expect(el.querySelector(".approval-target-label")?.textContent).toBe("“Bedroom”");
    expect(text).not.toContain("BeDrOoM");
    await click(el.querySelector(".approval-actions .reject")!);
    expect((await call).ok).toBe(false);
    expect(store.getState().approvals).toHaveLength(0);
  });

  it("lists the side effects the page counted", async () => {
    actions.loadModel(seedLoft());
    const call = executeWrapped(TOOLS.find((t) => t.name === "remove_wall")!, { id: "wall_e" });
    await flush();
    const el = await render(() => createElement(ApprovalBar));
    expect(el.querySelector(".approval-effect")?.textContent).toMatch(/2 openings on it/);
    await click(el.querySelector(".approval-actions .approve")!);
    expect((await call).ok).toBe(true);
    expect(store.getState().model.openings.some((o) => o.wallId === "wall_e")).toBe(false);
  });
});
