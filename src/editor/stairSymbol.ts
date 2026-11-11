/**
 * A stair's plan symbol, worked out from its geometry (src/model/stairs.ts), in metres.
 *
 * The plan is a horizontal cut through the level it shows (STAIR_SYMBOL.cutHeight above its
 * floor), so a stair is drawn the way a floor plan draws one:
 *
 *  - on the level it stands on ("lower"): the treads below the cut as lines, the ones above it
 *    hidden (dashed), and the flights' edges the same way — drawn up to the cut, hidden past it —
 *    a break line across the flight where the cut passes, and the walking line from a dot at
 *    the bottom riser to an arrow at the top one, lettered UP;
 *  - on the level it arrives at ("upper"): the stairwell's outline (the void in this floor) as
 *    a visible edge, the guard round it on every side but the one the stair arrives across, the
 *    whole flight seen through it, and the walking line the other way, from a dot at the top
 *    riser down to an arrow at the bottom one, lettered DN.
 *
 * Pure: the editor renders what this returns at its zoom, and the tests read it directly.
 */

import { pointInORect, rectCorners, type ORect, type Pt } from "../model/geometry";
import type { StairGeometry } from "../model/stairs";
import { stairGuard } from "../model/stairGuard";
import { STAIR_SYMBOL } from "./drawing";

export type StairSide = "lower" | "upper";

export interface StairSymbol {
  /**
   * Each flight's and the landing's outline: the stair's footprint (filled, and outlined when
   * selected), or the stairwell's rim on the upper side, drawn as a visible edge.
   */
  outlines: Pt[][];
  /** on the stair's own level, the outlines' edges below the cut, drawn as lines */
  edges: [Pt, Pt][];
  /** and the stretches of them past the cut, drawn hidden as the treads there are */
  hiddenEdges: [Pt, Pt][];
  /** on the level above, the guard round the stairwell: one line inside each guarded rim edge */
  guard: [Pt, Pt][];
  /** the risers drawn as lines (below the cut, or all of them on the upper side) */
  treads: [Pt, Pt][];
  /** the risers above the cut, drawn hidden */
  hidden: [Pt, Pt][];
  /** the break line where the cut crosses the flight; null when the whole stair is below it */
  cut: Pt[] | null;
  /** the walking line up to the cut, and past it (hidden); `rest` is empty when nothing is cut */
  walk: { drawn: Pt[]; rest: Pt[] };
  /** where the walking line starts (its dot) and where its arrow points, with the arrow's direction */
  dot: Pt;
  arrow: { tip: Pt; dir: Pt };
  /** UP on the stair's own level, DN on the one above */
  label: { at: Pt; text: "UP" | "DN" };
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** A riser: the near edge of a tread (its local -depth side), across the flight. */
function riserOf(rect: ORect): [Pt, Pt] {
  const c = rectCorners(rect);
  return [c[2], c[3]];
}

/** The point of a rectangle at local (u, v), in units of its half sizes (-1..1). */
function local(rect: ORect, u: number, v: number): Pt {
  const c = Math.cos(rect.rot);
  const s = Math.sin(rect.rot);
  const lx = u * rect.hw;
  const ly = v * rect.hd;
  return { x: rect.cx + lx * c - ly * s, y: rect.cy + lx * s + ly * c };
}

/**
 * The break line across a tread: corner to corner, with the drafting zigzag in its middle.
 * `zig` is the zigzag's size in metres.
 */
export function breakLine(rect: ORect, zig: number): Pt[] {
  const a = local(rect, -1, -1);
  const b = local(rect, 1, 1);
  const m = local(rect, 0, 0);
  const d = unit(sub(b, a));
  const n = { x: -d.y, y: d.x };
  return [a, add(m, d, -zig), add(m, n, zig), add(m, n, -zig), add(m, d, zig), b];
}

/** Split a polyline at the point of it nearest `at`: the part before, the part after. */
export function splitPolyline(line: readonly Pt[], at: Pt): [Pt[], Pt[]] {
  let best = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const ab = sub(line[i + 1], a);
    const len2 = ab.x * ab.x + ab.y * ab.y || 1;
    const t = Math.min(1, Math.max(0, ((at.x - a.x) * ab.x + (at.y - a.y) * ab.y) / len2));
    const p = add(a, ab, t);
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = i;
      bestT = t;
    }
  }
  const p = add(line[best], sub(line[best + 1], line[best]), bestT);
  return [[...line.slice(0, best + 1), p], [p, ...line.slice(best + 1)]];
}

/** Every edge of an outline, in order round it. */
const edgesOf = (corners: readonly Pt[]): [Pt, Pt][] => corners.map((p, i) => [p, corners[(i + 1) % corners.length]]);

/**
 * Split segment a→b where it crosses the line through `at` square to `dir`: the part on the
 * near side (against `dir`) and the part past it. Either may be null.
 */
function splitAcross([a, b]: [Pt, Pt], at: Pt, dir: Pt): [[Pt, Pt] | null, [Pt, Pt] | null] {
  const da = (a.x - at.x) * dir.x + (a.y - at.y) * dir.y;
  const db = (b.x - at.x) * dir.x + (b.y - at.y) * dir.y;
  const eps = 1e-9;
  if (da <= eps && db <= eps) return [[a, b], null];
  if (da >= -eps && db >= -eps) return [null, [a, b]];
  const p = add(a, sub(b, a), da / (da - db));
  return da < 0 ? [[a, p], [p, b]] : [[p, b], [a, p]];
}

/**
 * The footprint's edges on the stair's own level, split at the plan's cut across tread `cut`:
 * a rectangle climbed before the cut tread's is drawn, one climbed after it is hidden, and the
 * one holding the cut tread is split along the line across it where the break line crosses.
 */
function cutEdges(geometry: StairGeometry, cut: StairGeometry["steps"][number] | null): { edges: [Pt, Pt][]; hiddenEdges: [Pt, Pt][] } {
  const edges: [Pt, Pt][] = [];
  const hiddenEdges: [Pt, Pt][] = [];
  for (const rect of geometry.footprint) {
    const all = edgesOf(rectCorners(rect));
    if (!cut) {
      edges.push(...all);
      continue;
    }
    const centre = { x: cut.rect.cx, y: cut.rect.cy };
    if (rect !== geometry.landing?.rect && pointInORect(centre, rect)) {
      const dir = { x: -Math.sin(cut.rect.rot), y: Math.cos(cut.rect.rot) };
      for (const edge of all) {
        const [below, above] = splitAcross(edge, centre, dir);
        if (below) edges.push(below);
        if (above) hiddenEdges.push(above);
      }
      continue;
    }
    // the landing comes after the first flight; a flight is the one its treads are on
    const flight = rect === geometry.landing?.rect ? 0.5 : (geometry.steps.find((s) => pointInORect({ x: s.rect.cx, y: s.rect.cy }, rect))?.flight ?? 0);
    (flight < cut.flight ? edges : hiddenEdges).push(...all);
  }
  return { edges, hiddenEdges };
}

/** The guard lines round a stairwell, `inset` metres inside each guarded edge of its rim. */
const guardLines = (geometry: StairGeometry, inset: number): [Pt, Pt][] =>
  stairGuard(geometry).map(({ a, b, out }) => [add(a, out, -inset), add(b, out, -inset)]);

/** The index of the first tread whose top is above the cut, or the number of treads when none is. */
export const cutIndex = (geometry: StairGeometry, cutHeight: number = STAIR_SYMBOL.cutHeight): number => {
  const i = geometry.steps.findIndex((s) => s.top > cutHeight);
  return i < 0 ? geometry.steps.length : i;
};

/** The stair's symbol on the level it stands on ("lower") or on the one it arrives at ("upper"). */
export function stairSymbol(geometry: StairGeometry, side: StairSide, cutHeight: number = STAIR_SYMBOL.cutHeight): StairSymbol {
  const outlines = geometry.footprint.map(rectCorners);
  const risers = geometry.steps.map((s) => riserOf(s.rect));
  const width = geometry.footprint[0] ? geometry.footprint[0].hw * 2 : 0;
  const line = [...geometry.walkLine];
  const end = line[line.length - 1];

  if (side === "upper") {
    // seen from above, through the void: every tread, and the way down, from the top riser
    const top = add(add(end, geometry.endDir, -geometry.going * STAIR_SYMBOL.labelGoings), { x: -geometry.endDir.y, y: geometry.endDir.x }, width * STAIR_SYMBOL.labelSide);
    const down = [...line].reverse();
    return {
      outlines,
      edges: [],
      hiddenEdges: [],
      guard: guardLines(geometry, STAIR_SYMBOL.guardInset),
      treads: risers,
      hidden: [],
      cut: null,
      walk: { drawn: down, rest: [] },
      dot: end,
      arrow: { tip: geometry.start, dir: unit(sub(down[down.length - 1], down[down.length - 2] ?? end)) },
      label: { at: top, text: "DN" },
    };
  }

  const k = cutIndex(geometry, cutHeight);
  const cut = k < geometry.steps.length ? geometry.steps[k] : null;
  const [drawn, rest] = cut ? splitPolyline(line, { x: cut.rect.cx, y: cut.rect.cy }) : [line, []];
  const label = add(
    add(geometry.start, geometry.startDir, geometry.going * STAIR_SYMBOL.labelGoings),
    { x: -geometry.startDir.y, y: geometry.startDir.x },
    width * STAIR_SYMBOL.labelSide,
  );
  return {
    outlines,
    ...cutEdges(geometry, cut),
    guard: [],
    // the cut tread's own riser is still below the cut; the ones after it are above
    treads: risers.slice(0, k + 1),
    hidden: risers.slice(k + 1),
    cut: cut ? breakLine(cut.rect, width * STAIR_SYMBOL.breakZig) : null,
    walk: { drawn, rest },
    dot: geometry.start,
    arrow: { tip: end, dir: unit(sub(end, line[line.length - 2] ?? geometry.start)) },
    label: { at: label, text: "UP" },
  };
}
