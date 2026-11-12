/**
 * FULL functional battery — every feature exercised with real mouse/keyboard
 * interactions in headless Chromium (WebMCP flag on), plus the REAL WebMCP
 * runtime path via navigator.modelContextTesting when available.
 * Prints a PASS/FAIL line per check and exits non-zero on any failure.
 *
 * The interface is found by role and accessible name (scripts/studio.mjs), the browser is
 * started by scripts/browser.mjs (ALZA_CHROMIUM_PATH picks the executable).
 *
 *   npm run e2e       (against `npm run dev`; `npm run partner` too for the cross-origin checks)
 */
import { mkdirSync } from "node:fs";
import { fromRoot } from "./paths.mjs";
import { STUDIO_DEV_ORIGIN } from "../config/origins.js";
import { launchHeadless } from "./browser.mjs";
import {
  PENDING_HATCH,
  PLAN_SVG,
  SCENE_CANVAS,
  activityList,
  agentStatus,
  answerRequest,
  blueprintInput,
  exportMenu,
  fitPlan,
  librarySource,
  openDeveloperTools,
  openStudio,
  panelTab,
  partnerFrame,
  planMenu,
  planToScreen,
  railButton,
  requestCard,
  showView,
  viewRadio,
  viewSwitch,
} from "./studio.mjs";

const BASE = process.env.BASE_URL ?? STUDIO_DEV_ORIGIN;
const OUT = fromRoot("shots/full");
mkdirSync(OUT, { recursive: true });

/** Test viewports: a desktop, a tablet in landscape (the drawer layout), a phone (the sheet). */
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };

const results = [];
const check = (name, cond, extra = "") => {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const errors = [];
const browser = await launchHeadless();
const page = await browser.newPage({ viewport: DESKTOP });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const S = async (name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Start a download with `act` and read the file it gives: its name and text, or null when none came. */
const downloadText = async (act) => {
  const wait = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await act();
  const d = await wait;
  if (!d) return null;
  const { readFile } = await import("node:fs/promises");
  return { name: d.suggestedFilename(), text: await readFile(await d.path(), "utf8") };
};
/** What an exported IFC file says about itself: whether it is framed as STEP, its schema, and how many of an entity it holds. */
const ifcFacts = (file) => ({
  framed: !!file && file.text.startsWith("ISO-10303-21;\nHEADER;") && file.text.trimEnd().endsWith("END-ISO-10303-21;"),
  schema: file ? /FILE_SCHEMA\(\('([^']*)'\)\);/.exec(file.text)?.[1] : undefined,
  view: file ? /FILE_DESCRIPTION\(\('([^']*)'\)/.exec(file.text)?.[1] : undefined,
  count: (type) => (file ? (file.text.match(new RegExp(`^#\\d+=${type}\\(`, "gm")) ?? []).length : 0),
  names: (type) => (file ? [...file.text.matchAll(new RegExp(`^#\\d+=${type}\\('[^']*',\\$,'([^']*)'`, "gm"))].map((m) => m[1]) : []),
});
const hook = await openStudio(page, BASE);
const state = (expr) =>
  hook.evaluate((h, e) => {
    const { store } = h;
    return Function("s", `return (${e})`)(store.getState());
  }, expr);
const px = (wx, wy) => planToScreen(page, wx, wy);
const click = async (wx, wy) => page.mouse.click(...(await px(wx, wy)));
/** Wait for the store to agree, up to a moment, so a check never races a render. */
const until = async (expr, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await state(expr)) return true;
    await page.waitForTimeout(50);
  }
  return Boolean(await state(expr));
};
const firstRun = page.getByRole("heading", { name: "Draw your space at true size" });
/** The notices at the page edge (Astryx toast, labelled Notifications). */
const notices = page.getByLabel("Notifications", { exact: true });
const toast = (text) => notices.getByText(text, { exact: true });
await page.waitForTimeout(500);

// ---------- 0. boot state ----------
check("boot: seed loaded with 7 walls", (await state("s.model.walls.length")) === 7);
check("boot: agent status says the tools are on", ((await agentStatus(page).getAttribute("aria-label")) ?? "").startsWith("Agent tools on"));
check("boot: activity reports every tool registered", (await activityList(page).innerText()).match(/(\d+) of \1 tools registered/) !== null);
check("boot: the four panel tabs", (await page.getByRole("tablist", { name: "Panel" }).getByRole("tab").allInnerTexts()).map((t) => t.trim().split(/\s/)[0]).join(",") === "Properties,Library,Issues,Notes");

// ---------- 0b. keyboard selection via "On the plan" ----------
await panelTab(page, "Properties");
const wallsGroup = page.getByRole("tabpanel", { name: "Properties" }).locator("summary", { hasText: "Walls" });
await wallsGroup.focus();
await page.keyboard.press("Enter");                      // unfold the group
await page.keyboard.press("Tab");                        // its first entry: Wall 1
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const firstWallId = await state("s.model.walls[0].id");
check("on the plan: Enter on a listed wall selects it", (await state("s.editor.selectedWallId")) === firstWallId);
check("on the plan: focus moves to the plan", (await page.evaluate(() => document.activeElement?.tagName === "MAIN")));
const ax0 = await state("s.model.walls[0].ax");
const ay0 = await state("s.model.walls[0].ay");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check("on the plan: an arrow key nudges the selection", (await state("s.model.walls[0].ax")) > ax0 && (await state("s.model.walls[0].ay")) === ay0);
await page.keyboard.press("Control+z");
check("on the plan: undo takes the nudge back", (await until(`s.model.walls[0].ax === ${ax0}`)));
await page.keyboard.press("Escape");
check("on the plan: Esc clears the selection", (await until("!s.editor.selectedWallId")));

// ---------- 0c. shortcuts stand aside while the shortcut sheet is open ----------
await page.locator(PLAN_SVG).hover();
await page.keyboard.press("?");
const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
await sheet.waitFor({ timeout: 5000 });
check("shortcuts: ? opens the shortcut sheet", await sheet.isVisible());
await page.keyboard.press("w");
await page.keyboard.press("r");
check("shortcuts: W and R do nothing while the sheet is open", (await state("s.editor.drawMode")) === "select");
await page.keyboard.press("Escape");
await sheet.waitFor({ state: "hidden", timeout: 5000 });
check("shortcuts: Esc closes the sheet", !(await sheet.isVisible()));
await page.keyboard.press("w");
check("shortcuts: W picks Draw walls once the sheet is closed", (await until("s.editor.drawMode === 'wall'")) && (await railButton(page, "Draw walls").getAttribute("aria-pressed")) === "true");
await page.keyboard.press("Escape");
await page.keyboard.press("h");
check("shortcuts: H picks Pan", (await railButton(page, "Pan").getAttribute("aria-pressed")) === "true");
await page.keyboard.press("d");
check("shortcuts: D picks Add a door", (await railButton(page, "Add a door").getAttribute("aria-pressed")) === "true");
await page.keyboard.press("n");
check("shortcuts: N picks Add a window", (await railButton(page, "Add a window").getAttribute("aria-pressed")) === "true");
await page.keyboard.press("v");
check("shortcuts: V goes back to Select", (await railButton(page, "Select").getAttribute("aria-pressed")) === "true");
await page.keyboard.press("f");
check("shortcuts: F opens the Library to place furniture", (await page.getByRole("tab", { name: /^Library/ }).getAttribute("aria-selected")) === "true");
await panelTab(page, "Properties");

// ---------- 1. clear the plan (plan menu, then the confirmation in Properties) ----------
await planMenu(page, "Clear plan");
check("clear: model empty", (await until("s.model.walls.length === 0")));
check("clear: a notice offers Undo", await toast("Plan cleared").isVisible());
check("clear: the first-run state shows on the empty sheet", await firstRun.isVisible());
const threeD = viewRadio(page, "3D");
check("clear: 3D is disabled without walls", (await threeD.getAttribute("aria-disabled")) === "true" || (await threeD.isDisabled()));
await viewSwitch(page).hover();
const why3d = page.getByText("Add a wall to see the plan in 3D").filter({ visible: true });
check("clear: the 3D switch says why", await why3d.first().waitFor({ timeout: 3000 }).then(() => true, () => false));
await page.mouse.move(5, 5);
await notices.getByRole("button", { name: "Undo", exact: true }).click();
check("clear: the notice's Undo brings the plan back", (await until("s.model.walls.length === 7")));
await page.getByRole("tabpanel", { name: "Properties" }).getByRole("button", { name: "Clear plan…" }).click();
const confirm = page.getByRole("alertdialog", { name: "Clear the whole plan?" });
await confirm.waitFor();
await confirm.getByRole("button", { name: "Keep the plan" }).click();
check("clear: Keep the plan in the confirmation changes nothing", (await state("s.model.walls.length")) === 7);
await page.getByRole("tabpanel", { name: "Properties" }).getByRole("button", { name: "Clear plan…" }).click();
await confirm.getByRole("button", { name: "Clear plan" }).click();
check("clear: confirming in Properties clears the plan", (await until("s.model.walls.length === 0")));
await page.mouse.move(5, 5);

// ---------- 2. draw walls with the mouse (chained) ----------
await railButton(page, "Draw walls").click();
check("draw: the first-run state gives way to the drawing", !(await firstRun.isVisible()));
await click(1, 1);
await click(5, 1);
await click(5, 5);
await page.keyboard.press("Escape");
check("draw: 2 chained walls added", (await state("s.model.walls.length")) === 2);
const wallLen = await state("s.model.walls[0] && Math.hypot(s.model.walls[0].bx-s.model.walls[0].ax, s.model.walls[0].by-s.model.walls[0].ay)");
check("draw: first wall is 4 m", Math.abs(wallLen - 4) < 0.01, `${wallLen} m`);
check("draw: 3D is enabled once there is a wall", (await threeD.getAttribute("aria-disabled")) !== "true" && !(await threeD.isDisabled()));

// ---------- 3. draw a room by drag ----------
await railButton(page, "Draw a room").click();
await page.mouse.move(...(await px(1.2, 1.2)));
await page.mouse.down();
await page.mouse.move(...(await px(4, 4)), { steps: 5 });
await page.mouse.up();
check("room: added by drag", (await state("s.model.rooms.length")) === 1);

// ---------- 4. place furniture from the Library ----------
await panelTab(page, "Library");
await page.getByRole("list", { name: "Furniture" }).getByRole("button", { name: /^Sofa,/ }).click();
check("library: choosing a piece starts placing it", (await state("s.editor.drawMode")) === "place");
await click(2.5, 2.5);
check("library: sofa placed", (await state("s.model.items.length")) === 1);

// ---------- 5. select a wall → dynamic tool published ----------
await railButton(page, "Select").click();
await click(3, 1);
await page.waitForTimeout(300);
check("select: wall selected", !!(await state("s.editor.selectedWallId")));
check("dynamic tool published on selection", (await activityList(page).innerText()).includes("extend_selected_wall"));

// ---------- 6. drag the sofa ----------
const before = await state("s.model.items[0].x");
await page.mouse.move(...(await px(2.5, 2.5)));
await page.mouse.down();
await page.mouse.move(...(await px(3.5, 3)), { steps: 6 });
await page.mouse.up();
const after = await state("s.model.items[0].x");
check("drag: sofa moved", before !== after, `${before} → ${after}`);

// ---------- 7. delete + undo ----------
await page.keyboard.press("Delete");
check("delete: sofa removed", (await state("s.model.items.length")) === 0);
await page.keyboard.press("Control+z");
check("undo: sofa restored", (await state("s.model.items.length")) === 1);
await page.keyboard.press("Delete");
await page.getByRole("banner").getByRole("button", { name: "Undo", exact: true }).click();
check("undo: the top bar's Undo restores it too", (await until("s.model.items.length === 1")));
await page.keyboard.press("Escape");

// ---------- 8. blueprint underlay upload ----------
const pngDataUrl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 400; c.height = 240;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 400, 240);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 4; ctx.strokeRect(40, 30, 320, 180);
  return c.toDataURL("image/png");
});
const buffer = Buffer.from(pngDataUrl.split(",")[1], "base64");
await panelTab(page, "Properties");
await blueprintInput(page).setInputFiles({ name: "blueprint.png", mimeType: "image/png", buffer });
check("underlay: blueprint loaded", await until("!!s.model.underlay"));
await S("06-underlay");
await page.getByRole("button", { name: "Remove the image" }).click();
check("underlay: removed", (await state("s.model.underlay")) === null);

// ---------- 9. notes (human → feed → agent reads) ----------
await panelTab(page, "Notes");
const notesTab = page.getByRole("tabpanel", { name: "Notes" });
await notesTab.getByRole("textbox", { name: "Note for your agent" }).fill("Please widen the bedroom door to 1 m.");
await notesTab.getByRole("button", { name: "Add note" }).click();
check("notes: human note saved", (await state("s.notes.length")) === 1);
check("notes: it is listed in the Notes tab", (await page.getByRole("list", { name: "Notes, newest first" }).innerText()).includes("Please widen the bedroom door"));
// the composer at the foot of Activity, while another tab shows, and its Ctrl+Enter
await panelTab(page, "Properties");
const footComposer = page.getByRole("region", { name: "Activity" }).getByRole("textbox", { name: "Note for your agent" });
await footComposer.fill("Check the window heights.");
await footComposer.press("Control+Enter");
check("notes: the Activity composer adds a note with Ctrl+Enter", (await until("s.notes.length === 2")) && (await footComposer.inputValue()) === "");
check("notes: the Notes tab counts them", /^Notes\s*2$/.test((await page.getByRole("tab", { name: /^Notes/ }).innerText()).trim()));

// ---------- 10. REAL WebMCP runtime path ----------
const mct = await page.evaluate(async () => {
  const m = navigator.modelContextTesting;
  if (!m) return { available: false };
  const call = async (name, input) => String(await m.executeTool(name, JSON.stringify(input)));
  const answer = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  try {
    const r1 = await call("add_wall", { ax: 6, ay: 1, bx: 6, by: 5 });
    // the door goes on the wall just drawn, named by the exact id add_wall answered with:
    // references match an id or one name, never a fragment of one
    const r2 = await call("add_door", { wallId: answer(r1).id, t: 0.5 });
    const r3 = await call("get_issues", {});
    const r4 = await call("leave_note", { text: "Agent was here." });
    return { available: true, doorOk: answer(r2).ok === true, r1: r1.slice(0, 120), r2: r2.slice(0, 120), r3: r3.slice(0, 160), r4: r4.slice(0, 80) };
  } catch (e) {
    return { available: true, error: String(e) };
  }
});
console.log("modelContextTesting:", JSON.stringify(mct, null, 1));
// Informational: modelContextTesting exists only in Chrome dev/canary builds.
// Tool REGISTRATION is already proven by the agent status and the "N of N tools registered"
// line; real end-to-end execution is verified in ChatGPT desktop before submission.
// Skipped only when the API is absent: present but failing is a failure of both checks.
if (mct.available) {
  check("webmcp runtime: add_wall and add_door on it executed", !mct.error && (await state("s.model.walls.length")) >= 3 && mct.doorOk, mct.error ?? mct.r2);
  check("webmcp runtime: agent note landed", !mct.error && (await state("s.notes.length")) >= 3, mct.error);
} else {
  console.log("WARN  modelContextTesting not in this Chromium build — the 2 runtime-execution checks are skipped; registration is verified via the agent status, and the execution path via the tool runner, which shares the same wrapper.");
}

// ---------- 11. Developer tools: the tool runner, full sweep ----------
const runner = await openDeveloperTools(page);
/**
 * Run a tool by hand. A destructive one parks on the plan as a request card; `decide` is what
 * the human does about it: a button ("confirm" / "keep") or a key ("ctrl+enter" / "escape").
 */
const runTool = async (name, args, decide = "confirm") => {
  await runner.select.selectOption(name);
  await runner.args.fill(JSON.stringify(args));
  await runner.run.click();
  const card = requestCard(page);
  await Promise.race([runner.result.waitFor({ timeout: 8000 }), card.waitFor({ timeout: 8000 })]).catch(() => {});
  if (await card.isVisible()) {
    if (decide === "ctrl+enter") await page.keyboard.press("Control+Enter");
    else if (decide === "escape") await page.keyboard.press("Escape");
    else await answerRequest(page, decide);
    await runner.result.waitFor({ timeout: 8000 });
  }
  const txt = await runner.result.locator("pre").innerText();
  try { return JSON.parse(txt); } catch { return { ok: false, summary: txt }; }
};
let r = await runTool("get_model", {});
check("tool get_model", r.ok && r.model);
r = await runTool("get_item_catalog", {});
check("tool get_item_catalog (30 kinds incl. bath + supplier-ready)", r.ok && r.catalog.length >= 30);
r = await runTool("measure", { x1: 0, y1: 0, x2: 3, y2: 4 });
check("tool measure = 5 m", r.ok && Math.abs(r.meters - 5) < 0.01);
// underlay tools: not-loaded path first (underlay was removed in section 8)
r = await runTool("get_underlay", {});
check("tool get_underlay: not loaded", r.ok && r.loaded === false);
r = await runTool("calibrate_underlay", { u1: 0.1, v1: 0.5, u2: 0.9, v2: 0.5, meters: 4 });
check("tool calibrate_underlay: fails without image", !r.ok);
// load an underlay programmatically, then calibrate: points 0.8 apart horizontally on an 8×6 rect → scale to 4 m
await hook.evaluate((h) =>
  h.actions.setUnderlay({ assetId: h.putImage("data:image/png;base64,iVBORw0KGgo="), opacity: 0.55, x: 0, y: 0, w: 8, h: 6 }),
);
r = await runTool("calibrate_underlay", { u1: 0.1, v1: 0.5, u2: 0.9, v2: 0.5, meters: 4 });
check("tool calibrate_underlay: 8 m → 5 m", r.ok && Math.abs(r.w - 5) < 0.01);
const uw = await state("s.model.underlay.w");
const uh = await state("s.model.underlay.h");
check("tool calibrate_underlay: rect scaled, aspect kept", Math.abs(uw - 5) < 0.01 && Math.abs(uh - 3.75) < 0.01);
await hook.evaluate((h) => h.actions.setUnderlay(null));
r = await runTool("add_room", { x: 6.2, y: 1.2, w: 2, h: 2, label: "Study", floor: "oak" });
check("tool add_room", r.ok);
r = await runTool("update_room", { id: "Study", label: "Office" });
check("tool update_room by label", r.ok);
r = await runTool("place_item", { kind: "desk", x: 7, y: 2, rotation: 0 });
check("tool place_item", r.ok);
// a second desk makes "desk" name two items, which is refused, never "the first"
const deskId = r.id;
await runTool("place_item", { kind: "desk", x: 1.5, y: 3.5, rotation: 0 });
r = await runTool("move_item", { id: "desk", x: 7.2, y: 2.2 });
const ambiguousRefused = !r.ok && Array.isArray(r.candidates);
r = await runTool("move_item", { id: deskId, x: 7.2, y: 2.2 });
check("tool move_item (an ambiguous kind is refused, the id moves it)", ambiguousRefused && r.ok, r.summary);
r = await runTool("remove_item", { id: deskId });
check("tool remove_item", r.ok);
r = await runTool("get_issues", {});
check("tool get_issues returns list", r.ok && Array.isArray(r.issues));
r = await runTool("set_plan_name", { name: "E2E Test Plan" });
check("tool set_plan_name", r.ok && (await state("s.model.name")) === "E2E Test Plan");
check("tool set_plan_name: the top bar shows the new name", (await page.getByRole("banner").getByRole("button", { name: "Plan: E2E Test Plan" }).count()) === 1);
r = await runTool("get_editor_state", {});
check("tool get_editor_state", r.ok && r.editor);
r = await runTool("get_notes", {});
check("tool get_notes", r.ok && r.notes.length >= 1);
{
  let result = null;
  const file = await downloadText(async () => {
    result = await runTool("export_ifc", {});
  });
  const ifc = ifcFacts(file);
  const walls = await state("s.model.walls.length");
  check(
    "tool export_ifc: downloads an IFC4 file named after the plan, and answers with its counts",
    result?.ok && file?.name === "e2e-test-plan.ifc" && ifc.framed && ifc.schema === "IFC4" &&
      ifc.count("IFCWALL") === walls && result.ifc.elements.walls === walls && result.ifc.bytes === file.text.length,
    `${file?.name}, ${ifc.schema}, ${ifc.count("IFCWALL")}/${walls} walls, ${result?.summary}`,
  );
}
r = await runTool("remove_room", { id: "Office" });
check("tool remove_room", r.ok);
r = await runTool("edit_wall", { id: (await state("s.model.walls[0].id")), thickness: 0.2 });
check("tool edit_wall", r.ok);
r = await runTool("clear_model", {});
check("tool clear_model (destructive)", r.ok && (await state("s.model.walls.length")) === 0);

// ---------- 11b. human-in-the-loop approval gate ----------
await planMenu(page, "Load Sunset Loft demo");
await until("s.model.walls.length === 7");
const wallsBeforeGate = await state("s.model.walls.length");
r = await runTool("clear_model", {}, "keep");
check("gate: a kept destructive call reports back as declined", !r.ok && /declined/i.test(r.summary), r.summary);
check("gate: keeping changed nothing", (await state("s.model.walls.length")) === wallsBeforeGate);
check("gate: the request card is gone after the decision", (await requestCard(page).count()) === 0);
r = await runTool("remove_item", { id: "plant" }, "confirm");
check("gate: approved destructive call runs", r.ok, r.summary);
// non-destructive tools never stop for approval
r = await runTool("get_model", {});
check("gate: read-only tools are not gated", r.ok && r.model);

// the agent's own requests: they wait on the plan, the top bar counts them, the keys answer them
const agentAsks = (tool, args) => hook.evaluate((h, [t, a]) => { window.__pending = h.runTool(t, a); }, [tool, args]);
const agentAnswer = () => page.evaluate(() => window.__pending);
const bathroomId = await state("s.model.rooms.find((x) => x.label === 'Bathroom').id");
await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });   // focus on the plan, not in a field
await page.keyboard.press("Escape");
await agentAsks("remove_room", { id: "Bathroom" });
await requestCard(page).waitFor({ timeout: 5000 });
check("gate: the request card names the room", (await requestCard(page).getByRole("button", { name: "Remove room" }).count()) === 1 && (await requestCard(page).getByRole("button", { name: "Keep room" }).count()) === 1);
check("gate: the room to remove is hatched on the plan", (await page.locator(PENDING_HATCH).count()) >= 1);
check("gate: agent status counts 1 request waiting", ((await agentStatus(page).getAttribute("aria-label")) ?? "").includes("1 request waiting"));
check("gate: Activity lists it under Waiting for you", await page.getByRole("heading", { name: /^Waiting for you/ }).isVisible());
await S("06b-approval-gate");
await page.keyboard.press("Escape");
let answered = await agentAnswer();
check("gate: Esc keeps a pending request", !answered.ok && (await state(`s.model.rooms.some((x) => x.id === '${bathroomId}')`)), answered.summary);
check("gate: the hatch is gone once it is answered", (await page.locator(PENDING_HATCH).count()) === 0);
check("gate: agent status has nothing waiting", ((await agentStatus(page).getAttribute("aria-label")) ?? "") === "Agent tools on");
await agentAsks("remove_room", { id: "Bathroom" });
await agentAsks("remove_item", { id: "sofa" });
await requestCard(page).waitFor({ timeout: 5000 });
await until("s.approvals.length === 2");
check("gate: agent status counts 2 requests waiting", ((await agentStatus(page).getAttribute("aria-label")) ?? "").includes("2 requests waiting"));
check("gate: the card pages its requests", (await requestCard(page).getByText("1 of 2").count()) === 1);
await page.keyboard.press("Control+Enter");
await until("s.approvals.length === 1");
check("gate: Ctrl+Enter approves the request on the card", !(await state(`s.model.rooms.some((x) => x.id === '${bathroomId}')`)));
await page.keyboard.press("Escape");
answered = await agentAnswer();
check("gate: Esc keeps the next one", !answered.ok && (await state("s.approvals.length")) === 0);
await page.keyboard.press("Control+z");
check("gate: an approved removal undoes like any other change", await until(`s.model.rooms.some((x) => x.id === '${bathroomId}')`));
// the agent's IFC export hands the human a file: it always asks, names the file, and downloads only when taken
{
  let downloaded = 0;
  const count = () => downloaded++;
  page.on("download", count);
  await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await agentAsks("export_ifc", {});
  await requestCard(page).waitFor({ timeout: 5000 });
  const asked =
    (await requestCard(page).getByRole("button", { name: "Download file" }).count()) === 1 &&
    (await requestCard(page).getByRole("button", { name: "Don't download" }).count()) === 1 &&
    ((await requestCard(page).textContent()) ?? "").includes("sunset-loft.ifc");
  await page.keyboard.press("Escape");
  answered = await agentAnswer();
  page.off("download", count);
  check("gate: the agent's IFC export waits for the human, naming the file, and Esc downloads nothing", asked && !answered.ok && /declined/.test(answered.summary) && downloaded === 0, answered.summary);
  const file = await downloadText(async () => {
    await agentAsks("export_ifc", {});
    await requestCard(page).waitFor({ timeout: 5000 });
    await page.keyboard.press("Control+Enter");
  });
  answered = await agentAnswer();
  check("gate: approved, the IFC file downloads and the agent gets its counts", answered.ok && file?.name === "sunset-loft.ifc" && ifcFacts(file).framed && answered.ifc?.elements?.walls === 7, `${file?.name} ${answered.summary}`);
}

// ---------- 11b2. agent-authored furniture ----------
r = await runTool("get_underlay", {});
check("protocol: tracing rules travel with get_underlay", r.ok && Array.isArray(r.protocol) && r.protocol.length >= 8);
r = await runTool("define_item_kind", {
  kind: "grand_piano", label: "Grand piano", w: 1.55, d: 2.0, h: 1.0, color: "#1d1b1a", category: "living",
  parts: [
    { shape: "box", x: 0, y: 0.66, z: 0, w: 1.5, h: 0.22, d: 1.95, color: "#1d1b1a" },
    { shape: "cylinder", x: 0, y: 0.66, z: 0.55, w: 1.5, h: 0.22, d: 1.2, color: "#1d1b1a" },
    { shape: "box", x: 0, y: 0.6, z: -0.86, w: 1.42, h: 0.1, d: 0.28, color: "#f2efe8" },
  ],
});
check("define_item_kind: agent models a piece from primitives", r.ok, r.summary);
const kindsAfter = (await runTool("get_item_catalog", {})).catalog.some((c) => c.kind === "grand_piano");
check("define_item_kind: the new kind joins the catalogue", kindsAfter);
r = await runTool("place_item", { kind: "grand_piano", x: 2.4, y: 4.6, rotation: 180 });
check("define_item_kind: the agent-made piece can be placed", r.ok, r.summary);
r = await runTool("define_item_kind", { kind: "sofa", label: "Nope", w: 1, d: 1, h: 1 });
check("define_item_kind: refuses to shadow a built-in kind", !r.ok);

// ---------- 11c. cross-origin partner tools ----------
await panelTab(page, "Library");
check("library: the agent's piece is in the catalogue, marked Agent", (await page.getByRole("list", { name: "Furniture" }).getByRole("button", { name: /^Grand piano,/ }).innerText()).includes("Agent"));
await librarySource(page, "Nordika");
await page.waitForTimeout(1500);
const frame = partnerFrame(page);
check("cross-origin: partner iframe carries allow=\"tools\"", (await frame.count()) === 1 && (await frame.getAttribute("allow")) === "tools");
// Whether the partner origin is up is asked of the partner itself, so with it up a tool that
// fails is a failure; only with it down are the checks skipped.
const partnerUrl = new URL((await frame.getAttribute("src")) ?? "", BASE);
const partnerUp = await fetch(partnerUrl).then(
  (res) => res.ok,
  () => false,
);
if (partnerUp) {
  r = await runTool("get_supplier_catalog", { category: "living", maxPrice: 400, inStock: true });
  check("cross-origin: catalogue read from the partner origin", r.ok && Array.isArray(r.products) && r.products.length > 0, r.ok ? `${r.products?.length} products via ${r.transport}` : r.summary);
  const sku = r.products?.[0]?.sku ?? "";
  const itemsPre = await state("s.model.items.length");
  r = await runTool("place_supplier_product", { sku, x: 2.6, y: 2.6, rotation: 0 });
  check("cross-origin: partner product placed at its real size", r.ok && (await state("s.model.items.length")) === itemsPre + 1, r.summary);
  await page.getByRole("button", { name: "Pull catalogue" }).click();
  const products = page.getByRole("list", { name: "Nordika products" });
  await products.waitFor({ timeout: 8000 }).catch(() => {});
  check("cross-origin: Pull catalogue lists the partner's products", (await products.getByRole("button").count()) > 0);
} else {
  console.log(`SKIP  cross-origin checks — the partner origin (${partnerUrl.origin}) is not answering; start it with npm run partner`);
}
await librarySource(page, "Alza catalogue");

// ---------- 12. reload seed + 3D flow ----------
await planMenu(page, "Load Sunset Loft demo");
check("seed reloaded", await until("s.model.walls.length === 7"));

await showView(page, "3D");
await page.waitForTimeout(1200);
check("3D: canvas mounted", (await page.locator(SCENE_CANVAS).count()) === 1);
check("3D: the rail shows the 3D tools", (await railButton(page, "Orbit").count()) === 1 && (await railButton(page, "Draw walls").count()) === 0);
await S("07-3d-orbit");

/** What the mounted 3D view holds (the test hook's probe), or null. */
const scene = () => hook.evaluate((h) => h.sceneStats());
/** Wait for the 3D view to agree, up to a moment. */
const sceneUntil = async (test, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await scene();
    if (s && test(s)) return true;
    await page.waitForTimeout(50);
  }
  const s = await scene();
  return Boolean(s && test(s));
};
const canvasBox = await page.locator(SCENE_CANVAS).boundingBox();

// the cutaway: the View panel's slider sets the height the walls are cut at
const viewButton = page.getByRole("button", { name: "View", exact: true });
await viewButton.click();
const viewPanel = page.getByRole("group", { name: "View" });
await viewPanel.getByRole("switch", { name: /^Cutaway/ }).click();
const cutSlider = viewPanel.getByRole("slider", { name: "Cut height" });
const firstCut = Number(await cutSlider.inputValue());
check("3D: the cutaway cuts the walls", (await sceneUntil((s) => s.cut !== null)) && (await state("s.editor.scene.cutHeight")) === firstCut, `${firstCut} m`);
const firstLevel = (await scene()).cut;
await cutSlider.focus();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
const raisedCut = Number(await cutSlider.inputValue());
// the walls stand to the cut: it rises in the model by what the slider moved
check(
  "3D: moving the slider raises the walls' cut by as much",
  raisedCut > firstCut && (await sceneUntil((s) => s.cut !== null && Math.abs(s.cut - firstLevel - (raisedCut - firstCut)) < 1e-6)),
  `${firstCut} m → ${raisedCut} m`,
);
await viewPanel.getByRole("switch", { name: /^Cutaway/ }).click();
check("3D: the walls stand whole again without the cutaway", await sceneUntil((s) => s.cut === null));
await page.keyboard.press("Escape");

// the camera switch moves the camera to each mode and lets it settle there
await railButton(page, "Top view").click();
check("3D: Top view switches the camera and the move settles", (await until("s.editor.camera === 'top'")) && (await sceneUntil((s) => !s.moving)));

// a click on a wall in the model selects it, in the store and in the panel
await panelTab(page, "Properties");
const northWall = await hook.evaluate((h) => h.sceneLocate("wall", "wall_n"));
await page.mouse.click(canvasBox.x + northWall.x, canvasBox.y + northWall.y);
check("3D: a click on a wall selects it", await until("s.editor.selectedWallId === 'wall_n'"));
check(
  "3D: the panel shows the wall picked in 3D, and the model outlines it",
  (await page.getByRole("complementary", { name: "Plan panel" }).getByText("Openings on this wall").isVisible()) && (await sceneUntil((s) => s.marks.selection === 1)),
);
await hook.evaluate((h) => h.actions.selectWall(null));
await until("!s.editor.selectedWallId");

// the plan's keys act on what is selected in the 3D view too: Delete removes it, Ctrl+Z undoes
await hook.evaluate((h) => h.actions.selectItem("item_dining"));
const itemsSelected = await state("s.model.items.length");
await page.locator(SCENE_CANVAS).hover();
await page.keyboard.press("Delete");
check("3D: Delete removes the selected piece, as on the plan", await until(`s.model.items.length === ${itemsSelected - 1} && !s.editor.selectedItemId`));
await page.keyboard.press("Control+z");
check("3D: Ctrl+Z brings it back", await until(`s.model.items.length === ${itemsSelected}`));

// a pending removal is hatched on the model as on the plan, until it is answered
await hook.evaluate((h) => {
  window.__pending3d = h.runTool("remove_room", { id: "Bathroom" });
});
await requestCard(page).waitFor({ timeout: 5000 });
check("3D: a pending remove_room is hatched on the model", await sceneUntil((s) => s.marks.pending === 1));
await answerRequest(page, "keep");
const kept3d = await page.evaluate(() => window.__pending3d);
check("3D: the hatch goes once the request is kept", !kept3d.ok && (await sceneUntil((s) => s.marks.pending === 0)));

await railButton(page, "Walk").click();
await page.waitForTimeout(700);
check("3D: walk camera active", (await state("s.editor.camera")) === "walk");
await S("08-3d-walk");
await page.locator(SCENE_CANVAS).hover();
await page.keyboard.press("1");
check("3D: 1 goes back to Orbit", await until("s.editor.camera === 'orbit'"));
await page.keyboard.press("3");
check("3D: 3 walks", await until("s.editor.camera === 'walk'"));

// click-to-place in 3D
await panelTab(page, "Library");
await page.getByRole("list", { name: "Furniture" }).getByRole("button", { name: /^Plant,/ }).click();
const itemsBefore = await state("s.model.items.length");
const box3d = await page.locator(SCENE_CANVAS).boundingBox();
await page.mouse.click(box3d.x + box3d.width * 0.45, box3d.y + box3d.height * 0.6);
await page.waitForTimeout(400);
check("3D: click-to-place adds item", (await state("s.model.items.length")) === itemsBefore + 1);
await page.keyboard.press("Escape");

// OBJ export (download event)
const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await exportMenu(page, "3D model (OBJ)");
const download = await dl;
check("3D: OBJ export downloads", !!download, download ? await download.suggestedFilename() : "no download");

await showView(page, "Plan");
check("back to 2D", (await state("s.editor.view")) === "2d");

// ---------- 12b. layouts: the drawer at tablet width, the bottom sheet at phone width ----------
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const panel = page.getByRole("complementary", { name: "Plan panel", includeHidden: true });
const showPanel = page.getByRole("button", { name: "Show panel" });
for (const [label, size] of [["drawer", TABLET], ["sheet", PHONE]]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(500);
  // earlier steps opened it (F, a tab); over 1024px that is ignored, here it would show
  const hidePanel = page.getByRole("button", { name: "Hide panel" });
  if (await hidePanel.isVisible()) await hidePanel.click();
  await page.waitForTimeout(400);
  check(`${label} ${size.width}px: no horizontal overflow`, (await overflow()) <= 0, `${await overflow()} px`);
  check(`${label} ${size.width}px: the panel closes away, with a toggle in the top bar`, (await showPanel.isVisible()) && (await panel.getAttribute("data-open")) === "false");
  await showPanel.click();
  await page.waitForTimeout(500);
  const box = await panel.boundingBox();
  const inView = box && box.x >= -1 && box.x + box.width <= size.width + 1;
  if (label === "drawer") {
    check(`drawer ${size.width}px: the panel opens over the canvas, at the right edge`, inView && Math.abs(box.x + box.width - size.width) <= 1 && box.width < size.width);
  } else {
    check(`sheet ${size.width}px: the panel opens as a bottom sheet`, inView && box.width >= size.width - 1 && Math.abs(box.y + box.height - size.height) <= 1);
    check(`sheet ${size.width}px: the rail is a bottom toolbar`, (await page.getByRole("toolbar", { name: "Plan tools" }).getAttribute("aria-orientation")) === "horizontal");
  }
  check(`${label} ${size.width}px: no horizontal overflow with the panel open`, (await overflow()) <= 0, `${await overflow()} px`);
  await S(`09-${label}-${size.width}`);
  await page.getByRole("tab", { name: /^Properties/ }).focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check(`${label} ${size.width}px: Esc closes the panel`, (await panel.getAttribute("data-open")) === "false");
}

// the 3D view's View panel at phone width: inside the view, every control in reach of a finger
await showView(page, "3D");
await page.locator(SCENE_CANVAS).waitFor({ timeout: 8000 }).catch(() => {});
await page.getByRole("button", { name: "View", exact: true }).click();
const phoneView = page.getByRole("group", { name: "View" });
const viewBox = await phoneView.boundingBox();
const phoneCanvas = await page.locator(SCENE_CANVAS).boundingBox();
check(
  `phone ${PHONE.width}px: the View panel lies inside the 3D view`,
  !!viewBox && !!phoneCanvas && viewBox.x >= phoneCanvas.x - 1 && viewBox.x + viewBox.width <= phoneCanvas.x + phoneCanvas.width + 1,
  viewBox ? `${Math.round(viewBox.x)}..${Math.round(viewBox.x + viewBox.width)} px` : "no panel",
);
const edgesWere = await state("s.editor.scene.edges");
const pressed = [];
for (const name of [/^Ink edges/, /^Cutaway/]) {
  pressed.push(
    await phoneView
      .getByRole("switch", { name })
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false),
  );
}
check(
  `phone ${PHONE.width}px: the Ink edges and Cutaway switches can be pressed`,
  pressed.every(Boolean) && (await state("s.editor.scene.edges")) === !edgesWere && (await state("s.editor.scene.cutaway")) === true,
);
await hook.evaluate((h) => h.actions.setSceneStyle({ edges: true, cutaway: false }));
await page.keyboard.press("Escape");
await showView(page, "Plan");
await page.setViewportSize(DESKTOP);

// ---------- 12c. levels and stairs, through the agent's tools ----------
const agentTool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
const drawnWalls = () => page.locator(`${PLAN_SVG} .pl-wall-hit`).count();
await planMenu(page, "Load Sunset Loft demo");
await until("s.model.walls.length === 7");
r = await agentTool("list_levels", {});
check("levels: the demo is one storey, the ground floor, being worked on", r.ok && r.levels.length === 1 && r.levels[0].active === true, r.summary);
r = await agentTool("add_level", {});
const firstFloorId = r.id;
check("levels: add_level puts a first floor on top", r.ok && (await state("s.model.levels.length")) === 2 && (await state("s.model.levels[1].name")) === "First floor", r.summary);
r = await agentTool("add_wall", { ax: 0, ay: 0, bx: 8, by: 0, level: "First floor" });
check("levels: a wall built upstairs is on the first floor, not on the plan shown", r.ok && r.levelId === firstFloorId && (await drawnWalls()) === 7, r.summary);
r = await agentTool("add_stair", { x: 4.5, y: 5.2, rotation: 180, level: "Ground floor" });
check("levels: add_stair works out its risers from the storey height", r.ok && r.risers === 16 && (await state("s.model.stairs.length")) === 1, r.summary);
r = await agentTool("set_active_level", { id: "First floor" });
check("levels: set_active_level shows the first floor's walls only", r.ok && (await until(`s.editor.activeLevelId === '${firstFloorId}'`)) && (await drawnWalls()) === 1);
r = await agentTool("get_issues", { level: "First floor" });
const groundIssues = await agentTool("get_issues", { level: "Ground floor" });
const allIssues = await agentTool("get_issues", {});
check(
  "levels: get_issues reads one storey (the stair over the TV is the ground floor's)",
  r.ok && r.issues.length === 0 && groundIssues.issues.some((i) => i.code === "item_on_stair") && allIssues.issues.length === groundIssues.issues.length,
  `${r.summary} / ${groundIssues.summary}`,
);
await agentTool("set_active_level", { id: "Ground floor" });
check("levels: back on the ground floor, its walls show again", (await until("s.editor.activeLevelId === 'level_ground'")) && (await drawnWalls()) === 7);
await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });   // focus on the plan, not in a field
await page.keyboard.press("Escape");
await agentAsks("remove_level", { id: "First floor" });
await requestCard(page).waitFor({ timeout: 5000 });
check("levels: remove_level waits for the human", (await state("s.approvals.length")) === 1 && (await state("s.approvals[0].targets[0].type")) === "level");
await page.keyboard.press("Control+Enter");
answered = await agentAnswer();
check("levels: approved, the storey goes with what stood on it", answered.ok && (await state("s.model.levels.length")) === 1 && (await state("s.model.walls.length")) === 7, answered.summary);
// a plan saved before levels existed: no version, no levels, no levelId on anything
const oldPlan = await hook.evaluate((h) => {
  const m = h.store.getState().model;
  const strip = ({ levelId, ...e }) => (void levelId, e);
  // formats 1 and 2 wrote a room as its rectangle
  const asRect = ({ points, ...e }) => {
    const xs = points.map((q) => q.x);
    const ys = points.map((q) => q.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { ...e, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  return { name: "Saved before levels", walls: m.walls.map(strip), openings: m.openings, rooms: m.rooms.map((r) => strip(asRect(r))), items: m.items.map(strip), kinds: m.kinds, underlay: null };
});
const loaded = await hook.evaluate((h, plan) => h.actions.loadModel(plan), oldPlan);
check(
  "levels: a plan saved before levels loads as one ground floor",
  loaded.ok && loaded.migratedFrom === 1 && (await state("s.model.levels.length")) === 1 && (await state("s.model.walls.every((w) => w.levelId === 'level_ground')")) && (await drawnWalls()) === 7,
  loaded.summary,
);
await planMenu(page, "Load Sunset Loft demo");
await until("s.model.name === 'Sunset Loft'");

// ---------- 12d. levels and stairs on the plan, by hand ----------
const levelGroup = page.getByRole("radiogroup", { name: "Level" });
await levelGroup.waitFor({ timeout: 5000 });
check("plan levels: the switcher lists the demo's one level, chosen", (await levelGroup.getByRole("radio").allInnerTexts()).join() === "Ground floor" && (await levelGroup.getByRole("radio", { name: "Ground floor" }).getAttribute("aria-checked")) === "true");
await page.getByRole("button", { name: "Add a level", exact: true }).click();
check(
  "plan levels: Add a level puts a first floor on top and works on it, over a ghost of the ground floor",
  (await until("s.model.levels.length === 2 && s.editor.activeLevelId === s.model.levels[1].id")) &&
    (await levelGroup.getByRole("radio", { name: "First floor" }).getAttribute("aria-checked")) === "true" &&
    (await drawnWalls()) === 0 &&
    (await page.locator(`${PLAN_SVG} .pl-ghost-wall`).count()) === 7,
);
check("plan levels: the change is said aloud", (await page.locator(".levels [role=status]").innerText()) === "Working on First floor, floor at +2.90 m");
await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });
await page.keyboard.press("PageDown");
check("plan levels: PageDown works on the level below", (await until("s.editor.activeLevelId === 'level_ground'")) && (await drawnWalls()) === 7);
await page.keyboard.press("s");
check("plan stairs: S picks Add a stair", (await railButton(page, "Add a stair").getAttribute("aria-pressed")) === "true");
await page.mouse.move(...(await px(3.3, 3.4)));
await page.mouse.down();
await page.mouse.move(...(await px(3.3, 2.4)), { steps: 4 });
await page.mouse.move(...(await px(3.3, 1.4)), { steps: 4 });
await page.mouse.up();
check(
  "plan stairs: press and drag adds a stair climbing the way of the drag, selected",
  (await until("s.model.stairs.length === 1")) &&
    (await state("s.model.stairs[0].rotation")) === 180 &&
    (await state("Math.abs(s.model.stairs[0].x - 3.3) < 1e-6 && Math.abs(s.model.stairs[0].y - 3.4) < 1e-6")) &&
    (await state("s.editor.selectedStairId === s.model.stairs[0].id")),
);
const stairSymbol = page.locator(`${PLAN_SVG} .pl-stair-hit`);
check("plan stairs: drawn with treads, the break line and UP", (await stairSymbol.locator(".pl-stair-cut").count()) === 1 && (await stairSymbol.locator(".pl-stair-label").textContent()) === "UP");
const stairX = await state("s.model.stairs[0].x");
await page.keyboard.press("ArrowRight");
check("plan stairs: an arrow key nudges the selected stair", await until(`Math.abs(s.model.stairs[0].x - ${stairX} - 0.05) < 1e-6`));
await panelTab(page, "Properties");
check("plan stairs: Properties edits the stair", await page.getByRole("tabpanel", { name: "Properties" }).getByRole("heading", { name: "Stair 1" }).isVisible());
await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });
await page.keyboard.press("PageUp");
check(
  "plan stairs: upstairs, the stairwell is drawn where the stair arrives, lettered DN",
  (await until("s.editor.activeLevelId === s.model.levels[1].id")) && (await page.locator(`${PLAN_SVG} .pl-stair--well .pl-stair-label`).textContent()) === "DN",
);
await panelTab(page, "Issues");
const stairIssue = page.getByRole("tabpanel", { name: "Issues" }).getByRole("button", { name: /Stair 1/ }).first();
check("plan stairs: Issues names the stair and the level it is on", (await stairIssue.count()) === 1 && (await stairIssue.innerText()).includes("Ground floor"));
await stairIssue.click();
check(
  "plan stairs: choosing the finding goes down to its level and selects what it is about",
  await until("s.editor.activeLevelId === 'level_ground' && (s.editor.selectedStairId ?? s.editor.selectedWallId ?? s.editor.selectedItemId) !== null"),
);
await page.locator(PLAN_SVG).click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Escape");
await page.setViewportSize(PHONE);
await page.waitForTimeout(300);
const switcherBox = await page.locator(".levels").boundingBox();
const radioBoxes = await Promise.all((await levelGroup.getByRole("radio").all()).map((r) => r.boundingBox()));
check(
  `phone ${PHONE.width}px: the level switcher fits the plan and each level is a finger tall`,
  !!switcherBox && switcherBox.x >= 0 && switcherBox.x + switcherBox.width <= PHONE.width && radioBoxes.every((b) => !!b && b.height >= 44),
  switcherBox ? `${Math.round(switcherBox.x)}..${Math.round(switcherBox.x + switcherBox.width)} px` : "no switcher",
);
// every tool on the phone's rail lies whole on the screen, with no sideways scroll to find one
const railBoxes = await Promise.all((await page.locator(".rail button").all()).map((b) => b.boundingBox()));
const railScroll = await page.locator(".rail").evaluate((el) => el.scrollWidth - el.clientWidth);
check(
  `phone ${PHONE.width}px: every tool on the rail lies within the screen, each a finger wide`,
  railBoxes.length >= 8 && railScroll <= 0 && railBoxes.every((b) => !!b && b.x >= 0 && b.x + b.width <= PHONE.width && b.width >= 44 && b.height >= 44),
  `${railBoxes.length} tools, ${railBoxes.map((b) => (b ? `${Math.round(b.x)}+${Math.round(b.width)}` : "none")).join(" ")}, overflow ${railScroll}`,
);
await railButton(page, "Add a stair").scrollIntoViewIfNeeded();
const stairButton = await railButton(page, "Add a stair").boundingBox();
check(`phone ${PHONE.width}px: the rail's Add a stair can be reached`, !!stairButton && stairButton.x >= 0 && stairButton.x + stairButton.width <= PHONE.width);
await page.setViewportSize(DESKTOP);
await panelTab(page, "Properties");
await planMenu(page, "Load Sunset Loft demo");
await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");

// ---------- 12e. storeys in 3D: stacked levels, the stair, the levels shown, walking upstairs ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft'");
  const upper = (await tool("add_level", {})).id;
  for (const [ax, ay, bx, by] of [
    [0, 0, 8, 0],
    [8, 0, 8, 6],
    [8, 6, 0, 6],
    [0, 6, 0, 0],
  ]) {
    await tool("add_wall", { ax, ay, bx, by, level: upper });
  }
  await tool("add_room", { x: 0.075, y: 0.075, w: 7.85, h: 5.85, label: "Upstairs", level: upper });
  const stairId = (await tool("add_stair", { x: 7.3, y: 5.5, rotation: 180, level: "Ground floor" })).id;
  await tool("set_active_level", { id: "Ground floor" });
  // the IFC model is written from the plan, not the view: it exports from 2D, every storey in it
  {
    const file = await downloadText(() => exportMenu(page, "Building model"));
    const ifc = ifcFacts(file);
    check(
      "IFC export: the Export menu downloads one IFC4 storey per level, from the 2D view",
      (await state("s.editor.view")) === "2d" && file?.name === "sunset-loft.ifc" && ifc.framed && ifc.schema === "IFC4" &&
        ifc.view === "ViewDefinition [DesignTransferView_V1.0]" && ifc.names("IFCBUILDINGSTOREY").join() === "Ground floor,First floor",
      `${file?.name}: ${ifc.schema}, storeys ${ifc.names("IFCBUILDINGSTOREY").join()}`,
    );
    check(
      "IFC export: the stair, its stairwell through the upper floor and every room and door are in it",
      ifc.count("IFCSTAIR") === 1 && ifc.count("IFCSTAIRFLIGHT") === 1 && ifc.count("IFCSPACE") === 4 && ifc.count("IFCDOOR") === 3 &&
        ifc.count("IFCOPENINGELEMENT") === 8 && ifc.count("IFCWALL") === 11,
      `${ifc.count("IFCSTAIR")} stair, ${ifc.count("IFCSPACE")} spaces, ${ifc.count("IFCDOOR")} doors, ${ifc.count("IFCOPENINGELEMENT")} openings, ${ifc.count("IFCWALL")} walls`,
    );
    check(
      "IFC export: each storey stands on one slab, and every room has its floor finish",
      ifc.count("IFCSLAB") === 2 && ifc.count("IFCCOVERING") === 4 && ifc.count("IFCRELCOVERSSPACES") === 4,
      `${ifc.count("IFCSLAB")} slabs, ${ifc.count("IFCCOVERING")} coverings`,
    );
  }
  await showView(page, "3D");
  // the camera is where the 3D view was left (walking): from outside, the storeys show as chosen
  await railButton(page, "Orbit").click();
  await sceneUntil((s) => !s.moving);
  check(
    "3D storeys: both levels are built, the upper one on a slab open over the stair",
    await sceneUntil((s) => s.levels.total === 2 && s.stairs === 1 && s.slabs === 1),
    JSON.stringify((await scene())?.levels),
  );
  check("3D storeys: by default the levels up to the active one show (the ground floor)", await sceneUntil((s) => s.levels.shown.join() === "level_ground"));
  const view3d = page.getByRole("button", { name: "View", exact: true });
  await view3d.click();
  const levelsField = page.getByRole("group", { name: "View" }).getByRole("combobox", { name: "Levels shown" });
  await levelsField.selectOption("all");
  check("3D storeys: the View panel's Levels shown puts every level on show", await sceneUntil((s) => s.levels.shown.length === 2));
  await page.keyboard.press("Escape");
  await page.locator(SCENE_CANVAS).hover();
  await page.keyboard.press("PageUp");
  check(
    "3D storeys: PageUp works on the level above, and the hint names it",
    (await until(`s.editor.activeLevelId === '${upper}'`)) && (await page.getByRole("status").filter({ hasText: "First floor" }).count()) >= 1,
  );
  await view3d.click();
  await levelsField.selectOption("active");
  await page.getByRole("group", { name: "View" }).getByRole("switch", { name: /^Cutaway/ }).click();
  const cutHeight = await state("s.editor.scene.cutHeight");
  check(
    "3D storeys: the cutaway slices the topmost level shown, over its own floor",
    await sceneUntil((s) => s.cut !== null && s.cut > 2.9 + cutHeight - 1e-6 && s.cut < 2.9 + cutHeight + 0.1),
    `cut at ${(await scene())?.cut}, ${await state("JSON.stringify(s.editor.scene)")}, shown ${(await scene())?.levels.shown}`,
  );
  await page.getByRole("group", { name: "View" }).getByRole("switch", { name: /^Cutaway/ }).click();
  await page.keyboard.press("Escape");
  // the OBJ holds the levels shown: fewer vertices with the upper floor hidden
  const objVertices = async () => {
    const wait = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await exportMenu(page, "3D model (OBJ)");
    const d = await wait;
    if (!d) return -1;
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(await d.path(), "utf8");
    return text.split("\n").filter((l) => l.startsWith("v ")).length;
  };
  const withUpper = await objVertices();
  await page.locator(SCENE_CANVAS).hover();
  await page.keyboard.press("PageDown");
  await until("s.editor.activeLevelId === 'level_ground'");
  await sceneUntil((s) => s.levels.shown.length === 1);
  const groundOnly = await objVertices();
  check("3D storeys: the OBJ export holds the levels shown, and only those", withUpper > groundOnly && groundOnly > 0, `${withUpper} → ${groundOnly} vertices`);
  // a click on the stair selects it, and the model outlines it
  await railButton(page, "Top view").click();
  await sceneUntil((s) => !s.moving);
  const box = await page.locator(SCENE_CANVAS).boundingBox();
  const at = await hook.evaluate((h, id) => h.sceneLocate("stair", id), stairId);
  if (at) await page.mouse.click(box.x + at.x, box.y + at.y);
  check("3D storeys: a click on the stair selects it, outlined in the model", !!at && (await until(`s.editor.selectedStairId === '${stairId}'`)) && (await sceneUntil((s) => s.marks.selection === 1)));
  await page.keyboard.press("Escape");
  check("3D storeys: Esc lets go of the stair", await until("!s.editor.selectedStairId"));
  // walking on the upper level: the walker stands on its floor, every level shown
  await hook.evaluate((h, id) => h.actions.setActiveLevel(id), upper);
  await railButton(page, "Walk").click();
  check(
    "3D storeys: Walk sets the walker down on the active level's floor, every level on show",
    await sceneUntil((s) => !s.moving && s.walker !== null && s.walker.level === upper && Math.abs(s.walker.floor - 2.9) < 1e-6 && s.levels.shown.length === 2),
    JSON.stringify((await scene())?.walker),
  );
  await railButton(page, "Orbit").click();
  await hook.evaluate((h) => h.actions.setActiveLevel("level_ground"));
  await showView(page, "Plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12f. storeys end to end: the agent alone builds a second floor, the human sees it and undoes it ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  const codes = async (level) => ((await tool("get_issues", { level })).issues ?? []).map((i) => i.code);
  await panelTab(page, "Properties");
  const groundWalls = await state("s.model.walls.length");
  // every step through the agent's tools, nothing by hand
  const upper = (await tool("add_level", { name: "Upper floor" })).id;
  for (const [ax, ay, bx, by] of [
    [0, 0, 8, 0],
    [8, 0, 8, 6],
    [8, 6, 0, 6],
    [0, 6, 0, 0],
  ]) {
    await tool("add_wall", { ax, ay, bx, by, level: "Upper floor" });
  }
  const room = await tool("add_room", { x: 0.075, y: 0.075, w: 7.85, h: 5.85, label: "Landing hall", level: "Upper floor" });
  const stair = await tool("add_stair", { x: 7.3, y: 5.5, rotation: 180, level: "Ground floor" });
  const listed = await tool("list_levels", {});
  check(
    "storeys: with tools alone the agent adds a level, walls and a room on it, and a stair that reaches it",
    stair.ok && room.ok && room.levelId === upper && listed.levels.length === 2 && listed.levels[1].elevation === 2.9 &&
      listed.levels[1].walls === 4 && listed.levels[1].rooms === 1 && listed.stairs.length === 1 && listed.stairs[0].reaches === upper,
    `${listed.summary} ${JSON.stringify(listed.stairs[0])}`,
  );
  const plan = await tool("get_model", {});
  check(
    "storeys: get_model says what stands on each level and where each thing is",
    plan.ok && /2 levels/.test(plan.summary) && plan.model.walls.filter((w) => w.levelId === upper).length === 4 && plan.model.stairs[0].levelId === "level_ground",
    plan.summary,
  );
  check("storeys: the stairwell above opens inside the upper room, and the upper floor is clean", (await codes("Upper floor")).length === 0, (await codes("Upper floor")).join());
  // a stair drawn with too few risers: the checker says so
  await tool("update_stair", { id: stair.id, risers: 10 });
  // the history holds a bounded number of steps, so count back from where the agent left it
  const stepsBuilt = await state("s.undoStack.length");
  check("storeys: a stair with risers too tall is reported on its own level", (await codes("Ground floor")).includes("stair_riser_out_of_range") && !(await codes("Upper floor")).includes("stair_riser_out_of_range"));
  await panelTab(page, "Issues");
  check("storeys: the Issues panel lists the riser finding, naming its level", (await page.getByRole("tabpanel", { name: "Issues" }).getByText(/Ground floor/).count()) >= 1);
  await panelTab(page, "Properties");
  // the plan, one level at a time: the stair climbs from the ground floor, the void shows upstairs over a ghost of the ground
  await tool("set_active_level", { id: "Ground floor" });
  check(
    "storeys: on the ground floor the plan draws the stair, lettered UP, and none of the upper walls",
    (await until("s.editor.activeLevelId === 'level_ground'")) && (await drawnWalls()) === groundWalls &&
      (await page.locator(`${PLAN_SVG} .pl-stair:not(.pl-stair--well) .pl-stair-label`).first().textContent()) === "UP",
  );
  await tool("set_active_level", { id: upper });
  check(
    "storeys: upstairs the plan draws its own walls over a ghost of the ground floor, and the stairwell lettered DN",
    (await until(`s.editor.activeLevelId === '${upper}'`)) && (await drawnWalls()) === 4 &&
      (await page.locator(`${PLAN_SVG} .pl-ghost-level .pl-ghost-wall`).count()) === groundWalls &&
      (await page.locator(`${PLAN_SVG} .pl-stair--well .pl-stair-label`).textContent()) === "DN",
  );
  await S("12f-plan-upper");
  // the 3D view: both storeys, the slab open over the stair
  await showView(page, "3D");
  await railButton(page, "Orbit").click();
  const view3d = page.getByRole("button", { name: "View", exact: true });
  await view3d.click();
  await page.getByRole("group", { name: "View" }).getByRole("combobox", { name: "Levels shown" }).selectOption("all");
  await page.keyboard.press("Escape");
  check(
    "storeys: the 3D view stacks both levels, the stair and the upper slab",
    await sceneUntil((s) => !s.moving && s.levels.total === 2 && s.levels.shown.length === 2 && s.stairs === 1 && s.slabs === 1),
    JSON.stringify((await scene())?.levels),
  );
  // the agent's removals wait for the human, and the 3D view hatches what would go
  await agentAsks("remove_stair", { id: stair.id });
  await requestCard(page).waitFor({ timeout: 5000 });
  check(
    "storeys: remove_stair waits for the human, hatched in the model",
    (await state("s.approvals[0]?.targets[0]?.type")) === "stair" && (await sceneUntil((s) => s.marks.pending >= 1)),
  );
  await answerRequest(page, "keep");
  answered = await agentAnswer();
  check("storeys: kept, the stair stays", !answered.ok && (await state("s.model.stairs.length")) === 1 && (await sceneUntil((s) => s.marks.pending === 0 && s.stairs === 1)));
  await agentAsks("remove_level", { id: "Upper floor" });
  await requestCard(page).waitFor({ timeout: 5000 });
  check("storeys: remove_level waits for the human, the whole level hatched in the model", (await state("s.approvals[0]?.targets[0]?.type")) === "level" && (await sceneUntil((s) => s.marks.pending >= 1)));
  await answerRequest(page, "keep");
  answered = await agentAnswer();
  check("storeys: kept, the level stays with all that stands on it", !answered.ok && (await state("s.model.levels.length")) === 2 && (await state(`s.model.walls.filter((w) => w.levelId === '${upper}').length`)) === 4);
  // the human undoes the agent's work step by step, across the level operations
  const canvas = page.locator(SCENE_CANVAS);
  await canvas.hover();
  await page.keyboard.press("Control+z");
  check("storeys: undo takes back the risers change, and its finding", (await until("s.model.stairs[0]?.risers === undefined")) && !(await codes("Ground floor")).includes("stair_riser_out_of_range"));
  await page.keyboard.press("Control+z");
  check("storeys: undo takes the stair away, in the model too", (await until("s.model.stairs.length === 0")) && (await sceneUntil((s) => s.stairs === 0)));
  for (let i = 0; i < 5; i++) await page.keyboard.press("Control+z");
  check("storeys: undo takes back the upper room and walls, the level stays empty", await until(`s.model.levels.length === 2 && s.model.walls.length === ${groundWalls} && s.model.rooms.every((r) => r.levelId === 'level_ground')`));
  await page.keyboard.press("Control+z");
  check(
    "storeys: one more undo takes the level away, and the level worked on falls back to the ground floor",
    (await until(`s.model.levels.length === 1 && s.undoStack.length === ${stepsBuilt - 8}`)) &&
      (await sceneUntil((s) => s.levels.total === 1 && s.levels.shown.join() === "level_ground")) &&
      (await page.getByRole("status").filter({ hasText: "Upper floor" }).count()) === 0,
    `${await state("s.model.levels.length + ' levels, ' + s.undoStack.length + ' steps'")} (${stepsBuilt} built), ${JSON.stringify((await scene())?.levels)}, ${(await page.getByRole("status").filter({ hasText: "Upper floor" }).allInnerTexts()).join(" | ")}`,
  );
  // a plan saved in the first format, said in so many words, still opens, in the 3D view as on the plan
  const v1 = await hook.evaluate((h) => {
    const m = h.store.getState().model;
    const strip = ({ levelId, ...e }) => (void levelId, e);
    // formats 1 and 2 wrote a room as its rectangle
    const asRect = ({ points, ...e }) => {
      const xs = points.map((q) => q.x);
      const ys = points.map((q) => q.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { ...e, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    };
    return { version: 1, name: "Saved as format 1", walls: m.walls.map(strip), openings: m.openings, rooms: m.rooms.map((r) => strip(asRect(r))), items: m.items.map(strip), kinds: m.kinds, underlay: null };
  });
  const loadedV1 = await hook.evaluate((h, p) => h.actions.loadModel(p), v1);
  check(
    "storeys: a format 1 plan loads as one ground floor, and the 3D view builds it",
    loadedV1.ok && loadedV1.migratedFrom === 1 && (await until("s.model.name === 'Saved as format 1' && s.model.version === 4")) &&
      (await sceneUntil((s) => s.levels.total === 1 && s.stairs === 0 && s.slabs === 0)),
    loadedV1.summary,
  );
  const future = await hook.evaluate((h, p) => h.actions.loadModel({ ...p, version: 99 }), v1);
  check("storeys: a plan from a newer format is refused, the plan shown stays", !future.ok && (await state("s.model.name")) === "Saved as format 1", future.summary);
  await showView(page, "Plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12g. storeys reviewed: refusals, names, walls under a slab, guards, framing, keys ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  const codes = async (level) => ((await tool("get_issues", { level })).issues ?? []).map((i) => i.code);
  await panelTab(page, "Properties");
  // the plan's one level cannot go: refused before anybody is asked
  r = await tool("remove_level", { id: "Ground floor" });
  check("storeys reviewed: remove_level on a one-storey plan is refused without asking the human", !r.ok && /only level/.test(r.summary) && (await state("s.approvals.length")) === 0, r.summary);
  // default names never repeat, so every level answers to its name
  const second = (await tool("add_level", {})).id;
  await tool("add_level", {});
  await hook.evaluate((h, id) => h.actions.removeLevel(id), second);
  await tool("add_level", {});
  const names = await state("s.model.levels.map((l) => l.name)");
  r = await tool("add_wall", { ax: 0, ay: 0, bx: 4, by: 0, level: names[names.length - 1] });
  check("storeys reviewed: after a removal, a new level still gets a name of its own, and the name works as `level`", new Set(names).size === names.length && r.ok, names.join(", "));
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");

  const upper = (await tool("add_level", {})).id;
  for (const [ax, ay, bx, by] of [
    [0, 0, 8, 0],
    [8, 0, 8, 6],
    [8, 6, 0, 6],
    [0, 6, 0, 0],
  ]) {
    await tool("add_wall", { ax, ay, bx, by, level: upper });
  }
  await tool("add_room", { x: 0.075, y: 0.075, w: 7.85, h: 5.85, label: "Upstairs", level: upper });
  await tool("add_stair", { x: 7.3, y: 5.5, rotation: 180, level: "Ground floor" });
  // a taller ground storey: the walls that met the slab follow it, and nothing opens under the floor above
  const groundWalls = await state("s.model.walls.filter((w) => w.levelId === 'level_ground').length");
  r = await tool("update_level", { id: "Ground floor", height: 3.4 });
  check(
    "storeys reviewed: a taller storey carries its walls up to the slab, in one step, with nothing open under it",
    r.ok && r.wallsCarried === groundWalls && !(await codes("Ground floor")).includes("wall_short_of_slab"),
    r.summary,
  );
  r = await tool("update_level", { id: "Ground floor", height: 2.9, walls: "keep" });
  check("storeys reviewed: with walls kept, a wall running up through the floor above is reported", r.ok && r.wallsCarried === 0 && (await codes("Ground floor")).includes("wall_through_slab"));
  await tool("update_level", { id: "Ground floor", height: 3.4, walls: "keep" });
  await tool("update_level", { id: "Ground floor", height: 2.9 });
  check("storeys reviewed: and lowering it again brings them back to the slab", !(await codes("Ground floor")).some((c) => c === "wall_through_slab" || c === "wall_short_of_slab"));

  // the plan upstairs: the stairwell's rim is a visible edge, with its guard; the floor below a dash-dot guide
  await tool("set_active_level", { id: upper });
  await until(`s.editor.activeLevelId === '${upper}'`);
  const well = page.locator(`${PLAN_SVG} .pl-stair--well`);
  const rimDash = await well.locator(".pl-stair-flight").first().evaluate((el) => getComputedStyle(el).strokeDasharray);
  const ghostDash = await page.locator(`${PLAN_SVG} .pl-ghost-wall`).first().evaluate((el) => getComputedStyle(el).strokeDasharray);
  check(
    "storeys reviewed: upstairs the stairwell's rim is drawn solid with a guard round it, over a dash-dot ghost of the floor below",
    (await well.locator(".pl-stair-guard").count()) === 1 && rimDash === "none" && ghostDash !== "none",
    `rim ${rimDash}, ghost ${ghostDash}`,
  );
  // the levels in Properties: each row named after its storey
  check(
    "storeys reviewed: each storey's row in Properties is a group named after it",
    (await page.getByRole("tabpanel", { name: "Properties" }).getByRole("group", { name: "Ground floor", exact: true }).count()) === 1 &&
      (await page.getByRole("tabpanel", { name: "Properties" }).getByRole("group", { name: "First floor", exact: true }).count()) === 1,
  );
  // PageUp from the activity feed pages the feed: the level stays
  await page.locator(".activity__toggle").focus();
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(150);
  check("storeys reviewed: PageDown from the activity feed leaves the level being worked on alone", (await state("s.editor.activeLevelId")) === upper);

  // the stair tool chosen on the rail by keyboard: focus goes to the plan, the arrows aim it, Enter places it
  await tool("set_active_level", { id: "Ground floor" });
  await until("s.editor.activeLevelId === 'level_ground'");
  await page.mouse.move(2, 2);
  const stairs = await state("s.model.stairs.length");
  await railButton(page, "Add a stair").focus();
  await page.keyboard.press("Enter");
  check("storeys reviewed: choosing Add a stair on the rail by keyboard hands focus to the plan", await until("document.activeElement?.id === 'canvas'"));
  await page.keyboard.press("ArrowRight");
  check(
    "storeys reviewed: with no pointer over the plan, the aimed stair is drawn and the hint says which way it climbs",
    (await page.locator(".hint__tool").innerText()) === "Add a stair, climbing right" && (await page.locator(`${PLAN_SVG} .pl-ghost-stair`).count()) === 1,
    await page.locator(".hint__tool").innerText(),
  );
  await page.keyboard.press("Enter");
  check("storeys reviewed: Enter places it, climbing the way it was aimed", (await until(`s.model.stairs.length === ${stairs + 1}`)) && (await state("s.model.stairs[s.model.stairs.length - 1].rotation")) === 90);
  await hook.evaluate((h) => h.actions.undo());
  await until(`s.model.stairs.length === ${stairs}`);

  // the 3D view: the stair stops at the ceiling of the storey shown, and the whole stack is framed
  await showView(page, "3D");
  await railButton(page, "Orbit").click();
  // the levels shown up to the one worked on (the setting lasts the page's life: 12f left it at all)
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("group", { name: "View" }).getByRole("combobox", { name: "Levels shown" }).selectOption("active");
  await page.keyboard.press("Escape");
  check("storeys reviewed: with the floor above hidden, the stair stops at the ground storey's ceiling", await sceneUntil((s) => s.storeyTop !== null && Math.abs(s.storeyTop - 2.7) < 1e-6), String((await scene())?.storeyTop));
  await hook.evaluate((h, id) => h.actions.setActiveLevel(id), upper);
  await railButton(page, "Top view").click();
  await sceneUntil((s) => !s.moving);
  await railButton(page, "Orbit").click();
  check(
    "storeys reviewed: Orbit frames every storey shown, the ground floor's foot included",
    await sceneUntil((s) => !s.moving && s.levels.shown.length === 2 && s.framed && Math.abs(s.storeyTop - 5.6) < 1e-6),
    JSON.stringify({ framed: (await scene())?.framed, top: (await scene())?.storeyTop }),
  );
  await hook.evaluate((h) => h.actions.setActiveLevel("level_ground"));
  await showView(page, "Plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12h. the shared session: the agent seen at work, the person seen by the agent, two tabs ----------
{
  const SESSION_SHOTS = process.env.ALZA_SESSION_SHOTS ?? `${OUT}/session`;
  mkdirSync(SESSION_SHOTS, { recursive: true });
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await showView(page, "Plan");
  await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(400);

  // the agent moves the sofa: its marker goes to the sofa, labelled with what it does, and the sofa is highlighted
  await tool("move_item", { id: "item_sofa", x: 3.1, y: 5.3 });
  const marker = page.locator(`${PLAN_SVG} [data-session="agent"]`);
  await marker.waitFor({ timeout: 5000 }).catch(() => undefined);
  check(
    "session: an agent's tool call puts its marker on the entity it touched, labelled with what it does",
    (await marker.getAttribute("data-entity")) === "item_sofa" && (await marker.textContent()) === "Agent · moving Sofa" && (await page.locator(`${PLAN_SVG} .ss-highlight`).count()) >= 1,
    `${await marker.getAttribute("data-entity").catch(() => null)} ${await marker.textContent().catch(() => null)}`,
  );
  await page.waitForTimeout(500);
  const sofaAt = await px(3.1, 5.3);
  const box = await marker.locator(".ss-agent__marker").boundingBox();
  check(
    "session: the agent's marker stands on the sofa on screen",
    !!box && Math.hypot(box.x + box.width / 2 - sofaAt[0], box.y + box.height / 2 - sofaAt[1]) < 4,
    JSON.stringify({ box, sofaAt }),
  );
  await page.screenshot({ path: `${SESSION_SHOTS}/agent-marker-plan.png` });
  check("session: the agent's marker goes once its call is done", await marker.waitFor({ state: "detached", timeout: 6000 }).then(() => true, () => false));

  // point_at: a ring and the agent's message on the room
  const pointed = await tool("point_at", { target: "Bedroom", message: "Is this the guest room?" });
  const ring = page.locator(`${PLAN_SVG} [data-session="point"]`);
  await ring.waitFor({ timeout: 5000 }).catch(() => undefined);
  check(
    "session: point_at shows the person the room with the agent's message",
    pointed.ok && (await ring.getAttribute("data-entity")) === "room_bed" && (await ring.textContent()) === "Is this the guest room?",
  );
  const spoken = await page.locator('.session [aria-live="polite"]').textContent().catch(() => null);
  const pointLine = await state("s.activity.at(-1)");
  check(
    "session: what the agent points at is said to the person and kept in the feed, not only drawn",
    spoken === "The agent points at Bedroom: Is this the guest room?" && pointLine?.tool === "point_at" && pointLine.summary.includes('"Is this the guest room?"'),
    `${spoken} / ${pointLine?.summary}`,
  );
  await page.waitForTimeout(500);
  const bedroom = await state("s.model.rooms.find((r) => r.id === 'room_bed')");
  const middle = await px((bedroom.points[0].x + bedroom.points[2].x) / 2, (bedroom.points[0].y + bedroom.points[2].y) / 2);
  const ringBox = await ring.locator(".ss-point__ring").boundingBox();
  check(
    "session: the ring on a room stands clear of the room's name and area in its middle",
    !!ringBox && Math.hypot(ringBox.x + ringBox.width / 2 - middle[0], ringBox.y + ringBox.height / 2 - middle[1]) > ringBox.width * 1.5,
    JSON.stringify({ ringBox, middle }),
  );
  await page.screenshot({ path: `${SESSION_SHOTS}/point-at.png` });

  // get_presence: what the person has selected and the level they are on, live
  await page.mouse.click(...(await px(6.85, 1.2)));
  await until("s.editor.selectedItemId === 'item_bed'");
  await page.mouse.move(...(await px(2.9, 4.3)));
  await page.waitForTimeout(100);
  const seen = await tool("get_presence", {});
  check(
    "session: get_presence says what the person has selected, the level they are on and what is under their pointer",
    seen.ok && seen.person.selection?.id === "item_bed" && seen.person.level.id === "level_ground" && seen.person.view === "plan" && seen.person.hover?.id === "item_coffee" && seen.person.viewport !== null && seen.person.pointer !== null,
    JSON.stringify(seen.person).slice(0, 300),
  );

  // the person drags the coffee table: an agent's change to it waits for them, and goes through once they let go
  await page.mouse.down();
  await page.mouse.move(...(await px(3.2, 4.3)), { steps: 4 });
  const held = await tool("move_item", { id: "item_coffee", x: 1, y: 1 });
  const waitingMarker = page.locator(`${PLAN_SVG} [data-session="agent"][data-waiting]`);
  const showsWaiting = await waitingMarker.waitFor({ timeout: 3000 }).then(() => true, () => false);
  const waitingText = await waitingMarker.textContent().catch(() => null);
  const waitingName = (await page.locator(".session__chip").getAttribute("aria-label")) ?? "";
  await page.screenshot({ path: `${SESSION_SHOTS}/agent-waiting.png` });
  check(
    "session: while the person holds what the agent would change, the plan and the indicator show the agent waiting for them",
    showsWaiting && waitingText === "Agent · waiting for you" && waitingName.includes("the agent (waiting for you)"),
    `${waitingText} / ${waitingName}`,
  );
  const during = await tool("get_presence", {});
  await page.mouse.up();
  check(
    "session: while the person drags a piece, an agent's change to it is refused with person_editing and nothing changes",
    !held.ok && held.conflict?.code === "person_editing" && held.conflict.entityIds.includes("item_coffee") && during.person.dragging && (await state("s.model.items.find((i) => i.id === 'item_coffee').x")) !== 1,
    held.summary,
  );
  const retried = await tool("move_item", { id: "item_coffee", x: 2.9, y: 4.3 });
  check("session: once they let go, the agent's call goes through", retried.ok, retried.summary);

  // the privacy switch: the pointer and the view are the person's to keep
  const chip = page.locator(".session__chip");
  await chip.click();
  const share = page.getByRole("switch", { name: "Share my pointer and view" });
  await share.click();
  await page.mouse.move(...(await px(3, 4.3)));
  const privateSeen = await tool("get_presence", {});
  check(
    "session: with sharing switched off, get_presence keeps the pointer and the view to the person",
    privateSeen.person.sharing === false && privateSeen.person.pointer === null && privateSeen.person.viewport === null && privateSeen.person.selection?.id === "item_coffee",
    JSON.stringify(privateSeen.person).slice(0, 300),
  );
  await share.click();
  await page.keyboard.press("Escape");
  check(
    "session: Escape closes the list and gives focus back to its button",
    (await chip.getAttribute("aria-expanded")) === "false" && (await page.evaluate(() => document.activeElement?.classList.contains("session__chip"))),
  );

  // in 3D: the agent's marker over the model and its outline on what it touches
  await showView(page, "3D");
  await railButton(page, "Orbit").click();
  await sceneUntil((s) => !s.moving);
  await tool("move_item", { id: "item_sofa", x: 3.0, y: 5.3 });
  const marker3d = page.locator('.ss-scene [data-session="agent"]');
  await marker3d.waitFor({ timeout: 5000 }).catch(() => undefined);
  check(
    "session: in 3D the agent's marker shows over what it touched, and the model outlines it in the agent's colour",
    (await marker3d.getAttribute("data-entity").catch(() => null)) === "item_sofa" && (await marker3d.isVisible().catch(() => false)) && (await sceneUntil((s) => s.agentMarks >= 1)),
    String((await scene())?.agentMarks),
  );
  await page.screenshot({ path: `${SESSION_SHOTS}/agent-marker-3d.png` });
  // with the marker up and nothing moving, nothing asks for frames: the markers follow the view's own
  const framesBefore = (await scene())?.frames;
  const asked = await page.evaluate(async (ms) => {
    let n = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      n++;
      return raf(cb);
    };
    await new Promise((resolve) => setTimeout(resolve, ms));
    window.requestAnimationFrame = raf;
    return n;
  }, 500);
  check(
    "session: in 3D a marker over the view costs nothing while the view is at rest",
    asked === 0 && (await scene())?.frames === framesBefore && (await marker3d.isVisible().catch(() => false)),
    `${asked} frames asked, ${framesBefore} -> ${(await scene())?.frames}`,
  );
  await showView(page, "Plan");

  // two tabs of one browser on one plan: an edit in one is in the other, and each sees the other's pointer
  const context = await browser.newContext({ viewport: DESKTOP });
  const tabErrors = [];
  const one = await context.newPage();
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && tabErrors.push(m.text()));
    p.on("pageerror", (e) => tabErrors.push(String(e)));
  };
  watch(one);
  const hookOne = await openStudio(one, BASE);
  const live = (p, h) => p.waitForFunction((hh) => hh.presence.getState().session.state === "live", h, { timeout: 10000 }).then(() => true, () => false);
  const liveOne = await live(one, hookOne);
  // the first tab works on its plan before the second arrives: the second takes it up
  await hookOne.evaluate((h) => h.runTool("set_plan_name", { name: "Shared loft" }));
  const two = await context.newPage();
  watch(two);
  const hookTwo = await openStudio(two, BASE);
  const liveTwo = await live(two, hookTwo);
  const nameTwo = await two.waitForFunction((h) => h.store.getState().model.name === "Shared loft", hookTwo, { timeout: 5000 }).then(() => true, () => false);
  check("session: a second tab joins the first and takes up its plan", liveOne && liveTwo && nameTwo);

  await hookOne.evaluate((h) => h.runTool("move_item", { id: "item_desk", x: 4.0, y: 0.45 }));
  const synced = await two
    .waitForFunction((h) => h.store.getState().model.items.find((i) => i.id === "item_desk")?.x === 4.0, hookTwo, { timeout: 5000 })
    .then(() => true, () => false);
  const peerLine = await hookTwo.evaluate((h) => h.store.getState().activity.at(-1));
  check("session: an edit in one tab is in the other, as one line from that tab", synced && peerLine?.source === "peer" && peerLine?.tool === "move_item", JSON.stringify(peerLine));

  // and back: a drag in the second tab moves the piece in the first
  await two.bringToFront();
  await two.mouse.move(...(await planToScreen(two, 6.85, 1.2)));
  await two.mouse.down();
  await two.mouse.move(...(await planToScreen(two, 6.85, 1.6)), { steps: 5 });
  await two.mouse.up();
  const backSynced = await one
    .waitForFunction((h) => Math.abs(h.store.getState().model.items.find((i) => i.id === "item_bed").y - 1.6) < 1e-6, hookOne, { timeout: 5000 })
    .then(() => true, () => false);
  check("session: a drag in the other tab reaches the first", backSynced, String(await hookOne.evaluate((h) => h.store.getState().model.items.find((i) => i.id === "item_bed").y)));

  // Undo in the second tab takes back its own drag, not the first tab's move of the desk
  await two.keyboard.press("Control+z");
  const bedOf = (h) => h.store.getState().model.items.find((i) => i.id === "item_bed").y;
  const deskOf = (h) => h.store.getState().model.items.find((i) => i.id === "item_desk").x;
  const undoneInOne = await one.waitForFunction((h) => Math.abs(h.store.getState().model.items.find((i) => i.id === "item_bed").y - 1.2) < 1e-6, hookOne, { timeout: 5000 }).then(() => true, () => false);
  check(
    "session: Undo in one tab takes back that tab's own change, in both tabs, and leaves the other tab's",
    undoneInOne && Math.abs((await hookTwo.evaluate(bedOf)) - 1.2) < 1e-6 && (await hookOne.evaluate(deskOf)) === 4.0 && (await hookTwo.evaluate(deskOf)) === 4.0,
    `${await hookOne.evaluate(bedOf)} ${await hookOne.evaluate(deskOf)} ${await hookTwo.evaluate(deskOf)}`,
  );

  // the person in the second tab takes hold of the bed: the first tab's agent is refused from the first frame on
  await two.mouse.move(...(await planToScreen(two, 6.85, 1.2)));
  await two.mouse.down();
  await two.mouse.move(...(await planToScreen(two, 6.85, 1.4)), { steps: 2 });
  const sawFrame = await one.waitForFunction((h) => h.store.getState().model.items.find((i) => i.id === "item_bed").y > 1.2 + 1e-6, hookOne, { timeout: 5000 }).then(() => true, () => false);
  const raced = await hookOne.evaluate((h) => h.runTool("move_item", { id: "item_bed", x: 3, y: 3 }));
  await two.mouse.up();
  check(
    "session: an agent's change to what another tab's person has just taken hold of is refused at once, not overwritten later",
    sawFrame && !raced.ok && raced.conflict?.code === "person_editing" && raced.conflict.entityIds.includes("item_bed"),
    raced.summary,
  );
  const released = await one.waitForFunction((h) => h.presence.getState().peers.every((p) => p.editing.length === 0), hookOne, { timeout: 5000 }).then(() => true, () => false);
  const settledBed = await hookOne.evaluate((h) => h.runTool("move_item", { id: "item_bed", x: 6.85, y: 1.2 }));
  const bothBed = await two.waitForFunction((h) => Math.abs(h.store.getState().model.items.find((i) => i.id === "item_bed").y - 1.2) < 1e-6, hookTwo, { timeout: 5000 }).then(() => true, () => false);
  check("session: once that person lets go, the agent's change goes through in both tabs", released && settledBed.ok && bothBed, settledBed.summary);

  // the sharing switch is the browser's: switched off in one tab, the other stops sharing its pointer too
  await one.bringToFront();
  await one.locator(".session__chip").click();
  await one.getByRole("switch", { name: "Share my pointer and view" }).click();
  await one.keyboard.press("Escape");
  const followed = await two.waitForFunction((h) => h.presence.getState().sharing === false, hookTwo, { timeout: 5000 }).then(() => true, () => false);
  await two.bringToFront();
  await two.mouse.move(...(await planToScreen(two, 4, 4)));
  await two.mouse.move(...(await planToScreen(two, 4.5, 4)), { steps: 3 });
  await one.waitForTimeout(400);
  const twoSeen = await hookTwo.evaluate((h) => h.runTool("get_presence", {}));
  const pointerInOne = await hookOne.evaluate((h) => h.presence.getState().peers.map((p) => p.pointer));
  check(
    "session: sharing switched off in one tab keeps the pointer private in the person's other tabs too",
    followed && twoSeen.person.pointer === null && twoSeen.person.viewport === null && pointerInOne.every((p) => p === null),
    JSON.stringify({ followed, pointer: twoSeen.person.pointer, pointerInOne }),
  );
  await one.bringToFront();
  await one.locator(".session__chip").click();
  await one.getByRole("switch", { name: "Share my pointer and view" }).click();
  await one.keyboard.press("Escape");
  await two.waitForFunction((h) => h.presence.getState().sharing === true, hookTwo, { timeout: 5000 }).catch(() => undefined);

  // each tab shows the other's pointer, named after its tab
  await one.bringToFront();
  await one.mouse.move(...(await planToScreen(one, 2, 2)));
  await one.mouse.move(...(await planToScreen(one, 2.5, 2.5)), { steps: 3 });
  const cursorInTwo = two.locator(`${PLAN_SVG} [data-session="cursor"]`);
  const sawOne = await cursorInTwo.waitFor({ timeout: 5000 }).then(() => true, () => false);
  await two.bringToFront();
  await two.mouse.move(...(await planToScreen(two, 5, 5)));
  await two.mouse.move(...(await planToScreen(two, 5.5, 5)), { steps: 3 });
  const cursorInOne = one.locator(`${PLAN_SVG} [data-session="cursor"]`);
  const sawTwo = await cursorInOne.waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(
    "session: each tab shows the other's pointer, named after its tab",
    sawOne && sawTwo && (await cursorInTwo.textContent()) === "Tab 1" && (await cursorInOne.textContent()) === "Tab 2",
    `${await cursorInTwo.textContent().catch(() => null)} / ${await cursorInOne.textContent().catch(() => null)}`,
  );
  check(
    "session: the presence indicator names the other tab",
    ((await one.locator(".session__chip").getAttribute("aria-label")) ?? "").includes("Tab 2") && ((await two.locator(".session__chip").getAttribute("aria-label")) ?? "").includes("Tab 1"),
  );
  await one.locator(".session__chip").click();
  await one.screenshot({ path: `${SESSION_SHOTS}/two-tabs-first.png` });
  await one.keyboard.press("Escape");
  await two.screenshot({ path: `${SESSION_SHOTS}/two-tabs-second.png` });

  // a tab that closes leaves the other's list
  await two.close({ runBeforeUnload: true });
  const left = await one.waitForFunction((h) => h.presence.getState().peers.length === 0, hookOne, { timeout: 10000 }).then(() => true, () => false);
  check("session: a tab that closes leaves the plan", left);

  // at phone width the indicator fits the top bar
  await one.setViewportSize(PHONE);
  await one.waitForTimeout(300);
  const fits = await one.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && !!document.querySelector(".session__chip"));
  await one.screenshot({ path: `${SESSION_SHOTS}/phone.png` });
  check("session: at 390px the presence indicator fits without a sideways scroll", fits);
  await one.locator(".session__chip").click();
  const panelBox = await one.locator(".session__panel").boundingBox();
  const switchBox = await one.getByRole("switch", { name: "Share my pointer and view" }).boundingBox();
  await one.screenshot({ path: `${SESSION_SHOTS}/phone-panel.png` });
  check(
    "session: at 390px the list opens within the screen's gutters, its switch whole",
    !!panelBox && !!switchBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= PHONE.width && switchBox.x >= panelBox.x && switchBox.x + switchBox.width <= panelBox.x + panelBox.width,
    JSON.stringify({ panelBox, switchBox }),
  );
  await one.keyboard.press("Escape");
  check("session: no console errors in the two tabs", tabErrors.length === 0, tabErrors.slice(0, 3).join(" ;; "));
  await context.close();
}

// ---------- 12i. free shapes: polygon rooms, arc edges, curved walls, the Crescent House demo ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await page.bringToFront();
  await page.setViewportSize(DESKTOP);
  await showView(page, "Plan");
  await planMenu(page, "Clear plan");
  await until("s.model.walls.length === 0 && s.model.rooms.length === 0");

  // a curved wall by its sagitta: stored as a bulge, read back with its arc and its length along it
  const bent = await tool("add_wall", { ax: 0, ay: 0, bx: 6, by: 0, thickness: 0.2, curve: { sagitta: -1.5 } });
  const read = await tool("get_model", {});
  const arcWall = read.model?.walls.find((w) => w.id === bent.id);
  check(
    "shapes: add_wall bends a wall by its sagitta; get_model gives its arc, radius and length along it",
    bent.ok && !!arcWall?.arc && Math.abs(arcWall.arc.sagitta + 1.5) < 1e-3 && Math.abs(arcWall.arc.radius - 3.75) < 1e-3 && arcWall.length > 6.9 && arcWall.length < 7,
    `${bent.summary} ${JSON.stringify(arcWall?.arc)} ${arcWall?.length}`,
  );
  const win = await tool("add_window", { wallId: bent.id, t: 0.5, width: 1.2 });
  const tooWide = await tool("add_window", { wallId: bent.id, t: 0.2, width: 3 });
  check("shapes: a window sits on the arc; one too wide for the bend is refused with the reason", win.ok && !tooWide.ok && /too wide for the bend/.test(tooWide.summary), tooWide.summary);
  const straight = await tool("edit_wall", { id: bent.id, curve: { sagitta: 0 } });
  check("shapes: edit_wall straightens it again", straight.ok && (await state(`s.model.walls.find((w) => w.id === '${bent.id}').bulge === undefined`)));
  // a removal asked by the agent waits for the person; this one is the person's own
  await hook.evaluate((h, id) => h.actions.removeWall(id), bent.id);
  await until("s.model.walls.length === 0", 2000);

  // an L by its corners, given anticlockwise, with one edge bowed out of it
  const ell = await tool("add_room", { points: [[0, 0], [0, 4], [5, 4], [5, 2], [2, 2], [2, 0]], arcs: [{ edge: 1, sagitta: 0.8 }], label: "Ell", floor: "oak" });
  const ellRoom = (await tool("get_model", {})).model?.rooms.find((r) => r.id === ell.id);
  check(
    "shapes: add_room takes an outline with an arc edge; get_model gives its area, perimeter and an anchor inside it",
    ell.ok && ellRoom?.points.length === 6 && ellRoom.points.some((p) => p.bulge !== undefined) && ellRoom.area > 16.5 && ellRoom.area < 17 && !ellRoom.rect && ellRoom.anchor.y > 2 && ellRoom.anchor.y < 4.8,
    `${ell.summary} ${JSON.stringify({ area: ellRoom?.area, anchor: ellRoom?.anchor })}`,
  );
  check("shapes: the plan draws the outline as one path", (await page.locator(`${PLAN_SVG} path.pl-floor`).count()) === 1);
  const crossed = await tool("add_room", { points: [[0, 0], [4, 4], [4, 0], [0, 4]], label: "Bow tie" });
  check("shapes: an outline that crosses itself is refused", !crossed.ok && /cross/.test(crossed.summary), crossed.summary);
  // a corner added at the middle of a straight edge, as the plan's edge handle adds one
  const reshaped = await hook.evaluate((h, id) => {
    const pts = h.store.getState().model.rooms.find((r) => r.id === id).points;
    const edge = pts.findIndex((p) => p.bulge === undefined);
    const a = pts[edge];
    const b = pts[(edge + 1) % pts.length];
    return h.actions.reshapeRoom(id, { op: "insert_vertex", edge, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }, ell.id);
  check("shapes: the reshape_room command (the person's action) adds a corner on an edge", reshaped.ok && reshaped.corners === 7 && (await state("s.model.rooms[0].points.length")) === 7, reshaped.summary);
  const viaTool = await tool("update_room", { id: "Ell", points: [[0, 0], [4, 0], [4, 3], [0, 3]] });
  check("shapes: update_room reshapes by points; the room is a rectangle again", viaTool.ok && Math.abs(viaTool.area - 12) < 1e-6 && !!(await tool("get_model", {})).model?.rooms[0].rect, viaTool.summary);
  // fit: four walls round a point, and the room fills them to their inner faces
  for (const [ax, ay, bx, by] of [[10, 0, 14, 0], [14, 0, 14, 3], [14, 3, 10, 3], [10, 3, 10, 0]]) await tool("add_wall", { ax, ay, bx, by, thickness: 0.2 });
  const fitted = await tool("add_room", { fit: [12, 1.5], label: "Fitted" });
  check("shapes: add_room { fit } fills the space the walls close off", fitted.ok && Math.abs(fitted.area - 3.8 * 2.8) < 1e-3, fitted.summary);

  // a format-2 plan, rooms as rectangles: loads migrated, its rooms as their four corners
  const v2 = await hook.evaluate((h) => {
    // format 2 had no columns
    const { columns, ...m } = h.store.getState().model;
    void columns;
    return { ...m, version: 2, name: "Saved as format 2", rooms: [{ id: "room_old", levelId: m.levels[0].id, x: 1, y: 1, w: 3, h: 2, label: "Old", floor: "tile" }] };
  });
  const loadedV2 = await hook.evaluate((h, p) => h.actions.loadModel(p), v2);
  check(
    "shapes: a format-2 plan loads, each rectangle room as its four corners",
    loadedV2.ok && loadedV2.migratedFrom === 2 && (await until("s.model.version === 4 && s.model.rooms[0].points.length === 4 && s.model.rooms[0].points[2].x === 4 && s.model.rooms[0].points[2].y === 3")),
    loadedV2.summary,
  );

  // the demo house: two storeys, a curved bay, rooms fitted to their walls, clean, on the plan and in 3D
  await planMenu(page, "Load Crescent House demo");
  const demo = await until("s.model.name === 'Crescent House'", 5000);
  const demoIssues = await tool("get_issues", {});
  const curved = await state("s.model.walls.filter((w) => w.bulge !== undefined).length");
  check("shapes: the Crescent House demo loads from the plan menu, clean, with curved walls", demo && demoIssues.ok && demoIssues.issues.length === 0 && curved >= 2, `${demoIssues.summary} ${curved}`);
  const shownRooms = await state("s.model.rooms.filter((r) => r.levelId === 'level_ground').length");
  check("shapes: the demo's ground-floor rooms are drawn as outlines", (await page.locator(`${PLAN_SVG} path.pl-floor`).count()) === shownRooms, String(shownRooms));
  check("shapes: no two of the demo's doors swing into each other", !demoIssues.issues?.some((i) => i.code === "doors_swing_together"));
  // the curved facade in Properties: named by the room it runs along, read on its arc
  await hook.evaluate((h) => h.actions.selectWall("g_facade"));
  await panelTab(page, "Properties");
  const facadeProps = page.getByRole("tabpanel", { name: "Properties" });
  check("shapes: Properties says the curved facade runs along the living room", await facadeProps.getByText("Along Living").first().isVisible().catch(() => false), ((await facadeProps.textContent().catch(() => "")) ?? "").slice(0, 200));
  await hook.evaluate((h) => h.actions.selectWall(null));
  // the bottom row: the room tool's hint sits beside the zoom dock, never over it
  await page.keyboard.press("r");
  await until("s.editor.drawMode === 'room'");
  {
    const hintBox = await page.locator(".canvas__hint .hint").boundingBox();
    const zoomBox = await page.locator(".canvas__zoom .zoom").boundingBox();
    const apart = !!hintBox && !!zoomBox && (hintBox.x >= zoomBox.x + zoomBox.width || hintBox.y + hintBox.height <= zoomBox.y);
    check("shapes: the room tool's hint leaves the zoom controls and Fit uncovered", apart && (await page.getByRole("button", { name: /^Fit/ }).first().isVisible()), JSON.stringify({ hintBox, zoomBox }));
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await S("12i-crescent-plan");
  // upstairs, the roof terrace's parapets (its curve among them) stop below the plan's cut: drawn in outline, not poché
  await tool("set_active_level", { id: "First floor" });
  const parapetCount = await state("s.model.walls.filter((w) => w.levelId === 'level_first' && w.height < 2).length");
  const parapets = await page
    .waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n, [`${PLAN_SVG} .pl-wall-fill--below-cut`, parapetCount], { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("shapes: the roof terrace's four parapets are drawn below the cut, in outline", parapetCount === 4 && parapets, String(parapetCount));
  await S("12i-crescent-first");
  await tool("set_active_level", { id: "Ground floor" });
  await showView(page, "3D");
  check("shapes: the 3D view builds the demo's two storeys and its stair", await sceneUntil((s) => s.levels.total === 2 && s.stairs === 1 && s.entities > 0, 8000), JSON.stringify((await scene())?.levels));
  await S("12i-crescent-3d");
  // its curved walls are solids like any other: one is picked by a click on its top, and outlined
  await railButton(page, "Top view").click();
  await sceneUntil((s) => !s.moving, 4000);
  const facadeAt = await hook.evaluate((h) => h.sceneLocate("wall", "g_facade"));
  const canvasAt = await page.locator(SCENE_CANVAS).boundingBox();
  if (facadeAt && canvasAt) await page.mouse.click(canvasAt.x + facadeAt.x, canvasAt.y + facadeAt.y);
  check(
    "shapes: a click on the curved facade in 3D selects it, and the model outlines it",
    !!facadeAt && (await until("s.editor.selectedWallId === 'g_facade'")) && (await sceneUntil((s) => s.marks.selection === 1)),
    JSON.stringify(facadeAt),
  );
  await S("12i-crescent-3d-facade");
  await hook.evaluate((h) => h.actions.selectWall(null));
  // walking up to the front door under the main bedroom: every storey is shown, and the slab over
  // the porch hides the names of the rooms on it, as the walls do
  await railButton(page, "Walk").click();
  await sceneUntil((s) => !s.moving && s.walker !== null && s.levels.shown.length === 2, 6000);
  await hook.evaluate((h) => h.sceneLook([9.2, 1.6, 20.5], [8.6, 1.4, 14.6]));
  await sceneUntil((s) => !s.moving, 4000);
  await page.waitForTimeout(300);
  {
    const upstairs = await state("s.model.rooms.filter((r) => r.levelId === 'level_first').map((r) => r.label)");
    const names = await page.evaluate(() => [...document.querySelectorAll(".scene-label:not([hidden]) .scene-label__name")].map((e) => e.textContent));
    check("shapes: walking at the front door, the names of the rooms upstairs are hidden by the slab over the porch", names.length > 0 && names.every((n) => !upstairs.includes(n)), JSON.stringify(names));
  }
  await railButton(page, "Orbit").click();
  // the building model: curved walls on their arcs, shaped rooms by their outlines
  {
    // every opening in a wall, and one cut in a floor for each stairwell
    const counts = await state("({ walls: s.model.walls.length, spaces: s.model.rooms.length, openings: s.model.openings.length + s.model.stairs.length })");
    const file = await downloadText(() => exportMenu(page, "Building model"));
    const ifc = ifcFacts(file);
    const arcs = file ? (file.text.match(/IFCARCINDEX\(/g) ?? []).length : 0;
    check(
      "shapes: the IFC export writes curved walls and shaped rooms with IFC4 arcs, every wall, space and opening in it",
      file?.name === "crescent-house.ifc" && ifc.framed && ifc.schema === "IFC4" && ifc.count("IFCWALL") === counts.walls && ifc.count("IFCSPACE") === counts.spaces &&
        ifc.count("IFCOPENINGELEMENT") === counts.openings && ifc.count("IFCINDEXEDPOLYCURVE") > 0 && arcs >= 6,
      `${file?.name}: ${ifc.count("IFCWALL")} walls, ${ifc.count("IFCSPACE")} spaces, ${ifc.count("IFCOPENINGELEMENT")} openings, ${ifc.count("IFCINDEXEDPOLYCURVE")} curves, ${arcs} arcs`,
    );
  }
  await showView(page, "Plan");
  await page.keyboard.press("Control+z");
  check("shapes: Undo brings back the plan the demo replaced", await until("s.model.name === 'Saved as format 2'", 3000));
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12j. free shapes by hand: the room tool corner by corner, the handles, bending a wall ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  const drag = async (from, to) => {
    await page.mouse.move(...(await px(...from)));
    await page.mouse.down();
    await page.mouse.move(...(await px(...to)), { steps: 6 });
    await page.mouse.up();
  };
  await page.bringToFront();
  await page.setViewportSize(DESKTOP);
  await showView(page, "Plan");
  await planMenu(page, "Clear plan");
  await until("s.model.walls.length === 0 && s.model.rooms.length === 0");

  // the room tool from the rail by keyboard: Enter on its button hands the keys to the plan,
  // whose arrows move the cross, C puts a corner down and Enter closes the outline
  await railButton(page, "Select").focus();
  await railButton(page, "Draw a room").focus();
  await page.keyboard.press("Enter");
  await until("s.editor.drawMode === 'room'");
  const planHasKeys = await page
    .waitForFunction(() => document.activeElement?.id === "canvas", undefined, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check("shapes by hand: choosing Draw a room with Enter on the rail hands the keyboard to the plan", planHasKeys);
  const right = Array(6).fill("Shift+ArrowRight");
  const down = Array(4).fill("Shift+ArrowDown");
  for (const key of ["c", ...right, "c", ...down, "c"]) await page.keyboard.press(key);
  const crossSaid = (await page.locator(".hint").textContent()) ?? "";
  check("shapes by hand: the hint letters the keyboard's cross and the edge it would make", crossSaid.includes("Cross at X ") && crossSaid.includes(" m, Y ") && crossSaid.includes("would be"), crossSaid);
  await page.keyboard.press("Enter");
  check("shapes by hand: Draw a room chosen from the rail with Enter draws a room from the keys alone", await until("s.model.rooms.length === 1 && s.model.rooms[0].points.length === 3"), JSON.stringify(await state("s.model.rooms.map((r) => r.points)")));
  await page.keyboard.press("Control+z");
  await until("s.model.rooms.length === 0");

  // an L, a click at each corner, closed with a click on the first
  await railButton(page, "Draw a room").click();
  for (const [x, y] of [[1, 1], [5, 1], [5, 3], [3, 3], [3, 5], [1, 5]]) await click(x, y);
  check("shapes by hand: each click puts a corner down", (await page.locator(`${PLAN_SVG} .pl-preview-draft[data-corners="6"]`).count()) === 1);
  await page.keyboard.press("Backspace");
  check("shapes by hand: Backspace takes the last corner back", (await page.locator(`${PLAN_SVG} .pl-preview-draft[data-corners="5"]`).count()) === 1);
  await click(1, 5);
  await click(1, 1);
  check(
    "shapes by hand: a click on the first corner closes the outline into one L-shaped room",
    await until("s.model.rooms.length === 1 && s.model.rooms[0].points.length === 6"),
    JSON.stringify(await state("s.model.rooms[0] && s.model.rooms[0].points")),
  );

  // its handles: a corner dragged, an edge bowed out from its middle, each one undo step
  await railButton(page, "Select").click();
  await click(2, 4);
  check("shapes by hand: the selected room shows a handle on each corner and edge", (await page.locator(`${PLAN_SVG} .pl-corner-handle`).count()) === 6 && (await page.locator(`${PLAN_SVG} .pl-edge-handle`).count()) >= 4);
  await drag([5, 3], [6, 3.5]);
  check("shapes by hand: dragging a corner moves it", await until("s.model.rooms[0].points.some((p) => p.x === 6 && p.y === 3.5)"));
  await drag([3, 1], [3, 0.3]);
  check(
    "shapes by hand: dragging an edge's middle bends it out of the room",
    await until("s.model.rooms[0].points.some((p) => p.bulge > 0)"),
  );
  check("shapes by hand: the arc edge is lettered with its radius", (await page.locator(`${PLAN_SVG} .pl-edge-dim`).filter({ hasText: "R " }).count()) >= 1);
  await page.keyboard.press("Control+z");
  // the drag was many frames: one Undo taking it all back shows it was one step
  check("shapes by hand: one Undo straightens the whole drag again", await until("s.model.rooms[0].points.every((p) => p.bulge === undefined)"));
  // from the keyboard: Properties lists the corners, and adds one on an edge
  await panelTab(page, "Properties");
  const props = page.getByRole("tabpanel", { name: "Properties" });
  await props.getByRole("button", { name: "Add a corner on edge 1" }).click();
  check("shapes by hand: Properties adds a corner on an edge", await until("s.model.rooms[0].points.length === 7"));

  // a wall bent from its middle, drawn with arcs, a window cut along it
  const wall = await tool("add_wall", { ax: 1, ay: 6.5, bx: 7, by: 6.5, thickness: 0.2 });
  await click(4, 6.5);
  check("shapes by hand: the wall is selected and offers its bend handle", (await page.locator(`${PLAN_SVG} .pl-bend-handle`).count()) === 1);
  await drag([4, 6.5], [4, 5.8]);
  check("shapes by hand: dragging a wall's middle bends it into an arc", await until(`(s.model.walls.find((w) => w.id === '${wall.id}') || {}).bulge > 0`));
  check("shapes by hand: the curved wall's poché is drawn with arcs", ((await page.locator(`${PLAN_SVG} .pl-wall-fill[data-wall="${wall.id}"]`).getAttribute("d")) ?? "").includes("A"));
  const win = await tool("add_window", { wallId: wall.id, t: 0.5 });
  const gap = win.ok ? await page.locator(`${PLAN_SVG} [data-opening="${win.id}"] .pl-gap`).getAttribute("d") : "";
  check("shapes by hand: a window on the arc is cut along it", win.ok && (gap ?? "").includes("A"), win.summary);
  await S("12j-shapes-by-hand");
  await page.keyboard.press("Escape");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12k. an agent builds a shaped house, tool call by tool call ----------
// Two storeys: a curved living-room facade, a wing turned 45° off the east wall, an L kitchen
// round a pantry, a roof terrace over the wing, a stair; every room fitted to its walls.
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await page.bringToFront();
  await page.setViewportSize(DESKTOP);
  await showView(page, "Plan");
  await planMenu(page, "Clear plan");
  await until("s.model.walls.length === 0 && s.model.rooms.length === 0");
  const refused = [];
  const T = async (name, args) => {
    const r = await tool(name, args);
    if (!r.ok) refused.push(`${name}: ${r.summary}`);
    return r;
  };
  await T("set_plan_name", { name: "Hillside House" });
  const F = (await T("add_level", {})).id;
  const [W, D, X6, Y] = [12, 7, 6, 3.5];
  const turn = Math.PI / 4;
  const cm = (v) => Math.round(v * 100) / 100;
  const NE = [cm(W + Math.cos(turn) * 4.6), cm(3 + Math.sin(turn) * 4.6)];
  const back = (NE[0] - W) * Math.cos(turn) + (NE[1] - D) * Math.sin(turn);
  const SE = [cm(W + Math.cos(turn) * back), cm(D + Math.sin(turn) * back)];
  const ids = {};
  const wall = async (key, ax, ay, bx, by, thickness, extra = {}) => (ids[key] = (await T("add_wall", { ax, ay, bx, by, thickness, ...extra })).id);
  for (const [tag, on] of [["g", {}], ["f", { level: F }]]) {
    await wall(`${tag}_n`, 0, 0, W, 0, 0.2, on);
    await wall(`${tag}_e`, W, 0, W, D, 0.2, on);
    await wall(`${tag}_s`, W, D, X6, D, 0.2, on);
    // west along the south side: its left is the garden, so a positive sagitta bows the facade out
    await wall(`${tag}_facade`, X6, D, 0, D, 0.2, { ...on, curve: { sagitta: 1.4 } });
    await wall(`${tag}_w`, 0, D, 0, 0, 0.2, on);
    const wing = tag === "f" ? { ...on, height: 1.1 } : on;
    await wall(`${tag}_wing_n`, W, 3, ...NE, 0.2, wing);
    await wall(`${tag}_wing_end`, ...NE, ...SE, 0.2, wing);
    await wall(`${tag}_wing_s`, ...SE, W, D, 0.2, wing);
  }
  await wall("g_mid_w", 0, Y, X6, Y, 0.1);
  await wall("g_mid_e", X6, Y, W, Y, 0.1);
  await wall("g_x6", X6, 0, X6, D, 0.1);
  await wall("g_pantry_w", 4, 0, 4, 1.6, 0.1);
  await wall("g_pantry_s", 4, 1.6, X6, 1.6, 0.1);
  await wall("f_mid", 0, Y, W, Y, 0.1, { level: F });
  await wall("f_x5", 5, 0, 5, Y, 0.1, { level: F });
  await wall("f_x6", X6, Y, X6, D, 0.1, { level: F });
  await wall("f_x85", 8.5, Y, 8.5, D, 0.1, { level: F });
  const door = (key, t, extra = {}) => T("add_door", { wallId: ids[key], t, ...extra });
  const win = (key, t, extra = {}) => T("add_window", { wallId: ids[key], t, ...extra });
  const bay = { width: 1.4, sill: 0.6, height: 1.6 };
  await door("g_e", 2.5 / D, { hinge: "b", side: "left" });
  // clear of the pantry door's swing in the kitchen's corner (doors_swing_together)
  const hallDoor = await door("g_x6", 2.95 / D);
  await door("g_mid_w", 4.5 / X6, { width: 1.4 });
  await door("g_pantry_s", 0.5, { width: 0.8 });
  await door("g_mid_e", 1 / (W - X6));
  await door("g_e", 5.2 / D);
  const gardenDoor = await door("g_facade", 0.5);
  for (const t of [0.22, 0.78]) await win("g_facade", t, bay);
  for (const [key, t, extra] of [["g_n", 1.4 / W], ["g_w", (D - 1.75) / D], ["g_w", (D - 5.25) / D], ["g_n", 9 / W], ["g_s", 0.5], ["g_wing_n", 0.6], ["g_wing_end", 0.5, { width: 1.2 }]]) await win(key, t, extra);
  await door("f_x5", 2.1 / Y);
  for (const t of [5.5 / W, 7.25 / W]) await door("f_mid", t, { width: 0.8 });
  await door("f_mid", 10.25 / W);
  await door("f_e", 5.25 / D, { side: "left" });
  for (const t of [0.22, 0.5, 0.78]) await win("f_facade", t, bay);
  for (const t of [2.5 / W, 9 / W]) await win("f_n", t);
  await win("f_s", (W - 7.25) / (W - X6), { width: 0.8, sill: 1.2, height: 0.9 });
  await win("f_s", (W - 10.25) / (W - X6));
  const fit = (label, floor, at, level) => T("add_room", { fit: at, label, floor, ...(level ? { level } : {}) });
  for (const [label, floor, at] of [["Kitchen", "tile", [1, 1]], ["Pantry", "tile", [5, 0.8]], ["Living", "oak", [3, 5]], ["Hall", "concrete", [9, 2]], ["Study", "oak", [9, 5]], ["Guest room", "carpet", [13.2, 5.5]]]) await fit(label, floor, at);
  for (const [label, floor, at] of [["Bedroom", "carpet", [2, 2]], ["Landing", "oak", [8, 2]], ["Main bedroom", "oak", [3, 5]], ["Bathroom", "tile", [7, 5]], ["Lounge", "oak", [10, 5]], ["Roof terrace", "concrete", [13.2, 5.5]]]) await fit(label, floor, at, F);
  await T("add_stair", { x: 11, y: 0.6, rotation: 270, width: 0.9 });
  for (const item of [
    { kind: "sofa_3", x: 2.4, y: 4.04, rotation: 0 },
    { kind: "rug", x: 2.4, y: 5.3, rotation: 0 },
    { kind: "dining_table", x: 2.4, y: 2.3, rotation: 0 },
    { kind: "kitchen_counter", x: 1.4, y: 0.41, rotation: 0 },
    { kind: "desk", x: 8, y: 6.57, rotation: 180 },
    { kind: "bed_double", x: 3, y: 4.58, rotation: 0, level: F },
    { kind: "armchair", x: 13.4, y: 6.2, rotation: 135, level: F },
  ])
    await T("place_item", item);
  check("hillside: every tool call of the build is taken", refused.length === 0, refused.slice(0, 3).join(" ;; "));

  const built = (await tool("get_model", {})).model;
  const roomNamed = (label) => built?.rooms.find((r) => r.label === label);
  const wing = built?.walls.find((w) => w.id === ids.g_wing_n);
  const wingTurn = wing ? (Math.atan2(wing.by - wing.ay, wing.bx - wing.ax) * 180) / Math.PI : NaN;
  check(
    "hillside: two storeys, curved facades on both, a wing at 45°, an L kitchen, shaped rooms reported with area and perimeter",
    built?.levels.length === 2 && built.walls.length === 25 && built.walls.filter((w) => w.arc).length === 2 && Math.abs(wingTurn - 45) < 0.5 &&
      roomNamed("Kitchen")?.points.length === 6 && !roomNamed("Kitchen")?.rect && roomNamed("Living")?.points.some((p) => p.bulge !== undefined) &&
      !roomNamed("Guest room")?.rect && !roomNamed("Roof terrace")?.rect && built.rooms.every((r) => r.area > 0 && r.perimeter > 0) && built.stairs.length === 1,
    JSON.stringify({ walls: built?.walls.length, wingTurn, rooms: built?.rooms.map((r) => `${r.label}:${r.points.length}`) }),
  );
  check(
    "hillside: fitted rooms carry no corner where a wall only meets their side",
    roomNamed("Landing")?.points.length === 4 && roomNamed("Hall")?.points.length === 4,
    JSON.stringify({ landing: roomNamed("Landing")?.points.length, hall: roomNamed("Hall")?.points.length }),
  );
  const hillIssues = await tool("get_issues", {});
  check("hillside: the house the agent built has no issues", hillIssues.ok && hillIssues.issues.length === 0, `${hillIssues.summary} ${JSON.stringify(hillIssues.issues?.map((i) => i.message))}`);
  // the hall door moved back up the kitchen wall swings into the pantry door: the checker says so
  await tool("move_opening", { id: hallDoor.id, t: 2.5 / D });
  const clash = await tool("get_issues", {});
  check(
    "hillside: two doors whose leaves meet when open are reported, and the move back clears it",
    clash.ok && clash.issues.some((i) => i.code === "doors_swing_together" && i.refs?.includes(hallDoor.id)) && (await tool("move_opening", { id: hallDoor.id, t: 2.95 / D })).ok && (await tool("get_issues", {})).issues.length === 0,
    JSON.stringify(clash.issues?.map((i) => i.message)),
  );
  check("hillside: the garden door sits on the curved facade", gardenDoor.ok && (await state(`s.model.openings.some((o) => o.id === '${gardenDoor.id}' && o.wallId === '${ids.g_facade}')`)));
  await tool("set_active_level", { id: "level_ground" });
  await fitPlan(page);
  await page.waitForTimeout(300);
  check(
    "hillside: the plan draws the ground floor's rooms as outlines and the facade's poché with arcs",
    (await page.locator(`${PLAN_SVG} path.pl-floor`).count()) === 6 && ((await page.locator(`${PLAN_SVG} .pl-wall-fill[data-wall="${ids.g_facade}"]`).getAttribute("d")) ?? "").includes("A"),
  );
  await S("12k-hillside-plan");
  await tool("set_active_level", { id: F });
  const built3d = await tool("build_3d", {});
  check("hillside: build_3d raises both storeys and the stair", built3d.ok && (await sceneUntil((s) => s.levels.total === 2 && s.stairs === 1 && s.entities > 0, 8000)), JSON.stringify((await scene())?.levels));
  check("hillside: the curved facade upstairs stands in the 3D view where it can be found", !!(await hook.evaluate((h, id) => h.sceneLocate("wall", id), ids.f_facade)));
  await S("12k-hillside-3d");
  {
    const file = await downloadText(() => exportMenu(page, "Building model"));
    const ifc = ifcFacts(file);
    const arcs = file ? (file.text.match(/IFCARCINDEX\(/g) ?? []).length : 0;
    // each space by its id, its room's name as its LongName
    const spaces = file ? file.text.split("\n").filter((l) => /^#\d+=IFCSPACE\(/.test(l)) : [];
    const named = ["Kitchen", "Living", "Guest room", "Roof terrace"].filter((n) => spaces.some((l) => l.includes(`'${n}'`)));
    check(
      "hillside: its IFC is framed IFC4, a storey per level, a space per room by name, its curves as IfcArcIndex",
      file?.name === "hillside-house.ifc" && ifc.framed && ifc.schema === "IFC4" && ifc.names("IFCBUILDINGSTOREY").join() === "Ground floor,First floor" &&
        spaces.length === 12 && named.length === 4 && ifc.count("IFCWALL") === 25 && arcs >= 4,
      `${file?.name}: ${ifc.names("IFCBUILDINGSTOREY").join()}; ${spaces.length} spaces, named ${named.join()}; ${ifc.count("IFCWALL")} walls, ${arcs} arcs`,
    );
  }
  await tool("set_active_level", { id: "level_ground" });
  await showView(page, "Plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12l. structure: a bedroom on two columns over an open parking bay, the garage door, the cars ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await showView(page, "Plan");
  await planMenu(page, "Load Crescent House demo");
  await until("s.model.name === 'Crescent House'", 5000);
  const plan = await tool("get_model", {});
  const carport = plan.model?.rooms.find((r) => r.label === "Porch & carport");
  const first = plan.supports?.find((x) => x.levelId === "level_first");
  check(
    "structure: the demo's main bedroom stands on 2 columns over an open parking bay, a garage door behind it and two cars, clean",
    plan.ok && plan.model.columns.length === 2 && carport?.kind === "open" && plan.model.openings.some((o) => o.style === "garage") &&
      plan.model.items.filter((i) => i.kind === "car").length === 2 && first?.columns === 2 && first.unsupported.length === 0 && (await tool("get_issues", {})).issues.length === 0,
    plan.summary,
  );
  // without its columns the main bedroom's floor is reported unsupported, where it is
  await hook.evaluate((h) => h.actions.loadModel({ ...h.store.getState().model, columns: [] }));
  const bare = await tool("get_issues", { level: "First floor" });
  check("structure: without its columns the main bedroom's floor is reported unsupported", bare.issues.some((i) => i.code === "slab_unsupported" && i.refs.includes("f_room_master")), bare.summary);
  await hook.evaluate((h) => h.actions.undo());
  await until("s.model.columns.length === 2");
  // the agent adds a column, out on the bay in front of the garage door: it is seen doing so, and the column is part of the plan
  const added = await tool("add_column", { x: 11.3, y: 15.3, level: "Ground floor" });
  const focus = await hook.evaluate((h) => h.presence.getState().agent.focus);
  check("structure: add_column adds a column the agent is seen adding", added.ok && focus.includes(added.id) && (await until("s.model.columns.length === 3")), added.summary);
  // a column in the drive through the garage door is reported
  const drive = await tool("get_issues", { level: "Ground floor" });
  check("structure: a column in the garage door's drive is reported", drive.issues.some((i) => i.code === "column_blocks_door" && i.refs.includes(added.id)), drive.summary);
  // removing one waits for the person, and a refusal keeps it
  const removing = hook.evaluate((h, id) => h.runTool("remove_column", { id }), added.id);
  check("structure: remove_column parks for approval", await until("s.approvals.length === 1 && s.approvals[0].targets[0].type === 'column'"));
  await hook.evaluate((h) => h.actions.resolveApproval(h.store.getState().approvals[0].id, false));
  check("structure: a refused remove_column keeps the column", !(await removing).ok && (await until("s.model.columns.length === 3")));
  await hook.evaluate((h) => h.actions.undo());
  await until("s.model.columns.length === 2");
  // a second garage door, in the garage's side wall onto the drive, and an open space, through the tools
  const garageDoor = await tool("add_door", { wallId: "g_e", t: 9.6 / 14.6, style: "garage", width: 2.4 });
  const opened = await tool("update_room", { id: "Garage", open: true });
  check(
    "structure: add_door style garage and update_room open take effect",
    garageDoor.ok && opened.ok && (await until(`s.model.openings.some((o) => o.id === '${garageDoor.id}' && o.style === 'garage' && o.hinge === undefined) && s.model.rooms.some((r) => r.label === 'Garage' && r.kind === 'open')`)),
    `${garageDoor.summary} ${opened.summary}`,
  );
  // a garage door in a space already open is no garage door: the checker says so
  const opensNothing = await tool("get_issues", { level: "Ground floor" });
  check("structure: a garage door in an open space is reported as opening no garage", opensNothing.issues.some((i) => i.code === "garage_door_no_garage"), opensNothing.summary);
  await hook.evaluate((h) => h.actions.undo());
  await hook.evaluate((h) => h.actions.undo());
  await until("s.model.rooms.every((r) => r.label !== 'Garage' || r.kind === undefined)");
  await S("12l-structure-plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12m. structure on the plan: columns, the column tool, the parking bay, the slab overhead ----------
{
  await showView(page, "Plan");
  await planMenu(page, "Load Crescent House demo");
  await until("s.model.name === 'Crescent House'", 5000);
  await page.locator(PLAN_SVG).hover();
  await page.keyboard.press("Shift+1");
  const drawn = await page.evaluate(() => ({
    columns: document.querySelectorAll("[data-column] .pl-column").length,
    garage: !!document.querySelector("[data-opening='g_garage_door'][data-style='garage'] .pl-garage-overhead"),
    garageSwings: document.querySelectorAll("[data-opening='g_garage_door'] .pl-swing, [data-opening='g_garage_door'] .pl-leaf").length,
    open: document.querySelectorAll("[data-open-space]").length,
    overhead: !!document.querySelector(".pl-overhead-rim"),
    rim: !!document.querySelector("[data-open-rim] .pl-open-rim")?.getAttribute("d"),
    axes: [...document.querySelectorAll("[data-column-axes] .pl-dim-text")].map((t) => t.textContent).join(),
  }));
  check(
    "structure plan: two columns in poché, the garage door with no swing, the parking bay hatched and its open sides edged, the main bedroom's slab dashed over it, the columns' axes dimensioned",
    drawn.columns === 2 && drawn.garage && drawn.garageSwings === 0 && drawn.open === 1 && drawn.rim && drawn.overhead && drawn.axes === "5.40",
    JSON.stringify(drawn),
  );
  // a press selects a column, and Properties edits it
  await page.locator("[data-column='g_column_2']").click();
  check(
    "structure plan: a click selects a column, and Properties names it",
    (await until("s.editor.selectedColumnId === 'g_column_2'")) && (await page.locator(".insp-head__title").first().textContent()) === "Column 2",
  );
  await page.keyboard.press("Escape");
  // the column tool from the keyboard alone: P, an arrow brings the cross, Enter puts one down, Esc ends it
  await page.locator(PLAN_SVG).hover();
  await page.mouse.move(0, 0);
  await page.keyboard.press("p");
  check("structure plan: P picks Add a column", (await railButton(page, "Add a column").getAttribute("aria-pressed")) === "true");
  // from the keyboard the aim is drawn at once, and the hint says where Enter would put the column
  const aimSaid = (await page.locator(".hint").textContent()) ?? "";
  check(
    "structure plan: picked by P, the column's aim is drawn and the hint letters where it would go",
    (await page.locator(".pl-ghost-column").count()) === 1 && /Column at X -?\d+\.\d\d m, Y -?\d+\.\d\d m, /.test(aimSaid),
    aimSaid,
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  check("structure plan: Enter puts a column down at the tool's cross", await until("s.model.columns.length === 3 && s.activity.at(-1).source === 'human'"));
  await page.keyboard.press("Escape");
  check("structure plan: Esc puts the column tool down", (await railButton(page, "Select").getAttribute("aria-pressed")) === "true");
  await page.keyboard.press("Control+z");
  await until("s.model.columns.length === 2");
  // on the main bedroom's level, without its columns, its floor is hatched where nothing carries it
  await hook.evaluate((h) => h.actions.loadModel({ ...h.store.getState().model, columns: [] }));
  await hook.evaluate((h) => h.runTool("set_active_level", { id: "level_first" }));
  check("structure plan: an upper floor nothing carries is hatched on its level", await page.locator(".pl-unsupported").first().isVisible().catch(() => false));
  await S("12m-structure-unsupported");
  await hook.evaluate((h) => h.actions.undo());
  await hook.evaluate((h) => h.runTool("set_active_level", { id: "level_ground" }));
  await until("s.model.columns.length === 2");
  await S("12m-structure-plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12n. structure in 3D and IFC: columns, the main bedroom's soffit, the garage door, the cars ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  await showView(page, "Plan");
  await planMenu(page, "Load Crescent House demo");
  await until("s.model.name === 'Crescent House'", 5000);
  await tool("set_active_level", { id: "First floor" });
  await showView(page, "3D");
  const built = await sceneUntil((s) => s.levels.shown.length === 2 && s.entities > 0, 8000);
  // a column shows where it stands, and a click on it selects it, outlined in the model
  await railButton(page, "Top view").click();
  await sceneUntil((s) => !s.moving, 4000);
  await tool("set_active_level", { id: "Ground floor" });
  await sceneUntil((s) => !s.moving, 4000);
  const columnAt = await hook.evaluate((h) => h.sceneLocate("column", "g_column_2"));
  const canvasAt = await page.locator(SCENE_CANVAS).boundingBox();
  if (columnAt && canvasAt) await page.mouse.click(canvasAt.x + columnAt.x, canvasAt.y + columnAt.y);
  check(
    "structure 3D: a click on a column in the model selects it, and the model outlines it",
    built && !!columnAt && (await until("s.editor.selectedColumnId === 'g_column_2'")) && (await sceneUntil((s) => s.marks.selection === 1)),
    JSON.stringify(columnAt),
  );
  await S("12n-structure-3d-top");
  await hook.evaluate((h) => h.actions.selectColumn(null));
  await railButton(page, "Orbit").click();
  await sceneUntil((s) => !s.moving, 4000);
  // from the street, south-east: the main bedroom on its two columns over the parking bay, a car under it
  await tool("set_active_level", { id: "First floor" });
  await hook.evaluate((h) => h.sceneLook([19.5, 2.4, 25.5], [10.5, 2.0, 16.5]));
  await sceneUntil((s) => !s.moving, 4000);
  await S("12n-structure-carport");
  // the garage door is raised and lowered by set_doors, as a hinged door is swung
  const before = (await scene())?.frames ?? 0;
  const raised = await tool("set_doors", { state: "open", id: "g_garage_door" });
  check("structure 3D: set_doors raises the sectional garage door in the model", raised.ok && (await sceneUntil((s) => s.frames > before && !s.moving, 4000)), raised.summary);
  await hook.evaluate((h) => h.sceneLook([8.8, 1.7, 21.5], [11.3, 1.2, 14.6]));
  await sceneUntil((s) => !s.moving, 4000);
  await S("12n-structure-garage-open");
  await tool("set_doors", { state: "closed", id: "g_garage_door" });
  // the building model: two load-bearing columns standing free (no wall cut by one), the parking
  // bay an outside parking space, the garage door a sectional door
  {
    const counts = await state("({ walls: s.model.walls.length, openings: s.model.openings.length + s.model.stairs.length })");
    const file = await downloadText(() => exportMenu(page, "Building model"));
    const ifc = ifcFacts(file);
    const text = file?.text ?? "";
    check(
      "structure IFC: the columns are IfcColumns standing free, no wall cut by them, and the counts the demo's",
      ifc.framed && ifc.count("IFCCOLUMN") === 2 && ifc.count("IFCBOOLEANRESULT") === 0 && ifc.count("IFCWALL") === counts.walls && ifc.count("IFCOPENINGELEMENT") === counts.openings,
      `${ifc.count("IFCCOLUMN")} columns, ${ifc.count("IFCBOOLEANRESULT")} booleans, ${ifc.count("IFCWALL")} walls, ${ifc.count("IFCOPENINGELEMENT")} openings`,
    );
    check(
      "structure IFC: the parking bay is an outside parking space and the garage door a sectional IfcDoor",
      /IFCSPACE\([^;]*'g_room_carport'[^;]*\.PARKING\./.test(text) && /IFCDOOR\([^;]*\.USERDEFINED\.,'SECTIONAL'\)/.test(text),
      file?.name,
    );
  }
  await showView(page, "Plan");
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 12o. structure end to end: an agent builds a carport under a storey with the tools alone ----------
{
  const tool = (name, args) => hook.evaluate((h, [n, a]) => h.runTool(n, a), [name, args]);
  const refused = [];
  const T = async (name, args) => {
    const r = await tool(name, args);
    if (!r.ok) refused.push(`${name}: ${r.summary}`);
    return r;
  };
  await page.bringToFront();
  await page.setViewportSize(DESKTOP);
  await showView(page, "Plan");
  await planMenu(page, "Clear plan");
  await until("s.model.walls.length === 0 && s.model.rooms.length === 0 && s.model.columns.length === 0");
  // a workshop 6 × 6.5 m, an open carport east of it under one storey over both, carried by three columns
  await T("set_plan_name", { name: "Carport by tools" });
  const F = (await T("add_level", {})).id;
  const box = [[0, 0, 6, 0], [6, 0, 6, 6.5], [6, 6.5, 0, 6.5], [0, 6.5, 0, 0]];
  const groundWalls = [];
  for (const [ax, ay, bx, by] of box) groundWalls.push((await T("add_wall", { ax, ay, bx, by })).id);
  await T("add_door", { wallId: groundWalls[2], t: 0.5 });
  await T("add_room", { x: 0.1, y: 0.1, w: 5.8, h: 6.3, label: "Workshop" });
  await T("add_wall", { ax: 6, ay: 0, bx: 11, by: 0 });
  // the workshop is the garage: its sectional door opens east onto the carport, the drive in front of it
  const garage = await T("add_door", { wallId: groundWalls[1], t: 0.5, style: "garage" });
  await T("add_room", { x: 6.1, y: 0.1, w: 5.05, h: 6.55, label: "Carport", open: true });
  const grid = await T("add_column", { x: 11, y: 3.25, grid: { rows: 3, cols: 1, spacing: 3.25 } });
  await T("place_item", { kind: "car", x: 8.5, y: 3.4 });
  for (const [ax, ay, bx, by] of [[0, 0, 11, 0], [11, 0, 11, 6.5], [11, 6.5, 0, 6.5], [0, 6.5, 0, 0]]) await T("add_wall", { ax, ay, bx, by, level: F });
  const partition = (await T("add_wall", { ax: 6, ay: 0, bx: 6, by: 6.5, level: F })).id;
  await T("add_door", { wallId: partition, t: 0.5 });
  await T("add_room", { x: 0.1, y: 0.1, w: 5.8, h: 6.3, label: "Bedroom", level: F });
  await T("add_room", { x: 6.1, y: 0.1, w: 4.8, h: 6.3, label: "Studio", level: F });
  const clean = await T("get_issues", {});
  const report = await T("get_model", {});
  const carried = report.supports?.find((x) => x.levelId === F);
  check(
    "structure by tools: an open carport with a garage door, three columns and a car under a storey, with no issues",
    refused.length === 0 && grid.ids?.length === 3 && garage.ok && clean.issues?.length === 0 && carried?.columns === 3 && carried.unsupported.length === 0 &&
      (await until("s.model.columns.length === 3 && s.model.rooms.some((r) => r.label === 'Carport' && r.kind === 'open') && s.model.items.some((i) => i.kind === 'car')")),
    refused.join(" ;; ") || JSON.stringify(clean.issues?.map((i) => i.code)),
  );
  await S("12o-carport-by-tools-plan");

  // the middle column taken away, once the person agrees: the storey's floor is unsupported where it stood
  const removing = hook.evaluate((h, id) => h.runTool("remove_column", { id }), grid.ids[1]);
  await until("s.approvals.length === 1 && s.approvals[0].targets[0].type === 'column'");
  await hook.evaluate((h) => h.actions.resolveApproval(h.store.getState().approvals[0].id, true));
  const gone = await removing;
  const studio = (await state("s.model.rooms.find((r) => r.label === 'Studio').id"));
  const after = await tool("get_issues", { level: F });
  await hook.evaluate((h) => void h.actions.undo());
  check(
    "structure by tools: removing a column leaves the studio's floor unsupported, and Undo carries it again",
    gone.ok && after.issues.some((i) => i.code === "slab_unsupported" && i.refs.includes(studio)) &&
      (await until("s.model.columns.length === 3")) && (await tool("get_issues", {})).issues.length === 0,
    JSON.stringify(after.issues?.map((i) => i.code)),
  );

  // the column tool by pointer: P, a click in the carport puts one down there, as the person's own edit
  await fitPlan(page);
  await page.locator(PLAN_SVG).hover();
  await page.keyboard.press("p");
  await click(9.6, 5.6);
  const placed = await until("s.model.columns.length === 4 && s.activity.at(-1).source === 'human'");
  const at = await hook.evaluate((h, ids) => h.store.getState().model.columns.find((c) => !ids.includes(c.id)), grid.ids);
  check("structure plan: a click with the column tool puts a column down where it was clicked", placed && !!at && Math.hypot(at.x - 9.6, at.y - 5.6) <= 0.3, JSON.stringify(at ?? null));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await until("s.model.columns.length === 3");

  // in 3D: the columns stand in the model, and from under the carport the studio's soffit hides the sky
  const canvasColour = async () => {
    const shot = await page.locator(SCENE_CANVAS).screenshot();
    return page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext("2d");
      g.drawImage(bitmap, 0, 0);
      const s = 24;
      const d = g.getImageData(Math.floor(bitmap.width / 2 - s / 2), Math.floor(bitmap.height * 0.3), s, s).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
      return sum.map((v) => v / (d.length / 4));
    }, shot.toString("base64"));
  };
  await tool("set_active_level", { id: F });
  await showView(page, "3D");
  const built = await sceneUntil((s) => s.levels.shown.length === 2 && s.columns === 3 && s.slabs === 1, 8000);
  check("structure 3D: the agent's three columns and the storey's slab are in the model", built, JSON.stringify(await scene()));
  // under the studio, between the car and the columns, looking up past the slab's edge to the sky beyond
  await hook.evaluate((h) => h.sceneLook([10.2, 1.1, 1.4], [12.5, 3.6, 1.6]));
  await sceneUntil((s) => !s.moving, 4000);
  const underSlab = await canvasColour();
  await S("12o-carport-by-tools-soffit");
  await tool("set_active_level", { id: "Ground floor" });
  await sceneUntil((s) => s.levels.shown.length === 1 && !s.moving, 4000);
  await hook.evaluate((h) => h.sceneLook([10.2, 1.1, 1.4], [12.5, 3.6, 1.6]));
  await sceneUntil((s) => !s.moving, 4000);
  const openSky = await canvasColour();
  const diff = Math.max(...underSlab.map((v, k) => Math.abs(v - openSky[k])));
  check("structure 3D: from under the carport, the storey's soffit is drawn over it (the view changes when the storey is hidden)", diff > 12, `${underSlab.map(Math.round)} vs ${openSky.map(Math.round)}`);
  await tool("set_active_level", { id: F });
  await showView(page, "Plan");

  // the building model: the three columns as IfcColumns, the carport an outside parking space
  {
    const file = await downloadText(() => exportMenu(page, "Building model"));
    const ifc = ifcFacts(file);
    const text = file?.text ?? "";
    check(
      "structure IFC: the agent's carport exports its three IfcColumns, its open space as outside parking and its sectional door",
      ifc.framed && ifc.count("IFCCOLUMN") === 3 && /IFCSPACE\([^;]*'Carport'[^;]*\.PARKING\./.test(text) && /IFCDOOR\([^;]*\.USERDEFINED\.,'SECTIONAL'\)/.test(text),
      `${ifc.count("IFCCOLUMN")} columns`,
    );
  }

  // a plan saved in format 3, before columns: it loads, with none, its rooms enclosed and its doors swinging
  const v3 = await hook.evaluate((h) => {
    const { columns, ...m } = h.store.getState().model;
    void columns;
    return {
      ...m,
      version: 3,
      name: "Saved as format 3",
      rooms: m.rooms.filter((r) => r.kind !== "open"),
      openings: m.openings.filter((o) => o.style !== "garage"),
      items: m.items.filter((i) => i.kind !== "car"),
    };
  });
  const loadedV3 = await hook.evaluate((h, p) => h.actions.loadModel(p), v3);
  check(
    "structure: a format-3 plan loads into format 4 with no columns, nothing else changed",
    loadedV3.ok && loadedV3.migratedFrom === 3 &&
      (await until(`s.model.version === 4 && s.model.name === 'Saved as format 3' && s.model.columns.length === 0 && s.model.rooms.length === ${v3.rooms.length} && s.model.walls.length === ${v3.walls.length}`)),
    loadedV3.summary,
  );
  await planMenu(page, "Load Sunset Loft demo");
  await until("s.model.name === 'Sunset Loft' && s.model.levels.length === 1");
}

// ---------- 13. console errors ----------
check("zero console errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" ;; "));

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASSED =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
