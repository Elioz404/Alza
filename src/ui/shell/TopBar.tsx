/**
 * The top bar: the mark and the plan's name (its menu holds rename, the demo and clearing),
 * whether the plan is saved, the Plan | 3D switch (fixed in the centre, the same in both
 * views), Undo, Export, the agent's status with its waiting requests, help, and on narrow
 * screens the panel toggle.
 */

import { useId, useState } from "react";
import { pageActions } from "../../model/store";
import { dispatch } from "../../model/commands";
import { useAppStore } from "../useAppStore";
import {
  BrandMark,
  IconButton,
  IconCube,
  IconHelp,
  IconPanel,
  IconPlan,
  IconUndo,
  SegmentedControl,
  SegmentedControlItem,
  Tip,
} from "../primitives";
import { useBreakpoint } from "../theme/media";
import { useShell } from "./ShellContext";
import { useNotify } from "./useNotify";
import { SIDE_PANEL_ID } from "./ids";
import { AgentStatus } from "../approvals/AgentStatus";
import { deferred } from "../deferred";
import { createHandoff, ExportTrigger, PlanNameTrigger, standInTriggerProps } from "./menuTriggers";
import type { MenuSlotProps } from "./PlanMenus";

/** Why the 3D view cannot open, or null when it can. */
export const noThreeDReason = (wallCount: number): string | null =>
  wallCount === 0 ? "Add a wall to see the plan in 3D" : null;

function ViewSwitch() {
  const view = useAppStore((s) => s.editor.view);
  const reason = useAppStore((s) => noThreeDReason(s.model.walls.length));
  const notify = useNotify();
  const phone = useBreakpoint("phone");
  const reasonId = useId();
  const onChange = (next: string) => {
    if (next === "2d") {
      pageActions.setView("2d");
      return;
    }
    const r = pageActions.build3d();
    if (!r.ok) notify({ body: r.summary, type: "error" });
  };
  return (
    // the reason describes the radios themselves (the chosen one, where focus lands, and the
    // disabled one), not the group around them, so it is read as focus arrives
    <Tip id={reasonId} content={reason} isEnabled={Boolean(reason)} describes={false}>
      <SegmentedControl label="View" value={view} onChange={onChange} size="sm" className="view-switch" describedBy={reason ? reasonId : undefined}>
        <SegmentedControlItem value="2d" label="Plan" isLabelHidden={phone} icon={<IconPlan size="sm" />} />
        <SegmentedControlItem value="3d" label="3D" isLabelHidden={phone} icon={<IconCube size="sm" />} isDisabled={Boolean(reason) && view === "2d"} />
      </SegmentedControl>
    </Tip>
  );
}

/** The plan menu and Export, fetched after the first paint; their triggers stand in until then. */
const LazyPlanMenu = deferred("the plan menu", () => import("./PlanMenus").then((m) => m.PlanMenu), ({ handoff }: MenuSlotProps) => (
  <PlanNameTrigger {...standInTriggerProps(handoff)} />
));
const LazyExportMenu = deferred("the export menu", () => import("./PlanMenus").then((m) => m.ExportMenu), ({ handoff }: MenuSlotProps) => (
  <ExportTrigger {...standInTriggerProps(handoff)} />
));

function PlanMenu() {
  const [handoff] = useState(createHandoff);
  return <LazyPlanMenu handoff={handoff} />;
}

function ExportMenu() {
  const [handoff] = useState(createHandoff);
  return <LazyExportMenu handoff={handoff} />;
}

export function TopBar() {
  const canUndo = useAppStore((s) => s.undoStack.length > 0);
  const shell = useShell();
  return (
    <header className="topbar">
      <div className="topbar__start">
        <span className="brand">
          <BrandMark />
          <span className="brand__word">Alza</span>
        </span>
        <span className="topbar__divider" aria-hidden="true" />
        <PlanMenu />
        <Tip content="This plan lives only in this tab: reloading starts over. Export saves a building model for CAD (IFC), a 3D model or a picture, not a plan you can open again.">
          <span className="save-state" tabIndex={0}>
            Not saved
          </span>
        </Tip>
      </div>
      <div className="topbar__center">
        <ViewSwitch />
      </div>
      <div className="topbar__end">
        <IconButton
          icon={IconUndo}
          label="Undo"
          shortcut="mod+z"
          disabledReason={canUndo ? null : "Nothing to undo"}
          onClick={() => dispatch({ type: "undo" }, { actor: "human" })}
        />
        <ExportMenu />
        <AgentStatus />
        <IconButton icon={IconHelp} label="Keyboard shortcuts" shortcut="?" className="topbar__help" onClick={() => shell.setHelpOpen(true)} />
        <IconButton
          icon={IconPanel}
          label={shell.panelOpen ? "Hide panel" : "Show panel"}
          className="topbar__panel-toggle"
          aria-expanded={shell.panelOpen}
          aria-controls={SIDE_PANEL_ID}
          onClick={() => shell.setPanelOpen(!shell.panelOpen)}
        />
      </div>
    </header>
  );
}

