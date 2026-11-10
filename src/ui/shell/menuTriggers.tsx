/**
 * The controls the top bar's two menus hang off: the plan's name and Export. They are in the
 * first chunk; the menus themselves (Astryx's DropdownMenu and what it brings) are not
 * (PlanMenus.tsx, fetched with the idle prefetch after the first paint, src/ui/deferred.tsx).
 *
 * Until a menu's code arrives its trigger is drawn here, the same control with the same name,
 * so nothing moves when the menu takes it over. Whatever the person did with it in between is
 * handed over: focus stays on the control, and a press (click, Enter, Space, an arrow key)
 * opens the menu as soon as it can.
 */

import type { KeyboardEvent, Ref } from "react";
import { IconChevronDown, IconDownload } from "../primitives";
import type { MenuTriggerProps } from "../primitives/astryx";
import { useAppStore } from "../useAppStore";

/** What a trigger is given: Astryx's trigger props once the menu is here, the stand-in's before. */
export type TriggerProps = Partial<Omit<MenuTriggerProps, "ref">> & {
  ref?: Ref<HTMLButtonElement>;
};

export function PlanNameTrigger(props: TriggerProps) {
  const name = useAppStore((s) => s.model.name);
  return (
    <button {...props} type="button" className="plan-name" aria-label={`Plan: ${name}`}>
      <span className="plan-name__text">{name}</span>
      <IconChevronDown size="sm" />
    </button>
  );
}

export function ExportTrigger(props: TriggerProps) {
  return (
    <button {...props} type="button" className="btn btn--ghost topbar__export">
      <IconDownload />
      <span className="btn__label">Export</span>
      <IconChevronDown size="sm" className="btn__end" />
    </button>
  );
}

/** What happened to a stand-in trigger before its menu arrived. */
export interface TriggerHandoff {
  focus(): void;
  requestOpen(): void;
  /** read and clear: whether the control has focus, and whether a press asked for the menu */
  take(): { focused: boolean; open: boolean };
}

export function createHandoff(): TriggerHandoff {
  let focused = false;
  let open = false;
  return {
    focus: () => (focused = true),
    requestOpen: () => (open = true),
    take() {
      const taken = { focused, open };
      focused = false;
      open = false;
      return taken;
    },
  };
}

/** The keys that open a menu button (the APG pattern); Enter and Space also arrive as a click. */
const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp"]);

/** The stand-in's props: a closed menu button that remembers what was done to it. */
export function standInTriggerProps(handoff: TriggerHandoff): TriggerProps {
  return {
    "aria-haspopup": "menu",
    "aria-expanded": false,
    onFocus: handoff.focus,
    onClick: handoff.requestOpen,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!OPEN_KEYS.has(e.key)) return;
      e.preventDefault();
      handoff.requestOpen();
    },
  };
}

/**
 * The menu's side of the handoff, run as it mounts with its trigger element: open it if a press
 * asked for it (a synthesized click opens it as a keyboard would, on its first item), or give
 * focus back to the control if it had it when the stand-in went (focus then fell to the body;
 * if the person has moved on to something else since, it stays there).
 */
export function receiveHandoff(handoff: TriggerHandoff, trigger: HTMLElement | null): void {
  const { focused, open } = handoff.take();
  if (!trigger) return;
  if (open) trigger.click();
  else if (focused && (document.activeElement === null || document.activeElement === document.body)) trigger.focus();
}
