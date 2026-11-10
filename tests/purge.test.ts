/**
 * The build leaves out the Astryx rules no chunk can use (config/purgeAtomicCss.js). It may
 * only drop what can never match: a rule whose atomic class no code names. Everything it does
 * not understand stays.
 */
import { describe, expect, it } from "vitest";
import { atomicClassesIn, purgeAtomicCss, splitAtomicCss } from "../config/purgeAtomicCss.js";

const used = atomicClassesIn('const s = { a: "x1grt7ep", b: "x3nfvp2 xl56j7k" };');

describe("the atomic purge", () => {
  it("reads the class names a chunk mentions", () => {
    expect([...used].sort()).toEqual(["x1grt7ep", "x3nfvp2", "xl56j7k"]);
  });

  it("drops a rule whose atomic class nothing names, and keeps the ones named", () => {
    const css = ".x1grt7ep:not(#\\#){height:1px}.xdeadbe1:not(#\\#){height:2px}.page{color:red}";
    expect(purgeAtomicCss(css, used)).toBe(".x1grt7ep:not(#\\#){height:1px}.page{color:red}");
  });

  it("keeps the selectors of a list that can match, and drops the rest", () => {
    expect(purgeAtomicCss(".x3nfvp2:hover,.xgone12:hover{opacity:1}", used)).toBe(".x3nfvp2:hover{opacity:1}");
  });

  it("decides only by classes outside parentheses", () => {
    const css = ".x3nfvp2:not(.xgone12){display:flex}:where(.xgone12) .x3nfvp2{gap:0}";
    expect(purgeAtomicCss(css, used)).toBe(css);
  });

  it("filters inside @media and @layer, drops an emptied @media, keeps an emptied @layer", () => {
    const css = "@layer a,b;@layer a{.xgone12{top:0}}@media (min-width:1px){.xgone12{top:0}}@media print{.xl56j7k{top:0}}";
    expect(purgeAtomicCss(css, used)).toBe("@layer a,b;@layer a{}@media print{.xl56j7k{top:0}}");
  });

  it("keeps other at-rules whole, braces in strings included", () => {
    const css = '@keyframes spin{from{rotate:0}to{rotate:1turn}}@font-face{font-family:"a{b}"}.xgone12::after{content:"}"}';
    expect(purgeAtomicCss(css, used)).toBe('@keyframes spin{from{rotate:0}to{rotate:1turn}}@font-face{font-family:"a{b}"}');
  });
});

describe("the first-load split", () => {
  const first = new Set(["xaaaa01", "xbbbb02"]);
  const all = new Set([...first, "xlate03", "xlate04"]);

  it("leaves a sheet alone when nothing in it is used only later", () => {
    const css = "@layer a{.xaaaa01{top:0}.xbbbb02{left:0}}.page{color:red}";
    expect(splitAtomicCss(css, first, all)).toEqual({ now: css, later: "" });
  });

  it("moves the rules only later code can use, and keeps their order with numbered sub-layers", () => {
    // a shorthand the later code needs, between two rules of the first load
    const css = "@layer a,b;@layer a{.xaaaa01{padding:0}.xlate03{padding:1px}.xlate04{margin:0}.xbbbb02{padding-top:2px}.xgone12{top:0}}";
    const { now, later } = splitAtomicCss(css, first, all);
    expect(now).toBe("@layer a,b;@layer a{@layer o0,o1,o2;@layer o0{.xaaaa01{padding:0}}@layer o2{.xbbbb02{padding-top:2px}}}");
    expect(later).toBe("@layer a{@layer o1{.xlate03{padding:1px}.xlate04{margin:0}}}");
  });

  it("splits a selector list and a media block between the sheets", () => {
    const css = "@layer a{@media (min-width:1px){.xaaaa01,.xlate03{top:0}}}";
    const { now, later } = splitAtomicCss(css, first, all);
    expect(now).toBe("@layer a{@layer o0,o1;@media (min-width:1px){@layer o0{.xaaaa01{top:0}}}}");
    expect(later).toBe("@layer a{@media (min-width:1px){@layer o1{.xlate03{top:0}}}}");
  });

  it("numbers one layer's runs across all of its blocks", () => {
    const css = "@layer a{.xlate03{top:0}}.page{color:red}@layer a{.xaaaa01{top:1px}.xlate04{top:2px}}";
    const { now, later } = splitAtomicCss(css, first, all);
    expect(now).toBe("@layer a{@layer o0,o1,o2;}.page{color:red}@layer a{@layer o1{.xaaaa01{top:1px}}}");
    expect(later).toBe("@layer a{@layer o0{.xlate03{top:0}}}@layer a{@layer o2{.xlate04{top:2px}}}");
  });

  it("never moves a rule outside a layer, or in a layer with layers of its own", () => {
    const css = ".xlate03{top:0}@layer a{.xlate04{top:0}@layer b{.xaaaa01{top:0}}}@layer{.xlate03{left:0}}";
    expect(splitAtomicCss(css, first, all)).toEqual({ now: css, later: "" });
  });

  it("moves the StyleX keyframes and properties only the later rules use, and keeps the rest", () => {
    const css =
      "@layer a{" +
      "@property --x-gap{syntax:'*';inherits:false}" +
      "@property --x-only-later{syntax:'*';inherits:false}" +
      "@property --x-in-code{syntax:'*';inherits:false}" +
      "@property --x-via-frames{syntax:'*';inherits:false}" +
      "@keyframes xspin1-B{to{rotate:1turn}}" +
      "@keyframes xfade2-B{to{opacity:var(--x-via-frames)}}" +
      "@keyframes xnamed3-B{to{opacity:0}}" +
      "@keyframes tip-enter{from{opacity:0}}" +
      ".xaaaa01{gap:var(--x-gap);animation-name:xspin1-B}" +
      ".xlate03{padding:var(--x-only-later);animation-name:xfade2-B}" +
      "}";
    // the first load's code sets one property inline and names one keyframes itself
    const firstNames = new Set([...first, "--x-in-code", "xnamed3"]);
    const { now, later } = splitAtomicCss(css, firstNames, new Set([...firstNames, ...all]));
    // used by a rule of the first sheet, named by its code, or not StyleX's: they stay
    for (const kept of ["@property --x-gap{", "@property --x-in-code{", "@keyframes xspin1-B{", "@keyframes xnamed3-B{", "@keyframes tip-enter{"]) {
      expect(now).toContain(kept);
      expect(later).not.toContain(kept);
    }
    // used only by the moved rule, or only by keyframes that moved: they go with it, in their layer
    for (const moved of ["@property --x-only-later{", "@keyframes xfade2-B{", "@property --x-via-frames{"]) {
      expect(now).not.toContain(moved);
      expect(later).toContain(moved);
    }
    expect(later.startsWith("@layer a{")).toBe(true);
    expect(later).toContain(".xlate03{padding:var(--x-only-later);animation-name:xfade2-B}");
  });

  it("leaves the definitions alone when nothing moves", () => {
    const css = "@layer a{@property --x-unused{syntax:'*';inherits:false}@keyframes xspin1-B{to{rotate:1turn}}.xaaaa01{top:0}}";
    expect(splitAtomicCss(css, first, all)).toEqual({ now: css, later: "" });
  });

  it("reads the StyleX properties a chunk sets, with the atomic classes", () => {
    expect([...atomicClassesIn('el.style.setProperty("--x-paddingInline", v); const c = "xaaaa01";')].sort()).toEqual(["--x-paddingInline", "xaaaa01"]);
  });

  it("is the purge when the first load uses everything there is", () => {
    const css = "@layer a{.xaaaa01{top:0}.xlate03{top:1px}.xgone12{top:2px}}";
    expect(splitAtomicCss(css, all, all)).toEqual({ now: purgeAtomicCss(css, all), later: "" });
    expect(purgeAtomicCss(css, all)).toBe("@layer a{.xaaaa01{top:0}.xlate03{top:1px}}");
  });
});
