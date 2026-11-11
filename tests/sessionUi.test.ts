/**
 * The shared session on screen: the presence indicator (a disclosure with the sharing switch and
 * a polite announcement of who joins and leaves) and the plan's layer (the agent's marker and
 * highlight on what it touched, the other tabs' cursors), placed and coloured through custom
 * properties set on the CSSOM, as the strict CSP allows, never through markup.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { actions } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { presence, type PeerPresence } from "../src/model/presence";
import { seedLoft } from "../src/model/seed";
import { PresenceIndicator } from "../src/ui/session/PresenceIndicator";
import { PlanPresence } from "../src/editor/PlanPresence";
import { ScenePresence } from "../src/ui/session/ScenePresence";
import { sceneFrameDrawn, sceneProbe } from "../src/model/sceneBus";
import { markerOf, placeOf } from "../src/model/places";
import { SESSION } from "../src/model/limits";
import { resetStore } from "./support/store";
import { outlineBounds } from "../src/model/shapes";

const pristinePresence = presence.getState();
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  resetStore();
  presence.setState(pristinePresence, true);
  actions.loadModel(seedLoft());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const peer = (over: Partial<PeerPresence> = {}): PeerPresence => ({
  id: "fedcba9876543210",
  kind: "person",
  ordinal: 2,
  view: "2d",
  levelId: "level_ground",
  selection: "item_sofa",
  pointer: { x: 2, y: 3 },
  editing: [],
  agent: null,
  seenAt: Date.now(),
  ...over,
});

describe("the presence indicator", () => {
  beforeEach(async () => {
    actions.setWebmcpStatus("live");
    presence.setState({ session: { state: "live", ordinal: 1 }, peers: [peer()] });
    await act(async () => root.render(createElement(PresenceIndicator)));
  });

  const button = () => host.querySelector<HTMLButtonElement>(".session__chip")!;
  const panel = () => host.querySelector<HTMLElement>(".session__panel")!;

  it("names everyone on the plan, and opens and closes its list as a disclosure", async () => {
    expect(button().getAttribute("aria-label")).toBe("On this plan: you, the agent, Tab 2");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().hidden).toBe(true);
    await act(async () => button().click());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(panel().hidden).toBe(false);
    expect(panel().textContent).toContain("Tab 2");
    expect(panel().textContent).toContain("In the plan, Sofa selected");
    await act(async () => panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
  });

  it("says what the agent is doing", async () => {
    await act(async () => presence.setState({ agent: { ...presence.getState().agent, state: "working", tool: "move_item", focus: ["item_sofa"] } }));
    // in the button's name too, not only in the list or in a dot's motion
    expect(button().getAttribute("aria-label")).toBe("On this plan: you, the agent (working), Tab 2");
    await act(async () => button().click());
    expect(panel().textContent).toContain("moving Sofa");
    expect(host.querySelector(".session__dot[data-busy]")).not.toBeNull();
    await act(async () => presence.setState({ agent: { ...presence.getState().agent, state: "waiting" } }));
    expect(button().getAttribute("aria-label")).toBe("On this plan: you, the agent (waiting for you), Tab 2");
  });

  it("is not redrawn by another tab's pointer moving, which it does not show", async () => {
    const label = button().getAttribute("aria-label");
    const chip = button();
    let renders = 0;
    const seen = new MutationObserver(() => renders++);
    seen.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    await act(async () => presence.setState({ peers: [peer({ pointer: { x: 5, y: 5 }, seenAt: Date.now() + 1 })] }));
    seen.disconnect();
    expect(renders).toBe(0);
    expect(button()).toBe(chip);
    expect(button().getAttribute("aria-label")).toBe(label);
  });

  it("switches sharing off and on", async () => {
    await act(async () => button().click());
    const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(toggle.checked).toBe(true);
    await act(async () => toggle.click());
    expect(presence.getState().sharing).toBe(false);
    await act(async () => toggle.click());
    expect(presence.getState().sharing).toBe(true);
  });

  it("announces a join politely, once", async () => {
    await act(async () => presence.setState({ announcement: "Tab 2 joined the plan." }));
    const live = host.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("Tab 2 joined the plan.");
  });

  it("colours each dot through a custom property, nothing else of its style", () => {
    for (const dot of host.querySelectorAll<HTMLElement>(".session__dot")) {
      expect(dot.style.getPropertyValue("--ss-colour")).toMatch(/^var\(--(color-accent|color-agent|plan-tab-[1-9])\)$/);
      expect(dot.style.length).toBe(1);
    }
  });
});

describe("the plan's session layer", () => {
  const render = () =>
    act(async () =>
      root.render(createElement("svg", null, createElement(PlanPresence, { S: 100, levelId: "level_ground" }))),
    );

  it("puts the agent's marker on what it touched, with its label, over a highlight", async () => {
    await render();
    await act(async () => {
      dispatch({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 }, { actor: "agent" });
    });
    const marker = host.querySelector<SVGGElement>('[data-session="agent"]')!;
    expect(marker.getAttribute("data-entity")).toBe("item_sofa");
    expect(marker.textContent).toBe("Agent · moving Sofa");
    expect(parseFloat(marker.style.getPropertyValue("--ss-x"))).toBeCloseTo(310);
    expect(parseFloat(marker.style.getPropertyValue("--ss-y"))).toBeCloseTo(530);
    expect(host.querySelectorAll(".ss-highlight")).toHaveLength(1);
    expect(host.querySelector(".ss-layer")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws another tab's pointer on the level it is on, named after its tab, and not another level's", async () => {
    presence.setState({ peers: [peer(), peer({ id: "0123456789abcdef", ordinal: 3, levelId: "elsewhere" })] });
    await render();
    const cursors = host.querySelectorAll('[data-session="cursor"]');
    expect(cursors).toHaveLength(1);
    expect(cursors[0].textContent).toBe("Tab 2");
    expect((cursors[0] as SVGGElement).style.getPropertyValue("--ss-x")).toBe("200px");
  });

  it("draws another tab's cursor and name in its tab's colour token, which the theme sets", async () => {
    presence.setState({ peers: [peer()] });
    await render();
    const cursor = host.querySelector<SVGGElement>('[data-session="cursor"]')!;
    expect(cursor.style.getPropertyValue("--ss-colour")).toBe("var(--plan-tab-2)");
    expect(cursor.querySelector("path")?.getAttribute("fill")).toBeNull();
  });

  it("rings a room the agent points at in from its corner, clear of the name and area in its middle", async () => {
    const model = seedLoft();
    const room = outlineBounds(model.rooms.find((r) => r.id === "room_bed")!.points);
    presence.setState({ points: [{ id: "point_1", entityId: "room_bed", message: "This one?", seenIn: model, until: Date.now() + SESSION.pointMs }] });
    await render();
    const ring = host.querySelector<SVGGElement>('[data-session="point"]')!;
    const at = markerOf(model, "room_bed")!;
    expect(parseFloat(ring.style.getPropertyValue("--ss-x"))).toBeCloseTo(at.x * 100);
    expect(parseFloat(ring.style.getPropertyValue("--ss-y"))).toBeCloseTo(at.y * 100);
    const middle = placeOf(model, "room_bed")!;
    expect(Math.hypot(at.x - middle.x, at.y - middle.y)).toBeGreaterThan(Math.min(room.w, room.h) / 4);
    expect(at.x).toBeGreaterThan(room.x);
    expect(at.y).toBeGreaterThan(room.y);
  });

  it("shows nothing while nobody else is at work on the plan", async () => {
    await render();
    expect(host.querySelector('[data-session="agent"]')).toBeNull();
    expect(host.querySelector('[data-session="cursor"]')).toBeNull();
  });
});

describe("the session over the 3D view", () => {
  const probe = { ...sceneProbe };
  afterEach(() => Object.assign(sceneProbe, probe));
  const render = () => act(async () => root.render(createElement(ScenePresence)));

  it("places each marker where the view projects it, hides one behind the camera, and does no work while the view rests", async () => {
    let behind = false;
    const locate = vi.fn((_type: string, id: string) => (behind ? null : { x: id === "item_sofa" ? 120 : 0, y: 80 }));
    const project = vi.fn((x: number, y: number) => ({ x: x * 10, y: y * 10 }));
    sceneProbe.locate = locate;
    sceneProbe.project = project;
    const frames = vi.spyOn(globalThis, "requestAnimationFrame");
    presence.setState({ peers: [peer()] });
    dispatch({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 }, { actor: "agent" });
    await render();

    const agent = host.querySelector<HTMLElement>('.ss-scene [data-session="agent"]')!;
    const cursor = host.querySelector<HTMLElement>('.ss-scene [data-session="cursor"]')!;
    expect(agent.hidden).toBe(false);
    expect(agent.style.getPropertyValue("--ss-x")).toBe("120px");
    expect(cursor.style.getPropertyValue("--ss-x")).toBe("20px");
    expect(cursor.style.getPropertyValue("--ss-colour")).toBe("var(--plan-tab-2)");

    // at rest: nothing asks for frames, and nothing is placed again
    const calls = locate.mock.calls.length + project.mock.calls.length;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(frames).not.toHaveBeenCalled();
    expect(locate.mock.calls.length + project.mock.calls.length).toBe(calls);

    // the view draws a frame (the camera moved): the markers follow it in that frame
    behind = true;
    sceneFrameDrawn();
    expect(agent.hidden).toBe(true);
    expect(cursor.hidden).toBe(false);
    frames.mockRestore();
  });

  it("stops following the view once it goes", async () => {
    const locate = vi.fn(() => ({ x: 1, y: 1 }));
    sceneProbe.locate = locate;
    dispatch({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 }, { actor: "agent" });
    await render();
    await act(async () => root.unmount());
    root = createRoot(host);
    const calls = locate.mock.calls.length;
    sceneFrameDrawn();
    expect(locate.mock.calls.length).toBe(calls);
  });
});
