/**
 * The drafting conventions of the plan, in screen pixels: where dimension chains stand off the
 * walls, how big a tick or a handle is, how a revision cloud scallops, when lettering fits.
 * Plan lengths are metres everywhere else; these are the sizes of marks on the sheet, which keep
 * their size whatever the zoom, as a printed drawing's lettering does.
 *
 * Colours and pen weights are not here: they are classes in src/ui/canvas/canvas.css, on the
 * design tokens.
 */

import type { Opening, Wall } from "../model/types";
import { openingSpan } from "../model/issues";
import { segPoint, type Pt } from "../model/geometry";
import { SNAP } from "../model/limits";
import { FONT_SIZE } from "../ui/theme/tokens";

/** CSS pixels in one rem: the tokens' type sizes are rem. */
const ROOT_PX = 16;
const remPx = (rem: string): number => parseFloat(rem) * ROOT_PX;

/** The plan's lettering sizes, in pixels, for fitting text (the stylesheet sets the same tokens). */
export const LETTER = Object.freeze({
  /** room names */
  name: remPx(FONT_SIZE.base),
  /** areas, dimensions, pills */
  small: remPx(FONT_SIZE.sm),
  /** furniture names, delta numbers */
  tiny: remPx(FONT_SIZE.xs),
  /** the drawing face's average advance, in em (Barlow Semi Condensed runs narrow) */
  advance: 0.52,
});

/** About how wide a line of plan lettering is, in pixels. */
export const textWidth = (text: string, px: number): number => text.length * px * LETTER.advance;

/** Mark sizes on the sheet, in pixels. */
export const MARK = Object.freeze({
  /** first dimension chain: this far outside the wall face */
  dimOffset: 32,
  /** each further chain: this much further out */
  dimStep: 26,
  /** extension lines stop this short of the wall face */
  dimExtGap: 8,
  /** and run this far past their chain */
  dimExtOver: 6,
  /** the chain line runs this far past its first and last tick */
  dimOverrun: 10,
  /** half the length of a 45° tick */
  dimTick: 4,
  /** dimension text sits this far off its line */
  dimText: 6,
  /** wall end handle, square */
  handle: 10,
  handleRadius: 2,
  /** a length or size pill: height, side padding, corner */
  pillH: 20,
  pillPad: 8,
  pillRadius: 4,
  /** a selection outline stands this far off what it outlines */
  outline: 3,
  /** revision cloud: scallop length, and how far the cloud stands off its entity */
  cloudStep: 18,
  cloudPad: 6,
  /** spacing of the hatch on a pending removal */
  hatch: 9,
  /** delta triangle half-width */
  delta: 11,
  /** the snap cursor's arms and ring */
  cursorArm: 8,
  cursorRing: 3,
  /** how close (px) a pointer must come to a wall end to snap to it, or to a wall to hit it */
  snapReach: 10,
  hitReach: 12,
  /** walls never draw thinner than this, however far out the zoom */
  minWall: 2,
  /** grid: the half-metre lines show once they are this far apart */
  minorGrid: 10,
  /** room lettering needs this much room (px) inside the room to be set */
  roomLabelPad: 12,
  /** furniture names are set from this zoom (px per metre) when they fit */
  itemLabelScale: 120,
});

/**
 * The floor finishes' drawn patterns, in metres on the plan (so they scale with it, as the
 * finish itself would): oak planks and where each row's joint falls along its run, square tiles.
 */
export const FLOOR_PATTERN = Object.freeze({
  /** an oak plank's width, and the run after which the pattern repeats */
  plankWidth: 0.16,
  plankRun: 2.4,
  /** where the joint falls in each of the four rows of planks, from the run's start */
  plankJoints: Object.freeze([0.3, 1.5, 0.9, 2.0]),
  /** a floor tile's side */
  tile: 0.3,
});

/** A revision cloud around a pixel rectangle: scallops that bulge outward, drawn clockwise. */
export function cloudPath(x: number, y: number, w: number, h: number, step: number = MARK.cloudStep): string {
  const pts: [number, number, number][] = [];
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(L / step));
    for (let i = 1; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, L / n]);
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  for (const [px, py, c] of pts) d += `A${(c * 0.62).toFixed(1)} ${(c * 0.62).toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}`;
  return d + "Z";
}

/** The delta triangle, centred on (cx, cy). */
export const deltaPath = (cx: number, cy: number, r: number = MARK.delta): string =>
  `M${cx} ${cy - r}L${cx + r} ${cy + r * 0.73}H${cx - r}Z`;

/** The distinct stops of a dimension chain: coordinates closer than half a snap step are one. */
export function chainStops(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > SNAP / 2) out.push(v);
  return out;
}

/** Metres as the plan letters them: two decimals, no unit (the sheet is in metres). */
export const metres = (m: number): string => m.toFixed(2);

/** The four corners of a wall's poché, in metres. */
export function wallCorners(w: Wall): Pt[] {
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay) || 1;
  const nx = (-(w.by - w.ay) / len) * (w.thickness / 2);
  const ny = ((w.bx - w.ax) / len) * (w.thickness / 2);
  return [
    { x: w.ax + nx, y: w.ay + ny },
    { x: w.bx + nx, y: w.by + ny },
    { x: w.bx - nx, y: w.by - ny },
    { x: w.ax - nx, y: w.ay - ny },
  ];
}

/** The corners of an opening's cut through its wall, in metres. */
export function openingCorners(wall: Wall, o: Opening): Pt[] {
  const [t0, t1] = openingSpan(wall, o);
  const a = { x: wall.ax, y: wall.ay };
  const b = { x: wall.bx, y: wall.by };
  const p0 = segPoint(a, b, t0);
  const p1 = segPoint(a, b, t1);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (wall.thickness / 2);
  const ny = ((b.x - a.x) / len) * (wall.thickness / 2);
  return [
    { x: p0.x + nx, y: p0.y + ny },
    { x: p1.x + nx, y: p1.y + ny },
    { x: p1.x - nx, y: p1.y - ny },
    { x: p0.x - nx, y: p0.y - ny },
  ];
}

/** The corners of a piece's footprint, in metres (rotation counter-clockwise on the plan). */
export function footprintCorners(x: number, y: number, w: number, d: number, rotation: number): Pt[] {
  const a = (-rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([lx, ly]) => ({ x: x + lx * c - ly * s, y: y + lx * s + ly * c }));
}

/** An SVG polygon's points from world corners at `S` pixels per metre. */
export const polygonPoints = (pts: readonly Pt[], S: number): string => pts.map((p) => `${p.x * S},${p.y * S}`).join(" ");

/** The pixel box around world corners. */
export function pixelBox(pts: readonly Pt[], S: number, pad = 0): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x * S);
  const ys = pts.map((p) => p.y * S);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** A scale bar's length in metres: a round figure that draws between `min` and `max` pixels. */
export function scaleBarMetres(S: number, min = 96, max = 200): number {
  const NICE = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
  return NICE.find((m) => m * S >= min && m * S <= max) ?? NICE.find((m) => m * S >= min) ?? NICE[NICE.length - 1];
}
