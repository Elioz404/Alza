/**
 * Both sites' response headers. Each site is published from its own directory with its own
 * _headers, and a host matches those rules against the REQUEST path — including paths it
 * answers with a page the rules never named (Cloudflare's single-page-app fallback, Netlify's
 * slash-less directory index). So the tests pin the policies themselves, that every path a
 * host can answer with its page carries that page's policy, and that no request can ever
 * receive two values of one header.
 */
import { describe, expect, it } from "vitest";
import {
  EVERY_PATH,
  HSTS_MAX_AGE_SECONDS,
  HeaderLayoutError,
  PAGE_POLICY_HEADERS,
  assertNoMergedHeaders,
  headerRules,
  headersFor,
  pagePaths,
  partnerCsp,
  pathMatches,
  renderHeadersFile,
  studioCsp,
} from "../config/headers.js";
import { PARTNER_PAGE_PATH, SITES, SITE_PAGES, STUDIO_PAGE_PATH } from "../config/sites.js";

const origins = { studio: "https://studio.example.com", supplier: "https://partner.example.net" };
const studio = headerRules(origins, "studio");
const partner = headerRules(origins, "partner");
const RULES = { studio, partner };

/** Split a CSP into { directive: sources[] }. */
const directives = (csp: string | undefined): Record<string, string[]> =>
  Object.fromEntries(
    (csp ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );

/**
 * Paths a host may answer with an HTML page: the page's own paths, unknown paths (which
 * Cloudflare's SPA fallback answers with the root page), the other site's page paths, and
 * paths under a page's directory.
 */
const HTML_PATHS = [
  ...pagePaths(STUDIO_PAGE_PATH),
  ...pagePaths(PARTNER_PAGE_PATH),
  "/x",
  "/anything/deeper",
  "/partner/x",
  "/assets/missing.js",
  "/404.html",
];
const ASSET_PATHS = ["/assets/studio-abc123.js", "/assets/partner-abc123.js", "/assets/studio.css", "/favicon.svg"];

describe("pagePaths / pathMatches", () => {
  it("answers an index page at its file and at its directory, with and without the slash", () => {
    expect(pagePaths(STUDIO_PAGE_PATH)).toEqual(["/index.html", "/"]);
    expect(pagePaths(PARTNER_PAGE_PATH)).toEqual(["/partner/index.html", "/partner/", "/partner"]);
  });

  it("matches exact paths exactly and splats greedily, including the empty string", () => {
    expect(pathMatches("/", "/")).toBe(true);
    expect(pathMatches("/", "/index.html")).toBe(false);
    expect(pathMatches("/*", "/")).toBe(true);
    expect(pathMatches("/partner/*", "/partner/")).toBe(true);
    expect(pathMatches("/partner/*", "/partnerx")).toBe(false);
    expect(pathMatches("/a.b", "/aXb")).toBe(false);
  });
});

describe("the studio site", () => {
  const headers = (path: string) => headersFor(studio, path);

  it("carries the full CSP", () => {
    expect(directives(headers("/")["Content-Security-Policy"])).toEqual({
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
  });

  it("delegates the tools feature to the partner, and to nobody else", () => {
    expect(headers("/")["Permissions-Policy"]).toBe(`tools=(self "${origins.supplier}")`);
  });

  it("allows no inline script, no eval and no inline style", () => {
    const csp = headers("/")["Content-Security-Policy"];
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });
});

describe("the partner site", () => {
  it("carries its own CSP, framed by the studio alone", () => {
    const csp = directives(headersFor(partner, PARTNER_PAGE_PATH)["Content-Security-Policy"]);
    expect(csp["frame-ancestors"]).toEqual([origins.studio]);
    expect(csp["frame-src"]).toEqual(["'none'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("does not inherit the studio's policy or its tools delegation", () => {
    const headers = headersFor(partner, PARTNER_PAGE_PATH);
    expect(headers["Content-Security-Policy"]).not.toContain(",");
    expect(headers["Content-Security-Policy"]).not.toContain(origins.supplier);
    expect(headers["Permissions-Policy"]).toBe("tools=(self)");
  });
});

describe.each(SITES)("every URL the %s host can answer with a page", (site) => {
  const csp = site === "studio" ? studioCsp(origins) : partnerCsp(origins);

  it.each(HTML_PATHS)("%s carries that site's CSP, frame-ancestors and tools policy", (path) => {
    const headers = headersFor(RULES[site], path);
    expect(headers["Content-Security-Policy"]).toBe(csp);
    expect(directives(headers["Content-Security-Policy"])["frame-ancestors"]?.length).toBeGreaterThan(0);
    for (const name of PAGE_POLICY_HEADERS) expect(headers[name]).toBeTruthy();
  });
});

describe("every response", () => {
  it.each(SITES.flatMap((site) => [...HTML_PATHS, ...ASSET_PATHS].map((path) => [site, path] as const)))(
    "of the %s host at %s carries the common hardening headers, once",
    (site, path) => {
      const headers = headersFor(RULES[site], path);
      expect(headers).toMatchObject({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Strict-Transport-Security": `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
        "Cross-Origin-Opener-Policy": "same-origin",
      });
      // no host-side merge produced a comma-joined value anywhere
      for (const name of ["Content-Security-Policy", "Permissions-Policy", "Strict-Transport-Security", "X-Content-Type-Options"]) {
        expect(headers[name] ?? "").not.toContain(", ");
      }
    },
  );
});

describe("the layout guard", () => {
  it("refuses two overlapping rules that set the same header", () => {
    expect(() =>
      assertNoMergedHeaders([
        { path: EVERY_PATH, headers: { "Content-Security-Policy": "default-src 'self'" } },
        { path: "/partner/index.html", headers: { "content-security-policy": "frame-ancestors x" } },
      ]),
    ).toThrow(HeaderLayoutError);
    expect(() =>
      assertNoMergedHeaders([
        { path: "/", headers: { A: "1" } },
        { path: "/", headers: { A: "2" } },
      ]),
    ).toThrow(HeaderLayoutError);
  });

  it("accepts disjoint rules", () => {
    expect(() =>
      assertNoMergedHeaders([
        { path: "/", headers: { A: "1" } },
        { path: "/partner/", headers: { A: "2" } },
        { path: EVERY_PATH, headers: { B: "3" } },
      ]),
    ).not.toThrow();
  });
});

describe("the _headers files", () => {
  it.each(SITES)("give the %s site one rule, on every path, naming its page's policy", (site) => {
    const file = renderHeadersFile(RULES[site]);
    expect(file.endsWith("\n")).toBe(true);
    const blocks = file
      .trim()
      .split(/\n\n+/)
      .filter((b) => !b.startsWith("#"));
    expect(blocks.map((b) => b.split("\n")[0])).toEqual([EVERY_PATH]);
    for (const block of blocks) {
      for (const line of block.split("\n").slice(1)) expect(line).toMatch(/^ {2}[A-Za-z-]+: \S/);
    }
    expect(file).toContain(`  Content-Security-Policy: ${headersFor(RULES[site], SITE_PAGES[site])["Content-Security-Policy"]}`);
  });
});
