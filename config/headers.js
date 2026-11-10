/**
 * The HTTP response headers of both sites, in one place.
 *
 * vite.config.ts writes each site's set to the _headers file at the root of that site's own
 * output directory (config/sites.js), and scripts/serve-local.mjs sends the same sets itself
 * (a plain static server ignores _headers), so what runs locally is what ships.
 *
 * Both hosts — the studio on Cloudflare Pages, the partner on Netlify — read _headers the
 * same way: the rules match the REQUEST path, not the file that ends up being served. A host
 * answers more paths than a page is filed under: Cloudflare serves the root page for any
 * unknown path (its single-page-app fallback), Netlify serves `/partner/index.html` at
 * `/partner` as well as `/partner/`. A policy pinned to a page's exact paths would let those
 * answers out with no CSP and no frame-ancestors, framable by anyone. So each site's whole
 * set sits on `/*` of that site's own file, and every response the host sends carries it:
 * a page, a fallback, an asset (where CSP is inert) or the host's own error page.
 *
 * Every rule whose path matches applies, and a header set by two matching rules is sent once
 * with both values joined by a comma — for a CSP, a second policy enforced as well, not an
 * override. Separate files per site mean no rule of one site can reach the other's page, and
 * headerRules() refuses any rule set in which two rules that can match the same path both set
 * one header, so a layout added later cannot regress into a merge.
 *
 * Plain JavaScript, like the rest of config/, so Vite and the Node scripts load it as-is.
 */

import { INDEX_FILE, SITE_PAGES } from "./sites.js";

/** How long a browser keeps to https once it has seen the site: two years, as the HSTS preload list asks. */
export const HSTS_MAX_AGE_SECONDS = 63_072_000;

/** The file the hosts read, at the root of each site's output directory. */
export const HEADERS_FILE = "_headers";

/** The splat path that matches every request a host answers. */
export const EVERY_PATH = "/*";

/**
 * @typedef {{ studio: string, supplier: string }} Origins
 * @typedef {Record<string, string>} HeaderSet
 * @typedef {{ path: string, headers: HeaderSet }} HeaderRule
 * @typedef {import("./sites.js").Site} Site
 */

/** The headers a page cannot go out without: its CSP (with frame-ancestors) and its tools policy. */
export const PAGE_POLICY_HEADERS = Object.freeze(["Content-Security-Policy", "Permissions-Policy"]);

/**
 * The paths a host answers a page at: its file and, for an index page, its directory with and
 * without the trailing slash — hosts serve (or redirect to) the index for both.
 *
 * @param {string} page
 * @returns {string[]}
 */
export function pagePaths(page) {
  if (!page.endsWith(`/${INDEX_FILE}`)) return [page];
  const dir = page.slice(0, page.length - INDEX_FILE.length);
  return dir === "/" ? [page, dir] : [page, dir, dir.slice(0, -1)];
}

/**
 * @param {Record<string, readonly string[]>} directives
 * @returns {string}
 */
const policy = (directives) =>
  Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");

/**
 * The studio page's CSP. Everything it loads is its own: the bundle, its stylesheet, its icons.
 * Images may also be data: and blob: URLs (the blueprint underlay, the 3D thumbnails). The one
 * foreign thing on the page is the partner frame. No 'unsafe-inline' for styles: React applies
 * `style` props through the CSSOM, which CSP does not govern, and the build emits no inline
 * <style>. No 'unsafe-eval': zod runs jitless (src/model/schemas.ts).
 *
 * @param {Origins} origins
 */
export const studioCsp = (origins) =>
  policy({
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'"],
    "frame-src": [origins.supplier],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'self'"],
  });

/**
 * The partner page's CSP. It loads only its own script and stylesheet, frames nothing, and may
 * be framed by the studio alone.
 *
 * @param {Origins} origins
 */
export const partnerCsp = (origins) =>
  policy({
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'"],
    "connect-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": [origins.studio],
  });

/**
 * The per-site header sets.
 *
 *  - `common`: on every response of both hosts.
 *  - `studio`: the studio page. `Permissions-Policy: tools=…` lets it delegate the `tools`
 *    feature to the partner frame; without it, `allow="tools"` on the iframe has nothing to
 *    delegate and the partner cannot register WebMCP tools at all.
 *  - `partner`: the partner page, which uses the `tools` feature itself.
 *
 * @param {Origins} origins validated, canonical (config/origins.js)
 * @returns {{ common: HeaderSet, studio: HeaderSet, partner: HeaderSet }}
 */
export function siteHeaders(origins) {
  return {
    common: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    studio: {
      "Content-Security-Policy": studioCsp(origins),
      "Permissions-Policy": `tools=(self "${origins.supplier}")`,
    },
    partner: {
      "Content-Security-Policy": partnerCsp(origins),
      "Permissions-Policy": "tools=(self)",
    },
  };
}

/**
 * Whether a _headers path pattern matches a request path. `*` matches any run of characters,
 * including none — the more permissive reading of the hosts' docs, which is the safe one for
 * the overlap check below.
 *
 * @param {string} pattern
 * @param {string} path
 */
export function pathMatches(pattern, path) {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(path);
}

/**
 * Whether some request path could match both patterns. Exact against exact is equality and
 * a splat against an exact path is a match test; two splats are assumed to overlap.
 *
 * @param {string} a
 * @param {string} b
 */
function couldOverlap(a, b) {
  const splatA = a.includes("*");
  const splatB = b.includes("*");
  if (!splatA && !splatB) return a === b;
  if (splatA && !splatB) return pathMatches(a, b);
  if (!splatA && splatB) return pathMatches(b, a);
  return true;
}

/** Raised for a rule set that would make a host merge two values of one header. */
export class HeaderLayoutError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "HeaderLayoutError";
  }
}

/**
 * Refuse a rule set in which two rules that can match the same request set the same header.
 *
 * @param {readonly HeaderRule[]} rules
 * @returns {readonly HeaderRule[]}
 */
export function assertNoMergedHeaders(rules) {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (!couldOverlap(a.path, b.path)) continue;
      const lower = new Set(Object.keys(a.headers).map((h) => h.toLowerCase()));
      const shared = Object.keys(b.headers).filter((h) => lower.has(h.toLowerCase()));
      if (shared.length > 0) {
        throw new HeaderLayoutError(`${a.path} and ${b.path} can match the same request and both set ${shared.join(", ")}; a host would merge them.`);
      }
    }
  }
  return rules;
}

/**
 * Join header sets that must not overlap: a name in two of them would have one silently win.
 *
 * @param {...HeaderSet} sets
 * @returns {HeaderSet}
 */
function disjointUnion(...sets) {
  /** @type {HeaderSet} */
  const out = {};
  const seen = new Set();
  for (const set of sets) {
    for (const [name, value] of Object.entries(set)) {
      if (seen.has(name.toLowerCase())) throw new HeaderLayoutError(`${name} is set twice in one site's headers.`);
      seen.add(name.toLowerCase());
      out[name] = value;
    }
  }
  return out;
}

/**
 * Refuse a rule set under which some path a host answers the site's page at would go out
 * without the page's policy. The layout below cannot do that; this keeps a future one honest.
 *
 * @param {readonly HeaderRule[]} rules
 * @param {string} page
 */
function assertPageCovered(rules, page) {
  for (const path of pagePaths(page)) {
    const headers = headersFor(rules, path);
    const missing = PAGE_POLICY_HEADERS.filter((name) => !headers[name]);
    if (missing.length > 0) throw new HeaderLayoutError(`${path} would be served without ${missing.join(", ")}.`);
    if (!/(^|;)\s*frame-ancestors\s/.test(headers["Content-Security-Policy"])) {
      throw new HeaderLayoutError(`${path} would be served without frame-ancestors.`);
    }
  }
}

/**
 * The rules written to one site's _headers: the common set and the site's own, together on
 * every path, so no answer that host gives — fallback, directory index, error page — can
 * leave without the page policy.
 *
 * @param {Origins} origins validated, canonical (config/origins.js)
 * @param {Site} site
 * @returns {readonly HeaderRule[]}
 */
export function headerRules(origins, site) {
  const sets = siteHeaders(origins);
  const rules = assertNoMergedHeaders([{ path: EVERY_PATH, headers: disjointUnion(sets.common, sets[site]) }]);
  assertPageCovered(rules, SITE_PAGES[site]);
  return rules;
}

/**
 * The headers a host sends for one request path: every matching rule applies, and a header
 * set twice is joined with a comma, as Cloudflare Pages and Netlify do.
 *
 * @param {readonly HeaderRule[]} rules
 * @param {string} path
 * @returns {HeaderSet}
 */
export function headersFor(rules, path) {
  /** @type {HeaderSet} */
  const out = {};
  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    for (const [name, value] of Object.entries(rule.headers)) out[name] = name in out ? `${out[name]}, ${value}` : value;
  }
  return out;
}

/**
 * A site's `_headers` file, in the syntax both hosts read.
 *
 * @param {readonly HeaderRule[]} rules
 * @returns {string}
 */
export function renderHeadersFile(rules) {
  const blocks = rules.map((rule) =>
    [rule.path, ...Object.entries(rule.headers).map(([name, value]) => `  ${name}: ${value}`)].join("\n"),
  );
  return `# Written by the build from config/headers.js; edit that file, not this one.\n\n${blocks.join("\n\n")}\n`;
}
