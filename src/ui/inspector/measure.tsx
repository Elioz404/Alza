/**
 * The inspector's number fields: a measure that commits on Enter or when it is left, and a
 * point's X/Y pair under one label. On Astryx's NumberInput, which only the selection
 * inspectors use, so this module (and NumberInput with it) is not in the first chunk.
 */

import { useId } from "react";
import { NumberField } from "../primitives/NumberField";

/** A number in metres (or another unit) that commits on Enter or when the field is left. */
export function MeasureField({
  label,
  value,
  unit = "m",
  min,
  max,
  step,
  digits = 2,
  isLabelHidden,
  prefix,
  onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  isLabelHidden?: boolean;
  /** a short letter before the value (X, Y) */
  prefix?: string;
  onCommit: (value: number) => void;
}) {
  return (
    <NumberField
      label={label}
      isLabelHidden={isLabelHidden}
      value={Number(value.toFixed(digits))}
      unit={unit}
      min={min}
      max={max}
      step={step}
      formatValue={(v) => v.toFixed(digits)}
      startIcon={prefix ? <span className="insp-prefix">{prefix}</span> : undefined}
      onChange={(v) => {
        // the field reports a commit even when the figure did not move; the plan only hears changes
        if (Math.abs(v - value) > 10 ** -(digits + 1)) onCommit(v);
      }}
    />
  );
}

/** Two figures that belong together under one visible label: a point's X and Y. */
export function PointFields({
  label,
  x,
  y,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  x: number;
  y: number;
  min: number;
  max: number;
  step: number;
  onCommit: (point: { x?: number; y?: number }) => void;
}) {
  const labelId = useId();
  return (
    <div className="insp-pair" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="insp-pair__label">
        {label}
      </span>
      <div className="insp-grid">
        <MeasureField label={`${label} X`} isLabelHidden prefix="X" value={x} min={min} max={max} step={step} onCommit={(v) => onCommit({ x: v })} />
        <MeasureField label={`${label} Y`} isLabelHidden prefix="Y" value={y} min={min} max={max} step={step} onCommit={(v) => onCommit({ y: v })} />
      </div>
    </div>
  );
}
