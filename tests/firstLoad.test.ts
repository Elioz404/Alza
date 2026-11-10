/**
 * The first load may not carry Astryx's runtime (config/firstLoad.js): the first paint draws its
 * controls with Alza's own primitives, and the build fails, naming the modules and who brought
 * them, the moment a static import puts Astryx back on it. Lazily fetched chunks may carry it.
 */
import { describe, expect, it } from "vitest";
import { FORBIDDEN_IN_FIRST_LOAD, MODULES_SHOWN, checkFirstLoad, forbiddenInFirstLoad, staticImportChains, type BundleWithModules } from "../config/firstLoad.js";
import { SITES } from "../config/sites.js";

const NM = "D:/repo/node_modules";
const chunk = (fileName: string, name: string, modules: Record<string, number>, extra: { isEntry?: boolean; imports?: string[] } = {}) => ({
  type: "chunk" as const,
  fileName,
  name,
  isEntry: extra.isEntry ?? false,
  code: "",
  imports: extra.imports ?? [],
  viteMetadata: { importedCss: new Set<string>() },
  modules: Object.fromEntries(Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }])),
});

/** A studio entry that imports a shared chunk, a lazy chunk with Astryx in it, and the partner. */
function bundle(studio: Record<string, number>, shared: Record<string, number> = {}): BundleWithModules {
  return {
    "assets/studio.js": chunk("assets/studio.js", "studio", { "D:/repo/src/main.tsx": 100, ...studio }, { isEntry: true, imports: ["assets/shared.js"] }),
    "assets/shared.js": chunk("assets/shared.js", "shared", { [`${NM}/react-dom/index.js`]: 100, ...shared }),
    "assets/astryx.js": chunk("assets/astryx.js", "astryx", { [`${NM}/@astryxdesign/core/dist/Dialog/Dialog.js`]: 5000, [`${NM}/intl-messageformat/lib/index.js`]: 900 }, { imports: ["assets/studio.js"] }),
    "assets/partner.js": chunk("assets/partner.js", "partner", { "D:/repo/partner/main.ts": 50 }, { isEntry: true, imports: ["assets/shared.js"] }),
  };
}

describe("what the first load may not carry", () => {
  it("is Astryx's runtime and what only it uses", () => {
    const forbidden = (id: string) => FORBIDDEN_IN_FIRST_LOAD.some((f) => f.pattern.test(id));
    for (const id of [
      `${NM}/@astryxdesign/core/dist/Tooltip/Tooltip.js`,
      `${NM}/@astryxdesign/core/dist/gestures/touchAction.js`,
      `${NM}/@astryxdesign/theme-stone/dist/stone.js`,
      `${NM}/@formatjs/icu-messageformat-parser/lib/parser.js`,
      `${NM}/intl-messageformat/lib/src/core.js`,
      `${NM}/@stylexjs/stylex/lib/es/stylex.mjs`,
      `${NM}/lucide-react/dist/esm/icons/x.js`,
    ]) {
      expect(forbidden(id)).toBe(true);
    }
    for (const id of [`${NM}/react-dom/cjs/react-dom-client.production.js`, `${NM}/zod/v4/core/schemas.js`, "D:/repo/src/ui/primitives/Tip.tsx", "D:/repo/src/ui/primitives/astryx.ts"]) {
      expect(forbidden(id)).toBe(false);
    }
  });
});

describe("the first-load check", () => {
  it("passes a first load free of Astryx, whatever the lazy chunks carry", () => {
    expect(forbiddenInFirstLoad(bundle({}), "studio")).toEqual([]);
    expect(checkFirstLoad(bundle({}), SITES)).toEqual([]);
  });

  it("finds Astryx in the entry chunk and in a chunk the entry imports statically", () => {
    const b = bundle({ [`${NM}/@astryxdesign/core/dist/TabList/TabList.js`]: 4000 }, { [`${NM}/@formatjs/fast-memoize/lib/index.js`]: 300 });
    expect(forbiddenInFirstLoad(b, "studio").map((f) => [f.chunk, f.id.replace(`${NM}/`, "")])).toEqual([
      ["assets/studio.js", "@astryxdesign/core/dist/TabList/TabList.js"],
      ["assets/shared.js", "@formatjs/fast-memoize/lib/index.js"],
    ]);
    // the partner shares the static chunk, so it is caught there too
    expect(forbiddenInFirstLoad(b, "partner").map((f) => f.chunk)).toEqual(["assets/shared.js"]);
  });

  it("ignores a module the bundler dropped entirely, and stylesheets", () => {
    const b = bundle({ [`${NM}/@astryxdesign/core/dist/Kbd/Kbd.js`]: 0, [`${NM}/@astryxdesign/core/dist/astryx.css`]: 1200 });
    expect(forbiddenInFirstLoad(b, "studio")).toEqual([]);
  });

  it("matches module ids written with either slash", () => {
    const b = bundle({ "D:\\repo\\node_modules\\@astryxdesign\\core\\dist\\Switch\\Switch.js": 900 });
    expect(forbiddenInFirstLoad(b, "studio").map((f) => f.id)).toEqual(["D:/repo/node_modules/@astryxdesign/core/dist/Switch/Switch.js"]);
  });

  it("fails with the site, each module grouped by the import chain that brought it in, and why", () => {
    const b = bundle({
      [`${NM}/@astryxdesign/core/dist/Switch/Switch.js`]: 900,
      [`${NM}/@stylexjs/stylex/lib/es/stylex.mjs`]: 500,
      [`${NM}/intl-messageformat/lib/index.js`]: 300,
    });
    const chainOf = (site: string, id: string) => {
      expect(site).toBe("studio");
      if (id.includes("intl-messageformat")) return null;
      return ["src/main.tsx", "src/ui/App.tsx", "src/ui/inspector/PlanInspector.tsx"];
    };
    const [message, ...rest] = checkFirstLoad(b, ["studio"], chainOf);
    expect(rest).toEqual([]);
    expect(message).toContain("studio's first load ships 3 module(s) it must not (config/firstLoad.js)");
    // the chain with the most modules leads, each module once, under the files that brought it
    expect(message).toContain(
      "through src/main.tsx > src/ui/App.tsx > src/ui/inspector/PlanInspector.tsx: 2 module(s): @astryxdesign/core/dist/Switch/Switch.js, @stylexjs/stylex/lib/es/stylex.mjs; 1 module(s): intl-messageformat/lib/index.js",
    );
    expect(message).not.toContain(NM);
    expect(message).toContain("Astryx's runtime and themes load with the deferred components that need them");
    expect(message).toContain("the ICU message formatter only Astryx's strings use");
  });

  it("names the first few modules and counts the rest", () => {
    const many = Object.fromEntries(Array.from({ length: MODULES_SHOWN + 3 }, (_, i) => [`${NM}/@astryxdesign/core/dist/m${i}.js`, 10]));
    const [message] = checkFirstLoad(bundle(many), ["studio"]);
    expect(message).toContain(`ships ${MODULES_SHOWN + 3} module(s)`);
    expect(message).toContain("and 3 more");
    expect(message).not.toContain(`m${MODULES_SHOWN}.js`);
  });
});

describe("the static import chain a forbidden module came in by", () => {
  /** A module graph: each module's static imports, and (never followed) its dynamic ones. */
  const graph: Record<string, { imports: string[]; dynamic?: string[] }> = {
    "src/main.tsx": { imports: ["src/ui/App.tsx"] },
    "src/ui/App.tsx": { imports: ["src/ui/shell/TopBar.tsx", "react"], dynamic: ["src/ui/primitives/astryx.ts"] },
    "src/ui/shell/TopBar.tsx": { imports: ["@astryxdesign/core/Tooltip"], dynamic: ["src/ui/shell/PlanMenus.tsx"] },
    // the deferred module that may import Astryx, and imports the same internals
    "src/ui/primitives/astryx.ts": { imports: ["@astryxdesign/core/theme", "@stylexjs/stylex"] },
    "src/ui/shell/PlanMenus.tsx": { imports: ["src/ui/primitives/astryx.ts"] },
    "@astryxdesign/core/theme": { imports: ["@stylexjs/stylex"] },
    "@astryxdesign/core/Tooltip": { imports: ["@astryxdesign/core/Layer", "@stylexjs/stylex"] },
    "@astryxdesign/core/Layer": { imports: ["@stylexjs/stylex"] },
  };
  const chains = staticImportChains("src/main.tsx", (id) => graph[id]?.imports ?? []);

  it("follows static imports only, so a module a deferred file also imports is traced to the first-load file", () => {
    expect(chains("@stylexjs/stylex")).toEqual(["src/main.tsx", "src/ui/App.tsx", "src/ui/shell/TopBar.tsx", "@astryxdesign/core/Tooltip", "@stylexjs/stylex"]);
    expect(chains("@astryxdesign/core/Layer")).toEqual(["src/main.tsx", "src/ui/App.tsx", "src/ui/shell/TopBar.tsx", "@astryxdesign/core/Tooltip", "@astryxdesign/core/Layer"]);
  });

  it("reaches no module only a dynamic import brings", () => {
    expect(chains("src/ui/primitives/astryx.ts")).toBeNull();
    expect(chains("@astryxdesign/core/theme")).toBeNull();
    expect(chains("src/ui/shell/PlanMenus.tsx")).toBeNull();
  });

  it("is the entry alone for the entry, and survives a cycle", () => {
    expect(chains("src/main.tsx")).toEqual(["src/main.tsx"]);
    const cyclic = staticImportChains("a", (id) => ({ a: ["b"], b: ["a", "c"] })[id] ?? []);
    expect(cyclic("c")).toEqual(["a", "b", "c"]);
  });
});
