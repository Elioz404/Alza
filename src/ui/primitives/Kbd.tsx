/**
 * A keyboard shortcut chip, in the page's own notation: one chip per key, glyphs for the keys a
 * keyboard marks with one (modifiers, Enter, the arrows), words for the few it spells out (Esc,
 * Del, Space), capitals for a letter. The chips are drawn with exactly Astryx's key declarations
 * (`.kbd__key` in primitives.css; tests/theme.test.ts holds the two equal), and the whole
 * shortcut has one spoken name ("Control + Z").
 *
 *   <Kbd keys="mod+z" />   <Kbd keys="del" />   <Kbd keys="shift+1" />   <Kbd keys="+" />
 *
 * "mod" is Command on Apple platforms and Control elsewhere.
 */

import type { HTMLAttributes, Ref } from "react";

export interface KbdProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  ref?: Ref<HTMLSpanElement>;
  /** the shortcut: keys joined with "+" ("mod+z", "shift+/", "+") */
  keys: string;
}

/** Names the page writes for one key under another spelling. */
const ALIAS: Readonly<Record<string, string>> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  esc: "escape",
  return: "enter",
  delete: "del",
  " ": "space",
  "+": "plus",
  "=": "plus",
};

/** What each named key shows on its chip, and what it is called aloud. */
const KEY: Readonly<Record<string, { chip: string; spoken: string }>> = {
  ctrl: { chip: "⌃", spoken: "Control" },
  alt: { chip: "⌥", spoken: "Alt" },
  shift: { chip: "⇧", spoken: "Shift" },
  enter: { chip: "↵", spoken: "Enter" },
  backspace: { chip: "⌫", spoken: "Backspace" },
  tab: { chip: "⇥", spoken: "Tab" },
  up: { chip: "↑", spoken: "Up arrow" },
  down: { chip: "↓", spoken: "Down arrow" },
  left: { chip: "←", spoken: "Left arrow" },
  right: { chip: "→", spoken: "Right arrow" },
  plus: { chip: "+", spoken: "Plus" },
  escape: { chip: "Esc", spoken: "Escape" },
  // word keys: written as a person reads them on a keyboard, never in capitals
  del: { chip: "Del", spoken: "Del" },
  space: { chip: "Space", spoken: "Space" },
  home: { chip: "Home", spoken: "Home" },
  end: { chip: "End", spoken: "End" },
  pageup: { chip: "PgUp", spoken: "Page Up" },
  pagedown: { chip: "PgDn", spoken: "Page Down" },
};

/** The platform's modifier: Command where the keyboard has one, Control elsewhere. */
function modKey(): { chip: string; spoken: string } {
  return isApplePlatform() ? { chip: "⌘", spoken: "Command" } : { chip: "Ctrl", spoken: "Control" };
}

/** Whether the page runs on an Apple platform, where the shortcut modifier is Command. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const named = uaData?.platform?.trim() ?? "";
  if (named !== "" && named.toLowerCase() !== "unknown") return /mac/i.test(named);
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
}

/** Split "shift++" or "+" into its keys: a "+" on its own, or at the end, is the plus key. */
export function keysOf(keys: string): string[] {
  if (keys === "+") return ["plus"];
  const trailingPlus = keys.endsWith("++");
  const parts = (trailingPlus ? keys.slice(0, -2) : keys).split("+").map((k) => k.trim().toLowerCase());
  return (trailingPlus ? [...parts, "+"] : parts).map((k) => ALIAS[k] ?? k);
}

/** One key's chip and spoken name. */
function keyFace(key: string): { chip: string; spoken: string } {
  if (key === "mod") return modKey();
  return KEY[key] ?? { chip: key.toUpperCase(), spoken: key.toUpperCase() };
}

export function Kbd({ ref, keys, className, ...rest }: KbdProps) {
  const faces = keysOf(keys).map(keyFace);
  return (
    <span
      {...rest}
      ref={ref}
      role="img"
      aria-label={faces.map((f) => f.spoken).join(" + ")}
      className={`kbd${className ? ` ${className}` : ""}`}
    >
      {faces.map((f, i) => (
        <kbd key={i} aria-hidden="true" className="kbd__key">
          {f.chip}
        </kbd>
      ))}
    </span>
  );
}
