/**
 * A tooltip: it names or explains the control it wraps, with an optional shortcut chip.
 *
 * - Hover shows it after MOTION.tooltipDelayMs; keyboard focus (:focus-visible) shows it at once.
 *   It hides when the pointer leaves (after MOTION.tooltipBridgeMs, so the pointer can cross onto
 *   the tooltip, which keeps it open), when focus leaves, on a press, and on Escape (which it
 *   then takes, so the drawer or the plan behind does not also act on it).
 * - Pressing its control hides it, by pointer or by key (Enter, Space), so it never lingers while
 *   the control does its work (a closing drawer slides its button away).
 * - It never takes focus. The control it wraps is described by it (aria-describedby), unless
 *   `describes` is false: a control whose tooltip only repeats its name references just its own
 *   second line instead, so nothing is read twice (IconButton, Button).
 * - It is drawn in one fixed layer at the end of <body> (never clipped by a scrolling panel) and,
 *   while it shows, in the top layer (a manual popover), so an open menu or popover never covers
 *   it. It is placed against its control and kept inside the viewport: it flips to the other side
 *   when there is no room, and slides along its side to stay on screen. It takes no room on the page.
 * - Under a finger or a pen there is no hover: a tap opens it on something that does nothing of
 *   its own (the "Not saved" note) and on a control that cannot act (a disabled button, the
 *   disabled 3D segment), so the reason has a touch path; on a control that acts the tap is the
 *   control's, as it should be.
 *
 * The wrapper draws no box (display: contents); the tooltip attaches to its first element. A
 * control that cannot act says why through a tooltip on its wrapper: a disabled button keeps
 * its tooltip (aria-disabled, so it still takes hover and focus), and a group with a disabled
 * member is wrapped as a whole (the Plan | 3D switch).
 *
 * A tooltip names or explains; it never holds the only copy of something the person needs to
 * act. A disabled control's reason goes here and in its accessible description.
 */

import "./tip.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "./Kbd";
import { MOTION, TOOLTIP } from "../theme/tokens";
import { spacingPx } from "../theme/media";

export type TipPlacement = "above" | "below" | "start" | "end";
export type TipAlignment = "start" | "center" | "end";

export interface TipProps {
  content: ReactNode;
  /** a shortcut in Kbd notation ("w", "mod+z", "shift+/"), shown after the text */
  shortcut?: string;
  /** the side of its control it prefers; it flips when that side has no room */
  placement?: TipPlacement;
  /** where along that side it lines up with its control */
  alignment?: TipAlignment;
  /** false turns the tooltip off without moving the child */
  isEnabled?: boolean;
  /**
   * false leaves the tooltip out of its control's aria-describedby: for a control that names
   * itself with the same words and references its second line on its own
   */
  describes?: boolean;
  /** the tooltip element's id, for controls that reference it themselves (the radios of a group) */
  id?: string;
  children: ReactNode;
}

/** The class of the wrapper, which draws no box (tip.css). */
const ANCHOR_CLASS = "tip-anchor";
/** Controls a tap belongs to: under a finger their tooltip stays shut, unless they cannot act. */
const ACTS = 'button, a[href], input, select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="switch"], [role="menuitem"]';
/** A control that cannot act: its tap is free to open the tooltip that says why. */
const DISABLED = '[aria-disabled="true"], :disabled';
/** Pointers with no hover of their own. */
const NO_HOVER: ReadonlySet<string> = new Set(["touch", "pen"]);
/** The keys that press a focused control. */
const PRESS_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

/** The control a press on `node` belongs to: the control itself, or the one its label names. */
function controlAt(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  const hit = node.closest(ACTS);
  if (hit) return hit;
  const label = node.closest("label");
  return label instanceof HTMLLabelElement ? label.control : null;
}

/** Whether a press on `node` makes a control act (so the press, not the tooltip, has it). */
function pressActs(node: EventTarget | null): boolean {
  const control = controlAt(node);
  return control !== null && !control.matches(DISABLED);
}

/** Into the top layer and out of it; where the engine has none, the fixed layer still draws it. */
function setTopLayer(tip: HTMLElement, on: boolean): void {
  try {
    if (on) tip.showPopover?.();
    else tip.hidePopover?.();
  } catch {
    // already in that state, or no longer in the document: nothing to change
  }
}

/** The one layer every tooltip is drawn in: fixed, at the end of <body>, above the page. */
function tooltipLayer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let layer = document.body.querySelector<HTMLElement>(":scope > .tip-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "tip-layer";
    document.body.append(layer);
  }
  return layer;
}

/** The element a wrapper's tooltip attaches to: its first element, through nested wrappers. */
function triggerIn(anchor: HTMLElement | null): HTMLElement | null {
  let el = anchor?.firstElementChild ?? null;
  while (el instanceof HTMLElement && el.classList.contains(ANCHOR_CLASS)) el = el.firstElementChild;
  return el instanceof HTMLElement ? el : null;
}

/** Whether focus came from the keyboard (the engine's own :focus-visible where it has one). */
function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

const tokensOf = (value: string | null) => (value ?? "").split(/\s+/).filter(Boolean);

/** Add or remove one id in a space-separated id list attribute, leaving the others. */
function setDescribedBy(el: HTMLElement, id: string, on: boolean): void {
  const ids = tokensOf(el.getAttribute("aria-describedby")).filter((t) => t !== id);
  if (on) ids.push(id);
  if (ids.length > 0) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}

interface Placed {
  x: number;
  y: number;
  side: TipPlacement;
}

const OPPOSITE: Readonly<Record<TipPlacement, TipPlacement>> = { above: "below", below: "above", start: "end", end: "start" };

/**
 * Where a tooltip of size `w`×`h` goes beside `r` in a `vw`×`vh` viewport: on `placement`, or
 * the opposite side when only that one has room; lined up by `alignment`; then slid along its
 * side to keep `gutter` from the viewport's edges.
 */
export function placeTooltip(
  r: { left: number; top: number; right: number; bottom: number },
  size: { w: number; h: number },
  viewport: { vw: number; vh: number },
  placement: TipPlacement,
  alignment: TipAlignment,
  offset: number,
  gutter: number,
): Placed {
  const { w, h } = size;
  const { vw, vh } = viewport;
  const room: Record<TipPlacement, number> = {
    above: r.top - offset - gutter,
    below: vh - r.bottom - offset - gutter,
    start: r.left - offset - gutter,
    end: vw - r.right - offset - gutter,
  };
  const need = (s: TipPlacement) => (s === "above" || s === "below" ? h : w);
  const side = room[placement] < need(placement) && room[OPPOSITE[placement]] >= need(OPPOSITE[placement]) ? OPPOSITE[placement] : placement;
  const clamp = (v: number, size: number, extent: number) => Math.min(Math.max(v, gutter), Math.max(gutter, extent - gutter - size));
  const along = (start: number, end: number, size: number) =>
    alignment === "start" ? start : alignment === "end" ? end - size : start + (end - start - size) / 2;
  if (side === "above" || side === "below") {
    const y = side === "above" ? r.top - offset - h : r.bottom + offset;
    return { side, x: clamp(along(r.left, r.right, w), w, vw), y };
  }
  const x = side === "start" ? r.left - offset - w : r.right + offset;
  return { side, x, y: clamp(along(r.top, r.bottom, h), h, vh) };
}

/** Only one tooltip shows at a time: opening one closes the one before. */
let closeShown: (() => void) | null = null;

export function Tip({ content, shortcut, placement = "below", alignment = "center", isEnabled = true, describes = true, id: ownId, children }: TipProps) {
  const autoId = useId();
  const id = ownId ?? autoId;
  const anchorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = useRef(isEnabled);
  useLayoutEffect(() => {
    enabled.current = isEnabled;
  });
  // turned off while showing: it goes (and does not come back by itself when turned on again)
  const [wasEnabled, setWasEnabled] = useState(isEnabled);
  if (wasEnabled !== isEnabled) {
    setWasEnabled(isEnabled);
    if (!isEnabled) setOpen(false);
  }

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);
  const show = useCallback(() => {
    clearTimer();
    if (!enabled.current) return;
    setOpen(true);
  }, [clearTimer]);
  const later = useCallback(
    (action: () => void, ms: number) => {
      clearTimer();
      timer.current = setTimeout(action, ms);
    },
    [clearTimer],
  );

  // Attach to the wrapped element, again whenever it is a different one, and keep it described
  // by the tooltip while the tooltip is on and describes it (its own aria-describedby,
  // re-rendered, may have dropped the id).
  useLayoutEffect(() => {
    const trigger = triggerIn(anchorRef.current);
    if (trigger !== triggerRef.current) {
      if (triggerRef.current) setDescribedBy(triggerRef.current, id, false);
      triggerRef.current = trigger;
    }
    if (trigger) setDescribedBy(trigger, id, isEnabled && describes);
  });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    let lastPointer = "mouse";
    const onTrigger = (node: EventTarget | null) => node instanceof Node && triggerRef.current?.contains(node) === true;
    const within = (node: EventTarget | null) => onTrigger(node) || (node instanceof Node && tipRef.current?.contains(node) === true);
    const showing = () => tipRef.current?.hidden === false;
    const onPointerEnter = (e: PointerEvent) => {
      lastPointer = e.pointerType;
    };
    const onMouseEnter = (e: MouseEvent) => {
      // moving between the parts of the control is not arriving at it
      if (NO_HOVER.has(lastPointer) || !onTrigger(e.target) || within(e.relatedTarget)) return;
      if (showing()) clearTimer();
      else later(show, MOTION.tooltipDelayMs);
    };
    const onMouseLeave = (e: MouseEvent) => {
      if (NO_HOVER.has(lastPointer) || !onTrigger(e.target) || within(e.relatedTarget)) return;
      later(hide, MOTION.tooltipBridgeMs);
    };
    const onPointerDown = (e: PointerEvent) => {
      lastPointer = e.pointerType;
      if (!onTrigger(e.target)) return;
      if (NO_HOVER.has(e.pointerType) && !pressActs(e.target)) {
        if (showing()) hide();
        else show();
        return;
      }
      hide();
    };
    // a key that presses the control is a press too; on one that cannot act, the reason stays
    const onKeyDown = (e: KeyboardEvent) => {
      if (PRESS_KEYS.has(e.key) && onTrigger(e.target) && pressActs(e.target)) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (onTrigger(e.target) && isFocusVisible(e.target as Element)) show();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (onTrigger(e.target) && !within(e.relatedTarget)) hide();
    };
    // the wrapper draws no box, so the events of the element inside reach it all the same
    anchor.addEventListener("pointerover", onPointerEnter);
    anchor.addEventListener("mouseover", onMouseEnter);
    anchor.addEventListener("mouseout", onMouseLeave);
    anchor.addEventListener("pointerdown", onPointerDown);
    anchor.addEventListener("keydown", onKeyDown);
    anchor.addEventListener("focusin", onFocusIn);
    anchor.addEventListener("focusout", onFocusOut);
    return () => {
      anchor.removeEventListener("pointerover", onPointerEnter);
      anchor.removeEventListener("mouseover", onMouseEnter);
      anchor.removeEventListener("mouseout", onMouseLeave);
      anchor.removeEventListener("pointerdown", onPointerDown);
      anchor.removeEventListener("keydown", onKeyDown);
      anchor.removeEventListener("focusin", onFocusIn);
      anchor.removeEventListener("focusout", onFocusOut);
      clearTimer();
      const trigger = triggerRef.current;
      if (trigger) setDescribedBy(trigger, id, false);
    };
  }, [id, show, hide, later, clearTimer]);

  // While it shows: it is the only one, it is in the top layer, it is placed beside its control
  // (and again, at most once a frame, as the page scrolls or resizes), and Escape and a press
  // elsewhere close it.
  useLayoutEffect(() => {
    if (!open) return;
    closeShown?.();
    closeShown = hide;
    const tip = tipRef.current;
    if (tip) setTopLayer(tip, true);
    // the gap and the edge room in px, for this opening (the root's font size is read once)
    const offset = spacingPx(TOOLTIP.offset);
    const gutter = spacingPx(TOOLTIP.gutter);
    const place = () => {
      const trigger = triggerRef.current;
      if (!tip || !trigger) return;
      const at = placeTooltip(
        trigger.getBoundingClientRect(),
        { w: tip.offsetWidth, h: tip.offsetHeight },
        { vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight },
        placement,
        alignment,
        offset,
        gutter,
      );
      tip.dataset.side = at.side;
      tip.style.setProperty("--tip-x", `${at.x}px`);
      tip.style.setProperty("--tip-y", `${at.y}px`);
    };
    place();
    let frame = 0;
    const replace = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      hide();
    };
    const onPress = (e: PointerEvent) => {
      const node = e.target as Node;
      if (!triggerRef.current?.contains(node) && !tip?.contains(node)) hide();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("resize", replace);
    window.addEventListener("scroll", replace, true);
    return () => {
      if (closeShown === hide) closeShown = null;
      if (frame !== 0) cancelAnimationFrame(frame);
      if (tip) setTopLayer(tip, false);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("resize", replace);
      window.removeEventListener("scroll", replace, true);
    };
  }, [open, placement, alignment, hide]);

  const portalTo = tooltipLayer();
  const tooltip = (
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className="tooltip"
      popover="manual"
      hidden={!open || !isEnabled}
      onMouseEnter={clearTimer}
      onMouseLeave={(e) => {
        if (!triggerRef.current?.contains(e.relatedTarget as Node)) later(hide, MOTION.tooltipBridgeMs);
      }}
    >
      <span className="tip">
        <span className="tip__text">{content}</span>
        {shortcut ? <Kbd keys={shortcut} className="tip__kbd" /> : null}
      </span>
    </div>
  );

  return (
    <>
      <div ref={anchorRef} className={ANCHOR_CLASS}>
        {children}
      </div>
      {portalTo ? createPortal(tooltip, portalTo) : null}
    </>
  );
}
