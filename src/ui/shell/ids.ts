/**
 * DOM ids the shell and the surfaces agree on, so one can move focus into the other without
 * either importing the other's component.
 */

/** The plan name's text field (Properties with nothing selected). "Rename" in the plan menu focuses it. */
export const PLAN_NAME_FIELD_ID = "plan-name";

/** The "Waiting for you" queue of pending approvals. The agent status chip scrolls to and focuses it. */
export const APPROVALS_REGION_ID = "approvals";

/** The side panel (a drawer or bottom sheet on narrow screens); the panel toggle controls it. */
export const SIDE_PANEL_ID = "side-panel";

/** The canvas region, the skip link's target. */
export const CANVAS_REGION_ID = "canvas";

/**
 * Hand keyboard focus to the canvas region once the frame in hand has drawn: where the plan's
 * own keys work (nudging the selection, aiming and placing with a tool). For a control that
 * gives way to the plan — a list entry that selects, a rail tool that places from the keyboard.
 */
export const focusCanvasRegion = (): void => {
  requestAnimationFrame(() => document.getElementById(CANVAS_REGION_ID)?.focus({ preventScroll: true }));
};

/**
 * Marks a region that scrolls on its own (the activity feed): Page Up and Page Down page it,
 * rather than stepping the levels (shell/shortcuts.ts).
 */
export const SCROLL_REGION_ATTR = "data-scroll-region";

/** A side panel tab, and the body it shows (its tabpanel). */
export const panelTabId = (tab: string): string => `panel-tab-${tab}`;
export const panelBodyId = (tab: string): string => `panel-body-${tab}`;
