import { loadEnv, type Plugin, type Rollup } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_DEV_ORIGIN, STUDIO_DEV_PORT, resolveOrigins } from "./config/origins.js";
import { HEADERS_FILE, headerRules, renderHeadersFile } from "./config/headers.js";
import { TEST_HOOK_ENV, assertTestHookOrigins, readFlag } from "./config/flags.js";
import { SITES, SITE_PAGES, outputDirFor, type Site } from "./config/sites.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A page's file under the repo root (and under the bundle), from its path under its origin. */
const pageFile = (pagePath: string) => pagePath.replace(/^\//, "");

/** Every file under `dir`, as forward-slash paths relative to it. */
function filesUnder(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

/**
 * Every output file a site's entry chunk can load: its static and dynamic imports, followed
 * transitively, plus the CSS and assets Vite records against each of those chunks.
 */
function reachableFrom(bundle: Rollup.OutputBundle, site: Site): Set<string> {
  const entry = Object.values(bundle).find((o) => o.type === "chunk" && o.isEntry && o.name === site);
  const seen = new Set<string>();
  const queue = entry ? [entry.fileName] : [];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const output = bundle[name];
    if (output?.type !== "chunk") continue;
    queue.push(...output.imports, ...output.dynamicImports);
    for (const file of output.viteMetadata?.importedCss ?? []) seen.add(file);
    for (const file of output.viteMetadata?.importedAssets ?? []) seen.add(file);
  }
  return seen;
}

/**
 * Lay the build out as one deployable directory per site (config/sites.js): `<outDir>/studio`
 * and `<outDir>/partner`, each holding its own page, every shared file (the bundle's assets
 * and public/) and a `_headers` whose policy covers every path that host can answer — the
 * reason it is split at all is in config/headers.js.
 *
 * It runs last among the generateBundle hooks, once Vite has finished every chunk and page,
 * and re-files the finished output rather than building twice. public/ is copied here too
 * (copyPublicDir is off below), so nothing lands outside a site's directory. A page that
 * belongs to no site fails the build: it would otherwise ship with no headers of its own.
 */
function perSiteOutput(origins: { studio: string; supplier: string }): Plugin {
  let publicDir = "";
  return {
    name: "alza-per-site-output",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        // Each site ships only what its own entry point can reach — static and dynamic imports,
        // and the CSS and assets Vite attached to those chunks — so the partner host never
        // carries the studio's bundle (or three.js) and vice versa.
        const reachable = new Map<Site, Set<string>>(SITES.map((site) => [site, reachableFrom(bundle, site)]));
        const pages = new Map<string, string | Uint8Array>();
        const assets = new Map<string, string | Uint8Array>();
        const publicFiles = new Map<string, string | Uint8Array>();
        const guard = (name: string) => {
          if (name === HEADERS_FILE) this.error(`${name} is written by the build; remove it from the sources.`);
        };
        for (const [name, output] of Object.entries(bundle)) {
          guard(name);
          (name.endsWith(".html") ? pages : assets).set(name, output.type === "chunk" ? output.code : output.source);
          delete bundle[name];
        }
        for (const name of filesUnder(publicDir)) {
          guard(name);
          publicFiles.set(name, readFileSync(join(publicDir, name)));
        }
        const orphans = [...assets.keys()].filter((name) => !SITES.some((site) => reachable.get(site)!.has(name)));
        if (orphans.length > 0) this.error(`${orphans.join(", ")} are reachable from no site's entry point.`);

        const owned = new Set(SITES.map((site) => pageFile(SITE_PAGES[site])));
        const strays = [...pages.keys()].filter((name) => !owned.has(name));
        if (strays.length > 0) this.error(`${strays.join(", ")} belong to no site in config/sites.js, so no host would serve them with a policy.`);

        for (const site of SITES) {
          const page = pageFile(SITE_PAGES[site]);
          const emit = (name: string, source: string | Uint8Array) => this.emitFile({ type: "asset", fileName: `${site}/${name}`, source });
          const source = pages.get(page);
          if (source === undefined) this.error(`the build produced no ${page} for the ${site} site.`);
          emit(page, source);
          const own = reachable.get(site)!;
          for (const [name, data] of assets) if (own.has(name)) emit(name, data);
          for (const [name, data] of publicFiles) emit(name, data);
          emit(HEADERS_FILE, renderHeadersFile(headerRules(origins, site)));
        }
      },
    },
  };
}

// vitest's defineConfig types the `test` block, so the config is checked as a whole
// (tsconfig.node.json) instead of being cast past the compiler.
export default defineConfig(({ command, mode }) => {
  // loadEnv, not process.env: Vite injects .env into import.meta.env for the
  // bundle but leaves process.env alone, so the header plugin saw nothing.
  const env = loadEnv(mode, __dirname, "");
  // Every build ships, so every build must name both origins; resolveOrigins throws (and the
  // build stops) when one is missing or is not a bare https origin. The dev server and the
  // tests fall back to the local ports.
  const origins = resolveOrigins(env, { production: command === "build" });
  // The bundle reads the same switch through import.meta.env (src/testHook.ts). Read here to
  // fail the build on a mistyped value, and on the hook in a build for origins off this machine.
  const testHook = readFlag(env, TEST_HOOK_ENV);
  if (command === "build") assertTestHookOrigins(testHook, origins);
  return {
    plugins: [react(), perSiteOutput(origins)],
    base: "./",
    // Pinned and strict: the partner only authorises the studio's dev port, and a silently
    // bumped port would be an origin nobody trusts.
    server: { port: STUDIO_DEV_PORT, strictPort: true },
    build: {
      // a build that trusts a loopback origin never lands where the deploy scripts publish
      outDir: outputDirFor(origins),
      // perSiteOutput copies public/ into each site itself
      copyPublicDir: false,
      // one entry point per site: the studio, and the partner catalogue that ships as its own origin
      rollupOptions: {
        input: Object.fromEntries(SITES.map((site) => [site, resolve(__dirname, pageFile(SITE_PAGES[site]))])),
        output: {
          // three.js is only reached through the lazily loaded 3D view and thumbnails; giving it
          // its own chunk keeps it out of the first one and names it for what it is (module ids
          // are forward-slashed on every platform)
          manualChunks: (id) => (id.includes("/node_modules/three/") ? "three" : undefined),
        },
      },
    },
    test: {
      // The store, registry and supplier read `window`, `document` and `location` as they
      // load, so the suite runs in a DOM instead of stubbing those globals by hand. The DOM
      // sits on the dev server's origin, so import-time reads see what `npm run dev` sees.
      environment: "happy-dom",
      environmentOptions: { happyDOM: { url: `${STUDIO_DEV_ORIGIN}/` } },
      include: ["tests/**/*.test.ts"],
    },
  };
});
