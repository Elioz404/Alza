/**
 * The catalogue as state. Built-in kinds are a frozen constant; everything added at runtime —
 * agent-defined pieces with their 3D parts, adopted supplier products — lives in the plan
 * (model.kinds). These pin what that buys: undo reverts a definition, a plan carries its kinds
 * with it, and no definition is ever edited in place.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { BUILT_IN_KINDS, catalogFor, catalogOf, freezeKind, supplierKind } from "../src/model/catalog";
import { seedLoft } from "../src/model/seed";
import type { KindDef, PlanModel } from "../src/model/types";
import { buildFurniture, FURNITURE_BUILDERS } from "../src/three/furniture";
import { kindOf, resetStore } from "./support/store";

beforeEach(resetStore);

const model = () => store.getState().model;
const human = { actor: "human" } as const;

const PIANO = {
  kind: "grand_piano",
  label: "Grand piano",
  w: 1.5,
  d: 1.9,
  h: 1,
  color: "#1d1b1a",
  parts: [
    { shape: "box" as const, w: 1.5, h: 0.2, d: 1.9, y: 0.7 },
    { shape: "cylinder" as const, w: 0.1, h: 0.7, z: 0.8 },
    { shape: "cylinder" as const, w: 0.1, h: 0.7, z: -0.8 },
  ],
};

describe("the built-in catalogue", () => {
  it("is frozen, entries included, so nothing can add to it or edit a row in place", () => {
    expect(Object.isFrozen(BUILT_IN_KINDS)).toBe(true);
    for (const def of BUILT_IN_KINDS) expect(Object.isFrozen(def), def.kind).toBe(true);
    expect(() => (BUILT_IN_KINDS as KindDef[]).push({ ...BUILT_IN_KINDS[0], kind: "intruder" })).toThrow(TypeError);
    expect(() => {
      (BUILT_IN_KINDS[0] as { w: number }).w = 99;
    }).toThrow(TypeError);
  });

  it("says which kinds are built in as data, and every one of them has a hand-modelled builder", () => {
    expect(BUILT_IN_KINDS.every((k) => k.source === "builtin")).toBe(true);
    expect(Object.keys(FURNITURE_BUILDERS).sort()).toEqual(BUILT_IN_KINDS.map((k) => k.kind).sort());
  });

  it("is what an empty plan sees", () => {
    expect(catalogOf(model()).entries).toEqual(BUILT_IN_KINDS);
    expect(model().kinds).toEqual([]);
  });
});

describe("the plan's own kinds", () => {
  it("define_item_kind adds the definition, 3D parts included, to the plan as plain data", () => {
    expect(dispatch({ type: "define_item_kind", spec: PIANO }, human).ok).toBe(true);
    expect(model().kinds).toHaveLength(1);
    expect(model().kinds[0]).toMatchObject({ kind: "grand_piano", source: "custom", w: 1.5 });
    expect(model().kinds[0].parts).toHaveLength(3);
    expect(kindOf("grand_piano")?.parts?.[0]).toMatchObject({ shape: "box", w: 1.5 });
  });

  it("undo reverts a definition like any other edit", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    expect(kindOf("grand_piano")).toBeDefined();
    dispatch({ type: "undo" }, human);
    expect(kindOf("grand_piano")).toBeUndefined();
    expect(model().kinds).toEqual([]);
  });

  it("undo of a redefinition brings back the previous definition, parts and all", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    dispatch({ type: "define_item_kind", spec: { ...PIANO, w: 2, parts: undefined } }, human);
    expect(kindOf("grand_piano")).toMatchObject({ w: 2 });
    dispatch({ type: "undo" }, human);
    expect(kindOf("grand_piano")).toMatchObject({ w: 1.5 });
    expect(kindOf("grand_piano")?.parts).toHaveLength(3);
  });

  it("a redefinition replaces the whole definition: parts that are not given again are gone", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    dispatch({ type: "define_item_kind", spec: { ...PIANO, parts: undefined } }, human);
    // a separate parts registry used to keep the old parts and build them for the new footprint
    expect(kindOf("grand_piano")?.parts).toBeUndefined();
  });

  it("never edits a definition in place: the plan before a redefinition still holds the old one", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    const before = model();
    const old = before.kinds[0];
    dispatch({ type: "define_item_kind", spec: { ...PIANO, label: "Baby grand", w: 1.4 } }, human);
    expect(old).toMatchObject({ label: "Grand piano", w: 1.5 });
    expect(before.kinds[0]).toBe(old);
    expect(model().kinds[0]).not.toBe(old);
  });

  it("definitions are frozen all the way down", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    const def = model().kinds[0];
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.parts)).toBe(true);
    expect(() => {
      (def.parts![0] as { w?: number }).w = 9;
    }).toThrow(TypeError);
  });

  it("stay frozen, and the same objects, after an unrelated change is undone", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    const def = model().kinds[0];
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "undo" }, human);
    expect(model().kinds[0]).toBe(def);
    expect(Object.isFrozen(model().kinds[0])).toBe(true);
    expect(Object.isFrozen(model().kinds[0].parts)).toBe(true);
  });

  it("a plan loaded from data has its kinds frozen on the way in", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    const saved = JSON.parse(JSON.stringify(model())) as PlanModel;
    dispatch({ type: "load_model", model: saved }, human);
    expect(Object.isFrozen(model().kinds[0])).toBe(true);
    expect(Object.isFrozen(model().kinds[0].parts![0])).toBe(true);
  });

  it("a plan is self-contained: serialised and loaded elsewhere, its pieces still resolve", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    dispatch({ type: "place_item", kind: "grand_piano", x: 2, y: 2 }, human);
    const saved = JSON.stringify(model());
    resetStore();
    expect(kindOf("grand_piano")).toBeUndefined();
    dispatch({ type: "load_model", model: JSON.parse(saved) as PlanModel }, human);
    expect(kindOf("grand_piano")?.parts).toHaveLength(3);
    expect(model().items[0].kind).toBe("grand_piano");
  });

  it("does not leak between plans: loading another plan drops kinds it does not carry", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    dispatch({ type: "load_model", model: seedLoft() }, human);
    expect(kindOf("grand_piano")).toBeUndefined();
  });

  it("clear_model drops the plan's kinds, and undo brings them back", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    dispatch({ type: "clear_model" }, human);
    expect(model().kinds).toEqual([]);
    dispatch({ type: "undo" }, human);
    expect(kindOf("grand_piano")).toBeDefined();
  });

  it("a supplier product is adopted into the plan, not into a global list", () => {
    const product = { sku: "NK-TST-01", name: "Test sofa", category: "living", w: 2, d: 0.9, h: 0.8, color: "#8d8577" };
    expect(dispatch({ type: "import_supplier_product", product }, human).ok).toBe(true);
    expect(kindOf(supplierKind("NK-TST-01"))).toMatchObject({ source: "supplier", w: 2 });
    resetStore();
    expect(kindOf(supplierKind("NK-TST-01"))).toBeUndefined();
  });
});

describe("catalogue lookup", () => {
  it("is indexed once per kinds list, so the same plan answers from the same index", () => {
    const m = model();
    expect(catalogOf(m)).toBe(catalogOf({ kinds: m.kinds }));
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    expect(catalogOf(model())).not.toBe(catalogOf(m));
  });

  it("puts the plan's kinds after the built-ins, and never lets one replace a built-in", () => {
    const fake = freezeKind({ ...BUILT_IN_KINDS[0], w: 9, source: "custom" });
    const extra = freezeKind({ ...BUILT_IN_KINDS[0], kind: "extra", source: "custom" });
    const catalog = catalogFor([fake, extra]);
    expect(catalog.get(fake.kind)).toBe(BUILT_IN_KINDS[0]);
    expect(catalog.entries.at(-1)).toBe(extra);
    expect(catalog.entries).toHaveLength(BUILT_IN_KINDS.length + 1);
  });
});

describe("3D pieces come from the definition", () => {
  it("an agent-defined kind is built from the parts it carries", () => {
    dispatch({ type: "define_item_kind", spec: PIANO }, human);
    expect(buildFurniture(kindOf("grand_piano")!).children).toHaveLength(3);
    dispatch({ type: "define_item_kind", spec: { ...PIANO, parts: PIANO.parts.slice(0, 1) } }, human);
    expect(buildFurniture(kindOf("grand_piano")!).children).toHaveLength(1);
  });

  it("a kind with neither builder nor parts is blocked out from its footprint", () => {
    actions.defineItemKind({ kind: "crate", label: "Crate", w: 1, d: 1, h: 1 });
    expect(buildFurniture(kindOf("crate")!).children.length).toBeGreaterThan(0);
  });
});
