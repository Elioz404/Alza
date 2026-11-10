/**
 * The design tokens are written once (src/ui/theme/tokens.ts) and read twice: as a stylesheet
 * and as hex by the 2D editor and the 3D builders. These hold the two readings to each other,
 * the palette to its contrast targets, the stylesheets to the tokens, and the CSP workaround
 * for Astryx's anchored layers to the installed Astryx.
 */
import { describe, expect, it } from "vitest";
import { contrast, oklch, oklchToHex, srgb } from "../src/ui/theme/color";
import { BREAKPOINT, FLOOR_FILL, MATERIAL, PLAN_HEX, THEME, mediaQuery } from "../src/ui/theme/tokens";
import { DARK_TOKENS, LIGHT_TOKENS, renderTokenCss } from "../src/ui/theme/tokenSheet";
import { FLOOR_FINISHES } from "../src/model/limits";
import indexHtml from "../index.html?raw";
import slideRulesSource from "../node_modules/@astryxdesign/core/dist/Layer/layerSlideRules.js?raw";
import kbdSource from "../node_modules/@astryxdesign/core/dist/Kbd/Kbd.js?raw";
import astryxCss from "../node_modules/@astryxdesign/core/dist/astryx.css?raw";
import touchActionRuleInstalled from "../node_modules/@astryxdesign/core/dist/gestures/touchActionRule.js?raw";
import touchActionInstalled from "../node_modules/@astryxdesign/core/dist/gestures/touchAction.js?raw";
import {
  TOUCH_ACTION_ATTRIBUTE,
  TOUCH_ACTION_LAYER,
  touchActionCss,
  touchActionRuleSource,
  touchActionValues,
} from "../config/astryxTouchAction.js";

/** Every stylesheet and module under src/, as text, keyed by its path from the repo root. */
const STYLESHEETS = import.meta.glob<string>("../src/**/*.css", { query: "?raw", import: "default", eager: true });
const MODULES = import.meta.glob<string>("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const read = (path: string): string => {
  const text = STYLESHEETS[`../${path}`];
  if (text === undefined) throw new Error(`no stylesheet ${path}`);
  return text;
};
const css = (name: string) => {
  const value = LIGHT_TOKENS[name];
  if (value === undefined) throw new Error(`no token ${name}`);
  return value;
};
const hexOf = (name: string): string => {
  const v = css(name);
  if (typeof v !== "object") throw new Error(`${name} is not a colour`);
  return v.hex;
};

/** Channels within one step of each other: the hex Studio measured, the hex we compute. */
const near = (a: string, b: string) =>
  [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1);

describe("OKLCH to hex", () => {
  it.each([
    [97.7, 0.007, 85, "#faf7f2"],
    [50, 0.17, 262, "#285cc2"],
    [51.5, 0.09, 192, "#007775"],
    [25, 0.012, 255, "#1e2227"],
    [51, 0.175, 27, "#b52b28"],
    [46, 0.012, 255, "#54585f"],
  ])("oklch(%s%% %s %s) is %s", (l, c, h, hex) => {
    expect(near(oklchToHex({ l, c, h }), hex)).toBe(true);
  });

  it("keeps the CSS value and the hex of one swatch together", () => {
    const s = oklch(97.7, 0.007, 85, 0.5);
    expect(s.css).toBe("oklch(97.7% 0.007 85 / 0.5)");
    expect(s.alpha).toBe(0.5);
    expect(srgb("#5A3F24", 0.32).css).toBe("rgb(90 63 36 / 0.32)");
    expect(() => srgb("red")).toThrow();
  });
});

describe("the palette meets its contrast targets", () => {
  it.each([
    ["--color-text-primary", "--color-background-surface", 4.5],
    ["--color-text-secondary", "--color-background-surface", 4.5],
    ["--color-text-secondary", "--color-background-muted", 4.5],
    ["--color-text-secondary", "--color-background-body", 4.5],
    ["--color-text-accent", "--color-accent-muted", 4.5],
    ["--color-on-accent", "--color-accent", 4.5],
    ["--color-text-agent", "--color-agent-muted", 4.5],
    ["--color-text-error", "--color-error-muted", 4.5],
    ["--color-on-error", "--color-error", 4.5],
    ["--color-text-warning", "--color-warning-muted", 4.5],
    // the warning glyph is ink: a non-text cue at 3:1 wherever the policy line is drawn
    ["--color-icon-warning", "--color-background-surface", 3],
    ["--color-icon-warning", "--color-background-body", 3],
    ["--color-icon-warning", "--color-background-muted", 3],
    ["--color-border-emphasized", "--color-background-surface", 3],
    ["--color-accent", "--plan-paper", 4.5],
    ["--color-agent", "--plan-paper", 4.5],
    ["--plan-dim", "--plan-paper", 4.5],
  ])("%s on %s is at least %s:1", (fg, bg, min) => {
    expect(contrast(hexOf(fg), hexOf(bg))).toBeGreaterThanOrEqual(min);
  });

  it.each(FLOOR_FINISHES.map((f) => [f]))("room labels read on %s", (finish) => {
    expect(contrast(PLAN_HEX.label, FLOOR_FILL[finish])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PLAN_HEX.labelSoft, FLOOR_FILL[finish])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("script reads the same values as the stylesheet", () => {
  it("the plan's hex table is the tokens' hex", () => {
    expect(PLAN_HEX.paper).toBe(hexOf("--plan-paper"));
    expect(PLAN_HEX.ink).toBe(hexOf("--plan-ink"));
    expect(PLAN_HEX.selection).toBe(hexOf("--color-accent"));
    expect(PLAN_HEX.agent).toBe(hexOf("--color-agent"));
    expect(PLAN_HEX.destructive).toBe(hexOf("--color-error"));
    expect(FLOOR_FILL.oak).toBe(hexOf("--plan-floor-oak"));
    expect(FLOOR_FILL.concrete).toBe(hexOf("--plan-floor-concrete"));
    expect(MATERIAL.backdrop.hex).toBe(hexOf("--scene-backdrop"));
  });

  it("every floor finish has a plan fill and a 3D albedo", () => {
    for (const f of FLOOR_FINISHES) {
      expect(FLOOR_FILL[f]).toMatch(/^#[0-9a-f]{6}$/);
      expect(MATERIAL.floor[f].hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the token stylesheet", () => {
  const sheet = renderTokenCss();

  it("declares every token inside the alza-tokens layer", () => {
    expect(sheet.startsWith("/*")).toBe(true);
    expect(sheet).toContain("@layer alza-tokens {");
    for (const name of Object.keys(LIGHT_TOKENS)) expect(sheet).toContain(`${name}: `);
  });

  it("only re-values in dark what light declares", () => {
    for (const name of Object.keys(DARK_TOKENS)) expect(LIGHT_TOKENS).toHaveProperty([name]);
  });

  it("refers only to tokens that exist", () => {
    const declared = new Set([...Object.keys(LIGHT_TOKENS), "--size-control", "--size-rail-button"]);
    const astryxOwn = /^--(color|font|text|spacing|radius|shadow|duration|ease|focus)-/;
    const refs = [...sheet.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    for (const r of refs) expect(declared.has(r) || astryxOwn.test(r)).toBe(true);
  });

  it("drops movement, not colour, under reduced motion", () => {
    const reduced = sheet.slice(sheet.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("--duration-move: 0ms");
    expect(reduced).not.toContain("--duration-fast");
  });
});

describe("the stylesheets use the tokens", () => {
  // every stylesheet under src/, so a new surface's file is held to the same rules
  const sources = Object.keys(STYLESHEETS).map((k) => k.replace(/^\.\.\//, ""));

  it("finds the surfaces' stylesheets", () => {
    for (const path of ["src/ui/shell/shell.css", "src/ui/primitives/primitives.css", "src/three/overlays/overlays.css", "src/ui/canvas/canvas.css"]) {
      expect(sources).toContain(path);
    }
  });

  it.each(sources.map((s) => [s]))("%s has no literal colour", (path) => {
    const text = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
  });

  it.each(sources.map((s) => [s]))("%s puts every rule in an Alza layer", (path) => {
    const text = read(path).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const top = text.replace(/@import[^;]+;/g, "").replace(/@layer [^{;]+;/g, "").trim();
    // what is left is one or more `@layer alza-… { … }` blocks
    expect(top === "" || /^@layer alza-[a-z-]+\s*\{/.test(top)).toBe(true);
  });

  it("no transition names `all`", () => {
    for (const path of sources) expect(read(path)).not.toMatch(/transition:\s*all\b/);
  });

  it("media queries break only at the token breakpoints", () => {
    const allowed = new Set(Object.values(BREAKPOINT).map((rem) => `${rem}rem`));
    for (const path of sources) {
      for (const m of read(path).matchAll(/@media[^{]*max-width:\s*([0-9.]+[a-z]+)/g)) expect(allowed.has(m[1])).toBe(true);
    }
    expect(mediaQuery("drawer")).toBe("(max-width: 64rem)");
  });
});

describe("Astryx under the CSP", () => {
  it("the page carries the element that keeps Astryx from injecting its slide rules", () => {
    const id = /SLIDE_RULES_ID = '([^']+)'/.exec(slideRulesSource)?.[1];
    expect(id).toBe("astryx-layer-slide-rules");
    expect(indexHtml).toContain(`id="${id}"`);
    expect(slideRulesSource).toMatch(/if \(doc\.getElementById\(SLIDE_RULES_ID\)\)\s*\{\s*return;/);
  });

  it("the theme is a built one, so Astryx writes no <style> for it", async () => {
    const { stoneTheme } = await import("@astryxdesign/theme-stone/built");
    expect((stoneTheme as { __built?: boolean }).__built).toBe(true);
  });

  it("the page names the theme it ships, in its mode, where Astryx's deferred components look for it", async () => {
    const { stoneTheme } = await import("@astryxdesign/theme-stone/built");
    expect(THEME.name).toBe(stoneTheme.name);
    expect(indexHtml).toMatch(new RegExp(`<html[^>]* data-astryx-theme="${THEME.name}"`));
    expect(indexHtml).toMatch(new RegExp(`<html[^>]* data-theme="${THEME.mode}"`));
  });

  it("only deferred code imports Astryx: the primitives' index and the theme root are free of it", () => {
    const astryx = /from "@astryxdesign\//;
    for (const path of ["../src/ui/primitives/index.ts", "../src/ui/theme/index.ts", "../src/ui/theme/ThemeRoot.tsx", "../src/main.tsx", "../src/ui/App.tsx"]) {
      expect(MODULES[path]).toBeDefined();
      expect(MODULES[path]).not.toMatch(astryx);
    }
    const importers = Object.entries(MODULES)
      .filter(([, text]) => astryx.test(text))
      .map(([path]) => path);
    expect(importers).toEqual(["../src/ui/primitives/astryx.ts"]);
  });

  it("nothing imports a component that injects styles at run time, or the barrel", () => {
    expect(Object.keys(MODULES).length).toBeGreaterThan(50);
    for (const text of Object.values(MODULES)) {
      expect(text).not.toMatch(/from "@astryxdesign\/core"/);
      expect(text).not.toMatch(/@astryxdesign\/core\/(DateInput|CodeBlock|Chat)\b/);
    }
  });
});

/** A stylesheet's declarations for one plain selector, as property: value. */
function declarationsOf(sheet: string, selector: string): Record<string, string> {
  const at = sheet.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  const body = sheet.slice(sheet.indexOf("{", at) + 1, sheet.indexOf("}", at));
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}

describe("shortcut chips are one chip", () => {
  // Astryx's key, resolved from its atomic classes in the installed stylesheet
  const keyClasses = /_jsx\("kbd",[\s\S]*?className: "([^"]+)"/.exec(kbdSource)?.[1].split(" ") ?? [];
  const astryxKey: Record<string, string> = {};
  for (const cls of keyClasses) {
    const m = new RegExp(String.raw`\.${cls}(?::not\(#\\#\))*\{([a-z-]+):([^}]+)\}`).exec(astryxCss);
    if (m) astryxKey[m[1]] = m[2];
  }
  const chip = declarationsOf(read("src/ui/primitives/primitives.css"), ".kbd__key");

  it("finds Astryx's key", () => {
    expect(keyClasses.length).toBeGreaterThan(10);
    expect(astryxKey.height).toBeDefined();
  });

  it.each(["height", "min-width", "padding-inline", "border-radius", "background-color", "color", "font-family", "font-size", "font-weight", "line-height"])(
    "every key chip takes Astryx's %s",
    (property) => {
      expect(chip[property]).toBe(astryxKey[property]);
    },
  );

  it("and its raised lower edge", () => {
    const [width, style, color] = chip["border-bottom"].split(/\s+/);
    expect(LIGHT_TOKENS[width.slice(4, -1)]).toBe(astryxKey["border-bottom-width"]);
    expect(style).toBe(astryxKey["border-bottom-style"]);
    expect(color).toBe(astryxKey["border-bottom-color"]);
  });
});

describe("Astryx's touch-action rules ship static", () => {
  it("as the installed writer would write them, in its layer", () => {
    expect(touchActionRuleInstalled).toContain(`TOUCH_ACTION_ATTRIBUTE = '${TOUCH_ACTION_ATTRIBUTE}'`);
    expect(touchActionRuleInstalled).toContain(`RULE_LAYER = '${TOUCH_ACTION_LAYER}'`);
    expect(touchActionRuleInstalled).toContain(":where([${TOUCH_ACTION_ATTRIBUTE}=\"${value}\"]){touch-action:${value}}");
    const sheet = touchActionCss();
    expect(sheet).toContain(`@layer ${TOUCH_ACTION_LAYER} {`);
    for (const v of ["manipulation", "none", "pan-x", "pan-y", "pan-x pinch-zoom", "pan-y pinch-zoom", "pinch-zoom"]) {
      expect(sheet).toContain(`:where([${TOUCH_ACTION_ATTRIBUTE}="${v}"]){touch-action:${v}}`);
    }
  });

  it("for every value the installed host can derive", () => {
    // deriveTouchAction returns these two words, or pan-x, pan-y and pinch-zoom in that order
    expect(touchActionInstalled).toContain("return 'manipulation';");
    expect(touchActionInstalled).toContain("return tokens.length === 0 ? 'none' : tokens.join(' ');");
    const pushed = [...touchActionInstalled.matchAll(/tokens\.push\('([a-z-]+)'\)/g)].map((m) => m[1]);
    expect(pushed).toEqual(["pan-x", "pan-y", "pinch-zoom"]);
    expect(new Set(touchActionValues()).size).toBe(touchActionValues().length);
  });

  it("and the writer that replaces Astryx's exports what the host imports, and writes no style", () => {
    const source = touchActionRuleSource();
    for (const name of ["TOUCH_ACTION_ATTRIBUTE", "markTouchAction", "unmarkTouchAction"]) expect(source).toContain(`export ${name === "TOUCH_ACTION_ATTRIBUTE" ? "const" : "function"} ${name}`);
    expect(source).not.toMatch(/createElement|CSSStyleSheet|adoptedStyleSheets/);
  });
});
