/**
 * How the dev scripts find their way around the studio's interface: the side panel's tabs,
 * the Plan | 3D switch, the tool rail, the plan menu, Developer tools and a pending request's
 * card. One module, so e2e-full.mjs, shots.mjs and record6.mjs agree, and a change to the
 * interface is one edit here.
 *
 * Everything is found the way a person using a screen reader would find it: by role and
 * accessible name (src/ui/**). What has no role of its own to find it by is reached through the
 * four CSS hooks below, each defined here once and imported by the scripts that need it:
 *
 * - PLAN_SVG, the plan's <svg> (src/editor/Editor.tsx);
 * - SCENE_CANVAS, the 3D view's <canvas> (src/three/Scene3D.tsx);
 * - PENDING_HATCH, the hatch over what a pending request would remove (Editor.tsx, .pl-pending);
 * - PLAN_GRID_MAJOR, the plan's major grid pattern (Editor.tsx, id "plan-grid-major-<uid>"),
 *   whose width is one metre in the drawing's units: planToScreen reads the scale off it.
 */
import { requireTestHook } from "./test-hook.mjs";

/** "Issues" also matches "Issues 3": a tab's count badge is part of its name. */
const startsWith = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`);

/** The plan's drawing (src/editor/Editor.tsx) and the 3D view's canvas (src/three/Scene3D.tsx). */
export const PLAN_SVG = "main svg.editor-svg";
export const SCENE_CANVAS = ".scene3d canvas";
/** The hatch over what a pending request would remove, on the plan. */
export const PENDING_HATCH = `${PLAN_SVG} .pl-pending`;
/** The plan's major grid pattern: one metre, in the drawing's units, is its width. */
export const PLAN_GRID_MAJOR = 'pattern[id^="plan-grid-major-"]';

/**
 * Load the studio, check it carries the test hook, and wait for the shell to be up.
 * @param {import("playwright").Page} page
 * @param {string} base
 */
export async function openStudio(page, base) {
  await page.goto(base, { waitUntil: "networkidle" });
  const hook = await requireTestHook(page, base);
  await viewSwitch(page).waitFor({ timeout: 10000 });
  return hook;
}

/** @param {import("playwright").Page} page */
export const viewSwitch = (page) => page.getByRole("radiogroup", { name: "View" });

/**
 * The Plan | 3D segment ("Plan" or "3D").
 * @param {import("playwright").Page} page
 * @param {"Plan" | "3D"} name
 */
export const viewRadio = (page, name) => viewSwitch(page).getByRole("radio", { name, exact: true });

/**
 * Switch the view from the top bar and wait for it to be there.
 * @param {import("playwright").Page} page
 * @param {"Plan" | "3D"} name
 */
export async function showView(page, name) {
  await viewRadio(page, name).click();
  if (name === "3D") await page.locator(SCENE_CANVAS).waitFor({ timeout: 15000 });
  else await page.locator(PLAN_SVG).waitFor({ timeout: 10000 });
}

/**
 * Frame the whole plan with the zoom control's Fit. The plan view keeps its pan and zoom across
 * edits and trips to 3D, so a plan built by tool calls is framed this way, as a person would.
 * @param {import("playwright").Page} page
 */
export async function fitPlan(page) {
  await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(600);
}

/**
 * Show a side-panel tab (Properties, Library, Issues, Notes). Where the panel is a drawer or a
 * bottom sheet it is opened first from the top bar.
 * @param {import("playwright").Page} page
 * @param {"Properties" | "Library" | "Issues" | "Notes"} name
 */
export async function panelTab(page, name) {
  const show = page.getByRole("button", { name: "Show panel" });
  if (await show.isVisible()) await show.click();
  const tab = page.getByRole("tablist", { name: "Panel" }).getByRole("tab", { name: startsWith(name) });
  await tab.click();
  return tab;
}

/**
 * A tool on the rail, in whichever view is showing ("Draw walls", "Walk"...).
 * @param {import("playwright").Page} page
 * @param {string} name
 */
export const railButton = (page, name) =>
  page.getByRole("toolbar", { name: /^(Plan|3D view) tools$/ }).getByRole("button", { name, exact: true });

/**
 * Choose an entry of the plan menu (the plan's name in the top bar): Rename, Load Sunset Loft
 * demo, Clear plan. An entry's description is part of its name, so the label is matched as a prefix.
 * @param {import("playwright").Page} page
 * @param {string} label
 */
export async function planMenu(page, label) {
  await page.getByRole("banner").getByRole("button", { name: /^Plan: / }).click();
  await page.getByRole("menuitem", { name: startsWith(label) }).click();
}

/**
 * Choose an entry of the top bar's Export menu ("3D model (OBJ)", "Snapshot (PNG)").
 * @param {import("playwright").Page} page
 * @param {string} label
 */
export async function exportMenu(page, label) {
  await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: startsWith(label) }).click();
}

/**
 * Show the Library tab with one of its two sources.
 * @param {import("playwright").Page} page
 * @param {"Alza catalogue" | "Nordika"} source
 */
export async function librarySource(page, source) {
  await panelTab(page, "Library");
  await page.getByRole("radiogroup", { name: "Furniture source" }).getByRole("radio", { name: source }).click();
}

/**
 * The blueprint chooser in Properties (the first-run state has its own, unlabelled one).
 * @param {import("playwright").Page} page
 */
export const blueprintInput = (page) => page.getByLabel("Blueprint image", { exact: true });

/**
 * The partner's catalogue frame in the Library's Nordika view (src/ui/library/Nordika.tsx),
 * found by its title, its accessible name.
 * @param {import("playwright").Page} page
 */
export const partnerFrame = (page) => page.getByTitle("Nordika supplier catalogue", { exact: true });

/** @param {import("playwright").Page} page */
export const activityRegion = (page) => page.getByRole("region", { name: "Activity" });

/** @param {import("playwright").Page} page */
export const activityList = (page) => page.getByRole("list", { name: "Activity, newest first" });

/**
 * Open the "Developer tools" disclosure under Activity (and Activity itself, if folded).
 * @param {import("playwright").Page} page
 */
export async function openDeveloperTools(page) {
  const activity = activityRegion(page);
  const toggle = activity.getByRole("button", { name: startsWith("Activity") });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  const summary = activity.locator("summary", { hasText: "Developer tools" });
  const open = await summary.evaluate((s) => /** @type {HTMLDetailsElement} */ (s.parentElement).open);
  if (!open) await summary.click();
  const runner = toolRunner(page);
  await runner.select.waitFor();
  await runner.select.scrollIntoViewIfNeeded();
  return runner;
}

/**
 * The tool runner inside Developer tools.
 * @param {import("playwright").Page} page
 */
export function toolRunner(page) {
  const activity = activityRegion(page);
  return {
    select: activity.getByRole("combobox", { name: "Tool" }),
    args: activity.getByRole("textbox", { name: "Arguments (JSON)" }),
    run: activity.getByRole("button", { name: /^(Run tool|Running|Waiting for you)$/ }),
    result: activity.getByRole("status", { name: /^(Result|Not done)$/ }),
  };
}

/** @param {import("playwright").Page} page */
export const requestCard = (page) => page.getByRole("alertdialog");

/**
 * Answer the pending request on the plan with one of its two buttons, which are named for what
 * they do ("Keep room" / "Remove room", "Keep plan" / "Clear plan").
 * @param {import("playwright").Page} page
 * @param {"keep" | "confirm"} decision
 */
export async function answerRequest(page, decision) {
  const card = requestCard(page);
  // a removal is kept or confirmed; a download is declined or taken
  const keep = card.getByRole("button", { name: /^(Keep |Don't download$)/ });
  if (decision === "keep") await keep.click();
  else await card.getByRole("button", { name: /^(Remove|Clear|Download) / }).click();
}

/**
 * The agent's status in the top bar ("Agent tools on", "…, 2 requests waiting for you").
 * @param {import("playwright").Page} page
 */
export const agentStatus = (page) => page.getByRole("banner").getByRole("button", { name: /^Agent tools (on|off)/ });

/**
 * Where a point of the plan (in metres) is on the screen, right now. The drawing's user units
 * are canvas pixels with one metre to the grid's major step, so the major grid pattern's width
 * is the current scale; the svg's own screen transform does the rest (pan, zoom, layout).
 * @param {import("playwright").Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<[number, number]>}
 */
export function planToScreen(page, x, y) {
  return page.evaluate(
    ({ sel, gridSel, x, y }) => {
      const svg = /** @type {SVGSVGElement | null} */ (document.querySelector(sel));
      const grid = svg?.querySelector(gridSel);
      const ctm = svg?.getScreenCTM();
      if (!svg || !grid || !ctm) throw new Error("The plan is not showing.");
      const scale = Number(grid.getAttribute("width"));
      const p = new DOMPoint(x * scale, y * scale).matrixTransform(ctm);
      return [p.x, p.y];
    },
    { sel: PLAN_SVG, gridSel: PLAN_GRID_MAJOR, x, y },
  );
}
