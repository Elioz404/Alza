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
    js: { min: 925_187, gzip: 301_474 },
    css: { min: 210_305, gzip: 31_689 },
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
