/**
 * Astryx ships one stylesheet for every component it has (@astryxdesign/core/astryx.css), as
 * StyleX atomic classes: `.x1grt7ep{height:var(--spacing-5)}`, one declaration each, shared by
 * every component that uses it. The page imports a dozen components, so most of those rules
 * can never match. They cannot be split per component (the classes are shared), but each one
 * is named, as a string, in the code of every component that uses it, so a rule whose atomic
 * class appears in none of the bundle's code can be left out.
 *
 * The build calls `purgeAtomicCss` on each stylesheet with the atomic classes its chunks name.
 * A stylesheet the page needs before it can paint goes through `splitAtomicCss` instead, with
 * the classes the first load's own code names: the rules only lazily fetched code can use leave
 * it for a second sheet, linked when that code is fetched, so they do not hold up the first
 * paint. It keeps everything it does not understand: at-rules other than the grouping ones are kept
 * whole, and only classes outside parentheses decide (a class in `:not(...)` may be absent and
 * the rule still match). tests/purge.test.ts holds it to that.
 *
 * Plain JavaScript, like the other files here: the Vite config and the tests load it as-is.
 */

/** A StyleX atomic class name: `x` and a short base-36 hash. */
export const ATOMIC_CLASS = /\bx[a-z0-9]{4,9}\b/g;

/**
 * A custom property StyleX registers (`@property --x-paddingInline`) and code sets inline. Its
 * keyframes are named with an atomic name and `-B` (`@keyframes x1abcd-B`), so ATOMIC_CLASS
 * already finds those in code.
 */
const STYLEX_PROPERTY = /--x-[\w-]+/g;

/** The StyleX at-rules that define a name for other rules to use: `[keyword, name]`. */
const STYLEX_DEFINITION = /^@(keyframes|property)\s+(x[a-z0-9]{4,9}-B|--x-[\w-]+)$/i;

/** At-rules whose block holds rules of their own, to be filtered too. */
const GROUPING = /^@(media|supports|layer|container|scope|document|starting-style)\b/i;

/**
 * Every atomic class name, and every StyleX custom property, a piece of code mentions.
 * @param {string} code
 * @returns {Set<string>}
 */
export function atomicClassesIn(code) {
  return new Set([...(code.match(ATOMIC_CLASS) ?? []), ...(code.match(STYLEX_PROPERTY) ?? [])]);
}

/**
 * Index past the end of a quoted string that starts at `i`.
 * @param {string} css
 * @param {number} i
 */
function skipString(css, i) {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) j += css[j] === "\\" ? 2 : 1;
  return j + 1;
}

/**
 * Index of the next `{`, `;` or `}` at this nesting level, from `i`.
 * @param {string} css
 * @param {number} i
 */
function preludeEnd(css, i) {
  let depth = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "\\") i += 2;
    else if (c === '"' || c === "'") i = skipString(css, i);
    else {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return i;
      i++;
    }
  }
  return i;
}

/**
 * Index just past the `}` that closes the block opened at `open`.
 * @param {string} css
 * @param {number} open
 */
function blockEnd(css, open) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const c = css[i];
    if (c === "\\") i += 2;
    else if (c === '"' || c === "'") i = skipString(css, i);
    else {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

/**
 * The selectors of a list, split on the commas outside parentheses and brackets.
 * @param {string} list
 */
function selectorsOf(list) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") i = skipString(list, i) - 1;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/**
 * The atomic classes a selector requires: the ones outside any parentheses.
 * @param {string} selector
 */
function requiredClasses(selector) {
  let depth = 0;
  let outside = "";
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "\\") {
      if (depth === 0) outside += " ";
      i++;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0) outside += c;
  }
  return [...outside.matchAll(/\.(x[a-z0-9]{4,9})(?![\w-])/g)].map((m) => m[1]);
}

/**
 * The prefix of the sub-layers `splitAtomicCss` orders a layer's rules with: `o0`, `o1`…
 * inside the layer whose rules it splits.
 */
export const ORDER_LAYER = "o";

/**
 * What a layer's full name (`@layer b` inside `a` is `a.b`) starts with when the layer, or one
 * it sits in, has no name: a rule there can never be put in a named sub-layer.
 */
const ANONYMOUS = "\0anonymous";

/**
 * @typedef {{ segment: number, last: "now" | "later" | null, moved: boolean, nested: boolean }} LayerState
 * @typedef {{ first: Set<string>, all: Set<string>, layers: Map<string, LayerState>, order: Map<string, number> | null, declared: Set<string> }} SplitContext
 */

/** @param {SplitContext} ctx @param {string} name */
function layerState(ctx, name) {
  let state = ctx.layers.get(name);
  if (!state) ctx.layers.set(name, (state = { segment: 0, last: null, moved: false, nested: false }));
  return state;
}

/**
 * The run a rule belongs to: a layer's rules are numbered in runs, a new run starting each time
 * the rules switch between the two sheets, so the runs in source order are the sub-layers.
 * @param {LayerState} state
 * @param {"now" | "later"} sheet
 */
function segmentOf(state, sheet) {
  if (state.last !== null && state.last !== sheet) state.segment++;
  state.last = sheet;
  return state.segment;
}

/**
 * Both sheets' text for the block content between `from` and `to`, inside the layer `layer`.
 * @param {string} css
 * @param {number} from
 * @param {number} to
 * @param {string | null} layer the full name of the innermost enclosing layer, or null outside any
 * @param {SplitContext} ctx
 * @returns {{ now: string, later: string }}
 */
function splitRules(css, from, to, layer, ctx) {
  const wrapped = layer !== null && ctx.order?.has(layer) === true;
  const state = layer !== null && !layer.startsWith(ANONYMOUS) ? layerState(ctx, layer) : null;
  let now = "";
  let later = "";
  if (wrapped && !ctx.declared.has(/** @type {string} */ (layer))) {
    // the first block of the layer fixes the runs' order, before any of them is used
    ctx.declared.add(/** @type {string} */ (layer));
    const count = /** @type {number} */ (ctx.order?.get(/** @type {string} */ (layer)));
    now += `@layer ${Array.from({ length: count }, (_, n) => `${ORDER_LAYER}${n}`).join(",")};`;
  }
  // consecutive rules of one run share one sub-layer block
  const runs = { now: { text: "", segment: -1 }, later: { text: "", segment: -1 } };
  const flush = () => {
    if (runs.now.text) now += `@layer ${ORDER_LAYER}${runs.now.segment}{${runs.now.text}}`;
    if (runs.later.text) later += `@layer ${ORDER_LAYER}${runs.later.segment}{${runs.later.text}}`;
    runs.now.text = runs.later.text = "";
  };
  /** @param {"now" | "later"} sheet @param {number} segment @param {string} rule */
  const add = (sheet, segment, rule) => {
    const run = runs[sheet];
    if (run.text && run.segment !== segment) flush();
    run.segment = segment;
    run.text += rule;
  };
  let i = from;
  while (i < to) {
    const end = preludeEnd(css, i);
    if (end >= to) {
      flush();
      now += css.slice(i, to);
      break;
    }
    const prelude = css.slice(i, end);
    const head = prelude.trim();
    if (css[end] !== "{") {
      // a statement (`@layer a, b;`, `@import …;`) or a stray `}`: kept as it is
      flush();
      now += css.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const close = blockEnd(css, end);
    if (head.startsWith("@")) {
      flush();
      if (GROUPING.test(head)) {
        const isLayer = /^@layer\b/i.test(head);
        let inner = layer;
        if (isLayer) {
          const name = head.slice("@layer".length).trim();
          const parent = layer ?? "";
          inner = !name || parent.startsWith(ANONYMOUS) ? ANONYMOUS + parent + name : parent ? `${parent}.${name}` : name;
          if (state) state.nested = true;
        }
        const sheets = splitRules(css, end + 1, close - 1, inner, ctx);
        // an empty @layer block still declares the layer's place in the order
        if (sheets.now.trim() || isLayer) now += `${prelude}{${sheets.now}}`;
        if (sheets.later.trim()) later += `${prelude}{${sheets.later}}`;
      } else now += css.slice(i, close);
    } else {
      const body = css.slice(end, close);
      const selectors = selectorsOf(prelude).map((s) => ({ s, needs: requiredClasses(s) }));
      const kept = selectors.filter((x) => x.needs.every((c) => ctx.first.has(c))).map((x) => x.s);
      const deferred = selectors.filter((x) => !x.needs.every((c) => ctx.first.has(c)) && x.needs.every((c) => ctx.all.has(c))).map((x) => x.s);
      if (state && kept.length > 0) {
        const segment = segmentOf(state, "now");
        if (wrapped) add("now", segment, `${kept.join(",")}${body}`);
      }
      if (state && deferred.length > 0) {
        state.moved = true;
        const segment = segmentOf(state, "later");
        if (wrapped) add("later", segment, `${deferred.join(",")}${body}`);
      }
      if (!wrapped) {
        // outside a layer the split could reorder: every rule that can match stays in the first sheet
        const all = selectors.filter((x) => x.needs.every((c) => ctx.all.has(c))).map((x) => x.s);
        flush();
        if (all.length > 0) now += `${all.join(",")}${body}`;
      }
    }
    i = close;
  }
  flush();
  return { now, later };
}

/**
 * The stylesheet split in two: `now`, the rules the first load's code can use, and `later`, the
 * rules only code fetched afterwards can use (rules nothing can match are in neither).
 *
 * `later` is linked after `now`, so its rules would come after every rule of `now` and win
 * where they used to lose: StyleX orders its rules (a shorthand before its longhands, a base
 * style before its media queries) and the order decides. So the rules of each layer that has
 * any rule moved are numbered in runs, in source order, and each run becomes a sub-layer of
 * that layer (`o0`, `o1`…), declared in `now` in that order before any is used. A
 * rule then ranks by its run, whichever sheet it arrived in, exactly as it did by its place.
 * Rules outside any layer, or in a layer that has layers of its own, are never moved: no
 * sub-layer could keep their order.
 *
 * @param {string} css
 * @param {Set<string>} first the atomic classes the first load's code names
 * @param {Set<string>} all the atomic classes any code names (a superset of `first`)
 * @returns {{ now: string, later: string }}
 */
export function splitAtomicCss(css, first, all) {
  /** @type {SplitContext} */
  const survey = { first, all, layers: new Map(), order: null, declared: new Set() };
  splitRules(css, 0, css.length, null, survey);
  const order = new Map();
  for (const [name, state] of survey.layers) if (state.moved && !state.nested) order.set(name, state.segment + 1);
  const sheets = splitRules(css, 0, css.length, null, { first, all, layers: new Map(), order, declared: new Set() });
  // only the split moves definitions: with nothing moved, the sheet is left as it was
  if (!sheets.later) return sheets;
  const definitions = takeUnusedDefinitions(sheets.now, first);
  return { now: definitions.kept, later: sheets.later + definitions.taken };
}

/**
 * How many times `name` appears in `css` as a whole name (not inside a longer one).
 * @param {string} css
 * @param {string} name
 */
function occurrences(css, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (css.match(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g")) ?? []).length;
}

/**
 * The StyleX keyframes and registered properties no rule of `css` uses and the first load's
 * code does not name, taken out of it (kept inside the grouping rules around them) for the
 * second sheet: only lazily fetched code can use them. A definition is used when its name
 * appears in `css` anywhere but in itself. Repeated until none is left, since taking one
 * (keyframes that read a property) can leave another unused.
 *
 * @param {string} css
 * @param {Set<string>} first
 * @returns {{ kept: string, taken: string }}
 */
function takeUnusedDefinitions(css, first) {
  let kept = css;
  let taken = "";
  for (;;) {
    const whole = kept;
    /** @param {string} name @param {string} rule */
    const unused = (name, rule) => !first.has(name) && !first.has(name.replace(/-B$/, "")) && occurrences(whole, name) <= occurrences(rule, name);
    const pass = takeDefinitions(whole, 0, whole.length, unused);
    if (!pass.taken) return { kept, taken };
    kept = pass.kept;
    taken += pass.taken;
  }
}

/**
 * One pass of `takeUnusedDefinitions` over the block content between `from` and `to`.
 * @param {string} css
 * @param {number} from
 * @param {number} to
 * @param {(name: string, rule: string) => boolean} take
 * @returns {{ kept: string, taken: string }}
 */
function takeDefinitions(css, from, to, take) {
  let kept = "";
  let taken = "";
  let i = from;
  while (i < to) {
    const end = preludeEnd(css, i);
    if (end >= to || css[end] !== "{") {
      const stop = Math.min(end + 1, to);
      kept += css.slice(i, stop);
      i = stop;
      continue;
    }
    const close = blockEnd(css, end);
    const prelude = css.slice(i, end);
    const head = prelude.trim();
    const definition = head.match(STYLEX_DEFINITION);
    if (definition && take(definition[2], css.slice(i, close))) taken += css.slice(i, close);
    else if (GROUPING.test(head)) {
      const inner = takeDefinitions(css, end + 1, close - 1, take);
      // a layer's block stays even when emptied: it still declares the layer's place in the order
      if (inner.kept.trim() || /^@layer\b/i.test(head)) kept += `${prelude}{${inner.kept}}`;
      if (inner.taken) taken += `${prelude}{${inner.taken}}`;
    } else kept += css.slice(i, close);
    i = close;
  }
  return { kept, taken };
}

/**
 * The stylesheet without the rules no element can match: each selector that needs an atomic
 * class `used` does not have is dropped, and a rule left with none goes.
 * @param {string} css
 * @param {Set<string>} used
 * @returns {string}
 */
export function purgeAtomicCss(css, used) {
  return splitAtomicCss(css, used, used).now;
}
