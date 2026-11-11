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
import type { Pt } from "../model/geometry";
import { edgeArc, edgePathTo, piecesOf, pointOnEdge, subEdge, tangentOnEdge, wallEdge, type Edge } from "../model/shapes";
import { QUARTER_TURN, SNAP, headingOf } from "../model/limits";
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
  /** a stair's walking line: the arrow head's length and half-width, the dot it starts from */
  stairArrow: 9,
  stairArrowHalf: 4,
  stairDot: 2.5,
  /** how far (px) the pointer must travel from where a stair starts before its direction follows it */
  stairAim: 12,
  /**
   * A shape's handles (a room's corners and edge middles, a curved wall's middle): what they take
   * a press within, as a radius in pixels (a 44 px touch target), and the drawn dot's radius.
   */
  touchReach: 22,
  midHandle: 4.5,
  /** an edge's middle handle is offered once the edge is this many pixels long, clear of its corners' reach */
  midHandleRoom: 88,
  /** an edge's length is lettered once the edge is this many pixels long */
  edgeDimRoom: 64,
  /** an edge's length stands this far (px) inside the room from the edge */
  edgeDimInset: 14,
});

/**
 * The shared session on the plan (PlanPresence.tsx), in pixels: the soft highlight on what the
 * agent touches, its marker and label, a point_at ring, another tab's cursor and name tag.
 */
export const PRESENCE_MARK = Object.freeze({
  /** the highlight stands this far off what it highlights */
  pad: 6,
  /** the agent's marker: a diamond this many pixels from its centre to a corner */
  marker: 7,
  /** its label sits this far right of the marker, and this far above its centre */
  labelDx: 12,
  labelDy: -12,
  /** a point_at ring: its radius, at least this much, and this far round its entity */
  ring: 16,
  /** another tab's cursor: the arrow's length, and where its name tag starts */
  cursor: 16,
  tagDx: 14,
  tagDy: 22,
});

/**
 * Where the plan is cut, as a floor plan is: a horizontal section `height` metres above the floor
 * of the level it shows. What stands taller is cut and drawn in section (a wall's solid poché, a
 * stair's treads up to the cut); what stops below it is seen from above, in projection (a
 * parapet's outline, the treads past the cut dashed).
 */
export const PLAN_CUT = Object.freeze({ height: 1.2 });

/** Whether a wall stops below the plan's cut: drawn in projection, its outline only, not as poché. */
export const belowCut = (w: Pick<Wall, "height">): boolean => w.height < PLAN_CUT.height;

/**
 * How a stair is drawn on the plan, in metres and fractions of the stair (so the symbol scales
 * with it). The plan is cut, as a floor plan is, at `cutHeight` above its floor: treads below
 * the cut are drawn, the ones above it hidden (dashed), with a break line where the cut crosses
 * the flight. On the level a stair arrives at, its stairwell is outlined and its treads show
 * through the void beneath.
 */
export const STAIR_SYMBOL = Object.freeze({
  /** the plan's cut, above the floor of the level shown, metres (PLAN_CUT) */
  cutHeight: PLAN_CUT.height,
  /** the break line's zigzag, as a fraction of the stair's width */
  breakZig: 0.12,
  /** the UP / DN lettering sits this many goings in from its end of the walking line, and this
   *  fraction of the width to the side of it */
  labelGoings: 1.5,
  labelSide: 0.25,
  /** on the level above, the guard round the stairwell is drawn this far inside its rim, metres */
  guardInset: 0.05,
  /** the climb direction snaps to this many degrees while the stair tool is aimed */
  aimStep: QUARTER_TURN,
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

/**
 * The point `off` metres to the right of a wall's centreline at t (walking from A to B; the
 * left for a negative `off`). On a curved wall the offset is along the radius, so the points of
 * one `off` run along a face, an arc concentric with the centreline.
 */
export function wallOffsetAt(w: Wall, t: number, off: number): Pt {
  const e = wallEdge(w);
  const p = pointOnEdge(e, t);
  const u = tangentOnEdge(e, t);
  return { x: p.x - u.y * off, y: p.y + u.x * off };
}

/**
 * The band of a wall between parameters t0 and t1, `half` metres to either side of its
 * centreline, as a closed polygon in metres: the right face from t0 to t1, the left face back. A
 * curved wall's faces are cut into the pieces its centreline is (ARC_TESSELLATION).
 */
export function bandPoints(w: Wall, t0: number, t1: number, half: number): Pt[] {
  const n = piecesOf(subEdge(wallEdge(w), t0, t1));
  const ts = Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n);
  return [...ts.map((t) => wallOffsetAt(w, t, half)), ...ts.reverse().map((t) => wallOffsetAt(w, t, -half))];
}

/**
 * The same band as SVG path data at `S` pixels per metre, its faces as true arcs on a curved
 * wall: what an opening's cut and a window's frame are drawn with.
 */
export function bandPath(w: Wall, t0: number, t1: number, half: number, S: number): string {
  const e = wallEdge(w);
  const arc = edgeArc(e);
  const r0 = wallOffsetAt(w, t0, half);
  const r1 = wallOffsetAt(w, t1, half);
  const l1 = wallOffsetAt(w, t1, -half);
  const l0 = wallOffsetAt(w, t0, -half);
  const face = (from: Pt, to: Pt, backwards: boolean): Edge => {
    if (!arc) return { a: from, b: to, bulge: 0 };
    // a face is the centreline's circle at another radius, turning the same way (or back)
    const sweep = arc.sweep * (t1 - t0) * (backwards ? -1 : 1);
    return { a: from, b: to, bulge: Math.tan(sweep / 4) };
  };
  return `M${r0.x * S} ${r0.y * S}${edgePathTo(face(r0, r1, false), S)}L${l1.x * S} ${l1.y * S}${edgePathTo(face(l1, l0, true), S)}Z`;
}

/** A wall's drawn tone, as a class: selected, hovered or plain. */
export const wallTone = (id: string, selectedId: string | null, hoverId: string | null): string =>
  id === selectedId ? "pl-wall--selected" : id === hoverId ? "pl-wall--hover" : "";

/** A wall's centreline as SVG path data: a line, or its arc. What a fallback poché and the hit band stroke. */
export function wallPathD(w: Wall, S: number): string {
  return `M${w.ax * S} ${w.ay * S}${edgePathTo(wallEdge(w), S)}`;
}

/** The outline of a wall's poché, in metres (unmitred): its four corners, or a curved wall's band. */
export const wallCorners = (w: Wall): Pt[] => bandPoints(w, 0, 1, w.thickness / 2);

/** The outline of an opening's cut through its wall, in metres (along the arc on a curved wall). */
export function openingCorners(wall: Wall, o: Opening): Pt[] {
  const [t0, t1] = openingSpan(wall, o);
  return bandPoints(wall, t0, t1, wall.thickness / 2);
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

/** A climb direction (degrees, 0 = +y, 90 = +x, as a stair's rotation) from a drag, snapped to `step`. */
export function aimRotation(from: Pt, to: Pt, step: number = STAIR_SYMBOL.aimStep): number {
  const deg = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  const snapped = Math.round(deg / step) * step;
  return headingOf(snapped);
}

/**
 * The ways a stair can be aimed from the keyboard, a quarter turn apart from rotation 0 (down
 * the sheet, +y): the arrow key that aims it that way, and the word the hint says it with.
 */
const CLIMB_WAYS = Object.freeze([
  { key: "ArrowDown", word: "down" },
  { key: "ArrowRight", word: "right" },
  { key: "ArrowUp", word: "up" },
  { key: "ArrowLeft", word: "left" },
] as const);

/** With the stair tool, an arrow key aims the next stair: the way it climbs, as a stair's rotation. */
export const ARROW_CLIMB: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(CLIMB_WAYS.map((w, i) => [w.key, i * QUARTER_TURN])));

/** Which way a stair at `rotation` climbs on the sheet, in a word: the nearest quarter turn's. */
export const climbWord = (rotation: number): string => CLIMB_WAYS[Math.round(headingOf(rotation) / QUARTER_TURN) % CLIMB_WAYS.length].word;
