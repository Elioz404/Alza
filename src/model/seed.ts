/**
 * Seed: "Sunset Loft" — an 8 × 6 m loft, fully furnished, audited to 0 issues.
 * Layout:
 *   - Open-plan living/kitchen on the left (0–4.925 m)
 *   - Bedroom top-right, bathroom bottom-right (5–8 m block)
 *   - Entrance door bottom-left, windows on top/left/right walls
 */

import type { PlanModel } from "./types";
import { groundLevel } from "./types";
import { newPlanId } from "./ids";
import { rectOutline } from "./shapes";
import { GROUND_LEVEL_ID as G, LEVEL_DEFAULTS, LEVEL_NAMES, PLAN_FORMAT_VERSION } from "./limits";

export const seedLoft = (): PlanModel => ({
  version: PLAN_FORMAT_VERSION,
  // every demo loaded is a plan of its own, from that moment on
  id: newPlanId(),
  name: "Sunset Loft",
  levels: [groundLevel()],
  walls: [
    // exterior (thickness 0.15, height 2.7)
    { id: "wall_n", levelId: G, ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 },
    { id: "wall_e", levelId: G, ax: 8, ay: 0, bx: 8, by: 6, thickness: 0.15, height: 2.7 },
    { id: "wall_s", levelId: G, ax: 8, ay: 6, bx: 0, by: 6, thickness: 0.15, height: 2.7 },
    { id: "wall_w", levelId: G, ax: 0, ay: 6, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
    // interior block (thickness 0.1)
    { id: "wall_bed_w", levelId: G, ax: 5, ay: 0, bx: 5, by: 3.4, thickness: 0.1, height: 2.7 },
    { id: "wall_bed_s", levelId: G, ax: 5, ay: 3.4, bx: 8, by: 3.4, thickness: 0.1, height: 2.7 },
    { id: "wall_bath_w", levelId: G, ax: 5, ay: 3.4, bx: 5, by: 6, thickness: 0.1, height: 2.7 },
  ],
  openings: [
    // entrance (bottom wall, center x = 1.0)
    { id: "door_main", kind: "door", wallId: "wall_s", t: 0.875, width: 0.9, sill: 0, height: 2.1 },
    // bedroom door (vertical wall x=5, center y = 2.55)
    { id: "door_bed", kind: "door", wallId: "wall_bed_w", t: 0.75, width: 0.9, sill: 0, height: 2.1 },
    // bathroom door (vertical wall x=5, center y = 5.35 — clear of the south corner)
    { id: "door_bath", kind: "door", wallId: "wall_bath_w", t: 0.75, width: 0.8, sill: 0, height: 2.1 },
    // big living window (top wall, center x = 4.16)
    { id: "win_living", kind: "window", wallId: "wall_n", t: 0.52, width: 1.5, sill: 0.9, height: 1.2 },
    // dining window (left wall, center y = 3.0)
    { id: "win_dining", kind: "window", wallId: "wall_w", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
    // bedroom window (right wall, center y = 1.5)
    { id: "win_bed", kind: "window", wallId: "wall_e", t: 0.25, width: 1.2, sill: 0.9, height: 1.2 },
    // bathroom window (right wall, center y = 4.5)
    { id: "win_bath", kind: "window", wallId: "wall_e", t: 0.75, width: 0.6, sill: 1.2, height: 0.9 },
  ],
  rooms: [
    { id: "room_living", levelId: G, points: rectOutline(0.075, 0.075, 4.85, 5.85), label: "Living & Kitchen", floor: "oak" },
    { id: "room_bed", levelId: G, points: rectOutline(5.075, 0.075, 2.85, 3.25), label: "Bedroom", floor: "carpet" },
    { id: "room_bath", levelId: G, points: rectOutline(5.075, 3.475, 2.85, 2.45), label: "Bathroom", floor: "tile" },
  ],
  items: [
    // kitchen strip along the top wall (fronts face into the room)
    { id: "item_counter", levelId: G, kind: "kitchen_counter", x: 1.3, y: 0.385, rotation: 0 },
    { id: "item_fridge", levelId: G, kind: "fridge", x: 2.85, y: 0.45, rotation: 0 },
    // dining (chairs face the table)
    { id: "item_dining", levelId: G, kind: "dining_table", x: 1.2, y: 2.6, rotation: 0 },
    { id: "item_chair1", levelId: G, kind: "dining_chair", x: 0.6, y: 3.3, rotation: 180 },
    { id: "item_chair2", levelId: G, kind: "dining_chair", x: 1.8, y: 3.3, rotation: 180 },
    { id: "item_chair3", levelId: G, kind: "dining_chair", x: 0.6, y: 1.9, rotation: 0 },
    { id: "item_chair4", levelId: G, kind: "dining_chair", x: 1.8, y: 1.9, rotation: 0 },
    // desk corner (desk back flush to the north wall; chair faces the desk)
    { id: "item_desk", levelId: G, kind: "desk", x: 4.25, y: 0.45, rotation: 0 },
    { id: "item_office_chair", levelId: G, kind: "office_chair", x: 4.15, y: 1.35, rotation: 180 },
    // living (sofa faces north toward the TV; shelf books face east)
    { id: "item_sofa", levelId: G, kind: "sofa", x: 3.0, y: 5.3, rotation: 180 },
    { id: "item_coffee", levelId: G, kind: "coffee_table", x: 2.9, y: 4.3, rotation: 0 },
    { id: "item_rug", levelId: G, kind: "rug", x: 2.9, y: 4.8, rotation: 0 },
    { id: "item_tv", levelId: G, kind: "tv_stand", x: 4.7, y: 4.0, rotation: 270 },
    { id: "item_shelf", levelId: G, kind: "bookshelf", x: 0.25, y: 4.2, rotation: 90 },
    { id: "item_plant", levelId: G, kind: "plant", x: 7.7, y: 3.05, rotation: 0 },
    // bedroom (headboard north, wardrobe doors face into the room)
    { id: "item_bed", levelId: G, kind: "bed_double", x: 6.85, y: 1.2, rotation: 0 },
    { id: "item_night", levelId: G, kind: "nightstand", x: 5.8, y: 0.35, rotation: 0 },
    { id: "item_wardrobe", levelId: G, kind: "wardrobe", x: 6.7, y: 3.0, rotation: 180 },
  ],
  stairs: [],
  kinds: [],
  underlay: null,
});

/**
 * A second plan, with two storeys: "Hillside Townhouse", an 8 × 6 m house with a straight stair
 * along its west wall. The ground floor is one living space; upstairs, a landing hall (the
 * stairwell opens into it) and a bedroom. Audited to 0 issues, it is the fixture the tests and
 * the scripts use for levels and stairs; the demo the page opens with stays the loft.
 */
export const FIRST_LEVEL_ID = "level_first";

export const seedTownhouse = (): PlanModel => ({
  version: PLAN_FORMAT_VERSION,
  id: newPlanId(),
  name: "Hillside Townhouse",
  levels: [groundLevel(), { id: FIRST_LEVEL_ID, name: LEVEL_NAMES[1], height: LEVEL_DEFAULTS.height }],
  walls: [
    // ground floor: the shell
    { id: "g_wall_n", levelId: G, ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 },
    { id: "g_wall_e", levelId: G, ax: 8, ay: 0, bx: 8, by: 6, thickness: 0.15, height: 2.7 },
    { id: "g_wall_s", levelId: G, ax: 8, ay: 6, bx: 0, by: 6, thickness: 0.15, height: 2.7 },
    { id: "g_wall_w", levelId: G, ax: 0, ay: 6, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
    // first floor: the shell, and the partition between the landing hall and the bedroom
    { id: "f_wall_n", levelId: FIRST_LEVEL_ID, ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 },
    { id: "f_wall_e", levelId: FIRST_LEVEL_ID, ax: 8, ay: 0, bx: 8, by: 6, thickness: 0.15, height: 2.7 },
    { id: "f_wall_s", levelId: FIRST_LEVEL_ID, ax: 8, ay: 6, bx: 0, by: 6, thickness: 0.15, height: 2.7 },
    { id: "f_wall_w", levelId: FIRST_LEVEL_ID, ax: 0, ay: 6, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
    { id: "f_wall_hall", levelId: FIRST_LEVEL_ID, ax: 2.5, ay: 0, bx: 2.5, by: 6, thickness: 0.1, height: 2.7 },
  ],
  openings: [
    // entrance, south wall, centre x = 4
    { id: "g_door_main", kind: "door", wallId: "g_wall_s", t: 0.5, width: 0.9, sill: 0, height: 2.1 },
    { id: "g_win_n", kind: "window", wallId: "g_wall_n", t: 0.6, width: 1.5, sill: 0.9, height: 1.2 },
    // bedroom door, in the partition at y = 3
    { id: "f_door_bed", kind: "door", wallId: "f_wall_hall", t: 0.5, width: 0.9, sill: 0, height: 2.1 },
    { id: "f_win_bed", kind: "window", wallId: "f_wall_e", t: 0.4, width: 1.2, sill: 0.9, height: 1.2 },
  ],
  rooms: [
    { id: "g_room_living", levelId: G, points: rectOutline(0.075, 0.075, 7.85, 5.85), label: "Living", floor: "oak" },
    { id: "f_room_hall", levelId: FIRST_LEVEL_ID, points: rectOutline(0.075, 0.075, 2.375, 5.85), label: "Landing", floor: "oak" },
    { id: "f_room_bed", levelId: FIRST_LEVEL_ID, points: rectOutline(2.55, 0.075, 5.375, 5.85), label: "Bedroom", floor: "carpet" },
  ],
  items: [
    { id: "g_item_sofa", levelId: G, kind: "sofa", x: 6, y: 5.475, rotation: 180 },
    { id: "g_item_table", levelId: G, kind: "dining_table", x: 4.5, y: 2.5, rotation: 0 },
    { id: "f_item_bed", levelId: FIRST_LEVEL_ID, kind: "bed_double", x: 6.5, y: 1.1, rotation: 0 },
  ],
  stairs: [
    // along the west wall, climbing north from y = 5 to the landing hall upstairs
    { id: "stair_main", levelId: G, shape: "straight", x: 0.55, y: 5, rotation: 180, width: 0.9 },
  ],
  kinds: [],
  underlay: null,
});
