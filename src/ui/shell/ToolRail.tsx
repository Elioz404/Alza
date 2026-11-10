/**
 * The tool rail: a vertical toolbar (a bottom one on phones) of the current view's tools, each
 * a toggle with its key in the button's corner and in the tooltip, in groups with a rule
 * between them. Arrow keys move along the buttons, Tab leaves the rail (roving tabindex, the
 * WAI toolbar pattern); the rules are not stops.
 */

import { Fragment, useRef, type KeyboardEvent } from "react";
import { useAppStore } from "../useAppStore";
import { usePlanTool } from "../../editor/canvasState";
import { IconButton } from "../primitives";
import { useBreakpoint } from "../theme/media";
import { useShell } from "./ShellContext";
import { toolsFor } from "./tools";

export function ToolRail() {
  const editor = useAppStore((s) => s.editor);
  const planTool = usePlanTool();
  const shell = useShell();
  const phone = useBreakpoint("phone");
  const tools = toolsFor(editor.view);
  const activeIndex = Math.max(0, tools.findIndex((t) => t.isActive(editor, planTool)));
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = phone ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let to = -1;
    if (e.key === next[0]) to = (at + 1) % buttons.length;
    else if (e.key === next[1]) to = (at - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = buttons.length - 1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to].focus();
  };

  return (
    <div
      ref={ref}
      className="rail"
      role="toolbar"
      aria-label={editor.view === "2d" ? "Plan tools" : "3D view tools"}
      aria-orientation={phone ? "horizontal" : "vertical"}
      onKeyDown={onKeyDown}
    >
      {tools.map((tool, i) => (
        <Fragment key={tool.id}>
          {i > 0 && tools[i - 1].group !== tool.group ? (
            <span className="rail__sep" role="separator" aria-orientation={phone ? "vertical" : "horizontal"} />
          ) : null}
          <IconButton
            icon={tool.icon}
            label={tool.label}
            hint={tool.hint}
            shortcut={tool.shortcut}
            variant="rail"
            isPressed={tool.isActive(editor, planTool)}
            tabIndex={i === activeIndex ? 0 : -1}
            tooltipPlacement={phone ? "above" : "end"}
            onClick={() => tool.run(shell)}
          >
            <span className="rail__key" aria-hidden="true">
              {tool.shortcut.toUpperCase()}
            </span>
          </IconButton>
        </Fragment>
      ))}
    </div>
  );
}
