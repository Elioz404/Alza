/**
 * The whole structure feature through the agent's tools alone, as an agent co-editing the plan
 * would use them: from a cleared plan, a workshop on the ground with a storey over it that
 * reaches out over an open carport, carried there by a grid of columns, a sectional garage door
 * from the workshop out onto the carport, and a car parked under the storey, driven in from the
 * carport's open side — checked to no issues. Then a column taken away (through
 * the approval it waits for) leaves the storey's floor unsupported where it stood, and a plan
 * saved before columns existed still loads.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { runTool } from "../src/mcp/tools";
import { dispatch } from "../src/model/commands";
import { checkModel } from "../src/model/issues";
import { migratePlan } from "../src/model/planFormat";
import { PLAN_FORMAT_VERSION, SUPPORT } from "../src/model/limits";
import { unsupportedZones } from "../src/model/supports";
import { columnHeight } from "../src/model/columns";
import { seedCrescent } from "../src/model/demoCrescent";
import { resetStore, flush } from "./support/store";

beforeEach(resetStore);

const model = () => store.getState().model;
type Answer = Awaited<ReturnType<typeof runTool>>;
async function tool(name: string, args: Record<string, unknown>): Promise<Answer> {
  const r = await runTool(name, args, "agent");
  expect(r.ok, `${name}: ${r.summary}`).toBe(true);
  return r;
}

/** Workshop 6 × 6.5 m at the origin; the carport 5 m east of it, open on three sides; the storey over both. */
async function buildByTools(): Promise<{ first: string; columns: string[] }> {
  // clearing the plan is destructive: it waits for the person, who agrees
  const clearing = runTool("clear_model", {}, "agent");
  await flush();
  for (const ask of store.getState().approvals) actions.resolveApproval(ask.id, true);
  expect((await clearing).ok).toBe(true);
  await tool("set_plan_name", { name: "Carport by tools" });
  const first = String((await tool("add_level", {})).id);
  // the ground: the workshop, closed, with its door, and the carport's one wall, along the north
  for (const [ax, ay, bx, by] of [
    [0, 0, 6, 0],
    [6, 0, 6, 6.5],
    [6, 6.5, 0, 6.5],
    [0, 6.5, 0, 0],
  ]) await tool("add_wall", { ax, ay, bx, by });
  const south = model().walls.find((w) => w.ay === 6.5 && w.by === 6.5)!;
  await tool("add_door", { wallId: south.id, t: 0.5 });
  await tool("add_room", { x: 0.1, y: 0.1, w: 5.8, h: 6.3, label: "Workshop" });
  await tool("add_wall", { ax: 6, ay: 0, bx: 11, by: 0 });
  // the workshop is the garage: its sectional door opens east onto the carport, the drive in front of it
  const east = model().walls.find((w) => w.ax === 6 && w.bx === 6)!;
  await tool("add_door", { wallId: east.id, t: 0.5, style: "garage" });
  // the carport: open, to the outer faces of its columns
  const carport = await tool("add_room", { x: 6.1, y: 0.1, w: 5.05, h: 6.55, label: "Carport", open: true });
  // its columns, a line of three on its east edge, 3.25 m apart, the first standing in the wall's end
  const grid = await tool("add_column", { x: 11, y: 3.25, grid: { rows: 3, cols: 1, spacing: 3.25 } });
  await tool("place_item", { kind: "car", x: 8.5, y: 3.4 });
  // the storey over both: one floor 11 × 6.5 m, a studio over the carport, a room over the workshop
  for (const [ax, ay, bx, by] of [
    [0, 0, 11, 0],
    [11, 0, 11, 6.5],
    [11, 6.5, 0, 6.5],
    [0, 6.5, 0, 0],
    [6, 0, 6, 6.5],
  ]) await tool("add_wall", { ax, ay, bx, by, level: first });
  const partition = model().walls.find((w) => w.levelId === first && w.ax === 6 && w.bx === 6)!;
  await tool("add_door", { wallId: partition.id, t: 0.5 });
  await tool("add_room", { x: 0.1, y: 0.1, w: 5.8, h: 6.3, label: "Bedroom", level: first });
  await tool("add_room", { x: 6.1, y: 0.1, w: 4.8, h: 6.3, label: "Studio", level: first });
  expect(carport.summary).toMatch(/Carport/);
  return { first, columns: (grid.ids as string[]).map(String) };
}

describe("an open carport under a storey, through the tools alone", () => {
  it("keeps a column's centre to the decimal it was put at, as the plan tool's grid snap gives it", () => {
    // 0.05 × 112, as the grid snap computes it: 5.6000000000000005
    const snapped = 112 * 0.05;
    expect(snapped).not.toBe(5.6);
    const r = dispatch({ type: "add_column", spec: { x: 9.6, y: snapped } }, { actor: "human" });
    expect(r.ok).toBe(true);
    expect(model().columns.at(-1)).toMatchObject({ x: 9.6, y: 5.6 });
    dispatch({ type: "move_column", id: String(r.id), x: 3 * 0.1, y: snapped }, { actor: "human" });
    expect(model().columns.at(-1)).toMatchObject({ x: 0.3, y: 5.6 });
  });

  it("is built clean: columns carrying the storey, a garage door, a car that fits, no issues", async () => {
    const { first, columns } = await buildByTools();
    expect(columns).toHaveLength(3);
    const m = model();
    expect(m.columns.map((c) => [c.x, c.y])).toEqual([[11, 0], [11, 3.25], [11, 6.5]]);
    // each reaches the underside of the storey's slab
    for (const c of m.columns) expect(columnHeight(m, c)).toBeGreaterThan(2.5);
    expect(m.rooms.find((r) => r.label === "Carport")?.kind).toBe("open");
    expect(m.openings.filter((o) => o.style === "garage")).toHaveLength(1);
    expect((await tool("get_issues", {})).issues).toEqual([]);
    // get_model tells the agent what carries the storey: the workshop's walls and the three columns
    const plan = await tool("get_model", {});
    const supports = plan.supports as { levelId: string; columns: number; walls: number; unsupported: unknown[]; maxReach: number }[];
    expect(supports).toEqual([expect.objectContaining({ levelId: first, columns: 3, unsupported: [] })]);
    expect(supports[0].maxReach).toBeLessThanOrEqual(SUPPORT.span / 2);
  });

  it("reports the storey's floor unsupported once the middle column is removed, with the person's approval", async () => {
    const { first, columns } = await buildByTools();
    actions.setRequireApproval(true);
    const removing = runTool("remove_column", { id: columns[1] }, "agent");
    await flush();
    const [ask] = store.getState().approvals;
    expect(ask.targets[0]).toMatchObject({ type: "column", id: columns[1] });
    actions.resolveApproval(ask.id, true);
    expect((await removing).ok).toBe(true);
    const issues = (await tool("get_issues", { level: first })).issues as { code: string; refs: string[] }[];
    const unsupported = issues.filter((i) => i.code === "slab_unsupported");
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((i) => i.refs.includes(model().rooms.find((r) => r.label === "Studio")!.id))).toBe(true);
    // the zone is where the column stood: at the storey's east edge, half way along it
    const zones = unsupportedZones(model(), first);
    expect(zones.some((z) => z.box.minX <= 11 && z.box.maxX >= 10.5 && z.box.minY <= 3.25 && z.box.maxY >= 3.25)).toBe(true);
    // and Undo puts it back, and the floor is carried again
    actions.undo();
    expect((await tool("get_issues", {})).issues).toEqual([]);
  });

  it("travels in a save: the plan read back is the plan, and a save from before columns still loads", async () => {
    await buildByTools();
    const saved = JSON.parse(JSON.stringify(model()));
    const back = migratePlan(saved);
    expect(back.ok && back.model).toEqual(model());
    // a format-3 save of the Crescent House's ground floor as it would have been before format 4:
    // no columns, no open porch and parking bay, no garage door, no cars, and so no storey over the
    // drive for columns to carry; as a file read from disk, untyped
    const crescent = seedCrescent();
    const { columns, ...old } = crescent;
    void columns;
    const ground = crescent.levels[0].id;
    const added = (id: string) => /^(g_car|g_garage_door|g_room_carport|g_plant_porch)/.test(id);
    const kept = <T extends { id: string; levelId: string }>(list: readonly T[]) => list.filter((x) => x.levelId === ground && !added(x.id));
    const walls = kept(old.walls);
    const v3 = JSON.parse(
      JSON.stringify({
        ...old,
        version: 3,
        levels: [crescent.levels[0]],
        walls,
        rooms: kept(old.rooms),
        openings: old.openings.filter((o) => !added(o.id) && walls.some((w) => w.id === o.wallId)),
        items: kept(old.items),
        stairs: [],
      }),
    ) as unknown;
    const migrated = migratePlan(v3);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.from).toBe(3);
    expect(migrated.model.version).toBe(PLAN_FORMAT_VERSION);
    expect(migrated.model.columns).toEqual([]);
    expect(migrated.model.rooms.every((r) => r.kind === undefined)).toBe(true);
    expect(migrated.model.openings.every((o) => o.style === undefined)).toBe(true);
    expect(actions.loadModel(migrated.model).ok).toBe(true);
    // the house as it was is as clean as it was: the new rules ask nothing of it
    expect(checkModel(model())).toEqual([]);
  });
});
