/**
 * An icon-only button. It always has a name (`label`, read by assistive technology and shown as
 * its tooltip together with its shortcut), so an icon never stands alone.
 *
 * `isPressed` makes it a toggle (aria-pressed): the tool rail's tools, a panel toggle.
 * Its visible box follows --size-control; the hit area grows to --size-hit without moving it.
 */

import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Tip, type TipProps } from "./Tip";
import type { IconComponent, IconSize } from "./icons";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  ref?: Ref<HTMLButtonElement>;
  icon: IconComponent;
  /** the accessible name and the tooltip */
  label: string;
  /** a second tooltip line or longer explanation; the label stays the name */
  hint?: ReactNode;
  shortcut?: string;
  variant?: "ghost" | "secondary" | "rail";
  isPressed?: boolean;
  disabledReason?: string | null;
  iconSize?: IconSize;
  tooltipPlacement?: TipProps["placement"];
  /** extra content after the icon (a count) */
  children?: ReactNode;
}

export function IconButton({
  ref,
  icon: Icon,
  label,
  hint,
  shortcut,
  variant = "ghost",
  isPressed,
  disabledReason,
  iconSize,
  tooltipPlacement = "below",
  className,
  onClick,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  const reasonId = useId();
  const blocked = Boolean(disabledReason);
  const classes = ["icon-btn", `icon-btn--${variant}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <Tip
      content={
        <>
          {label}
          {hint || disabledReason ? <span className="tip__sub">{disabledReason ?? hint}</span> : null}
        </>
      }
      shortcut={blocked ? undefined : shortcut}
      placement={tooltipPlacement}
    >
      <button
        {...rest}
        ref={ref}
        type={type}
        className={classes}
        aria-label={label}
        aria-pressed={isPressed}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : rest["aria-describedby"]}
        aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
        onClick={blocked ? (e) => e.preventDefault() : onClick}
      >
        <Icon size={iconSize ?? (variant === "rail" ? "lg" : "md")} />
        {children}
        {blocked ? (
          <span id={reasonId} className="sr-only">
            {disabledReason}
          </span>
        ) : null}
      </button>
    </Tip>
  );
}

/** Kbd notation ("mod+z", "shift+/") as aria-keyshortcuts wants it ("Control+Z"). */
export function ariaShortcut(keys: string): string {
  const names: Record<string, string> = { mod: "Control", ctrl: "Control", alt: "Alt", shift: "Shift", esc: "Escape", escape: "Escape", enter: "Enter" };
  return keys
    .split("+")
    .map((k) => names[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k))
    .join("+");
}
