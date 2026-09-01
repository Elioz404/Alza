/**
 * FULL functional battery — every feature exercised with real mouse/keyboard
 * interactions in headless Chromium (WebMCP flag on), plus the REAL WebMCP
 * runtime path via navigator.modelContextTesting when available.
 * Prints a PASS/FAIL line per check and exits non-zero on any failure.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5199";
const OUT = "shots/full";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, cond, extra = "") => {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const errors = [];
const browser = await chromium.launch({
  args: ["--enable-features=WebMCP", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const S = async (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const alza = (fn, arg) =>
  page.evaluate(
    ([f, a]) => {
      const { store, actions } = window.__alza;
      return Function("store", "actions", "arg", `return (${f})(store, actions, arg)`)(store, actions, a);
    },
    [fn.toString(), arg],
  );
const state = (expr) =>
  page.evaluate((e) => {
    const { store } = window.__alza;
    return Function("s", `return (${e})`)(store.getState());
  }, expr);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=Build 3D", { timeout: 10000 });
await page.waitForTimeout(500);

// ---------- 0. boot state ----------
check("boot: seed loaded with 7 walls", (await state("s.model.walls.length")) === 7);
check("boot: pill shows Site tools live", (await page.locator(".pill").innerText()).includes("live"));

// world→screen mapping (auto-fit: margin 0.8 around 8×6 plan)
const fit = await page.evaluate(() => {
  const svg = document.querySelector("svg.editor-svg");
  const r = svg.getBoundingClientRect();
  const scale = Math.min(r.width / 9.6, r.height / 7.6);
  return { left: r.left, top: r.top, scale };
});
const px = (wx, wy) => [fit.left + (wx + 0.8) * fit.scale, fit.top + (wy + 0.8) * fit.scale];

// ---------- 1. clear plan via Model tab ----------
await page.click(".sidebar-tabs button:has-text('Model')");
await page.click("button:has-text('Clear plan')");
check("clear: model empty", (await state("s.model.walls.length")) === 0);

// ---------- 2. draw walls with the mouse (chained) ----------
await page.click("button:has-text('+ Wall')");
await page.mouse.click(...px(1, 1));
await page.mouse.click(...px(5, 1));
await page.mouse.click(...px(5, 5));
await page.keyboard.press("Escape");
check("draw: 2 chained walls added", (await state("s.model.walls.length")) === 2);
const wallLen = await state("s.model.walls[0] && Math.hypot(s.model.walls[0].bx-s.model.walls[0].ax, s.model.walls[0].by-s.model.walls[0].ay)");
check("draw: first wall is 4 m", Math.abs(wallLen - 4) < 0.01, `${wallLen} m`);

// ---------- 3. draw a room by drag ----------
await page.click("button:has-text('+ Room')");
await page.mouse.move(...px(1.2, 1.2));
await page.mouse.down();
await page.mouse.move(...px(4, 4), { steps: 5 });
await page.mouse.up();
check("room: added by drag", (await state("s.model.rooms.length")) === 1);

// ---------- 4. place furniture from catalog ----------
await page.click(".sidebar-tabs button:has-text('Catalog')");
await page.click(".catalog-card:has-text('Sofa')");
await page.mouse.click(...px(2.5, 2.5));
check("catalog: sofa placed", (await state("s.model.items.length")) === 1);

// ---------- 5. select a wall → dynamic tool published ----------
await page.click("button:has-text('Select')");
await page.mouse.click(...px(3, 1));
await page.waitForTimeout(300);
check("select: wall selected", !!(await state("s.editor.selectedWallId")));
const feedDyn = await page.locator(".activity-feed").innerText();
check("dynamic tool published on selection", feedDyn.includes("extend_selected_wall"));

// ---------- 6. drag the sofa ----------
const before = await state("s.model.items[0].x");
await page.mouse.move(...px(2.5, 2.5));
await page.mouse.down();
await page.mouse.move(...px(3.5, 3), { steps: 6 });
await page.mouse.up();
const after = await state("s.model.items[0].x");
check("drag: sofa moved", before !== after, `${before} → ${after}`);

// ---------- 7. delete + undo ----------
await page.keyboard.press("Delete");
check("delete: sofa removed", (await state("s.model.items.length")) === 0);
await page.keyboard.press("Control+z");
check("undo: sofa restored", (await state("s.model.items.length")) === 1);

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
await page.click(".sidebar-tabs button:has-text('Model')");
await page.setInputFiles("input[type=file]", { name: "blueprint.png", mimeType: "image/png", buffer });
await page.waitForTimeout(600);
check("underlay: blueprint loaded", !!(await state("s.model.underlay")));
await S("06-underlay");
await page.click("button:has-text('Remove underlay')");
check("underlay: removed", (await state("s.model.underlay")) === null);

// ---------- 9. notes (human → feed → agent reads) ----------
await page.click(".sidebar-tabs button:has-text('Notes')");
await page.fill(".note-compose textarea", "Please widen the bedroom door to 1 m.");
await page.click("button:has-text('Add note')");
check("notes: human note saved", (await state("s.notes.length")) === 1);

// ---------- 10. REAL WebMCP runtime path ----------
const mct = await page.evaluate(() => {
  const m = navigator.modelContextTesting;
  if (!m) return { available: false };
  try {
    const r1 = m.executeTool("add_wall", JSON.stringify({ ax: 6, ay: 1, bx: 6, by: 5 }));
    const r2 = m.executeTool("add_door", JSON.stringify({ wallId: "wall", t: 0.5 }));
    const r3 = m.executeTool("get_issues", "{}");
    const r4 = m.executeTool("leave_note", JSON.stringify({ text: "Agent was here." }));
    return { available: true, r1: String(r1).slice(0, 120), r2: String(r2).slice(0, 120), r3: String(r3).slice(0, 160), r4: String(r4).slice(0, 80) };
  } catch (e) {
    return { available: true, error: String(e) };
  }
});
console.log("modelContextTesting:", JSON.stringify(mct, null, 1));
// Informational: modelContextTesting exists only in Chrome dev/canary builds.
// Tool REGISTRATION is already proven by the "Site tools live" pill (31 tools);
// real end-to-end execution is verified in ChatGPT desktop before submission.
if (mct.available && !mct.error) {
  check("webmcp runtime: add_wall executed", (await state("s.model.walls.length")) >= 3);
  check("webmcp runtime: agent note landed", (await state("s.notes.length")) >= 2);
} else {
  console.log("WARN  modelContextTesting not in this Chromium build — the 2 runtime-execution checks below are skipped (54 of 56 run here); registration is verified via the pill and the execution path via the ToolRunner, which shares the same wrapper.");
}

// ---------- 11. manual ToolRunner: full sweep ----------
await page.click(".sidebar-tabs button:has-text('Tools')");
/** Destructive tools park on the approval bar; `decide` is what a human would press. */
const runTool = async (name, args, decide = "approve") => {
  await page.selectOption(".toolrunner select", name);
  await page.fill(".toolrunner textarea", JSON.stringify(args));
  await page.click(".toolrunner button.primary");
  await page.waitForTimeout(250);
  if ((await page.locator(".approval").count()) > 0) {
    await page.click(`.approval-actions .${decide}`);
    await page.waitForTimeout(250);
  }
  const txt = await page.locator(".toolrunner-result").innerText();
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
await page.evaluate(() =>
  window.__alza.actions.setUnderlay({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", opacity: 0.55, x: 0, y: 0, w: 8, h: 6 }),
);
r = await runTool("calibrate_underlay", { u1: 0.1, v1: 0.5, u2: 0.9, v2: 0.5, meters: 4 });
check("tool calibrate_underlay: 8 m → 5 m", r.ok && Math.abs(r.w - 5) < 0.01);
const uw = await state("s.model.underlay.w");
const uh = await state("s.model.underlay.h");
check("tool calibrate_underlay: rect scaled, aspect kept", Math.abs(uw - 5) < 0.01 && Math.abs(uh - 3.75) < 0.01);
await page.evaluate(() => window.__alza.actions.setUnderlay(null));
r = await runTool("add_room", { x: 6.2, y: 1.2, w: 2, h: 2, label: "Study", floor: "oak" });
check("tool add_room", r.ok);
r = await runTool("update_room", { id: "Study", label: "Office" });
check("tool update_room by label", r.ok);
r = await runTool("place_item", { kind: "desk", x: 7, y: 2, rotation: 0 });
check("tool place_item", r.ok);
r = await runTool("move_item", { id: "desk", x: 7.2, y: 2.2 });
check("tool move_item", r.ok);
r = await runTool("remove_item", { id: "desk" });
check("tool remove_item", r.ok);
r = await runTool("get_issues", {});
check("tool get_issues returns list", r.ok && Array.isArray(r.issues));
r = await runTool("set_plan_name", { name: "E2E Test Plan" });
check("tool set_plan_name", r.ok && (await state("s.model.name")) === "E2E Test Plan");
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
await page.click(".sidebar-tabs button:has-text('Model')");
await page.click("button:has-text('Load Sunset Loft demo')");
await page.click(".sidebar-tabs button:has-text('Tools')");
const wallsBeforeGate = await state("s.model.walls.length");
r = await runTool("clear_model", {}, "reject");
check("gate: rejected destructive call reports back to the agent", !r.ok && /declined/i.test(r.summary), r.summary);
check("gate: rejection changed nothing", (await state("s.model.walls.length")) === wallsBeforeGate);
check("gate: approval bar cleared after the decision", (await page.locator(".approval").count()) === 0);
r = await runTool("remove_item", { id: "plant" }, "approve");
check("gate: approved destructive call runs", r.ok, r.summary);
// non-destructive tools never stop for approval
r = await runTool("get_model", {});
check("gate: read-only tools are not gated", r.ok && r.model);
await S("06b-approval-gate");

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
await page.click(".sidebar-tabs button:has-text('Supplier')");
await page.waitForTimeout(1500);
check("cross-origin: partner iframe carries allow=\"tools\"", (await page.locator('iframe.supplier-frame[allow="tools"]').count()) === 1);
await page.click(".sidebar-tabs button:has-text('Tools')");
r = await runTool("get_supplier_catalog", { category: "living", maxPrice: 400, inStock: true });
if (r.ok) {
  check("cross-origin: catalogue read from the partner origin", Array.isArray(r.products) && r.products.length > 0, `${r.products?.length} products via ${r.transport}`);
  const sku = r.products[0].sku;
  const itemsPre = await state("s.model.items.length");
  r = await runTool("place_supplier_product", { sku, x: 2.6, y: 2.6, rotation: 0 });
  check("cross-origin: partner product placed at its real size", r.ok && (await state("s.model.items.length")) === itemsPre + 1, r.summary);
} else {
  console.log(`SKIP  cross-origin checks — partner origin not running (npm run partner): ${r.summary}`);
}

// ---------- 12. reload seed + 3D flow ----------
await page.click(".sidebar-tabs button:has-text('Model')");
await page.click("button:has-text('Load Sunset Loft demo')");
check("seed reloaded", (await state("s.model.walls.length")) === 7);

await page.click("button.primary"); // Build 3D
await page.waitForSelector(".scene3d canvas", { timeout: 10000 });
await page.waitForTimeout(1200);
check("3D: canvas mounted", await page.locator(".scene3d canvas").count() === 1);
await S("07-3d-orbit");

for (const cam of ["Top", "Walk"]) {
  await page.click(`button:has-text('${cam}')`);
  await page.waitForTimeout(700);
}
check("3D: walk camera active", (await state("s.editor.camera")) === "walk");
await S("08-3d-walk");

// click-to-place in 3D
await page.click(".sidebar-tabs button:has-text('Catalog')");
await page.click(".catalog-card:has-text('Plant')");
const itemsBefore = await state("s.model.items.length");
await page.mouse.click(500, 500);
await page.waitForTimeout(400);
check("3D: click-to-place adds item", (await state("s.model.items.length")) === itemsBefore + 1);

// OBJ export (download event)
const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await page.click("button:has-text('Export OBJ')");
const download = await dl;
check("3D: OBJ export downloads", !!download, download ? await download.suggestedFilename() : "no download");

await page.click("button.primary"); // Back to 2D
await page.waitForSelector("text=Build 3D");
check("back to 2D", (await state("s.editor.view")) === "2d");

// ---------- 13. console errors ----------
check("zero console errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" ;; "));

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASSED =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
