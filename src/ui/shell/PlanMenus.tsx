/**
 * The top bar's two menus: the plan menu (rename, the demo, clearing; at phone width the export
 * entries too) and Export. Fetched apart from the first chunk (src/ui/deferred.tsx): their
 * triggers are drawn by menuTriggers.tsx until this arrives, and hand over what was done to them.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { dispatch } from "../../model/commands";
import { seedLoft } from "../../model/seed";
import { bus, EVENTS } from "../../model/sceneBus";
import { useAppStore } from "../useAppStore";
import { IconCamera, IconDownload, Menu, MenuDivider, MenuItem, type MenuTriggerProps } from "../primitives";
import { useBreakpoint } from "../theme/media";
import { useShell } from "./ShellContext";
import { useNotify } from "./useNotify";
import { PLAN_NAME_FIELD_ID } from "./ids";
import { ExportTrigger, PlanNameTrigger, receiveHandoff, type TriggerHandoff, type TriggerProps } from "./menuTriggers";

export interface MenuSlotProps {
  handoff: TriggerHandoff;
}

/** Astryx's trigger props with its ref joined to one that takes the stand-in's handoff. */
function useHandoffTrigger(handoff: TriggerHandoff) {
  const element = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => receiveHandoff(handoff, element.current), [handoff]);
  return useCallback(
    (props: MenuTriggerProps): TriggerProps => ({
      ...props,
      ref: (el: HTMLButtonElement | null) => {
        element.current = el;
        props.ref(el);
      },
    }),
    [],
  );
}

export function PlanMenu({ handoff }: MenuSlotProps) {
  const isEmpty = useAppStore((s) => s.model.walls.length + s.model.rooms.length + s.model.items.length + s.model.openings.length === 0);
  const shell = useShell();
  const notify = useNotify();
  // the Export button gives way at phone width; its entries move here
  const phone = useBreakpoint("phone");
  const trigger = useHandoffTrigger(handoff);

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
    <Menu renderTrigger={(props) => <PlanNameTrigger {...trigger(props)} />}>
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

export function ExportMenu({ handoff }: MenuSlotProps) {
  const trigger = useHandoffTrigger(handoff);
  return (
    <Menu renderTrigger={(props) => <ExportTrigger {...trigger(props)} />} alignment="end">
      <ExportItems />
    </Menu>
  );
}
