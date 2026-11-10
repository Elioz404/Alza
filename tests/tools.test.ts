/**
 * The published tool surface. Agents address tools by name, so a rename is a breaking change
 * for every client; these tests make one visible. They also pin the descriptor shape that
 * wrapTool hands to registerTool and the text result an agent gets back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/model/store";
import { inputSchemaOf, registerAll, wrapTool, type ModelContextLike } from "../src/mcp/registry";
import { EXTEND_SELECTED_WALL, TOOLS, runToolManually } from "../src/mcp/tools";
import { resetStore } from "./support/store";

beforeEach(resetStore);

const PUBLIC_NAMES = [
  "get_model", "get_issues", "get_item_catalog", "get_editor_state", "measure", "get_underlay",
  "calibrate_underlay", "add_wall", "edit_wall", "remove_wall", "add_door", "set_door_swing",
  "add_window", "move_opening", "remove_opening", "add_room", "update_room", "remove_room",
  "place_item", "define_item_kind", "move_item", "remove_item", "set_plan_name", "clear_model",
  "build_3d", "set_camera", "set_doors", "get_supplier_catalog", "place_supplier_product",
  "leave_note", "get_notes",
];

describe("tool surface", () => {
  it("publishes the same tool names, in order", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(PUBLIC_NAMES);
    expect(EXTEND_SELECTED_WALL.name).toBe("extend_selected_wall");
  });

  it("gives every tool a title, a description and an object schema", () => {
    for (const t of [...TOOLS, EXTEND_SELECTED_WALL]) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description, t.name).toBeTruthy();
      expect(inputSchemaOf(t).type, t.name).toBe("object");
    }
  });

  it("only gives a confirm sentence to tools the gate stops", () => {
    for (const t of TOOLS) expect(!!t.confirm, t.name).toBe(!!t.annotations?.destructiveHint);
  });
});

describe("wrapTool", () => {
  it("builds a WebMCP descriptor whose execute returns the result as JSON text", async () => {
    const def = TOOLS.find((t) => t.name === "add_wall")!;
    const descriptor = wrapTool(def);
    expect(descriptor).toMatchObject({ name: "add_wall", title: def.title, inputSchema: inputSchemaOf(def) });

    const execute = descriptor.execute as (input: unknown) => Promise<string>;
    const text = await execute({ ax: 0, ay: 0, bx: 4, by: 0 });
    expect(JSON.parse(text)).toMatchObject({ ok: true });
    expect(store.getState().model.walls).toHaveLength(1);
  });
});

describe("registerAll", () => {
  it("registers every tool and hands each the session signal", () => {
    const registerTool = vi.fn();
    const mc: ModelContextLike = { registerTool };
    const signal = new AbortController().signal;
    expect(registerAll(mc, TOOLS, signal)).toBe(TOOLS.length);
    expect(registerTool).toHaveBeenCalledTimes(TOOLS.length);
    expect(registerTool.mock.calls[0][1]).toEqual({ signal });
  });

  it("counts a tool the runtime refuses as not registered", () => {
    const mc: ModelContextLike = {
      registerTool: vi.fn((t: Record<string, unknown>) => {
        if (t.name === "get_model") throw new Error("refused");
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(registerAll(mc, TOOLS)).toBe(TOOLS.length - 1);
    warn.mockRestore();
  });
});

describe("runToolManually", () => {
  it("runs a tool by name through the same wrapper", async () => {
    const r = await runToolManually("set_plan_name", { name: "Manual" });
    expect(r.ok).toBe(true);
    expect(store.getState().model.name).toBe("Manual");
  });

  it("reports an unknown tool", async () => {
    expect((await runToolManually("nope", {})).ok).toBe(false);
  });
});
