/**
 * A column's section on the sheet: a circle, or its rectangle's corners (model/columns.ts). The
 * plan draws every column with it, and the column tool's aim (ColumnMarks.tsx).
 */

import type { Column } from "../model/types";
import { columnFootprint, isRound } from "../model/columns";
import { polygonPoints } from "./drawing";

export function ColumnShape({ column: c, S, className }: { column: Column; S: number; className: string }) {
  if (isRound(c)) return <circle className={className} cx={c.x * S} cy={c.y * S} r={(c.w / 2) * S} />;
  return <polygon className={className} points={polygonPoints(columnFootprint(c), S)} />;
}
