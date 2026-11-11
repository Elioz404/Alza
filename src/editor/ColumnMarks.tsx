/**
 * The marks the plan draws about its columns beyond their poché (Editor.tsx draws that): the
 * selected or hovered column's outline and its section on a pill, the column the column tool
 * would add where it is aimed (with a guide to the column whose axis it lined up with), and the
 * columns' axes dimensioned as a structural grid is.
 *
 * Fetched after the first paint (Editor.tsx): until it is here, the columns are drawn and can be
 * selected and placed, without these marks.
 */

import type { ReactNode } from "react";
import type { Column, Wall } from "../model/types";
import { COLUMN, SNAP } from "../model/limits";
import { columnBox, defaultColumnAt, isRound, type ColumnAim } from "../model/columns";
import { LETTER, MARK, chainStops, columnSectionText, metres, textWidth } from "./drawing";
import { ColumnShape } from "./ColumnShape";

/** A mark about one column, at S pixels per metre. */
export interface ColumnMarkProps {
  column: Column;
  S: number;
}
export interface ColumnGhostProps {
  aim: ColumnAim;
  columns: readonly Column[];
  S: number;
}
export interface ColumnChainsProps {
  columns: readonly Column[];
  walls: readonly Wall[];
  S: number;
}

/** A column outlined a pen's width off its section (selected, hovered). */
export function ColumnOutline({ column: c, S, className }: ColumnMarkProps & { className: string }) {
  const o = MARK.outline;
  if (isRound(c)) return <circle className={className} cx={c.x * S} cy={c.y * S} r={(c.w / 2) * S + o} />;
  return (
    <rect
      className={className}
      transform={`translate(${c.x * S} ${c.y * S}) rotate(${-c.rotation})`}
      x={(-c.w / 2) * S - o}
      y={(-c.d / 2) * S - o}
      width={c.w * S + 2 * o}
      height={c.d * S + 2 * o}
    />
  );
}

/** The selected column's section on a pill under it. */
export function ColumnPill({ column: c, S }: ColumnMarkProps) {
  const text = columnSectionText(c);
  const w = textWidth(text, LETTER.small) + 2 * MARK.pillPad;
  const y = columnBox(c).maxY * S + 2 * MARK.outline + MARK.pillH / 2;
  return (
    <g className="pl-pill pl-pill--selection" data-column-pill="" transform={`translate(${c.x * S} ${y})`}>
      <rect className="pl-pill-box" x={-w / 2} y={-MARK.pillH / 2} width={w} height={MARK.pillH} rx={MARK.pillRadius} />
      <text className="pl-pill-text" x={0} y={LETTER.small / 3}>
        {text}
      </text>
    </g>
  );
}

/**
 * The column the column tool would add where it is aimed (columns.ts columnAim): the default
 * section, with a guide to the column whose axis it was pulled onto. Where it would stand in
 * another column it is refused in the error tone and crossed out, so the refusal does not rest on
 * colour alone (the hint bar says it in words too).
 */
export function ColumnGhost({ aim, columns, S }: ColumnGhostProps) {
  const ghost = defaultColumnAt(aim.x, aim.y);
  const to = aim.to === "column" ? columns.find((c) => c.id === aim.ref) : undefined;
  const h = (COLUMN.defaults.size / 2) * S;
  const [x, y] = [aim.x * S, aim.y * S];
  return (
    <g className="pl-ghost-column" data-to={aim.to} data-refused={aim.overlaps ? "" : undefined}>
      {to ? <path className="pl-snap-guide" d={`M${to.x * S} ${to.y * S}L${x} ${y}`} /> : null}
      <ColumnShape column={ghost} S={S} className="pl-column" />
      {aim.overlaps ? <path className="pl-ghost-refused" d={`M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${y + h}`} /> : null}
    </g>
  );
}

/**
 * The columns' axes dimensioned as a structural grid is: a chain below the level's walls through
 * the columns' x, and one to their right through their y, each once two or more axes differ.
 */
export function ColumnChains({ columns, walls, S }: ColumnChainsProps) {
  if (columns.length < 2) return null;
  const boxes = columns.map((c) => ({ c, b: columnBox(c) }));
  const xs = chainStops(columns.map((c) => c.x));
  const ys = chainStops(columns.map((c) => c.y));
  const face = walls.length > 0 ? (Math.max(...walls.map((w) => w.thickness)) / 2) * S : 0;
  const maxY = Math.max(...walls.flatMap((w) => [w.ay, w.by]), ...boxes.map(({ b }) => b.maxY)) * S + face;
  const maxX = Math.max(...walls.flatMap((w) => [w.ax, w.bx]), ...boxes.map(({ b }) => b.maxX)) * S + face;
  // the columns on one axis: a stop of chainStops stands for every column within half a snap of it
  const on = (v: number, stop: number) => Math.abs(v - stop) <= SNAP / 2;
  const t = MARK.dimTick;
  const out: ReactNode[] = [];
  const figure = (key: number, from: number, to: number, place: (mid: number) => { x?: number; y?: number; transform?: string }) => {
    const label = metres(to - from);
    if ((to - from) * S < textWidth(label, LETTER.small) + 2 * t) return null;
    return (
      <text key={key} className="pl-dim-text pl-halo" {...place(((from + to) / 2) * S)}>
        {label}
      </text>
    );
  };
  if (xs.length > 1) {
    const at = maxY + MARK.dimOffset;
    let ext = "";
    let ticks = "";
    for (const m of xs) {
      const from = Math.max(...boxes.filter(({ c }) => on(c.x, m)).map(({ b }) => b.maxY)) * S + MARK.dimExtGap;
      ext += `M${m * S} ${from}V${at + MARK.dimExtOver}`;
      ticks += `M${m * S - t} ${at + t}L${m * S + t} ${at - t}`;
    }
    out.push(
      <g key="x">
        <path className="pl-dim-ext" d={ext} />
        <path className="pl-dim-line" d={`M${xs[0] * S - MARK.dimOverrun} ${at}H${xs[xs.length - 1] * S + MARK.dimOverrun}`} />
        <path className="pl-dim-tick" d={ticks} />
        {xs.slice(1).map((m, i) => figure(i, xs[i], m, (mid) => ({ x: mid, y: at - MARK.dimText })))}
      </g>,
    );
  }
  if (ys.length > 1) {
    const at = maxX + MARK.dimOffset;
    let ext = "";
    let ticks = "";
    for (const m of ys) {
      const from = Math.max(...boxes.filter(({ c }) => on(c.y, m)).map(({ b }) => b.maxX)) * S + MARK.dimExtGap;
      ext += `M${from} ${m * S}H${at + MARK.dimExtOver}`;
      ticks += `M${at - t} ${m * S + t}L${at + t} ${m * S - t}`;
    }
    out.push(
      <g key="y">
        <path className="pl-dim-ext" d={ext} />
        <path className="pl-dim-line" d={`M${at} ${ys[0] * S - MARK.dimOverrun}V${ys[ys.length - 1] * S + MARK.dimOverrun}`} />
        <path className="pl-dim-tick" d={ticks} />
        {ys.slice(1).map((m, i) => figure(i, ys[i], m, (mid) => ({ transform: `translate(${at - MARK.dimText} ${mid}) rotate(-90)` })))}
      </g>,
    );
  }
  return out.length > 0 ? (
    <g className="pl-dims" data-column-axes="">
      {out}
    </g>
  ) : null;
}
