/**
 * Form fields. A visible label above every control (never a placeholder standing in for it),
 * a help line below that reserves its height, and the error replacing the help in that line,
 * tied to the control with aria-describedby and aria-invalid.
 *
 *   <Field label="Plan name" help="Shown in the top bar and on exports.">
 *     {(ids) => <TextInput {...ids} value={name} onChange={…} />}
 *   </Field>
 *
 * `NumberField` is Astryx's NumberInput (keyboard stepping, parsing, min/max, commit on Enter
 * and blur) with the unit after the value and the drawing face for the figures.
 */

import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { NumberInput, type NumberInputProps } from "@astryxdesign/core/NumberInput";

/** What a Field hands its control. Spread it onto the input. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string;
  "aria-invalid": true | undefined;
}

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** replaces the help line and marks the control invalid */
  error?: ReactNode;
  /** a value or control shown at the end of the label row (a unit, a reset link) */
  labelEnd?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, help, error, labelEnd, className, children }: FieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const noteId = `${id}-note`;
  return (
    <div className={`field${error ? " field--error" : ""}${className ? ` ${className}` : ""}`}>
      <div className="field__label-row">
        <label className="field__label" htmlFor={controlId}>
          {label}
        </label>
        {labelEnd}
      </div>
      {children({ id: controlId, "aria-describedby": noteId, "aria-invalid": error ? true : undefined })}
      <p id={noteId} className={error ? "field__error" : "field__help"} role={error ? "alert" : undefined}>
        {error ?? help}
      </p>
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

/** A single-line text box on the page's field recipe. */
export function TextInput({ ref, className, type = "text", ...rest }: TextInputProps) {
  return <input ref={ref} type={type} className={`input${className ? ` ${className}` : ""}`} {...rest} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

/** A multi-line text box on the page's field recipe (body face, never monospace). */
export function TextArea({ ref, className, ...rest }: TextAreaProps) {
  return <textarea ref={ref} className={`input input--area${className ? ` ${className}` : ""}`} {...rest} />;
}

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
