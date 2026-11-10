/**
 * One command pipeline for both actors. Every change goes through dispatch(command, { actor }):
 * the same checks, one undo step per command, one activity line attributed to whoever asked —
 * whether the human clicked, an agent called a tool, or the human ran one in the ToolRunner.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { actions, store } from "../src/model/store";
import { beginGesture, dispatch } from "../src/model/commands";
import { executeWrapped, type ToolDef } from "../src/mcp/registry";
import { EXTEND_SELECTED_WALL, TOOLS, runTool, runToolManually } from "../src/mcp/tools";
import { supplierKind } from "../src/model/catalog";
import { seedLoft } from "../src/model/seed";
import { useGesture, type GestureHandle } from "../src/ui/useGesture";
import { kindOf, resetStore } from "./support/store";

beforeEach(resetStore);

const state = () => store.getState();
const feed = () => state().activity;
const undoDepth = () => state().undoStack.length;
const tool = (name: string): ToolDef => TOOLS.find((t) => t.name === name)!;
const human = { actor: "human" } as const;
const agent = { actor: "agent" } as const;

const PRODUCT = { sku: "NK-TST-01", name: "Test sofa", category: "living", w: 2, d: 0.9, h: 0.8, color: "#8d8577" };

describe("dispatch", () => {
  it("applies the change, records one undo step and one feed line for its actor", () => {
    const r = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    expect(r.ok).toBe(true);
    expect(state().model.walls).toHaveLength(1);
    expect(undoDepth()).toBe(1);
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "human", tool: "add_wall", ok: true, summary: r.summary });
  });

  it("attributes the same change to the agent when the agent asks", () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, agent);
    expect(feed().at(-1)).toMatchObject({ source: "agent", tool: "add_wall" });
  });

  it("applies the actions' own checks, and a refusal changes nothing but is still logged", () => {
    const before = state().model;
    const r = dispatch({ type: "add_wall", ax: 0, ay: 0, bx: NaN, by: 0 }, human);
    expect(r.ok).toBe(false);
    expect(state().model).toBe(before);
    expect(undoDepth()).toBe(0);
    expect(feed().at(-1)).toMatchObject({ source: "human", tool: "add_wall", ok: false });
  });

  it("records a command that runs several actions as ONE undo step", () => {
    const r = dispatch({ type: "place_supplier_product", product: PRODUCT, x: 1, y: 1 }, agent);
    expect(r.ok).toBe(true);
    expect(kindOf(supplierKind(PRODUCT.sku))).toBeDefined();
    expect(state().model.items).toHaveLength(1);
    expect(undoDepth()).toBe(1);
    dispatch({ type: "undo" }, human);
    // the piece and the kind it came with go together
    expect(state().model.items).toHaveLength(0);
    expect(kindOf(supplierKind(PRODUCT.sku))).toBeUndefined();
  });

  it("a refused placement does not leave the adopted kind (or its undo step) behind", () => {
    const before = state();
    const r = dispatch({ type: "place_supplier_product", product: PRODUCT, x: Infinity, y: 1 }, agent);
    expect(r.ok).toBe(false);
    expect(state().model).toBe(before.model);
    expect(state().undoStack).toBe(before.undoStack);
  });

  it("signs a note with the actor, never with what the caller claims", () => {
    dispatch({ type: "leave_note", text: "from the page" }, human);
    dispatch({ type: "leave_note", text: "from the agent" }, agent);
    expect(state().notes.map((n) => n.author)).toEqual(["human", "agent"]);
  });

  it("undo is a command too: logged for its actor", () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "undo" }, human);
    expect(state().model.walls).toHaveLength(0);
    expect(feed().at(-1)).toMatchObject({ source: "human", tool: "undo", ok: true });
  });
});

describe("gestures", () => {
  it("a drag applies every frame but is one undo step and one feed line", () => {
    actions.loadModel(seedLoft());
    const depth = undoDepth();
    const start = state().model.items.find((i) => i.id === "item_plant")!;
    const g = beginGesture(human);
    for (let i = 1; i <= 10; i++) g.update({ type: "move_item", id: "item_plant", x: 7 - i * 0.05, y: 3 });
    expect(state().model.items.find((i) => i.id === "item_plant")!.x).toBeCloseTo(6.5);
    expect(feed()).toHaveLength(0);
    expect(undoDepth()).toBe(depth + 1);
    g.end();
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "human", tool: "move_item", ok: true });
    dispatch({ type: "undo" }, human);
    expect(state().model.items.find((i) => i.id === "item_plant")).toEqual(start);
  });

  it("a gesture that never moved writes nothing", () => {
    const g = beginGesture(human);
    g.end();
    expect(feed()).toHaveLength(0);
    expect(undoDepth()).toBe(0);
  });

  it("typing a name is one rename, not one per keystroke", () => {
    const g = beginGesture(human);
    for (const name of ["L", "Lo", "Lof", "Loft"]) g.update({ type: "set_plan_name", name });
    g.end();
    expect(state().model.name).toBe("Loft");
    expect(undoDepth()).toBe(1);
    expect(feed().map((a) => a.summary)).toEqual(['Plan renamed to "Loft".']);
  });

  it("a change from someone else in the middle of a gesture keeps its own undo step", () => {
    actions.loadModel(seedLoft());
    const depth = undoDepth();
    const plant = () => state().model.items.find((i) => i.id === "item_plant")!;
    const start = plant().x;
    const g = beginGesture(human);
    g.update({ type: "move_item", id: "item_plant", x: 7.5, y: 3 });
    // an agent's tool call lands between two frames of the drag
    const wall = dispatch({ type: "add_wall", ax: 10, ay: 0, bx: 12, by: 0 }, agent).id as string;
    g.update({ type: "move_item", id: "item_plant", x: 7.4, y: 3 });
    g.update({ type: "move_item", id: "item_plant", x: 7.3, y: 3 });
    g.end();
    // the drag before the agent, the agent's wall, the drag after it: three steps, three lines
    expect(undoDepth()).toBe(depth + 3);
    expect(feed().map((a) => `${a.source}:${a.tool}`).sort()).toEqual(["agent:add_wall", "human:move_item", "human:move_item"]);
    const hasWall = () => state().model.walls.some((w) => w.id === wall);

    dispatch({ type: "undo" }, human);
    expect(plant().x).toBeCloseTo(7.5);
    expect(hasWall()).toBe(true);
    dispatch({ type: "undo" }, human);
    expect(hasWall()).toBe(false);
    expect(plant().x).toBeCloseTo(7.5);
    dispatch({ type: "undo" }, human);
    expect(plant().x).toBe(start);
  });

  it("an undo from someone else in the middle of a gesture starts the gesture a new step", () => {
    actions.loadModel(seedLoft());
    const depth = undoDepth();
    const g = beginGesture(human);
    g.update({ type: "move_item", id: "item_plant", x: 7.5, y: 3 });
    dispatch({ type: "undo" }, agent);
    expect(undoDepth()).toBe(depth);
    g.update({ type: "move_item", id: "item_plant", x: 7.4, y: 3 });
    g.end();
    expect(undoDepth()).toBe(depth + 1);
  });
});

describe("every command is one undo step", () => {
  const UNDERLAY = { dataUrl: "data:image/jpeg;base64,AAAA", opacity: 0.5, x: 0, y: 0, w: 8, h: 6, pw: 800, ph: 600 };

  it("setting the underlay is undone like any other change", () => {
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    expect(undoDepth()).toBe(1);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay).toBeNull();
  });

  it("removing the underlay by mistake is taken back by one undo", () => {
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    dispatch({ type: "set_underlay", underlay: null }, human);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay).toEqual(UNDERLAY);
  });

  it("an undo after the upload takes back the blueprint alone, not the wall drawn before it", () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay).toBeNull();
    expect(state().model.walls).toHaveLength(1);
  });

  it("an undo of a wall drawn over the blueprint leaves the blueprint", () => {
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "undo" }, human);
    expect(state().model.walls).toHaveLength(0);
    expect(state().model.underlay).toEqual(UNDERLAY);
  });

  it("one opacity slide is one undo step and one feed line", () => {
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    const depth = undoDepth();
    const g = beginGesture(human);
    for (const opacity of [0.4, 0.3, 0.2]) g.update({ type: "set_underlay", underlay: { ...UNDERLAY, opacity } });
    g.end();
    expect(undoDepth()).toBe(depth + 1);
    expect(feed().filter((a) => a.tool === "set_underlay")).toHaveLength(2);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay?.opacity).toBe(UNDERLAY.opacity);
  });

  it("a calibration can be undone", () => {
    dispatch({ type: "set_underlay", underlay: UNDERLAY }, human);
    const r = dispatch({ type: "calibrate_underlay", u1: 0, v1: 0, u2: 1, v2: 0, meters: 4 }, agent);
    expect(r.ok).toBe(true);
    expect(state().model.underlay?.w).toBeCloseTo(4);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay).toEqual(UNDERLAY);
  });

  it("clear_model then undo brings the notes back with the plan", () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "leave_note", text: "keep me" }, agent);
    const notes = state().notes;
    dispatch({ type: "clear_model" }, human);
    expect(state().notes).toEqual([]);
    dispatch({ type: "undo" }, human);
    expect(state().notes).toBe(notes);
    expect(state().model.walls).toHaveLength(1);
  });

  it("a note is its own step: one undo takes back the note, not the wall drawn before it", () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "leave_note", text: "measure the door" }, agent);
    dispatch({ type: "undo" }, human);
    expect(state().notes).toHaveLength(0);
    expect(state().model.walls).toHaveLength(1);
  });
});

describe("useGesture", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  /** A component that only holds a gesture, and hands it out once mounted. */
  function Dragger({ onReady }: { onReady: (g: GestureHandle) => void }) {
    const gesture = useGesture();
    useEffect(() => {
      onReady(gesture);
    }, [gesture, onReady]);
    return null;
  }

  it("a gesture still open when its component goes away is closed, with its feed line", async () => {
    actions.loadModel(seedLoft());
    let drag: GestureHandle | undefined;
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Dragger, {
          onReady: (g) => {
            drag = g;
          },
        })));
    drag!.update({ type: "move_item", id: "item_plant", x: 7.5, y: 3 });
    expect(feed()).toHaveLength(0);
    // e.g. an agent's build_3d swaps the 2D editor out while the hand is still down
    await act(async () => root.unmount());
    expect(feed()).toEqual([expect.objectContaining({ source: "human", tool: "move_item", ok: true })]);
  });
});

describe("the plan the page opens with", () => {
  it("is loaded through dispatch by the page itself, with no undo step to blank it", () => {
    const r = dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", as: "seed", undoable: false });
    expect(r.ok).toBe(true);
    expect(state().model.walls.length).toBeGreaterThan(0);
    expect(undoDepth()).toBe(0);
    expect(feed()).toEqual([expect.objectContaining({ source: "system", tool: "seed", ok: true })]);
    expect(dispatch({ type: "undo" }, human).ok).toBe(false);
    expect(state().model.walls.length).toBeGreaterThan(0);
  });

  it("the page signs no notes", () => {
    expect(dispatch({ type: "leave_note", text: "from nobody" }, { actor: "system" }).ok).toBe(false);
    expect(state().notes).toHaveLength(0);
  });
});

describe("tools reach the plan through dispatch", () => {
  it("an agent's tool call is one feed line, attributed to the agent, under the tool's name", async () => {
    const r = await executeWrapped(tool("add_wall"), { ax: 0, ay: 0, bx: 4, by: 0 });
    expect(r.ok).toBe(true);
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "agent", tool: "add_wall", ok: true });
  });

  it("the ToolRunner is the human pressing Run: the same pipeline, logged as the human", async () => {
    await runToolManually("add_wall", { ax: 0, ay: 0, bx: 4, by: 0 });
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "human", tool: "add_wall" });
  });

  it("a note left from the ToolRunner is the human's; one left by an agent is the agent's", async () => {
    await runToolManually("leave_note", { text: "typed by the human" });
    await runTool("leave_note", { text: "sent by an agent" }, "agent");
    expect(state().notes.map((n) => n.author)).toEqual(["human", "agent"]);
  });

  it("a read is logged once, by the adapter, since nothing was dispatched", async () => {
    await executeWrapped(tool("get_model"), {});
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "agent", tool: "get_model" });
  });

  it("a tool that dispatches a differently named command is still logged under the tool's name", async () => {
    const id = actions.addWall(0, 0, 4, 0).id as string;
    actions.selectWall(id);
    const r = await executeWrapped(EXTEND_SELECTED_WALL, { meters: 1, end: "b" });
    expect(r.ok).toBe(true);
    expect(feed()).toHaveLength(1);
    expect(feed()[0]).toMatchObject({ source: "agent", tool: "extend_selected_wall" });
  });

  it("an agent's tool change is undone by one undo, like the human's", async () => {
    await executeWrapped(tool("add_wall"), { ax: 0, ay: 0, bx: 4, by: 0 });
    expect(undoDepth()).toBe(1);
    dispatch({ type: "undo" }, human);
    expect(state().model.walls).toHaveLength(0);
  });
});
