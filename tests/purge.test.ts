/**
 * The build leaves out the Astryx rules no chunk can use (config/purgeAtomicCss.js). It may
 * only drop what can never match: a rule whose atomic class no code names. Everything it does
 * not understand stays.
 */
import { describe, expect, it } from "vitest";
import { atomicClassesIn, purgeAtomicCss } from "../config/purgeAtomicCss.js";

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
