/**
 * The walk keys are heard on the window, so they also hear what is typed into the page's
 * fields. The handler used to take W/A/S/D and the arrows in every camera mode and from every
 * target — and once letters were lower-cased, capitals too — so the plan's name, its notes and
 * the tool runner lost those letters whenever the 3D view was open. A key is now taken only
 * while walking, and never from a field.
 *
 * Collision reads each wall's doors from the plan's openings grouped by wall, the grouping
 * the 3D build already makes, rather than scanning every opening once per wall.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WalkKeys, blockersFor } from "../src/three/walk";
import { openingsByWall } from "../src/three/build";
import { emptyModel, type Opening, type PlanModel } from "../src/model/types";

const fields: HTMLElement[] = [];
afterEach(() => {
  for (const f of fields.splice(0)) f.remove();
});

/** Dispatch a cancelable keydown on `target` and hand it to `keys`, as the window listener does. */
function keydown(keys: WalkKeys, target: EventTarget, key: string, walking: boolean): { taken: boolean; event: KeyboardEvent } {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  let taken = false;
  const listen = (e: Event) => (taken = keys.down(e as KeyboardEvent, walking));
  window.addEventListener("keydown", listen);
  target.dispatchEvent(event);
  window.removeEventListener("keydown", listen);
  return { taken, event };
}

function field<K extends "input" | "textarea" | "select">(tag: K): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fields.push(el);
  return el;
}

describe("WalkKeys", () => {
  it("leaves a capital W typed into a text field alone", () => {
    const keys = new WalkKeys();
    const { taken, event } = keydown(keys, field("input"), "W", true);
    expect(taken).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(keys.any).toBe(false);
  });

  it("leaves every field's keys alone: textareas, list boxes, editable regions", () => {
    const keys = new WalkKeys();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);
    fields.push(editable);
    for (const target of [field("textarea"), field("select"), editable]) {
      for (const key of ["w", "S", "ArrowUp"]) expect(keydown(keys, target, key, true).event.defaultPrevented).toBe(false);
    }
    expect(keys.any).toBe(false);
  });

  it("takes nothing outside walk mode", () => {
    const keys = new WalkKeys();
    const { taken, event } = keydown(keys, document.body, "w", false);
    expect(taken).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("walks on a key pressed on the page itself, Shift or not, and keeps it from scrolling the page", () => {
    const keys = new WalkKeys();
    const lower = keydown(keys, document.body, "w", true);
    expect(lower.taken).toBe(true);
    expect(lower.event.defaultPrevented).toBe(true);
    expect(keys.held("forward")).toBe(true);
    expect(keydown(keys, document.body, "D", true).taken).toBe(true);
    expect(keys.held("right")).toBe(true);
    expect(keydown(keys, document.body, "q", true).taken).toBe(false);
  });

  it("forgets a key on its keyup wherever it lands, so nothing stays held after a click into a field", () => {
    const keys = new WalkKeys();
    keydown(keys, document.body, "w", true);
    keys.up(new KeyboardEvent("keyup", { key: "W" }));
    expect(keys.any).toBe(false);
    keydown(keys, document.body, "ArrowLeft", true);
    keys.clear();
    expect(keys.held("left")).toBe(false);
  });
});

describe("blockersFor", () => {
  const wall = (id: string, ay: number) => ({ id, ax: 0, ay, bx: 4, by: ay, thickness: 0.15, height: 2.7 });
  const opening = (id: string, wallId: string, kind: Opening["kind"]): Opening => ({ id, kind, wallId, t: 0.5, width: 0.9, sill: kind === "door" ? 0 : 0.9, height: 2 });
  const plan: PlanModel = {
    ...emptyModel(),
    walls: [wall("north", 0), wall("south", 4)],
    openings: [opening("d1", "north", "door"), opening("win", "north", "window"), opening("d2", "south", "door")],
  };

  it("opens a gap for each wall's own doors only, never for a window", () => {
    const { walls } = blockersFor(plan);
    expect(walls.map((w) => w.gaps.map((g) => g.id))).toEqual([["d1"], ["d2"]]);
    expect(walls[0].gaps[0]).toMatchObject({ s: 2 - 0.45, e: 2 + 0.45 });
  });

  it("takes a grouping the caller has already made, and reads only that", () => {
    const byWall = openingsByWall(plan);
    expect(blockersFor(plan, byWall)).toEqual(blockersFor(plan));
    expect(blockersFor(plan, new Map()).walls.every((w) => w.gaps.length === 0)).toBe(true);
  });
});
