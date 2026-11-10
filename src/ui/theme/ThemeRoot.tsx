/**
 * The root the page is drawn under: the element the theme's scoped rules and the tokens'
 * selectors reach (`[data-astryx-theme]`), in the page's colour mode. It draws nothing itself
 * (display: contents, in theme.css) and needs no script: `<html>` carries the same two
 * attributes from index.html, so layers drawn outside the app's tree (tooltips, menus, toasts)
 * are themed the same way.
 *
 * Astryx's own runtime is not needed for any of this, so none of it is on the first load. The
 * Astryx components that open later (dialogs, menus, popovers, toasts, number inputs) find the
 * theme by name on `<html>` and its registration in src/ui/primitives/astryx.ts, which arrives
 * with them.
 */

import type { ReactNode } from "react";
import { THEME } from "./tokens";

export const THEME_NAME = THEME.name;

export function ThemeRoot({ children }: { children: ReactNode }) {
  return (
    <div className="theme-root" data-astryx-theme={THEME.name} data-theme={THEME.mode}>
      {children}
    </div>
  );
}
