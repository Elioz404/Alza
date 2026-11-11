/**
 * The walls' solid poché, each wall the exact outline of its footprint (model/joints.ts,
 * wallFootprint): mitred against the walls it meets at any angle, its faces concentric arcs on a
 * curved wall, a T's stem stopped along the face it meets. The footprints tile every joint, so
 * the walls of a corner read as one solid, whatever the angle between them. A wall lower than the
 * plan's cut (drawing.ts PLAN_CUT: a roof terrace's parapet) is below the section, seen from
 * above: its outline in a finer pen, not poché.
 *
 * Fetched after the first paint (Editor.tsx), with the joints it is worked out by: until it is
 * here, each wall is drawn as its centreline stroked to its thickness (WallStrokes), which is
 * exact along a wall and only squared off at its ends.
 */

import "../ui/canvas/shapes.css";
import { useMemo } from "react";
import type { Wall } from "../model/types";
import { wallFootprint } from "../model/joints";
import { outlinePath } from "../model/shapes";
import { belowCut, wallTone } from "./drawing";

export interface WallPocheProps {
  walls: readonly Wall[];
  S: number;
  selectedId: string | null;
  /** the wall under the pointer while selecting, drawn in the hover tone */
  hoverId: string | null;
}

/** The walls as filled footprints. */
export function WallPoche({ walls, S, selectedId, hoverId }: WallPocheProps) {
  // a footprint looks at every wall of the level; worked out once per change to the walls
  const outlines = useMemo(() => walls.map((w) => ({ id: w.id, outline: wallFootprint(w, walls).outline, below: belowCut(w) })), [walls]);
  return (
    <g className="pl-poche" aria-hidden="true">
      {outlines.map(({ id, outline, below }) => (
        // a wall that stops below the plan's cut (a parapet) is seen in projection: its outline
        <path key={id} className={`pl-wall-fill${below ? " pl-wall-fill--below-cut" : ""} ${wallTone(id, selectedId, hoverId)}`} data-wall={id} d={outlinePath(outline, S)} />
      ))}
    </g>
  );
}
