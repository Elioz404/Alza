/**
 * Take 6 — real screen capture at 60 fps, GPU-rendered.
 *
 * Why this exists: Playwright's recordVideo is Chromium's screencast, hard-wired to
 * 25 fps. A continuous 3D orbit at 25 fps with no motion blur reads as judder no matter
 * how the timeline is conformed — that is what stayed wrong through three cuts.
 *
 * So: a REAL browser window (headed, GPU on — no swiftshader) in kiosk fullscreen at
 * exactly 1920x1080, captured by ffmpeg's ddagrab (Desktop Duplication API, GPU path)
 * at 60 fps. The app is still driven by synthesised in-page events so there is no
 * CDP round-trip stalling the scene.
 *
 *   node record6.mjs            # all beats
 *   node record6.mjs hook rise  # just these
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WALLS, OPEN, ROOMS, FURN, DEFINE, DEFINED_ITEMS, NOTES } from "./trace.mjs";

const BASE = process.env.BASE_URL ?? "https://alza-dev.pages.dev";
const OUT = "videos/alza-webmcp/capture/footage6";
const FFMPEG = "C:/Users/elias/.local/bin/ffmpeg.exe";
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

/* GPU on, no chrome, the window IS the screen.
   launchPersistentContext with viewport:null is the part that matters: plain launch()
   pins an emulated 1280x720 viewport inside the window, so --kiosk yields a small page
   on a captured desktop. Probed: inner == outer == screen == 1920x1080 at 0,0. */
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "alza-cap-")), {
  headless: false,
  viewport: null,
  args: [
    "--enable-features=WebMCP",
    // Chrome offered to translate the page and its bubble sat over the opening shot
    "--disable-features=Translate,TranslateUI", "--lang=en-US",
    "--kiosk", "--start-fullscreen",
    "--window-position=0,0", "--window-size=1920,1080",
    "--force-device-scale-factor=1",
    "--disable-infobars", "--no-default-browser-check", "--no-first-run",
    "--hide-scrollbars",
  ],
});
const sheet = ctx.pages()[0] ?? await ctx.newPage();

/* Capture to MPEG-TS, not MP4. An MP4 only becomes readable when ffmpeg writes its moov
   atom at the very end, and Windows has no real SIGINT — Node's kill() is TerminateProcess,
   so the file dies headerless. A .ts stream carries its own framing and stays playable no
   matter how the writer ends; it is remuxed to MP4 losslessly once the take is over. */
function startCapture(name) {
  const p = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-filter_complex", "ddagrab=framerate=60:draw_mouse=0,hwdownload,format=bgra",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-f", "mpegts", join(OUT, `${name}.ts`),
  ]);
  p.stderr.on("data", (d) => { const s = String(d).trim(); if (s) console.log("   ffmpeg:", s.slice(0, 120)); });
  return p;
}
// "q" on stdin is ffmpeg's own graceful shutdown: it drains the encoder and closes the file.
const stopCapture = (p) => new Promise((r) => {
  p.on("close", r);
  try { p.stdin.write(Buffer.from([113, 10])); } catch { p.kill(); }
  setTimeout(() => { try { p.kill(); } catch {} }, 8000).unref();
});

/** Pointer drag synthesised inside the page — one rAF loop, no CDP round-trips. */
const drag3d = (page, dx, dy, ms) =>
  page.evaluate(({ dx, dy, ms }) => new Promise((done) => {
    const el = document.querySelector(".scene3d canvas"); if (!el) return done(false);
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (t, x, y, b) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: b }));
    ev("pointerdown", cx, cy, 1);
    const t0 = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      ev("pointermove", cx + dx * e, cy + dy * e, 1);
      if (t < 1) requestAnimationFrame(step); else { ev("pointerup", cx + dx, cy + dy, 0); done(true); }
    })(performance.now());
  }), { dx, dy, ms });

const zoom3d = (page, total, ms) =>
  page.evaluate(({ total, ms }) => new Promise((done) => {
    const el = document.querySelector(".scene3d canvas"); if (!el) return done(false);
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const t0 = performance.now(); let last = 0;
    (function step(now) {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const want = total * e, d = want - last; last = want;
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: d, clientX: cx, clientY: cy }));
      if (t < 1) requestAnimationFrame(step); else done(true);
    })(performance.now());
  }), { total, ms });

/** Wheel on the 2D canvas. The editor's handler is STEP based - it reads only the sign
 *  of deltaY and applies a fixed 1.12x - so one event per animation frame compounds
 *  into a runaway zoom. Fire a few discrete notches instead, the way a wheel really
 *  clicks. Positive = out. */
const zoom2d = (page, steps, ms) =>
  page.evaluate(({ steps, ms }) => new Promise((done) => {
    const el = document.querySelector("svg"); if (!el) return done(false);
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let i = 0;
    const tick = () => {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: steps > 0 ? 100 : -100, clientX: cx, clientY: cy }));
      if (++i < Math.abs(steps)) setTimeout(tick, ms / Math.abs(steps)); else done(true);
    };
    tick();
  }), { steps, ms });

/** Walk mode listens for w/a/s/d on `window`, so that is where the keys go. */
const keyDown = (page, key) =>
  page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })), key);
const keyUp = (page, key) =>
  page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true })), key);
/** Hold a direction for a while. 2.2 m/s, so ms/450 is roughly metres travelled. */
const step = async (page, key, ms) => { await keyDown(page, key); await page.pause_(ms); await keyUp(page, key); };

async function open() {
  const page = sheet;
  page.run = (c) => page.evaluate(async (l) => { const o = []; for (const [t, a] of l) o.push(await window.__alza.runTool(t, a ?? {})); return o.map(r => r.summary); }, c);
  page.pause_ = (ms) => page.waitForTimeout(ms);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Build 3D");
  await page.pause_(900);
  await page.evaluate(() => window.__alza.actions.setRequireApproval(false));
  await page.run([["clear_model", {}], ["set_plan_name", { name: "Traced from a photo of the plan" }]]);
  await page.run(WALLS.map(([ax, ay, bx, by, thickness]) => ["add_wall", { ax, ay, bx, by, thickness }]));
  const w = await page.evaluate(() => window.__alza.store.getState().model.walls.map(x => x.id));
  await page.run(OPEN(w));
  await page.run(ROOMS.map(([x, y, ww, h, label, floor]) => ["add_room", { x, y, w: ww, h, label, floor }]));
  await page.run(DEFINE);   // the three kinds the catalogue lacks, before anything places them
  await page.run([...FURN, ...DEFINED_ITEMS].map(([kind, x, y, rotation]) => ["place_item", { kind, x, y, rotation }]));
  await page.run(NOTES);   // rule 2: the ambiguous symbol is flagged, not silently decided
  await page.run([["build_3d", {}]]);
  await page.pause_(1200);
  await page.click("button:has-text('Back to 2D')");   // remount => the editor re-fits the plan
  await page.pause_(700);
  return page;
}

async function beat(name, fn, pre) {
  if (!want(name)) return;
  const page = await open();
  // anything the shot must NOT open on happens here, before ffmpeg is running
  if (pre) await pre(page);
  console.log(`recording ${name} @60fps...`);
  const cap = startCapture(name);
  await page.pause_(500);
  await fn(page);
  await page.pause_(400);
  await stopCapture(cap);
  console.log(`  -> ${name}.ts`);
}

await beat("hook", async (page) => {
  await page.run([["build_3d", {}], ["set_camera", { mode: "orbit" }]]);
  await page.pause_(1600);
  await zoom3d(page, -400, 1500);
  await drag3d(page, 280, 200, 3000);      // settle into the raised three-quarter view
  await page.pause_(400);
  await drag3d(page, -430, 0, 5600);       // then a slow orbit at that elevation
  await page.pause_(700);
});

await beat("rise", async (page) => {
  await page.run([["build_3d", {}], ["set_camera", { mode: "orbit" }]]);
  await page.pause_(1800);
  await zoom3d(page, -430, 1300);
  await page.run([["set_doors", { state: "open" }]]);
  await page.pause_(1200);
  await drag3d(page, 300, 190, 4000);
  await zoom3d(page, -300, 1500);
  await drag3d(page, -210, 50, 2800);
  await page.pause_(700);
});


await beat("trace", async (page) => {
  await page.pause_(700);
  for (const [ax, ay, bx, by, thickness] of WALLS) { await page.run([["add_wall", { ax, ay, bx, by, thickness }]]); await page.pause_(230); }
  await page.pause_(350);
  const w = await page.evaluate(() => window.__alza.store.getState().model.walls.map((x) => x.id));
  for (const c of OPEN(w)) { await page.run([c]); await page.pause_(130); }
  await page.pause_(300);
  for (const [x, y, ww, h, label, floor] of ROOMS) { await page.run([["add_room", { x, y, w: ww, h, label, floor }]]); await page.pause_(150); }
  await page.pause_(300);
  await page.run(DEFINE);            // three pieces the catalogue does not carry
  await page.pause_(400);
  const PIECES = [...FURN, ...DEFINED_ITEMS];
  for (let i = 0; i < PIECES.length; i += 2) { await page.run(PIECES.slice(i, i + 2).map(([kind, x, y, rotation]) => ["place_item", { kind, x, y, rotation }])); await page.pause_(110); }
  await page.run(NOTES);
  await page.pause_(2200);
}, async (page) => {
  // the editor is already framed for the whole plan; empty it before rolling
  await page.click(".sidebar-tabs button:has-text('Model')");
  await page.run([["clear_model", {}]]);
  await page.pause_(600);
});

await beat("repair", async (page) => {
  await page.click(".sidebar-tabs button:has-text('Check')");
  await page.pause_(1400);
  await page.run([["place_item", { kind: "wardrobe", x: 5.40, y: 8.60, rotation: 0 }]]);
  await page.pause_(1800);
  await page.run([["get_issues", {}]]);
  await page.pause_(3400);                      // the error sits and reads
  const badId = await page.evaluate(() => {
    const it = window.__alza.store.getState().model.items;
    return it[it.length - 1].id;
  });
  await page.run([["move_item", { id: badId, x: 7.10, y: 9.40, rotation: 90 }]]);
  await page.pause_(1600);
  await page.run([["get_issues", {}]]);
  await page.pause_(3400);                      // and clears
});

await beat("crossorigin", async (page) => {
  await page.click(".sidebar-tabs button:has-text('Supplier')");
  await page.pause_(3600);                      // the partner iframe loads and registers
  await page.click("button:has-text('Pull catalogue')");
  await page.pause_(4200);                      // the catalogue fills in, readable
  await page.run([["place_supplier_product", { sku: "NK-ARM-01", x: 4.30, y: 9.50, rotation: 270 }]]);
  await page.pause_(6000);                      // the armchair lands in the plan
  await page.pause_(4000);
});

await beat("veto", async (page) => {
  await page.evaluate(() => window.__alza.actions.setRequireApproval(true));
  await page.click(".sidebar-tabs button:has-text('Tools')");
  await page.pause_(1000);
  await page.evaluate(() => { window.__pending = window.__alza.runTool("clear_model", {}); });
  await page.pause_(5600);                      // the request waits, unanswered
  await page.hover(".approval-actions .reject");
  await page.pause_(1300);
  await page.click(".approval-actions .reject");
  await page.pause_(6200);                      // the refusal prints back to the agent
});

console.log("\ndone — footage6/");

await beat("walk", async (page) => {
  await page.pause_(600);
  // North up the dining lane to the kitchen, then a half turn back into the flat.
  // OrbitControls turns by 2*PI*dx/height, so ~470px of drag is a half turn here.
  await keyDown(page, "w");
  await drag3d(page, 60, 0, 1500);
  await drag3d(page, -90, 0, 1400);
  await keyUp(page, "w");
  await page.pause_(250);
  await drag3d(page, 470, 0, 1900);
  await page.pause_(300);
  await keyDown(page, "w");
  await drag3d(page, -50, 0, 1500);
  await keyUp(page, "w");
  await page.pause_(800);
}, async (page) => {
  await page.run([["build_3d", {}]]);
  await page.pause_(1500);          // let Scene3D mount before walk mode is asked for
  await page.run([["set_doors", { state: "open" }], ["set_camera", { mode: "walk" }]]);
  await page.pause_(1400);
  // set_camera drops the camera in the hall at (5.0, 7.25) facing north. Sliding west
  // for 1.8 s crosses the living room into the one clear north-south lane, which runs
  // past the dining table all the way to the kitchen counter.
  await step(page, "a", 1800);
  await page.pause_(600);
});

await beat("brief", async (page) => {
  // Scene 1 — the product states the connection itself: 31 tools, discovered via WebMCP
  await page.pause_(3600);
  // Scene 2 — the one moment a human acts: the plan photo goes in
  await page.click(".sidebar-tabs button:has-text('Model')");
  await page.pause_(500);
  await page.setInputFiles('input[type="file"]', 'plan-source.jpeg');
  await page.pause_(2400);
  // Scene 3 — the agent reads it back, then fixes the scale from one real dimension
  await page.run([["get_underlay", {}]]);
  await page.pause_(2800);
  await page.run([["calibrate_underlay", { u1: 0.163, v1: 0.5, u2: 0.837, v2: 0.5, meters: 10.0 }]]);
  await page.pause_(1300);
  await zoom2d(page, 3, 900);          // three notches out: calibration made the drawing bigger
  await page.pause_(1600);
}, async (page) => {
  await page.run([["clear_model", {}]]);
  await page.click(".sidebar-tabs button:has-text('Tools')");
  await page.pause_(700);
});

await ctx.close();

// .ts -> .mp4, stream copy: no re-encode, no quality loss, now with a proper index
for (const n of ["hook", "rise", "trace", "repair", "crossorigin", "veto", "walk", "brief"]) {
  if (!want(n) || !existsSync(join(OUT, `${n}.ts`))) continue;
  await new Promise((r) => spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y",
    "-fflags", "+genpts", "-i", join(OUT, `${n}.ts`), "-c", "copy",
    "-movflags", "+faststart", join(OUT, `${n}.mp4`)]).on("close", r));
  rmSync(join(OUT, `${n}.ts`), { force: true });
  console.log(`  remuxed ${n}.mp4`);
}
console.log("");
console.log("done - footage6/");
