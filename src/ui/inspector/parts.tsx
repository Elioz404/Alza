/**
 * The inspector's furniture: the entity heading, figures, X/Y pairs, the agent callout, the
 * footer with its key hints, and the two ways a field changes the plan (a committed number,
 * a typed text as one gesture).
 */

import { useCallback, useId, useState, type ReactNode } from "react";
import { dispatch, type Command } from "../../model/commands";
import type { ActionResult } from "../../model/store";
import { useGesture } from "../useGesture";
import { useNotify } from "../shell/useNotify";
import { Kbd, NumberField, TextInput, IconAgent, type IconComponent } from "../primitives";

// ---------------------------------------------------------------------------- changes

/**
 * One change from a committed field or a button: dispatched as the person, and a refusal
 * shown as a notice with the reason the plan gave. Success needs no notice: the plan shows it.
 */
export function useCommit(): (command: Command) => ActionResult {
  const notify = useNotify();
  return useCallback(
    (command: Command) => {
      const r = dispatch(command, { actor: "human" });
      if (!r.ok) notify({ body: r.summary, type: "error" });
      return r;
    },
    [notify],
  );
}

/**
 * A text field bound to the plan, one gesture per edit: the plan follows every keystroke, undo
 * and the activity feed get one entry when the field is left. While the person types, the
 * field shows what they typed even when the plan refuses it (an empty room name), with the
 * reason underneath; leaving the field puts the plan's value back.
 */
export function PlanTextField({
  label,
  value,
  toCommand,
  help,
  id,
  maxLength,
}: {
  label: string;
  value: string;
  toCommand: (text: string) => Command;
  help?: ReactNode;
  id?: string;
  maxLength?: number;
}) {
  const gesture = useGesture();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownId = useId();
  // a fixed id (the plan name's, which the plan menu focuses) keeps its label: the field
  // recipe is written out here rather than through Field, whose ids are its own
  const controlId = id ?? `${ownId}-control`;
  const noteId = `${ownId}-note`;
  const end = () => {
    gesture.end();
    setDraft(null);
    setError(null);
  };
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <div className="field__label-row">
        <label className="field__label" htmlFor={controlId}>
          {label}
        </label>
      </div>
      <TextInput
        id={controlId}
        aria-describedby={noteId}
        aria-invalid={error ? true : undefined}
        value={draft ?? value}
        maxLength={maxLength}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const r = gesture.update(toCommand(text));
          setError(r.ok ? null : r.summary);
        }}
        onBlur={end}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <p id={noteId} className={error ? "field__error" : "field__help"} role={error ? "alert" : undefined}>
        {error ?? help}
      </p>
    </div>
  );
}

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

/** Which row is open, read as none once that row has gone from under it (an undo, an agent). */
export function useOpenRow(ids: readonly string[]): [string | null, (id: string | null) => void] {
  const [open, setOpen] = useState<string | null>(null);
  return [open !== null && ids.includes(open) ? open : null, setOpen];
}

// ---------------------------------------------------------------------------- layout

/** The entity's icon, name and where it is. */
export function EntityHead({ icon: Icon, title, sub, id, tone = "accent" }: { icon: IconComponent; title: ReactNode; sub?: ReactNode; id?: string; tone?: "accent" | "neutral" }) {
  return (
    <header className="insp-head">
      <span className={`insp-head__icon insp-head__icon--${tone}`} aria-hidden="true">
        <Icon />
      </span>
      <div className="insp-head__text">
        <h2 className="insp-head__title">{title}</h2>
        {sub ? <p className="insp-head__sub">{sub}</p> : null}
        {id ? <p className="insp-head__id code">{id}</p> : null}
      </div>
    </header>
  );
}

/** Figures with their labels, in the drawing face. */
export function Stats({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="insp-stats">
      {items.map((s) => (
        <div key={s.label} className="insp-stats__item">
          <dt>{s.label}</dt>
          <dd className="num">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A line about what the agent can do here, in the agent's colour. */
export function AgentCallout({ children }: { children: ReactNode }) {
  return (
    <p className="insp-agent">
      <IconAgent size="sm" />
      <span>{children}</span>
    </p>
  );
}

/** The footer: how to remove and undo by key, and the remove button. */
export function InspectorFoot({ action }: { action: ReactNode }) {
  return (
    <footer className="insp-foot">
      <span className="insp-foot__hint">
        <Kbd keys="del" /> removes, <Kbd keys="mod+z" /> undoes
      </span>
      {action}
    </footer>
  );
}
