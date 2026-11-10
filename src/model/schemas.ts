/**
 * Zod building blocks for the domain, each one derived from a range or limit in limits.ts.
 *
 * Tool input schemas are assembled from these (and published as JSON Schema from them), the
 * supplier boundary validates partner data with them, and the store reuses the part schema
 * for custom furniture — so "a valid wall thickness" means one thing everywhere.
 */

import { z } from "zod";
import {
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
  MAX_PARTS,
  OPACITY,
  OPENING_HEIGHT,
  OPENING_SILL,
  OPENING_T,
  OPENING_WIDTH,
  PART_OFFSET,
  PART_SHAPES,
  ROOM_SIZE,
  ROTATION,
  SIGNED_LENGTH,
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
