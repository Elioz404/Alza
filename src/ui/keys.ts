/**
 * Page-wide keyboard shortcuts listen on the window, so they also hear every key typed into
 * the page's own fields: the plan's name, its notes, the tool runner. A shortcut that acted on
 * those keys, or swallowed them, would eat letters out of what the human is typing.
 *
 * They also hear keys pressed inside a dialog, a menu or a popover: a modal dialog makes the
 * page behind it inert to the pointer, but its keys still bubble to the window. A key pressed
 * there belongs to that layer, never to the plan it covers.
 */

/** Is this event's target somewhere the human types: a text field, a list box, an editable region? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** The layers a key can be pressed in: dialogs (native or by role), menus, list boxes, popovers. */
const OVERLAY_SELECTOR = 'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover]';

/** Is a modal dialog open anywhere on the page? Then nothing behind it may act on a key. */
function modalIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    // an engine without :modal: an open native dialog is the page's modal one
    return document.querySelector("dialog[open]") !== null;
  }
}

/**
 * Is this event's target inside a dialog, a menu or a popover (other than `except` itself, a
 * layer that answers keys of its own on purpose, such as the request card), or is a modal dialog
 * open over the page? Page-wide shortcuts stand aside when it is.
 */
export function isInsideOverlay(target: EventTarget | null, except?: Element | null): boolean {
  if (target instanceof Element) {
    const layer = target.closest(OVERLAY_SELECTOR);
    // a layer opened from inside `except` (its Settings popover) is a layer of its own
    if (layer && layer !== except) return true;
  }
  return modalIsOpen();
}
