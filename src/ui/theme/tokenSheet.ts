/**
 * The design tokens laid out as the stylesheet's custom properties (LIGHT_TOKENS, DARK_TOKENS),
 * and `renderTokenCss()`, which vite.config.ts renders into `virtual:alza-tokens.css` at build
 * time. The values are tokens.ts's; this module only names them. Nothing in the page imports it:
 * the page reads the stylesheet, so these tables never reach the bundle.
 */

import type { Swatch } from "./color";
import { FONT, FONT_SIZE, FONT_WEIGHT, LEADING, MOTION, OPACITY, PALETTE, RADIUS, SHADOW, SIZE, SPACING, Z } from "./tokens";

const { chrome, accent, agent, status, sheet, scene, dark } = PALETTE;


const ref = (name: string) => `var(${name})`;

/**
 * A scale as custom properties: `{ 1: '4px' }` under `--spacing` is `{ '--spacing-1': '4px' }`.
 * Free of side effects for the bundler, like oklch(), so the sheets below, which only the build
 * and the tests read, are left out of the page's bundle.
 */
/* @__NO_SIDE_EFFECTS__ */
function scaleVars(prefix: string, scale: Readonly<Record<string, TokenValue>>): Record<string, TokenValue> {
  return Object.fromEntries(Object.entries(scale).map(([k, v]) => [`${prefix}-${k}`, v]));
}
type TokenValue = Swatch | string | number;
type TokenSheet = Readonly<Record<string, TokenValue>>;

/** Every token, light. Astryx names first, then Alza's own roles. */
export const LIGHT_TOKENS: TokenSheet = Object.freeze({
  // chrome
  "--color-background-body": chrome.body,
  "--color-background-surface": chrome.surface,
  "--color-background-muted": chrome.muted,
  "--color-background-card": chrome.card,
  "--color-background-popover": ref("--color-background-card"),
  "--color-background-inverted": chrome.textPrimary,
  "--color-border": chrome.border,
  "--color-border-emphasized": chrome.borderEmphasized,
  "--color-text-primary": chrome.textPrimary,
  "--color-text-secondary": chrome.textSecondary,
  "--color-text-disabled": chrome.textDisabled,
  "--color-icon-primary": ref("--color-text-primary"),
  "--color-icon-secondary": chrome.textSecondary,
  "--color-icon-disabled": chrome.textDisabled,
  "--color-on-dark": chrome.surface,
  // accent: human, primary action, selection, focus
  "--color-accent": accent.base,
  "--color-accent-hover": accent.hover,
  "--color-accent-muted": accent.muted,
  "--color-text-accent": accent.text,
  "--color-icon-accent": accent.text,
  "--color-on-accent": accent.on,
  "--color-focus": accent.base,
  "--color-info": ref("--color-accent"),
  "--color-info-muted": ref("--color-accent-muted"),
  "--color-text-info": ref("--color-text-accent"),
  "--color-icon-info": ref("--color-text-accent"),
  "--focus-outline-color": ref("--color-focus"),
  "--focus-outline-width": ref("--size-focus-ring"),
  "--focus-outline-offset": "2px",
  /** how far an underline sits below a link's text */
  "--link-underline-offset": "0.2em",
  // agent
  "--color-agent": agent.base,
  "--color-agent-muted": agent.muted,
  "--color-text-agent": agent.text,
  // status
  "--color-error": status.error,
  "--color-error-hover": status.errorHover,
  "--color-error-muted": status.errorMuted,
  "--color-text-error": status.errorText,
  "--color-icon-error": status.errorText,
  "--color-border-error": status.error,
  "--color-on-error": status.onError,
  "--color-warning": status.warning,
  "--color-warning-muted": status.warningMuted,
  "--color-text-warning": status.warningText,
  "--color-icon-warning": status.warningText,
  "--color-success": status.success,
  "--color-text-success": status.successText,
  "--color-icon-success": status.success,
  // the sheet
  "--plan-paper": sheet.paper,
  "--plan-grid-major": sheet.gridMajor,
  "--plan-grid-minor": sheet.gridMinor,
  "--plan-ink": sheet.ink,
  "--plan-line": sheet.line,
  "--plan-line-soft": sheet.lineSoft,
  "--plan-dim": sheet.dim,
  "--plan-furniture": sheet.furniture,
  "--plan-floor-oak": sheet.floorOak,
  "--plan-floor-oak-grain": sheet.floorOakGrain,
  "--plan-floor-carpet": sheet.floorCarpet,
  "--plan-floor-tile": sheet.floorTile,
  "--plan-floor-tile-joint": sheet.floorTileJoint,
  "--plan-floor-concrete": sheet.floorConcrete,
  "--plan-label": ref("--color-text-primary"),
  "--plan-label-soft": ref("--color-text-secondary"),
  "--plan-door-leaf": ref("--plan-ink"),
  "--plan-door-swing": ref("--plan-line-soft"),
  "--plan-window-frame": ref("--plan-ink"),
  "--plan-window-glass": ref("--plan-ink"),
  "--plan-selection": ref("--color-accent"),
  "--plan-selection-muted": ref("--color-accent-muted"),
  "--plan-preview": ref("--color-accent"),
  "--plan-agent": ref("--color-agent"),
  "--plan-agent-muted": ref("--color-agent-muted"),
  "--plan-agent-hatch": sheet.agentHatch,
  "--plan-destructive": ref("--color-error"),
  "--plan-destructive-muted": ref("--color-error-muted"),
  "--plan-destructive-hatch": sheet.destructiveHatch,
  // pens: the drawing is one SVG unit per screen pixel, so these keep their weight at every
  // zoom. Hairline for extension lines, fine for grid and detail, firm for outlines.
  "--pen-hair": "calc(var(--size-hairline) * 0.75)",
  "--pen-fine": ref("--size-hairline"),
  "--pen-medium": "calc(var(--size-hairline) * 1.25)",
  "--pen-firm": "calc(var(--size-icon-stroke) * var(--size-hairline))",
  "--pen-bold": "calc(var(--size-hairline) * 2.5)",
  "--pen-halo": ref("--spacing-1"),
  // dash patterns, in pen units
  "--dash-preview": "6 4",
  "--dash-ghost": "4 3",
  "--dash-rug": "2 3",
  // the 3D view
  "--scene-backdrop": scene.backdrop,
  "--scene-ink": scene.ink,
  /** secondary text on the 3D backdrop */
  "--scene-ink-soft": "color-mix(in oklab, var(--scene-ink) 72%, transparent)",
  /** a loading skeleton's fill on the 3D backdrop */
  "--scene-skeleton": "color-mix(in oklab, var(--scene-ink) 9%, transparent)",
  // type
  "--font-family-body": FONT.body,
  "--font-family-heading": ref("--font-family-body"),
  "--font-family-drawing": FONT.drawing,
  "--font-family-code": FONT.code,
  "--font-size-xs": FONT_SIZE.xs,
  "--font-size-sm": FONT_SIZE.sm,
  "--font-size-base": FONT_SIZE.base,
  "--font-size-md": FONT_SIZE.md,
  "--font-size-lg": FONT_SIZE.lg,
  "--font-size-xl": FONT_SIZE.xl,
  "--font-weight-regular": FONT_WEIGHT.regular,
  "--font-weight-normal": FONT_WEIGHT.regular,
  "--font-weight-medium": FONT_WEIGHT.semibold,
  "--font-weight-semibold": FONT_WEIGHT.semibold,
  "--font-weight-bold": FONT_WEIGHT.semibold,
  "--text-body-size": ref("--font-size-base"),
  "--text-body-weight": ref("--font-weight-regular"),
  "--text-body-leading": LEADING.body,
  "--text-label-size": ref("--font-size-sm"),
  "--text-label-weight": ref("--font-weight-regular"),
  "--text-label-leading": LEADING.label,
  "--text-supporting-size": ref("--font-size-sm"),
  "--text-supporting-leading": LEADING.label,
  "--text-code-size": ref("--font-size-sm"),
  "--text-tight-leading": LEADING.tight,
  // space
  ...scaleVars("--spacing", SPACING),
  // shape and depth
  ...scaleVars("--radius", RADIUS),
  "--shadow-low": SHADOW.low,
  "--shadow-med": SHADOW.med,
  "--shadow-high": SHADOW.high,
  // motion
  "--duration-fast": `${MOTION.fastMs}ms`,
  "--duration-medium": `${MOTION.mediumMs}ms`,
  "--duration-slow": `${MOTION.slowMs}ms`,
  "--duration-exit": `${MOTION.exitMs}ms`,
  /** movement (a drawer sliding in); zero under reduced motion, unlike colour changes */
  "--duration-move": ref("--duration-medium"),
  /** a loading skeleton's pulse; switched off under reduced motion where it is used */
  "--duration-pulse": "calc(var(--duration-slow) * 3)",
  "--ease-out": MOTION.easeOut,
  "--ease-in": MOTION.easeIn,
  "--ease-standard": ref("--ease-out"),
  "--press-offset": MOTION.pressOffset,
  // sizes
  "--size-control": SIZE.control,
  "--size-control-sm": SIZE.controlSm,
  "--size-rail-button": SIZE.railButton,
  "--size-topbar": SIZE.topbar,
  "--size-rail": SIZE.rail,
  "--size-panel": SIZE.panel,
  "--size-activity": SIZE.activity,
  "--size-sheet": SIZE.sheet,
  "--size-key-column": SIZE.keyColumn,
  "--size-tab": SIZE.tab,
  "--size-hit": SIZE.hit,
  "--size-icon": SIZE.icon,
  "--size-icon-sm": SIZE.iconSm,
  "--size-icon-xs": SIZE.iconXs,
  "--size-icon-lg": SIZE.iconLg,
  "--size-kbd": SIZE.kbd,
  "--size-kbd-edge": SIZE.kbdEdge,
  "--size-dot": SIZE.dot,
  "--size-dot-stroke": SIZE.dotStroke,
  "--size-divider": SIZE.divider,
  "--size-scalebar": SIZE.scalebar,
  "--size-measure": SIZE.measure,
  "--size-hairline": SIZE.hairline,
  "--size-focus-ring": SIZE.focusRing,
  "--size-icon-stroke": SIZE.iconStroke,
  /** a request card floating beside its target on the plan */
  "--size-request-card": "calc(var(--size-activity) - var(--spacing-8))",
  /** the partner's own page, embedded in the Library */
  "--size-partner-frame": ref("--size-activity"),
  /** a catalogue picture tile: a little wider than tall, like the thumbnails */
  "--ratio-thumb": "4 / 3",
  "--opacity-disabled": OPACITY.disabled,
  "--opacity-quiet": OPACITY.quiet,
  // layers
  ...scaleVars("--z", Z),
});

/** Studio's dark values; everything else keeps its light value or follows Astryx's light-dark(). */
export const DARK_TOKENS: TokenSheet = Object.freeze({
  "--color-background-body": dark.body,
  "--color-background-surface": dark.surface,
  "--color-background-muted": dark.muted,
  "--color-background-card": dark.card,
  "--color-border": dark.border,
  "--color-border-emphasized": dark.borderEmphasized,
  "--color-text-primary": dark.textPrimary,
  "--color-text-secondary": dark.textSecondary,
  "--color-icon-secondary": dark.textSecondary,
  "--color-on-dark": dark.body,
  "--color-accent": dark.accent,
  "--color-accent-hover": dark.accentHover,
  "--color-text-accent": dark.accentText,
  "--color-icon-accent": dark.accentText,
  "--color-accent-muted": dark.accentMuted,
  "--color-on-accent": dark.onAccent,
  "--color-focus": dark.accent,
  "--color-agent": dark.agent,
  "--color-text-agent": dark.agentText,
  "--color-agent-muted": dark.agentMuted,
  "--color-error": dark.error,
  "--color-text-error": dark.errorText,
  "--color-error-muted": dark.errorMuted,
  "--plan-paper": dark.paper,
  "--plan-grid-major": dark.gridMajor,
  "--plan-grid-minor": dark.gridMinor,
  "--plan-ink": dark.ink,
  "--plan-line": dark.line,
  "--plan-line-soft": dark.lineSoft,
  "--plan-dim": dark.dim,
  "--plan-furniture": dark.furniture,
  "--plan-floor-oak": dark.floorOak,
  "--plan-floor-carpet": dark.floorCarpet,
  "--plan-floor-tile": dark.floorTile,
  "--shadow-low": `inset 0 0 0 1px ${dark.ringLow.css}`,
  "--shadow-med": `inset 0 0 0 1px ${dark.ringMed.css}`,
  "--shadow-high": `inset 0 0 0 1px ${dark.ringHigh.css}`,
});

const declarations = (sheetTokens: TokenSheet, indent: string) =>
  Object.entries(sheetTokens)
    .map(([name, value]) => `${indent}${name}: ${typeof value === "object" ? value.css : String(value)};`)
    .join("\n");

/**
 * The tokens as a static stylesheet. The selectors reach both `<html>` and the wrapper Astryx's
 * Theme renders, since the stone theme declares its own values on every
 * `[data-astryx-theme]` element; `@layer alza-tokens` sits above `astryx-theme`, so ours win.
 */
export function renderTokenCss(): string {
  return [
    "/* Rendered from src/ui/theme/tokens.ts (tokenSheet.ts) by vite.config.ts. Edit the module, not this. */",
    "@layer alza-tokens {",
    "  :root,",
    "  [data-astryx-theme] {",
    "    color-scheme: light;",
    declarations(LIGHT_TOKENS, "    "),
    "  }",
    '  :root[data-theme="dark"],',
    '  [data-astryx-theme][data-theme="dark"] {',
    "    color-scheme: dark;",
    declarations(DARK_TOKENS, "    "),
    "  }",
    "  @media (pointer: coarse) {",
    "    :root,",
    "    [data-astryx-theme] {",
    `      --size-control: ${SIZE.controlCoarse};`,
    `      --size-rail-button: ${SIZE.railButtonCoarse};`,
    "    }",
    "  }",
    "  @media (prefers-reduced-motion: reduce) {",
    "    :root,",
    "    [data-astryx-theme] {",
    "      --duration-move: 0ms;",
    "      --press-offset: 0px;",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}
