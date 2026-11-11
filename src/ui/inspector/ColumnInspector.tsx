/**
 * Properties for a selected column: its section (square, rectangle or round, and its sizes), where
 * its centre stands and how it is turned, and how tall it is — up to the underside of the slab
 * over its level unless a height is set here. What follows (its section's area, its height, the
 * walls it stands in) is read from model/columns.ts, as the checker and the 3D view read it.
 * Every field is one move_column or update_column; removing it is one remove_column.
 */

import { pageActions } from "../../model/store";
import { levelInfo } from "../../model/levels";
import { columnArea, columnHeight, columnWalls } from "../../model/columns";
import { COLUMN, COLUMN_SHAPES, COORD, QUARTER_TURN, ROTATION, quarterTurned, type ColumnShape } from "../../model/limits";
import type { Column } from "../../model/types";
import type { ColumnPatch } from "../../model/store";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import { Button, IconColumn, IconTrash, Section, SegmentedControl, SegmentedControlItem, Switch } from "../primitives";
import { EntityHead, InspectorFoot, Stats, useCommit } from "./parts";
import { MeasureField, PointFields, ROTATION_STEP } from "./measure";
import { columnName, degrees, listOf, metres, squareMetres, wallName } from "./entities";

const SHAPE_LABEL: Record<ColumnShape, string> = { square: "Square", rectangle: "Rectangle", circle: "Round" };
/** Sections are typed to the centimetre; the centre to the millimetre a column is kept to. */
const SIZE_STEP = 0.01;

/** "Square column, 0.30 × 0.30 m", "Round column, Ø 0.35 m". */
export const columnKind = (c: Pick<Column, "shape" | "w" | "d">): string =>
  `${SHAPE_LABEL[c.shape]} column, ${c.shape === "circle" ? `Ø ${metres(c.w)}` : `${c.w.toFixed(2)} × ${metres(c.d)}`}`;

export function ColumnInspector({ column }: { column: Column }) {
  const model = useAppStore((s) => s.model);
  const commit = useCommit();
  const notify = useNotify();
  const name = columnName(model, column);
  const level = levelInfo(model, column.levelId);
  const height = columnHeight(model, column);
  const walls = columnWalls(model.walls, column);
  const update = (patch: ColumnPatch) => commit({ type: "update_column", id: column.id, patch });
  const move = (at: { x?: number; y?: number; rotation?: number }) => commit({ type: "move_column", id: column.id, ...at });
  const round = column.shape === "circle";

  const remove = () => {
    const r = commit({ type: "remove_column", id: column.id });
    if (r.ok) {
      pageActions.selectColumn(null);
      notify({ body: `${name} removed`, undoable: true });
    }
  };

  const inWalls = walls.length > 0 ? `In ${listOf(walls.map((w) => wallName(model, w)), "and")}` : "Free-standing";
  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconColumn} title={name} sub={`${columnKind(column)}. ${inWalls}${level ? `, on ${level.level.name}` : ""}`} id={column.id} />
        <Section title="Section">
          <div className="insp-choice">
            <span className="insp-choice__label" aria-hidden="true">
              Shape
            </span>
            <SegmentedControl label="Shape" size="sm" layout="fill" value={column.shape} onChange={(v) => update({ shape: v as ColumnShape })}>
              {COLUMN_SHAPES.map((s) => (
                <SegmentedControlItem key={s} value={s} label={SHAPE_LABEL[s]} />
              ))}
            </SegmentedControl>
          </div>
          <div className="insp-grid">
            <MeasureField label={round ? "Diameter" : "Width"} value={column.w} min={COLUMN.size.min} max={COLUMN.size.max} step={SIZE_STEP} onCommit={(v) => update({ w: v })} />
            {column.shape === "rectangle" ? (
              <MeasureField label="Depth" value={column.d} min={COLUMN.size.min} max={COLUMN.size.max} step={SIZE_STEP} onCommit={(v) => update({ d: v })} />
            ) : null}
          </div>
          <p className="insp-help">
            Between {metres(COLUMN.size.min)} and {metres(COLUMN.size.max)} across. A square's and a round column's depth is their width.
          </p>
        </Section>
        <Section title="Placement" action={<span className="insp-aside">Snaps to walls and other columns on the plan</span>}>
          <PointFields label="Centre" x={column.x} y={column.y} min={COORD.min} max={COORD.max} step={COLUMN.precision} onCommit={(p) => move(p)} />
          {round ? null : (
            <div className="insp-grid insp-grid--end">
              <MeasureField label="Rotation" unit="°" digits={1} value={column.rotation} min={ROTATION.min} max={ROTATION.max} step={ROTATION_STEP} onCommit={(v) => move({ rotation: v })} />
              <Button size="md" onClick={() => move({ rotation: quarterTurned(column.rotation) })}>
                Turn {degrees(QUARTER_TURN)}
              </Button>
            </div>
          )}
        </Section>
        <Section title="Height">
          <Switch
            label="Up to the slab above"
            value={column.height === undefined}
            // on: it reaches the underside of the slab over its level; off: it keeps the height it has now
            onChange={(on) => update({ height: on ? null : (height ?? COLUMN.height.min) })}
            description={column.height === undefined ? "It stands from its floor to the underside of the slab over its level, and follows the level's height." : "It keeps the height set below, whatever the level's height."}
            labelPosition="start"
            labelSpacing="spread"
          />
          {column.height !== undefined ? (
            <MeasureField label="Height" value={column.height} min={COLUMN.height.min} max={COLUMN.height.max} step={SIZE_STEP} onCommit={(v) => update({ height: v })} />
          ) : null}
          <Stats
            items={[
              { label: "Section area", value: squareMetres(columnArea(column)) },
              { label: "Height", value: height === undefined ? "—" : metres(height) },
            ]}
          />
          <p className="insp-help">A column carries the floor above it, as a wall does. Issues says when a stretch of an upper floor has nothing under it near enough.</p>
        </Section>
      </div>
      <InspectorFoot
        action={
          <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
            Delete column
          </Button>
        }
      />
    </div>
  );
}
