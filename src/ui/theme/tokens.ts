/**
 * The design tokens: every colour, size, type step, radius, shadow, duration and layer the page
 * is drawn with, written once.
 *
 * The names are Astryx's (@astryxdesign/core) wherever Astryx has the role, so the stylesheet
 * built from this module overrides the stone theme in place and every Astryx component picks
 * the values up; roles Astryx has no name for are Alza's own (`--plan-*`, `--color-agent*`,
 * `--size-*`, `--z-*`, `--scene-*`).
 *
 * Two consumers read the same values:
 *  - the stylesheet: vite.config.ts renders `renderTokenCss()` into `virtual:alza-tokens.css`
 *    at build time (a static file, so the strict CSP holds), inside `@layer alza-tokens`;
 *  - script: the 2D editor and the 3D builders cannot use `var(--…)` in a WebGL material or an
 *    SVG presentation attribute, so they read `PLAN_HEX`, `FLOOR_FILL` and `MATERIAL` here.
 *
 * Nothing here touches the DOM; the Vite config loads it under Node.
 */

import { oklch, srgb, type Swatch } from "./color";
import type { FloorFinish } from "../../model/limits";

// ============================================================================ chrome palette
// Cool graphite stone (hue 255). The chrome steps back so the warm sheet leads.

const chrome = {
  body: oklch(95.6, 0.004, 255),
  surface: oklch(98.6, 0.002, 255),
  muted: oklch(94.2, 0.005, 255),
  card: oklch(99.4, 0.0015, 255),
  border: oklch(89, 0.006, 255),
  borderEmphasized: oklch(60, 0.01, 255),
  textPrimary: oklch(24, 0.012, 255),
  textSecondary: oklch(46, 0.012, 255),
  textDisabled: oklch(60, 0.01, 255),
} as const;

/** Human, primary action, selection and focus: drafting cobalt. */
const accent = {
  base: oklch(50, 0.17, 262),
  hover: oklch(44.5, 0.16, 262),
  muted: oklch(94.6, 0.026, 262),
  text: oklch(47, 0.16, 262),
  on: oklch(99.2, 0.004, 262),
} as const;

/** The agent: verdigris. A semantic role, never decoration. */
const agent = {
  base: oklch(51.5, 0.09, 192),
  muted: oklch(95.6, 0.02, 192),
  text: oklch(45, 0.08, 192),
} as const;

const status = {
  error: oklch(51, 0.175, 27),
  errorHover: oklch(46, 0.165, 27),
  errorMuted: oklch(95.8, 0.018, 27),
  errorText: oklch(48, 0.165, 27),
  onError: oklch(99.2, 0.004, 262),
  warning: oklch(70, 0.14, 72),
  warningMuted: oklch(96.4, 0.03, 85),
  warningText: oklch(48, 0.1, 65),
  success: oklch(52, 0.115, 150),
  successText: oklch(46, 0.1, 150),
} as const;

// ============================================================================ the sheet
// The drawing is the only warm thing on screen.

const sheet = {
  paper: oklch(97.7, 0.007, 85),
  gridMajor: oklch(91, 0.01, 85),
  gridMinor: oklch(94.6, 0.008, 85),
  ink: oklch(25, 0.012, 255),
  line: oklch(38, 0.012, 255),
  lineSoft: oklch(62, 0.01, 255),
  dim: oklch(42, 0.012, 255),
  furniture: oklch(99, 0.004, 85),
  floorOak: oklch(93.6, 0.024, 78),
  floorOakGrain: oklch(88.5, 0.03, 74),
  floorCarpet: oklch(94.2, 0.016, 145),
  floorTile: oklch(95.4, 0.006, 230),
  floorTileJoint: oklch(88, 0.009, 230),
  floorConcrete: oklch(92.6, 0.003, 85),
  agentHatch: oklch(80, 0.05, 192),
  destructiveHatch: oklch(80, 0.07, 27),
} as const;

/** The 3D view's air: what the far side of the model fades into, and its loading state. */
const scene = {
  backdrop: srgb("#24282c"),
  ink: oklch(94, 0.006, 85),
} as const;

// ============================================================================ dark rendering
// A designed second sheet (graphite ground, light linework), not an inversion. The page runs
// light; these are Studio's dark values, kept so the switch is a mode change, not a redesign.

const dark = {
  body: oklch(17, 0.01, 255),
  surface: oklch(20.5, 0.01, 255),
  muted: oklch(24, 0.011, 255),
  card: oklch(23.5, 0.01, 255),
  border: oklch(30, 0.011, 255),
  borderEmphasized: oklch(55, 0.012, 255),
  textPrimary: oklch(94, 0.006, 255),
  textSecondary: oklch(74, 0.01, 255),
  accent: oklch(68, 0.14, 262),
  accentHover: oklch(73, 0.13, 262),
  accentText: oklch(74, 0.12, 262),
  accentMuted: oklch(30, 0.05, 262),
  onAccent: oklch(17, 0.01, 262),
  agent: oklch(72, 0.085, 192),
  agentText: oklch(78, 0.075, 192),
  agentMuted: oklch(28, 0.03, 192),
  error: oklch(68, 0.15, 27),
  errorText: oklch(74, 0.13, 27),
  errorMuted: oklch(28, 0.05, 27),
  paper: oklch(21.5, 0.008, 255),
  gridMajor: oklch(28.5, 0.01, 255),
  gridMinor: oklch(24.5, 0.009, 255),
  ink: oklch(91, 0.008, 85),
  line: oklch(84, 0.008, 85),
  lineSoft: oklch(60, 0.008, 85),
  dim: oklch(76, 0.01, 85),
  furniture: oklch(25, 0.008, 255),
  floorOak: oklch(27, 0.02, 70),
  floorCarpet: oklch(26, 0.015, 145),
  floorTile: oklch(26, 0.01, 230),
  ringLow: oklch(30, 0.011, 255),
  ringMed: oklch(34, 0.011, 255),
  ringHigh: oklch(38, 0.011, 255),
} as const;

// ============================================================================ type

export const FONT = Object.freeze({
  /** UI: a workhorse sans, self-hosted (src/ui/theme/fonts.css). */
  body: '"IBM Plex Sans", "Segoe UI Variable Text", "Segoe UI", -apple-system, "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** The drawing's lettering and every measurement: DIN lineage, always tabular. */
  drawing: '"Barlow Semi Condensed", Bahnschrift, "DIN Alternate", "DIN 2014", "Roboto Condensed", "Arial Narrow", sans-serif',
  /** Tool names, ids and JSON only. */
  code: '"IBM Plex Mono", "Cascadia Mono", Consolas, ui-monospace, "SF Mono", Menlo, monospace',
});

/** A fixed rem scale (about 1.2 between the steps that carry hierarchy). */
export const FONT_SIZE = Object.freeze({
  /** 11px: kbd chips and counts only */
  xs: "0.6875rem",
  /** 12px: labels, meta, hints */
  sm: "0.75rem",
  /** 13px: controls, rows, body */
  base: "0.8125rem",
  /** 14px: number inputs (drawing face), empty-state body */
  md: "0.875rem",
  /** 16px: panel and entity titles */
  lg: "1rem",
  /** 21px: empty-state titles */
  xl: "1.3125rem",
});

/** Two weights and no more: 400 and 600 are the only faces loaded. */
export const FONT_WEIGHT = Object.freeze({ regular: 400, semibold: 600 });

export const LEADING = Object.freeze({ body: 1.5, label: 1.35, tight: 1.25 });

// ============================================================================ space, shape, depth

/** Astryx's spacing scale (--spacing-1 = 4px), restated so script and the docs see one table. */
export const SPACING = Object.freeze({
  "0": "0rem",
  "0-5": "0.125rem",
  "1": "0.25rem",
  "1-5": "0.375rem",
  "2": "0.5rem",
  "3": "0.75rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "8": "2rem",
  "10": "2.5rem",
  "12": "3rem",
});

export const RADIUS = Object.freeze({
  none: "0px",
  /** kbd, handles, tooltips */
  inner: "4px",
  /** buttons, inputs, tiles */
  element: "6px",
  /** floating cards, the zoom group, the hint bar, dialogs */
  container: "10px",
  page: "10px",
  /** live status dots, count badges, the switch */
  full: "999px",
});

const shadowInk = (alpha: number) => `oklch(22% 0.02 255 / ${alpha})`;

/** One soft, hue-tinted shadow family, only on things that float over the sheet. */
export const SHADOW = Object.freeze({
  low: `0 1px 2px ${shadowInk(0.08)}`,
  med: `0 0 0 1px ${shadowInk(0.08)}, 0 6px 16px -4px ${shadowInk(0.16)}`,
  high: `0 0 0 1px ${shadowInk(0.08)}, 0 12px 24px -8px ${shadowInk(0.22)}`,
});

// ============================================================================ motion
// State only. Colour and opacity changes stay under reduced motion; movement goes.

export const MOTION = Object.freeze({
  /** press, colour */
  fastMs: 120,
  /** tooltip, menu, drawer, cloud fade-in */
  mediumMs: 220,
  /** the plan/3D cross-fade */
  slowMs: 420,
  exitMs: 150,
  /** how long a pointer rests on a control before its tooltip shows (focus shows it at once) */
  tooltipDelayMs: 800,
  /** how long an undo offer stays on screen */
  undoOfferMs: 8000,
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeIn: "cubic-bezier(0.7, 0, 0.84, 0)",
  /** how far a pressed control drops */
  pressOffset: "1px",
});

// ============================================================================ sizes and layers

export const SIZE = Object.freeze({
  /** every control's height; 44px under a coarse pointer */
  control: "32px",
  controlSm: "28px",
  controlCoarse: "44px",
  /** the tool rail's buttons; 48px under a coarse pointer */
  railButton: "40px",
  railButtonCoarse: "48px",
  topbar: "48px",
  rail: "52px",
  panel: "336px",
  /** the Activity section's height when open */
  activity: "300px",
  /** the side panel as a bottom sheet, at phone width */
  sheet: "70dvh",
  /** the key column of the shortcut sheet */
  keyColumn: "11rem",
  tab: "44px",
  /** the smallest box a finger is asked to hit */
  hit: "44px",
  icon: "18px",
  iconSm: "16px",
  iconXs: "14px",
  iconLg: "20px",
  kbd: "18px",
  /** the raised lower edge of a key chip, as Astryx's Kbd draws it */
  kbdEdge: "2px",
  dot: "8px",
  /** the ring of a status dot that is off */
  dotStroke: "1.5px",
  /** separators inside toolbars */
  divider: "20px",
  /** the plan's scale bar, its bar and its figures (rem, so it grows with the type) */
  scalebar: "1.5rem",
  /** the longest a line of help text runs */
  measure: "46ch",
  /** a hairline */
  hairline: "1px",
  /** the focus ring */
  focusRing: "2px",
  /** the stroke every icon is drawn with */
  iconStroke: "1.5",
});

export const OPACITY = Object.freeze({
  /** a control that cannot act, together with cursor and aria-disabled, never alone */
  disabled: 0.55,
  /** secondary text inside an inverted surface (a tooltip's second line) */
  quiet: 0.8,
});

export const Z = Object.freeze({ raised: 10, dropdown: 100, sticky: 200, drawer: 300, toast: 500, tooltip: 600 });

/**
 * Layout breakpoints, in rem. CSS cannot read a custom property inside a media query, so the
 * stylesheets write these numbers literally (tests/theme.test.ts holds them to this table) and
 * script reads them through `mediaQuery()`.
 */
export const BREAKPOINT = Object.freeze({
  /** at or under this width the side panel becomes a drawer over the canvas (1024px) */
  drawer: 64,
  /** at or under this width the layout is one column: canvas plus a bottom sheet (640px) */
  phone: 40,
});

/** The media query for "at or under this breakpoint". */
export const mediaQuery = (bp: keyof typeof BREAKPOINT): string => `(max-width: ${BREAKPOINT[bp]}rem)`;

// ============================================================================ script consumers

/** The plan drawing's colours as hex, for SVG attributes and the 2D editor. Light sheet. */
export const PLAN_HEX = Object.freeze({
  paper: sheet.paper.hex,
  gridMajor: sheet.gridMajor.hex,
  gridMinor: sheet.gridMinor.hex,
  /** poché walls */
  ink: sheet.ink.hex,
  /** furniture linework */
  line: sheet.line.hex,
  /** swings, detail */
  lineSoft: sheet.lineSoft.hex,
  /** dimension chains and their text */
  dim: sheet.dim.hex,
  furniture: sheet.furniture.hex,
  /** room names */
  label: chrome.textPrimary.hex,
  /** areas, secondary lettering */
  labelSoft: chrome.textSecondary.hex,
  selection: accent.base.hex,
  selectionMuted: accent.muted.hex,
  /** a wall or room being drawn */
  preview: accent.base.hex,
  agent: agent.base.hex,
  agentMuted: agent.muted.hex,
  agentHatch: sheet.agentHatch.hex,
  /** a destructive request's target */
  destructive: status.error.hex,
  destructiveMuted: status.errorMuted.hex,
  destructiveHatch: sheet.destructiveHatch.hex,
  doorLeaf: sheet.ink.hex,
  doorSwing: sheet.lineSoft.hex,
  windowFrame: sheet.ink.hex,
  windowGlass: sheet.ink.hex,
  oakGrain: sheet.floorOakGrain.hex,
  tileJoint: sheet.floorTileJoint.hex,
});

/** Room fill per floor finish on the plan. */
export const FLOOR_FILL: Readonly<Record<FloorFinish, string>> = Object.freeze({
  oak: sheet.floorOak.hex,
  tile: sheet.floorTile.hex,
  carpet: sheet.floorCarpet.hex,
  concrete: sheet.floorConcrete.hex,
});

/**
 * The 3D view's surfaces: the albedo each material is created with. The plan's 2D tints above
 * are a drawing; these are the built thing, so they are their own table.
 */
export const MATERIAL = Object.freeze({
  wall: srgb("#f2ede4"),
  wallTop: srgb("#d9d2c5"),
  glass: srgb("#bcd8e8"),
  frame: srgb("#6b5d4f"),
  doorLeaf: srgb("#e5ddd0"),
  doorPanel: srgb("#d8cfc0"),
  skirting: srgb("#fbf8f2"),
  handle: srgb("#b9a26a"),
  sill: srgb("#efeae0"),
  curtain: srgb("#ded5c6"),
  lampShade: srgb("#fdf6e6"),
  lampGlow: srgb("#ffe9bd"),
  pendantLight: srgb("#ffe0ae"),
  cable: srgb("#3a3733"),
  ground: srgb("#565b52"),
  /** a textured floor's base colour is the texture itself */
  untinted: srgb("#ffffff"),
  floor: Object.freeze({
    oak: srgb("#c39a67"),
    tile: srgb("#dcd6cb"),
    carpet: srgb("#a9b39e"),
    concrete: srgb("#a5a5a0"),
  } satisfies Record<FloorFinish, Swatch>),
  /** the procedural floor textures' detail */
  oakSeam: srgb("#5a3f24", 0.32),
  oakGrain: srgb("#78583a", 0.16),
  tileGrout: srgb("#c0bab0"),
  backdrop: scene.backdrop,
});

// ============================================================================ the stylesheet

const ref = (name: string) => `var(${name})`;
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
  ...Object.fromEntries(Object.entries(SPACING).map(([k, v]) => [`--spacing-${k}`, v])),
  // shape and depth
  ...Object.fromEntries(Object.entries(RADIUS).map(([k, v]) => [`--radius-${k}`, v])),
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
  ...Object.fromEntries(Object.entries(Z).map(([k, v]) => [`--z-${k}`, v])),
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
    "/* Rendered from src/ui/theme/tokens.ts by vite.config.ts. Edit the module, not this. */",
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
