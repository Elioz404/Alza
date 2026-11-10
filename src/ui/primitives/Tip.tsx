/**
 * A tooltip: Astryx's (anchor positioning, Popover API, Escape, never steals focus), with the
 * page's timing and an optional shortcut chip. Hover waits MOTION.tooltipDelayMs; keyboard
 * focus shows it at once.
 *
 * A tooltip names or explains; it never holds the only copy of something the person needs to
 * act. A disabled control's reason goes here and in its accessible description.
 */

import type { ReactNode } from "react";
import { Tooltip, type TooltipProps } from "@astryxdesign/core/Tooltip";
import { Kbd } from "./Kbd";
import { MOTION } from "../theme/tokens";

export interface TipProps {
  content: ReactNode;
  /** a shortcut in Kbd notation ("w", "mod+z", "shift+/"), shown after the text */
  shortcut?: string;
  placement?: TooltipProps["placement"];
  alignment?: TooltipProps["alignment"];
  /** false turns the tooltip off without moving the child */
  isEnabled?: boolean;
  children: ReactNode;
}

export function Tip({ content, shortcut, placement = "below", alignment, isEnabled, children }: TipProps) {
  return (
    <Tooltip
      content={
        <span className="tip">
          <span>{content}</span>
          {shortcut ? <Kbd keys={shortcut} className="tip__kbd" /> : null}
        </span>
      }
      placement={placement}
      alignment={alignment}
      delay={MOTION.tooltipDelayMs}
      isEnabled={isEnabled}
      hasHoverIndication={false}
    >
      {children}
    </Tooltip>
  );
}
