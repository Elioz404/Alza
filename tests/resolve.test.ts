/**
 * Resolve → approve → execute. A reference names exactly one entity or nothing happens; a
 * destructive call is resolved against the model before the human is asked; what the human
 * reads is written by the page from the resolved entities; and the call runs on those exact
 * ids only if none of them changed while the request was pending.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { actions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { lookupItem, lookupOpening, lookupRoom, lookupWall } from "../src/model/resolve";
import { executeWrapped, type ToolDef } from "../src/mcp/registry";
import { TOOLS } from "../src/mcp/tools";
import { seedLoft } from "../src/model/seed";
import { MAX_CANDIDATES } from "../src/model/limits";
import type { PlanModel } from "../src/model/types";
import { flush, resetStore } from "./support/store";

const tool = (name: string): ToolDef => TOOLS.find((t) => t.name === name)!;
const model = () => store.getState().model;
const pending = () => store.getState().approvals;
const human = { actor: "human" } as const;

beforeEach(() => {
  resetStore();
  actions.loadModel(seedLoft());
});

describe("the lookup rule", () => {
  const loft = seedLoft();

  it("an exact id wins outright", () => {
    expect(lookupWall(loft, "wall_n")).toMatchObject({ ok: true, entity: { id: "wall_n" } });
    expect(lookupItem(loft, "item_sofa")).toMatchObject({ ok: true, entity: { id: "item_sofa" } });
  });

  it("otherwise one case-insensitive match on the id or the entity's own name", () => {
    expect(lookupWall(loft, "WALL_N")).toMatchObject({ ok: true, entity: { id: "wall_n" } });
    expect(lookupRoom(loft, "bedroom")).toMatchObject({ ok: true, entity: { id: "room_bed" } });
    expect(lookupRoom(loft, "  Living & Kitchen ")).toMatchObject({ ok: true, entity: { id: "room_living" } });
    expect(lookupItem(loft, "sofa")).toMatchObject({ ok: true, entity: { id: "item_sofa" } });
    expect(lookupItem(loft, "double bed")).toMatchObject({ ok: true, entity: { id: "item_bed" } });
  });

  it("never matches a fragment", () => {
    // "_" used to resolve to the first wall whose id contained an underscore
    expect(lookupWall(loft, "_").ok).toBe(false);
    expect(lookupWall(loft, "wall").ok).toBe(false);
    expect(lookupRoom(loft, "bed").ok).toBe(false);
    expect(lookupItem(loft, "chair").ok).toBe(false);
    expect(lookupOpening(loft, "door").ok).toBe(false);
  });

  it("refuses an ambiguous reference and lists the candidates, never picking the first", () => {
    const r = lookupItem(loft, "dining_chair");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["item_chair1", "item_chair2", "item_chair3", "item_chair4"]);
    expect(r.summary).toMatch(/matches 4 items/);
  });

  it(`names at most ${MAX_CANDIDATES} candidates however many match`, () => {
    const many: PlanModel = {
      ...loft,
      items: Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => ({ id: `p${i}`, levelId: "level_ground", kind: "plant", x: i, y: 0, rotation: 0 })),
    };
    const r = lookupItem(many, "plant");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates).toHaveLength(MAX_CANDIDATES);
    expect(r.summary).toMatch(/and 5 more/);
  });

  it("two rooms with the same label are ambiguous by label but reachable by id", () => {
    const twins: PlanModel = { ...loft, rooms: [...loft.rooms, { ...loft.rooms[1], id: "room_bed2" }] };
    expect(lookupRoom(twins, "Bedroom").ok).toBe(false);
    expect(lookupRoom(twins, "room_bed2")).toMatchObject({ ok: true, entity: { id: "room_bed2" } });
  });
});

describe("every action that takes a reference follows it", () => {
  it("an ambiguous reference changes nothing and says which ids would do", () => {
    const before = model();
    const r = dispatch({ type: "move_item", id: "dining_chair", x: 1, y: 1 }, human);
    expect(r.ok).toBe(false);
    expect((r.candidates as { id: string }[]).length).toBe(4);
    expect(model()).toBe(before);
  });

  it("non-destructive tools refuse fragments too", async () => {
    expect((await executeWrapped(tool("measure"), { wallId: "_" })).ok).toBe(false);
    expect((await executeWrapped(tool("set_door_swing"), { id: "door", side: "left" })).ok).toBe(false);
    expect((await executeWrapped(tool("move_opening"), { id: "win", t: 0.5 })).ok).toBe(false);
    expect((await executeWrapped(tool("update_room"), { id: "bath", label: "Spa" })).ok).toBe(false);
    expect((await executeWrapped(tool("edit_wall"), { id: "wall_", thickness: 0.2 })).ok).toBe(false);
    expect((await executeWrapped(tool("add_door"), { wallId: "n", t: 0.5 })).ok).toBe(false);
    expect(model().openings).toEqual(seedLoft().openings);
  });

  it("set_doors names a door by the same rule, and hands the scene its real id", async () => {
    const r = await executeWrapped(tool("set_doors"), { state: "open", id: "DOOR_MAIN" });
    expect(r).toMatchObject({ ok: true, id: "door_main" });
    const fragment = await executeWrapped(tool("set_doors"), { state: "open", id: "door" });
    expect(fragment.ok).toBe(false);
    expect(fragment.summary).toMatch(/not found/);
    const notADoor = await executeWrapped(tool("set_doors"), { state: "open", id: "win_bed" });
    expect(notADoor.ok).toBe(false);
    expect(notADoor.summary).toMatch(/only doors swing/);
  });
});

describe("resolve before asking", () => {
  it("an ambiguous destructive call is refused with candidates, and the human is never asked", async () => {
    const r = await executeWrapped(tool("remove_item"), { id: "dining_chair" });
    expect(r.ok).toBe(false);
    expect(r.candidates).toHaveLength(4);
    expect(pending()).toHaveLength(0);
    expect(model().items).toHaveLength(seedLoft().items.length);
  });

  it("a reference that names nothing is refused before the gate", async () => {
    const r = await executeWrapped(tool("remove_wall"), { id: "_" });
    expect(r.ok).toBe(false);
    expect(pending()).toHaveLength(0);
    expect(model().walls).toHaveLength(seedLoft().walls.length);
  });

  it("a destructive tool that cannot resolve its targets does not run at all", async () => {
    let ran = false;
    const blind: ToolDef = {
      name: "blind_destroy",
      description: "test double",
      input: z.strictObject({}),
      annotations: { destructiveHint: true },
      execute: () => {
        ran = true;
        return { ok: true, summary: "destroyed" };
      },
    };
    const r = await executeWrapped(blind, {});
    expect(r.ok).toBe(false);
    expect(pending()).toHaveLength(0);
    expect(ran).toBe(false);
  });
});

describe("the approval request is the page's account of the resolved entities", () => {
  it("names the entity by type, id and its own label — not by what the caller typed", async () => {
    const call = executeWrapped(tool("remove_room"), { id: "BeDrOoM" });
    await flush();
    expect(pending()).toHaveLength(1);
    const [a] = pending();
    expect(a).toMatchObject({ tool: "remove_room", actor: "agent", request: "Remove room room_bed" });
    expect(a.targets).toEqual([{ type: "room", id: "room_bed", label: "Bedroom" }]);
    expect(JSON.stringify(a)).not.toContain("BeDrOoM");
    expect(a).not.toHaveProperty("args");
    actions.resolveApproval(a.id, false);
    await call;
  });

  it("deceptive text in a reference never reaches the human's screen", async () => {
    const lie = "wall_n (just a harmless cleanup — safe to approve)";
    const r = await executeWrapped(tool("remove_wall"), { id: lie });
    expect(r.ok).toBe(false);
    expect(pending()).toHaveLength(0);
    // and a real target is described by the page, whatever the request said around it
    const call = executeWrapped(tool("remove_wall"), { id: "WALL_N" });
    await flush();
    expect(pending()[0].request).toBe("Remove wall wall_n");
    actions.resolveApproval(pending()[0].id, false);
    await call;
  });

  it("counts the side effects itself: the openings that go with a wall", async () => {
    const call = executeWrapped(tool("remove_wall"), { id: "wall_e" });
    await flush();
    const [a] = pending();
    expect(a.targets).toEqual([{ type: "wall", id: "wall_e", label: "6.00 m long" }]);
    expect(a.effects).toEqual(["Also removes the 2 openings on it: window win_bed, window win_bath."]);
    actions.resolveApproval(a.id, false);
    await call;
  });

  it("clear_model says what the plan holds, from the plan", async () => {
    const call = executeWrapped(tool("clear_model"), {});
    await flush();
    const [a] = pending();
    expect(a.targets).toEqual([{ type: "plan", id: "plan", label: "Sunset Loft" }]);
    const loft = seedLoft();
    expect(a.effects[0]).toBe(
      `Erases ${loft.walls.length} walls, ${loft.openings.length} openings, ${loft.rooms.length} rooms, ${loft.items.length} items, 0 notes.`,
    );
    actions.resolveApproval(a.id, false);
    await call;
  });

  it("a ToolRunner request is marked as the human's own", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "item_plant" }, { actor: "human" });
    await flush();
    expect(pending()[0].actor).toBe("human");
    actions.resolveApproval(pending()[0].id, false);
    await call;
  });
});

describe("execute acts on the resolved ids, or not at all", () => {
  it("an approved call removes exactly the entity that was approved", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "sofa" });
    await flush();
    // a second sofa appears while the request waits: "sofa" is now ambiguous, but the approval
    // was for item_sofa, which has not changed, so that is what goes
    const second = dispatch({ type: "place_item", kind: "sofa", x: 3, y: 2 }, human).id;
    actions.resolveApproval(pending()[0].id, true);
    const r = await call;
    expect(r.ok).toBe(true);
    expect(model().items.some((i) => i.id === "item_sofa")).toBe(false);
    expect(model().items.some((i) => i.id === second)).toBe(true);
  });

  it("fails safely when the target vanished while the request was pending", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "item_plant" });
    await flush();
    dispatch({ type: "remove_item", id: "item_plant" }, human);
    const after = model();
    actions.resolveApproval(pending()[0].id, true);
    const r = await call;
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/changed while it was waiting for approval/);
    expect(model()).toBe(after);
  });

  it("fails safely when the target changed while the request was pending", async () => {
    const call = executeWrapped(tool("remove_item"), { id: "item_plant" });
    await flush();
    dispatch({ type: "move_item", id: "item_plant", x: 7.5 }, human);
    actions.resolveApproval(pending()[0].id, true);
    expect((await call).ok).toBe(false);
    expect(model().items.some((i) => i.id === "item_plant")).toBe(true);
  });

  it("fails safely when the side effects changed: a door added to the wall being removed", async () => {
    const call = executeWrapped(tool("remove_wall"), { id: "wall_n" });
    await flush();
    dispatch({ type: "add_door", wallId: "wall_n", t: 0.15 }, human);
    actions.resolveApproval(pending()[0].id, true);
    expect((await call).ok).toBe(false);
    expect(model().walls.some((w) => w.id === "wall_n")).toBe(true);
  });

  it("fails safely when the plan changed under a pending clear_model", async () => {
    const call = executeWrapped(tool("clear_model"), {});
    await flush();
    dispatch({ type: "add_wall", ax: 10, ay: 0, bx: 12, by: 0 }, human);
    actions.resolveApproval(pending()[0].id, true);
    expect((await call).ok).toBe(false);
    expect(model().walls).toHaveLength(seedLoft().walls.length + 1);
  });

  it("two requests for the same entity: the second finds it gone and changes nothing", async () => {
    const first = executeWrapped(tool("remove_room"), { id: "room_bath" });
    const second = executeWrapped(tool("remove_room"), { id: "Bathroom" });
    await flush();
    const [a, b] = pending();
    actions.resolveApproval(a.id, true);
    expect((await first).ok).toBe(true);
    actions.resolveApproval(b.id, true);
    expect((await second).ok).toBe(false);
    expect(model().rooms).toHaveLength(seedLoft().rooms.length - 1);
  });
});
