/**
 * A switch: an on/off setting that takes effect at once (the approval policy, the agent's marks).
 * A native checkbox in the switch role, so the browser gives it its keyboard (Space), its label
 * (the <label> names it, and a click on the words flips it) and its form semantics; the track
 * and thumb are drawn over it.
 *
 *   <Switch label="Ask before destructive agent actions" value={on} onChange={setOn} />
 *   <Switch label="…" description="…" labelPosition="start" labelSpacing="spread" … />
 *
 * `description` is read as the switch's description (aria-describedby).
 */

import "./switch.css";
import { useId, type ChangeEvent } from "react";

export interface SwitchProps {
  label: string;
  value: boolean;
  onChange: (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void;
  /** a sentence under the label, read as the switch's description */
  description?: string;
  /** the words before the switch ("start") or after it ("end", the default) */
  labelPosition?: "start" | "end";
  /** "spread" pushes the switch and the words to the two ends of the row */
  labelSpacing?: "hug" | "spread";
  isDisabled?: boolean;
  className?: string;
}

export function Switch({ label, value, onChange, description, labelPosition = "end", labelSpacing = "hug", isDisabled = false, className }: SwitchProps) {
  const id = useId();
  const descriptionId = useId();
  const classes = [
    "switch-field",
    labelPosition === "start" ? "switch-field--start" : "",
    labelSpacing === "spread" ? "switch-field--spread" : "",
    isDisabled ? "switch-field--disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <span className="switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch__input"
          checked={value}
          aria-checked={value}
          aria-disabled={isDisabled || undefined}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(e) => {
            if (!isDisabled) onChange(e.target.checked, e);
          }}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </span>
      <span className="switch-field__text">
        <label htmlFor={id} className="switch-field__label">
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="switch-field__description">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
