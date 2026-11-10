/**
 * What may never be part of a site's first load, and the check that holds every build to it.
 *
 * The studio's first paint draws its tabs, the Plan | 3D switch, the approval switch and its
 * tooltips with Alza's own controls (src/ui/primitives). Astryx's runtime (its components, their
 * gestures, motion, layers and i18n, and the ICU message formatter its strings go through) is
 * several hundred kB, and only the heavy components that open on interaction need it: those
 * arrive after the first paint (src/ui/deferred.tsx, src/ui/primitives/astryx.ts). One static
 * import from first-paint code would quietly put all of it back, so the build fails instead,
 * naming the modules and the chain of static imports that brought each in, from the site's
 * entry point to the project file that imports it (vite.config.ts, perSiteOutput).
 *
 * Astryx's stylesheets are not modules here: its reset, theme and token declarations stay in the
 * first load's CSS (src/ui/theme/theme.css), where the tokens come from.
 *
 * "First load" is config/budgets.js's: the entry chunk, the chunks it imports statically, and
 * so on. Plain JavaScript, like the rest of config/, so Vite and the Node scripts load it as-is.
 */

import { firstLoadFiles } from "./budgets.js";

/**
 * Module ids (forward-slashed, as Rollup reports them on every platform) that may not ship in a
 * site's first load, with why.
 *
 * @type {ReadonlyArray<{ pattern: RegExp, why: string }>}
 */
export const FORBIDDEN_IN_FIRST_LOAD = Object.freeze([
  { pattern: /\/node_modules\/@astryxdesign\//, why: "Astryx's runtime and themes load with the deferred components that need them" },
  { pattern: /\/node_modules\/(@formatjs\/|intl-messageformat\/)/, why: "the ICU message formatter only Astryx's strings use" },
  { pattern: /\/node_modules\/@stylexjs\//, why: "StyleX's runtime only Astryx's components use" },
  { pattern: /\/node_modules\/lucide-react\//, why: "the stone theme's icon set; the page's own icons are src/ui/primitives/icons.tsx" },
]);

/**
 * The parts of Rollup's output chunk the check reads, on top of config/budgets.js's.
 *
 * @typedef {import("./budgets.js").ChunkLike & { modules?: Record<string, { renderedLength: number }> }} ChunkWithModules
 * @typedef {Record<string, ChunkWithModules | import("./budgets.js").AssetLike>} BundleWithModules
 */

/** How many offending modules a message names before it counts the rest. */
export const MODULES_SHOWN = 8;

/** A module id as Rollup reports it, forward-slashed. */
const slashed = (/** @type {string} */ id) => id.split("\\").join("/");

/**
 * The forbidden modules that ship in a site's first load: modules of a first-load chunk that
 * match a pattern and contribute code to it (a module the bundler dropped entirely ships nothing).
 * Stylesheets are not checked: only JavaScript modules are runtime.
 *
 * @param {BundleWithModules} bundle
 * @param {string} site the entry chunk's name (config/sites.js)
 * @param {ReadonlyArray<{ pattern: RegExp, why: string }>} [forbidden]
 * @returns {{ id: string, rawId: string, chunk: string, why: string }[]} `id` forward-slashed,
 *   `rawId` as the bundler names the module (to look it up in its module graph)
 */
export function forbiddenInFirstLoad(bundle, site, forbidden = FORBIDDEN_IN_FIRST_LOAD) {
  const files = firstLoadFiles(/** @type {import("./budgets.js").BundleLike} */ (bundle), site);
  if (!files) return [];
  const found = [];
  for (const fileName of files.js) {
    const chunk = bundle[fileName];
    if (chunk?.type !== "chunk") continue;
    for (const [rawId, info] of Object.entries(chunk.modules ?? {})) {
      const id = slashed(rawId);
      if (info.renderedLength <= 0 || /\.css(\?|$)/.test(id)) continue;
      const rule = forbidden.find((f) => f.pattern.test(id));
      if (rule) found.push({ id, rawId, chunk: fileName, why: rule.why });
    }
  }
  return found;
}

/**
 * The shortest chains of static imports from `entry`: a function that gives the chain to a
 * module, `entry` first and the module last, or null for a module no static import reaches.
 * Only static imports are followed (a dynamic import's modules are fetched later, so they are
 * not the first load's), which is what makes the chain the one to cut: every module on it is
 * part of the first load, whatever other, deferred modules also import the same thing.
 *
 * @param {string} entry the site's entry module
 * @param {(id: string) => readonly string[]} importsOf a module's static imports
 * @returns {(target: string) => string[] | null}
 */
export function staticImportChains(entry, importsOf) {
  /** @type {Map<string, string | null>} */
  const parent = new Map([[entry, null]]);
  const queue = [entry];
  for (let i = 0; i < queue.length; i++) {
    for (const next of importsOf(queue[i])) {
      if (parent.has(next)) continue;
      parent.set(next, queue[i]);
      queue.push(next);
    }
  }
  return (target) => {
    if (!parent.has(target)) return null;
    const chain = [];
    for (let at = /** @type {string | null} */ (target); at !== null; at = parent.get(at) ?? null) chain.unshift(at);
    return chain;
  };
}

/**
 * Every site's forbidden first-load modules, as messages for the build: one per site that has
 * any, with why they may not be there. The modules (shortened to their package paths) are
 * grouped by how they got in, when `chainOf` can say: the project files on the chain of static
 * imports from the site's entry point, the last of them the one that imports the package, so
 * the import to move is the one at the end of a chain whose files should not reach it.
 *
 * @param {BundleWithModules} bundle
 * @param {readonly string[]} sites
 * @param {(site: string, rawId: string) => readonly string[] | null} [chainOf] the project files
 *   on the static import chain from `site`'s entry to the module, entry first
 * @param {ReadonlyArray<{ pattern: RegExp, why: string }>} [forbidden]
 * @returns {string[]}
 */
export function checkFirstLoad(bundle, sites, chainOf = () => null, forbidden = FORBIDDEN_IN_FIRST_LOAD) {
  const messages = [];
  for (const site of sites) {
    const found = forbiddenInFirstLoad(bundle, site, forbidden);
    if (found.length === 0) continue;
    const reasons = [...new Set(found.map((f) => f.why))];
    /** @type {Map<string, string[]>} */
    const byChain = new Map();
    for (const f of found) {
      const via = (chainOf(site, f.rawId) ?? []).join(" > ");
      byChain.set(via, [...(byChain.get(via) ?? []), f.id.replace(/^.*\/node_modules\//, "")]);
    }
    // the chain that brings the most first, so the main culprit leads
    const groups = [...byChain].sort((a, b) => b[1].length - a[1].length);
    const lines = groups.map(([via, modules]) => {
      const shown = modules.slice(0, MODULES_SHOWN).join(", ");
      const more = modules.length > MODULES_SHOWN ? `, and ${modules.length - MODULES_SHOWN} more` : "";
      return `${via ? `through ${via}: ` : ""}${modules.length} module(s): ${shown}${more}`;
    });
    messages.push(
      `${site}'s first load ships ${found.length} module(s) it must not (config/firstLoad.js). ${lines.join("; ")}. ` +
        `${reasons.join("; ")}. Import them from deferred code only (src/ui/deferred.tsx).`,
    );
  }
  return messages;
}
