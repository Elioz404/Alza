/**
 * Every build holds each site's first load (its entry chunk, the chunks that one imports
 * statically and their stylesheets) to the budget in config/budgets.js, and fails with a message
 * that names the site, the size, the budget and the files. A chunk reached only by a dynamic
 * import is not first load; a chunk the entry imports statically is, so moving code into one
 * cannot get it under a budget. The 3D view's lazy chunks (three.js, and the studio's own 3D
 * code that imports it) have budgets of their own, checked the same way.
 */
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  KB,
  LAZY_BUDGETS,
  LAZY_SHIPPED,
  MARGIN,
  SHIPPED,
  checkBudgets,
  checkLazyBudgets,
  firstLoadFiles,
  lazyFiles,
  measureFiles,
  type BundleLike,
} from "../config/budgets.js";
import { SITES } from "../config/sites.js";

const chunk = (fileName: string, name: string, bytes: number, extra: { isEntry?: boolean; imports?: string[]; css?: string[] } = {}) => ({
  type: "chunk" as const,
  fileName,
  name,
  isEntry: extra.isEntry ?? false,
  code: "x".repeat(bytes),
  imports: extra.imports ?? [],
  viteMetadata: { importedCss: new Set(extra.css ?? []) },
});
const asset = (fileName: string, bytes: number) => ({ type: "asset" as const, fileName, source: "y".repeat(bytes) });

/** A studio entry with a shared chunk it imports, a lazy tab, and the partner's own entry. */
function bundle(studioBytes: number, cssBytes = 1000): BundleLike {
  return {
    "assets/studio-a.js": chunk("assets/studio-a.js", "studio", studioBytes, { isEntry: true, imports: ["assets/protocol-b.js"], css: ["assets/studio-a.css"] }),
    "assets/protocol-b.js": chunk("assets/protocol-b.js", "protocol", 100),
    "assets/Library-c.js": chunk("assets/Library-c.js", "Library", 50_000, { imports: ["assets/studio-a.js"], css: ["assets/Library-c.css"] }),
    "assets/partner-d.js": chunk("assets/partner-d.js", "partner", 200, { isEntry: true, imports: ["assets/protocol-b.js"], css: ["assets/partner-d.css"] }),
    "assets/studio-a.css": asset("assets/studio-a.css", cssBytes),
    "assets/Library-c.css": asset("assets/Library-c.css", 500),
    "assets/partner-d.css": asset("assets/partner-d.css", 300),
  };
}

/** A stand-in for gzip: a quarter of the bytes, rounded up, so the figures are exact. */
const gzip = (bytes: Uint8Array) => Math.ceil(bytes.length / 4);

const budget = (jsMin: number, cssMin = 10 * KB) => ({ js: { min: jsMin, gzip: jsMin }, css: { min: cssMin, gzip: cssMin } });

describe("the first load", () => {
  it("is the entry, what it imports statically, and their stylesheets, never a lazy chunk", () => {
    expect(firstLoadFiles(bundle(1000), "studio")).toEqual({ js: ["assets/studio-a.js", "assets/protocol-b.js"], css: ["assets/studio-a.css"] });
    expect(firstLoadFiles(bundle(1000), "partner")).toEqual({ js: ["assets/partner-d.js", "assets/protocol-b.js"], css: ["assets/partner-d.css"] });
    expect(firstLoadFiles(bundle(1000), "nowhere")).toBeNull();
  });

  it("is measured as emitted and gzipped", () => {
    const measured = measureFiles(bundle(1000), ["assets/studio-a.js", "assets/protocol-b.js"], gzip);
    expect(measured.min).toBe(1100);
    expect(measured.gzip).toBe(250 + 25);
    expect(measured.files.map((f) => f.fileName)).toEqual(["assets/studio-a.js", "assets/protocol-b.js"]);
  });
});

describe("the budget check", () => {
  it("passes a build within every budget, and reports each site's figures", () => {
    const { report, violations } = checkBudgets(bundle(1000), gzip, { studio: budget(2 * KB), partner: budget(1 * KB) });
    expect(violations).toEqual([]);
    expect(report).toContain("studio first-load JS: 1.1 kB (budget 2.0 kB), gzip 0.3 kB (budget 2.0 kB)");
    expect(report).toHaveLength(4);
  });

  it("fails a build whose entry grew, naming the site, the size, the budget and the chunks", () => {
    const { violations } = checkBudgets(bundle(5000), gzip, { studio: budget(2 * KB), partner: budget(1 * KB) });
    // gzip is a quarter of 5.1 kB: within the 2 kB budget, so only the minified size is over
    expect(violations).toHaveLength(1);
    const [min] = violations;
    expect(min).toContain("studio's first-load JS is 5.1 kB minified, over its budget of 2.0 kB by 3.1 kB");
    expect(min).toContain("studio-a.js 5.0 kB");
    expect(min).toContain("protocol-b.js 0.1 kB");
    expect(min).toContain("config/budgets.js");
  });

  it("holds the gzipped size to its own limit", () => {
    const tight = { js: { min: 10 * KB, gzip: 10 }, css: { min: 10 * KB, gzip: 10 * KB } };
    const { violations } = checkBudgets(bundle(1000), gzip, { studio: tight, partner: budget(1 * KB) });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^studio's first-load JS is [\d.]+ kB gzipped, over its budget of 0\.0 kB/);
  });

  it("holds the stylesheets to their own budget", () => {
    const { violations } = checkBudgets(bundle(1000, 20 * KB), gzip, { studio: budget(2 * KB, 10 * KB), partner: budget(1 * KB) });
    expect(violations.some((v) => v.startsWith("studio's first-load CSS is 20.0 kB minified") && v.includes("studio-a.css"))).toBe(true);
  });

  it("does not count a lazy chunk, however large", () => {
    const lazyHeavy = bundle(1000);
    (lazyHeavy["assets/Library-c.js"] as { code: string }).code = "z".repeat(900 * KB);
    expect(checkBudgets(lazyHeavy, gzip, { studio: budget(2 * KB), partner: budget(1 * KB) }).violations).toEqual([]);
  });

  it("fails when a site has no entry to measure", () => {
    const { violations } = checkBudgets(bundle(1000), gzip, { studio: budget(2 * KB), elsewhere: budget(1 * KB) });
    expect(violations).toEqual(["the build has no entry chunk for the elsewhere site, so its budget cannot be checked."]);
  });

  it("sets a budget for every site, minified and gzipped, for scripts and stylesheets", () => {
    expect(Object.keys(BUDGETS).sort()).toEqual([...SITES].sort());
    for (const site of SITES) {
      for (const kind of ["js", "css"] as const) {
        const limit = BUDGETS[site][kind];
        expect(limit.gzip).toBeGreaterThan(0);
        expect(limit.gzip).toBeLessThan(limit.min);
      }
    }
  });

  it("is what each site shipped plus one small margin, the same for every site and measure", () => {
    expect(MARGIN).toBeGreaterThan(0);
    expect(MARGIN).toBeLessThanOrEqual(0.05);
    for (const site of SITES) {
      for (const kind of ["js", "css"] as const) {
        for (const measure of ["min", "gzip"] as const) {
          const shipped = SHIPPED[site][kind][measure];
          expect(BUDGETS[site][kind][measure]).toBe(Math.ceil(shipped * (1 + MARGIN)));
        }
      }
    }
  });
});

/**
 * The studio as it splits the 3D view: three.js in its own chunk, the view and the thumbnails
 * importing it, a furniture chunk they share that imports it too, and a lazy tab that has
 * nothing to do with 3D.
 */
function bundle3d(threeBytes: number, viewBytes = 1000): BundleLike {
  const b = bundle(1000);
  return {
    ...b,
    "assets/three-t.js": chunk("assets/three-t.js", "three", threeBytes),
    "assets/edges-e.js": chunk("assets/edges-e.js", "edges", 500, { imports: ["assets/three-t.js", "assets/studio-a.js"] }),
    "assets/Scene3D-s.js": chunk("assets/Scene3D-s.js", "Scene3D", viewBytes, { imports: ["assets/edges-e.js", "assets/studio-a.js"] }),
    "assets/thumbnails-u.js": chunk("assets/thumbnails-u.js", "thumbnails", 100, { imports: ["assets/edges-e.js", "assets/three-t.js"] }),
  };
}
const lazyBudget = (three: number, scene3d: number) => ({ three: { min: three, gzip: three }, scene3d: { min: scene3d, gzip: scene3d } });
const SITE_NAMES = ["studio", "partner"];

describe("the 3D view's lazy chunks", () => {
  it("are three.js, and every lazy chunk that imports it, directly or through another chunk", () => {
    const files = lazyFiles(bundle3d(5000), SITE_NAMES);
    expect(files.three).toEqual(["assets/three-t.js"]);
    // the Scene3D chunk reaches three.js only through the furniture chunk; the Library tab never does
    expect(files.scene3d.sort()).toEqual(["assets/Scene3D-s.js", "assets/edges-e.js", "assets/thumbnails-u.js"]);
    expect(files.firstLoad).toEqual([]);
  });

  it("pass within their budgets, and report each group's figures", () => {
    const { report, violations } = checkLazyBudgets(bundle3d(5000), gzip, SITE_NAMES, lazyBudget(6 * KB, 2 * KB));
    expect(violations).toEqual([]);
    expect(report).toEqual([
      "studio lazy three.js: 5.0 kB (budget 6.0 kB), gzip 1.3 kB (budget 6.0 kB)",
      "studio lazy 3D view: 1.6 kB (budget 2.0 kB), gzip 0.4 kB (budget 2.0 kB)",
    ]);
  });

  it("fail when three.js or the 3D view grew, naming the group, the size, the budget and the chunks", () => {
    const { violations } = checkLazyBudgets(bundle3d(7000, 3000), gzip, SITE_NAMES, lazyBudget(6 * KB, 2 * KB));
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("the lazy three.js chunks are 7.0 kB minified, over their budget of 6.0 kB by 1.0 kB");
    expect(violations[0]).toContain("three-t.js 7.0 kB");
    expect(violations[1]).toContain("the lazy 3D view chunks are 3.6 kB minified, over their budget of 2.0 kB by 1.6 kB");
    expect(violations[1]).toContain("Scene3D-s.js 3.0 kB");
    expect(violations[1]).toContain("LAZY_SHIPPED");
  });

  it("hold the gzipped size to its own limit", () => {
    const tight = { three: { min: 10 * KB, gzip: 1 * KB }, scene3d: { min: 10 * KB, gzip: 10 * KB } };
    const { violations } = checkLazyBudgets(bundle3d(5000), gzip, SITE_NAMES, tight);
    expect(violations).toEqual([expect.stringMatching(/^the lazy three\.js chunks are 1\.3 kB gzipped, over their budget of 1\.0 kB/)]);
  });

  it("fail when three.js is missing, or sits in a first load instead of a lazy chunk", () => {
    const none = bundle(1000);
    expect(checkLazyBudgets(none, gzip, SITE_NAMES, lazyBudget(6 * KB, 2 * KB)).violations).toEqual([
      "the build has no lazy three.js chunk, so its budget cannot be checked.",
      "the build has no lazy 3D view chunk, so its budget cannot be checked.",
    ]);
    const eager = bundle3d(5000);
    (eager["assets/studio-a.js"] as { imports: string[] }).imports.push("assets/three-t.js");
    const { violations } = checkLazyBudgets(eager, gzip, SITE_NAMES, lazyBudget(6 * KB, 2 * KB));
    expect(violations[0]).toBe("three.js is in a first load (three-t.js): it must only be reached through the 3D view's dynamic imports.");
  });

  it("are budgeted at what they shipped plus the same margin, minified and gzipped", () => {
    expect(Object.keys(LAZY_BUDGETS).sort()).toEqual(["scene3d", "three"]);
    for (const group of ["three", "scene3d"] as const) {
      for (const measure of ["min", "gzip"] as const) {
        expect(LAZY_SHIPPED[group][measure]).toBeGreaterThan(0);
        expect(LAZY_BUDGETS[group][measure]).toBe(Math.ceil(LAZY_SHIPPED[group][measure] * (1 + MARGIN)));
      }
      expect(LAZY_SHIPPED[group].gzip).toBeLessThan(LAZY_SHIPPED[group].min);
    }
  });
});
