/**
 * The root every Astryx component needs above it: the built stone theme (whose `__built` flag
 * keeps Astryx from writing a <style> at run time, which the CSP would refuse) and the layer
 * provider that toasts and anchored layers hang from.
 *
 * The page runs light. Its tokens (tokens.ts) override the stone theme's from the stylesheet;
 * the theme object here only names the theme and carries its icon registry.
 */

import type { ReactNode } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { stoneTheme } from "@astryxdesign/theme-stone/built";

export const THEME_NAME = stoneTheme.name;

export function ThemeRoot({ children }: { children: ReactNode }) {
  return (
    <Theme theme={stoneTheme} mode="light">
      <LayerProvider>{children}</LayerProvider>
    </Theme>
  );
}
