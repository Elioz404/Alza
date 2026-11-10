/**
 * Where each build goes, and what may be in it. The deploy scripts publish dist/ as it stands,
 * so the guarantees that a build trusting localhost, or carrying the test hook, never ends up
 * there are rules in config/, pinned here — not habits of whoever runs the build.
 */
import { describe, expect, it } from "vitest";
import packageJson from "../package.json?raw";
import { PARTNER_DEV_ORIGIN, STUDIO_DEV_ORIGIN, devOrigin, PARTNER_DEV_PORT } from "../config/origins.js";
import { BuildFlagError, assertTestHookOrigins } from "../config/flags.js";
import { DIST_DIR, LOCAL_DIST_DIR, SITES, SITE_PAGES, outputDirFor, siteDir } from "../config/sites.js";

const DEPLOYED = { studio: "https://studio.example.com", supplier: "https://partner.example.net" };
const LOCAL = { studio: STUDIO_DEV_ORIGIN, supplier: PARTNER_DEV_ORIGIN };

describe("outputDirFor", () => {
  it("sends a build for two public origins to the deploy directory", () => {
    expect(outputDirFor(DEPLOYED)).toBe(DIST_DIR);
  });

  it("keeps any build that names a loopback origin out of it", () => {
    expect(outputDirFor(LOCAL)).toBe(LOCAL_DIST_DIR);
    expect(outputDirFor({ studio: DEPLOYED.studio, supplier: devOrigin(PARTNER_DEV_PORT, "127.0.0.1") })).toBe(LOCAL_DIST_DIR);
    expect(LOCAL_DIST_DIR).not.toBe(DIST_DIR);
  });
});

describe("assertTestHookOrigins", () => {
  it("lets a build without the hook name any origins", () => {
    expect(() => assertTestHookOrigins(false, DEPLOYED)).not.toThrow();
  });

  it("allows the hook in a build for loopback origins", () => {
    expect(() => assertTestHookOrigins(true, LOCAL)).not.toThrow();
  });

  it("refuses the hook when either origin is off this machine", () => {
    expect(() => assertTestHookOrigins(true, DEPLOYED)).toThrow(BuildFlagError);
    expect(() => assertTestHookOrigins(true, { studio: LOCAL.studio, supplier: DEPLOYED.supplier })).toThrow(/partner\.example\.net/);
    expect(() => assertTestHookOrigins(true, { studio: DEPLOYED.studio, supplier: LOCAL.supplier })).toThrow(/studio\.example\.com/);
  });
});

describe("the sites", () => {
  it("each have a page, at a path under their origin", () => {
    expect(SITES).toEqual(["studio", "partner"]);
    for (const site of SITES) expect(SITE_PAGES[site]).toMatch(/^\/.*\.html$/);
  });

  it("are deployed from their own directory, rebuilt first", () => {
    const { scripts } = JSON.parse(packageJson) as { scripts: Record<string, string> };
    for (const site of SITES) {
      const script = scripts[`deploy:${site}`];
      expect(script).toBeDefined();
      // as a whole argument: `dist` alone would publish both sites, the other's headers included
      expect(script.split(/\s+/)).toContain(siteDir(DIST_DIR, site));
      expect(script.startsWith("npm run build && ")).toBe(true);
    }
  });
});
