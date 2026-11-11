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
/**
 * How near a wall's end must come to another wall (one of its ends, or a point of its span) to
 * be joined to it: the 3D view and the IFC export then reach the end on into the joint.
 */
export const WALL_JOINT_REACH = 0.09;
/**
 * Two walls whose directions differ by less than this (the sine of the angle between them) run
 * in line: where they meet, one continues the other and neither is cut back to the other's face.
 */
export const WALL_IN_LINE_SINE = 1e-3;
/**
 * How a wall or a room's edge bends: its bulge, tan(θ/4) for the arc's included angle θ (the
 * DXF convention). 0 is straight; ±1 is a half circle, the most an edge bends. A positive bulge
 * bows to the side of (dy, −dx) for the chord's direction (dx, dy): a wall's left, walking from
 * A to B (the side opposite a door's "right" swing), and out of a room, whose outline is kept
 * wound that way round (model/shapes.ts). A bulge is unchanged by moving, scaling or offsetting
 * the arc concentrically, which is why it is the number stored: a wall's two faces and the room
 * edge along it share it with the centreline.
 */
export const BULGE = range(-1, 1, "");
/** A bulge closer to 0 than this is a straight edge (float noise: whatever its length). */
export const STRAIGHT_BULGE = 1e-9;
/**
 * An edge or a wall whose middle stands off its chord by less than this many metres is straight:
 * a bow below what a building model can hold (the IFC export's declared precision,
 * export/ifc/config.ts MODEL_PRECISION, is this same 1e-5 m: an arc bowed less is three points on
 * one line to a reader). Every entry point (the commands, a loaded plan) stores such an edge with
 * no bulge, and the geometry reads one as straight. Kept this fine, not at a drafting tolerance,
 * because a short arc a joint's cap follows along a curved face (a 0.2 m cap on a 10 m radius
 * bows half a millimetre) must stay an arc for the footprints to tile.
 */
export const STRAIGHT_SAGITTA = 1e-5;
/**
 * A curved wall must bend no tighter than this many times its thickness, measured as the radius
 * of its centreline: tighter, its inner face would shrink to (or past) the centre of its arc.
 */
export const WALL_ARC_MIN_RADIUS = 1;
/**
 * How finely an arc is cut into straight pieces where a straight-edged shape is needed (the
 * floors' regions, the checker's tests against furniture, a label's anchor): no piece longer
 * than `maxSegment` metres, none turning by more than `maxAngle` degrees. A 4 m radius arc is
 * then off its chords by under 2 mm.
 */
export const ARC_TESSELLATION = Object.freeze({ maxSegment: 0.1, maxAngle: 4 });
/**
 * Where two walls meet at an angle their faces are mitred: each face runs on to where it meets
 * its neighbour's (model/joints.ts, wallFootprint). At a very sharp angle that point runs far
 * out; past this many times the thicker wall's thickness, the face is squared off instead.
 */
export const WALL_MITRE_LIMIT = 6;
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
/**
 * Two doors' swings that share more floor than this, square metres, hit each other when both
 * open (the checker's doors_swing_together); less is two swings drawn touching.
 */
export const DOOR_SWINGS_TOUCH = 1e-3;
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
/**
 * A room is a simple polygon whose edges may be arcs (model/shapes.ts). It has from 3 to
 * `vertices.max` corners; no edge shorter than `minEdge` (one grid step); at least the area of
 * a ROOM_SIZE.min square; and it is never narrower than ROOM_SIZE.min (the circle that fits
 * inside it is at least that wide). `overlap` is the shared area, m², under which two rooms
 * only touch. `anchorPrecision` is how close to the most interior point (the pole of
 * inaccessibility) a room's label anchor is found, metres.
 */
export const ROOM_SHAPE = Object.freeze({
  vertices: range(3, 100, ""),
  minEdge: SNAP,
  minArea: ROOM_SIZE.min * ROOM_SIZE.min,
  overlap: 1e-4,
  /** how near an arc edge, metres, a new corner must be to split the arc into two rather than make two straight edges */
  onArc: 0.02,
  anchorPrecision: 0.01,
});
/** Floor finishes the 2D fills and the 3D textures are drawn for. */
export const FLOOR_FINISHES = ["oak", "tile", "carpet", "concrete"] as const;
export type FloorFinish = (typeof FLOOR_FINISHES)[number];
export const DEFAULT_FLOOR: FloorFinish = "oak";

// ---------------------------------------------------------------------------- furniture

/** Item rotation in degrees; one full turn either way. */
export const ROTATION = range(-360, 360, "°");
/** One full turn, and a quarter of one (the step of a Turn button and of a stair's aim), degrees. */
export const FULL_TURN = ROTATION.max;
export const QUARTER_TURN = FULL_TURN / 4;
/** A heading turned a quarter, kept inside ROTATION: past one full turn, the same heading a turn back. */
export const quarterTurned = (rotation: number): number => {
  const next = rotation + QUARTER_TURN;
  return next > ROTATION.max ? next - FULL_TURN : next;
};
/** A heading as the one equal to it in [0, FULL_TURN). */
export const headingOf = (deg: number): number => ((deg % FULL_TURN) + FULL_TURN) % FULL_TURN;
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
/**
 * What a custom part may be made of. Each is one of the 3D view's named surfaces (src/three/
 * surfaces.ts), so an agent's piece gets the same wood grain, weave and metal as the built-ins;
 * the part's colour, when it has one, tints it.
 */
export const PART_MATERIALS = [
  "wood",
  "light_wood",
  "dark_wood",
  "paint",
  "lacquer",
  "fabric",
  "linen",
  "leather",
  "metal",
  "chrome",
  "brass",
  "ceramic",
  "stone",
  "glass",
  "plastic",
] as const;
export type PartMaterial = (typeof PART_MATERIALS)[number];
export const ITEM_CATEGORIES = ["living", "bedroom", "kitchen", "bath", "office", "decor"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
/** Fallback colour for a custom kind defined without one. */
export const DEFAULT_ITEM_COLOR = "#9a9186";

// ---------------------------------------------------------------------------- kinds of things

/** What a hole in a wall is. */
export const OPENING_KINDS = ["door", "window"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

/**
 * Where a kind of furniture comes from. "builtin" kinds ship with the app and have hand-modelled
 * 3D builders; "custom" kinds were defined by an agent with define_item_kind; "supplier" kinds
 * were adopted from the partner origin, so their text is third-party content.
 */
export const KIND_SOURCES = ["builtin", "custom", "supplier"] as const;
export type KindSource = (typeof KIND_SOURCES)[number];

// ---------------------------------------------------------------------------- levels

/**
 * The version of the plan's data format. A plan without a version (or with an older one) is
 * migrated on load by model/planFormat.ts; a plan from a newer format is refused.
 *   1 — one storey: walls, openings, rooms and items, no levels
 *   2 — levels (storeys) and stairs; every wall, room and item names its level
 *   3 — free shapes: a room is a polygon (`points`, each corner with the bulge of the edge it
 *       starts) instead of a rectangle (x, y, w, h), and a wall may be an arc (`bulge`)
 */
export const PLAN_FORMAT_VERSION = 3;

/** The id of the level a fresh plan (and a migrated single-storey one) stands on. */
export const GROUND_LEVEL_ID = "level_ground";

/**
 * Floor-to-floor height of a level: from its floor to the floor of the level above, the slab
 * included. The minimum leaves a room of habitable height under the slab.
 */
export const LEVEL_HEIGHT = range(2.2, 10);
/** Thickness of the floor slab between two levels; the 3D view builds the upper floors with it. */
export const SLAB_THICKNESS = 0.2;
/**
 * How thick a room's floor finish is, laid on the slab: furniture stands on top of it, in the
 * 3D view and in the exported building model.
 */
export const FLOOR_FINISH_DEPTH = 0.04;
/**
 * The precision the floors' regions are cut at (model/region.ts): a gap or an overlap smaller
 * than `edgeTolerance` is none, and `probe` is how far off an edge a point is tested for which
 * side of it the region is on.
 */
export const REGION = Object.freeze({ edgeTolerance: 1e-6, probe: 1e-4 });
/**
 * How far a wall's top may sit from the underside of the slab over its level and still meet it.
 * Past it, a wall under a level stops short of the slab (an open band shows in 3D) or runs up
 * through it, and the checker reports it; a level's height change carries the walls that met
 * its slab along within it.
 */
export const WALL_SLAB_TOLERANCE = 0.01;
/**
 * What a change of a level's height does to its walls that met the slab over it: they follow it
 * to the new underside (the default, one undo step with the height), or keep their height.
 */
export const LEVEL_WALLS = ["follow", "keep"] as const;
/**
 * A new level's floor-to-floor height: a default wall (2.7 m) standing under a slab (0.2 m).
 * Written out rather than summed, so it is the round number a person types and reads.
 */
export const LEVEL_DEFAULTS = Object.freeze({ height: 2.9 });
/** Most levels a plan holds. */
export const MAX_LEVELS = 12;
/**
 * What a level is called when it is added without a name, by its position from the ground up.
 * There is one name per level the plan may hold.
 */
export const LEVEL_NAMES: readonly string[] = Object.freeze([
  "Ground floor",
  "First floor",
  "Second floor",
  "Third floor",
  "Fourth floor",
  "Fifth floor",
  "Sixth floor",
  "Seventh floor",
  "Eighth floor",
  "Ninth floor",
  "Tenth floor",
  "Eleventh floor",
]);

// ---------------------------------------------------------------------------- stairs

/** A straight flight, or two flights at right angles with a square landing between them. */
export const STAIR_SHAPES = ["straight", "l"] as const;
export type StairShape = (typeof STAIR_SHAPES)[number];
/** Which way an L-shaped stair's second flight turns, as seen by someone climbing it. */
export const STAIR_TURNS = ["left", "right"] as const;
export type StairTurn = (typeof STAIR_TURNS)[number];

/**
 * The rules a stair is drawn and judged by. A stair climbs one level's floor-to-floor height;
 * by default its risers are the fewest that keep each one under `riser.max`, and its going
 * (tread depth) is the one the step rule asks for (2R + G = stepRule.target), held to `tread`.
 * Either may be set on the stair instead, and the checker then judges it against these ranges.
 */
export const STAIR = Object.freeze({
  /** clear width of a flight */
  width: range(0.6, 3),
  defaultWidth: 0.9,
  /** height of one riser */
  riser: range(0.15, 0.19),
  /** going: horizontal depth of one tread */
  tread: range(0.25, 0.34),
  /**
   * What a stair's going may be set to. Wider than `tread` on purpose: a stair traced from a
   * drawing is recorded as drawn, and the checker says when it falls outside `tread`.
   */
  treadSet: range(0.1, 0.6),
  /** the comfort rule, 2 × riser + going (Blondel): its target and the band it may stray within */
  stepRule: Object.freeze({ target: 0.63, min: 0.6, max: 0.65 }),
  /** how many risers a stair may be set to have */
  risers: range(2, 60, ""),
  /** clear height a person needs above every tread, up to whatever is overhead */
  headroom: 2.0,
  /** the floor that must stay clear in front of the bottom riser and past the top one */
  exitDepth: 0.8,
});
/** Most stairs a plan holds. */
export const MAX_STAIRS = 40;
/** A stair's default shape when it is added without one. */
export const STAIR_DEFAULTS = Object.freeze({ shape: "straight" as StairShape, turn: "left" as StairTurn });

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

/**
 * The 3D view's drawing style: ink edges on every piece (as the plan draws its linework), and a
 * dollhouse cutaway that slices the walls at `cutHeight` above the floor and shows the cut in
 * the plan's poché. View settings, not part of the plan: kept for the tab's session, never in
 * the undo history.
 */
export interface SceneStyle {
  edges: boolean;
  cutaway: boolean;
  cutHeight: number;
}
/** Where the cutaway may slice the walls, and the step the slider moves it by. */
export const CUT_HEIGHT = range(0.3, 4);
export const CUT_HEIGHT_STEP = 0.05;
/** The model is drawn in the plan's ink from the start; the cut is the person's to make. */
export const SCENE_STYLE_DEFAULTS: Readonly<SceneStyle> = Object.freeze({ edges: true, cutaway: false, cutHeight: 1.2 });

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

// ---------------------------------------------------------------------------- the shared session

/**
 * The shared session (src/model/presence.ts, src/session/): who else is on the plan right now
 * and where, and how the tabs of one browser keep one plan between them.
 */
export const SESSION = Object.freeze({
  /** the BroadcastChannel the tabs of this origin meet on */
  channel: "alza-session",
  /** the message format; a message in any other is ignored (2: rooms as polygons, walls with a bulge) */
  protocol: 2,
  /** how long a new tab listens for a tab that already holds the plan before it holds its own */
  joinWaitMs: 400,
  /** at most this often a tab tells the others where its pointer is */
  presenceIntervalMs: 60,
  /** and at least this often, so they know it is still there */
  heartbeatMs: 2000,
  /** a tab not heard from for this long has gone */
  peerTimeoutMs: 6500,
  /** how long the agent's marker stays on what it last touched once its call is done */
  agentLingerMs: 2600,
  /** how long a point_at marker stays */
  pointMs: 6000,
  /** points that can show at once; a new one beyond this replaces the oldest */
  maxPoints: 3,
  /** what the agent touched last, kept for get_presence */
  lastEdited: 5,
  /** how long an agent told the person is editing should wait before it calls again */
  retryAfterMs: 1200,
  /** the longest message a point_at may show */
  pointMessage: 160,
  /** the most registers one sync message may carry (a whole plan's snapshot fits) */
  maxWrites: 20_000,
  /** the longest key or summary a sync message may carry */
  maxKey: 200,
  maxSummary: 400,
  /** joins and leaves announced closer together than this are said once */
  announceMs: 1500,
  /** the most entities one tab says its person edits, or its agent touches, at once */
  maxFocus: 64,
  /** another tab's gesture (a drag) is one step here too: it ends when no frame came for this long */
  gestureIdleMs: 900,
  /**
   * Over the 3D view (ui/session/ScenePresence.tsx), metres: another tab's pointer is marked this
   * far over its floor, and something with no top of its own (a door, a window) this far over it.
   */
  markerUp: Object.freeze({ pointer: 0.05, entity: 1.2 }),
  /**
   * How far into a room, from its corner, metres, a marker on it stands (the agent's, point_at's):
   * clear of the room's name and area in its middle; at most this share of the room's side.
   */
  markerInset: Object.freeze({ metres: 0.45, share: 0.25 }),
  /**
   * The highest clock another tab's write may raise this tab's to (src/session/replica.ts):
   * half of the highest integer a message carries exactly, so there are always more edits left
   * than a session could make before this tab's own clock would pass what a message may carry.
   */
  maxClock: Math.floor(Number.MAX_SAFE_INTEGER / 2),
});

/** What a tool, or a command, is named: lowercase words joined by underscores ("move_item"). */
export const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/** Where a participant is working: the plan (2D) or the 3D view. */
export const PRESENCE_VIEWS = ["2d", "3d"] as const;
/** Who a participant is: a person at a tab, or an agent calling a tab's tools. */
export const PARTICIPANT_KINDS = ["person", "agent"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

// ---------------------------------------------------------------------------- supplier

export const SUPPLIER = Object.freeze({
  /** who the partner origin sells as: the vendor a supplier product names in an exported model */
  vendor: "Nordika",
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
