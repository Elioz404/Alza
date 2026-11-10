/**
 * The page's frame: top bar, tool rail, canvas, side panel. The layout (a grid over 1024px, a
 * drawer under it, one column and a bottom sheet at phone width) is all in shell.css; this only
 * places the regions and the page-wide pieces that belong to no region: the shell's keyboard
 * shortcuts, the shortcut sheet, and the partner's always-mounted transport frame.
 */

import "./shell.css";
import { SupplierBridge } from "../SupplierBridge";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { CanvasRegion } from "./CanvasRegion";
import { SidePanel } from "./SidePanel";
import { lazyLayer } from "../LazyLayer";
import { useShell } from "./ShellContext";
import { useShellShortcuts } from "./shortcuts";
import { CANVAS_REGION_ID } from "./ids";

/** The shortcut sheet, fetched the first time it opens. */
const ShortcutsDialog = lazyLayer(() => import("./ShortcutsDialog").then((m) => m.ShortcutsDialog));

export function AppShell() {
  const shell = useShell();
  useShellShortcuts(shell);
  return (
    <div className="shell" data-panel-open={shell.panelOpen}>
      <a className="skip-link" href={`#${CANVAS_REGION_ID}`}>
        Skip to the plan
      </a>
      <TopBar />
      <ToolRail />
      <CanvasRegion />
      <SidePanel />
      <ShortcutsDialog isOpen={shell.helpOpen} onOpenChange={shell.setHelpOpen} />
      <SupplierBridge />
    </div>
  );
}
