/**
 * Demo: "Crescent House" — a two-storey family house with a garage, carried in part on two columns,
 * audited to 0 issues. Plan x runs east, y runs south (the north arrow points up the sheet): the
 * street is at the bottom, the drive comes up the east side, the private garden is at the top.
 *
 *  - An L of two blocks. Across the back, a garden bar: the living room, the dining area and an L
 *    kitchen, one open space along the garden. The living room is a single-storey pavilion whose
 *    garden wall is one glazed arc bowing 1.2 m into the garden, with a pair of garden doors at its
 *    apex; its flat roof is a roof terrace off the second bedroom, inside a parapet that follows the
 *    curve. Forward of the bar on the east, a wing toward the street: the stair hall (with the guest
 *    WC and the coats cupboard by the front door) and, past the spine wall, the utility room and an
 *    enclosed single garage whose sectional door faces the street. The utility sits between the
 *    kitchen and the garage, with its own side door to the drive.
 *  - Upstairs, round one landing at the stair head: the second and third bedrooms over the garden
 *    bar, the family bathroom over the utility, a linen store, and the main suite — a walk-in
 *    wardrobe and an en-suite over the garage, and the main bedroom, which projects south from the
 *    garage's front wall over the drive.
 *  - Structure: load-bearing perimeter walls and a spine between the hall and the garage band. The
 *    projecting bedroom is carried at its back by the garage's front wall and at its two free front
 *    corners by exactly two square columns, flush with the walls over them. Between the columns is
 *    a covered porch and parking bay: a car drives straight in between them and on through the
 *    garage door, a second one parks under the bedroom, and from it the front door is a few steps
 *    away under the same slab. Take a column away and the bedroom's floor is unsupported.
 *
 * Every room is the space its walls close off (enclose.ts), so each one reaches exactly to the
 * walls' inner faces, curved ones included. Its own module, loaded when the demo is chosen: the
 * page's first load carries only the loft (seed.ts).
 */

import type { Column, Item, Opening, PlanModel, Room, Wall } from "./types";
import type { Pt } from "./geometry";
import { groundLevel } from "./types";
import { newPlanId } from "./ids";
import { enclosedOutline } from "./enclose";
import { COLUMN, DOOR_DEFAULTS, GARAGE_DOOR, GROUND_LEVEL_ID as G, LEVEL_DEFAULTS, LEVEL_NAMES, OPEN_FLOOR, PLAN_FORMAT_VERSION, WALL_DEFAULTS, WINDOW_DEFAULTS, type FloorFinish } from "./limits";
import { bulgeFromSagitta, rectOutline } from "./shapes";
import { columnCoord } from "./columns";

export const CRESCENT_FIRST_LEVEL_ID = "level_first";
const F = CRESCENT_FIRST_LEVEL_ID;

/** The house's grid and sizes, metres, on the walls' centrelines. */
const HOUSE = Object.freeze({
  /** west to east: the bar's west facade, the wing's west facade, the projecting bedroom's west wall, the spine, the east facade */
  west: 0,
  wing: 6.0,
  projection: 7.8,
  spine: 9.4,
  east: 13.2,
  /** north to south: the garden facade, the back of the wing, the utility / garage wall, the street facade, the projection's front */
  north: 0,
  bar: 5.6,
  garage: 8.35,
  front: 14.6,
  projectionFront: 19.5,
  /**
   * the curved bay: from a pier at the living room's west corner along its whole garden side, to
   * where the dining area begins (the wing's line, `wing`); and how far it bows into the garden
   */
  bayWest: 0.5,
  baySagitta: 1.2,
  /**
   * the hall's guest WC and coats cupboard, in its south-west corner, clear of the stair by a
   * 1.25 m passage; upstairs, a linen store over the WC only, so the corridor beside the
   * stairwell widens into a gallery lit by its own window, stacked over the hall's
   */
  wcNorth: 12.5,
  wcEast: 7.65,
  coatsNorth: 10.85,
  coatsEast: 7.0,
  linenNorth: 12.0,
  linenEast: 7.0,
  /** where along the west facade the gallery's and the hall's windows stand, one over the other */
  galleryWindow: 10.3,
  /** and along the east facade, the utility's side door under the bathroom's window, clear of its shower */
  sideDoor: 7.5,
  /** upstairs partitions: bedroom 2 / landing, bedroom 3 / bathroom, en-suite / walk-in wardrobe */
  bed2South: 5.0,
  bathNorth: 6.0,
  ensuiteSouth: 11.5,
  /** wall thicknesses: exterior, the spine, interior walls, light partitions; the roof terrace's parapet height */
  outer: 0.3,
  spineThickness: 0.2,
  inner: 0.12,
  light: 0.1,
  parapet: 1.1,
  /** the stair: its width, against the spine, and the riser it starts at, clear of the front door's swing */
  stairWidth: 1.0,
  stairFoot: 12.6,
  frontDoor: 1.0,
  garageDoor: GARAGE_DOOR.defaults.width,
});

const { west: X0, wing: XW, projection: XP, spine: XS, east: XE, north: Y0, bar: YB, garage: YG, front: YF, projectionFront: YP, outer: T, spineThickness: S, inner: t, light: l } = HOUSE;

type WallSpec = [id: string, ax: number, ay: number, bx: number, by: number, thickness: number, extra?: Partial<Wall>];
const wallsOn = (levelId: string, specs: readonly WallSpec[]): Wall[] =>
  specs.map(([id, ax, ay, bx, by, thickness, extra]) => ({ id, levelId, ax, ay, bx, by, thickness, height: WALL_DEFAULTS.height, ...extra }));

// walking east along the garden facade, a wall's left is the north: a positive bulge bows into the garden
const BAY_BULGE = bulgeFromSagitta({ x: HOUSE.bayWest, y: Y0 }, { x: XW, y: Y0 }, HOUSE.baySagitta);
const PARAPET = { height: HOUSE.parapet };

const GROUND_WALLS = wallsOn(G, [
  ["g_n_w", X0, Y0, HOUSE.bayWest, Y0, T],
  ["g_facade", HOUSE.bayWest, Y0, XW, Y0, T, { bulge: BAY_BULGE }],
  ["g_n", XW, Y0, XE, Y0, T],
  ["g_e", XE, Y0, XE, YF, T],
  ["g_front", XE, YF, XW, YF, T],
  ["g_hall_w", XW, YF, XW, YB, T],
  ["g_s", XW, YB, X0, YB, T],
  ["g_w", X0, YB, X0, Y0, T],
  // the spine, from the back of the wing to the street: the hall on one side, the utility and the garage on the other
  ["g_spine", XS, YB, XS, YF, S],
  ["g_hall_n", XW, YB, XS, YB, t],
  ["g_kitchen_s", XS, YB, XE, YB, t],
  ["g_garage_n", XS, YG, XE, YG, t],
  // the guest WC and the coats cupboard, in the hall's corner by the front door
  ["g_wc_n", XW, HOUSE.wcNorth, HOUSE.wcEast, HOUSE.wcNorth, l],
  ["g_wc_e", HOUSE.wcEast, HOUSE.wcNorth, HOUSE.wcEast, YF, l],
  ["g_coats_n", XW, HOUSE.coatsNorth, HOUSE.coatsEast, HOUSE.coatsNorth, l],
  ["g_coats_e", HOUSE.coatsEast, HOUSE.coatsNorth, HOUSE.coatsEast, HOUSE.wcNorth, l],
]);

const FIRST_WALLS = wallsOn(F, [
  // the roof terrace over the living room, inside a parapet on the walls under it, the curve included
  ["f_terrace_w", X0, YB, X0, Y0, T, PARAPET],
  ["f_terrace_nw", X0, Y0, HOUSE.bayWest, Y0, T, PARAPET],
  ["f_facade", HOUSE.bayWest, Y0, XW, Y0, T, { ...PARAPET, bulge: BAY_BULGE }],
  ["f_terrace_s", XW, YB, X0, YB, T, PARAPET],
  // the two-storey block
  ["f_w", XW, Y0, XW, YF, T],
  ["f_n", XW, Y0, XE, Y0, T],
  ["f_e", XE, Y0, XE, YP, T],
  ["f_proj_s", XE, YP, XP, YP, T],
  ["f_proj_w", XP, YP, XP, YF, T],
  ["f_s", XP, YF, XW, YF, T],
  ["f_spine", XS, Y0, XS, YF, t],
  ["f_bed2_s", XW, HOUSE.bed2South, XS, HOUSE.bed2South, l],
  ["f_bath_n", XS, HOUSE.bathNorth, XE, HOUSE.bathNorth, l],
  ["f_bath_s", XS, YG, XE, YG, t],
  ["f_ensuite_s", XS, HOUSE.ensuiteSouth, XE, HOUSE.ensuiteSouth, l],
  // the main bedroom's back wall, on the garage's front wall
  ["f_suite", XP, YF, XE, YF, t],
  // the linen store in the corner by the street wall, over the WC
  ["f_linen_n", XW, HOUSE.linenNorth, HOUSE.linenEast, HOUSE.linenNorth, l],
  ["f_linen_e", HOUSE.linenEast, HOUSE.linenNorth, HOUSE.linenEast, YF, l],
]);

/**
 * The two columns under the projecting bedroom's free front corners, on its walls' axes: a column
 * as wide as the wall over it, so its outer faces are that wall's outer faces, where the slab ends.
 */
const COLUMN_SET_IN = COLUMN.defaults.size / 2 - T / 2;
const COLUMNS: Column[] = [XP + COLUMN_SET_IN, XE - COLUMN_SET_IN].map((x, i) => ({
  id: `g_column_${i + 1}`,
  levelId: G,
  shape: "square",
  x: columnCoord(x),
  y: columnCoord(YP - COLUMN_SET_IN),
  w: COLUMN.defaults.size,
  d: COLUMN.defaults.size,
  rotation: 0,
}));

const ALL_WALLS = [...GROUND_WALLS, ...FIRST_WALLS];
const wallById = new Map(ALL_WALLS.map((w) => [w.id, w]));
/** The parameter along a straight wall of the point at plan coordinate `v` along its run. */
const along = (wallId: string, v: number): number => {
  const w = wallById.get(wallId)!;
  return Math.abs(w.bx - w.ax) > Math.abs(w.by - w.ay) ? (v - w.ax) / (w.bx - w.ax) : (v - w.ay) / (w.by - w.ay);
};

type Swing = Pick<Opening, "hinge" | "side">;
const INWARD_A: Swing = { hinge: "a", side: "right" };
/** A door, `width` wide, centred at `t` along its wall. */
const door = (id: string, wallId: string, at: number, width: number, swing: Swing = INWARD_A): Opening => ({
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

/** The middle of the garage's clear width: the line a car drives in on, between the columns, through the garage door. */
export const CRESCENT_LANE_X = (XS + S / 2 + (XE - T / 2)) / 2;

/** Tall glazing on the curve, down to a low sill; ordinary windows elsewhere; small high ones in the wet rooms. */
const BAY_GLASS = { sill: 0.3, height: 2.1 };
const HIGH = { sill: 1.2, height: 0.9 };

const OPENINGS: Opening[] = [
  // ground floor: the front door under the projection, beside the parking bay; the garage door on the lane
  door("g_door_entry", "g_front", along("g_front", 8.6), HOUSE.frontDoor, { hinge: "a", side: "right" }),
  {
    id: "g_garage_door",
    kind: "door",
    style: "garage",
    wallId: "g_front",
    t: along("g_front", CRESCENT_LANE_X),
    width: HOUSE.garageDoor,
    sill: DOOR_DEFAULTS.sill,
    height: GARAGE_DOOR.defaults.height,
  },
  door("g_door_hall", "g_hall_n", along("g_hall_n", 7.6), 0.9, { hinge: "a", side: "left" }),
  door("g_door_wc", "g_wc_e", along("g_wc_e", 13.05), 0.8, { hinge: "a", side: "right" }),
  // the coats cupboard opens north into the hall, its leaf back against the west wall
  door("g_door_coats", "g_coats_n", along("g_coats_n", 6.55), 0.75, { hinge: "a", side: "left" }),
  door("g_door_utility", "g_kitchen_s", along("g_kitchen_s", 11.0), 0.8, { hinge: "a", side: "right" }),
  door("g_door_garage", "g_garage_n", along("g_garage_n", 11.6), 0.8, { hinge: "a", side: "left" }),
  door("g_door_side", "g_e", along("g_e", HOUSE.sideDoor), 0.9, { hinge: "a", side: "right" }),
  // the curved bay: a pair of garden doors at its apex, tall glass either side
  door("g_door_garden", "g_facade", 0.5, 1.6, { hinge: "a", side: "right" }),
  win("g_win_facade_w", "g_facade", 0.2, 1.2, BAY_GLASS.sill, BAY_GLASS.height),
  win("g_win_facade_e", "g_facade", 0.8, 1.2, BAY_GLASS.sill, BAY_GLASS.height),
  win("g_win_living_w", "g_w", along("g_w", 2.8), 1.2),
  win("g_win_living_s", "g_s", along("g_s", 3.0), 1.6),
  win("g_win_dining", "g_n", along("g_n", 7.7), 1.8, 0.6, 1.6),
  win("g_win_sink", "g_n", along("g_n", 11.83), 1.0, 1.05, 1.0),
  win("g_win_kitchen_e", "g_e", along("g_e", 3.0), 0.8, 1.05, 1.0),
  // on the east facade each ground opening stands under one upstairs: the side door under the
  // bathroom's window, the garage's under the en-suite's
  win("g_win_garage", "g_e", along("g_e", 9.9), 0.8, 1.4, 0.6),
  win("g_win_hall", "g_hall_w", along("g_hall_w", 7.6), 1.0),
  // a high light toward the stair foot, under the gallery's window
  win("g_win_hall_s", "g_hall_w", along("g_hall_w", HOUSE.galleryWindow), 0.9, HIGH.sill, HIGH.height),
  win("g_win_wc", "g_front", along("g_front", 6.9), 0.5, 1.5, 0.6),
  // first floor
  door("f_door_terrace", "f_w", along("f_w", 3.4), 0.9, { hinge: "a", side: "right" }),
  door("f_door_bed2", "f_bed2_s", along("f_bed2_s", 7.0), 0.8, { hinge: "a", side: "left" }),
  door("f_door_bed3", "f_spine", along("f_spine", 5.5), 0.8, { hinge: "a", side: "left" }),
  door("f_door_bath", "f_spine", along("f_spine", 7.2), 0.8, { hinge: "b", side: "left" }),
  door("f_door_linen", "f_linen_e", along("f_linen_e", 13.3), 0.8, { hinge: "a", side: "left" }),
  door("f_door_master", "f_suite", along("f_suite", 8.75), 0.85, { hinge: "a", side: "right" }),
  door("f_door_walkin", "f_suite", along("f_suite", 10.6), 0.8, { hinge: "b", side: "left" }),
  door("f_door_ensuite", "f_ensuite_s", along("f_ensuite_s", 11.0), 0.8, { hinge: "a", side: "left" }),
  win("f_win_bed2", "f_n", along("f_n", 8.0), 1.4, WINDOW_DEFAULTS.sill, 1.4),
  win("f_win_bed3", "f_n", along("f_n", 11.3), 1.4, WINDOW_DEFAULTS.sill, 1.4),
  // over the bed's head, and over the kitchen's east window below
  win("f_win_bed3_e", "f_e", along("f_e", 3.0), 1.0),
  win("f_win_bath", "f_e", along("f_e", HOUSE.sideDoor), 0.8, HIGH.sill, HIGH.height),
  win("f_win_landing", "f_w", along("f_w", 6.8), 1.2),
  // the gallery beside the stairwell: a window that lights it, the stair and, down the well, the hall
  win("f_win_gallery", "f_w", along("f_w", HOUSE.galleryWindow), 1.2),
  win("f_win_ensuite", "f_e", along("f_e", 9.9), 0.8, HIGH.sill, HIGH.height),
  // the main bedroom looks over the parking bay to the street, its two windows even about its front
  win("f_win_master_s1", "f_proj_s", along("f_proj_s", (XP + XE) / 2 + 1.1), 1.4),
  win("f_win_master_s2", "f_proj_s", along("f_proj_s", (XP + XE) / 2 - 1.1), 1.4),
  // and a high one east, over the drive, above the bedside
  win("f_win_master_e", "f_e", along("f_e", 15.25), 1.0, HIGH.sill, HIGH.height),
  win("f_win_master_w", "f_proj_w", along("f_proj_w", 17.0), 1.2),
];

/** Each room by a point inside it, to fill the space its walls close off there. */
type RoomSpec = [id: string, levelId: string, label: string, floor: FloorFinish, inside: Pt];
const ROOMS: readonly RoomSpec[] = [
  ["g_room_hall", G, "Hall", "tile", { x: 7.8, y: 7 }],
  ["g_room_wc", G, "WC", "tile", { x: 6.8, y: 13.5 }],
  ["g_room_coats", G, "Coats", "oak", { x: 6.6, y: 11.6 }],
  ["g_room_utility", G, "Utility", "tile", { x: 11, y: 7 }],
  ["g_room_garage", G, "Garage", "concrete", { x: 11, y: 11 }],
  ["f_room_bed2", F, "Bedroom 2", "oak", { x: 7.5, y: 2.5 }],
  ["f_room_bed3", F, "Bedroom 3", "oak", { x: 11, y: 3 }],
  ["f_room_bath", F, "Bathroom", "tile", { x: 11, y: 7 }],
  ["f_room_landing", F, "Landing", "oak", { x: 7.5, y: 6.5 }],
  ["f_room_linen", F, "Linen", "oak", { x: 6.6, y: 13.3 }],
  ["f_room_ensuite", F, "En-suite", "tile", { x: 11, y: 10 }],
  ["f_room_walkin", F, "Walk-in wardrobe", "oak", { x: 11, y: 13 }],
  ["f_room_master", F, "Main bedroom", "oak", { x: 10.5, y: 17 }],
];

type ItemSpec = [id: string, levelId: string, kind: string, x: number, y: number, rotation: number];
const ITEMS: readonly ItemSpec[] = [
  // living: the sofa faces the curved bay and its garden doors
  ["g_rug", G, "rug", 3.1, 3.2, 0],
  ["g_sofa", G, "sofa_3", 3.1, 4.5, 180],
  ["g_coffee", G, "coffee_table", 3.1, 3.2, 0],
  ["g_armchair_w", G, "armchair", 1.0, 2.9, 90],
  ["g_armchair_e", G, "armchair", 5.2, 2.9, 270],
  ["g_bookshelf", G, "bookshelf", 0.31, 4.6, 90],
  ["g_lamp", G, "floor_lamp", 0.5, 0.6, 0],
  // dining: a table for six under the garden window
  ["g_table", G, "dining_table", 7.8, 2.7, 90],
  ["g_chair_1", G, "dining_chair", 6.9, 2.3, 90],
  ["g_chair_2", G, "dining_chair", 6.9, 3.1, 90],
  ["g_chair_3", G, "dining_chair", 8.7, 2.3, 270],
  ["g_chair_4", G, "dining_chair", 8.7, 3.1, 270],
  ["g_chair_5", G, "dining_chair", 7.8, 1.45, 0],
  ["g_chair_6", G, "dining_chair", 7.8, 3.95, 180],
  // the L kitchen: a run under the garden window with the sink, a run down the east wall with the hob, ending at the fridge
  ["g_counter_n", G, "counter_unit", 10.63, 0.46, 0],
  ["g_sink", G, "kitchen_sink_unit", 11.83, 0.46, 0],
  ["g_counter_corner", G, "counter_unit", 12.74, 0.75, 270],
  ["g_hob", G, "kitchen_hob_unit", 12.74, 1.95, 270],
  ["g_counter_e", G, "counter_unit", 12.74, 3.15, 270],
  ["g_fridge", G, "fridge", 12.7, 4.1, 270],
  // utility: the laundry run along the spine
  ["g_laundry", G, "counter_unit", 9.81, 6.4, 90],
  ["g_utility_sink", G, "kitchen_sink_unit", 9.81, 7.6, 90],
  // hall: a sideboard under the window to the court
  ["g_sideboard", G, "sideboard", 6.36, 8.6, 90],
  ["g_plant_hall", G, "plant", 6.45, 6.0, 0],
  // WC
  ["g_toilet", G, "toilet", 6.55, 14.125, 180],
  ["g_basin", G, "sink", 6.36, 12.95, 90],
  // the cars: one in the garage, one in the covered bay under the main bedroom, both nose in on the lane
  ["g_car", G, "car", CRESCENT_LANE_X, 11.55, 180],
  ["g_car_bay", G, "car", CRESCENT_LANE_X, 17.4, 180],
  ["g_plant_porch", G, "plant", 8.1, 16.0, 0],
  // first floor: bedroom 2, onto the roof terrace
  ["f_bed2", F, "bed_double", 8.315, 2.6, 270],
  ["f_night_bed2_1", F, "nightstand", 9.14, 1.55, 270],
  ["f_night_bed2_2", F, "nightstand", 9.14, 3.65, 270],
  ["f_wardrobe_bed2", F, "wardrobe", 8.55, 4.65, 180],
  ["f_armchair_bed2", F, "armchair", 6.6, 1.0, 90],
  // the roof terrace
  ["f_terrace_chair_1", F, "armchair", 2.4, 1.6, 0],
  ["f_terrace_chair_2", F, "armchair", 3.6, 1.6, 0],
  ["f_terrace_table", F, "side_table", 3.0, 2.6, 0],
  ["f_terrace_plant_1", F, "plant", 0.5, 4.9, 0],
  ["f_terrace_plant_2", F, "plant", 5.5, 4.9, 0],
  // bedroom 3: the bed against the east wall, a desk under the garden window
  ["f_bed3", F, "bed_double", 12.025, 3.0, 270],
  ["f_night_bed3_1", F, "nightstand", 12.85, 1.75, 270],
  ["f_night_bed3_2", F, "nightstand", 12.85, 4.25, 270],
  ["f_wardrobe_bed3", F, "wardrobe", 9.8, 2.5, 90],
  ["f_desk_bed3", F, "desk", 11.3, 0.475, 0],
  ["f_chair_bed3", F, "office_chair", 11.3, 1.15, 180],
  // the family bathroom
  ["f_shower", F, "shower", 12.6, 6.51, 0],
  ["f_basin", F, "sink", 11.7, 6.27, 180],
  ["f_toilet", F, "toilet", 10.9, 6.385, 180],
  ["f_tub", F, "bathtub", 12.2, 7.915, 0],
  // the gallery: a reading chair by its window over the side garden
  ["f_armchair_landing", F, "armchair", 6.6, HOUSE.galleryWindow, 90],
  ["f_plant_landing", F, "plant", 6.4, 8.25, 0],
  // the en-suite
  ["f_ensuite_tub", F, "bathtub", 12.2, 8.785, 0],
  ["f_ensuite_shower", F, "shower", 12.6, 11.0, 0],
  ["f_ensuite_toilet", F, "toilet", 9.825, 8.86, 90],
  ["f_ensuite_basin_1", F, "sink", 9.71, 9.75, 90],
  ["f_ensuite_basin_2", F, "sink", 9.71, 10.42, 90],
  // the walk-in wardrobe
  ["f_walkin_1", F, "wardrobe", 12.75, 12.6, 270],
  ["f_walkin_2", F, "wardrobe", 9.8, 12.6, 90],
  // the main bedroom: the bed's head on the east wall, a chair in the corner over the porch
  ["f_bed_master", F, "bed_double", 12.025, 17.0, 270],
  ["f_night_master_1", F, "nightstand", 12.85, 15.75, 270],
  ["f_night_master_2", F, "nightstand", 12.85, 18.25, 270],
  ["f_armchair_master", F, "armchair", 8.5, 18.75, 0],
  ["f_dresser_master", F, "sideboard", 8.16, 17.0, 90],
];

/**
 * The open-plan garden bar, split where the living room ends and the dining area begins: on the
 * line of the wing's west facade, where the bedroom wall over it stands on a beam. The split is
 * found by closing the bar along that line with a hairline wall, then setting both outlines on it.
 */
function openPlan(walls: readonly Wall[]): Room[] {
  const line: Wall = { id: "open_line", levelId: G, ax: XW, ay: Y0, bx: XW, by: YB, thickness: 0, height: WALL_DEFAULTS.height };
  const fill = (inside: Pt) => {
    const points = enclosedOutline([...walls, line], inside);
    if (!points) throw new Error("Crescent House: the garden bar is not closed off.");
    return points;
  };
  return [
    { id: "g_room_living", levelId: G, label: "Living", floor: "oak", points: fill({ x: 3, y: 3 }) },
    { id: "g_room_kitchen", levelId: G, label: "Kitchen & dining", floor: "tile", points: fill({ x: 10, y: 3 }) },
  ];
}

/** The demo house, every room fitted to its walls. Throws if a room's walls do not close it off, which the tests would catch. */
export function seedCrescent(): PlanModel {
  const walls = ALL_WALLS.map((w) => ({ ...w }));
  const rooms: Room[] = openPlan(GROUND_WALLS);
  for (const [id, levelId, label, floor, inside] of ROOMS) {
    const points = enclosedOutline(
      walls.filter((w) => w.levelId === levelId),
      inside,
    );
    if (!points) throw new Error(`Crescent House: no walls close off room ${id}.`);
    rooms.push({ id, levelId, points, label, floor });
  }
  // the roof terrace over the living room: open to the sky, inside its parapet, onto it from bedroom 2
  const terrace = enclosedOutline(FIRST_WALLS, { x: 2.5, y: 2.5 });
  if (!terrace) throw new Error("Crescent House: the roof terrace's parapet does not close it off.");
  rooms.push({ id: "f_room_terrace", levelId: F, points: terrace, label: "Roof terrace", floor: "tile", kind: "open" });
  // the porch and parking bay under the projecting bedroom: open on its west, south and east, its
  // floor out to the slab's edge over it (the projection walls' outer faces), under both columns
  rooms.push({
    id: "g_room_carport",
    levelId: G,
    points: rectOutline(XP - T / 2, YF + T / 2, XE - XP + T, YP - YF),
    label: "Porch & carport",
    floor: OPEN_FLOOR,
    kind: "open",
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
    // along the spine in the hall, climbing north from beside the front door to the landing
    stairs: [{ id: "stair_main", levelId: G, shape: "straight", x: XS - S / 2 - HOUSE.stairWidth / 2, y: HOUSE.stairFoot, rotation: 180, width: HOUSE.stairWidth }],
    columns: COLUMNS.map((c) => ({ ...c })),
    kinds: [],
    underlay: null,
  };
}
