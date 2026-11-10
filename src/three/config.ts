/**
 * The 3D view's tuning, in one place: what the renderer is asked for, the studio's air and
 * lights, the shadows and the cheap contact shading that stands in for screen-space ambient
 * occlusion, the named surfaces' finishes and the procedural patterns they are textured with,
 * how each camera mode frames the plan, how the walker moves and collides, how fast a door
 * swings, how the frame loop paces itself, and how the catalogue thumbnails are lit. The plan's
 * own limits (wall heights, furniture sizes) are domain rules and live in model/limits.ts.
 *
 * Lengths are metres, times seconds, angles radians. Colours are tokens
 * (src/ui/theme/sceneTokens.ts); this module only says where each one is used.
 */

import { LIGHT, MATERIAL } from "../ui/theme/sceneTokens";

/** A light: its colour, its intensity, and â€” for a directional one â€” where it shines from. */
interface LightSpec {
  readonly color: string;
  readonly intensity: number;
}
interface DirectionalSpec extends LightSpec {
  readonly position: readonly [number, number, number];
}
interface HemisphereSpec {
  readonly sky: string;
  readonly ground: string;
  readonly intensity: number;
}

/**
 * How a lit colour is brought to the screen. "neutral" is Khronos' PBR Neutral, which keeps an
 * albedo's hue and lightness until it nears white, so a surface drawn in a token's colour reads
 * as that colour, as the plan's fills do; "aces" is filmic and shifts both.
 */
export type ToneMappingName = "neutral" | "aces";

export const RENDERER = Object.freeze({
  /** device pixels per CSS pixel, at most: past 2 the cost grows faster than anyone can see */
  maxPixelRatio: 2,
  toneMapping: "neutral" as ToneMappingName,
  toneMappingExposure: 1,
  /** scale of the RoomEnvironment the image-based lighting is prefiltered from */
  environmentSigma: 0.04,
  environmentIntensity: 0.35,
});

/**
 * The sun's shadow. Its map covers the plan's bounds and no more (refitted when the plan
 * changes), so a 2048 map gives centimetre texels on a flat; and the map is drawn only when
 * something that casts a shadow moved, not when the camera does, since the sun does not.
 */
export const SHADOWS = Object.freeze({
  mapSize: 2048,
  /** how far past the plan's fit radius the map reaches, metres */
  margin: 1.5,
  /** how far up the sun's direction its shadow camera stands off the plan's centre */
  distance: 30,
  /** nudges the lookup off the surface, so lit faces do not shadow themselves (acne) */
  bias: -0.0004,
  normalBias: 0.02,
});

/** The studio around the plan: warm paper that the ground fades into with distance. */
export const SCENE = Object.freeze({
  background: MATERIAL.backdrop.hex,
  /** fog in metres from the camera: the ground is paper near the model and backdrop past `far` */
  fog: Object.freeze({ color: MATERIAL.backdrop.hex, near: 24, far: 75 }),
  /** the ground disc's radius: past the fog's far edge, so its rim is never seen */
  groundRadius: 120,
  groundSegments: 64,
  groundRoughness: 1,
  /** the ground sits this far under the floors' undersides */
  groundDrop: 0.02,
});

/**
 * Ambient sky over a warm bounce, one warm sun that casts the shadows, and a soft fill. The sky
 * is kept low and the sun strong, from the south-west â€” the default orbit's left â€” so the two
 * faces the camera sees of a white card model differ by a clear step, and its walls stand out
 * from the paper they stand on.
 */
export const LIGHTS = Object.freeze({
  hemisphere: Object.freeze<HemisphereSpec>({ sky: LIGHT.sky.hex, ground: LIGHT.bounce.hex, intensity: 0.7 }),
  /** `position` is the sun's direction from the plan's centre (the shadow refit scales it) */
  sun: Object.freeze<DirectionalSpec>({ color: LIGHT.sun.hex, intensity: 2.6, position: [-6, 14, 9] }),
  fill: Object.freeze<DirectionalSpec>({ color: LIGHT.fill.hex, intensity: 0.35, position: [-8, 10, -6] }),
  /**
   * Each room's pendant: a point light whose strength grows with the room's floor area (from at
   * least `minArea` square metres, up to `max`), reaching across the room and at least `minRange`.
   * A glow in the room, not the room's light: the sun and the sky do that.
   */
  pendant: Object.freeze({ base: 1.2, perSquareMetre: 0.14, max: 4.5, minArea: 4, minRange: 5, decay: 2 }),
});

/**
 * A room's pendant fixture (build.ts buildPendant): it drops a share of the ceiling's height (at
 * most `maxDrop`) on a cord, to an open shade with the bulb inside it â€” round enough (its sides
 * and rings) that no facet of it is a crease the ink draws â€” and the light just below the shade.
 */
export const PENDANT = Object.freeze({
  maxDrop: 0.55,
  dropFraction: 0.22,
  cord: 0.007,
  cordSegments: 6,
  shadeTop: 0.1,
  shadeBottom: 0.19,
  shadeHeight: 0.17,
  shadeSegments: 20,
  bulb: 0.045,
  bulbSegments: 16,
  bulbRings: 12,
  /** how far the bulb's bottom stays above the shade's rim */
  bulbInset: 0.005,
  lightBelow: 0.12,
});

/**
 * Contact shading: what used to be a screen-space ambient-occlusion pass, baked into the
 * geometry instead. Floors darken toward their edges, where they meet the walls; each piece of
 * furniture stands on a soft shadow the size of its footprint. Both are drawn with the frame
 * they belong to, at no extra pass.
 */
export const CONTACT = Object.freeze({
  /** a floor's edge band: its width in metres, and how dark its outer rim is (1 = not at all) */
  floorEdge: Object.freeze({ width: 0.38, shade: 0.7 }),
  /** the shadow under a piece: how far it spreads past the footprint, how dark it is at its core */
  shadow: Object.freeze({
    spread: 0.22,
    opacity: 0.42,
    /** how far over the floor it floats, so it never fights the floor for depth */
    lift: 0.003,
    /** the shadow texture's edge in texels, and how much of it is the soft falloff (each side) */
    texture: 64,
    falloff: 0.32,
  }),
});

/** The procedural patterns surfaces are textured with (src/three/surfaces.ts). */
export type PatternName = "grain" | "weave" | "linen" | "brushed" | "speckle" | "planks" | "tiles" | "pile" | "concrete";

/** A tinted pattern's texture: its size in texels, the metres one repeat covers, how far it darkens. */
export interface TiledPattern {
  readonly size: readonly [number, number];
  readonly metres: readonly [number, number];
  readonly detail: number;
}

/**
 * Each pattern's texture. Its scale is in metres of surface, so a pattern is the same size on
 * every piece and every floor; the floors' periods are the plan's own (src/editor/drawing.ts
 * FLOOR_PATTERN: the planks' width, run and joints, the tiles' side), so a 3D floor's joints
 * fall exactly where the plan draws them. `detail` is how far a pattern darkens its surface at
 * most (0..1).
 */
export const PATTERNS = Object.freeze({
  grain: Object.freeze<TiledPattern>({ size: [256, 256], metres: [1.2, 0.6], detail: 0.14 }),
  weave: Object.freeze<TiledPattern>({ size: [128, 128], metres: [0.05, 0.05], detail: 0.12 }),
  linen: Object.freeze<TiledPattern>({ size: [128, 128], metres: [0.06, 0.06], detail: 0.08 }),
  brushed: Object.freeze<TiledPattern>({ size: [256, 64], metres: [0.6, 0.15], detail: 0.08 }),
  speckle: Object.freeze<TiledPattern>({ size: [128, 128], metres: [0.5, 0.5], detail: 0.14 }),
  pile: Object.freeze<TiledPattern>({ size: [128, 128], metres: [0.4, 0.4], detail: 0.12 }),
  concrete: Object.freeze<TiledPattern>({ size: [256, 256], metres: [2.4, 2.4], detail: 0.1 }),
  /** baked in the oak's own colours: one run of four rows of planks */
  planks: Object.freeze({ pxPerMetre: 400, detail: 0.16, seam: 0.004 }),
  /** baked: a block of `perSide` tiles a side, so their shades do not repeat every tile */
  tiles: Object.freeze({ pxPerMetre: 400, perSide: 4, grout: 0.005, detail: 0.05 }),
});

/**
 * The shape of each pattern's noise (surfaces.ts), as tuning like its scale: how many noise
 * cells (along u, along v) or threads one repeat holds, and how much of each layer goes into the
 * pattern's darkening (`weights`, in the order the recipe names its layers). The recipes' maths â€”
 * the hash, the smoothing, the way threads go over and under â€” is the code's.
 */
export const PATTERN_RECIPES = Object.freeze({
  /** wood: `rings` growth rings a repeat, warped by a coarse noise, over fine fibres and a broad figure */
  grain: Object.freeze({
    rings: 22,
    warp: 1.2,
    warpCells: Object.freeze([4, 3] as const),
    /** the share of each ring's band that is its dark latewood edge starts here */
    ringFrom: 0.82,
    fibreCells: Object.freeze([6, 128] as const),
    figureCells: Object.freeze([2, 8] as const),
    weights: Object.freeze([0.45, 0.55, 0.2] as const),
  }),
  /** over-under threads, over a soft mottle */
  weave: Object.freeze({ threads: 16, cells: Object.freeze([4, 4] as const), weights: Object.freeze([0.55, 0.45] as const) }),
  linen: Object.freeze({ threads: 20, cells: Object.freeze([4, 40] as const), weights: Object.freeze([0.6, 0.6] as const) }),
  /** long streaks, and a texel-fine grit */
  brushed: Object.freeze({ cells: Object.freeze([3, 48] as const), weights: Object.freeze([0.7, 0.3] as const) }),
  speckle: Object.freeze({ cells: Object.freeze([12, 12] as const), weights: Object.freeze([0.55, 0.45] as const) }),
  pile: Object.freeze({ cells: Object.freeze([16, 16] as const), weights: Object.freeze([0.4, 0.6] as const) }),
  /** cloudy patches, finer ones, and grit */
  concrete: Object.freeze({ cells: Object.freeze([5, 5] as const), fineCells: Object.freeze([17, 17] as const), weights: Object.freeze([0.6, 0.3, 0.1] as const) }),
  /**
   * the oak floor: long streaks and fine flecks of grain, their cells per repeat along a plank and
   * per row of planks across; only a streak past `streakFrom` shows
   */
  planks: Object.freeze({
    streakCells: Object.freeze([6, 10] as const),
    fleckCells: Object.freeze([48, 24] as const),
    streakFrom: 0.45,
    weights: Object.freeze([1.6, 0.5] as const),
  }),
  /** the tiles: a mottle of `cellsPerTile` cells a tile's side, this strong */
  tiles: Object.freeze({ cellsPerTile: 6, weight: 0.5 }),
});

/**
 * Every procedural texture: the seed its noise starts from (each pattern's own is the seed times
 * `seedStride`, plus the pattern's place in the list), and the anisotropy it is sampled with.
 */
export const TEXTURES = Object.freeze({ seed: 7, seedStride: 131, anisotropy: 8 });

/** One named surface's finish: how it reflects, and what it is textured with. */
export interface SurfaceFinish {
  readonly roughness: number;
  readonly metalness: number;
  readonly pattern?: PatternName;
  /** transparent surfaces (glass, water) */
  readonly opacity?: number;
  /** seen from both sides (an open shade, a pane) */
  readonly doubleSide?: boolean;
  /** shaded by the per-vertex contact shading the floors carry */
  readonly vertexShade?: boolean;
  /** glows faintly in its own colour (a screen) */
  readonly glow?: number;
}

/** The named surfaces' finishes. Their default colours are tokens (sceneTokens.ts SURFACE_TINT). */
export const SURFACES = Object.freeze({
  oak: { roughness: 0.58, metalness: 0, pattern: "grain" },
  lightWood: { roughness: 0.55, metalness: 0, pattern: "grain" },
  darkWood: { roughness: 0.5, metalness: 0, pattern: "grain" },
  paint: { roughness: 0.75, metalness: 0 },
  lacquer: { roughness: 0.42, metalness: 0 },
  plaster: { roughness: 0.93, metalness: 0 },
  fabric: { roughness: 0.96, metalness: 0, pattern: "weave" },
  linen: { roughness: 0.92, metalness: 0, pattern: "linen" },
  leather: { roughness: 0.55, metalness: 0, pattern: "speckle" },
  metal: { roughness: 0.38, metalness: 0.75, pattern: "brushed" },
  chrome: { roughness: 0.18, metalness: 0.9 },
  brass: { roughness: 0.3, metalness: 0.8 },
  ceramic: { roughness: 0.14, metalness: 0.02 },
  stone: { roughness: 0.42, metalness: 0, pattern: "speckle" },
  glass: { roughness: 0.05, metalness: 0, opacity: 0.24, doubleSide: true },
  water: { roughness: 0.05, metalness: 0, opacity: 0.5 },
  plastic: { roughness: 0.45, metalness: 0 },
  rubber: { roughness: 0.6, metalness: 0 },
  screen: { roughness: 0.12, metalness: 0.15, glow: 0.12 },
  /** a pendant's open shade and its bulb: lit from within */
  lampShade: { roughness: 0.6, metalness: 0, glow: 0.9, doubleSide: true },
  foliage: { roughness: 0.85, metalness: 0, pattern: "speckle" },
  terracotta: { roughness: 0.82, metalness: 0, pattern: "speckle" },
  floorOak: { roughness: 0.68, metalness: 0, pattern: "planks", vertexShade: true },
  floorTile: { roughness: 0.38, metalness: 0, pattern: "tiles", vertexShade: true },
  floorCarpet: { roughness: 1, metalness: 0, pattern: "pile", vertexShade: true },
  floorConcrete: { roughness: 0.8, metalness: 0, pattern: "concrete", vertexShade: true },
} as const satisfies Record<string, SurfaceFinish>);

export const CONTROLS = Object.freeze({
  /** how much of a drag's motion carries on after release, per frame */
  dampingFactor: 0.08,
});

export const CAMERA = Object.freeze({
  fov: 50,
  near: 0.1,
  far: 150,
  /** a plan's bounds are never taken as smaller than this when framing it */
  minFitRadius: 4,
  /** the walker's eye height */
  eyeHeight: 1.6,
});

/**
 * How each camera mode frames the plan. Offsets are multiples of the plan's fit radius;
 * `maxPolar` is how far from straight down the camera may tilt; distances bound the zoom.
 */
export const CAMERA_FRAMING = Object.freeze({
  /**
   * The narrowest view (width / height) the Orbit and Top framings fit as they are. A narrower
   * one, such as a phone held upright, stands the camera back in proportion, so the plan's width
   * still fits rather than being cut at both sides.
   */
  fitAspect: 1,
  top: Object.freeze({
    /** height above the plan's centre */
    height: 1.6,
    /** a hair south of the centre, so looking straight down still has a heading */
    nudge: 0.01,
    maxPolar: 0.15,
    minDistance: 2,
    maxDistance: 60,
  }),
  walk: Object.freeze({
    /** where the walker starts: this far south of the plan's centre, facing north */
    startSouth: 0.15,
    /** the look target sits this far below the eye, so the walker looks a touch down */
    lookDrop: 0.1,
    maxPolar: Math.PI / 2 - 0.05,
    minDistance: 0.1,
    maxDistance: 4,
  }),
  orbit: Object.freeze({
    /** east, up and south of the plan's centre: a three-quarter view from the south-east */
    offset: Object.freeze([0.9, 0.85, 1.1] as const),
    /** the orbit pivots around this height, about a table top, rather than the floor */
    targetHeight: 0.8,
    maxPolar: Math.PI / 2 - 0.02,
    minDistance: 1,
    maxDistance: 80,
  }),
});

/** The frame loop renders only while something changes; these bound one step of it. */
export const FRAMES = Object.freeze({
  /**
   * Longest step a single frame advances the walker or a door by. A frame that follows a
   * stall (a background tab, a long task) would otherwise jump the walker through a wall.
   */
  maxStepSeconds: 0.1,
});

export const WALK = Object.freeze({
  /** walking speed, metres per second */
  speed: 2.2,
  /** the walker is a disc of this radius that cannot enter a wall or a piece of furniture */
  personRadius: 0.3,
  /** anything lower than this is walked over, not into */
  stepOver: 0.25,
  /** how far in front of the eye the orbit target hangs, so looking pivots in place */
  lookAhead: 2,
});

export const DOORS = Object.freeze({
  /** how fast a leaf closes the gap to where it is going, per second (exponential ease) */
  easeRate: 7,
  /** a leaf this close to its target has arrived, and stops asking for frames */
  settleEpsilon: 0.001,
  /** a doorway counts as walkable once its leaf has swung at least this far open (0..1) */
  walkableOpen: 0.5,
});

/**
 * The architectural style's ink edges (sceneTokens.ts SCENE_MARK.ink): a line wherever two
 * faces of a piece meet at more than `crease` degrees, so a box shows its twelve edges and a
 * turned leg its rims, never the facets of its curve. WebGL draws lines one device pixel wide
 * whatever is asked, so the weight is the ink's opacity.
 */
export const EDGES = Object.freeze({
  crease: 32,
  opacity: 0.55,
  /** transparent surfaces fainter than this (glass, water) get no edges of their own */
  minOpacity: 0.6,
  /** a wall's edge this close to another of its boxes is a seam between them, metres */
  seamTolerance: 0.0015,
  /** corners closer than one part in this many metres are one corner, as far as the crease search goes */
  weldPrecision: 1e4,
  /**
   * The ink is drawn this share of its distance nearer the camera than the edge it lies on (along
   * the line of sight, so not moved on screen): a line on a face always wins the depth test
   * against it, and is drawn whole, not in dashes. A millimetre at two metres, under a centimetre
   * across the plan from the default orbit.
   */
  depthPull: 0.0005,
});

/**
 * The dollhouse cutaway: the walls are sliced by a level plane, and each cut wall is closed at
 * the cut by a cap in the plan's pochÃ© (SCENE_MARK.poche), as the plan draws a cut wall. `off`
 * is where the plane stands while the cutaway is off: above anything a plan can hold.
 */
export const CUTAWAY = Object.freeze({
  off: 1000,
  /**
   * How far each box of a wall reaches into the next, and a cap past its ends, metres: no
   * hairline crack opens between them.
   */
  seam: 0.001,
  /**
   * How far a wall's end stops inside the wall it runs into, metres: its end face then lies behind
   * that wall's face, not in its plane, and its side faces meet nothing edge-on, so no seam shows
   * through at a corner or a T.
   */
  faceInset: 0.001,
  /**
   * A wall box's two ends are drawn this much deeper than they are (polygon offset: factor and
   * units). Where a lintel or a sill overlaps the stretch beside it, each one's end meets the
   * other's face edge-on, in its plane; pushed back, the end never shows through as a seam.
   */
  endOffset: 4,
  /** a pendant hangs from the ceiling the cut has taken away: its fixture is hidden while cut */
  hidePendants: true,
  /** curtains are cloth, with no section to show at the cut: they are put away while it is on */
  hideCurtains: true,
});

/**
 * The plan's marks in the model: the selection's outline (accent) and a pending removal's
 * outline and hatch (error), standing `outline` metres off what they mark.
 *
 * An outline is `width` CSS pixels wide over a paper casing `casing` pixels wide, so it reads
 * against any floor or finish as the plan's marks read on the sheet. The stretch of it something
 * hides is drawn dashed at `hiddenOpacity`, so a selected piece behind a wall still shows where
 * it is and reads as behind; a room has no hidden stretch (one projected through its walls would
 * land on the next room). A room's marks are drawn over the room at the top of its walls too, or
 * at the cut â€” a `lidFill` wash of the mark's colour, the hatch and the outline, over whatever
 * stands in the room â€” so a pending removal is seen whatever covers its floor. The hatch is
 * diagonal, one line every `hatchPeriod` metres covering `hatchLine` of it.
 */
export const MARKS = Object.freeze({
  outline: 0.03,
  width: 2.5,
  casing: 6,
  hiddenOpacity: 0.6,
  /** the hidden stretch's dashes and the gaps between them, metres */
  dash: 0.09,
  gap: 0.07,
  hatchPeriod: 0.14,
  hatchLine: 0.4,
  hatchOpacity: 1,
  /** the hatch texture's edge, in texels */
  hatchTexture: 32,
  /** a room's marks lie this far over its floor, and over the top of its walls (or the cut) */
  lift: 0.006,
  lidFill: 0.18,
});

/**
 * Room names over the model, set in the plan's lettering on a paper chip: anchored on each
 * room's floor, `pendantClear` metres along the room's longer side from its centre (where the
 * pendant hangs), hidden when a wall stands between it and the camera, when the room shows
 * smaller on screen than its name needs (plus `padPx`), when the name would not fit inside the
 * view, or past `maxDistance` metres from the camera.
 */
export const LABELS = Object.freeze({
  lift: 0.05,
  padPx: 12,
  maxDistance: 40,
  /** a wall this close to the anchor along the line of sight is the room's own, not in front of it */
  occlusionSlack: 0.2,
  pendantClear: 0.6,
  /** the anchor never moves further from the centre than this share of the room's half-length */
  maxShift: 0.5,
});

/**
 * Camera moves between Orbit, Top view and Walk, and the framing after a new plan: eased over
 * `seconds`, instant under prefers-reduced-motion, finished at once by any input.
 */
export type EasingName = "cubicInOut" | "quadOut" | "linear";
export const TRANSITIONS = Object.freeze({
  seconds: 0.75,
  easing: "cubicInOut" as EasingName,
  /** a move to or from Walk arcs this far over the walls' tops, so it never passes through one */
  clearance: 0.5,
});

/**
 * Where Walk sets the walker down: in the plan's largest room, `back` of the way from its centre
 * toward one end of its longer side, facing through the centre. If furniture stands there, the
 * spot moves toward the centre in `tries` steps, and sideways by `sideStep` metres.
 */
export const WALK_ENTRY = Object.freeze({
  back: 0.6,
  tries: 6,
  sideStep: 0.45,
  /** a spot at least this far from the room's centre, where its pendant hangs, is preferred */
  pendantClear: 1.5,
});

/** Height of the top of a room's floor slab: furniture stands on it and clicks land on it. */
export const FLOOR_TOP = 0.04;

/** A pointer that travels further than this between press and click was a drag, not a click. */
export const CLICK_SLOP_PX = 5;

/** Catalogue thumbnails: their edge in CSS pixels. */
export const THUMBNAIL_SIZE = 176;

/**
 * How a catalogue thumbnail is lit and framed: brighter and flatter than the room, since the
 * piece stands alone against nothing and has to read at a glance.
 */
export const THUMBNAIL = Object.freeze({
  toneMappingExposure: 1.05,
  hemisphere: Object.freeze<HemisphereSpec>({ sky: LIGHT.thumbnailSky.hex, ground: LIGHT.thumbnailBounce.hex, intensity: 1.5 }),
  key: Object.freeze<DirectionalSpec>({ color: LIGHT.thumbnailKey.hex, intensity: 2.4, position: [3, 5, 4] }),
  rim: Object.freeze<DirectionalSpec>({ color: LIGHT.thumbnailRim.hex, intensity: 0.7, position: [-4, 2, -3] }),
  camera: Object.freeze({
    fov: 32,
    near: 0.05,
    far: 60,
    /** a piece is never framed as smaller than this */
    minRadius: 0.25,
    /** extra distance past the bounding sphere's fit, as a multiple of its radius */
    margin: 0.35,
    /** the three-quarter angle, as multiples of the camera's distance (east, up, south) */
    direction: Object.freeze([0.62, 0.5, 0.72] as const),
  }),
});
