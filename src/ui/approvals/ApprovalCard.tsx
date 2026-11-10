/**
 * The request card: one pending destructive request, at the place on the plan where it would
 * happen (or docked to the canvas edge when there is no plan to point at: the 3D view, a phone).
 *
 * Everything it says is the page's account (describe.ts). Its two buttons name the action:
 * "Keep room" and "Remove room", the second in the error colour, the card's one filled button.
 * Escape keeps, Ctrl+Enter (Cmd+Enter) confirms. It is a non-modal alertdialog: it never traps
 * focus, and with several requests it pages "1 of 3".
 */

import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import type { PendingApproval } from "../../model/types";
import { useAppStore } from "../useAppStore";
import { Button, DeltaMark, IconButton, IconChevronRight, Kbd } from "../primitives";
import { Sentence } from "../activity/Sentence";
import { consequenceOf, requestText, targetFacts } from "./describe";
import { PolicyLink } from "./ApprovalPolicy";

/** How often "Just now" and "3 min ago" are brought up to date. */
const CLOCK_TICK_MS = 30_000;
const MINUTE_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

const ago = (at: number, now: number): string => {
  const minutes = Math.floor((now - at) / MINUTE_MS);
  return minutes < 1 ? "Just now" : `${minutes} min ago`;
};

export interface ApprovalCardProps {
  approval: PendingApproval;
  /** its revision number, shared with its mark on the plan and its row in Activity */
  n?: number;
  index: number;
  total: number;
  onPage(step: -1 | 1): void;
  onKeep(): void;
  onConfirm(): void;
  /** anchored next to its target, or docked to the canvas edge */
  placement: "anchored" | "docked";
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}

export function ApprovalCard({ approval: a, n, index, total, onPage, onKeep, onConfirm, placement, style, ref }: ApprovalCardProps) {
  const model = useAppStore((s) => s.model);
  const now = useNow();
  const titleId = useId();
  const effectId = useId();
  const text = requestText(a);
  const facts = targetFacts(a, model);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // the card answers it: nothing behind (a drawer, the editor) should act on it too
      e.preventDefault();
      e.stopPropagation();
      onKeep();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      // the editor removes the selection on these; never while the human is reading a removal
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={ref}
      className={`approval-card approval-card--${placement}`}
      style={style}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={effectId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-approval-id={a.id}
    >
      <div className="approval-card__head">
        <DeltaMark n={n} tone="destructive" />
        <div className="approval-card__heading">
          <h2 id={titleId} className="approval-card__title">
            {text.title}
          </h2>
          <p className="approval-card__meta">
            <code className="code">{a.tool}</code>
            <span>{ago(a.at, now)}</span>
            {total > 1 ? (
              <span className="num">
                {index + 1} of {total}
              </span>
            ) : null}
          </p>
        </div>
        {total > 1 ? (
          <div className="approval-card__pager" role="group" aria-label="Pending requests">
            <IconButton
              icon={IconChevronRight}
              iconSize="sm"
              label="Previous request"
              className="approval-card__prev"
              disabledReason={index === 0 ? "This is the first request" : null}
              onClick={() => onPage(-1)}
            />
            <IconButton
              icon={IconChevronRight}
              iconSize="sm"
              label="Next request"
              disabledReason={index === total - 1 ? "This is the last request" : null}
              onClick={() => onPage(1)}
            />
          </div>
        ) : null}
      </div>

      <dl className="approval-card__targets">
        {facts.map((f, i) => (
          <div key={i} className="approval-card__fact">
            <dt>{f.term}</dt>
            <dd className={f.quoted ? "approval-card__name" : "approval-card__value num"}>{f.quoted ? <q>{f.value}</q> : f.value}</dd>
            {f.id ? <dd className="code approval-card__id">{f.id}</dd> : null}
          </div>
        ))}
      </dl>

      <p id={effectId} className="approval-card__effect">
        <Sentence text={consequenceOf(a)} />
      </p>

      <div className="approval-card__actions">
        <Button variant="secondary" onClick={onKeep}>
          {text.keep}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {text.confirm}
        </Button>
      </div>

      <div className="approval-card__foot">
        <span className="approval-card__keys">
          <Kbd keys="escape" /> keep <Kbd keys="mod+enter" /> {text.verb}
        </span>
        <PolicyLink>Settings</PolicyLink>
      </div>
    </div>
  );
}
