/**
 * The request card over the plan, and the leader that ties it to its target.
 *
 * The editor draws what a pending request would act on (hatched and outlined in the error
 * colour) and the agent's numbered revision marks; this layer adds the card (ApprovalCard)
 * beside that target, on whichever side has room, with a leader from the target's edge to the
 * card. In 3D, on a phone, or when the target is out of view or has no room beside it, the card
 * docks to the canvas edge and there is no leader.
 *
 * Arrival is announced politely. The card takes focus when a request arrives only if the human
 * is not in the middle of something (typing, drawing, working in a panel); Review anywhere
 * moves focus to it. Escape keeps and Ctrl+Enter confirms, from the card and from anywhere on
 * the page but a text field: the safe answer is never harder to reach than the destructive one.
 * Neither answers from inside another dialog, menu or popover, or while a modal dialog covers
 * the page, where the request cannot be seen.
 *
 * The layer lets pointer events through to the plan; only the card takes them.
 */

import "./approvals.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { store } from "../../model/store";
import type { PendingApproval } from "../../model/types";
import { canvasStore, screenOf, useCanvas } from "../../editor/canvasState";
import { useAppStore } from "../useAppStore";
import { isInsideOverlay, isTypingTarget } from "../keys";
import { useBreakpoint } from "../theme/media";
import { SPACING } from "../theme/tokens";
import { CANVAS_REGION_ID } from "../shell/ids";
import { cornersOf, requestText, targetShapes } from "./describe";
import { showRequest, useReview } from "./review";
import { useResolveApproval } from "./useResolve";
import { ApprovalCard } from "./ApprovalCard";

/** What a rem is when the page cannot say (no layout yet, as in a test DOM). */
const BROWSER_DEFAULT_FONT_PX = 16;

/** A spacing token in pixels, for geometry placed from script. */
const px = (step: keyof typeof SPACING): number => {
  const root = typeof document !== "undefined" ? parseFloat(getComputedStyle(document.documentElement).fontSize) : NaN;
  return parseFloat(SPACING[step]) * (Number.isFinite(root) && root > 0 ? root : BROWSER_DEFAULT_FONT_PX);
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An element's size, kept current. */
function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return size;
}

/** Is the human busy (typing, drawing, working in a panel) so a new request must not take focus? */
function humanIsBusy(): boolean {
  const { drawMode, pendingWallStart } = store.getState().editor;
  if (drawMode !== "select" || pendingWallStart || canvasStore.getState().tool) return true;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (isTypingTarget(active)) return true;
  // focus on the plan is fair to move; focus in a panel or a menu is not
  return !document.getElementById(CANVAS_REGION_ID)?.contains(active);
}

export function PlanMarks() {
  const approvals = useAppStore((s) => s.approvals);
  const model = useAppStore((s) => s.model);
  const in2d = useAppStore((s) => s.editor.view === "2d");
  const view = useCanvas((s) => s.view);
  const phone = useBreakpoint("phone");
  const { currentId, focusToken } = useReview();
  const resolve = useResolveApproval();

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const size = useSize(rootRef);
  const cardSize = useSize(cardRef);

  const current: PendingApproval | undefined = approvals.find((a) => a.id === currentId) ?? approvals[0];
  const index = current ? approvals.indexOf(current) : -1;

  // ---- where the target is, in canvas pixels (the plan view only)
  const box = useMemo<Box | null>(() => {
    if (!current || !in2d) return null;
    const pts = targetShapes(current, model).flatMap((s) => cornersOf(s).map((p) => screenOf(view, p.x, p.y)));
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }, [current, in2d, model, view]);

  // ---- where the card goes: beside the target, on whichever side has room
  let placement: "anchored" | "docked" = "docked";
  let cardStyle: CSSProperties | undefined;
  let leader: { x1: number; x2: number; y: number } | null = null;
  if (box && !phone && cardSize.w > 0 && size.w > 0) {
    const gap = px("8");
    const margin = px("4");
    const right = box.x1 + gap;
    const left = box.x0 - gap - cardSize.w;
    const fitsRight = right + cardSize.w <= size.w - margin;
    const fitsLeft = left >= margin;
    const inView = box.x1 > 0 && box.x0 < size.w && box.y1 > 0 && box.y0 < size.h;
    if (inView && (fitsRight || fitsLeft)) {
      const x = fitsRight ? right : left;
      const cy = (Math.max(box.y0, 0) + Math.min(box.y1, size.h)) / 2;
      const y = Math.min(Math.max(cy - cardSize.h / 2, margin), Math.max(margin, size.h - cardSize.h - margin));
      placement = "anchored";
      cardStyle = { left: x, top: y };
      const ly = Math.min(Math.max(cy, y + margin), y + cardSize.h - margin);
      leader = fitsRight ? { x1: box.x1, x2: x, y: ly } : { x1: box.x0, x2: x + cardSize.w, y: ly };
    }
  }

  // ---- arrival: announce, and take focus when nobody is busy
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<Set<string>>(new Set(approvals.map((a) => a.id)));
  const returnTo = useRef<Element | null>(null);
  const focusCard = () => {
    const card = cardRef.current;
    const active = document.activeElement;
    if (card && !card.contains(active)) {
      returnTo.current = active;
      card.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    const arrived = approvals.filter((a) => !seen.current.has(a.id));
    seen.current = new Set(approvals.map((a) => a.id));
    const newest = arrived.at(-1);
    if (!newest) return;
    const text = requestText(newest);
    setAnnouncement(`${text.title}. It is waiting for you on the plan: Control Enter to ${text.verb}, Escape to keep.`);
    if (!humanIsBusy()) requestAnimationFrame(focusCard);
  }, [approvals]);

  // ---- Review from anywhere moves focus to the card
  useEffect(() => {
    if (focusToken > 0) requestAnimationFrame(focusCard);
  }, [focusToken]);

  // ---- answering
  const answer = (granted: boolean) => {
    if (!current) return;
    const hadFocus = cardRef.current?.contains(document.activeElement) ?? false;
    resolve(current, granted);
    showRequest(null);
    if (!hadFocus) return;
    requestAnimationFrame(() => {
      // the next request takes the card; with none left, focus goes back where it came from
      if (store.getState().approvals.length > 0) {
        cardRef.current?.focus({ preventScroll: true });
        return;
      }
      const back = returnTo.current;
      returnTo.current = null;
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    });
  };
  const answerRef = useRef(answer);
  useLayoutEffect(() => {
    answerRef.current = answer;
  });

  // Ctrl+Enter confirms and Escape keeps, from anywhere but a text field (a field inside the
  // card is fine) or another layer. On the document, not the window: it hears the key after
  // Astryx's layers have (an Escape that closes a tooltip is theirs) and before the editor and
  // the drawer do, which stand aside for a key answered here.
  const hasRequest = Boolean(current);
  useEffect(() => {
    if (!hasRequest) return;
    const onKey = (e: KeyboardEvent) => {
      const confirm = e.key === "Enter" && (e.ctrlKey || e.metaKey);
      const keep = e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey;
      if ((!confirm && !keep) || e.defaultPrevented) return;
      const card = cardRef.current;
      if (isInsideOverlay(e.target, card)) return;
      if (isTypingTarget(e.target) && !card?.contains(e.target as Node)) return;
      e.preventDefault();
      answerRef.current(confirm);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasRequest]);

  const dot = px("1") / 2 + px("0-5");

  return (
    <div ref={rootRef} className="plan-marks">
      {leader ? (
        <svg className="plan-marks__svg" aria-hidden="true">
          <g className="plan-marks__leader">
            <line x1={leader.x1} y1={leader.y} x2={leader.x2} y2={leader.y} />
            <circle cx={leader.x1} cy={leader.y} r={dot} />
          </g>
        </svg>
      ) : null}

      {current ? (
        <ApprovalCard
          ref={cardRef}
          approval={current}
          index={index}
          total={approvals.length}
          placement={placement}
          style={cardStyle}
          onPage={(step) => showRequest(approvals[Math.min(Math.max(index + step, 0), approvals.length - 1)]?.id ?? null)}
          onKeep={() => answer(false)}
          onConfirm={() => answer(true)}
        />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
