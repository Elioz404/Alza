/**
 * A segmented control: one choice out of a few, all in view (Plan | 3D, the camera, a floor
 * finish). A `radiogroup` of `radio`s, named by `label`.
 *
 *   <SegmentedControl label="View" value={view} onChange={setView} size="sm" className="view-switch">
 *     <SegmentedControlItem value="2d" label="Plan" icon={<IconPlan size="sm" />} />
 *     <SegmentedControlItem value="3d" label="3D" isDisabled={!canShow3d} />
 *   </SegmentedControl>
 *
 * One tab stop: the chosen segment (or the first that can be chosen). The arrow keys move to
 * the previous and next segment, wrapping and skipping the disabled ones, Home and End to the
 * first and last, and the segment focus lands on is chosen (as a radio group does). A disabled
 * segment says why through a Tip around the control; `describedBy` names it (the Tip's id) and
 * it describes the chosen segment, where focus lands, and every disabled one, so the reason is
 * read on the radio itself, not only on the group around it.
 *
 * `isLabelHidden` keeps a segment's label as its name and shows only its icon (phone widths).
 */

import "./segmented.css";
import { createContext, use, useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedControlSize = "sm" | "md";

interface SegmentedContextValue {
  value: string;
  onChange: (value: string) => void;
  describedBy: string | undefined;
}

const SegmentedContext = createContext<SegmentedContextValue | null>(null);

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "role" | "children"> {
  value: string;
  onChange: (value: string) => void;
  /** the group's accessible name */
  label: string;
  size?: SegmentedControlSize;
  /** "fill" stretches the control and shares its width between the segments */
  layout?: "hug" | "fill";
  /** the id of what explains a disabled segment: it describes the chosen and the disabled ones */
  describedBy?: string;
  children: ReactNode;
}

export interface SegmentedControlItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "value" | "disabled"> {
  value: string;
  label: string;
  /** show only the icon; the label stays the segment's name */
  isLabelHidden?: boolean;
  icon?: ReactNode;
  isDisabled?: boolean;
}

const RADIO = '[role="radio"]';
const ENABLED_RADIO = '[role="radio"]:not([aria-disabled="true"])';

/** The segment a key moves to from `current` among the enabled ones, or null for a key that does not move. */
export function segmentTarget(segments: readonly HTMLElement[], current: HTMLElement, key: string): HTMLElement | null {
  const at = segments.indexOf(current);
  if (segments.length === 0) return null;
  const n = segments.length;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return segments[at < 0 ? 0 : (at + 1) % n];
    case "ArrowLeft":
    case "ArrowUp":
      return segments[at < 0 ? n - 1 : (at - 1 + n) % n];
    case "Home":
      return segments[0];
    case "End":
      return segments[n - 1];
    default:
      return null;
  }
}

export function SegmentedControl({ value, onChange, label, size = "md", layout = "hug", describedBy, className, children, onKeyDown, ...rest }: SegmentedControlProps) {
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const current = (e.target as Element).closest<HTMLElement>(RADIO);
    if (!current) return;
    const next = segmentTarget([...e.currentTarget.querySelectorAll<HTMLElement>(ENABLED_RADIO)], current, e.key);
    if (!next) return;
    e.preventDefault();
    next.focus();
    const nextValue = next.dataset.value;
    if (nextValue !== undefined && nextValue !== value) onChange(nextValue);
  };
  // One tab stop: the chosen segment draws it itself; when that one cannot be chosen (or none
  // is), the first segment that can be takes it, so the group is never out of the tab order.
  const groupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const stop = group.querySelector<HTMLElement>(`${ENABLED_RADIO}[aria-checked="true"]`) ?? group.querySelector<HTMLElement>(ENABLED_RADIO);
    for (const segment of group.querySelectorAll<HTMLElement>(RADIO)) segment.tabIndex = segment === stop ? 0 : -1;
  });
  const classes = ["seg", `seg--${size}`, layout === "fill" ? "seg--fill" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <SegmentedContext value={{ value, onChange, describedBy }}>
      <div {...rest} ref={groupRef} role="radiogroup" aria-label={label} data-size={size} className={classes} onKeyDown={keyDown}>
        {children}
      </div>
    </SegmentedContext>
  );
}

export function SegmentedControlItem({ value, label, isLabelHidden, icon, isDisabled, className, onClick, ...rest }: SegmentedControlItemProps) {
  const ctx = use(SegmentedContext);
  if (!ctx) throw new Error("SegmentedControlItem is used outside SegmentedControl");
  const checked = ctx.value === value;
  const describedBy = [rest["aria-describedby"], checked || isDisabled ? ctx.describedBy : undefined].filter(Boolean).join(" ") || undefined;
  const classes = ["seg__item", isLabelHidden ? "seg__item--icon" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={isDisabled || undefined}
      aria-label={isLabelHidden ? label : undefined}
      aria-describedby={describedBy}
      data-value={value}
      tabIndex={checked && !isDisabled ? 0 : -1}
      className={classes}
      onClick={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented && !checked) ctx.onChange(value);
      }}
    >
      {icon ? <span className="seg__icon">{icon}</span> : null}
      {isLabelHidden ? null : <span className="seg__label">{label}</span>}
    </button>
  );
}
