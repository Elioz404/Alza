/**
 * The checker as composable rules over one shared context. The issue codes and messages are
 * pinned by issues.test.ts; these pin the structure: each rule runs on its own, the whole check
 * is exactly the rules in order, and the context is computed once with the plan's catalogue.
 */
import { describe, expect, it } from "vitest";
import {
  RULES,
  checkContext,
  checkModel,
  itemThroughWall,
  itemsOverlap,
  openingOrphan,
  roomTooSmall,
  wallTooShort,
  type Rule,
} from "../src/model/issues";
import { seedLoft } from "../src/model/seed";
import { freezeKind } from "../src/model/catalog";
import { emptyModel, type PlanModel } from "../src/model/types";

/** A plan with one problem of each kind the rules below look for. */
const broken = (): PlanModel => ({
  ...emptyModel(),
  walls: [
    { id: "w1", levelId: "level_ground", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
    { id: "stub", levelId: "level_ground", ax: 6, ay: 6, bx: 6.1, by: 6, thickness: 0.15, height: 2.7 },
  ],
  openings: [{ id: "ghost_door", kind: "door", wallId: "missing", t: 0.5, width: 0.9, sill: 0, height: 2.1 }],
  rooms: [{ id: "closet", levelId: "level_ground", x: 0, y: 1, w: 0.3, h: 2, label: "Closet", floor: "oak" }],
  items: [
    { id: "a", levelId: "level_ground", kind: "sofa", x: 2, y: 0, rotation: 0 },
    { id: "b", levelId: "level_ground", kind: "sofa", x: 2.2, y: 0.1, rotation: 0 },
    { id: "c", levelId: "level_ground", kind: "no_such_kind", x: 9, y: 9, rotation: 0 },
  ],
});

const codes = (rule: Rule, m: PlanModel) => rule(checkContext(m)).map((i) => i.code);

describe("rules", () => {
  it("each rule runs on its own and reports only its own codes", () => {
    const m = broken();
    expect(codes(wallTooShort, m)).toEqual(["wall_too_short"]);
    expect(codes(openingOrphan, m)).toEqual(["opening_orphan"]);
    expect(codes(roomTooSmall, m)).toEqual(["room_too_small"]);
    expect(codes(itemThroughWall, m)).toEqual(["item_through_wall", "item_through_wall"]);
    expect(codes(itemsOverlap, m)).toEqual(["items_overlap"]);
  });

  it("checkModel is every rule, in order, over one context", () => {
    for (const m of [broken(), seedLoft()]) {
      const ctx = checkContext(m);
      expect(checkModel(m)).toEqual(RULES.flatMap((rule) => rule(ctx)));
    }
  });

  it("a chosen subset of rules can be run", () => {
    expect(checkModel(broken(), [roomTooSmall, wallTooShort]).map((i) => i.code)).toEqual(["room_too_small", "wall_too_short"]);
    expect(checkModel(broken(), [])).toEqual([]);
  });

  it("the shared context indexes walls, hosts openings and places only known kinds", () => {
    const ctx = checkContext(broken());
    expect(ctx.wallById.get("w1")?.id).toBe("w1");
    expect(ctx.hosted).toEqual([]); // the only opening has no wall
    expect(ctx.placed.map((p) => p.item.id)).toEqual(["a", "b"]);
    expect(ctx.placed[0].rect).toMatchObject({ cx: 2, cy: 0, hw: 1.05, hd: 0.45 });
  });

  it("reads footprints from the plan's own catalogue", () => {
    const m: PlanModel = {
      ...emptyModel(),
      kinds: [freezeKind({ kind: "island", label: "Island", w: 3, d: 1, h: 0.9, color: "#999999", category: "kitchen", source: "custom" })],
      items: [
        { id: "i1", levelId: "level_ground", kind: "island", x: 0, y: 0, rotation: 0 },
        { id: "i2", levelId: "level_ground", kind: "plant", x: 1.3, y: 0, rotation: 0 },
      ],
    };
    // 1.3 m from the island's centre is inside its 3 m width: only its own definition says so
    expect(checkModel(m).map((i) => i.code)).toEqual(["items_overlap"]);
    expect(checkModel({ ...m, kinds: [] }).map((i) => i.code)).toEqual(["item_unknown"]);
  });

  it("the demo loft is still clean", () => {
    expect(checkModel(seedLoft())).toEqual([]);
  });
});
