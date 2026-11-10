/**
 * Page-wide keyboard shortcuts listen on the window, so they also hear every key typed into
 * the page's own fields: the plan's name, its notes, the tool runner. A shortcut that acted on
 * those keys, or swallowed them, would eat letters out of what the human is typing.
 */

/** Is this event's target somewhere the human types: a text field, a list box, an editable region? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
