/**
 * Astryx ships one stylesheet for every component it has (@astryxdesign/core/astryx.css), as
 * StyleX atomic classes: `.x1grt7ep{height:var(--spacing-5)}`, one declaration each, shared by
 * every component that uses it. The page imports a dozen components, so most of those rules
 * can never match. They cannot be split per component (the classes are shared), but each one
 * is named, as a string, in the code of every component that uses it, so a rule whose atomic
 * class appears in none of the bundle's code can be left out.
 *
 * The build calls `purgeAtomicCss` on each stylesheet with the atomic classes its chunks name.
 * It keeps everything it does not understand: at-rules other than the grouping ones are kept
 * whole, and only classes outside parentheses decide (a class in `:not(...)` may be absent and
 * the rule still match). tests/purge.test.ts holds it to that.
 *
 * Plain JavaScript, like the other files here: the Vite config and the tests load it as-is.
 */

/** A StyleX atomic class name: `x` and a short base-36 hash. */
export const ATOMIC_CLASS = /\bx[a-z0-9]{4,9}\b/g;

/** At-rules whose block holds rules of their own, to be filtered too. */
const GROUPING = /^@(media|supports|layer|container|scope|document|starting-style)\b/i;

/**
 * Every atomic class name a piece of code mentions.
 * @param {string} code
 * @returns {Set<string>}
 */
export function atomicClassesIn(code) {
  return new Set(code.match(ATOMIC_CLASS) ?? []);
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
 * The stylesheet without the rules no element can match: each selector that needs an atomic
 * class `used` does not have is dropped, and a rule left with none goes.
 * @param {string} css
 * @param {Set<string>} used
 * @returns {string}
 */
export function purgeAtomicCss(css, used) {
  /** @param {number} from @param {number} to */
  const rules = (from, to) => {
    let out = "";
    let i = from;
    while (i < to) {
      const end = preludeEnd(css, i);
      if (end >= to) {
        out += css.slice(i, to);
        break;
      }
      const prelude = css.slice(i, end);
      const head = prelude.trim();
      if (css[end] !== "{") {
        // a statement (`@layer a, b;`, `@import …;`) or a stray `}`: kept as it is
        out += css.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      const close = blockEnd(css, end);
      if (head.startsWith("@")) {
        if (GROUPING.test(head)) {
          const inner = rules(end + 1, close - 1);
          // an empty @layer block still declares the layer's place in the order
          if (inner.trim() || /^@layer\b/i.test(head)) out += `${prelude}{${inner}}`;
        } else out += css.slice(i, close);
      } else {
        const kept = selectorsOf(prelude).filter((s) => requiredClasses(s).every((c) => used.has(c)));
        if (kept.length > 0) out += `${kept.join(",")}${css.slice(end, close)}`;
      }
      i = close;
    }
    return out;
  };
  return rules(0, css.length);
}
