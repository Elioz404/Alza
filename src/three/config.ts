/**
 * The 3D view's tuning, in one place: what the renderer is asked for, the scene's air and
 * lights, the ambient-occlusion pass, how each camera mode frames the plan, how the walker
 * moves and collides, how fast a door swings, how the frame loop paces itself, and how the
 * catalogue thumbnails are lit. The plan's own limits (wall heights, furniture sizes) are
 * domain rules and live in model/limits.ts; the look of each surface lives in build.ts and
 * furniture.ts with the geometry it belongs to.
 *
 * Lengths are metres, times seconds, angles radians, colours CSS strings.
 */

/** A light: its colour, its intensity, and — for a directional one — where it shines from. */
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

export const RENDERER = Object.freeze({
  /** device pixels per CSS pixel, at most: past 2 the cost grows faster than anyone can see */
  maxPixelRatio: 2,
  toneMappingExposure: 0.95,
  /** the sun's shadow map edge, in texels, and the half-size of the area it covers */
  shadowMapSize: 2048,
  shadowExtent: 12,
  /** scale of the RoomEnvironment the image-based lighting is prefiltered from */
  environmentSigma: 0.04,
  environmentIntensity: 0.3,
});

/** The space around the plan: a dark backdrop the far side of the model fades into. */
export const SCENE = Object.freeze({
  background: "#24282c",
  fog: Object.freeze({ color: "#24282c", near: 45, far: 120 }),
});

/** Soft sky, a warm sun that casts the shadows, and a cool fill from the opposite side. */
export const LIGHTS = Object.freeze({
  hemisphere: Object.freeze<HemisphereSpec>({ sky: "#e8f0fa", ground: "#5a5044", intensity: 0.5 }),
  sun: Object.freeze<DirectionalSpec>({ color: "#fff2dd", intensity: 2.1, position: [10, 14, 6] }),
  /** nudges the shadow lookup off the surface, so lit faces do not shadow themselves (acne) */
  sunShadowBias: -0.0004,
  fill: Object.freeze<DirectionalSpec>({ color: "#cfe0ff", intensity: 0.5, position: [-8, 10, -6] }),
});

/** Screen-space ambient occlusion: contact shading where things meet. */
export const SSAO = Object.freeze({
  kernelRadius: 0.2,
  /** below a rug's thickness, so flat-on-flat surfaces do not self-occlude */
  minDistance: 0.03,
  maxDistance: 0.08,
});

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
  toneMappingExposure: 1.1,
  hemisphere: Object.freeze<HemisphereSpec>({ sky: "#eef3fa", ground: "#6a6152", intensity: 1.5 }),
  key: Object.freeze<DirectionalSpec>({ color: "#fff4e2", intensity: 2.4, position: [3, 5, 4] }),
  rim: Object.freeze<DirectionalSpec>({ color: "#cfe0ff", intensity: 0.7, position: [-4, 2, -3] }),
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
