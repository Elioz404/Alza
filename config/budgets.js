/**
 * How much code each site may make a visitor download before its page can paint, and the check
 * that holds every build to it.
 *
 * "First load" is what the page cannot paint without: its entry chunk and every chunk that chunk
 * imports statically (Vite preloads those with the page), and the stylesheets Vite attached to
 * them. Chunks reached only through a dynamic import are not in it: the studio fetches those
 * after the first paint (src/ui/deferred.tsx) or when a view first opens (the 3D view, three.js).
 * Moving code into a statically imported chunk therefore does not get it under a budget.
 *
 * Each budget is the size the site actually ships (SHIPPED) plus one margin for all of them
 * (MARGIN), so a change that adds to the first load fails the build (vite.config.ts,
 * perSiteOutput) with the chunk, its size and the budget, instead of slipping through. A
 * deliberate increase is a change to this file.
 *
 * Sizes are in bytes; kB is 1000 bytes, as Vite reports them. "gzip" is the size gzip at its
 * default level gives, close to what the hosts send over the wire; the build passes the
 * compressor in (node:zlib), so this module stays free of Node and the tests can pass their own.
 *
 * Plain JavaScript, like the rest of config/, so Vite and the Node scripts load it as-is.
 */

export const KB = 1000;

/**
 * @typedef {{ min: number, gzip: number }} SizeLimit
 * @typedef {{ js: SizeLimit, css: SizeLimit }} SiteBudget
 */

/** How far over what shipped a budget lets a build go: 2%, for every site and every measure. */
export const MARGIN = 0.02;

/**
 * What each site's first load was when its budget was last set, in bytes, as the build log
 * reports it (`<site> first-load JS: â€¦`). A deliberate change of size is a change here.
 *
 * @type {Readonly<Record<import("./sites.js").Site, SiteBudget>>}
 */
export const SHIPPED = Object.freeze({
  studio: {
    // raised from 467_901 / 152_204 for levels and stairs: the plan model, its checker and the
    // WebMCP tools all run before the first paint (the tools register at boot), so the level and
    // stair actions, rules, plan-format migration and eight new tools are first-load code.
    // Raised again from 496_350 / 161_150 (measured 507_733 / 164_975) for the storeys' review:
    // the checker's wall-under-slab rule, the storey height carrying its walls, level names kept
    // unique, the removal refused before it is asked and the stairs it reroutes disclosed, and the
    // keyboard path of the stair tool — model, tool and first-paint shell code; the stairwell's
    // guard, which only the deferred plan symbol and the 3D view read, stays out (stairGuard.ts)
    // Raised again from 507_733 / 164_975 (measured 520_919 / 169_826; the build before it was
    // 510.9 kB / 166.2 kB in the build log) for the shared session: what has to run at boot, in dispatch and the tool
    // runner, is first-load — the presence store (the agent's focus, what the hand holds), what a
    // command touches (the person-editing refusal is decided synchronously in the tool runner),
    // the two new tools' schemas and descriptions (registered at boot like every tool), the
    // sync command and its checked apply, and ids unique per page. Everything else stays out:
    // the session runtime, its merge and message schemas, the tools' answers, the indicator and
    // the plan's and 3D view's markers all load after the first paint.
    js: { min: 520_919, gzip: 169_826 },
    css: { min: 110_997, gzip: 18_767 },
  },
  partner: {
    js: { min: 8_991, gzip: 4_209 },
    css: { min: 4_803, gzip: 1_436 },
  },
});

/** @param {SizeLimit} shipped @returns {SizeLimit} */
const withMargin = (shipped) => ({ min: Math.ceil(shipped.min * (1 + MARGIN)), gzip: Math.ceil(shipped.gzip * (1 + MARGIN)) });

/**
 * Each site's budget: what it shipped, plus MARGIN.
 *
 * @type {Readonly<Record<import("./sites.js").Site, SiteBudget>>}
 */
export const BUDGETS = Object.freeze(
  /** @type {Record<import("./sites.js").Site, SiteBudget>} */ (
    Object.fromEntries(Object.entries(SHIPPED).map(([site, shipped]) => [site, { js: withMargin(shipped.js), css: withMargin(shipped.css) }]))
  ),
);

/**
 * The 3D view's lazy chunks. They are not first load (the studio fetches them when the 3D view
 * or the Library's thumbnails first open), but they are what a visitor waits on there, so they
 * have budgets of their own, set and checked the same way:
 *
 *  - `three`: three.js, in its own chunk (vite.config.ts, manualChunks);
 *  - `scene3d`: the studio's own 3D code (the view, the scene, the furniture, the thumbnails),
 *    whatever chunks Rollup splits it into: every lazy chunk that imports three.js, directly
 *    or through another chunk.
 *
 * Sizes are what the chunks shipped when the budget was last set (the build log's
 * `studio lazy …` lines), in bytes.
 *
 * @typedef {"three" | "scene3d"} LazyGroup
 * @type {Readonly<Record<LazyGroup, SizeLimit>>}
 */
export const LAZY_SHIPPED = Object.freeze({
  three: { min: 517_921, gzip: 130_065 },
  // raised from 109_791 / 41_777 for storeys and stairs in 3D: the stair model, the slabs and their
  // stairwells (with the region cutter they are built by), the walker's climb between floors and
  // the View panel's levels control. All of it loads with the 3D view, never with the page
  scene3d: { min: 128_449, gzip: 48_798 },
});

/**
 * Each lazy group's budget: what it shipped, plus MARGIN.
 *
 * @type {Readonly<Record<LazyGroup, SizeLimit>>}
 */
export const LAZY_BUDGETS = Object.freeze(
  /** @type {Record<LazyGroup, SizeLimit>} */ (Object.fromEntries(Object.entries(LAZY_SHIPPED).map(([group, shipped]) => [group, withMargin(shipped)]))),
);

/** What each lazy group is called in the build log and in a failure. */
const LAZY_LABEL = Object.freeze({ three: "three.js", scene3d: "3D view" });

/**
 * The parts of Rollup's output bundle the check reads.
 *
 * @typedef {{ type: "chunk", fileName: string, name: string, isEntry: boolean, code: string, imports: string[], viteMetadata?: { importedCss: Set<string> } }} ChunkLike
 * @typedef {{ type: "asset", fileName: string, source: string | Uint8Array }} AssetLike
 * @typedef {Record<string, ChunkLike | AssetLike>} BundleLike
 */

/**
 * The files a site's page needs before it can paint: its entry chunk, the chunks it imports
 * statically (followed transitively), and their stylesheets.
 *
 * @param {BundleLike} bundle
 * @param {string} entryName the entry chunk's name (the site's name, config/sites.js)
 * @returns {{ js: string[], css: string[] } | null} null when the bundle has no such entry
 */
export function firstLoadFiles(bundle, entryName) {
  const entry = Object.values(bundle).find((o) => o.type === "chunk" && o.isEntry && o.name === entryName);
  if (!entry) return null;
  const js = [];
  const css = new Set();
  const seen = new Set();
  const queue = [entry.fileName];
  while (queue.length > 0) {
    const name = /** @type {string} */ (queue.shift());
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = bundle[name];
    if (chunk?.type !== "chunk") continue;
    js.push(name);
    queue.push(...chunk.imports);
    for (const file of chunk.viteMetadata?.importedCss ?? []) css.add(file);
  }
  return { js, css: [...css] };
}

/**
 * @param {ChunkLike | AssetLike} output
 * @returns {Uint8Array}
 */
const bytesOf = (output) => {
  const content = output.type === "chunk" ? output.code : output.source;
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
};

/** @typedef {(bytes: Uint8Array) => number} GzipSize the size of the bytes once gzipped */

/**
 * Each file's size, minified (as emitted) and gzipped, and the totals.
 *
 * @param {BundleLike} bundle
 * @param {string[]} files
 * @param {GzipSize} gzipSize
 */
export function measureFiles(bundle, files, gzipSize) {
  const sizes = files.map((fileName) => {
    const bytes = bytesOf(bundle[fileName]);
    return { fileName, min: bytes.length, gzip: gzipSize(bytes) };
  });
  return {
    files: sizes,
    min: sizes.reduce((sum, f) => sum + f.min, 0),
    gzip: sizes.reduce((sum, f) => sum + f.gzip, 0),
  };
}

/** @param {number} bytes */
export const formatSize = (bytes) => `${(bytes / KB).toFixed(1)} kB`;

/** The file's name without its directory, for messages. */
const baseName = (/** @type {string} */ fileName) => fileName.slice(fileName.lastIndexOf("/") + 1);

/**
 * Every site's first load, measured against its budget.
 *
 * @param {BundleLike} bundle
 * @param {GzipSize} gzipSize
 * @param {Readonly<Record<string, SiteBudget>>} [budgets]
 * @returns {{ report: string[], violations: string[] }} one line per site and kind for the build
 *   log, and one message per limit exceeded (empty when the build is within every budget)
 */
export function checkBudgets(bundle, gzipSize, budgets = BUDGETS) {
  const report = [];
  const violations = [];
  for (const [site, budget] of Object.entries(budgets)) {
    const files = firstLoadFiles(bundle, site);
    if (!files) {
      violations.push(`the build has no entry chunk for the ${site} site, so its budget cannot be checked.`);
      continue;
    }
    for (const kind of /** @type {const} */ (["js", "css"])) {
      const measured = measureFiles(bundle, files[kind], gzipSize);
      const limit = budget[kind];
      const label = kind === "js" ? "JS" : "CSS";
      report.push(
        `${site} first-load ${label}: ${formatSize(measured.min)} (budget ${formatSize(limit.min)}), gzip ${formatSize(measured.gzip)} (budget ${formatSize(limit.gzip)})`,
      );
      const list = measured.files.map((f) => `${baseName(f.fileName)} ${formatSize(f.min)} / gzip ${formatSize(f.gzip)}`).join(", ");
      for (const measure of /** @type {const} */ (["min", "gzip"])) {
        if (measured[measure] <= limit[measure]) continue;
        const how = measure === "min" ? "minified" : "gzipped";
        violations.push(
          `${site}'s first-load ${label} is ${formatSize(measured[measure])} ${how}, over its budget of ${formatSize(limit[measure])} ` +
            `by ${formatSize(measured[measure] - limit[measure])} (config/budgets.js). It is: ${list || "nothing"}.`,
        );
      }
    }
  }
  return { report, violations };
}

/**
 * The 3D view's lazy chunks, by group (see LAZY_SHIPPED): the three.js chunk, and every chunk
 * outside the sites' first loads that imports it, directly or through another chunk.
 *
 * @param {BundleLike} bundle
 * @param {readonly string[]} sites the sites whose first loads are not lazy
 * @returns {Record<LazyGroup, string[]> & { firstLoad: string[] }} the files of each group, and
 *   the three.js files a first load holds (which must be none)
 */
export function lazyFiles(bundle, sites) {
  const firstLoad = new Set(sites.flatMap((site) => firstLoadFiles(bundle, site)?.js ?? []));
  const chunks = /** @type {ChunkLike[]} */ (Object.values(bundle).filter((o) => o.type === "chunk"));
  const three = chunks.filter((c) => !c.isEntry && c.name === "three").map((c) => c.fileName);
  const threeSet = new Set(three);
  /**
   * Does this chunk import three.js, directly or through the chunks it imports?
   *
   * @param {string} start
   * @returns {boolean}
   */
  const importsThree = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const chunk = bundle[/** @type {string} */ (queue.shift())];
      if (chunk?.type !== "chunk") continue;
      for (const name of chunk.imports) {
        if (threeSet.has(name)) return true;
        if (!seen.has(name)) {
          seen.add(name);
          queue.push(name);
        }
      }
    }
    return false;
  };
  const scene3d = chunks.filter((c) => !threeSet.has(c.fileName) && !firstLoad.has(c.fileName) && importsThree(c.fileName)).map((c) => c.fileName);
  return { three: three.filter((f) => !firstLoad.has(f)), scene3d, firstLoad: three.filter((f) => firstLoad.has(f)) };
}

/**
 * The 3D view's lazy chunks, measured against their budgets (LAZY_BUDGETS).
 *
 * @param {BundleLike} bundle
 * @param {GzipSize} gzipSize
 * @param {readonly string[]} sites the sites whose first loads are not lazy
 * @param {Readonly<Record<LazyGroup, SizeLimit>>} [budgets]
 * @returns {{ report: string[], violations: string[] }} as checkBudgets
 */
export function checkLazyBudgets(bundle, gzipSize, sites, budgets = LAZY_BUDGETS) {
  const report = [];
  const violations = [];
  const files = lazyFiles(bundle, sites);
  if (files.firstLoad.length > 0) {
    violations.push(`three.js is in a first load (${files.firstLoad.map(baseName).join(", ")}): it must only be reached through the 3D view's dynamic imports.`);
  }
  for (const group of /** @type {LazyGroup[]} */ (Object.keys(budgets))) {
    const label = LAZY_LABEL[group];
    if (files[group].length === 0) {
      violations.push(`the build has no lazy ${label} chunk, so its budget cannot be checked.`);
      continue;
    }
    const measured = measureFiles(bundle, files[group], gzipSize);
    const limit = budgets[group];
    report.push(
      `studio lazy ${label}: ${formatSize(measured.min)} (budget ${formatSize(limit.min)}), gzip ${formatSize(measured.gzip)} (budget ${formatSize(limit.gzip)})`,
    );
    const list = measured.files.map((f) => `${baseName(f.fileName)} ${formatSize(f.min)} / gzip ${formatSize(f.gzip)}`).join(", ");
    for (const measure of /** @type {const} */ (["min", "gzip"])) {
      if (measured[measure] <= limit[measure]) continue;
      const how = measure === "min" ? "minified" : "gzipped";
      violations.push(
        `the lazy ${label} chunks are ${formatSize(measured[measure])} ${how}, over their budget of ${formatSize(limit[measure])} ` +
          `by ${formatSize(measured[measure] - limit[measure])} (config/budgets.js, LAZY_SHIPPED). They are: ${list}.`,
      );
    }
  }
  return { report, violations };
}
