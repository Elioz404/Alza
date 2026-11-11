/**
 * The checker's cost. Its result is derived once per plan object and shared by everyone who
 * reads it — the sidebar badge on every render, the Check tab, get_issues — and the pairwise
 * rules skip, by bounding box, the pairs that cannot possibly touch.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { checkModel, issuesOf } from "../src/model/issues";
import { boxOf, boxesApart, rectCorners, satRectRect, type ORect } from "../src/model/geometry";
import { seedLoft } from "../src/model/seed";
import { emptyModel, type PlanModel } from "../src/model/types";
import { runTool } from "../src/mcp/tools";
import { resetStore } from "./support/store";

beforeEach(resetStore);

describe("issuesOf", () => {
  it("is computed once per plan object and shared", () => {
    const m = seedLoft();
    const first = issuesOf(m);
    expect(issuesOf(m)).toBe(first);
    expect(first).toEqual(checkModel(m));
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("is a new list exactly when the plan is a new object", () => {
    dispatch({ type: "load_model", model: seedLoft() }, { actor: "human" });
    const before = issuesOf(store.getState().model);
    store.setState({ editor: { ...store.getState().editor, drawMode: "wall" } }); // not a plan change
    expect(issuesOf(store.getState().model)).toBe(before);
    dispatch({ type: "add_wall", ax: 20, ay: 20, bx: 24, by: 20 }, { actor: "human" });
    const after = issuesOf(store.getState().model);
    expect(after).not.toBe(before);
    expect(after.map((i) => i.code)).toContain("wall_loose_end");
  });

  it("is what get_issues answers", async () => {
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, { actor: "human" });
    const r = await runTool("get_issues", {}, "agent");
    expect(r.issues).toBe(issuesOf(store.getState().model));
  });

  it("cannot be changed by one reader under another", () => {
    const list = issuesOf({ ...emptyModel(), walls: [{ id: "w", levelId: "level_ground", ax: 0, ay: 0, bx: 0.1, by: 0, thickness: 0.15, height: 2.7 }] });
    expect(() => (list as unknown[]).push({})).toThrow();
    expect(() => {
      (list[0] as { message: string }).message = "changed";
    }).toThrow();
  });
});

describe("the bounding-box first test", () => {
  /** A small deterministic generator, so a failure can be replayed. */
  function random(seed: number) {
    let s = seed;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  }

  it("never skips a pair the exact test would find touching", () => {
    const rnd = random(42);
    const rect = (): ORect => ({ cx: rnd() * 6, cy: rnd() * 6, hw: 0.05 + rnd(), hd: 0.05 + rnd(), rot: rnd() * Math.PI * 2 });
    let apart = 0;
    for (let i = 0; i < 5000; i++) {
      const a = rect();
      const b = rect();
      if (!boxesApart(boxOf(rectCorners(a)), boxOf(rectCorners(b)))) continue;
      apart++;
      expect(satRectRect(a, b)).toBe(false);
    }
    expect(apart).toBeGreaterThan(500); // the property was exercised, not vacuously true
  });

  it("leaves every rule's findings as they were on a crowded plan", () => {
    // furniture packed along and across a wall run, so pairs near and far are both tested
    const m: PlanModel = {
      ...emptyModel(),
      walls: [
        { id: "w1", levelId: "level_ground", ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 },
        { id: "w2", levelId: "level_ground", ax: 8, ay: 0, bx: 8, by: 6, thickness: 0.15, height: 2.7 },
        { id: "w3", levelId: "level_ground", ax: 4, ay: -1, bx: 4, by: 3, thickness: 0.1, height: 2.7 },
      ],
      openings: [
        { id: "d1", kind: "door", wallId: "w1", t: 0.3, width: 0.9, sill: 0, height: 2.1 },
        { id: "win1", kind: "window", wallId: "w2", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
      ],
      items: Array.from({ length: 24 }, (_, i) => ({ id: `it${String(i).padStart(2, "0")}`, levelId: "level_ground", kind: i % 3 ? "plant" : "sofa", x: (i % 8) * 1.05, y: Math.floor(i / 8) * 0.9 + 0.2, rotation: (i * 37) % 360 })),
    };
    const codes = checkModel(m).map((i) => `${i.code}:${i.refs.join(",")}`);
    expect(codes.filter((c) => c.startsWith("items_overlap")).length).toBeGreaterThan(0);
    expect(codes.filter((c) => c.startsWith("item_through_wall")).length).toBeGreaterThan(0);
    expect(codes.some((c) => c.startsWith("item_blocks_door"))).toBe(true);
    expect(codes.some((c) => c.startsWith("walls_cross"))).toBe(true);
    // the same plan, with every pair re-tested exactly and nothing skipped
    const exact = m.items.flatMap((a, i) =>
      m.items.slice(i + 1).flatMap((b) => {
        const r = (it: typeof a): ORect => {
          const def = it.kind === "sofa" ? { w: 2.1, d: 0.9 } : { w: 0.4, d: 0.4 };
          return { cx: it.x, cy: it.y, hw: def.w / 2, hd: def.d / 2, rot: (-it.rotation * Math.PI) / 180 };
        };
        return satRectRect(r(a), r(b), 0.01) ? [`items_overlap:${[a.id, b.id].sort().join(",")}`] : [];
      }),
    );
    expect(codes.filter((c) => c.startsWith("items_overlap")).sort()).toEqual(exact.sort());
  });
});
