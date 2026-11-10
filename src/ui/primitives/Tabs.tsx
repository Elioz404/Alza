/**
 * Tabs over one panel, as the WAI-ARIA tabs pattern has them: a `tablist` of `tab`s, each
 * naming the `tabpanel` it shows (aria-controls; the panel points back with aria-labelledby).
 *
 *   <Tabs value={tab} onChange={setTab} aria-label="Panel">
 *     <Tab id="panel-tab-notes" value="notes" label="Notes" panelId="panel-body-notes" endContent={<Badge>2</Badge>} />
 *   </Tabs>
 *
 * One tab stop: the selected tab. Left and Right move to the previous and next tab (wrapping),
 * Home and End to the first and last, and the tab focus lands on is shown at once (automatic
 * activation: every panel is cheap to show). Enter, Space and a click select as well.
 *
 * A tab's name is its label and whatever follows it (a count badge: "Issues 3"); the label is
 * drawn once. Its width is reserved at the selected (heavier) weight, so selecting a tab never
 * moves its neighbours.
 */

import "./tabs.css";
import { createContext, use, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "role"> {
  /** the selected tab's value */
  value: string;
  onChange: (value: string) => void;
  /** the list's accessible name */
  "aria-label": string;
  children: ReactNode;
}

export interface TabProps extends Omit<HTMLAttributes<HTMLButtonElement>, "children" | "id"> {
  id: string;
  value: string;
  label: string;
  /** the id of the panel this tab shows */
  panelId: string;
  /** shown after the label (a count), and part of the tab's name */
  endContent?: ReactNode;
}

const TAB = '[role="tab"]';

/** The tab a key moves to from `current`, or null for a key that does not move. */
export function tabTarget(tabs: readonly HTMLElement[], current: HTMLElement, key: string): HTMLElement | null {
  const at = tabs.indexOf(current);
  if (at < 0 || tabs.length === 0) return null;
  switch (key) {
    case "ArrowRight":
      return tabs[(at + 1) % tabs.length];
    case "ArrowLeft":
      return tabs[(at - 1 + tabs.length) % tabs.length];
    case "Home":
      return tabs[0];
    case "End":
      return tabs[tabs.length - 1];
    default:
      return null;
  }
}

export function Tabs({ value, onChange, className, children, onKeyDown, ...rest }: TabsProps) {
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const current = (e.target as Element).closest<HTMLElement>(TAB);
    if (!current) return;
    const next = tabTarget([...e.currentTarget.querySelectorAll<HTMLElement>(TAB)], current, e.key);
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const nextValue = next.dataset.value;
    if (nextValue !== undefined && nextValue !== value) onChange(nextValue);
  };
  return (
    <TabsContext value={{ value, onChange }}>
      <div {...rest} role="tablist" aria-orientation="horizontal" className={`tabs${className ? ` ${className}` : ""}`} onKeyDown={keyDown}>
        {children}
      </div>
    </TabsContext>
  );
}

export function Tab({ id, value, label, panelId, endContent, className, onClick, ...rest }: TabProps) {
  const ctx = use(TabsContext);
  if (!ctx) throw new Error("Tab is used outside Tabs");
  const selected = ctx.value === value;
  return (
    <button
      {...rest}
      type="button"
      id={id}
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      data-value={value}
      className={`tabs__tab${className ? ` ${className}` : ""}`}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !selected) ctx.onChange(value);
      }}
    >
      <span className="tabs__label" data-label={label}>
        <span className="tabs__text">{label}</span>
      </span>
      {endContent !== undefined && endContent !== null ? <span className="tabs__end">{endContent}</span> : null}
    </button>
  );
}
