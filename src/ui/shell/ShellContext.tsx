/**
 * The shell's own state: which side-panel tab is showing, whether the panel is open (it is a
 * drawer or a bottom sheet on narrow screens), whether Activity is expanded, and the shortcut
 * sheet. Page chrome only: nothing here is part of the plan, so none of it goes through
 * dispatch or the store.
 *
 * Surfaces reach it with useShell(): `openPanel("library")` shows a tab (and opens the drawer
 * where there is one), `focusApprovals()` brings the "Waiting for you" queue into view.
 */

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { APPROVALS_REGION_ID } from "./ids";

export const PANEL_TABS = ["properties", "library", "issues", "notes"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export interface ShellState {
  tab: PanelTab;
  setTab(tab: PanelTab): void;
  /** the drawer or sheet is open (on wide screens the panel always shows and this is ignored) */
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
  /** show a tab, opening the drawer or sheet if there is one */
  openPanel(tab?: PanelTab): void;
  activityOpen: boolean;
  setActivityOpen(open: boolean): void;
  /** open the panel and Activity, then move focus to the pending approvals */
  focusApprovals(): void;
  helpOpen: boolean;
  setHelpOpen(open: boolean): void;
}

const ShellContext = createContext<ShellState | null>(null);

/** After React has painted what a state change asked for. */
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

export function ShellProvider({ children, initialTab = "properties" }: { children: ReactNode; initialTab?: PanelTab }) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const openPanel = useCallback((next?: PanelTab) => {
    if (next) setTab(next);
    setPanelOpen(true);
  }, []);

  const focusApprovals = useCallback(() => {
    setPanelOpen(true);
    setActivityOpen(true);
    afterPaint(() => {
      const region = document.getElementById(APPROVALS_REGION_ID);
      region?.scrollIntoView({ block: "nearest" });
      region?.focus({ preventScroll: true });
    });
  }, []);

  const value = useMemo<ShellState>(
    () => ({ tab, setTab, panelOpen, setPanelOpen, openPanel, activityOpen, setActivityOpen, focusApprovals, helpOpen, setHelpOpen }),
    [tab, panelOpen, openPanel, activityOpen, focusApprovals, helpOpen],
  );
  return <ShellContext value={value}>{children}</ShellContext>;
}

export function useShell(): ShellState {
  const shell = use(ShellContext);
  if (!shell) throw new Error("useShell() needs a <ShellProvider> above it.");
  return shell;
}
