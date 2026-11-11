/**
 * Zod building blocks for the domain, each one derived from a range or limit in limits.ts.
 *
 * Tool input schemas are assembled from these (and published as JSON Schema from them), the
 * supplier boundary validates partner data with them, and the store reuses the part schema
 * for custom furniture — so "a valid wall thickness" means one thing everywhere.
 */

import { z } from "zod";
import {
  BULGE,
  CALIBRATION_METERS,
  CAMERA_MODES,
  COORD,
  DOOR_STATES,
  FLOOR_FINISHES,
  FURNITURE_DIM,
  HEX_COLOR,
  HINGES,
  IMAGE_FRACTION,
  ITEM_CATEGORIES,
  LEVEL_HEIGHT,
  MAX_LEVELS,
  MAX_PARTS,
  OPACITY,
  OPENING_HEIGHT,
  OPENING_SILL,
  OPENING_T,
  OPENING_WIDTH,
  PART_OFFSET,
  PART_MATERIALS,
  PART_SHAPES,
  ROOM_SHAPE,
  ROOM_SIZE,
  ROTATION,
  SIGNED_LENGTH,
  STAIR,
  STAIR_SHAPES,
  STAIR_TURNS,
  SUPPLIER,
  SWING_SIDES,
  TEXT,
  VALIDATION_REPORT,
  WALL_ENDS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  type Range,
} from "./limits";

// Zod compiles object parsers with `new Function` when it may. The studio's CSP has no
// 'unsafe-eval', so the attempt would only fail — and a browser reports the blocked attempt
// as a CSP violation even though zod catches it and falls back. Running jitless skips the
// attempt. It must be set before the first z.object() is built, which is why it sits here:
// every module that builds schemas imports this one first.
z.config({ jitless: true });

/** A number inside a named range. z.number() already refuses NaN and ±Infinity. */
export const inRange = (r: Range) => z.number().min(r.min).max(r.max);

/** Non-empty text up to `max` characters. */
export const text = (max: number) => z.string().min(1).max(max);

export const coord = inRange(COORD);
export const signedLength = inRange(SIGNED_LENGTH);
export const wallThickness = inRange(WALL_THICKNESS);
export const wallHeight = inRange(WALL_HEIGHT);
export const openingT = inRange(OPENING_T);
export const openingWidth = inRange(OPENING_WIDTH);
export const openingSill = inRange(OPENING_SILL);
export const openingHeight = inRange(OPENING_HEIGHT);
export const roomSize = inRange(ROOM_SIZE);
export const rotation = inRange(ROTATION);
export const furnitureDim = inRange(FURNITURE_DIM);
export const partOffset = inRange(PART_OFFSET);
export const imageFraction = inRange(IMAGE_FRACTION);
export const calibrationMeters = inRange(CALIBRATION_METERS);
export const opacity = inRange(OPACITY);

/** A point on the plan, as tools take one: [x, y] in metres. */
export const planPoint = z.tuple([coord, coord]);
/** An edge's bulge: tan of a quarter of its arc's angle, 0 straight, ±1 a half circle. */
export const bulge = inRange(BULGE);
/**
 * How a wall bends: by its sagitta (how far the middle of its arc stands off the straight line
 * between its ends, metres; positive to the wall's left walking from A to B, 0 straight) or by a
 * point its arc passes through.
 */
export const wallCurve = z.union([z.strictObject({ sagitta: signedLength }), z.strictObject({ through: planPoint })]);
/** An arc on one edge of a room's outline: by its sagitta (positive bows out of the room) or a point it passes through. */
export const roomArc = z.union([
  z.strictObject({ edge: z.int().min(0).max(ROOM_SHAPE.vertices.max - 1), sagitta: signedLength }),
  z.strictObject({ edge: z.int().min(0).max(ROOM_SHAPE.vertices.max - 1), through: planPoint }),
]);
/** A room's corners, in order round it (either way). */
export const roomPoints = z.array(planPoint).min(ROOM_SHAPE.vertices.min).max(ROOM_SHAPE.vertices.max);
export const roomArcs = z.array(roomArc).max(ROOM_SHAPE.vertices.max);

export const levelHeight = inRange(LEVEL_HEIGHT);
/** A level's place in the stack: 0 is the ground level. */
export const levelOrder = z.int().min(0).max(MAX_LEVELS - 1);
export const stairWidth = inRange(STAIR.width);
/** A count of risers (or of the risers up to an L-shaped stair's landing). */
export const stairRiserCount = z.int().min(STAIR.risers.min).max(STAIR.risers.max);
/** A going set on a stair: wide enough a range to record a drawing, which the checker then judges. */
export const stairGoing = inRange(STAIR.treadSet);
export const stairShape = z.enum(STAIR_SHAPES);
export const stairTurn = z.enum(STAIR_TURNS);

/** An id, or a human name such as "bedroom", that addresses an entity. */
export const ref = text(TEXT.ref);
export const label = text(TEXT.label);
export const kindId = text(TEXT.kind);
export const floorFinish = z.enum(FLOOR_FINISHES);
export const hexColor = z.string().regex(HEX_COLOR, "must be a #rrggbb hex colour");
export const hinge = z.enum(HINGES);
export const swingSide = z.enum(SWING_SIDES);
export const itemCategory = z.enum(ITEM_CATEGORIES);
export const wallEnd = z.enum(WALL_ENDS);
export const cameraMode = z.enum(CAMERA_MODES);
export const doorState = z.enum(DOOR_STATES);
export const supplierSku = z.string().regex(SUPPLIER.sku, "must be a supplier sku such as NK-SOF-3S");

/** One primitive of a custom piece of furniture, in the piece's own frame. */
export const partSpec = z.strictObject({
  shape: z.enum(PART_SHAPES).optional(),
  x: partOffset.optional(),
  y: partOffset.optional(),
  z: partOffset.optional(),
  w: furnitureDim.optional(),
  h: furnitureDim.optional(),
  d: furnitureDim.optional(),
  color: hexColor.optional(),
  material: z.enum(PART_MATERIALS).optional(),
  rotation: rotation.optional(),
});
export const partList = z.array(partSpec).max(MAX_PARTS);
export type PartInput = z.output<typeof partSpec>;

// ---------------------------------------------------------------------------- reporting

/** `value` cut to at most `max` characters, marking the cut. */
export const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export interface IssueReportOptions {
  /** what an issue on the value itself is reported as (default "input") */
  root?: string;
  /** when set, every path is reported under this name: "parts.0.w" rather than "0.w" */
  under?: string;
}

/**
 * A zod error as a few short lines an agent can act on: `path: message`. Every boundary that
 * refuses input reports it through this one formatter, so the report is bounded the same way
 * everywhere (VALIDATION_REPORT): a rejected call never costs as much text as it sent.
 * Unknown keys are reported as a count plus the first few names, each cut short, because zod
 * puts every one of them in a single issue.
 */
export function describeIssues(error: z.ZodError, options: IssueReportOptions = {}): string[] {
  const { root = "input", under } = options;
  const { maxIssues, maxLineChars, maxEchoedKeys, maxKeyChars } = VALIDATION_REPORT;
  const lines = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.map(String).join(".");
    const where = under ? [under, path].filter(Boolean).join(".") : path || root;
    let message = issue.message;
    if (issue.code === "unrecognized_keys") {
      const named = issue.keys.slice(0, maxEchoedKeys).map((k) => JSON.stringify(clip(k, maxKeyChars)));
      const rest = issue.keys.length - named.length;
      message = `${issue.keys.length} unknown key(s): ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
    }
    return clip(`${where}: ${message}`, maxLineChars);
  });
  const more = error.issues.length - lines.length;
  return more > 0 ? [...lines, `…and ${more} more`] : lines;
}
