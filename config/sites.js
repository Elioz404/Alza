/**
 * The two sites — what each one serves and where its deployable output lands.
 *
 * The studio and the partner are built together (one Vite run, two entry points) but are
 * published to different hosts, and each host must only ever answer with its own page and
 * its own headers. A host serves more URLs than the ones a page sits at: Cloudflare Pages
 * answers every unknown path with the root page (its single-page-app fallback, on whenever
 * the output has no 404.html), and Netlify serves a directory index at the slash-less path
 * too. A header layout that names page paths one by one misses those, and the page goes out
 * with no CSP and no frame-ancestors. So the build writes one directory per site, holding that
 * site's page alone and a _headers file whose policy sits on every path.
 *
 * Plain JavaScript, like the rest of config/, so Vite and the Node scripts load it as-is.
 */

import { isLoopbackHost } from "./origins.js";

/** The file a directory request is answered with, by the hosts and by serve-local alike. */
export const INDEX_FILE = "index.html";

/** Where the studio's page sits under its origin (its Vite entry point, from the repo root). */
export const STUDIO_PAGE_PATH = `/${INDEX_FILE}`;
/** Where the partner's page sits under its origin (its Vite entry point, from the repo root). */
export const PARTNER_PAGE_PATH = `/partner/${INDEX_FILE}`;

/** Each site's page. The keys name the sites everywhere else: build entries, output dirs, headers. */
export const SITE_PAGES = Object.freeze({
  studio: STUDIO_PAGE_PATH,
  partner: PARTNER_PAGE_PATH,
});

/** @typedef {keyof typeof SITE_PAGES} Site */

/** @type {readonly Site[]} */
export const SITES = Object.freeze(/** @type {Site[]} */ (Object.keys(SITE_PAGES)));

/** The output of `npm run build`: the only directory the deploy scripts publish. */
export const DIST_DIR = "dist";
/**
 * The output of a build aimed at loopback origins (`npm run build:local`), which is what
 * `npm run serve:local` serves. Kept apart from DIST_DIR so a build that trusts localhost, or
 * carries the test hook, can never be the one that gets deployed.
 */
export const LOCAL_DIST_DIR = "dist-local";

/**
 * One site's deployable directory under a build's output root, relative to the repo root.
 *
 * @param {string} root DIST_DIR or LOCAL_DIST_DIR
 * @param {Site} site
 * @returns {string}
 */
export const siteDir = (root, site) => `${root}/${site}`;

/**
 * Where a build for these origins goes. Anything that names a loopback origin was built to
 * run on this machine and goes to LOCAL_DIST_DIR; only a build for two public origins lands
 * in DIST_DIR, the directory the deploy scripts publish.
 *
 * @param {{ studio: string, supplier: string }} origins validated, canonical (config/origins.js)
 * @returns {string}
 */
export const outputDirFor = (origins) =>
  [origins.studio, origins.supplier].some((origin) => isLoopbackHost(new URL(origin).hostname)) ? LOCAL_DIST_DIR : DIST_DIR;
