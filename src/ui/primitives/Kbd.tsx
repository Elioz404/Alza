/**
 * A keyboard shortcut chip. Astryx's Kbd draws the keys it knows (modifiers, Enter, Esc, the
 * arrows) and writes any other name in capitals, which turns "delete" into DELETE. This wrapper
 * takes the page's own notation, maps the names Astryx knows under another spelling ("arrowup",
 * "+"), and draws the few word keys (Del, Space) itself in the same chip.
 *
 *   <Kbd keys="mod+z" />   <Kbd keys="del" />   <Kbd keys="shift+1" />   <Kbd keys="+" />
 */

import type { ComponentProps } from "react";
import { Kbd as AstryxKbd } from "@astryxdesign/core/Kbd";

export type KbdProps = ComponentProps<typeof AstryxKbd>;

/** Names the page writes, as Astryx spells them. */
const ALIAS: Readonly<Record<string, string>> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  "+": "plus",
  "=": "plus",
};

/** Keys Astryx has no glyph or word for, written as a person reads them on a keyboard. */
const WORD: Readonly<Record<string, string>> = {
  del: "Del",
  delete: "Del",
  space: "Space",
  " ": "Space",
  home: "Home",
  end: "End",
};

/** Split "shift++" or "+" into its keys: a "+" on its own, or at the end, is the plus key. */
function partsOf(keys: string): string[] {
  if (keys === "+") return ["+"];
  const trailingPlus = keys.endsWith("++");
  const parts = (trailingPlus ? keys.slice(0, -2) : keys).split("+").map((k) => k.trim().toLowerCase());
  return trailingPlus ? [...parts, "+"] : parts;
}

export function Kbd({ keys, className, ...rest }: KbdProps) {
  const parts = partsOf(keys).map((k) => ALIAS[k] ?? k);
  if (!parts.some((k) => WORD[k])) return <AstryxKbd keys={parts.join("+")} className={className} {...rest} />;
  // a word key: draw the chips here, one per key, with one spoken name for the whole shortcut
  const spoken = parts.map((k) => WORD[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join(" + ");
  return (
    <span {...rest} role="img" aria-label={spoken} className={`kbd${className ? ` ${className}` : ""}`}>
      {parts.map((k, i) =>
        WORD[k] ? (
          <kbd key={`${k}:${i}`} aria-hidden="true" className="kbd__word">
            {WORD[k]}
          </kbd>
        ) : (
          <AstryxKbd key={`${k}:${i}`} keys={k} aria-hidden="true" />
        ),
      )}
    </span>
  );
}
