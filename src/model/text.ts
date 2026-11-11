/**
 * Text the plan holds, made fit to be written somewhere else as a name: an exported model's
 * labels, a downloaded file's name. Names in a plan come from the person, from an agent and
 * from the partner's catalogue, so they may carry anything a string can. What leaves the page
 * as a name carries none of it.
 */

import { TEXT } from "./limits";

/**
 * Control characters (a line break, a tab, a NUL) and the line and paragraph separators: each
 * stood between two words, so it becomes a space.
 */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/**
 * Format characters: bidirectional embeddings, overrides and isolates (which reorder what a
 * reader sees, the trick behind a name that shows as something else), zero-width spaces and
 * joiners, the byte-order mark. None of them is a visible character, so each goes.
 */
const INVISIBLE = /\p{Cf}/gu;

/**
 * `text` as a name: control characters and separators become spaces, invisible formatting
 * characters go, runs of space become one, and it is cut to `max` characters (code points).
 */
export function cleanText(text: string, max: number = TEXT.label): string {
  const flat = text.replace(BREAKS, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("");
}
