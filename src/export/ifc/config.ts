/**
 * Every number and name the IFC export writes that the plan does not hold: the file's header,
 * how reals are rounded, the names of the containers the plan has no record of (site,
 * building), the material and property-set names, and the few sizes a plan never states (how
 * deep a door leaf is, how far an opening reaches past the wall it cuts).
 *
 * The plan's own numbers (wall heights, slab thickness, stair rules) come from the plan and
 * model/limits.ts; nothing here repeats them.
 */

import type { FloorFinish } from "../../model/limits";

/** The schema the file is written in, and the exchange it is written for. */
export const IFC_SCHEMA = "IFC4";
/**
 * ISO 10303-21 header. The model carries parametric bodies (extrusions) and openings that void
 * their walls as booleans, which is what the Design Transfer View exchanges; the Reference View
 * expects finished, already voided geometry instead.
 */
export const IFC_HEADER = Object.freeze({
  viewDefinition: "ViewDefinition [DesignTransferView_V1.0]",
  /** FILE_DESCRIPTION's implementation level: ISO 10303-21 second edition, conformance class 1 */
  implementationLevel: "2;1",
  originatingSystem: "Alza",
  preprocessor: "Alza IFC writer",
});

/*
 * The file's extension and media type (IFC_FILE) are in ../ifcExport.ts: the page names the
 * file before the writer is loaded, when it asks the person whether to download it.
 */

/**
 * Decimal places a real is written with. A tenth of a micrometre for lengths in metres, well
 * inside the model's precision below, and short enough that the file stays readable.
 */
export const REAL_DECIMALS = 7;
/**
 * From this magnitude up a real is written with an exponent: JavaScript's fixed notation
 * (Number.prototype.toFixed) gives up there and answers in exponent form itself.
 */
export const REAL_FIXED_LIMIT = 1e21;
/** The longest an IfcLabel or IfcIdentifier may be (IFC4: STRING(255)), in characters. */
export const STEP_LABEL_MAX = 255;
/** How many of a plan's out-of-range values a refused export names; the rest are counted. */
export const REFUSAL_LISTED = 3;
/** The geometric precision the representation contexts declare, metres. */
export const MODEL_PRECISION = 1e-5;

/** Names of the spatial containers and elements the plan has no name for. */
export const IFC_NAMES = Object.freeze({
  site: "Site",
  /** the building is named after the plan; this is its name when the plan has none */
  building: "Building",
  wall: "Wall",
  opening: "Opening",
  door: "Door",
  window: "Window",
  floor: "Floor",
  flooring: "Floor finish",
  stair: "Stair",
  flight: "Flight",
  landing: "Landing",
  stairwell: "Stairwell",
  column: "Column",
  /** an item whose kind the catalogue no longer has is still exported, under its kind id */
  unknownKind: "Furniture",
});

/** Representation identifiers and types (IFC4 implementer agreements). */
export const IFC_REPRESENTATION = Object.freeze({
  model: "Model",
  plan: "Plan",
  body: "Body",
  axis: "Axis",
  footPrint: "FootPrint",
  sweptSolid: "SweptSolid",
  /** a body that is a boolean of solids: a wall less the columns standing in it */
  csg: "CSG",
  curve2d: "Curve2D",
});

/**
 * Sizes the plan never states. A door leaf and a window's glazing are drawn as thin panels in
 * the middle of their wall; an opening reaches this far past each face of the wall it cuts, so
 * the boolean leaves no skin on either face.
 */
export const IFC_SIZES = Object.freeze({
  doorLeafDepth: 0.04,
  windowDepth: 0.06,
  openingOverreach: 0.05,
  /**
   * How far past a wall's face the export looks for a room, to tell an outside wall (a room on
   * one side only) from a partition (a room on both). Rooms are drawn to the wall faces, so a
   * short step past the face is inside a room whenever there is one.
   */
  roomProbe: 0.1,
  /** where along a wall it looks, as fractions of the wall's length */
  roomProbeAt: Object.freeze([0.25, 0.5, 0.75]),
});

/**
 * The material every wall and floor slab is written with: the plan has one finish for both,
 * the plaster the 3D view draws them in.
 */
export const WALL_MATERIAL = Object.freeze({ name: "Plaster", category: "plaster" });

/**
 * The material the columns are written in: what a column carrying a floor is made of. The 3D
 * view draws them plastered, in the walls' finish.
 */
export const COLUMN_MATERIAL = Object.freeze({ name: "Concrete", category: "concrete" });

/**
 * The IfcSpaceTypeEnum value of a room: an open room (a carport, a porch: limits.ts ROOM_KINDS)
 * is EXTERNAL, and PARKING where a parked car stands in it (a kind with `parking`); every other
 * room is a SPACE. An open room is also IsExternal in Pset_SpaceCommon.
 */
export const SPACE_TYPE = Object.freeze({ enclosed: "SPACE", open: "EXTERNAL", parking: "PARKING" });

/*
 * A garage door (limits.ts GARAGE_DOOR) is an IfcDoor, PredefinedType DOOR. IFC4's
 * IfcDoorTypeOperationEnum has no sectional or up-and-over door (ROLLINGUP is a roller shutter
 * that coils), so its OperationType is USERDEFINED and its UserDefinedOperationType names the
 * operation, GARAGE_DOOR.ifcOperation ("SECTIONAL"). It has no swing, so its placement is the
 * wall's own, never turned to face a leaf.
 */

/** The material each floor finish is written as, on the floor covering of the room that has it. */
export const FLOOR_MATERIAL: Readonly<Record<FloorFinish, { name: string; category: string }>> = Object.freeze({
  oak: { name: "Oak flooring", category: "wood" },
  tile: { name: "Ceramic tile", category: "ceramic" },
  carpet: { name: "Carpet", category: "textile" },
  concrete: { name: "Concrete", category: "concrete" },
});

/**
 * The IfcFurnitureTypeEnum value of each built-in kind that has one; every other kind is
 * NOTDEFINED, its kind id written in ObjectType instead.
 */
export const FURNITURE_TYPE: Readonly<Record<string, string>> = Object.freeze({
  sofa: "SOFA",
  sofa_3: "SOFA",
  armchair: "CHAIR",
  office_chair: "CHAIR",
  dining_chair: "CHAIR",
  coffee_table: "TABLE",
  side_table: "TABLE",
  nightstand: "TABLE",
  dining_table: "TABLE",
  dining_table_oval: "TABLE",
  desk: "DESK",
  bed_double: "BED",
  bed_single: "BED",
  bookshelf: "SHELF",
  sideboard: "SHELF",
  wardrobe: "SHELF",
  /*
   * The car is a reference object, exported as furniture is: an IfcFurniture whose ObjectType is
   * its kind id ("car"), NOTDEFINED. IfcTransportElement is IFC4's lifts, escalators and moving
   * walkways (the building's own transport), not a vehicle parked in it, and IFC4 has no vehicle.
   */
});

/**
 * Property sets and quantity sets the export writes: IFC4's standard ones, whose "Pset_" and
 * "Qto_" prefixes buildingSMART keeps for the sets it defines, and the plan's own, which
 * therefore must not take either prefix.
 */
export const IFC_PSETS = Object.freeze({
  wallCommon: "Pset_WallCommon",
  spaceCommon: "Pset_SpaceCommon",
  stairCommon: "Pset_StairCommon",
  columnCommon: "Pset_ColumnCommon",
  columnQuantities: "Qto_ColumnBaseQuantities",
  wallQuantities: "Qto_WallBaseQuantities",
  spaceQuantities: "Qto_SpaceBaseQuantities",
  slabQuantities: "Qto_SlabBaseQuantities",
  coveringQuantities: "Qto_CoveringBaseQuantities",
  /** a supplier product's sku and vendor: the application's own set, under its own prefix */
  product: "Alza_Product",
});
