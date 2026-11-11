/**
 * Demo: "Crescent House" — a two-storey house of free shapes, audited to 0 issues.
 *
 *  - A 12 × 7 m main block. Its south facade over the west half is an arc bowing 1.2 m out into
 *    the garden: the living room downstairs and the main bedroom upstairs have curved floors.
 *  - An L-shaped kitchen round a pantry, a hall with a straight stair along its north wall, a
 *    study, and a guest wing turned 30° off the east wall (60° and 120° joints where it meets it).
 *  - Upstairs, over the wing, a roof terrace: a quadrilateral room inside a low parapet.
 *
 * Every room is the space its walls close off (enclose.ts), so each one reaches exactly to the
 * walls' inner faces, curved ones included. Its own module, loaded when the demo is chosen: the
 * page's first load carries only the loft (seed.ts).
 */

import type { Item, Opening, PlanModel, Room, Wall } from "./types";
import type { Pt } from "./geometry";
import { groundLevel } from "./types";
import { newPlanId } from "./ids";
import { enclosedOutline } from "./enclose";
import { DOOR_DEFAULTS, GROUND_LEVEL_ID as G, LEVEL_DEFAULTS, LEVEL_NAMES, PLAN_FORMAT_VERSION, WALL_DEFAULTS, WINDOW_DEFAULTS, type FloorFinish } from "./limits";
import { bulgeFromSagitta } from "./shapes";

export const CRESCENT_FIRST_LEVEL_ID = "level_first";
const F = CRESCENT_FIRST_LEVEL_ID;

/** The house's dimensions, metres. */
const HOUSE = Object.freeze({
  /** the main block */
  width: 12,
  depth: 7,
  /** where the curved facade ends, and how far its middle stands out into the garden */
  facadeEnd: 6,
  facadeSagitta: 1.2,
  /** the line between the north rooms and the south ones */
  split: 3.5,
  /** the guest wing: where its walls leave the east wall, how far it turns, how long its sides are */
  wingNorth: 3,
  wingSouth: 7,
  wingTurnDeg: 30,
  wingLength: 5,
  outer: 0.2,
  inner: 0.1,
  parapet: 1.1,
});

const deg = (d: number) => (d * Math.PI) / 180;
const U = { x: Math.cos(deg(HOUSE.wingTurnDeg)), y: Math.sin(deg(HOUSE.wingTurnDeg)) };
/** the wing's far corners: its north side runs wingLength along U, its end square to it */
const WING_NE: Pt = { x: HOUSE.width + U.x * HOUSE.wingLength, y: HOUSE.wingNorth + U.y * HOUSE.wingLength };
const WING_SE: Pt = (() => {
  // where the end wall, square to U from WING_NE, meets the south side's line from (width, wingSouth)
  const s = (WING_NE.x - HOUSE.width) * U.x + (WING_NE.y - HOUSE.wingSouth) * U.y;
  return { x: HOUSE.width + U.x * s, y: HOUSE.wingSouth + U.y * s };
})();

type WallSpec = [id: string, ax: number, ay: number, bx: number, by: number, thickness: number, extra?: Partial<Wall>];
const wallsOn = (levelId: string, specs: readonly WallSpec[]): Wall[] =>
  specs.map(([id, ax, ay, bx, by, thickness, extra]) => ({ id, levelId, ax, ay, bx, by, thickness, height: WALL_DEFAULTS.height, ...extra }));

const { width: W, depth: D, facadeEnd: X6, split: Y, outer: T, inner: t } = HOUSE;
const FACADE_BULGE = bulgeFromSagitta({ x: X6, y: D }, { x: 0, y: D }, HOUSE.facadeSagitta);

const GROUND_WALLS = wallsOn(G, [
  ["g_n", 0, 0, W, 0, T],
  ["g_e", W, 0, W, D, T],
  ["g_s", W, D, X6, D, T],
  // from (6, 7) west to (0, 7): its left, walking that way, is the south: a positive bulge bows into the garden
  ["g_facade", X6, D, 0, D, T, { bulge: FACADE_BULGE }],
  ["g_w", 0, D, 0, 0, T],
  ["g_mid_w", 0, Y, X6, Y, t],
  ["g_mid_e", X6, Y, W, Y, t],
  ["g_x6", X6, 0, X6, D, t],
  ["g_pantry_w", 4, 0, 4, 1.6, t],
  ["g_pantry_s", 4, 1.6, X6, 1.6, t],
  ["g_wing_n", W, HOUSE.wingNorth, WING_NE.x, WING_NE.y, T],
  ["g_wing_end", WING_NE.x, WING_NE.y, WING_SE.x, WING_SE.y, T],
  ["g_wing_s", WING_SE.x, WING_SE.y, W, HOUSE.wingSouth, T],
]);

const FIRST_WALLS = wallsOn(F, [
  ["f_n", 0, 0, W, 0, T],
  ["f_e", W, 0, W, D, T],
  ["f_s", W, D, X6, D, T],
  ["f_facade", X6, D, 0, D, T, { bulge: FACADE_BULGE }],
  ["f_w", 0, D, 0, 0, T],
  ["f_mid", 0, Y, W, Y, t],
  ["f_x5", 5, 0, 5, Y, t],
  ["f_x6", X6, Y, X6, D, t],
  ["f_x85", 8.5, Y, 8.5, D, t],
  // the roof terrace's parapet, over the wing's walls
  ["f_terrace_n", W, HOUSE.wingNorth, WING_NE.x, WING_NE.y, T, { height: HOUSE.parapet }],
  ["f_terrace_end", WING_NE.x, WING_NE.y, WING_SE.x, WING_SE.y, T, { height: HOUSE.parapet }],
  ["f_terrace_s", WING_SE.x, WING_SE.y, W, HOUSE.wingSouth, T, { height: HOUSE.parapet }],
]);

/** A door, `width` wide, centred at `t` along its wall. */
const door = (id: string, wallId: string, at: number, width: number = DOOR_DEFAULTS.width, swing: Pick<Opening, "hinge" | "side"> = { hinge: "a", side: "right" }): Opening => ({
  id,
  kind: "door",
  wallId,
  t: at,
  width,
  sill: DOOR_DEFAULTS.sill,
  height: DOOR_DEFAULTS.height,
  ...swing,
});
const win = (id: string, wallId: string, at: number, width: number = WINDOW_DEFAULTS.width, sill: number = WINDOW_DEFAULTS.sill, height: number = WINDOW_DEFAULTS.height): Opening => ({
  id,
  kind: "window",
  wallId,
  t: at,
  width,
  sill,
  height,
});

const OPENINGS: Opening[] = [
  // ground floor
  door("g_door_entry", "g_e", 2.5 / D, DOOR_DEFAULTS.width, { hinge: "b", side: "left" }),
  // clear of the pantry door's swing in the kitchen's corner, and of the partition at the split
  door("g_door_kitchen_hall", "g_x6", 2.95 / D),
  door("g_door_kitchen_living", "g_mid_w", 4.5 / X6, 1.4),
  door("g_door_pantry", "g_pantry_s", 0.5, 0.8),
  door("g_door_hall_study", "g_mid_e", 1 / (W - X6)),
  door("g_door_study_wing", "g_e", 5.2 / D),
  door("g_door_garden", "g_facade", 0.5),
  win("g_win_facade_w", "g_facade", 0.25, 1.4, 0.6, 1.6),
  win("g_win_facade_e", "g_facade", 0.75, 1.4, 0.6, 1.6),
  win("g_win_kitchen_n", "g_n", 1.4 / W),
  win("g_win_kitchen_w", "g_w", (D - 1.75) / D),
  win("g_win_living_w", "g_w", (D - 5.25) / D),
  win("g_win_hall_n", "g_n", 9 / W),
  win("g_win_study_s", "g_s", 0.5),
  win("g_win_wing_n", "g_wing_n", 0.6),
  win("g_win_wing_end", "g_wing_end", 0.5, 1.6),
  // first floor
  door("f_door_bed2", "f_x5", 2.1 / Y),
  door("f_door_master", "f_mid", 5.5 / W, 0.8),
  door("f_door_bath", "f_mid", 7.25 / W, 0.8),
  door("f_door_lounge", "f_mid", 10.25 / W),
  door("f_door_terrace", "f_e", 5.25 / D, DOOR_DEFAULTS.width, { hinge: "a", side: "left" }),
  win("f_win_facade_w", "f_facade", 0.25, 1.4, 0.6, 1.6),
  win("f_win_facade_mid", "f_facade", 0.5, 1.4, 0.6, 1.6),
  win("f_win_facade_e", "f_facade", 0.75, 1.4, 0.6, 1.6),
  win("f_win_bed2", "f_n", 2.5 / W),
  win("f_win_landing", "f_n", 9 / W),
  win("f_win_bath", "f_s", (W - 7.25) / (W - X6), 0.8, 1.2, 0.9),
  win("f_win_lounge", "f_s", (W - 10.25) / (W - X6)),
];

/** Each room by a point inside it, to fill the space its walls close off there. */
type RoomSpec = [id: string, levelId: string, label: string, floor: FloorFinish, inside: Pt];
const ROOMS: readonly RoomSpec[] = [
  ["g_room_kitchen", G, "Kitchen", "tile", { x: 1, y: 1 }],
  ["g_room_pantry", G, "Pantry", "tile", { x: 5, y: 0.8 }],
  ["g_room_living", G, "Living", "oak", { x: 3, y: 5 }],
  ["g_room_hall", G, "Hall", "concrete", { x: 9, y: 2 }],
  ["g_room_study", G, "Study", "oak", { x: 9, y: 5 }],
  ["g_room_guest", G, "Guest room", "carpet", { x: 14, y: 6 }],
  ["f_room_bed2", F, "Bedroom", "carpet", { x: 2, y: 2 }],
  ["f_room_landing", F, "Landing", "oak", { x: 8, y: 2 }],
  ["f_room_master", F, "Main bedroom", "oak", { x: 3, y: 5 }],
  ["f_room_bath", F, "Bathroom", "tile", { x: 7, y: 5 }],
  ["f_room_lounge", F, "Lounge", "oak", { x: 10, y: 5 }],
  ["f_room_terrace", F, "Roof terrace", "concrete", { x: 14, y: 6 }],
];

/** A heading (place_item's rotation) that faces the plan direction d. */
const facing = (d: Pt): number => ((Math.atan2(d.x, d.y) * 180) / Math.PI + 360) % 360;
/** A point `along` the wing's axis and `across` it (from its north side, toward its south), from where its north wall leaves the house. */
const inWing = (along: number, across: number): Pt => ({ x: W + U.x * along - U.y * across, y: HOUSE.wingNorth + U.y * along + U.x * across });
const INTO_WING = facing({ x: -U.x, y: -U.y });

type ItemSpec = [id: string, levelId: string, kind: string, x: number, y: number, rotation: number];
const bedInWing = inWing(HOUSE.wingLength - T / 2 - 1.06, 2.0);
const nightInWing = inWing(HOUSE.wingLength - T / 2 - 0.31, 2.95);
const chairInWing = inWing(2.6, 0.7);
const ITEMS: readonly ItemSpec[] = [
  // kitchen: the run along the north wall, the table in the L's long arm
  ["g_counter", G, "kitchen_counter", 1.4, 0.41, 0],
  ["g_fridge", G, "fridge", 3.5, 0.46, 0],
  ["g_table", G, "dining_table", 2.6, 2.3, 0],
  ["g_chair_1", G, "dining_chair", 2.2, 1.6, 0],
  ["g_chair_2", G, "dining_chair", 3.0, 1.6, 0],
  ["g_chair_3", G, "dining_chair", 2.2, 3.0, 180],
  ["g_chair_4", G, "dining_chair", 3.0, 3.0, 180],
  // living, facing the curved facade
  ["g_sofa", G, "sofa_3", 2.4, 4.04, 0],
  ["g_rug", G, "rug", 2.4, 5.2, 0],
  ["g_coffee", G, "coffee_table", 2.4, 5.1, 0],
  ["g_armchair", G, "armchair", 4.3, 5.2, 270],
  ["g_plant_living", G, "plant", 0.5, 6.3, 0],
  // hall and study
  ["g_sideboard", G, "sideboard", 9.0, 3.24, 180],
  ["g_desk", G, "desk", 8.0, 6.57, 180],
  ["g_office_chair", G, "office_chair", 8.0, 5.9, 0],
  ["g_bookshelf", G, "bookshelf", 6.21, 5.0, 90],
  // the guest wing, turned with it
  ["g_bed_guest", G, "bed_single", bedInWing.x, bedInWing.y, INTO_WING],
  ["g_night_guest", G, "nightstand", nightInWing.x, nightInWing.y, INTO_WING],
  ["g_armchair_guest", G, "armchair", chairInWing.x, chairInWing.y, facing({ x: -U.y, y: U.x })],
  // first floor
  ["f_bed2", F, "bed_double", 1.13, 1.6, 90],
  ["f_night_bed2", F, "nightstand", 0.3, 0.55, 90],
  ["f_wardrobe", F, "wardrobe", 3.5, 3.15, 180],
  ["f_plant_landing", F, "plant", 11.5, 3.1, 0],
  ["f_bed_master", F, "bed_double", 3.0, 4.58, 0],
  ["f_night_master_1", F, "nightstand", 1.9, 3.75, 0],
  ["f_night_master_2", F, "nightstand", 4.1, 3.75, 0],
  ["f_armchair_master", F, "armchair", 1.5, 6.4, 30],
  ["f_bath", F, "bathtub", 7.25, 6.52, 180],
  ["f_toilet", F, "toilet", 6.38, 5.0, 90],
  ["f_sink", F, "sink", 8.24, 4.6, 270],
  ["f_sofa", F, "sofa", 9.0, 5.4, 90],
  ["f_coffee", F, "coffee_table", 9.9, 5.4, 90],
  ["f_terrace_chair", F, "armchair", 14.2, 6.8, 0],
  ["f_terrace_table", F, "side_table", 15.1, 6.0, 0],
  ["f_terrace_plant", F, "plant", 13.4, 4.4, 0],
];

/** The demo house, every room fitted to its walls. Throws if a room's walls do not close it off, which the tests would catch. */
export function seedCrescent(): PlanModel {
  const walls = [...GROUND_WALLS, ...FIRST_WALLS];
  const rooms: Room[] = ROOMS.map(([id, levelId, label, floor, inside]) => {
    const points = enclosedOutline(
      walls.filter((w) => w.levelId === levelId),
      inside,
    );
    if (!points) throw new Error(`Crescent House: no walls close off room ${id}.`);
    return { id, levelId, points, label, floor };
  });
  const items: Item[] = ITEMS.map(([id, levelId, kind, x, y, rotation]) => ({ id, levelId, kind, x, y, rotation }));
  return {
    version: PLAN_FORMAT_VERSION,
    id: newPlanId(),
    name: "Crescent House",
    levels: [groundLevel(), { id: F, name: LEVEL_NAMES[1], height: LEVEL_DEFAULTS.height }],
    walls,
    openings: OPENINGS.map((o) => ({ ...o })),
    rooms,
    items,
    // along the hall's north wall, climbing west to the landing
    stairs: [{ id: "stair_main", levelId: G, shape: "straight", x: 11, y: 0.6, rotation: 270, width: 0.9 }],
    kinds: [],
    underlay: null,
  };
}
