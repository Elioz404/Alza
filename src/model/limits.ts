/**
 * Every domain limit and default in one place.
 *
 * The same numbers are read by the tool schemas (what an agent may send), by the store
 * actions (what the model accepts from anyone, the UI included), by the constraint checker
 * and by the tests. Writing a range twice is how a tool ends up accepting a wall the store
 * then refuses, or a checker flagging a room the action just let through.
 *
 * All lengths are metres, angles degrees.
 */

/** A closed numeric interval with the unit it is measured in, for error messages. */
export interface Range {
  readonly min: number;
  readonly max: number;
  readonly unit: string;
}

const range = (min: number, max: number, unit = "m"): Range => Object.freeze({ min, max, unit });

/** True for a finite number inside the range — NaN, ±Infinity and non-numbers all fail. */
export const within = (value: unknown, r: Range): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= r.min && value <= r.max;

/**
 * The reason `value` is not acceptable as `name`, or null when it is. Store actions return
 * this as their failure summary, so it is written for an agent to act on.
 */
export function rangeError(name: string, value: unknown, r: Range): string | null {
  if (within(value, r)) return null;
  const got = typeof value === "number" ? String(value) : JSON.stringify(value) ?? String(value);
  return `${name} must be a finite number from ${r.min} to ${r.max}${r.unit ? ` ${r.unit}` : ""} (got ${got}).`;
}

/** The first non-null reason among several checks. */
export const firstError = (...errors: (string | null)[]): string | null => errors.find((e) => e !== null) ?? null;

// ---------------------------------------------------------------------------- grid / plan

/** Plan grid: coordinates and room sizes snap to this step (5 cm). */
export const SNAP = 0.05;
/** Any plan coordinate, in either axis. Generous for a floor plan, small enough to stay precise. */
export const COORD = range(-1000, 1000);
/** A signed length along a wall, e.g. extend_selected_wall's `meters`. */
export const SIGNED_LENGTH = range(-2000, 2000);

// ---------------------------------------------------------------------------- walls

/** Shortest wall the model accepts, the checker allows and the editor tries to draw. */
export const WALL_MIN_LENGTH = 0.2;
export const WALL_THICKNESS = range(0.02, 1);
export const WALL_HEIGHT = range(0.3, 10);
export const WALL_DEFAULTS = Object.freeze({ thickness: 0.15, height: 2.7 });
/** A wall's two endpoints: "a" is (ax, ay), "b" is (bx, by). */
export const WALL_ENDS = ["a", "b"] as const;
export type WallEnd = (typeof WALL_ENDS)[number];

// ---------------------------------------------------------------------------- openings

/** Position of an opening's centre along its wall. */
export const OPENING_T = range(0, 1, "");
export const OPENING_WIDTH = range(0.2, 6);
export const OPENING_HEIGHT = range(0.1, WALL_HEIGHT.max);
export const OPENING_SILL = range(0, WALL_HEIGHT.max);
export const DOOR_DEFAULTS = Object.freeze({ width: 0.9, sill: 0, height: 2.1 });
export const WINDOW_DEFAULTS = Object.freeze({ width: 1.2, sill: 0.9, height: 1.2 });
/** The jamb a door hinges on is one of its wall's ends. */
export const HINGES = WALL_ENDS;
export type Hinge = WallEnd;
export const SWING_SIDES = ["left", "right"] as const;
export type SwingSide = (typeof SWING_SIDES)[number];
/**
 * A door whose clear opening is wider than this is hung as a pair of leaves, one on each jamb:
 * the plan draws two swings and the 3D view builds two leaves, from this one number.
 */
export const DOUBLE_DOOR_CLEAR = 1.15;
export const DOOR_SWING_DEFAULTS = Object.freeze({ hinge: "a", side: "right" } as const satisfies { hinge: Hinge; side: SwingSide });
/** What set_doors can do to the leaves in the 3D scene. */
export const DOOR_STATES = ["open", "closed", "toggle"] as const;
export type DoorState = (typeof DOOR_STATES)[number];

// ---------------------------------------------------------------------------- rooms

/**
 * Room width and depth, checked on the value as given, before snapping: a size inside the
 * range snaps to one that still is, because the minimum sits on the grid. The minimum is also
 * what the checker calls "too small".
 */
export const ROOM_SIZE = range(0.5, 1000);
/** Floor finishes the 2D fills and the 3D textures are drawn for. */
export const FLOOR_FINISHES = ["oak", "tile", "carpet", "concrete"] as const;
export type FloorFinish = (typeof FLOOR_FINISHES)[number];
export const DEFAULT_FLOOR: FloorFinish = "oak";

// ---------------------------------------------------------------------------- furniture

/** Item rotation in degrees; one full turn either way. */
export const ROTATION = range(-360, 360, "°");
/** Footprint width/depth and height of a piece of furniture (a rug is 2 cm tall). */
export const FURNITURE_DIM = range(0.01, 10);
/** Offset of a custom part inside its piece's own frame. */
export const PART_OFFSET = range(-10, 10);
/** Most primitives one custom kind may be built from: each one is a mesh in every 3D build. */
export const MAX_PARTS = 64;
/**
 * Most kinds define_item_kind may add to the catalogue. Redefining an existing one is always
 * allowed; past this an agent loop would only grow memory and the catalogue every listing
 * and the Library carry.
 */
export const MAX_CUSTOM_KINDS = 100;
export const PART_SHAPES = ["box", "cylinder", "sphere"] as const;
export type PartShape = (typeof PART_SHAPES)[number];
export const ITEM_CATEGORIES = ["living", "bedroom", "kitchen", "bath", "office", "decor"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
/** Fallback colour for a custom kind defined without one. */
export const DEFAULT_ITEM_COLOR = "#9a9186";

// ---------------------------------------------------------------------------- underlay

/** Image fractions (u, v) used to calibrate the underlay. */
export const IMAGE_FRACTION = range(0, 1, "");
/** The real distance between the two calibration points. */
export const CALIBRATION_METERS = range(0.01, 2000);
export const OPACITY = range(0, 1, "");

/**
 * The blueprint upload. The page keeps a re-encoded copy, so the source may be big, but it is
 * checked before decoding and decoded straight to the stored size: a 20 000 px scan is never
 * held in memory at full resolution.
 */
export const UNDERLAY = Object.freeze({
  acceptedTypes: Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]),
  /** Largest source file accepted, in bytes. */
  maxFileBytes: 25 * 1024 * 1024,
  /** Largest source image accepted, in pixels (width × height), read from its header. */
  maxSourcePixels: 100_000_000,
  /** Longest edge of the copy the page keeps. */
  maxEdgePx: 1600,
  /** Encoding of the copy the page keeps. */
  encodeType: "image/jpeg",
  encodeQuality: 0.82,
  /**
   * Largest stored image, in bytes — a sanity bound on what the asset store accepts as an
   * underlay. A 1600 px JPEG at the quality above is a fraction of this.
   */
  maxStoredBytes: 6 * 1024 * 1024,
  /** Initial placement: the image's width in metres before calibration, and its opacity. */
  defaultWidth: 8,
  defaultOpacity: 0.55,
});
/** Size of the underlay's world rectangle. Its corner (x, y) is a plan coordinate (COORD). */
export const UNDERLAY_SIZE = range(0.01, 2 * COORD.max);
/** Width and height of the copy the page keeps, in pixels. */
export const UNDERLAY_PIXELS = range(1, UNDERLAY.maxEdgePx, "px");

// ---------------------------------------------------------------------------- view

export const CAMERA_MODES = ["orbit", "top", "walk"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

// ---------------------------------------------------------------------------- text and ids

export const TEXT = Object.freeze({
  /** room labels, item and supplier product names */
  label: 80,
  planName: 120,
  note: 2000,
  /** a kind id, built-in or custom */
  kind: 64,
  /** any id or name an agent passes to address an entity */
  ref: 128,
  /** a catalogue category (supplier categories are free text) */
  category: 32,
  /** an error message the partner origin sends back; anything longer is cut */
  supplierError: 300,
});

/**
 * How much of a rejected input a validation report echoes back. The report goes to the agent,
 * into the summary and into the on-page activity feed, so it must not grow with the input:
 * an object with 100 000 unknown keys, or one key 10 MB long, still yields a few short lines.
 */
export const VALIDATION_REPORT = Object.freeze({
  /** issues listed; past this the agent has enough to fix, and the rest are counted */
  maxIssues: 8,
  /** longest line, path included */
  maxLineChars: 200,
  /** unknown keys named in an unrecognized-keys issue; the rest are counted */
  maxEchoedKeys: 5,
  /** longest unknown key name echoed */
  maxKeyChars: 40,
  /** longest stretch of a caller's reference a failed lookup quotes back */
  maxRefChars: 60,
});

/** `#rrggbb`, the only colour form the 3D builders and the catalogue swatches agree on. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------- collaboration

/**
 * Who can change the plan: the person at the page, or an agent calling its tools. Every
 * change is attributed to one of them in the activity feed, and a note is signed by one.
 */
export const ACTORS = ["human", "agent"] as const;
export type Actor = (typeof ACTORS)[number];
export const NOTE_AUTHORS = ACTORS;
export type NoteAuthor = Actor;
/** Notes the plan holds at once. */
export const MAX_NOTES = 200;
/** How much of a note the summary of saving it quotes back. */
export const NOTE_EXCERPT_CHARS = 60;
/** Destructive calls that may wait for the human at once; more are refused, not queued. */
export const MAX_PENDING_APPROVALS = 5;
/**
 * Entities a failed lookup names when a reference matches more than one: enough for an agent
 * to pick the right id, few enough that an ambiguous "door" on a big plan stays a short answer.
 */
export const MAX_CANDIDATES = 10;

// ---------------------------------------------------------------------------- supplier

export const SUPPLIER = Object.freeze({
  /** e.g. NK-SOF-3S */
  sku: /^[A-Z0-9][A-Z0-9-]{0,31}$/i,
  currency: /^[A-Z]{3}$/,
  price: range(0, 10_000_000, ""),
  stock: range(0, 1_000_000, ""),
  /** products one listing may carry; the rest of a bigger answer is refused */
  maxProducts: 500,
  /** longest raw answer accepted from the partner, in characters, before parsing */
  maxResponseChars: 1_000_000,
});
