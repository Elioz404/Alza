/**
 * The controls the first paint draws, Alza's own (src/ui/primitives): the panel's tabs, the
 * segmented controls (Plan | 3D, the camera, the activity filter), the switches and the
 * tooltips. Each is held to its WAI-ARIA pattern: roles and states, names and descriptions, one
 * tab stop, and the keys a person expects.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Tabs, Tab } from "../src/ui/primitives/Tabs";
import { SegmentedControl, SegmentedControlItem } from "../src/ui/primitives/SegmentedControl";
import { Switch } from "../src/ui/primitives/Switch";
import { Tip, placeTooltip } from "../src/ui/primitives/Tip";
import { IconButton } from "../src/ui/primitives/IconButton";
import { Button } from "../src/ui/primitives/Button";
import { IconPlan } from "../src/ui/primitives/icons";
import { MOTION, TOOLTIP } from "../src/ui/theme/tokens";
import { spacingPx } from "../src/ui/theme/media";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  await act(async () => root!.render(node));
  return el;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

const key = (target: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const press = async (target: Element, k: string) => act(async () => void key(target, k));

// ---------------------------------------------------------------- tabs

function PanelTabs({ onChange }: { onChange?: (v: string) => void }) {
  const [tab, setTab] = useState("properties");
  const tabs = ["properties", "library", "issues", "notes"];
  return createElement(
    "div",
    null,
    createElement(
      Tabs,
      {
        value: tab,
        onChange: (v: string) => {
          setTab(v);
          onChange?.(v);
        },
        "aria-label": "Panel",
        children: tabs.map((t) =>
          createElement(Tab, {
            key: t,
            id: `panel-tab-${t}`,
            value: t,
            label: t[0].toUpperCase() + t.slice(1),
            panelId: `panel-body-${t}`,
            endContent: t === "issues" ? createElement("span", { className: "badge" }, "3") : undefined,
          }),
        ),
      },
    ),
    createElement("div", { id: `panel-body-${tab}`, role: "tabpanel", "aria-labelledby": `panel-tab-${tab}` }, tab),
  );
}

describe("Tabs", () => {
  it("is a named tablist of tabs, each naming the panel it shows, with one tab stop", async () => {
    const el = await render(createElement(PanelTabs));
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Panel");
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.id)).toEqual(["panel-tab-properties", "panel-tab-library", "panel-tab-issues", "panel-tab-notes"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    expect(tabs.map((t) => t.getAttribute("aria-controls"))).toEqual(tabs.map((t) => t.id.replace("panel-tab-", "panel-body-")));
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    // the panel points back at its tab
    expect(el.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("panel-tab-properties");
  });

  it("names a tab once: its label and its count, never the label twice", async () => {
    const el = await render(createElement(PanelTabs));
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Properties", "Library", "Issues3", "Notes"]);
    // the reserved width is drawn by CSS from an attribute, not by a second copy of the text
    expect(el.querySelector(".tabs__label")?.getAttribute("data-label")).toBe("Properties");
    expect(el.querySelectorAll('[role="tab"] [aria-hidden="true"]')).toHaveLength(0);
  });

  it("Right and Left move between tabs, wrapping, and show the tab focus lands on", async () => {
    const changes: string[] = [];
    const el = await render(createElement(PanelTabs, { onChange: (v: string) => changes.push(v) }));
    const tab = (id: string) => el.querySelector<HTMLElement>(`#panel-tab-${id}`)!;
    tab("properties").focus();
    await press(tab("properties"), "ArrowRight");
    expect(document.activeElement).toBe(tab("library"));
    expect(tab("library").getAttribute("aria-selected")).toBe("true");
    expect(tab("library").tabIndex).toBe(0);
    expect(tab("properties").tabIndex).toBe(-1);
    expect(el.querySelector('[role="tabpanel"]')?.id).toBe("panel-body-library");
    await press(tab("library"), "ArrowLeft");
    await press(tab("properties"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("notes"));
    await press(tab("notes"), "ArrowRight");
    expect(document.activeElement).toBe(tab("properties"));
    expect(changes).toEqual(["library", "properties", "notes", "properties"]);
  });

  it("Home and End go to the first and last tab; other keys pass through", async () => {
    const el = await render(createElement(PanelTabs));
    const tab = (id: string) => el.querySelector<HTMLElement>(`#panel-tab-${id}`)!;
    tab("properties").focus();
    await press(tab("properties"), "End");
    expect(document.activeElement).toBe(tab("notes"));
    expect(tab("notes").getAttribute("aria-selected")).toBe("true");
    await press(tab("notes"), "Home");
    expect(document.activeElement).toBe(tab("properties"));
    let escape: KeyboardEvent | null = null;
    await act(async () => void (escape = key(tab("properties"), "Escape")));
    // Escape is not the tabs': the drawer around them still closes on it
    expect(escape!.defaultPrevented).toBe(false);
    const down = key(tab("properties"), "ArrowDown");
    expect(down.defaultPrevented).toBe(false);
  });

  it("a click shows its tab", async () => {
    const el = await render(createElement(PanelTabs));
    await act(async () => el.querySelector<HTMLElement>("#panel-tab-issues")!.click());
    expect(el.querySelector("#panel-tab-issues")?.getAttribute("aria-selected")).toBe("true");
  });
});

// ---------------------------------------------------------------- segmented control

function View({ disabled3d = false, onChange }: { disabled3d?: boolean; onChange?: (v: string) => void }) {
  const [view, setView] = useState("2d");
  return createElement(
    SegmentedControl,
    {
      label: "View",
      value: view,
      size: "sm",
      className: "view-switch",
      onChange: (v: string) => {
        setView(v);
        onChange?.(v);
      },
      children: [
        createElement(SegmentedControlItem, { key: "2d", value: "2d", label: "Plan" }),
        createElement(SegmentedControlItem, { key: "3d", value: "3d", label: "3D", isDisabled: disabled3d }),
        createElement(SegmentedControlItem, { key: "walk", value: "walk", label: "Walk", isLabelHidden: true, icon: createElement("svg") }),
      ],
    },
  );
}

describe("SegmentedControl", () => {
  it("is a named radiogroup of radios, the chosen one checked and the one tab stop", async () => {
    const el = await render(createElement(View));
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("View");
    expect(group.classList.contains("view-switch")).toBe(true);
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    // a segment that shows only its icon keeps its label as its name
    expect(radios[2].getAttribute("aria-label")).toBe("Walk");
    expect(radios[0].textContent).toBe("Plan");
  });

  it("the arrow keys move and choose, wrapping, and skip a disabled segment", async () => {
    const changes: string[] = [];
    const el = await render(createElement(View, { disabled3d: true, onChange: (v: string) => changes.push(v) }));
    const radio = (v: string) => el.querySelector<HTMLElement>(`[role="radio"][data-value="${v}"]`)!;
    expect(radio("3d").getAttribute("aria-disabled")).toBe("true");
    radio("2d").focus();
    await press(radio("2d"), "ArrowRight");
    expect(document.activeElement).toBe(radio("walk"));
    expect(radio("walk").getAttribute("aria-checked")).toBe("true");
    expect(radio("walk").tabIndex).toBe(0);
    expect(radio("2d").tabIndex).toBe(-1);
    await press(radio("walk"), "ArrowDown");
    expect(document.activeElement).toBe(radio("2d"));
    await press(radio("2d"), "ArrowLeft");
    expect(document.activeElement).toBe(radio("walk"));
    await press(radio("walk"), "Home");
    expect(document.activeElement).toBe(radio("2d"));
    await press(radio("2d"), "End");
    expect(document.activeElement).toBe(radio("walk"));
    expect(changes).toEqual(["walk", "2d", "walk", "2d", "walk"]);
  });

  it("a disabled segment cannot be chosen by a click", async () => {
    const changes: string[] = [];
    const el = await render(createElement(View, { disabled3d: true, onChange: (v: string) => changes.push(v) }));
    await act(async () => el.querySelector<HTMLElement>('[data-value="3d"]')!.click());
    expect(changes).toEqual([]);
    await act(async () => el.querySelector<HTMLElement>('[data-value="walk"]')!.click());
    expect(changes).toEqual(["walk"]);
  });

  it("keeps a tab stop when the chosen segment cannot be chosen", async () => {
    const el = await render(
      createElement(
        SegmentedControl,
        {
          label: "Camera",
          value: "orbit",
          onChange: () => {},
          children: [
            createElement(SegmentedControlItem, { key: "orbit", value: "orbit", label: "Orbit", isDisabled: true }),
            createElement(SegmentedControlItem, { key: "top", value: "top", label: "Top" }),
          ],
        },
      ),
    );
    expect([...el.querySelectorAll<HTMLElement>('[role="radio"]')].map((r) => r.tabIndex)).toEqual([-1, 0]);
  });
});

// ---------------------------------------------------------------- switch

function Policy({ description }: { description?: string }) {
  const [on, setOn] = useState(true);
  return createElement(Switch, { label: "Ask before destructive agent actions", value: on, onChange: setOn, description, labelPosition: "start", labelSpacing: "spread" });
}

describe("Switch", () => {
  it("is a checkbox in the switch role, named by its label and described by its sentence", async () => {
    const el = await render(createElement(Policy, { description: "Your agent asks first." }));
    const input = el.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(input.type).toBe("checkbox");
    expect(input.checked).toBe(true);
    expect(input.getAttribute("aria-checked")).toBe("true");
    const label = el.querySelector("label")!;
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe("Ask before destructive agent actions");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Your agent asks first.");
    // the drawing over the control is not read
    expect(el.querySelector(".switch__track")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("flips on a click on the control or on its words", async () => {
    const el = await render(createElement(Policy));
    const input = el.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => input.click());
    expect(input.checked).toBe(false);
    expect(input.getAttribute("aria-checked")).toBe("false");
    await act(async () => el.querySelector("label")!.click());
    expect(input.checked).toBe(true);
  });

  it("a disabled switch does not change", async () => {
    const onChange = vi.fn();
    const el = await render(createElement(Switch, { label: "Show agent marks", value: false, onChange, isDisabled: true }));
    const input = el.querySelector<HTMLInputElement>('[role="switch"]')!;
    await act(async () => input.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-disabled")).toBe("true");
  });
});

// ---------------------------------------------------------------- tooltip

const visibleTips = () => [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((t) => !t.hidden);

async function renderTip(props: { isEnabled?: boolean; shortcut?: string } = {}) {
  const el = await render(
    createElement(
      "div",
      null,
      createElement(Tip, { content: "Nothing to undo", ...props, children: createElement("button", { type: "button", "aria-describedby": "own" }, "Undo") }),
      createElement(Tip, { content: "Keyboard shortcuts", children: createElement("button", { type: "button" }, "Help") }),
    ),
  );
  const [undo, help] = [...el.querySelectorAll("button")];
  return { el, undo, help };
}

const hover = (el: Element, related: Element | null = null) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: related }));
const leave = (el: Element, related: Element | null = null) => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: related }));
/** Focus from the keyboard: the element takes focus (so it matches :focus-visible), and focusin reaches the wrapper. */
const focusIn = (el: HTMLElement) => {
  el.focus();
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
};
const focusOut = (el: Element, related: Element | null = null) => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: related }));

describe("Tip", () => {
  it("describes its control, keeping the control's own description, and lives outside the page's tree", async () => {
    const { el, undo } = await renderTip();
    const ids = undo.getAttribute("aria-describedby")!.split(" ");
    expect(ids[0]).toBe("own");
    const tip = document.getElementById(ids[1])!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe("Nothing to undo");
    expect(tip.hidden).toBe(true);
    // drawn in the one fixed layer at the end of <body>, never inside a scrolling panel
    expect(el.contains(tip)).toBe(false);
    expect(tip.parentElement?.classList.contains("tip-layer")).toBe(true);
    expect(tip.parentElement?.parentElement).toBe(document.body);
    // the wrapper draws no box: the control is still the first thing in its row
    expect(undo.parentElement?.classList.contains("tip-anchor")).toBe(true);
  });

  it("shows on hover only after the delay, and hides when the pointer leaves", async () => {
    vi.useFakeTimers();
    const { undo } = await renderTip();
    await act(async () => void hover(undo));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipDelayMs - 1));
    expect(visibleTips()).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Nothing to undo"]);
    await act(async () => void leave(undo, document.body));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipBridgeMs));
    expect(visibleTips()).toHaveLength(0);
  });

  it("stays while the pointer crosses onto it, and leaving it hides it", async () => {
    vi.useFakeTimers();
    const { undo } = await renderTip();
    await act(async () => void hover(undo));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipDelayMs));
    const tip = visibleTips()[0];
    await act(async () => void leave(undo, tip));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipBridgeMs * 2));
    expect(visibleTips()).toEqual([tip]);
    await act(async () => void tip.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipBridgeMs));
    expect(visibleTips()).toHaveLength(0);
  });

  it("shows at once on keyboard focus and hides on blur, without taking focus", async () => {
    const { undo } = await renderTip();
    await act(async () => void focusIn(undo));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Nothing to undo"]);
    expect(document.activeElement).toBe(undo);
    await act(async () => void focusOut(undo, document.body));
    expect(visibleTips()).toHaveLength(0);
  });

  it("Escape hides it and is taken, so nothing behind also acts on it", async () => {
    const { undo } = await renderTip();
    await act(async () => void focusIn(undo));
    const behind = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener("keydown", behind);
    let escape: KeyboardEvent | null = null;
    await act(async () => void (escape = key(undo, "Escape")));
    window.removeEventListener("keydown", behind);
    expect(visibleTips()).toHaveLength(0);
    expect(escape!.defaultPrevented).toBe(true);
    expect(behind).toHaveReturnedWith(true);
    // with no tooltip showing, Escape is left alone
    expect(key(undo, "Escape").defaultPrevented).toBe(false);
  });

  it("a press on its control hides it, and only one shows at a time", async () => {
    const { undo, help } = await renderTip();
    await act(async () => void focusIn(undo));
    await act(async () => void focusIn(help));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Keyboard shortcuts"]);
    await act(async () => void help.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
    expect(visibleTips()).toHaveLength(0);
  });

  it("turned off, it neither shows nor describes", async () => {
    vi.useFakeTimers();
    const { undo } = await renderTip({ isEnabled: false });
    expect(undo.getAttribute("aria-describedby")).toBe("own");
    await act(async () => void hover(undo));
    await act(async () => void focusIn(undo));
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipDelayMs));
    expect(visibleTips()).toHaveLength(0);
  });

  it("carries its shortcut chip after the text", async () => {
    const { undo } = await renderTip({ shortcut: "mod+z" });
    await act(async () => void focusIn(undo));
    const chip = visibleTips()[0].querySelector('.tip__kbd[role="img"]');
    expect(chip?.getAttribute("aria-label")).toBe("Control + Z");
  });
});

const tapOn = (el: Element, pointerType = "touch") => {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
};

/** A Tip around a control that cannot act, one that can, and a note that does nothing itself. */
async function renderTouchTips() {
  const el = await render(
    createElement(
      "div",
      null,
      createElement(Tip, { content: "Nothing to undo", children: createElement("button", { type: "button", "aria-disabled": "true" }, createElement("span", null, "Undo")) }),
      createElement(Tip, { content: "Redo the change", children: createElement("button", { type: "button" }, "Redo") }),
      createElement(Tip, { content: "Changes are kept in this browser only", children: createElement("span", { className: "note" }, createElement("b", null, "Not saved")) }),
      createElement(Tip, {
        content: "Add a wall to see the plan in 3D",
        children: createElement(SegmentedControl, {
          label: "View",
          value: "2d",
          onChange: () => {},
          children: [
            createElement(SegmentedControlItem, { key: "2d", value: "2d", label: "Plan" }),
            createElement(SegmentedControlItem, { key: "3d", value: "3d", label: "3D", isDisabled: true }),
          ],
        }),
      }),
    ),
  );
  const [undo, redo] = [...el.querySelectorAll("button")];
  const note = el.querySelector(".note b")!;
  const [plan, threeD] = [...el.querySelectorAll<HTMLElement>('[role="radio"]')];
  return { undo, redo, note, plan, threeD };
}

describe("Tip under a finger", () => {
  it("a tap on a control that cannot act opens its reason, a second tap closes it", async () => {
    const { undo } = await renderTouchTips();
    // the press lands on the label inside the button: the button is the control
    await act(async () => void tapOn(undo.querySelector("span")!));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Nothing to undo"]);
    await act(async () => void tapOn(undo));
    expect(visibleTips()).toHaveLength(0);
  });

  it("a tap on a disabled segment opens the reason around the group; one on a segment that acts does not", async () => {
    const { plan, threeD } = await renderTouchTips();
    await act(async () => void tapOn(threeD));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Add a wall to see the plan in 3D"]);
    await act(async () => void tapOn(plan));
    expect(visibleTips()).toHaveLength(0);
  });

  it("a tap on a control that acts is the control's: its tooltip stays shut", async () => {
    const { redo } = await renderTouchTips();
    await act(async () => void tapOn(redo));
    expect(visibleTips()).toHaveLength(0);
  });

  it("a tap on something that does nothing of its own toggles its tooltip", async () => {
    const { note } = await renderTouchTips();
    await act(async () => void tapOn(note));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Changes are kept in this browser only"]);
    await act(async () => void tapOn(note));
    expect(visibleTips()).toHaveLength(0);
  });

  it("a pen is a finger: no hover, and its tap opens a disabled control's reason", async () => {
    vi.useFakeTimers();
    const { undo, redo } = await renderTouchTips();
    await act(async () => {
      redo.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "pen" }));
      hover(redo);
    });
    await act(async () => void vi.advanceTimersByTime(MOTION.tooltipDelayMs));
    expect(visibleTips()).toHaveLength(0);
    await act(async () => void tapOn(undo, "pen"));
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Nothing to undo"]);
  });

  it("a mouse press hides the tooltip, on a disabled control too", async () => {
    const { undo } = await renderTouchTips();
    await act(async () => void focusIn(undo));
    expect(visibleTips()).toHaveLength(1);
    await act(async () => void tapOn(undo, "mouse"));
    expect(visibleTips()).toHaveLength(0);
  });
});

describe("Tip and the keys that press its control", () => {
  it("Enter or Space on a control that acts hides its tooltip, as a press does", async () => {
    const { redo } = await renderTouchTips();
    for (const k of ["Enter", " "]) {
      await act(async () => void focusIn(redo));
      expect(visibleTips().map((t) => t.textContent)).toEqual(["Redo the change"]);
      await press(redo, k);
      expect(visibleTips()).toHaveLength(0);
    }
  });

  it("on a control that cannot act, the reason stays; another key leaves it too", async () => {
    const { undo, redo } = await renderTouchTips();
    await act(async () => void focusIn(undo));
    await press(undo, "Enter");
    await press(undo, " ");
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Nothing to undo"]);
    await act(async () => void focusIn(redo));
    await press(redo, "a");
    expect(visibleTips().map((t) => t.textContent)).toEqual(["Redo the change"]);
  });
});

describe("Tip while it shows", () => {
  const VIEWPORT = { clientWidth: 1024, clientHeight: 768 };
  afterEach(() => {
    for (const name of Object.keys(VIEWPORT)) delete (document.documentElement as unknown as Record<string, unknown>)[name];
  });
  /** A Tip whose control sits at `rect` in a 1024 by 768 page, its tooltip 120 by 28. */
  async function renderPlaced(rect: { left: number; top: number; width: number; height: number }) {
    for (const [name, value] of Object.entries(VIEWPORT)) Object.defineProperty(document.documentElement, name, { configurable: true, get: () => value });
    const box = { ...rect };
    const el = await render(createElement(Tip, { content: "Undo", children: createElement("button", { type: "button" }, "Undo") }));
    const button = el.querySelector("button")!;
    button.getBoundingClientRect = () => new DOMRect(box.left, box.top, box.width, box.height);
    const tip = document.getElementById(button.getAttribute("aria-describedby")!)!;
    Object.defineProperty(tip, "offsetWidth", { configurable: true, get: () => 120 });
    Object.defineProperty(tip, "offsetHeight", { configurable: true, get: () => 28 });
    return { button, tip, box };
  }
  const nextFrame = () => act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(null)))));
  const at = (tip: HTMLElement) => ({ x: tip.style.getPropertyValue("--tip-x"), y: tip.style.getPropertyValue("--tip-y"), side: tip.dataset.side });
  const expected = (box: { left: number; top: number; width: number; height: number }) => {
    const p = placeTooltip(
      { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height },
      { w: 120, h: 28 },
      { vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight },
      "below",
      "center",
      spacingPx(TOOLTIP.offset),
      spacingPx(TOOLTIP.gutter),
    );
    return { x: `${p.x}px`, y: `${p.y}px`, side: p.side };
  };

  it("writes its place as --tip-x, --tip-y and the side it ended on", async () => {
    const { button, tip, box } = await renderPlaced({ left: 200, top: 100, width: 40, height: 32 });
    await act(async () => void focusIn(button));
    expect(at(tip)).toEqual(expected(box));
    expect(at(tip).side).toBe("below");
  });

  it("is placed again, once a frame, when the page resizes or any scroller scrolls", async () => {
    const { button, tip, box } = await renderPlaced({ left: 200, top: 100, width: 40, height: 32 });
    await act(async () => void focusIn(button));
    box.left = 300;
    await act(async () => void window.dispatchEvent(new Event("resize")));
    await nextFrame();
    expect(at(tip)).toEqual(expected(box));
    box.top = 160;
    const scroller = document.createElement("div");
    document.body.append(scroller);
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      scroller.dispatchEvent(new Event("scroll"));
    });
    await nextFrame();
    expect(at(tip)).toEqual(expected(box));
    scroller.remove();
  });

  it("enters the top layer as it shows and leaves it as it hides", async () => {
    const { button, tip } = await renderPlaced({ left: 200, top: 100, width: 40, height: 32 });
    expect(tip.getAttribute("popover")).toBe("manual");
    const showPopover = vi.fn();
    const hidePopover = vi.fn();
    Object.assign(tip, { showPopover, hidePopover });
    await act(async () => void focusIn(button));
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(hidePopover).not.toHaveBeenCalled();
    await act(async () => void focusOut(button, document.body));
    expect(hidePopover).toHaveBeenCalledTimes(1);
  });

  it("takes its listeners away when it hides and when it goes", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const watched = new Set(["resize", "scroll", "keydown", "pointerdown"]);
    for (const target of [window, document]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]) => {
        if (watched.has(type)) added.push(type);
        return add(type, ...rest);
      });
      vi.spyOn(target, "removeEventListener").mockImplementation((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | EventListenerOptions)?]) => {
        if (watched.has(type)) removed.push(type);
        return remove(type, ...rest);
      });
    }
    try {
      const { button } = await renderPlaced({ left: 200, top: 100, width: 40, height: 32 });
      await act(async () => void focusIn(button));
      expect([...added].sort()).toEqual(["keydown", "pointerdown", "resize", "scroll"]);
      await act(async () => void focusOut(button, document.body));
      expect([...removed].sort()).toEqual([...added].sort());
      // shown again, then unmounted while showing: everything it added goes with it
      await act(async () => void focusIn(button));
      await act(async () => root?.unmount());
      root = null;
      expect([...removed].sort()).toEqual([...added].sort());
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("turned off while it shows, it hides at once and stops describing its control", async () => {
    const el = await render(createElement("div"));
    const draw = (isEnabled: boolean) => root!.render(createElement(Tip, { content: "Nothing to undo", isEnabled, children: createElement("button", { type: "button" }, "Undo") }));
    await act(async () => draw(true));
    const button = el.querySelector("button")!;
    await act(async () => void focusIn(button));
    expect(visibleTips()).toHaveLength(1);
    await act(async () => draw(false));
    expect(visibleTips()).toHaveLength(0);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    // turned on again, it does not come back by itself
    await act(async () => draw(true));
    expect(visibleTips()).toHaveLength(0);
  });
});

describe("what a tooltip describes", () => {
  it("with describes off, it is not in its control's description", async () => {
    const el = await render(createElement(Tip, { content: "Help", describes: false, children: createElement("button", { type: "button", "aria-describedby": "own" }, "Help") }));
    expect(el.querySelector("button")!.getAttribute("aria-describedby")).toBe("own");
  });

  it("an icon button is named by its label and described only by its second line", async () => {
    const el = await render(
      createElement(
        "div",
        null,
        createElement(IconButton, { icon: IconPlan, label: "Undo", shortcut: "mod+z", disabledReason: "Nothing to undo" }),
        createElement(IconButton, { icon: IconPlan, label: "Show panel", hint: "Properties, Library and Issues", shortcut: "]" }),
        createElement(IconButton, { icon: IconPlan, label: "Keyboard shortcuts" }),
      ),
    );
    const [undo, show, help] = [...el.querySelectorAll("button")];
    const description = (b: Element) => (b.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent);
    expect(undo.getAttribute("aria-label")).toBe("Undo");
    expect(description(undo)).toEqual(["Nothing to undo"]);
    expect(description(show)).toEqual(["Properties, Library and Issues"]);
    expect(description(help)).toEqual([]);
    // the tooltip still shows the label, the second line and the shortcut
    await act(async () => void focusIn(show));
    expect(visibleTips()[0].textContent).toContain("Show panel");
    expect(visibleTips()[0].textContent).toContain("Properties, Library and Issues");
    expect(visibleTips()[0].querySelector(".tip__kbd")).not.toBeNull();
  });

  it("a blocked button is described by its reason once", async () => {
    const el = await render(createElement(Button, { disabledReason: "Draw a wall first", children: "Clear plan" }));
    const button = el.querySelector("button")!;
    const ids = (button.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(["Draw a wall first"]);
  });

  it("a segmented control's reason describes the chosen segment and the disabled one", async () => {
    const el = await render(
      createElement(SegmentedControl, {
        label: "View",
        value: "2d",
        onChange: () => {},
        describedBy: "why",
        children: [
          createElement(SegmentedControlItem, { key: "2d", value: "2d", label: "Plan" }),
          createElement(SegmentedControlItem, { key: "3d", value: "3d", label: "3D", isDisabled: true }),
          createElement(SegmentedControlItem, { key: "x", value: "x", label: "Other", "aria-describedby": "own" }),
        ],
      }),
    );
    const [plan, threeD, other] = [...el.querySelectorAll('[role="radio"]')];
    expect(plan.getAttribute("aria-describedby")).toBe("why");
    expect(threeD.getAttribute("aria-describedby")).toBe("why");
    expect(other.getAttribute("aria-describedby")).toBe("own");
    expect(el.querySelector('[role="radiogroup"]')!.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("where a tooltip goes", () => {
  const viewport = { vw: 1000, vh: 800 };
  const size = { w: 120, h: 28 };
  const box = (left: number, top: number, w = 40, h = 32) => ({ left, top, right: left + w, bottom: top + h });

  it("beside its control on the side asked for, lined up as asked", () => {
    expect(placeTooltip(box(400, 300), size, viewport, "below", "center", 4, 16)).toEqual({ side: "below", x: 360, y: 336 });
    expect(placeTooltip(box(400, 300), size, viewport, "above", "start", 4, 16)).toEqual({ side: "above", x: 400, y: 268 });
    expect(placeTooltip(box(400, 300), size, viewport, "end", "center", 4, 16)).toEqual({ side: "end", x: 444, y: 302 });
    expect(placeTooltip(box(400, 300), size, viewport, "start", "end", 4, 16)).toEqual({ side: "start", x: 276, y: 304 });
  });

  it("flips to the other side when its own has no room", () => {
    expect(placeTooltip(box(400, 10), size, viewport, "above", "center", 4, 16).side).toBe("below");
    expect(placeTooltip(box(400, 760), size, viewport, "below", "center", 4, 16).side).toBe("above");
    expect(placeTooltip(box(950, 300), size, viewport, "end", "center", 4, 16).side).toBe("start");
  });

  it("slides along its side to stay inside the viewport", () => {
    expect(placeTooltip(box(0, 300), size, viewport, "below", "center", 4, 16).x).toBe(16);
    expect(placeTooltip(box(980, 300, 20), size, viewport, "below", "center", 4, 16).x).toBe(1000 - 16 - 120);
    expect(placeTooltip(box(20, 790, 32, 10), size, viewport, "end", "center", 4, 16).y).toBe(800 - 16 - 28);
  });
});
