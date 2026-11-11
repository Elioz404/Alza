/**
 * The shared session: the agent seen from its calls, the person's hand holding what it edits,
 * get_presence and point_at, the messages the tabs exchange (and the ones they refuse), the
 * last-writer-wins merge two tabs converge with, and a tab joining and syncing over the in-page
 * transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actions, pageActions, store } from "../src/model/store";
import { beginGesture, dispatch } from "../src/model/commands";
import { TOOLS, runTool } from "../src/mcp/tools";
import { presence, SHARING_KEY } from "../src/model/presence";
import { setSharing } from "../src/model/presenceShows";
import { touchedBy } from "../src/model/touch";
import { seedLoft } from "../src/model/seed";
import { MAX_NOTES, SESSION, TOOL_NAME } from "../src/model/limits";
import { Replica, diff, materialize, newer, rebase, type PlanState, type Write } from "../src/session/replica";
import { APP, parseMessage } from "../src/session/messages";
import { inPageHub, type Transport } from "../src/session/transport";
import { startSession, type Session } from "../src/session/runtime";
import { firstPlace, agentLabel, verbOf } from "../src/ui/session/participants";
import { resetStore } from "./support/store";
import type { PlanModel } from "../src/model/types";

const pristinePresence = presence.getState();

beforeEach(() => {
  resetStore();
  presence.setState(pristinePresence, true);
  actions.setRequireApproval(false);
  actions.loadModel(seedLoft());
});

const state = () => store.getState();
const item = (id: string) => state().model.items.find((i) => i.id === id);
const human = { actor: "human" } as const;

// ---------------------------------------------------------------------------- the agent, seen

describe("the agent's presence follows from its calls", () => {
  it("a tool call puts the agent on what it touched, names the tool, and keeps it as last edited", async () => {
    const r = await runTool("move_item", { id: "sofa", x: 3.2, y: 5.3 }, "agent");
    expect(r.ok).toBe(true);
    const a = presence.getState().agent;
    expect(a.state).toBe("idle");
    expect(a.tool).toBe("move_item");
    expect(a.focus).toEqual(["item_sofa"]);
    expect(a.lastEdited[0]).toBe("item_sofa");
    expect(agentLabel(a, state().model)).toBe("Agent · moving Sofa");
  });

  it("is working while its call runs", async () => {
    let during: string | null = null;
    const off = presence.subscribe((p) => {
      if (p.agent.focus.includes("item_desk")) during ??= p.agent.state;
    });
    await runTool("move_item", { id: "item_desk", x: 4.3, y: 0.45 }, "agent");
    off();
    expect(during).toBe("working");
  });

  it("a new entity is where the marker goes; a removed one is found in the plan it was in", async () => {
    const placed = await runTool("place_item", { kind: "plant", x: 2, y: 2 }, "agent");
    expect(presence.getState().agent.focus).toEqual([placed.id]);
    await runTool("remove_item", { id: "item_plant" }, "agent");
    const a = presence.getState().agent;
    expect(a.focus).toEqual(["item_plant"]);
    expect(item("item_plant")).toBeUndefined();
    expect(firstPlace(state().model, a.focus, a.seenIn)?.at).toMatchObject({ x: 7.7, y: 3.05 });
  });

  it("a read moves no marker, and the person's own changes leave the agent alone", async () => {
    await runTool("get_model", {}, "agent");
    expect(presence.getState().agent.focus).toEqual([]);
    expect(presence.getState().agent.tool).toBe("get_model");
    dispatch({ type: "move_item", id: "item_desk", x: 4, y: 0.45 }, human);
    expect(presence.getState().agent.focus).toEqual([]);
  });

  it("the marker leaves a moment after the call is done", async () => {
    vi.useFakeTimers();
    try {
      await runTool("move_item", { id: "item_desk", x: 4.3, y: 0.45 }, "agent");
      expect(presence.getState().agent.focus).toEqual(["item_desk"]);
      vi.advanceTimersByTime(SESSION.agentLingerMs + 1);
      expect(presence.getState().agent.focus).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("every tool is named as the session's messages expect a tool's name, so its agent is seen in the other tabs", () => {
    for (const tool of TOOLS) expect(tool.name).toMatch(TOOL_NAME);
    for (const type of ["change", "join", "sync", "seed", "move_item"]) expect(type).toMatch(TOOL_NAME);
  });

  it("says what each tool does", () => {
    // a name another tab sends is looked up in the table's own entries, never Object's
    expect(verbOf("constructor_x")).toBe("constructoring");
    expect(verbOf("toString")).toBe("toStringing");
    expect(verbOf("move_item")).toBe("moving");
    expect(verbOf("place_item")).toBe("placing");
    expect(verbOf("get_model")).toBe("reading");
    expect(verbOf("set_plan_name")).toBe("setting");
    expect(verbOf("add_door")).toBe("adding");
  });
});

// ---------------------------------------------------------------------------- the person's hand

describe("what the person is editing waits for them", () => {
  it("knows what a command touches, by id or by name", () => {
    const m = state().model;
    expect(touchedBy({ type: "move_item", id: "sofa", x: 1 }, m)).toEqual(["item_sofa"]);
    expect(touchedBy({ type: "add_door", wallId: "wall_n", t: 0.2 }, m)).toEqual(["wall_n"]);
    expect(touchedBy({ type: "remove_wall", id: "wall_e" }, m)).toEqual(["wall_e", "win_bed", "win_bath"]);
    expect(touchedBy({ type: "add_wall", ax: 0, ay: 0, bx: 1, by: 0 }, m)).toEqual([]);
    expect(touchedBy({ type: "undo" }, m)).toBe("all");
  });

  it("an agent's change to the piece the person is dragging is refused, nothing changes, and it can call again", async () => {
    const drag = beginGesture(human);
    drag.update({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 });
    expect(presence.getState().editing).toEqual(["item_sofa"]);
    const before = state().model;
    const r = await runTool("move_item", { id: "sofa", x: 1, y: 1 }, "agent");
    expect(r.ok).toBe(false);
    expect(r.conflict).toEqual({ code: "person_editing", entityIds: ["item_sofa"], retryAfterMs: SESSION.retryAfterMs });
    expect(r.summary).toMatch(/call move_item again/);
    expect(state().model).toBe(before);
    // its call is over, but it is still waiting on the person: that is what the page shows
    expect(presence.getState().agent).toMatchObject({ state: "waiting", focus: ["item_sofa"] });
    expect(state().activity.at(-1)).toMatchObject({ source: "agent", tool: "move_item", ok: false });

    // what the hand does not hold is the agent's to change
    expect((await runTool("move_item", { id: "item_desk", x: 4.3, y: 0.45 }, "agent")).ok).toBe(true);

    drag.end();
    expect(presence.getState().editing).toEqual([]);
    const again = await runTool("move_item", { id: "sofa", x: 1, y: 1 }, "agent");
    expect(again.ok).toBe(true);
    expect(item("item_sofa")).toMatchObject({ x: 1, y: 1 });
  });

  it("shows the agent waiting for the person for as long as they hold what it would change", async () => {
    vi.useFakeTimers();
    try {
      const drag = beginGesture(human);
      drag.update({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 });
      await runTool("move_item", { id: "sofa", x: 1, y: 1 }, "agent");
      const waiting = presence.getState().agent;
      expect(waiting.state).toBe("waiting");
      expect(agentLabel(waiting, state().model)).toBe("Agent · waiting for you");
      // it is not a moment: it lasts past the time a marker lingers, while the hand holds on
      vi.advanceTimersByTime(SESSION.agentLingerMs + 1);
      expect(presence.getState().agent.state).toBe("waiting");
      drag.update({ type: "move_item", id: "item_sofa", x: 3.2, y: 5.3 });
      expect(presence.getState().agent.state).toBe("waiting");
      // let go: it no longer waits, and as it changed nothing, its marker has nothing to stay on
      drag.end();
      expect(presence.getState().agent).toMatchObject({ state: "idle", focus: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting when the other tab whose person held it lets go", async () => {
    presence.setState({ peers: [{ id: "fedcba9876543210", kind: "person", ordinal: 2, view: "2d", levelId: "level_ground", selection: null, pointer: null, editing: ["item_sofa"], agent: null, seenAt: 0 }] });
    expect((await runTool("move_item", { id: "sofa", x: 1, y: 1 }, "agent")).conflict).toMatchObject({ code: "person_editing" });
    expect(presence.getState().agent.state).toBe("waiting");
    presence.setState((s) => ({ peers: s.peers.map((p) => ({ ...p, editing: [] })) }));
    expect(presence.getState().agent.state).toBe("idle");
  });

  it("typing the plan's name holds it; a wall end being dragged holds the door going in it", async () => {
    const typing = beginGesture(human);
    typing.update({ type: "set_plan_name", name: "Loft B" });
    expect((await runTool("set_plan_name", { name: "Agent's name" }, "agent")).conflict).toMatchObject({ entityIds: ["plan:name"] });
    typing.end();
    const wallDrag = beginGesture(human);
    wallDrag.update({ type: "edit_wall", id: "wall_n", patch: { ax: 0.1 } });
    expect((await runTool("add_door", { wallId: "wall_n", t: 0.2 }, "agent")).conflict).toMatchObject({ code: "person_editing" });
    wallDrag.end();
    expect((await runTool("add_door", { wallId: "wall_n", t: 0.2 }, "agent")).ok).toBe(true);
  });

  it("a person editing in another tab holds the entity too", async () => {
    presence.setState({ peers: [{ id: "a".repeat(16), kind: "person", ordinal: 2, view: "2d", levelId: null, selection: null, pointer: null, editing: ["item_bed"], agent: null, seenAt: Date.now() }] });
    expect((await runTool("move_item", { id: "item_bed", x: 6.8, y: 1.2 }, "agent")).conflict).toMatchObject({ entityIds: ["item_bed"] });
  });

  it("the person's own tool runs are not held back by their own hand", async () => {
    const drag = beginGesture(human);
    drag.update({ type: "move_item", id: "item_sofa", x: 3.1, y: 5.3 });
    expect((await runTool("move_item", { id: "sofa", x: 2, y: 5.3 }, "human")).ok).toBe(true);
    drag.end();
  });
});

// ---------------------------------------------------------------------------- the tools

describe("get_presence and point_at", () => {
  it("says the person's level, view, selection, pointer, viewport and what they edit", async () => {
    pageActions.selectItem("item_sofa");
    presence.setState({ person: { pointer: { x: 1.23456, y: 2 }, hoverId: "room_living", viewport: { minX: -1, minY: -1, maxX: 9, maxY: 7 } } });
    const drag = beginGesture(human);
    drag.update({ type: "move_item", id: "item_desk", x: 4.2, y: 0.45 });
    const r = await runTool("get_presence", {}, "agent");
    drag.end();
    expect(r.ok).toBe(true);
    const person = r.person as Record<string, unknown>;
    expect(person).toMatchObject({
      level: { id: "level_ground" },
      view: "plan",
      selection: { type: "item", id: "item_sofa", label: "Sofa" },
      dragging: true,
      editing: ["item_desk"],
      sharing: true,
      pointer: { x: 1.235, y: 2 },
      hover: { type: "room", id: "room_living" },
      viewport: { minX: -1, minY: -1, maxX: 9, maxY: 7 },
    });
    expect(r.summary).toMatch(/item item_sofa/);
  });

  it("keeps the other tabs' pointers from the agent too while the person does not share theirs", async () => {
    presence.setState({ peers: [{ id: "fedcba9876543210", kind: "person", ordinal: 2, view: "2d", levelId: "level_ground", selection: null, pointer: { x: 1, y: 1 }, editing: [], agent: null, seenAt: 0 }] });
    expect(((await runTool("get_presence", {}, "agent")).tabs as { pointer: unknown }[])[0].pointer).toEqual({ x: 1, y: 1 });
    setSharing(false);
    expect(((await runTool("get_presence", {}, "agent")).tabs as { pointer: unknown }[])[0].pointer).toBeNull();
    setSharing(true);
  });

  it("follows the choice made in another tab of the browser, at once", () => {
    expect(presence.getState().sharing).toBe(true);
    // the other tab wrote the choice; this one hears of it as browsers tell every other tab
    localStorage.setItem(SHARING_KEY, "off");
    window.dispatchEvent(new StorageEvent("storage", { key: SHARING_KEY, oldValue: "on", newValue: "off" }));
    expect(presence.getState().sharing).toBe(false);
    localStorage.setItem(SHARING_KEY, "on");
    window.dispatchEvent(new StorageEvent("storage", { key: SHARING_KEY, oldValue: "off", newValue: "on" }));
    expect(presence.getState().sharing).toBe(true);
  });

  it("keeps the pointer and view to the person when they switch sharing off, and remembers it", async () => {
    presence.setState({ person: { pointer: { x: 1, y: 2 }, hoverId: "room_living", viewport: { minX: 0, minY: 0, maxX: 1, maxY: 1 } } });
    setSharing(false);
    expect(localStorage.getItem("alza.presence.sharing")).toBe("off");
    const r = await runTool("get_presence", {}, "agent");
    expect(r.person).toMatchObject({ sharing: false, pointer: null, hover: null, viewport: null });
    expect(r.summary).toMatch(/not sharing/);
    setSharing(true);
    expect(localStorage.getItem("alza.presence.sharing")).toBe("on");
  });

  it("follows the level the person works on, and the 3D view", async () => {
    dispatch({ type: "add_level", name: "Loft" }, human);
    pageActions.setActiveLevel("Loft");
    pageActions.setCamera("walk");
    const r = await runTool("get_presence", {}, "agent");
    expect(r.person).toMatchObject({ level: { name: "Loft" }, view: "3d", camera: "walk", pointer: null });
  });

  it("point_at shows the person an entity by name, for a while; an unknown or ambiguous one is refused", async () => {
    vi.useFakeTimers();
    try {
      const r = await runTool("point_at", { target: "Bedroom", message: "This one?" }, "agent");
      expect(r).toMatchObject({ ok: true, id: "room_bed" });
      // said, not only drawn: politely to whoever does not see the ring, and kept in the feed
      expect(presence.getState().announcement).toBe("The agent points at Bedroom: This one?");
      expect(state().activity.at(-1)).toMatchObject({ source: "agent", tool: "point_at", summary: 'Pointed the person at room room_bed ("Bedroom"): "This one?"' });
      expect(presence.getState().points).toMatchObject([{ entityId: "room_bed", message: "This one?" }]);
      expect(state().model.rooms).toEqual(seedLoft().rooms);
      expect((await runTool("point_at", { target: "nothing here", message: "?" }, "agent")).ok).toBe(false);
      const ambiguous = await runTool("point_at", { target: "dining_chair", message: "?" }, "agent");
      expect(ambiguous.ok).toBe(false);
      expect((ambiguous.candidates as unknown[]).length).toBeGreaterThan(1);
      vi.advanceTimersByTime(SESSION.pointMs + 1);
      expect(presence.getState().points).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("point_at refuses a message longer than it shows", async () => {
    expect((await runTool("point_at", { target: "Bedroom", message: "x".repeat(SESSION.pointMessage + 1) }, "agent")).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------- messages

const TAB_A = "0123456789abcdef";
const TAB_B = "fedcba9876543210";
const wall = (id: string, extra: Record<string, unknown> = {}) => ({ id, levelId: "level_ground", ax: 0, ay: 0, bx: 2, by: 0, thickness: 0.1, height: 2.5, ...extra });
const ops = (writes: unknown[], extra: Record<string, unknown> = {}) => ({
  app: APP,
  protocol: SESSION.protocol,
  from: TAB_B,
  type: "ops",
  writes,
  meta: { actor: "human", as: "add_wall", summary: "Wall added.", gesture: null },
  ...extra,
});
const w = (k: string, v: unknown, c = 1) => ({ k, c, t: TAB_B, v });

describe("the session's messages", () => {
  it("takes one of ours", () => {
    const m = parseMessage(ops([w("walls:wall_x", wall("wall_x")), w("order:walls", ["wall_x"]), w("plan:name", "Shared")]), TAB_A);
    expect(m?.type).toBe("ops");
  });

  it("strips what a record does not have", () => {
    const m = parseMessage(ops([w("walls:wall_x", wall("wall_x", { evil: "<script>", onload: "x" }))]), TAB_A);
    expect(m && m.type === "ops" ? m.writes[0].v : null).toEqual(wall("wall_x"));
  });

  it.each([
    ["another app", ops([], { app: "other" })],
    ["another version", ops([], { protocol: SESSION.protocol + 1 })],
    ["this tab's own", ops([], { from: TAB_A })],
    ["a malformed tab id", ops([], { from: "../../etc" })],
    ["an unknown type", { app: APP, protocol: SESSION.protocol, from: TAB_B, type: "eval", code: "alert(1)" }],
    ["an extra top-level field", ops([], { code: "alert(1)" })],
    ["a wall whose id is not its key's", ops([w("walls:wall_x", wall("wall_y"))])],
    ["a wall off any level", ops([w("walls:wall_x", { ...wall("wall_x"), levelId: undefined })])],
    ["a wall with an infinite end", ops([w("walls:wall_x", wall("wall_x", { bx: Infinity }))])],
    ["a wall with a NaN end", ops([w("walls:wall_x", wall("wall_x", { ax: Number.NaN }))])],
    ["an unknown collection", ops([w("scripts:x", { id: "x" })])],
    ["a prototype key", ops([w("__proto__:x", { id: "x" })])],
    ["an order of objects", ops([w("order:walls", [{ id: "x" }])])],
    ["an unknown setting", ops([w("plan:underlay", "x")])],
    ["a plan name too long", ops([w("plan:name", "x".repeat(200))])],
    ["a note signed by the page", ops([w("notes:n1", { id: "n1", author: "system", text: "hi", at: 1 })])],
    ["a negative clock", ops([{ k: "walls:wall_x", c: -1, t: TAB_B, v: wall("wall_x") }])],
    ["a summary too long", ops([], { meta: { actor: "human", as: "x", summary: "x".repeat(SESSION.maxSummary + 1), gesture: null } })],
    ["too many writes", ops(Array.from({ length: SESSION.maxWrites + 1 }, (_, i) => w(`walls:w${i}`, null)))],
    ["a snapshot for another tab", { app: APP, protocol: SESSION.protocol, from: TAB_B, type: "snapshot", to: "aaaaaaaaaaaaaaaa", startedAt: 1, established: true, writes: [] }],
    ["a presence whose agent runs free text", { app: APP, protocol: SESSION.protocol, from: TAB_B, type: "presence", startedAt: 1, state: { kind: "person", view: "2d", levelId: null, selection: null, pointer: null, editing: [], agent: { state: "working", tool: "Delete everything now", focus: [] } } }],
    ["a change named in free text", ops([], { meta: { actor: "human", as: "<b>x</b>", summary: "", gesture: null } })],
    ["a clock past what is exact", ops([{ k: "walls:wall_x", c: Number.MAX_SAFE_INTEGER + 1, t: TAB_B, v: wall("wall_x") }])],
    ["a presence with a pointer at infinity", { app: APP, protocol: SESSION.protocol, from: TAB_B, type: "presence", startedAt: 1, state: { kind: "person", view: "2d", levelId: null, selection: null, pointer: { x: Infinity, y: 0 }, editing: [], agent: null } }],
    ["not an object", "hello"],
    ["nothing", null],
  ])("ignores %s", (_why, data) => {
    expect(parseMessage(data, TAB_A)).toBeNull();
  });
});

// ---------------------------------------------------------------------------- the merge

const planOf = (): PlanState => ({ model: seedLoft(), notes: [] });
const asReplica = (s: PlanState) => JSON.parse(JSON.stringify(s)) as PlanState;
/** Two tabs that started from one plan: each with its replica and its state. */
function twoTabs() {
  const start = planOf();
  const a = { state: start, replica: new Replica(TAB_A, start) };
  const writes = a.replica.snapshot();
  const bStart = asReplica(start);
  const b = { state: bStart, replica: new Replica(TAB_B, bStart) };
  b.state = b.replica.adopt(writes, bStart)!.state;
  b.replica.adopt(writes, bStart)!.commit();
  b.replica.settle(b.state);
  return { a, b };
}
type Tab = ReturnType<typeof twoTabs>["a"];
const edit = (tab: Tab, change: (m: PlanModel) => PlanModel): Write[] => {
  tab.state = { ...tab.state, model: change(tab.state.model) };
  return tab.replica.local(tab.state);
};
const hear = (tab: Tab, writes: Write[]) => {
  const merged = tab.replica.receive(structuredClone(writes), tab.state);
  if (!merged) return;
  merged.commit();
  tab.state = merged.state;
  tab.replica.settle(tab.state);
};
const moveItem = (id: string, x: number) => (m: PlanModel): PlanModel => ({ ...m, items: m.items.map((i) => (i.id === id ? { ...i, x } : i)) });
const removeWall = (id: string) => (m: PlanModel): PlanModel => ({ ...m, walls: m.walls.filter((x) => x.id !== id) });
const addItem = (id: string) => (m: PlanModel): PlanModel => ({ ...m, items: [...m.items, { id, levelId: "level_ground", kind: "plant", x: 1, y: 1, rotation: 0 }] });
const same = (a: PlanState, b: PlanState) => expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));

describe("two tabs converge: last writer wins, per entity, by Lamport clock", () => {
  it("one tab's change reaches the other as it was", () => {
    const { a, b } = twoTabs();
    hear(b, edit(a, moveItem("item_sofa", 2)));
    expect(b.state.model.items.find((i) => i.id === "item_sofa")?.x).toBe(2);
    same(a.state, b.state);
  });

  it("both move the same piece at once: whichever way the writes cross, both end on the same one", () => {
    const { a, b } = twoTabs();
    const fromA = edit(a, moveItem("item_sofa", 1));
    const fromB = edit(b, moveItem("item_sofa", 2));
    hear(a, fromB);
    hear(b, fromA);
    same(a.state, b.state);
    // equal clocks: the larger tab id wins, in both
    expect(newer(fromB[0], fromA[0])).toBe(TAB_B > TAB_A);
    expect(a.state.model.items.find((i) => i.id === "item_sofa")?.x).toBe(TAB_B > TAB_A ? 2 : 1);
  });

  it("a later change wins over an earlier one heard late", () => {
    const { a, b } = twoTabs();
    const first = edit(a, moveItem("item_desk", 1));
    hear(b, first);
    const second = edit(b, moveItem("item_desk", 3));
    hear(a, second);
    hear(b, first); // heard again, late: it changes nothing
    same(a.state, b.state);
    expect(b.state.model.items.find((i) => i.id === "item_desk")?.x).toBe(3);
  });

  it("changes to different entities are both kept", () => {
    const { a, b } = twoTabs();
    const fromA = edit(a, moveItem("item_sofa", 1));
    const fromB = edit(b, moveItem("item_desk", 2));
    hear(a, fromB);
    hear(b, fromA);
    same(a.state, b.state);
    expect(a.state.model.items.find((i) => i.id === "item_sofa")?.x).toBe(1);
    expect(a.state.model.items.find((i) => i.id === "item_desk")?.x).toBe(2);
  });

  it("two pieces added at once land in the same order in both tabs", () => {
    const { a, b } = twoTabs();
    const fromA = edit(a, addItem("item_from_a"));
    const fromB = edit(b, addItem("item_from_b"));
    hear(a, fromB);
    hear(b, fromA);
    same(a.state, b.state);
    expect(a.state.model.items.map((i) => i.id)).toEqual(expect.arrayContaining(["item_from_a", "item_from_b"]));
  });

  it("a wall removed in one tab while the other moves a window in it: the openings it carried go in both", () => {
    const { a, b } = twoTabs();
    const fromA = edit(a, (m) => ({ ...removeWall("wall_e")(m), openings: m.openings.filter((o) => o.wallId !== "wall_e") }));
    const fromB = edit(b, (m) => ({ ...m, openings: m.openings.map((o) => (o.id === "win_bed" ? { ...o, t: 0.3 } : o)) }));
    hear(b, fromA);
    hear(a, fromB);
    same(a.state, b.state);
    expect(a.state.model.openings.some((o) => o.wallId === "wall_e")).toBe(false);
  });

  it("three tabs that hear the same writes in different orders hold the same plan", () => {
    const { a, b } = twoTabs();
    const cStart = asReplica(a.state);
    const c = { state: cStart, replica: new Replica("1111111111111111", cStart) };
    const adopted = c.replica.adopt(a.replica.snapshot(), cStart)!;
    adopted.commit();
    c.state = adopted.state;
    c.replica.settle(c.state);
    const w1 = edit(a, moveItem("item_sofa", 1));
    const w2 = edit(b, moveItem("item_sofa", 2));
    const w3 = edit(c, removeWall("wall_bed_s"));
    hear(a, w3);
    hear(a, w2);
    hear(b, w1);
    hear(b, w3);
    hear(c, w2);
    hear(c, w1);
    same(a.state, b.state);
    same(b.state, c.state);
  });

  it("two tabs leaving the last note there is room for at once keep the same notes: the newest", () => {
    const { a, b } = twoTabs();
    const note = (id: string) => ({ id, author: "human" as const, text: id, at: 1 });
    const many = Array.from({ length: MAX_NOTES - 1 }, (_, i) => note(`note_${String(i).padStart(3, "0")}`));
    a.state = { ...a.state, notes: many };
    hear(b, a.replica.local(a.state));
    const fromA = a.replica.local((a.state = { ...a.state, notes: [...a.state.notes, note("note_from_a")] }));
    const fromB = b.replica.local((b.state = { ...b.state, notes: [...b.state.notes, note("note_from_b")] }));
    hear(a, fromB);
    hear(b, fromA);
    same(a.state, b.state);
    expect(a.state.notes).toHaveLength(MAX_NOTES);
    // the plan the merge makes is one the plan takes, in every tab
    expect(actions.applySync(a.state.model, a.state.notes, "", null).ok).toBe(true);
  });

  it("a write heard with a clock near the top raises this tab's no further than leaves room for its own", () => {
    const start = planOf();
    const r = new Replica(TAB_A, start);
    const forged = { k: "items:item_desk", c: Number.MAX_SAFE_INTEGER, t: TAB_B, v: { ...start.model.items[0], id: "item_desk" } };
    r.receive([forged], start)?.commit();
    expect(r.time).toBe(SESSION.maxClock);
    const next = { ...start, model: { ...start.model, name: "Mine" } };
    const mine = r.local(next);
    // what this tab sends next is still a message every other tab takes
    expect(parseMessage(ops(mine.map((x) => ({ ...x, t: TAB_B }))), TAB_A)).not.toBeNull();
  });

  it("an undo step rebased under another tab's change puts back only what the step changed", () => {
    const start = planOf();
    const sofaMoved: PlanState = { ...start, model: moveItem("item_sofa", 2)(start.model) };
    const theirs = diff(sofaMoved, { ...sofaMoved, model: removeWall("wall_e")(moveItem("item_desk", 4)(sofaMoved.model)) });
    const step = rebase(start, theirs);
    expect(step.model.items.find((i) => i.id === "item_desk")?.x).toBe(4);
    expect(step.model.items.find((i) => i.id === "item_sofa")?.x).toBe(start.model.items.find((i) => i.id === "item_sofa")?.x);
    expect(step.model.walls.some((x) => x.id === "wall_e")).toBe(false);
    // what the change took with it (the openings in the removed wall) goes from the step too
    expect(step.model.openings.some((o) => o.wallId === "wall_e")).toBe(false);
    expect(rebase(start, [])).toBe(start);
  });

  it("a merge with no level left is refused, and the plan read back keeps this tab's underlay", () => {
    const start = planOf();
    const r = new Replica(TAB_A, start);
    expect(r.receive([{ k: "levels:level_ground", c: 5, t: TAB_B, v: null }], start)).toBeNull();
    const regs = new Map(r.snapshot().map((x) => [x.k, x]));
    const underlay = { assetId: "a", opacity: 0.5, x: 0, y: 0, w: 1, h: 1 };
    expect(materialize(regs, { ...start, model: { ...start.model, underlay } })?.model.underlay).toBe(underlay);
  });
});

// ---------------------------------------------------------------------------- tabs, end to end

/** Let the in-page transport's deliveries and the session's flushes run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("a tab in the session", () => {
  let session: Session | null = null;
  afterEach(() => {
    session?.stop();
    session = null;
    vi.useRealTimers();
  });

  /** This page's session, and a stand-in for another tab on the same transport. */
  function withPeer(origin?: PlanState, timers: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }) {
    vi.useFakeTimers(timers);
    const hub = inPageHub();
    const heard: unknown[] = [];
    const peer: Transport = hub.connect();
    peer.subscribe((m) => heard.push(m));
    session = startSession({ transport: hub.connect(), origin });
    const send = (m: Record<string, unknown>, from = TAB_B) => peer.send({ app: APP, protocol: SESSION.protocol, from, ...m });
    const of = (type: string) => heard.filter((m) => (m as { type: string }).type === type) as Record<string, unknown>[];
    return { heard, send, peer, of };
  }
  const TAB_C = "abcdefabcdef0123";
  const helloOf = (heard: unknown[]) => (heard.find((m) => (m as { type: string }).type === "hello") as { from: string }).from;

  it("says hello, and with nobody answering works on its own plan", async () => {
    const { heard } = withPeer();
    await settle();
    expect(heard).toMatchObject([{ type: "hello", established: false }]);
    expect(presence.getState().session.state).toBe("joining");
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    expect(presence.getState().session.state).toBe("live");
  });

  it("takes up the plan a tab already holds, with nothing to undo back to", async () => {
    // as the page opens: the plan it starts with is not a step to undo
    store.setState({ undoStack: [] });
    const { heard, send } = withPeer();
    await settle();
    const hello = heard[0] as { from: string };
    const theirs: PlanState = { model: { ...seedLoft(), name: "Their plan" }, notes: [] };
    send({ type: "snapshot", to: hello.from, startedAt: 1, established: true, writes: new Replica(TAB_B, theirs).snapshot() });
    await settle();
    expect(state().model.name).toBe("Their plan");
    expect(state().undoStack).toEqual([]);
    expect(actions.undo().ok).toBe(false);
    expect(presence.getState().session.state).toBe("live");
    expect(state().activity.at(-1)).toMatchObject({ source: "peer", tool: "join" });
  });

  it("takes up a plan once: a later tab's older snapshot loses nothing this tab has heard since", async () => {
    const { heard, send } = withPeer();
    await settle();
    const me = helloOf(heard);
    // tab B answers first; tab C's answer was made before C heard B's next change
    const theirs: PlanState = { model: seedLoft(), notes: [] };
    const b = new Replica(TAB_B, theirs);
    const cSnapshot = new Replica(TAB_C, theirs).snapshot();
    send({ type: "snapshot", to: me, startedAt: 1, established: true, writes: b.snapshot() });
    await settle();
    const placed = { ...theirs, model: { ...theirs.model, items: [...theirs.model.items, { id: "item_newx", levelId: "level_ground", kind: "plant", x: 1, y: 1, rotation: 0 }] } };
    send({ type: "ops", writes: b.local(placed), meta: { actor: "agent", as: "place_item", summary: "Placed.", gesture: null } });
    await settle();
    expect(item("item_newx")).toBeDefined();
    send({ type: "snapshot", to: me, startedAt: 2, established: true, writes: cSnapshot }, TAB_C);
    await settle();
    expect(item("item_newx")).toBeDefined();
    expect(state().activity.filter((e) => e.tool === "join")).toHaveLength(1);
  });

  it("keeps what this tab changed while it joined, over the plan it takes up, and tells the others", async () => {
    const { heard, send, of } = withPeer();
    await settle();
    // the agent moves the desk while the session is still looking for the other tabs
    expect(presence.getState().session.state).toBe("joining");
    expect((await runTool("move_item", { id: "item_desk", x: 4.0, y: 0.45 }, "agent")).ok).toBe(true);
    await settle();
    expect(of("ops")).toHaveLength(0);
    const theirs: PlanState = { model: { ...seedLoft(), name: "Their plan" }, notes: [] };
    const b = new Replica(TAB_B, { ...theirs, model: { ...theirs.model } });
    // the other tab has worked on its plan for a while: its clock is well ahead
    for (let i = 0; i < 5; i++) b.local({ ...theirs, model: { ...theirs.model, name: `Their plan ${i}` } });
    send({ type: "snapshot", to: helloOf(heard), startedAt: 1, established: true, writes: b.snapshot() });
    await settle();
    expect(state().model.name).toBe("Their plan 4");
    expect(item("item_desk")?.x).toBe(4.0);
    // and the others hear of it, stamped after everything in the plan this tab took up
    const sent = of("ops").at(-1) as { writes: Write[] } | undefined;
    expect(sent?.writes.map((x) => x.k)).toContain("items:item_desk");
    expect(Math.min(...sent!.writes.map((x) => x.c))).toBeGreaterThan(b.time);
    const merged = b.receive(sent!.writes, { model: { ...theirs.model, name: "Their plan 4" }, notes: [] });
    expect(merged?.state.model.items.find((i) => i.id === "item_desk")?.x).toBe(4.0);
    // the agent's step is still the tab's own to undo
    expect(actions.undo().ok).toBe(true);
    expect(item("item_desk")?.x).toBe(seedLoft().items.find((i) => i.id === "item_desk")?.x);
    expect(state().model.name).toBe("Their plan 4");
  });

  it("keeps what was changed before the session started, measured from the plan the page opened with", async () => {
    const opened: PlanState = { model: state().model, notes: state().notes };
    dispatch({ type: "move_item", id: "item_sofa", x: 2.2, y: 5.3 }, human);
    const { heard, send } = withPeer(opened);
    await settle();
    send({ type: "snapshot", to: helloOf(heard), startedAt: 1, established: true, writes: new Replica(TAB_B, { model: seedLoft(), notes: [] }).snapshot() });
    await settle();
    expect(item("item_sofa")?.x).toBe(2.2);
  });

  it("sends its changes, and applies another tab's as one line attributed to that tab, with no undo step here", async () => {
    const { heard, send } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    await settle();
    dispatch({ type: "move_item", id: "item_sofa", x: 2.5, y: 5.3 }, human);
    await settle();
    const sent = heard.find((m) => (m as { type: string }).type === "ops") as { writes: Write[]; meta: { as: string } };
    expect(sent.meta.as).toBe("move_item");
    expect(sent.writes.map((x) => x.k)).toEqual(["items:item_sofa"]);

    const depth = state().undoStack.length;
    send({ type: "ops", writes: [{ k: "items:item_desk", c: 99, t: TAB_B, v: { ...item("item_desk"), x: 3 } }], meta: { actor: "agent", as: "move_item", summary: "Item item_desk moved to (3.00, 0.45).", gesture: null } });
    await settle();
    expect(item("item_desk")?.x).toBe(3);
    expect(state().undoStack.length).toBe(depth);
    expect(state().activity.at(-1)).toMatchObject({ source: "peer", tool: "move_item", summary: "Item item_desk moved to (3.00, 0.45)." });
    // and it is not sent back
    expect(heard.filter((m) => (m as { type: string }).type === "ops")).toHaveLength(1);
  });

  it("Undo takes back this tab's own change, never the other tab's, and tells the others only that", async () => {
    const { send, of } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    const sofa = item("item_sofa")!;
    dispatch({ type: "move_item", id: "item_sofa", x: 2, y: 2 }, human);
    await settle();
    send({ type: "ops", writes: [{ k: "items:item_desk", c: 99, t: TAB_B, v: { ...item("item_desk"), x: 4 } }], meta: { actor: "human", as: "move_item", summary: "Moved.", gesture: null } });
    await settle();
    expect(dispatch({ type: "undo" }, human).ok).toBe(true);
    await settle();
    expect(item("item_sofa")).toMatchObject({ x: sofa.x, y: sofa.y });
    expect(item("item_desk")?.x).toBe(4);
    expect((of("ops").at(-1) as { writes: Write[] }).writes.map((x) => x.k)).toEqual(["items:item_sofa"]);
  });

  it("another tab's change landing mid-drag does not split the person's drag in two", async () => {
    const { send } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    const depth = state().undoStack.length;
    const sofa = item("item_sofa")!;
    const drag = beginGesture(human);
    drag.update({ type: "move_item", id: "item_sofa", x: 2, y: 5.3 });
    send({ type: "ops", writes: [{ k: "items:item_desk", c: 99, t: TAB_B, v: { ...item("item_desk"), x: 4 } }], meta: { actor: "human", as: "move_item", summary: "Moved.", gesture: null } });
    await settle();
    drag.update({ type: "move_item", id: "item_sofa", x: 2.5, y: 5.3 });
    drag.end();
    expect(state().undoStack.length).toBe(depth + 1);
    actions.undo();
    expect(item("item_sofa")?.x).toBe(sofa.x);
    expect(item("item_desk")?.x).toBe(4);
  });

  it("tells the others what the hand holds before the frame that took hold of it", async () => {
    const { heard } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    await settle();
    // the pointer was just shared: what the hand holds does not wait for the next interval
    presence.setState({ person: { pointer: { x: 1, y: 1 }, hoverId: null, viewport: null } });
    heard.length = 0;
    const drag = beginGesture(human);
    drag.update({ type: "move_item", id: "item_bed", x: 6.9, y: 2.1 });
    await settle();
    const types = heard.map((m) => (m as { type: string }).type);
    expect(types.slice(0, 2)).toEqual(["presence", "ops"]);
    expect((heard[0] as { state: { editing: string[] } }).state.editing).toEqual(["item_bed"]);
    drag.end();
  });

  it("folds another tab's drag into one line here, as it was there, with no undo step", async () => {
    const { send } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    const depth = state().undoStack.length;
    const lines = state().activity.length;
    for (let i = 1; i <= 5; i++) {
      send({ type: "ops", writes: [{ k: "items:item_desk", c: 100 + i, t: TAB_B, v: { ...item("item_desk"), x: 3 + i / 10 } }], meta: { actor: "human", as: "move_item", summary: `frame ${i}`, gesture: `${TAB_B}.1` } });
      await settle();
    }
    expect(item("item_desk")?.x).toBeCloseTo(3.5);
    expect(state().undoStack.length).toBe(depth);
    vi.advanceTimersByTime(SESSION.gestureIdleMs + 1);
    expect(state().activity.length).toBe(lines + 1);
    expect(state().activity.at(-1)).toMatchObject({ source: "peer", summary: "frame 5" });
  });

  it("ignores a hostile message and keeps working", async () => {
    const { send, peer } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    const before = state().model;
    send({ type: "ops", writes: [{ k: "walls:wall_n", c: 500, t: TAB_B, v: { ...before.walls[0], ax: "0; alert(1)" } }], meta: { actor: "human", as: "x", summary: "", gesture: null } });
    peer.send({ app: APP, protocol: SESSION.protocol, from: TAB_B, type: "ops", writes: [], meta: null });
    peer.send({ evil: true });
    await settle();
    expect(state().model).toBe(before);
  });

  it("shows another tab's person, numbered by when they joined, and forgets a tab that says goodbye", async () => {
    const { send } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    send({ type: "presence", startedAt: 0, state: { kind: "person", view: "2d", levelId: "level_ground", selection: "item_sofa", pointer: { x: 1, y: 2 }, editing: [], agent: null } });
    await settle();
    expect(presence.getState().peers).toMatchObject([{ id: TAB_B, ordinal: 1, pointer: { x: 1, y: 2 }, selection: "item_sofa" }]);
    expect(presence.getState().session.ordinal).toBe(2);
    expect(presence.getState().announcement).toBe("Tab 1 joined the plan.");
    send({ type: "bye" });
    await settle();
    expect(presence.getState().peers).toEqual([]);
    expect(presence.getState().announcement).toBe("Tab 1 left the plan.");
  });

  it("shares the pointer at most once an interval, the last position of a burst always, and nothing unchanged", async () => {
    const { of } = withPeer(undefined, { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    await settle();
    const before = of("presence").length;
    for (let i = 1; i <= 10; i++) presence.setState({ person: { pointer: { x: i, y: 1 }, hoverId: null, viewport: null } });
    vi.advanceTimersByTime(SESSION.presenceIntervalMs + 1);
    await settle();
    const sent = of("presence").slice(before) as { state: { pointer: { x: number } | null } }[];
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(sent.at(-1)?.state.pointer?.x).toBe(10);
    // the same again is not said again between heartbeats
    presence.setState({ person: { pointer: { x: 10, y: 1 }, hoverId: "item_sofa", viewport: null } });
    presence.setState({ person: { pointer: { x: 10, y: 1 }, hoverId: null, viewport: null } });
    vi.advanceTimersByTime(SESSION.presenceIntervalMs + 1);
    await settle();
    expect(of("presence").length).toBe(before + sent.length);
  });

  it("sends nothing while sharing is off and only the pointer moves", async () => {
    const { of } = withPeer(undefined, { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    setSharing(false);
    vi.advanceTimersByTime(SESSION.presenceIntervalMs + 1);
    await settle();
    const before = of("presence").length;
    for (let i = 1; i <= 10; i++) {
      presence.setState({ person: { pointer: { x: i, y: 1 }, hoverId: null, viewport: null } });
      vi.advanceTimersByTime(SESSION.presenceIntervalMs + 1);
    }
    await settle();
    expect(of("presence").length).toBe(before);
    setSharing(true);
  });

  it("a heartbeat that says nothing new leaves the list of tabs as it was", async () => {
    const { send } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    const said = { kind: "person", view: "2d", levelId: "level_ground", selection: null, pointer: { x: 1, y: 2 }, editing: [], agent: null };
    send({ type: "presence", startedAt: 0, state: said });
    await settle();
    const peers = presence.getState().peers;
    send({ type: "presence", startedAt: 0, state: said });
    await settle();
    expect(presence.getState().peers).toBe(peers);
    send({ type: "presence", startedAt: 0, state: { ...said, pointer: { x: 2, y: 2 } } });
    await settle();
    expect(presence.getState().peers).not.toBe(peers);
  });

  it("does not share the person's pointer when they keep it to themselves", async () => {
    const { heard } = withPeer();
    vi.advanceTimersByTime(SESSION.joinWaitMs + 1);
    setSharing(false);
    presence.setState({ person: { pointer: { x: 4, y: 4 }, hoverId: null, viewport: null } });
    vi.advanceTimersByTime(SESSION.heartbeatMs + 1);
    await settle();
    const shared = heard.filter((m) => (m as { type: string }).type === "presence") as { state: { pointer: unknown } }[];
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((m) => m.state.pointer === null)).toBe(true);
    setSharing(true);
  });
});
