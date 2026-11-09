/**
 * The human approval gate in executeWrapped — the one place destructive agent calls are
 * stopped. These pin its current contract: what parks, what runs straight through, and what
 * each way out of a parked call does to the model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, store, type ActionResult } from "../src/model/store";
import { executeWrapped, type ToolDef } from "../src/mcp/registry";
import { TOOLS } from "../src/mcp/tools";
import { flush, resetStore } from "./support/store";

const tool = (name: string): ToolDef => {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def;
};

/** A destructive tool whose execute we can watch, independent of any real action. */
const spyTool = (): ToolDef & { execute: ReturnType<typeof vi.fn> } => ({
  name: "spy_destroy",
  description: "test double",
  inputSchema: { type: "object", properties: {} },
  annotations: { destructiveHint: true },
  confirm: () => "destroy the thing",
  execute: vi.fn((): ActionResult => ({ ok: true, summary: "destroyed" })),
});

const input = (o: Record<string, unknown>) => o as Record<string, never>;
const pending = () => store.getState().approvals;

function seedWall(): string {
  const r = actions.addWall(0, 0, 4, 0);
  expect(r.ok).toBe(true);
  return r.id as string;
}

beforeEach(resetStore);

describe("approval gate", () => {
  it("is on by default", () => {
    expect(store.getState().requireApproval).toBe(true);
  });

  it("parks a destructive call until the human decides", async () => {
    const def = spyTool();
    const call = executeWrapped(def, input({}));

    await flush();
    expect(def.execute).not.toHaveBeenCalled();
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({ tool: "spy_destroy", request: "destroy the thing" });

    expect(actions.resolveApproval(pending()[0].id, true).ok).toBe(true);
    const result = await call;

    expect(def.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, summary: "destroyed" });
    expect(pending()).toHaveLength(0);
  });

  it("an approved remove_wall removes the wall", async () => {
    const id = seedWall();
    const call = executeWrapped(tool("remove_wall"), input({ id }));
    await flush();
    expect(store.getState().model.walls).toHaveLength(1);

    actions.resolveApproval(pending()[0].id, true);
    const result = await call;

    expect(result.ok).toBe(true);
    expect(store.getState().model.walls).toHaveLength(0);
  });

  it("a rejection returns ok:false and leaves the model untouched", async () => {
    const id = seedWall();
    const before = store.getState().model;
    const call = executeWrapped(tool("remove_wall"), input({ id }));
    await flush();

    actions.resolveApproval(pending()[0].id, false);
    const result = await call;

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/^Blocked: the human declined/);
    expect(store.getState().model).toBe(before);
    expect(pending()).toHaveLength(0);
  });

  it("a rejected call never reaches execute", async () => {
    const def = spyTool();
    const call = executeWrapped(def, input({}));
    await flush();
    actions.resolveApproval(pending()[0].id, false);
    await call;
    expect(def.execute).not.toHaveBeenCalled();
  });

  it("an aborted signal settles the request as declined and withdraws it", async () => {
    const id = seedWall();
    const before = store.getState().model;
    const ac = new AbortController();
    const call = executeWrapped(tool("remove_wall"), input({ id }), { signal: ac.signal });
    await flush();
    expect(pending()).toHaveLength(1);

    ac.abort();
    const result = await call;

    expect(result.ok).toBe(false);
    expect(store.getState().model).toBe(before);
    expect(pending()).toHaveLength(0);
  });

  it("a request that is no longer pending cannot be resolved", async () => {
    const ac = new AbortController();
    const call = executeWrapped(spyTool(), input({}), { signal: ac.signal });
    await flush();
    const { id } = pending()[0];
    ac.abort();
    await call;
    expect(actions.resolveApproval(id, true).ok).toBe(false);
  });

  it("non-destructive tools run immediately", async () => {
    const result = await executeWrapped(tool("add_wall"), input({ ax: 0, ay: 0, bx: 3, by: 0 }));
    expect(result.ok).toBe(true);
    expect(pending()).toHaveLength(0);
    expect(store.getState().model.walls).toHaveLength(1);
  });

  it("with requireApproval off, destructive tools run without parking", async () => {
    const id = seedWall();
    actions.setRequireApproval(false);
    const result = await executeWrapped(tool("remove_wall"), input({ id }));
    expect(result.ok).toBe(true);
    expect(pending()).toHaveLength(0);
    expect(store.getState().model.walls).toHaveLength(0);
  });

  it("logs the outcome of every call to the activity feed", async () => {
    const def = spyTool();
    const call = executeWrapped(def, input({}));
    await flush();
    actions.resolveApproval(pending()[0].id, false);
    await call;
    const last = store.getState().activity.at(-1);
    expect(last).toMatchObject({ tool: "spy_destroy", ok: false });
  });

  it("a throwing execute becomes an ok:false result instead of a rejection", async () => {
    const def: ToolDef = {
      name: "explodes",
      description: "test double",
      inputSchema: { type: "object", properties: {} },
      execute: () => {
        throw new Error("boom");
      },
    };
    await expect(executeWrapped(def, input({}))).resolves.toEqual({ ok: false, summary: "Error: boom" });
  });
});

describe("every destructive tool is gated", () => {
  // The gate keys off the annotation, so a destructive tool without one would run unasked.
  const destructive = TOOLS.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);

  it("covers the tools that delete things", () => {
    expect(destructive.sort()).toEqual(["clear_model", "remove_item", "remove_opening", "remove_room", "remove_wall"]);
  });

  it.each(destructive)("%s parks instead of running", async (name) => {
    const call = executeWrapped(tool(name), input({ id: "anything" }));
    await flush();
    expect(pending()).toHaveLength(1);
    actions.resolveApproval(pending()[0].id, false);
    expect((await call).ok).toBe(false);
  });
});
