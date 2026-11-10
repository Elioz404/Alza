/**
 * The panel furniture every surface is built from: a scrolling Panel, titled Sections separated
 * by hairlines (never by shadows or nested cards), count Badges, and EmptyStates that teach.
 */

import type { HTMLAttributes, ReactNode } from "react";
import type { IconComponent } from "./icons";

/** A scrolling column with the panel's padding and section rhythm. */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`panel${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </div>
  );
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** the section's heading, sentence case, no eyebrow above it */
  title?: ReactNode;
  /** heading level inside the panel's outline (default 3) */
  level?: 2 | 3 | 4;
  /** controls or secondary data at the end of the title row */
  action?: ReactNode;
}

/** A titled group. Sections that follow one another are divided by a hairline. */
export function Section({ title, level = 3, action, className, children, ...rest }: SectionProps) {
  const H = `h${level}` as const;
  return (
    <section className={`section${className ? ` ${className}` : ""}`} {...rest}>
      {title || action ? (
        <div className="section__head">
          {title ? <H className="section__title">{title}</H> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type BadgeTone = "neutral" | "accent" | "agent" | "error" | "warning";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** A count or a short state next to a label. Text, never colour alone. */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </span>
  );
}

export interface EmptyStateProps {
  /** what belongs here, as a sentence */
  title: ReactNode;
  /** why it matters, or how it fills */
  body?: ReactNode;
  icon?: IconComponent;
  /** the one action that fills it (a Button), and at most one secondary */
  actions?: ReactNode;
  /** compact: inside a list or a section rather than a whole region */
  size?: "region" | "inline";
  className?: string;
}

/** An empty region that says what goes here and offers the action that fills it. */
export function EmptyState({ title, body, icon: Icon, actions, size = "inline", className }: EmptyStateProps) {
  return (
    <div className={`empty empty--${size}${className ? ` ${className}` : ""}`}>
      {Icon ? <Icon size="lg" className="empty__icon" /> : null}
      <p className="empty__title">{title}</p>
      {body ? <p className="empty__body">{body}</p> : null}
      {actions ? <div className="empty__actions">{actions}</div> : null}
    </div>
  );
}
