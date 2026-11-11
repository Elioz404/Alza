/**
 * A stair's plan symbol, drawn from what stairSymbol.ts works out: on its own level ("lower")
 * its flights' edges and treads below the plan's cut, the hidden ones above it and the break
 * line, the walking line with UP; on the level above ("upper") the stairwell's rim, its guard
 * and the flight seen through it, with DN. The editor fetches it after the first paint (src/editor/Editor.tsx);
 * its pens and colours are in src/ui/canvas/stairs.css, on the tokens.
 */

import "../ui/canvas/stairs.css";
import type { Pt } from "../model/geometry";
import type { StairGeometry } from "../model/stairs";
import { LETTER, MARK, polygonPoints } from "./drawing";
import { stairSymbol, type StairSide } from "./stairSymbol";

export interface StairDrawingProps {
  geometry: StairGeometry;
  side: StairSide;
  /** pixels per metre */
  S: number;
  className: string;
}

/** Polylines as one path's data, at `S` pixels per metre. */
const pathOf = (lines: readonly (readonly Pt[])[], S: number): string =>
  lines
    .filter((line) => line.length > 1)
    .map((line) => line.map((p, i) => `${i === 0 ? "M" : "L"}${p.x * S} ${p.y * S}`).join(""))
    .join("");

export function StairDrawing({ geometry, side, S, className }: StairDrawingProps) {
  const sym = stairSymbol(geometry, side);
  const { tip, dir } = sym.arrow;
  const n = { x: -dir.y, y: dir.x };
  const base = { x: tip.x * S - dir.x * MARK.stairArrow, y: tip.y * S - dir.y * MARK.stairArrow };
  const head = [
    `${tip.x * S},${tip.y * S}`,
    `${base.x + n.x * MARK.stairArrowHalf},${base.y + n.y * MARK.stairArrowHalf}`,
    `${base.x - n.x * MARK.stairArrowHalf},${base.y - n.y * MARK.stairArrowHalf}`,
  ].join(" ");
  const lettered = geometry.going * S >= LETTER.tiny;
  return (
    <g className={className} data-side={side}>
      {sym.outlines.map((pts, i) => (
        <polygon key={i} className="pl-stair-flight" points={polygonPoints(pts, S)} />
      ))}
      {sym.edges.length > 0 ? <path className="pl-stair-edge" d={pathOf(sym.edges, S)} /> : null}
      {sym.hiddenEdges.length > 0 ? <path className="pl-stair-edge pl-stair-edge--hidden" d={pathOf(sym.hiddenEdges, S)} /> : null}
      {sym.guard.length > 0 ? <path className="pl-stair-guard" d={pathOf(sym.guard, S)} /> : null}
      <path className="pl-stair-tread" d={pathOf(sym.treads, S)} />
      {sym.hidden.length > 0 ? <path className="pl-stair-hidden" d={pathOf(sym.hidden, S)} /> : null}
      {sym.cut ? <path className="pl-stair-cut" d={pathOf([sym.cut], S)} /> : null}
      <path className="pl-stair-walk" d={pathOf([sym.walk.drawn], S)} />
      {sym.walk.rest.length > 1 ? <path className="pl-stair-walk pl-stair-walk--hidden" d={pathOf([sym.walk.rest], S)} /> : null}
      <circle className="pl-stair-dot" cx={sym.dot.x * S} cy={sym.dot.y * S} r={MARK.stairDot} />
      <polygon className="pl-stair-arrow" points={head} />
      {lettered ? (
        <text className="pl-stair-label pl-halo pl-halo--furniture" x={sym.label.at.x * S} y={sym.label.at.y * S}>
          {sym.label.text}
        </text>
      ) : null}
    </g>
  );
}
