/**
 * The theme, loaded once by the entry point (src/main.tsx), before any component stylesheet:
 * theme.css declares the cascade's layer order, so it must be the first CSS on the page.
 *
 * - virtual:alza-tokens.css is rendered from tokens.ts at build time (vite.config.ts).
 * - virtual:astryx-slide-rules.css is the stylesheet Astryx's anchored layers would otherwise
 *   inject as a <style> at run time, which the CSP refuses. It is built from the installed
 *   Astryx, so it can never drift from it; index.html carries the marker element that tells
 *   Astryx it is already on the page.
 * - virtual:astryx-touch-action.css holds the touch-action rules Astryx's gesture host would
 *   write at run time (a <style>, where an engine has no constructable sheets); the build swaps
 *   its writer for one that only marks the element (config/astryxTouchAction.js).
 */
import "./theme.css";
import "virtual:alza-tokens.css";
import "virtual:astryx-slide-rules.css";
import "virtual:astryx-touch-action.css";

export { ThemeRoot, THEME_NAME } from "./ThemeRoot";
