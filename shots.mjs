/**
 * Devpost gallery. Fourteen stills at 2700x1800 — Devpost asks for 3:2, and 1800x1200 at
 * deviceScaleFactor 1.5 lands exactly there.
 *
 * The plan comes from trace.mjs, the same module the video records, so the gallery and the
 * film can never drift apart.
 *
 *   BASE_URL=http://localhost:5173 node shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WALLS, OPEN, ROOMS, FURN, DEFINE, DEFINED_ITEMS, NOTES } from "./trace.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = "shots/devpost";   // 2700x1800 originals for the submission form
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-features=WebMCP", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1.5 });

let n = 0;
const shot = async (name) => {
  n += 1;
  const file = join(OUT, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
};
const run = (calls) =>
  page.evaluate(async (c) => {
    const out = [];
    for (const [t, a] of c) out.push(await window.__alza.runTool(t, a ?? {}));
    return out.map((r) => r.summary);
  }, calls);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=Build 3D");
await page.evaluate(() => window.__alza.actions.setRequireApproval(false));

// ---- build the traced plan -------------------------------------------------
await run([["clear_model", {}], ["set_plan_name", { name: "Traced from a photo of the plan" }]]);
await run(WALLS.map(([ax, ay, bx, by, thickness]) => ["add_wall", { ax, ay, bx, by, thickness }]));
const w = await page.evaluate(() => window.__alza.store.getState().model.walls.map((x) => x.id));
await run(OPEN(w));

console.log("capturing…");

// 1 — the traced structure sitting on the drawing it came from. Taken before the rooms
// exist: their floor fills are opaque and would hide the underlay completely.
// plan-source.jpeg is 2048 px square, exterior box at px 333..1715 / 222..1764, so at a
// 10.00 m exterior the whole image is 14.82 m wide.
const SPAN = 10.0 / ((1715 - 333) / 2048);
const dataUrl = `data:image/jpeg;base64,${readFileSync("plan-source.jpeg").toString("base64")}`;
await run([["build_3d", {}]]);
await page.waitForTimeout(1100);
await page.click("button:has-text('Back to 2D')");
await page.waitForTimeout(700);
await page.evaluate(
  ({ url, span }) =>
    window.__alza.actions.setUnderlay({
      dataUrl: url, opacity: 0.55,
      x: -(333 / 2048) * span, y: -(222 / 2048) * span, w: span, h: span,
    }),
  { url: dataUrl, span: SPAN },
);
await page.waitForTimeout(900);
await shot("traced-over-the-drawing");
await page.evaluate(() => window.__alza.actions.setUnderlay(null));

await run(ROOMS.map(([x, y, ww, h, label, floor]) => ["add_room", { x, y, w: ww, h, label, floor }]));
await run(DEFINE);
await run([...FURN, ...DEFINED_ITEMS].map(([kind, x, y, rotation]) => ["place_item", { kind, x, y, rotation }]));
await run(NOTES);
// the editor fits on mount only, so bounce through 3D to reframe
await run([["build_3d", {}]]);
await page.waitForTimeout(1200);
await page.click("button:has-text('Back to 2D')");
await page.waitForTimeout(800);

// 2 — the finished metric plan
await page.click(".sidebar-tabs button:has-text('Model')");
await page.waitForTimeout(500);
await shot("plan-2d");

// 3 — the constraint engine
await page.click(".sidebar-tabs button:has-text('Check')");
await page.waitForTimeout(400);
await shot("constraint-engine");

// 4 — the notes the agent left about what it could not be sure of
await page.click(".sidebar-tabs button:has-text('Notes')");
await page.waitForTimeout(400);
await shot("agent-notes-on-ambiguity");

// 5 — catalogue with real 3D previews
await page.click(".sidebar-tabs button:has-text('Catalog')");
await page.waitForTimeout(1800);
await shot("catalogue-3d-previews");

// 6 — cross-origin: the partner catalogue
await page.click(".sidebar-tabs button:has-text('Supplier')");
await page.waitForTimeout(2500);
await page.click("button:has-text('Pull catalogue')");
await page.waitForTimeout(1600);
await shot("cross-origin-supplier");

// 7 — the agent buys from the other origin
console.log("   ", (await run([["place_supplier_product", { sku: "NK-ARM-01", x: 4.30, y: 9.50, rotation: 270 }]]))[0]);
await page.waitForTimeout(500);
await shot("supplier-product-placed");

// 8 — every tool, runnable by hand
await page.click(".sidebar-tabs button:has-text('Tools')");
await page.waitForTimeout(500);
await shot("tool-runner");

// 9 — the human-in-the-loop gate
await page.evaluate(() => window.__alza.actions.setRequireApproval(true));
await page.evaluate(() => {
  window.__pending = window.__alza.runTool("clear_model", {});
});
await page.waitForTimeout(900);
await shot("approval-gate");
await page.click(".approval-actions .reject");
await page.waitForTimeout(600);
await shot("approval-rejected-feed");
await page.evaluate(() => window.__alza.actions.setRequireApproval(false));

// 10 — the four agent-authored pieces, in the catalogue beside the built-ins
await page.click(".sidebar-tabs button:has-text('Catalog')");
await page.waitForTimeout(1400);
// the agent's own kinds are appended after the 31 built-ins, so scroll to them
await page.evaluate(() => {
  const grid = document.querySelector(".sidebar-body") || document.querySelector(".catalog-grid");
  if (grid) grid.scrollTop = grid.scrollHeight;
});
await page.waitForTimeout(900);
await shot("agent-authored-pieces");

// 11 — 3D
await run([["build_3d", {}], ["set_camera", { mode: "orbit" }]]);
await page.waitForTimeout(2500);
await page.mouse.move(540, 600);              // fill the frame; the default fit leaves ground
await page.mouse.wheel(0, -700);
await page.waitForTimeout(1200);
await shot("3d-orbit-hero");

await run([["set_camera", { mode: "top" }]]);
await page.waitForTimeout(1800);
await page.mouse.move(540, 600);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(1200);
await shot("3d-top");

await run([["set_doors", { state: "open" }]]);
await page.waitForTimeout(1600);
await shot("3d-doors-open");

await run([["set_camera", { mode: "walk" }]]);
await page.waitForTimeout(1800);
// slide west out of the hall and into the dining room, the way the film's walk does
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
await page.waitForTimeout(900);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true })));
await page.waitForTimeout(1000);
await shot("3d-walk-eye-level");

console.log(`\n${n} images in ${OUT}/`);
await browser.close();
