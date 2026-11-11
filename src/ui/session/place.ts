/**
 * Placing a session marker without a style attribute: its position (and its colour) are custom
 * properties set through the element's CSSOM, as the 3D view's room names are (three/labels.ts),
 * which the strict CSP allows; the stylesheet turns them into a transform, eased unless the
 * person asks for less motion (session.css).
 */

import { useLayoutEffect, useRef } from "react";

/** A ref whose element stands at (`x`, `y`) pixels, in `colour` when one is given. */
export function usePlaced<T extends HTMLElement | SVGElement>(x: number, y: number, colour?: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ss-x", `${x}px`);
    el.style.setProperty("--ss-y", `${y}px`);
    if (colour) el.style.setProperty("--ss-colour", colour);
  }, [x, y, colour]);
  return ref;
}
