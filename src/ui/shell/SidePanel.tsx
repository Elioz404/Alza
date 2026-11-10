/**
 * The side panel: four tabs (Properties | Library | Issues | Notes) over the slot each surface
 * fills, and under them Activity, collapsible, holding the "Waiting for you" queue, the
 * activity list and Developer tools, with the note composer pinned to its foot (it stays there
 * while the rest scrolls, and while Activity is folded).
 *
 * Over 1024px it is a column of the grid. At or under it, a drawer over the canvas; at or
 * under 640px, a bottom sheet. Either way the same element (SIDE_PANEL_ID), toggled from the
 * top bar, closed with its close button or Escape.
 */

import { useEffect, useId, type ReactNode } from "react";
import { Badge, IconButton, IconChevronDown, IconClose, Tab, Tabs } from "../primitives";
import { useBreakpoint } from "../theme/media";
import { Inspector } from "../inspector/Inspector";
import { Library } from "../library/Library";
import { Issues, useIssueCount } from "../issues/Issues";
import { Notes, useNoteCount } from "../notes/Notes";
import { NoteComposer } from "../notes/NoteComposer";
import { ActivityList } from "../activity/Activity";
import { DeveloperTools } from "../activity/DeveloperTools";
import { ApprovalQueue } from "../approvals/ApprovalQueue";
import { ApprovalPolicy } from "../approvals/ApprovalPolicy";
import { useAppStore } from "../useAppStore";
import { PANEL_TABS, useShell, type PanelTab } from "./ShellContext";
import { SIDE_PANEL_ID, panelBodyId, panelTabId } from "./ids";

const TAB_LABEL: Record<PanelTab, string> = {
  properties: "Properties",
  library: "Library",
  issues: "Issues",
  notes: "Notes",
};

const TAB_BODY: Record<PanelTab, () => ReactNode> = {
  properties: () => <Inspector />,
  library: () => <Library />,
  issues: () => <Issues />,
  notes: () => <Notes />,
};

const tabId = (tab: PanelTab) => panelTabId(tab);
const bodyId = (tab: PanelTab) => panelBodyId(tab);

function Activity() {
  const { activityOpen, setActivityOpen } = useShell();
  const waiting = useAppStore((s) => s.approvals.length);
  const listId = useId();
  return (
    <section className="activity" data-open={activityOpen} aria-label="Activity">
      <h2 className="activity__head">
        <button
          type="button"
          className="activity__toggle"
          aria-expanded={activityOpen}
          aria-controls={listId}
          onClick={() => setActivityOpen(!activityOpen)}
        >
          <IconChevronDown size="sm" className="activity__chevron" />
          Activity
          {waiting > 0 ? <Badge tone="error">{waiting} waiting</Badge> : null}
        </button>
      </h2>
      <div id={listId} className="activity__body" hidden={!activityOpen}>
        <ApprovalQueue />
        <ApprovalPolicy />
        <ActivityList />
        <DeveloperTools />
      </div>
      <div className="activity__compose">
        <NoteComposer />
      </div>
    </section>
  );
}

export function SidePanel() {
  const { tab, setTab, panelOpen, setPanelOpen } = useShell();
  const narrow = useBreakpoint("drawer");
  const issues = useIssueCount();
  const notes = useNoteCount();
  const counts: Partial<Record<PanelTab, number>> = { issues, notes };

  // Escape closes the drawer, unless something inside handled it first (a menu, a dialog)
  useEffect(() => {
    if (!narrow || !panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, panelOpen, setPanelOpen]);

  return (
    <aside id={SIDE_PANEL_ID} className="side" data-open={panelOpen} aria-label="Plan panel">
      <div className="side__head">
        <Tabs role="tablist" value={tab} onChange={(v) => setTab(v as PanelTab)} aria-label="Panel" size="md" className="side__tabs">
          {PANEL_TABS.map((t) => (
            <Tab
              key={t}
              id={tabId(t)}
              value={t}
              label={TAB_LABEL[t]}
              panelId={bodyId(t)}
              endContent={counts[t] ? <Badge tone={t === "notes" ? "agent" : t === "issues" ? "warning" : "neutral"}>{counts[t]}</Badge> : undefined}
            />
          ))}
        </Tabs>
        <IconButton icon={IconClose} label="Close panel" className="side__close" onClick={() => setPanelOpen(false)} />
      </div>
      <div id={bodyId(tab)} className="side__body" role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={0}>
        {TAB_BODY[tab]()}
      </div>
      <Activity />
    </aside>
  );
}
