/**
 * The input boundary. Every tool's arguments are a zod schema; the published JSON Schema is
 * derived from it and every call is checked against it before the approval gate and before
 * execute. These pin both halves: the published contract stayed what agents already rely on,
 * and malformed input — wrong types, NaN, Infinity, out-of-range or unknown keys — is refused
 * with readable issues and leaves everything untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { executeWrapped, inputSchemaOf, type ToolDef } from "../src/mcp/registry";
import { EXTEND_SELECTED_WALL, TOOLS } from "../src/mcp/tools";
import { FLOOR_FINISHES, HEX_COLOR, MAX_PARTS, TEXT, VALIDATION_REPORT, WALL_HEIGHT, WALL_THICKNESS } from "../src/model/limits";
import type { Wall } from "../src/model/types";
import { flush, resetStore } from "./support/store";

beforeEach(resetStore);

const ALL = [...TOOLS, EXTEND_SELECTED_WALL];
const tool = (name: string): ToolDef => {
  const def = ALL.find((t) => t.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def;
};

type Props = Record<string, { type?: string; enum?: string[]; maxItems?: number; pattern?: string; maxLength?: number }>;
const schema = (name: string) => inputSchemaOf(tool(name)) as { properties: Props; required: string[]; additionalProperties: boolean };

/**
 * The published argument lists as they were written by hand before the schemas became zod:
 * property names with their JSON types, and the required list. Agents depend on exactly these.
 */
const N = "number", S = "string", B = "boolean";
const CONTRACT: Record<string, [Record<string, string>, string[]]> = {
  get_model: [{}, []],
  get_issues: [{}, []],
  get_item_catalog: [{}, []],
  get_editor_state: [{}, []],
  measure: [{ x1: N, y1: N, x2: N, y2: N, wallId: S }, []],
  get_underlay: [{}, []],
  calibrate_underlay: [{ u1: N, v1: N, u2: N, v2: N, meters: N, opacity: N }, ["u1", "v1", "u2", "v2", "meters"]],
  add_wall: [{ ax: N, ay: N, bx: N, by: N, thickness: N, height: N }, ["ax", "ay", "bx", "by"]],
  edit_wall: [{ id: S, ax: N, ay: N, bx: N, by: N, thickness: N, height: N }, ["id"]],
  remove_wall: [{ id: S }, ["id"]],
  add_door: [{ wallId: S, t: N, width: N, height: N, hinge: S, side: S }, ["wallId", "t"]],
  set_door_swing: [{ id: S, hinge: S, side: S }, ["id"]],
  add_window: [{ wallId: S, t: N, width: N, sill: N, height: N }, ["wallId", "t"]],
  move_opening: [{ id: S, t: N }, ["id", "t"]],
  remove_opening: [{ id: S }, ["id"]],
  add_room: [{ x: N, y: N, w: N, h: N, label: S, floor: S }, ["x", "y", "w", "h", "label"]],
  update_room: [{ id: S, x: N, y: N, w: N, h: N, label: S, floor: S }, ["id"]],
  remove_room: [{ id: S }, ["id"]],
  place_item: [{ kind: S, x: N, y: N, rotation: N }, ["kind", "x", "y"]],
  define_item_kind: [{ kind: S, label: S, w: N, d: N, h: N, color: S, category: S, parts: "array" }, ["kind", "label", "w", "d", "h"]],
  move_item: [{ id: S, x: N, y: N, rotation: N }, ["id"]],
  remove_item: [{ id: S }, ["id"]],
  set_plan_name: [{ name: S }, ["name"]],
  clear_model: [{}, []],
  build_3d: [{}, []],
  set_camera: [{ mode: S }, ["mode"]],
  set_3d_style: [{ edges: B, cutaway: B, cutHeight: N }, []],
  set_doors: [{ state: S, id: S }, ["state"]],
  get_supplier_catalog: [{ category: S, maxPrice: N, maxWidth: N, inStock: B }, []],
  place_supplier_product: [{ sku: S, x: N, y: N, rotation: N }, ["sku", "x", "y"]],
  leave_note: [{ text: S }, ["text"]],
  get_notes: [{}, []],
  extend_selected_wall: [{ meters: N, end: S }, ["meters", "end"]],
};

describe("published input schemas", () => {
  it("cover every tool", () => {
    expect(Object.keys(CONTRACT).sort()).toEqual(ALL.map((t) => t.name).sort());
  });

  it.each(Object.entries(CONTRACT))("%s keeps its property names, types and required list", (name, [props, required]) => {
    const s = schema(name);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(required);
    expect(Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, v.type]))).toEqual(props);
    expect(s).not.toHaveProperty("$schema");
  });

  it("keeps the enums agents choose from", () => {
    expect(schema("add_door").properties.hinge.enum).toEqual(["a", "b"]);
    expect(schema("add_door").properties.side.enum).toEqual(["left", "right"]);
    expect(schema("set_camera").properties.mode.enum).toEqual(["orbit", "top", "walk"]);
    expect(schema("set_doors").properties.state.enum).toEqual(["open", "closed", "toggle"]);
    expect(schema("extend_selected_wall").properties.end.enum).toEqual(["a", "b"]);
    expect(schema("add_room").properties.floor.enum).toEqual([...FLOOR_FINISHES]);
    expect(schema("update_room").properties.floor.enum).toEqual([...FLOOR_FINISHES]);
    expect(schema("define_item_kind").properties.category.enum).toEqual(["living", "bedroom", "kitchen", "bath", "office", "decor"]);
  });

  it("publishes the domain ranges and resource limits", () => {
    const wall = schema("add_wall").properties as Record<string, { minimum?: number; maximum?: number }>;
    expect(wall.thickness).toMatchObject({ minimum: WALL_THICKNESS.min, maximum: WALL_THICKNESS.max });
    expect(wall.height).toMatchObject({ minimum: WALL_HEIGHT.min, maximum: WALL_HEIGHT.max });
    const kind = schema("define_item_kind").properties;
    expect(kind.parts.maxItems).toBe(MAX_PARTS);
    expect(kind.color.pattern).toBe(HEX_COLOR.source);
    expect(kind.label.maxLength).toBe(TEXT.label);
    expect(schema("leave_note").properties.text.maxLength).toBe(TEXT.note);
    expect(schema("set_plan_name").properties.name.maxLength).toBe(TEXT.planName);
  });

  it("keeps a closed part schema with an empty required list", () => {
    const parts = schema("define_item_kind").properties.parts as unknown as { items: Record<string, unknown> };
    expect(parts.items).toMatchObject({ type: "object", required: [], additionalProperties: false });
  });
});

describe("executeWrapped validation", () => {
  const snapshot = () => {
    const s = store.getState();
    return { model: s.model, undo: s.undoStack.length, notes: s.notes, approvals: s.approvals.length };
  };

  it.each([
    ["strings for numbers, a negative thickness and a huge height", { ax: "0", ay: 0, bx: "4", by: 0, thickness: -5, height: 1e9 }],
    ["null for a coordinate", { ax: null, ay: 0, bx: 4, by: 0 }],
    ["NaN", { ax: NaN, ay: 0, bx: 4, by: 0 }],
    ["Infinity", { ax: 0, ay: 0, bx: Infinity, by: 0 }],
    ["an unknown key", { ax: 0, ay: 0, bx: 4, by: 0, colour: "red" }],
    ["a missing required key", { ax: 0, ay: 0, bx: 4 }],
  ])("add_wall rejects %s without touching the model", async (_, input) => {
    const before = snapshot();
    const r = await executeWrapped(tool("add_wall"), input);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/^Invalid input for add_wall: /);
    expect(Array.isArray(r.issues) && (r.issues as string[]).length).toBeGreaterThan(0);
    expect(snapshot()).toEqual(before);
  });

  it("names every offending argument", async () => {
    const r = await executeWrapped(tool("add_wall"), { ax: "0", ay: 0, bx: 4, by: 0, thickness: -5, height: 1e9 });
    const issues = r.issues as string[];
    expect(issues.some((i) => i.startsWith("ax:"))).toBe(true);
    expect(issues.some((i) => i.startsWith("thickness:"))).toBe(true);
    expect(issues.some((i) => i.startsWith("height:"))).toBe(true);
  });

  it.each([null, "a string", 5, []])("rejects a non-object input (%s)", async (input) => {
    const r = await executeWrapped(tool("add_wall"), input);
    expect(r.ok).toBe(false);
    expect(store.getState().model.walls).toHaveLength(0);
  });

  it("validates before the approval gate: an invalid destructive call never prompts the human", async () => {
    actions.addWall(0, 0, 4, 0);
    const before = snapshot();
    const r = await executeWrapped(tool("remove_wall"), { id: 42 });
    await flush();
    expect(r.ok).toBe(false);
    expect(store.getState().approvals).toHaveLength(0);
    expect(snapshot()).toEqual(before);
  });

  it("clear_model takes no arguments", async () => {
    actions.addWall(0, 0, 4, 0);
    const r = await executeWrapped(tool("clear_model"), { everything: true });
    expect(r.ok).toBe(false);
    expect(store.getState().approvals).toHaveLength(0);
    expect(store.getState().model.walls).toHaveLength(1);
  });

  it("hands execute the parsed input, so a valid call still works end to end", async () => {
    const r = await executeWrapped(tool("add_wall"), { ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.1, height: 3 });
    expect(r.ok).toBe(true);
    expect(store.getState().model.walls[0]).toMatchObject({ thickness: 0.1, height: 3 });
  });

  it("measure needs a wall id or all four points", async () => {
    expect((await executeWrapped(tool("measure"), { x1: 0, y1: 0, x2: 3 })).ok).toBe(false);
    const r = await executeWrapped(tool("measure"), { x1: 0, y1: 0, x2: 3, y2: 4 });
    expect(r).toMatchObject({ ok: true, meters: 5 });
  });

  it("refuses over-long text", async () => {
    expect((await executeWrapped(tool("leave_note"), { text: "x".repeat(TEXT.note + 1) })).ok).toBe(false);
    expect((await executeWrapped(tool("set_plan_name"), { name: "x".repeat(TEXT.planName + 1) })).ok).toBe(false);
    expect((await executeWrapped(tool("add_room"), { x: 0, y: 0, w: 3, h: 3, label: "x".repeat(TEXT.label + 1) })).ok).toBe(false);
    expect(store.getState().notes).toHaveLength(0);
    expect(store.getState().model.rooms).toHaveLength(0);
  });

  it("refuses a custom kind with too many parts or a non-hex colour", async () => {
    const base = { kind: "piano", label: "Piano", w: 1.5, d: 0.6, h: 1 };
    const parts = Array.from({ length: MAX_PARTS + 1 }, () => ({ shape: "box" }));
    expect((await executeWrapped(tool("define_item_kind"), { ...base, parts })).ok).toBe(false);
    expect((await executeWrapped(tool("define_item_kind"), { ...base, color: "red" })).ok).toBe(false);
    expect((await executeWrapped(tool("define_item_kind"), { ...base, parts: [{ shape: "box", w: Infinity }] })).ok).toBe(false);
    expect((await executeWrapped(tool("define_item_kind"), { ...base, parts: [{ shape: "box", extra: 1 }] })).ok).toBe(false);
  });
});

describe("validation reports stay small whatever was sent", () => {
  const { maxIssues, maxLineChars } = VALIDATION_REPORT;
  /** every issue line, the "…and n more" line, and the fixed wording around them */
  const bound = (maxIssues + 1) * (maxLineChars + 2) + 200;

  it("many long unknown keys yield a short, counted report", async () => {
    const junk = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${"k".repeat(100)}${i}`, 1]));
    const r = await executeWrapped(tool("add_wall"), { ax: 0, ay: 0, bx: 4, by: 0, ...junk });
    expect(r.ok).toBe(false);
    expect(r.summary.length).toBeLessThan(bound);
    expect(r.summary).toMatch(/1000 unknown key\(s\)/);
    for (const line of r.issues as string[]) expect(line.length).toBeLessThanOrEqual(maxLineChars);
    const logged = store.getState().activity.at(-1)!;
    expect(logged.summary.length).toBeLessThan(bound);
  });

  it("one enormous key is cut, not echoed", async () => {
    const r = await executeWrapped(tool("add_wall"), { ax: 0, ay: 0, bx: 4, by: 0, ["x".repeat(10_000_000)]: 1 });
    expect(r.ok).toBe(false);
    expect(r.summary.length).toBeLessThan(bound);
  });

  it("many bad fields are listed up to the cap and counted past it", async () => {
    const input = Object.fromEntries(["ax", "ay", "bx", "by", "thickness", "height"].map((k) => [k, "x".repeat(5000)]));
    const r = await executeWrapped(tool("add_wall"), input);
    expect((r.issues as string[]).length).toBeLessThanOrEqual(maxIssues + 1);
    expect(r.summary.length).toBeLessThan(bound);
  });
});

describe("measure", () => {
  it("resolves a wall id the way every other wall tool does: an exact id wins over a fragment", async () => {
    const wall = (id: string, bx: number): Wall => ({ id, ax: 0, ay: 0, bx, by: 0, thickness: 0.1, height: 2.5 });
    store.setState((s) => ({ model: { ...s.model, walls: [wall("w10", 10), wall("w1", 3)] } }));
    expect(await executeWrapped(tool("measure"), { wallId: "w1" })).toMatchObject({ ok: true, meters: 3 });
    expect(await executeWrapped(tool("measure"), { wallId: "w9" })).toMatchObject({ ok: false });
  });
});
