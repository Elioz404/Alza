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

for (const cam of ["Top view", "Walk"]) {
  await railButton(page, cam).click();
  await page.waitForTimeout(700);
}
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
await page.setViewportSize(DESKTOP);

// ---------- 13. console errors ----------
check("zero console errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" ;; "));

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASSED =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
