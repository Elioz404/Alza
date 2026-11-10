/**
 * Devpost gallery. Fifteen stills at 2700x1800 — Devpost asks for 3:2, and 1800x1200 at
 * deviceScaleFactor 1.5 lands exactly there.
 *
 * The plan comes from trace.mjs, the same module the video records, so the gallery and the
 * film can never drift apart. The interface is reached through scripts/studio.mjs and the
 * browser started by scripts/browser.mjs (ALZA_CHROMIUM_PATH picks the executable).
 *
 *   npm run shots     (or: node scripts/shots.mjs; BASE_URL=… to aim it elsewhere)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WALLS, OPEN, ROOMS, FURN, DEFINE, DEFINED_ITEMS, NOTES } from "./trace.mjs";
import { fromRoot } from "./paths.mjs";
import { STUDIO_DEV_ORIGIN } from "../config/origins.js";
import { launchHeadless } from "./browser.mjs";
import { SCENE_CANVAS, answerRequest, fitPlan, librarySource, openDeveloperTools, openStudio, panelTab, requestCard } from "./studio.mjs";

const BASE = process.env.BASE_URL ?? STUDIO_DEV_ORIGIN;
const OUT = fromRoot("shots/devpost");   // 2700x1800 originals for the submission form
mkdirSync(OUT, { recursive: true });

const browser = await launchHeadless();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1.5 });

let n = 0;
const shot = async (name) => {
  n += 1;
  const file = join(OUT, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
};
const hook = await openStudio(page, BASE);
const run = (calls) =>
  hook.evaluate(async (h, c) => {
    const out = [];
    for (const [t, a] of c) out.push(await h.runTool(t, a ?? {}));
    return out.map((r) => r.summary);
  }, calls);
/** The 3D view's middle, where the wheel zooms toward. */
const sceneMiddle = async () => {
  const b = await page.locator(SCENE_CANVAS).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};

await hook.evaluate((h) => h.actions.setRequireApproval(false));

// ---- build the traced plan -------------------------------------------------
await run([["clear_model", {}], ["set_plan_name", { name: "Traced from a photo of the plan" }]]);
await run(WALLS.map(([ax, ay, bx, by, thickness]) => ["add_wall", { ax, ay, bx, by, thickness }]));
const w = await hook.evaluate((h) => h.store.getState().model.walls.map((x) => x.id));
await run(OPEN(w));

console.log("capturing…");

// 1 — the traced structure sitting on the drawing it came from. Taken before the rooms
// exist: their floor fills are opaque and would hide the underlay completely.
// plan-source.jpeg is 2048 px square, exterior box at px 333..1715 / 222..1764, so at a
// 10.00 m exterior the whole image is 14.82 m wide.
const SPAN = 10.0 / ((1715 - 333) / 2048);
const dataUrl = `data:image/jpeg;base64,${readFileSync(fromRoot("plan-source.jpeg")).toString("base64")}`;
await fitPlan(page);
await hook.evaluate(
  (h, { url, span }) =>
    h.actions.setUnderlay({
      assetId: h.putImage(url), opacity: 0.55,
      x: -(333 / 2048) * span, y: -(222 / 2048) * span, w: span, h: span,
    }),
  { url: dataUrl, span: SPAN },
);
await page.waitForTimeout(900);
await shot("traced-over-the-drawing");
await hook.evaluate((h) => h.actions.setUnderlay(null));

await run(ROOMS.map(([x, y, ww, h, label, floor]) => ["add_room", { x, y, w: ww, h, label, floor }]));
await run(DEFINE);
await run([...FURN, ...DEFINED_ITEMS].map(([kind, x, y, rotation]) => ["place_item", { kind, x, y, rotation }]));
await run(NOTES);
await fitPlan(page);

// 2 — the finished metric plan
await panelTab(page, "Properties");
await page.waitForTimeout(500);
await shot("plan-2d");

// 3 — the constraint engine
await panelTab(page, "Issues");
await page.waitForTimeout(400);
await shot("constraint-engine");

// 4 — the notes the agent left about what it could not be sure of
await panelTab(page, "Notes");
await page.waitForTimeout(400);
await shot("agent-notes-on-ambiguity");

// 5 — catalogue with real 3D previews
await librarySource(page, "Alza catalogue");
await page.waitForTimeout(1800);
await shot("catalogue-3d-previews");

// 6 — cross-origin: the partner catalogue
await librarySource(page, "Nordika");
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Pull catalogue" }).click();
await page.getByRole("list", { name: "Nordika products" }).waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
await shot("cross-origin-supplier");

// 7 — the agent buys from the other origin
console.log("   ", (await run([["place_supplier_product", { sku: "NK-ARM-01", x: 4.30, y: 9.50, rotation: 270 }]]))[0]);
await page.waitForTimeout(500);
await shot("supplier-product-placed");

// 8 — every tool, runnable by hand
await panelTab(page, "Properties");
await openDeveloperTools(page);
await page.waitForTimeout(500);
await shot("tool-runner");

// 9 — the human-in-the-loop gate: the request card on the plan, then the refusal in Activity
await hook.evaluate((h) => h.actions.setRequireApproval(true));
await hook.evaluate((h) => {
  window.__pending = h.runTool("clear_model", {});
});
await requestCard(page).waitFor();
await page.waitForTimeout(900);
await shot("approval-gate");
await answerRequest(page, "keep");
await page.waitForTimeout(600);
await shot("approval-rejected-feed");
await hook.evaluate((h) => h.actions.setRequireApproval(false));

// 10 — the four agent-authored pieces, in the catalogue beside the built-ins
await librarySource(page, "Alza catalogue");
await page.waitForTimeout(1400);
// the agent's own kinds are appended after the built-ins, so scroll to them
await page.getByRole("list", { name: "Furniture" }).getByRole("button").last().scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
await shot("agent-authored-pieces");

// 11 — 3D
await run([["build_3d", {}], ["set_camera", { mode: "orbit" }]]);
await page.locator(SCENE_CANVAS).waitFor();
await page.waitForTimeout(2500);
await page.mouse.move(...(await sceneMiddle()));   // fill the frame; the default fit leaves ground
await page.mouse.wheel(0, -700);
await page.waitForTimeout(1200);
await shot("3d-orbit-hero");

await run([["set_camera", { mode: "top" }]]);
await page.waitForTimeout(1800);
await page.mouse.move(...(await sceneMiddle()));
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
