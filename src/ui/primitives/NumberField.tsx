/**
 * `NumberField` is Astryx's NumberInput (keyboard stepping, parsing, min/max, commit on Enter
 * and blur) with the unit after the value and the drawing face for the figures. Kept apart from
 * Field.tsx and out of the primitives' index: only the selection inspectors use it, and they are
 * not in the first chunk, so it is imported from here (with Astryx, through ./astryx).
 */

import { NumberInput, type NumberInputProps } from "./astryx";

export type NumberFieldProps = Omit<NumberInputProps, "units" | "size" | "hasClear" | "onChange"> & {
  /** the unit shown after the value: "m", "cm", "°", "m²" */
  unit?: string;
  onChange: (value: number) => void;
};

/** A number with its unit, in the drawing face. Metres everywhere a length is shown. */
export function NumberField({ unit, onChange, ...rest }: NumberFieldProps) {
  return (
    <div className="number-field">
      <NumberInput {...rest} onChange={onChange} units={unit ?? null} size="md" />
    </div>
  );
}
