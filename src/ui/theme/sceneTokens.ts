/**
 * The 3D view's tokens: the albedo of every surface the model is built from, the colour of every
 * light, and the furniture palette. They are design tokens like tokens.ts's, kept in a module of
 * their own because only the 3D view reads them: the 3D chunk (three.js, src/three/**) is loaded
 * when the view or a Library thumbnail first opens, and this table travels with it instead of
 * sitting in the page's first load.
 *
 * The view's air (SCENE_AIR) is the stylesheet's --scene-backdrop and --scene-ink too
 * (tokenSheet.ts reads it from here), so the loading state paints the very colour the first
 * frame clears to. Where a 3D colour has a 2D counterpart it is built on it: the floor finishes
 * share their hue with the sheet's floor fills (tokens.ts), a step deeper, since these are the
 * built thing and the plan is a drawing of it.
 *
 * Nothing here touches the DOM or three.js; the tests read it under Node.
 */

import { oklch, srgb, type Swatch } from "./color";
import type { FloorFinish } from "../../model/limits";

/**
 * The 3D view's air: the warm studio paper the model stands on and fades into (the fog and the
 * clear colour are this exact value on screen), the loading state that paints it before the
 * first frame, and the ink lettered over it. A step deeper than the sheet's paper, so the white
 * walls of the model read against it as the plan's poché reads on the sheet.
 */
export const SCENE_AIR = Object.freeze({
  backdrop: oklch(93.4, 0.012, 80),
  ink: oklch(30, 0.012, 255),
});

/** The model's own surfaces: walls, openings, floors, fixtures, the ground and the air. */
export const MATERIAL = Object.freeze({
  /** the studio paper the model stands on: the clear colour and the fog, exactly */
  backdrop: SCENE_AIR.backdrop,
  /** the ground under the model: the backdrop's paper a step deeper, fading into it with distance */
  ground: oklch(83, 0.008, 80),
  /** the walls: the sheet's own paper (tokens.ts sheet.paper), a white card model over the studio's deeper paper */
  wall: oklch(97.7, 0.007, 85),
  wallTop: srgb("#d9d2c5"),
  glass: srgb("#bcd8e8"),
  frame: srgb("#6b5d4f"),
  doorLeaf: srgb("#e5ddd0"),
  doorPanel: srgb("#d8cfc0"),
  skirting: srgb("#fbf8f2"),
  handle: srgb("#b9a26a"),
  sill: srgb("#efeae0"),
  curtain: srgb("#ded5c6"),
  lampShade: srgb("#fdf6e6"),
  lampGlow: srgb("#ffe9bd"),
  pendantLight: oklch(94, 0.04, 78),
  cable: srgb("#3a3733"),
  /** a texture that carries its own colour is drawn untinted */
  untinted: srgb("#ffffff"),
  /** the floor finishes' albedo: the sheet's floor hues (tokens.ts sheet.floor*), built */
  floor: Object.freeze({
    oak: oklch(73, 0.055, 72),
    tile: oklch(88.5, 0.008, 230),
    carpet: oklch(74, 0.03, 145),
    concrete: oklch(72, 0.006, 85),
  } satisfies Record<FloorFinish, Swatch>),
  /** the oak planks' seams and grain, and the tiles' grout: the sheet's oak grain and tile joint, built */
  oakSeam: oklch(50, 0.04, 62),
  oakGrain: oklch(62, 0.05, 66),
  tileGrout: oklch(76, 0.01, 230),
  /** the soft contact shadow under a piece of furniture: warm ink, never black */
  contactShadow: oklch(32, 0.02, 60),
});

/** The lights' colours. Their strengths and directions are tuning (src/three/config.ts). */
export const LIGHT = Object.freeze({
  /** the room's ambient: a warm white sky over the studio paper's bounce */
  sky: oklch(98, 0.005, 85),
  bounce: oklch(78, 0.012, 75),
  /** the sun that casts the shadows: late-morning warm */
  sun: oklch(97, 0.016, 80),
  /** the fill from the other side: neutral, a touch cooler than the sun */
  fill: oklch(92, 0.008, 240),
  /** the Library thumbnails' studio light */
  thumbnailSky: oklch(96.5, 0.01, 85),
  thumbnailBounce: oklch(70, 0.025, 75),
  thumbnailKey: oklch(97, 0.03, 80),
  thumbnailRim: oklch(90, 0.02, 240),
});

/**
 * The default tint of each named surface (src/three/surfaces.ts): what a surface is drawn in when
 * nothing names a colour for it. Finishes (roughness, metalness, pattern) are tuning, in config.ts.
 */
export const SURFACE_TINT = Object.freeze({
  oak: oklch(64, 0.055, 68),
  lightWood: oklch(72, 0.06, 75),
  darkWood: oklch(45, 0.035, 55),
  paint: oklch(88, 0.01, 80),
  lacquer: oklch(86, 0.012, 80),
  plaster: MATERIAL.wall,
  fabric: oklch(62, 0.035, 250),
  linen: oklch(92, 0.012, 85),
  leather: oklch(45, 0.06, 50),
  metal: oklch(80, 0.008, 240),
  chrome: oklch(84, 0.006, 240),
  brass: MATERIAL.handle,
  ceramic: oklch(95, 0.005, 230),
  stone: oklch(62, 0.012, 75),
  glass: oklch(91, 0.02, 220),
  water: oklch(80, 0.045, 225),
  plastic: oklch(30, 0.006, 60),
  rubber: oklch(26, 0.006, 60),
  screen: oklch(16, 0.012, 250),
  lampShade: MATERIAL.lampShade,
  foliage: oklch(58, 0.09, 140),
  terracotta: oklch(57, 0.1, 45),
  /** the oak and tile floors' textures carry their own colours (MATERIAL.floor, oakSeam, tileGrout) */
  floorOak: MATERIAL.untinted,
  floorTile: MATERIAL.untinted,
  floorCarpet: MATERIAL.floor.carpet,
  floorConcrete: MATERIAL.floor.concrete,
});

/**
 * The plan's marks, carried into the model so the two views read as one drawing: the ink of
 * its linework (the 3D edges, and the poché a cutaway shows where it slices a wall), the
 * selection's accent, and a pending removal's error outline and hatch. The very values the
 * sheet uses (tokens.ts: sheet.ink, accent.base, status.error, sheet.destructiveHatch; the
 * theme test holds them equal); restated here so the page's first load does not carry the
 * palette for the 3D chunk's sake.
 */
export const SCENE_MARK = Object.freeze({
  ink: oklch(25, 0.012, 255),
  poche: oklch(25, 0.012, 255),
  selection: oklch(50, 0.17, 262),
  destructive: oklch(51, 0.175, 27),
  destructiveHatch: oklch(80, 0.07, 27),
  /**
   * The model's own: the hatch a pending removal is drawn with over the built floors and
   * finishes, the error colour a step deeper than the sheet's (the sheet hatches white paper in
   * destructiveHatch; the model's oak and carpet need 3:1 against a darker line), and the paper
   * casing under every mark's outline.
   */
  destructiveInk: oklch(40, 0.15, 27),
  casing: SCENE_AIR.backdrop,
  /** what the agent is touching right now (the shared session): its verdigris, as on the plan */
  agent: oklch(51.5, 0.09, 192),
});

// ============================================================================ FURNITURE
// The built-in pieces' colours, by role (src/three/furniture.ts). Each is a tint on a named
// surface, so a sofa's blue is fabric blue and a table's honey is wood honey.

export const FURNITURE = Object.freeze({
  /** upholstery: the sofas and armchairs, their cushions a step lighter */
  upholstery: srgb("#7a8ba0"),
  upholsteryDeep: srgb("#6f8095"),
  cushion: srgb("#8b9cb2"),
  /** bedding: mattress, pillows and the blankets */
  mattress: srgb("#e8e4dc"),
  pillow: srgb("#f2efe8"),
  blanket: srgb("#9aa5b5"),
  /** the office chair's mesh and seat */
  charcoal: srgb("#4a4f58"),
  /** towels */
  towel: srgb("#dfe7ea"),
  towelDeep: srgb("#c9d6da"),
  /** the rug and its inner field */
  rug: srgb("#b0987f"),
  rugField: srgb("#c4ad8d"),
  /** woods: honey (tables), mid oak (chairs, shelves, legs), walnut (beds, cabinets) */
  honey: srgb("#b08d5f"),
  honeyDeep: srgb("#a08050"),
  oak: srgb("#96754e"),
  oakDeep: srgb("#7d6244"),
  walnut: srgb("#6f6156"),
  walnutDeep: srgb("#5d5148"),
  walnutLight: srgb("#8a7660"),
  /** kitchen: painted carcasses and fronts, the stone worktop */
  cabinet: srgb("#c9c2b8"),
  cabinetFront: srgb("#d4cec5"),
  plinth: srgb("#b6afa5"),
  worktop: srgb("#8d8578"),
  /** appliances: brushed steel, its door faces, the gaskets */
  steel: srgb("#c9d0d6"),
  steelFace: srgb("#dbe1e6"),
  steelBody: srgb("#aeb5bb"),
  steelDeep: srgb("#8f959a"),
  gasket: srgb("#3f4448"),
  /** dark finishes: feet, the TV, the hob, a display */
  dark: srgb("#2e2c2a"),
  chassis: srgb("#26292c"),
  burner: srgb("#3d3a37"),
  display: srgb("#2b3238"),
  screenGlow: srgb("#2f4a63"),
  /** sanitaryware and the shower's tiled walls */
  porcelain: srgb("#e8eef2"),
  porcelainBowl: srgb("#dde4e8"),
  showerTile: srgb("#dfe6ea"),
  /** the plant: its pot and two leaf greens */
  pot: srgb("#a5663f"),
  leaf: srgb("#5d8a54"),
  leafLight: srgb("#6b9a60"),
  /** the bookshelf's spines: muted cloth bindings, not a toy box */
  books: Object.freeze([oklch(52, 0.09, 35), oklch(46, 0.06, 250), oklch(56, 0.06, 150), oklch(72, 0.08, 85), oklch(42, 0.05, 300), oklch(86, 0.02, 85)]),
  /** soft furnishings: the three-seater's throw pillow, the dining chairs' seat pads, the headboard */
  throwPillow: oklch(80, 0.045, 70),
  seatPad: oklch(55, 0.04, 255),
  headboard: oklch(66, 0.02, 80),
  /** the sheet turned down over the duvet */
  duvetFold: oklch(95, 0.008, 85),
  /** the oval table's tulip pedestal: warm white lacquer */
  pedestal: oklch(94, 0.008, 85),
  /** a car's tinted glass: a dark blue-grey that still reads as glass, not the hob's black */
  carGlass: oklch(38, 0.03, 240),
  /** a car's tail lamps */
  carTailLamp: oklch(44, 0.15, 25),
  /** the hob's black glass and the oven's window */
  hobGlass: oklch(20, 0.005, 250),
  ovenGlass: oklch(24, 0.01, 250),
  /** the plant's soil and stem */
  soil: oklch(32, 0.025, 55),
  stem: oklch(45, 0.05, 110),
  /** the rug's cotton fringe: unbleached, a step lighter than the rug's border, not a white */
  rugFringe: oklch(80, 0.035, 75),
  /** the floor lamp's linen shade and its warm bulb */
  lampShade: MATERIAL.lampShade,
  bulb: MATERIAL.lampGlow,
});
