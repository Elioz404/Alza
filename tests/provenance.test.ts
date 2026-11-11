/**
 * Provenance: which entities each line of the activity feed changed, and the numbers the drawing
 * and the feed share. The agent's latest changes are marked on the plan until the human changes
 * the same entity (an edit, or an Undo that puts it back) or it is removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../src/model/store";
import { beginGesture, dispatch } from "../src/model/commands";
import { seedLoft } from "../src/model/seed";
import { agentMarks, changedEntities, provenance, revisionOf } from "../src/model/provenance";
import { resetStore } from "./support/store";
import { rectOutline } from "../src/model/shapes";

const agent = { actor: "agent" } as const;
const human = { actor: "human" } as const;
const revisions = () => provenance.getState().revisions;
const lastEntry = () => store.getState().activity.at(-1)!;

beforeEach(() => {
  resetStore();
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
});

describe("changedEntities", () => {
  it("names what was added, replaced and removed, by identity", () => {
    const before = seedLoft();
    const after = {
      ...before,
      walls: before.walls.slice(1),
      items: before.items.map((i, n) => (n === 0 ? { ...i, x: i.x + 1 } : i)),
      rooms: [...before.rooms, { id: "room_new", levelId: "level_ground", points: rectOutline(0, 0, 1, 1), label: "Nook", floor: "oak" as const }],
    };
    const change = changedEntities(before, after);
    expect(change.touched).toEqual(["room_new", before.items[0].id]);
    expect(change.removed).toEqual([before.walls[0].id]);
    expect(changedEntities(before, before)).toEqual({ touched: [], removed: [] });
  });
});

describe("the ledger", () => {
  it("numbers each change by an actor, in order, and leaves the page's own unnumbered", () => {
    expect(revisions()).toHaveLength(1);
    expect(revisions()[0].n).toBe(0);
    dispatch({ type: "place_item", kind: "plant", x: 6, y: 2 }, agent);
    const placed = store.getState().model.items.at(-1)!;
    expect(revisionOf(revisions(), lastEntry().id)).toMatchObject({ n: 1, source: "agent", touched: [placed.id] });
    dispatch({ type: "move_item", id: "item_sofa", x: 3, y: 5.2 }, human);
    expect(revisionOf(revisions(), lastEntry().id)).toMatchObject({ n: 2, source: "human", touched: ["item_sofa"] });
  });

  it("gives a refused change no number", () => {
    dispatch({ type: "remove_wall", id: "no_such_wall" }, agent);
    expect(lastEntry().ok).toBe(false);
    expect(revisionOf(revisions(), lastEntry().id)).toBeUndefined();
  });

  it("counts a whole gesture as one change", () => {
    const g = beginGesture(human);
    g.update({ type: "move_item", id: "item_sofa", x: 3, y: 5 });
    g.update({ type: "move_item", id: "item_sofa", x: 3.5, y: 5 });
    g.end();
    expect(revisionOf(revisions(), lastEntry().id)).toMatchObject({ n: 1, touched: ["item_sofa"] });
  });

  it("starts over when the feed does", () => {
    dispatch({ type: "place_item", kind: "plant", x: 6, y: 2 }, agent);
    resetStore();
    expect(revisions()).toEqual([]);
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", undoable: false });
    dispatch({ type: "place_item", kind: "plant", x: 6, y: 2 }, agent);
    expect(revisions().at(-1)?.n).toBe(1);
  });
});

describe("agent marks", () => {
  it("mark what the agent changed last, with the feed's number", () => {
    dispatch({ type: "move_item", id: "item_sofa", x: 3, y: 5.2 }, agent);
    expect(agentMarks(revisions(), 5)).toEqual([{ id: "item_sofa", n: 1 }]);
  });

  it("clear when the human changes the same entity, or undoes the agent's change", () => {
    dispatch({ type: "move_item", id: "item_sofa", x: 3, y: 5.2 }, agent);
    dispatch({ type: "move_item", id: "item_sofa", x: 3.2, y: 5.2 }, human);
    expect(agentMarks(revisions(), 5)).toEqual([]);

    dispatch({ type: "edit_wall", id: "wall_bed_s", patch: { thickness: 0.12 } }, agent);
    expect(agentMarks(revisions(), 5).map((m) => m.id)).toContain("wall_bed_s");
    dispatch({ type: "undo" }, human);
    expect(agentMarks(revisions(), 5).map((m) => m.id)).not.toContain("wall_bed_s");
  });

  it("clear when the entity is gone, and keep only the agent's latest changes", () => {
    dispatch({ type: "move_item", id: "item_sofa", x: 3, y: 5.2 }, agent);
    dispatch({ type: "remove_item", id: "item_sofa" }, human);
    expect(agentMarks(revisions(), 5)).toEqual([]);

    for (const x of [1, 2, 3]) dispatch({ type: "place_item", kind: "plant", x, y: 2 }, agent);
    expect(agentMarks(revisions(), 2).map((m) => m.n)).toEqual([4, 5]);
  });
});
