/**
 * The theme, loaded once by the entry point (src/main.tsx), before any component stylesheet:
 * theme.css declares the cascade's layer order, so it must be the first CSS on the page.
 *
 * - virtual:alza-tokens.css is rendered from tokens.ts at build time (vite.config.ts).
 *
 * The two stylesheets that stand in for what Astryx's runtime would write (its anchored layers'
 * slide rules, its gesture host's touch-action rules) arrive with that runtime, after the first
 * paint: src/ui/primitives/astryx.ts imports them.
 */
import "./theme.css";
import "virtual:alza-tokens.css";

export { ThemeRoot, THEME_NAME } from "./ThemeRoot";
