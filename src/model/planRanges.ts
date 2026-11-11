/**
 * The ranges a plan's numbers keep to, checked over a whole plan. Every edit is held to them
 * as it is made (the store's actions read the same limits.ts ranges), but a plan that arrives
 * as data is only checked for its shape (planFormat.ts), so it may hold a wall 0 m thick or a
 * room 3 km off. Whatever writes the plan out as something stricter than the page (an IFC
 * building model, whose lengths must be positive and whose numbers must be finite reals) asks
 * this first, and refuses with these sentences rather than writing a file that is wrong.
 */

import type { PlanModel } from "./types";
import { COORD, FURNITURE_DIM, LEVEL_HEIGHT, OPENING_HEIGHT, OPENING_SILL, OPENING_T, OPENING_WIDTH, ROOM_SIZE, ROTATION, STAIR, WALL_HEIGHT, WALL_THICKNESS, rangeError, type Range } from "./limits";

type Check = readonly [field: string, value: number | undefined, range: Range];

/**
 * Every number of the plan that is outside its range, one sentence each, naming the entity:
 * "wall wall_n: thickness must be a finite number from 0.02 to 1 m (got 0)." Empty when the
 * plan keeps to every range.
 */
export function planRangeErrors(model: PlanModel): string[] {
  const out: string[] = [];
  const check = (what: string, checks: readonly Check[]) => {
    for (const [field, value, range] of checks) {
      if (value === undefined) continue;
      const bad = rangeError(field, value, range);
      if (bad) out.push(`${what}: ${bad}`);
    }
  };
  for (const l of model.levels) check(`level ${l.id}`, [["height", l.height, LEVEL_HEIGHT]]);
  for (const w of model.walls) {
    check(`wall ${w.id}`, [
      ["ax", w.ax, COORD],
      ["ay", w.ay, COORD],
      ["bx", w.bx, COORD],
      ["by", w.by, COORD],
      ["thickness", w.thickness, WALL_THICKNESS],
      ["height", w.height, WALL_HEIGHT],
    ]);
  }
  for (const o of model.openings) {
    check(`${o.kind} ${o.id}`, [
      ["t", o.t, OPENING_T],
      ["width", o.width, OPENING_WIDTH],
      ["height", o.height, OPENING_HEIGHT],
      ["sill", o.sill, OPENING_SILL],
    ]);
  }
  for (const r of model.rooms) {
    check(`room ${r.id}`, [
      ["x", r.x, COORD],
      ["y", r.y, COORD],
      ["w", r.w, ROOM_SIZE],
      ["h", r.h, ROOM_SIZE],
    ]);
  }
  for (const i of model.items) {
    check(`item ${i.id}`, [
      ["x", i.x, COORD],
      ["y", i.y, COORD],
      ["rotation", i.rotation, ROTATION],
    ]);
  }
  for (const k of model.kinds) {
    check(`kind ${k.kind}`, [
      ["w", k.w, FURNITURE_DIM],
      ["d", k.d, FURNITURE_DIM],
      ["h", k.h, FURNITURE_DIM],
    ]);
  }
  for (const s of model.stairs) {
    check(`stair ${s.id}`, [
      ["x", s.x, COORD],
      ["y", s.y, COORD],
      ["rotation", s.rotation, ROTATION],
      ["width", s.width, STAIR.width],
      ["risers", s.risers, STAIR.risers],
      ["split", s.split, STAIR.risers],
      ["tread", s.tread, STAIR.treadSet],
    ]);
  }
  return out;
}
