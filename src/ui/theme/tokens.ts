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
 *  - the stylesheet: tokenSheet.ts lays every token out as a custom property, and vite.config.ts
 *    renders its `renderTokenCss()` into `virtual:alza-tokens.css` at build time (a static file,
 *    so the strict CSP holds), inside `@layer alza-tokens`. The sheet is a module of its own so
 *    that its tables, which only the build and the tests read, stay out of the page's bundle;
 *  - script: the 2D editor and the 3D builders cannot use `var(--…)` in a WebGL material or an
 *    SVG presentation attribute, so they read `PLAN_HEX` and `FLOOR_FILL` here (and the 3D view
 *    its `MATERIAL` table in sceneTokens.ts).
 *
 * Nothing here touches the DOM; the Vite config loads it under Node.
 */

import { oklch } from "./color";
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
  /** an open space's hatch (a carport, a porch: no walls close it off), lighter than any floor's linework */
  openHatch: oklch(84, 0.006, 85),
  agentHatch: oklch(80, 0.05, 192),
  destructiveHatch: oklch(80, 0.07, 27),
  /**
   * The level below, drawn under the one being worked on to line things up with: told apart
   * from live linework by its cooler hue, finer pen and dash-dot pattern, not by fading it —
   * it stays at the 3:1 a line that carries information needs on the paper.
   */
  ghost: oklch(63, 0.03, 220),
  /**
   * The other tabs of the shared session, in hues of their own, kept apart from the person's
   * accent, the agent's verdigris and the error red. A tab's cursor and its name are drawn in
   * it on the paper, so each holds the 4.5:1 of text there.
   */
  tabs: [oklch(55, 0.15, 300), oklch(54, 0.13, 65), oklch(52, 0.15, 340), oklch(53, 0.12, 140)],
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
  openHatch: oklch(33, 0.008, 85),
  ghost: oklch(56, 0.03, 220),
  /** the session's tabs, lightened to hold 4.5:1 on the graphite paper as the light ones do on theirs */
  tabs: [oklch(73, 0.13, 300), oklch(75, 0.12, 65), oklch(73, 0.14, 340), oklch(74, 0.12, 140)],
  ringLow: oklch(30, 0.011, 255),
  ringMed: oklch(34, 0.011, 255),
  ringHigh: oklch(38, 0.011, 255),
} as const;

/** The palettes, for the stylesheet's tables (tokenSheet.ts); script reads the tables below. */
export const PALETTE = Object.freeze({ chrome, accent, agent, status, sheet, dark });

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

/**
 * The browsers' default root font size, which the px in the comments above assume. Script turns
 * rem into px with the page's own root size, and with this one only when the page cannot say
 * (no layout yet, as in a test DOM).
 */
export const ROOT_FONT_PX = 16;

/**
 * A tooltip's gap from its control and the room it keeps from the viewport's edges, as SPACING
 * steps: the stylesheet reads them as --tooltip-offset and --tooltip-gutter, the script that
 * places the tooltip (Tip.tsx) through spacingPx.
 */
export const TOOLTIP = Object.freeze({ offset: "1", gutter: "4" } as const satisfies Record<string, keyof typeof SPACING>);

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
  /**
   * How long a tooltip waits after the pointer leaves its control before it hides: long enough
   * to cross the gap onto the tooltip itself, which keeps it open (WCAG 1.4.13, hoverable).
   */
  tooltipBridgeMs: 100,
  /** how long an undo offer stays on screen */
  undoOfferMs: 8000,
  /**
   * After the first paint the rest of the studio's code is fetched once the browser is idle
   * (src/ui/deferred.tsx); on a page that never idles, at the latest this long after.
   */
  prefetchTimeoutMs: 2000,
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeIn: "cubic-bezier(0.7, 0, 0.84, 0)",
  /** how far a pressed control drops */
  pressOffset: "1px",
  /** how small a floating layer (a tooltip) starts as it enters, before it settles at full size */
  enterScale: 0.95,
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
  /** the line under the selected tab */
  tabIndicator: "2px",
  /** the widest a tooltip grows before its text wraps */
  tooltip: "300px",
  /** the switch's track, and its thumb off and on (the thumb grows as it slides) */
  switchWidth: "40px",
  switchHeight: "24px",
  switchThumb: "16px",
  switchThumbOn: "20px",
  /** the stroke every icon is drawn with */
  iconStroke: "1.5",
});

export const OPACITY = Object.freeze({
  /** a control that cannot act, together with cursor and aria-disabled, never alone */
  disabled: 0.55,
  /** secondary text inside an inverted surface (a tooltip's second line) */
  quiet: 0.8,
});

/**
 * How much of the hover tint (--color-tint-hover) a hovered fill takes, as Astryx's own hover
 * recipe mixes it: a neutral surface a little, the accent more, so both read as one change. And
 * how much of the 3D view's paper a room name's chip is (labelChip): enough to read over any
 * finish, still showing a hint of the floor beneath.
 */
export const MIX = Object.freeze({ hoverSurface: "5%", hoverAccent: "15%", labelChip: "88%" });

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

/**
 * The theme the page runs: the built Astryx theme its stylesheets carry (index.html names it on
 * <html>, where the theme's scoped rules and the deferred Astryx components look for it) and
 * its colour mode. Studio's dark values exist (tokenSheet.ts) but are not complete.
 */
export const THEME = Object.freeze({ name: "stone", mode: "light" } as const);

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

/**
 * The shared session's colours (src/model/presence.ts): the person in the accent, the agent in
 * its verdigris, the other tabs of the browser in theirs (the sheet's `tabs`). They are the
 * stylesheet's custom properties, not fixed values, so each follows the theme — the dark sheet
 * has its own — and script hands them on as they are: a marker's or a cursor's colour is the
 * custom property --ss-colour, set to one of these (ui/session/place.ts).
 */
export const PRESENCE_COLOUR = Object.freeze({ person: "var(--color-accent)", agent: "var(--color-agent)" });

/** The colour of the tab numbered `ordinal` (from 1) in the session: one of --plan-tab-1… */
export const tabColour = (ordinal: number): string => `var(--plan-tab-${((Math.max(1, ordinal) - 1) % sheet.tabs.length) + 1})`;

/** Room fill per floor finish on the plan. */
export const FLOOR_FILL: Readonly<Record<FloorFinish, string>> = Object.freeze({
  oak: sheet.floorOak.hex,
  tile: sheet.floorTile.hex,
  carpet: sheet.floorCarpet.hex,
  concrete: sheet.floorConcrete.hex,
});

/*
 * The 3D view's tokens (its air: --scene-backdrop and --scene-ink; the surfaces' albedos, the
 * lights' colours, the furniture palette) are in src/ui/theme/sceneTokens.ts: only the lazily
 * loaded 3D chunk reads them from script, so they are a module of their own and stay out of
 * the page's first load. The stylesheet reads the air from there too (tokenSheet.ts).
 */
