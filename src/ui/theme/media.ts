/**
 * The layout breakpoints and motion preference, read from script. The values come from
 * tokens.ts; this file only listens to them, since the token module itself never touches the DOM.
 */

import { useSyncExternalStore } from "react";
import { MOTION, mediaQuery, type BREAKPOINT } from "./tokens";

const query = (q: string): MediaQueryList | null => (typeof matchMedia === "function" ? matchMedia(q) : null);

/** Whether a media query matches now, kept current as the window changes. */
export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = query(q);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => query(q)?.matches ?? false,
    () => false,
  );
}

/** Whether the window is at or under a layout breakpoint (BREAKPOINT in tokens.ts). */
export const useBreakpoint = (bp: keyof typeof BREAKPOINT): boolean => useMediaQuery(mediaQuery(bp));

/** True when the person asked the system for less motion; script-driven movement checks it. */
export const prefersReducedMotion = (): boolean => query("(prefers-reduced-motion: reduce)")?.matches ?? false;

/** A movement's duration in ms: zero under reduced motion (colour and opacity changes keep theirs). */
export const moveMs = (ms: number = MOTION.mediumMs): number => (prefersReducedMotion() ? 0 : ms);
