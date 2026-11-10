/**
 * What the page shows about its tools is read off the tools. The approval switch lists the
 * destructive tools and Developer tools counts them from TOOLS, so adding or retiring a tool can
 * never leave the page describing a different set. (The request card's account of a request,
 * and nothing the caller typed, is tested in activityApprovals.test.ts.)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DESTRUCTIVE_TOOL_NAMES, TOOLS } from "../src/mcp/tools";
import { ThemeRoot } from "../src/ui/theme/ThemeRoot";
import { ShellProvider } from "../src/ui/shell/ShellContext";
import { Inspector } from "../src/ui/inspector/Inspector";
import { DeveloperTools } from "../src/ui/activity/DeveloperTools";
import { resetStore } from "./support/store";
// the sources themselves, as text, for the hand-written lists they must no longer carry
import toolsSource from "../src/mcp/tools.ts?raw";
import policySource from "../src/ui/inspector/policy.ts?raw";
import approvalPolicySource from "../src/ui/approvals/ApprovalPolicy.tsx?raw";
import canvasSource from "../src/ui/shell/CanvasRegion.tsx?raw";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(component: () => ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  await act(async () => root!.render(createElement(ThemeRoot, null, createElement(ShellProvider, null, component()))));
  return el;
}

// happy-dom rejects an animation promise when an Astryx control unmounts (as in shell.test.ts)
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

  it("the approval switch lists them", async () => {
    const el = await render(() => createElement(Inspector));
    expect(el.querySelector(".insp-policy__tools .code")?.textContent).toBe(DESTRUCTIVE_TOOL_NAMES.join(", "));
  });

  it("Developer tools counts them", async () => {
    const el = await render(() => createElement(DeveloperTools));
    expect(el.querySelector(".dev-tools__intro")?.textContent).toContain(`The ${TOOLS.length} tools`);
  });

  it("no source file states a tool count or the destructive list by hand", () => {
    expect(toolsSource).not.toMatch(/\b\d+ (WebMCP )?tools\b/);
    for (const source of [policySource, approvalPolicySource]) {
      expect(source).not.toContain("clear_model, remove_wall");
      expect(source).not.toMatch(/wall, door, window, room or item/);
    }
    // a key that is constant while the component is mounted did nothing
    expect(canvasSource).not.toMatch(/<Scene3D key=/);
  });
});
