/**
 * Buttons. One filled button per surface (`primary`, or `danger` when the one action destroys
 * something); everything else is `secondary` or `ghost`.
 *
 * A button that cannot act right now says why: pass `disabledReason` instead of `disabled`. It
 * stays focusable (aria-disabled), ignores presses, and shows the reason as its tooltip and its
 * accessible description, so the person is never left with a dead control and no explanation.
 */

import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Kbd } from "./Kbd";
import { Tip } from "./Tip";
import type { IconComponent } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** a leading icon from ./icons */
  icon?: IconComponent;
  /** a trailing icon (a menu's chevron) */
  endIcon?: IconComponent;
  /** a shortcut chip after the label, in Kbd notation */
  shortcut?: string;
  /** fill the row, label at the start */
  isBlock?: boolean;
  /** why the button cannot act right now; makes it aria-disabled */
  disabledReason?: string | null;
  children?: ReactNode;
}

export function Button({
  ref,
  variant = "secondary",
  size = "md",
  icon: Icon,
  endIcon: EndIcon,
  shortcut,
  isBlock,
  disabledReason,
  className,
  onClick,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const blocked = Boolean(disabledReason);
  const classes = ["btn", `btn--${variant}`, size === "sm" ? "btn--sm" : "", isBlock ? "btn--block" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      aria-disabled={blocked || rest["aria-disabled"] || undefined}
      aria-describedby={blocked ? reasonId : rest["aria-describedby"]}
      onClick={blocked ? (e) => e.preventDefault() : onClick}
    >
      {Icon ? <Icon size={size === "sm" ? "sm" : "md"} /> : null}
      {children !== undefined ? <span className="btn__label">{children}</span> : null}
      {shortcut ? <Kbd keys={shortcut} className="btn__kbd" /> : null}
      {EndIcon ? <EndIcon size="sm" className="btn__end" /> : null}
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
  return blocked ? <Tip content={disabledReason}>{button}</Tip> : button;
}
