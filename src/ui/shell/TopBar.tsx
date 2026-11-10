/**
 * The top bar: the mark and the plan's name (its menu holds rename, the demo and clearing),
 * whether the plan is saved, the Plan | 3D switch (fixed in the centre, the same in both
 * views), Undo, Export, the agent's status with its waiting requests, help, and on narrow
 * screens the panel toggle.
 */

import { pageActions } from "../../model/store";
import { dispatch } from "../../model/commands";
import { seedLoft } from "../../model/seed";
import { bus, EVENTS } from "../../model/sceneBus";
import { useAppStore } from "../useAppStore";
import {
  BrandMark,
  IconButton,
  IconCamera,
  IconChevronDown,
  IconCube,
  IconDownload,
  IconHelp,
  IconPanel,
  IconPlan,
  IconUndo,
  Menu,
  MenuDivider,
  MenuItem,
  SegmentedControl,
  SegmentedControlItem,
  Tip,
} from "../primitives";
import { useBreakpoint } from "../theme/media";
import { useShell } from "./ShellContext";
import { useNotify } from "./useNotify";
import { PLAN_NAME_FIELD_ID, SIDE_PANEL_ID } from "./ids";
import { AgentStatus } from "../approvals/AgentStatus";

/** Why the 3D view cannot open, or null when it can. */
export const noThreeDReason = (wallCount: number): string | null =>
  wallCount === 0 ? "Add a wall to see the plan in 3D" : null;

function PlanMenu() {
  const name = useAppStore((s) => s.model.name);
  const isEmpty = useAppStore((s) => s.model.walls.length + s.model.rooms.length + s.model.items.length + s.model.openings.length === 0);
  const shell = useShell();
  const notify = useNotify();
  // the Export button gives way at phone width; its entries move here
  const phone = useBreakpoint("phone");

  const rename = () => {
    shell.openPanel("properties");
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(PLAN_NAME_FIELD_ID)?.focus()));
  };
  const loadDemo = () => {
    const r = dispatch({ type: "load_model", model: seedLoft() }, { actor: "human" });
    if (r.ok) notify({ body: "Sunset Loft demo loaded", undoable: true });
  };
  const clear = () => {
    const r = dispatch({ type: "clear_model" }, { actor: "human" });
    if (r.ok) notify({ body: "Plan cleared", undoable: true });
  };

  return (
    <Menu
      renderTrigger={(props) => (
        <button {...props} type="button" className="plan-name" aria-label={`Plan: ${name}`}>
          <span className="plan-name__text">{name}</span>
          <IconChevronDown size="sm" />
        </button>
      )}
    >
      <MenuItem label="Rename" onClick={rename} />
      <MenuDivider />
      <MenuItem label="Load Sunset Loft demo" description="Replaces this plan; Undo brings it back" onClick={loadDemo} />
      <MenuItem
        label="Clear plan"
        variant="destructive"
        isDisabled={isEmpty}
        description={isEmpty ? "The plan is already empty" : "Removes everything; Undo brings it back"}
        onClick={clear}
      />
      {phone ? (
        <>
          <MenuDivider />
          <ExportItems />
        </>
      ) : null}
    </Menu>
  );
}

function ViewSwitch() {
  const view = useAppStore((s) => s.editor.view);
  const reason = useAppStore((s) => noThreeDReason(s.model.walls.length));
  const notify = useNotify();
  const phone = useBreakpoint("phone");
  const onChange = (next: string) => {
    if (next === "2d") {
      pageActions.setView("2d");
      return;
    }
    const r = pageActions.build3d();
    if (!r.ok) notify({ body: r.summary, type: "error" });
  };
  return (
    <Tip content={reason} isEnabled={Boolean(reason)}>
      <SegmentedControl label="View" value={view} onChange={onChange} size="sm" className="view-switch">
        <SegmentedControlItem value="2d" label="Plan" isLabelHidden={phone} icon={<IconPlan size="sm" />} />
        <SegmentedControlItem value="3d" label="3D" isLabelHidden={phone} icon={<IconCube size="sm" />} isDisabled={Boolean(reason) && view === "2d"} />
      </SegmentedControl>
    </Tip>
  );
}

/** The export entries, shared by the Export menu and, at phone width, the plan menu. */
function ExportItems() {
  const in3d = useAppStore((s) => s.editor.view === "3d");
  const why = in3d ? undefined : "Open the 3D view to export";
  return (
    <>
      <MenuItem label="3D model (OBJ)" description={why} isDisabled={!in3d} icon={<IconDownload size="sm" />} onClick={() => bus.emit(EVENTS.EXPORT_OBJ)} />
      <MenuItem label="Snapshot (PNG)" description={why} isDisabled={!in3d} icon={<IconCamera size="sm" />} onClick={() => bus.emit(EVENTS.EXPORT_PNG)} />
    </>
  );
}

function ExportMenu() {
  return (
    <Menu
      renderTrigger={(props) => (
        <button {...props} type="button" className="btn btn--ghost topbar__export">
          <IconDownload />
          <span className="btn__label">Export</span>
          <IconChevronDown size="sm" className="btn__end" />
        </button>
      )}
      alignment="end"
    >
      <ExportItems />
    </Menu>
  );
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
        <Tip content="This plan lives only in this tab: reloading starts over. Export saves a 3D model or a picture, not a plan you can open again.">
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

