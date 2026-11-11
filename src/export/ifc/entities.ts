/**
 * The IFC4 entities the export writes, one constructor each, with their attributes in the
 * schema's order (IFC4 ADD2 TC1, https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/,
 * the entity's "Attribute inheritance" table). Inherited attributes come first, as STEP lists
 * them; an optional attribute the export leaves unset is `$`, one a supertype derives is `*`.
 *
 * Each constructor takes what varies and fills in what never does (OwnerHistory is optional in
 * IFC4 and left unset, as are Description and ObjectType unless a caller has one). The mapping
 * layer (model.ts) never writes an attribute list by hand.
 *
 * Each constructor also holds its attributes to their IFC types where a plain STEP value would
 * not: a positive length (IfcPositiveLengthMeasure) must be one once written, and a label or an
 * identifier (IfcLabel, IfcIdentifier) fits STRING(255). A mapping that broke either fails here,
 * with what it was, instead of writing a file a reader would refuse.
 */

import { DERIVED, StepFile, UNSET, bool, boundedText, enumv, int, list, opt, positiveLength, real, str, typed, type Ref, type StepValue } from "./step";
import { GuidRegistry } from "./guid";
import { MODEL_PRECISION } from "./config";

type Point = Ref<"IFCCARTESIANPOINT">;
type Direction = Ref<"IFCDIRECTION">;
type Placement3 = Ref<"IFCAXIS2PLACEMENT3D">;
type Placement2 = Ref<"IFCAXIS2PLACEMENT2D">;
export type LocalPlacement = Ref<"IFCLOCALPLACEMENT">;
export type Context = Ref<"IFCGEOMETRICREPRESENTATIONCONTEXT"> | Ref<"IFCGEOMETRICREPRESENTATIONSUBCONTEXT">;
type Profile = Ref<"IFCRECTANGLEPROFILEDEF"> | Ref<"IFCARBITRARYCLOSEDPROFILEDEF"> | Ref<"IFCCIRCLEPROFILEDEF">;
type Solid = Ref<"IFCEXTRUDEDAREASOLID">;
/** A body made by subtracting solids from a solid (IfcBooleanResult, DIFFERENCE). */
export type Csg = Ref<"IFCBOOLEANRESULT">;
type Curve = Ref<"IFCPOLYLINE"> | Ref<"IFCINDEXEDPOLYCURVE">;
type Representation = Ref<"IFCSHAPEREPRESENTATION">;
export type ProductShape = Ref<"IFCPRODUCTDEFINITIONSHAPE">;
type Property = Ref<"IFCPROPERTYSINGLEVALUE">;
type Quantity = Ref<"IFCQUANTITYLENGTH"> | Ref<"IFCQUANTITYAREA"> | Ref<"IFCQUANTITYVOLUME">;
export type Material = Ref<"IFCMATERIAL">;
export type LayerSetUsage = Ref<"IFCMATERIALLAYERSETUSAGE">;

/** A property's value: an IFC measure or label, written as a typed value. */
export type PropertyValue =
  | { type: "IFCBOOLEAN"; value: boolean }
  | { type: "IFCLABEL" | "IFCIDENTIFIER" | "IFCTEXT"; value: string }
  | { type: "IFCLENGTHMEASURE" | "IFCPOSITIVELENGTHMEASURE" | "IFCAREAMEASURE"; value: number }
  | { type: "IFCCOUNTMEASURE"; value: number };

const propertyValue = (p: PropertyValue): StepValue => {
  switch (p.type) {
    case "IFCBOOLEAN":
      return typed(p.type, bool(p.value));
    case "IFCLABEL":
    case "IFCIDENTIFIER":
      return typed(p.type, boundedText(p.value, p.type));
    case "IFCTEXT":
      return typed(p.type, str(p.value));
    case "IFCCOUNTMEASURE":
      return typed(p.type, int(p.value));
    case "IFCPOSITIVELENGTHMEASURE":
      return typed(p.type, positiveLength(p.value, p.type));
    default:
      return typed(p.type, real(p.value));
  }
};

/** What every rooted entity starts with: GlobalId, OwnerHistory (unset), Name, Description. */
const rooted = (guid: string, name: string | undefined, description?: string): StepValue[] => [str(guid), UNSET, opt(name, (n) => boundedText(n, "Name")), opt(description, str)];

/**
 * One segment of an indexed poly curve, by the 1-based indices of its points in the curve's
 * point list: a straight line through two or more, or an arc through three (start, a point on
 * it, end).
 */
export type CurveSegment = { readonly line: readonly number[] } | { readonly arc: readonly [number, number, number] };

/** The attributes an IfcProduct adds after IfcRoot's: ObjectType, ObjectPlacement, Representation. */
const product = (objectType: string | undefined, placement: LocalPlacement, shape: ProductShape | null): StepValue[] => [opt(objectType, (t) => boundedText(t, "ObjectType")), placement, shape ?? UNSET];

/** An element's common head: IfcRoot, IfcObject, IfcProduct and IfcElement's Tag. */
export interface ElementHead {
  guid: string;
  name: string;
  objectType?: string;
  placement: LocalPlacement;
  shape: ProductShape | null;
  tag?: string;
}

const elementHead = (e: ElementHead): StepValue[] => [...rooted(e.guid, e.name), ...product(e.objectType, e.placement, e.shape), opt(e.tag, (t) => boundedText(t, "Tag"))];

/** Builds the file's entities. Points, directions and placements are shared; everything else is one instance per call. */
export class IfcEntities {
  readonly file = new StepFile();
  readonly guids = new GuidRegistry();

  guid(key: string): string {
    return this.guids.take(key);
  }

  // ------------------------------------------------------------------ geometry resources

  /** IfcCartesianPoint: Coordinates. */
  point(...coordinates: number[]): Point {
    return this.file.addShared("IFCCARTESIANPOINT", [list(coordinates.map(real))]);
  }

  /** IfcDirection: DirectionRatios. */
  direction(...ratios: number[]): Direction {
    return this.file.addShared("IFCDIRECTION", [list(ratios.map(real))]);
  }

  /** IfcAxis2Placement3D: Location, Axis, RefDirection. Without a RefDirection, the axes are the parent's. */
  placement3(at: readonly [number, number, number], refDirection?: readonly [number, number]): Placement3 {
    const location = this.point(...at);
    if (!refDirection) return this.file.addShared("IFCAXIS2PLACEMENT3D", [location, UNSET, UNSET]);
    return this.file.addShared("IFCAXIS2PLACEMENT3D", [location, this.direction(0, 0, 1), this.direction(refDirection[0], refDirection[1], 0)]);
  }

  /** IfcAxis2Placement2D: Location, RefDirection. */
  placement2(at: readonly [number, number], refDirection?: readonly [number, number]): Placement2 {
    return this.file.addShared("IFCAXIS2PLACEMENT2D", [this.point(...at), refDirection ? this.direction(...refDirection) : UNSET]);
  }

  /** IfcLocalPlacement: PlacementRelTo, RelativePlacement. One per product, never shared. */
  localPlacement(relativeTo: LocalPlacement | null, placement: Placement3): LocalPlacement {
    return this.file.add("IFCLOCALPLACEMENT", [relativeTo ?? UNSET, placement]);
  }

  /** IfcRectangleProfileDef: ProfileType, ProfileName, Position, XDim, YDim. */
  rectangle(centre: readonly [number, number], xDim: number, yDim: number, refDirection?: readonly [number, number]): Profile {
    return this.file.add("IFCRECTANGLEPROFILEDEF", [enumv("AREA"), UNSET, this.placement2(centre, refDirection), positiveLength(xDim, "XDim"), positiveLength(yDim, "YDim")]);
  }

  /** IfcCircleProfileDef: ProfileType, ProfileName, Position, Radius. */
  circle(centre: readonly [number, number], radius: number): Profile {
    return this.file.add("IFCCIRCLEPROFILEDEF", [enumv("AREA"), UNSET, this.placement2(centre), positiveLength(radius, "Radius")]);
  }

  /**
   * IfcBooleanResult: Operator, FirstOperand, SecondOperand — `from` less every one of `less`,
   * one DIFFERENCE each, the first operand of each the result of the one before.
   */
  difference(from: Solid | Csg, less: readonly Solid[]): Solid | Csg {
    return less.reduce<Solid | Csg>((first, second) => this.file.add("IFCBOOLEANRESULT", [enumv("DIFFERENCE"), first, second]), from);
  }

  /**
   * IfcArbitraryClosedProfileDef: ProfileType, ProfileName, OuterCurve: the area inside a
   * closed polyline through `corners` (at least three, in order, the last joined to the first).
   */
  polygon(corners: readonly (readonly [number, number])[]): Profile {
    if (corners.length < 3) throw new Error(`A closed profile needs three corners (got ${corners.length}).`);
    return this.file.add("IFCARBITRARYCLOSEDPROFILEDEF", [enumv("AREA"), UNSET, this.polyline([...corners, corners[0]])]);
  }

  /** IfcExtrudedAreaSolid: SweptArea, Position, ExtrudedDirection, Depth — straight up, from `base`. */
  extrusion(profile: Profile, depth: number, base: readonly [number, number, number] = [0, 0, 0]): Solid {
    return this.file.add("IFCEXTRUDEDAREASOLID", [profile, this.placement3(base), this.direction(0, 0, 1), positiveLength(depth, "Depth")]);
  }

  /**
   * IfcIndexedPolyCurve (Points, Segments, SelfIntersect) over an IfcCartesianPointList2D
   * (CoordList): the IFC4 curve whose segments may be arcs (IfcArcIndex) as well as lines
   * (IfcLineIndex). A closed one ends its last segment at its first point.
   */
  indexedCurve(points: readonly (readonly [number, number])[], segments: readonly CurveSegment[]): Ref<"IFCINDEXEDPOLYCURVE"> {
    const list2d = this.file.add("IFCCARTESIANPOINTLIST2D", [list(points.map((p) => list(p.map(real))))]);
    const index = (i: number) => {
      if (!Number.isInteger(i) || i < 1 || i > points.length) throw new Error(`A curve segment indexes point ${i} of ${points.length}.`);
      return int(i);
    };
    const segs = segments.map((sg) => ("arc" in sg ? typed("IFCARCINDEX", list(sg.arc.map(index))) : typed("IFCLINEINDEX", list(sg.line.map(index)))));
    return this.file.add("IFCINDEXEDPOLYCURVE", [list2d, list(segs), bool(false)]);
  }

  /** IfcArbitraryClosedProfileDef: ProfileType, ProfileName, OuterCurve: the area inside a closed curve (a polyline, or an indexed curve with arcs). */
  closedProfile(curve: Curve): Profile {
    return this.file.add("IFCARBITRARYCLOSEDPROFILEDEF", [enumv("AREA"), UNSET, curve]);
  }

  /** IfcPolyline: Points. */
  polyline(points: readonly (readonly [number, number])[]): Curve {
    return this.file.add("IFCPOLYLINE", [list(points.map((p) => this.point(...p)))]);
  }

  /** IfcShapeRepresentation: ContextOfItems, RepresentationIdentifier, RepresentationType, Items. */
  shapeRepresentation(context: Context, identifier: string, type: string, items: readonly (Solid | Csg | Curve)[]): Representation {
    return this.file.add("IFCSHAPEREPRESENTATION", [context, str(identifier), str(type), list(items)]);
  }

  /** IfcProductDefinitionShape: Name, Description, Representations. */
  productShape(representations: readonly Representation[]): ProductShape {
    return this.file.add("IFCPRODUCTDEFINITIONSHAPE", [UNSET, UNSET, list(representations)]);
  }

  // ------------------------------------------------------------------ contexts and units

  /** IfcGeometricRepresentationContext: ContextIdentifier, ContextType, CoordinateSpaceDimension, Precision, WorldCoordinateSystem, TrueNorth. */
  context(type: string, dimension: 2 | 3): Ref<"IFCGEOMETRICREPRESENTATIONCONTEXT"> {
    const world = dimension === 3 ? this.placement3([0, 0, 0]) : this.placement2([0, 0]);
    return this.file.add("IFCGEOMETRICREPRESENTATIONCONTEXT", [UNSET, str(type), int(dimension), real(MODEL_PRECISION), world, UNSET]);
  }

  /**
   * IfcGeometricRepresentationSubContext: the six attributes of its supertype (all derived from
   * the parent, `*`), then ParentContext, TargetScale, TargetView, UserDefinedTargetView.
   */
  subContext(identifier: string, type: string, parent: Ref<"IFCGEOMETRICREPRESENTATIONCONTEXT">, view: string): Ref<"IFCGEOMETRICREPRESENTATIONSUBCONTEXT"> {
    return this.file.add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", [str(identifier), str(type), DERIVED, DERIVED, DERIVED, DERIVED, parent, UNSET, enumv(view), UNSET]);
  }

  /** IfcSIUnit: Dimensions (derived), UnitType, Prefix, Name. */
  siUnit(unitType: string, name: string): Ref<"IFCSIUNIT"> {
    return this.file.add("IFCSIUNIT", [DERIVED, enumv(unitType), UNSET, enumv(name)]);
  }

  /** IfcUnitAssignment: Units. */
  units(units: readonly Ref<"IFCSIUNIT">[]): Ref<"IFCUNITASSIGNMENT"> {
    return this.file.add("IFCUNITASSIGNMENT", [list(units)]);
  }

  // ------------------------------------------------------------------ spatial structure

  /** IfcProject: IfcRoot's four, ObjectType, LongName, Phase, RepresentationContexts, UnitsInContext. */
  project(guid: string, name: string, contexts: readonly Context[], units: Ref<"IFCUNITASSIGNMENT">): Ref<"IFCPROJECT"> {
    return this.file.add("IFCPROJECT", [...rooted(guid, name), UNSET, UNSET, UNSET, list(contexts), units]);
  }

  /** IfcSite: IfcProduct's seven, LongName, CompositionType, RefLatitude, RefLongitude, RefElevation, LandTitleNumber, SiteAddress. */
  site(guid: string, name: string, placement: LocalPlacement): Ref<"IFCSITE"> {
    return this.file.add("IFCSITE", [...rooted(guid, name), ...product(undefined, placement, null), UNSET, enumv("ELEMENT"), UNSET, UNSET, UNSET, UNSET, UNSET]);
  }

  /** IfcBuilding: IfcProduct's seven, LongName, CompositionType, ElevationOfRefHeight, ElevationOfTerrain, BuildingAddress. */
  building(guid: string, name: string, placement: LocalPlacement): Ref<"IFCBUILDING"> {
    return this.file.add("IFCBUILDING", [...rooted(guid, name), ...product(undefined, placement, null), UNSET, enumv("ELEMENT"), UNSET, UNSET, UNSET]);
  }

  /** IfcBuildingStorey: IfcProduct's seven, LongName, CompositionType, Elevation. */
  storey(guid: string, name: string, placement: LocalPlacement, elevation: number): Ref<"IFCBUILDINGSTOREY"> {
    return this.file.add("IFCBUILDINGSTOREY", [...rooted(guid, name), ...product(undefined, placement, null), UNSET, enumv("ELEMENT"), real(elevation)]);
  }

  /** IfcSpace: IfcProduct's seven, LongName, CompositionType, PredefinedType, ElevationWithFlooring. */
  space(guid: string, name: string, longName: string, placement: LocalPlacement, shape: ProductShape, type = "SPACE"): Ref<"IFCSPACE"> {
    return this.file.add("IFCSPACE", [...rooted(guid, name), ...product(undefined, placement, shape), boundedText(longName, "LongName"), enumv("ELEMENT"), enumv(type), UNSET]);
  }

  // ------------------------------------------------------------------ elements

  /** IfcWall: IfcElement's eight, PredefinedType. */
  wall(e: ElementHead, type: string): Ref<"IFCWALL"> {
    return this.file.add("IFCWALL", [...elementHead(e), enumv(type)]);
  }

  /** IfcSlab: IfcElement's eight, PredefinedType. */
  slab(e: ElementHead, type: string): Ref<"IFCSLAB"> {
    return this.file.add("IFCSLAB", [...elementHead(e), enumv(type)]);
  }

  /** IfcOpeningElement: IfcElement's eight, PredefinedType. */
  opening(e: ElementHead): Ref<"IFCOPENINGELEMENT"> {
    return this.file.add("IFCOPENINGELEMENT", [...elementHead(e), enumv("OPENING")]);
  }

  /** IfcDoor: IfcElement's eight, OverallHeight, OverallWidth, PredefinedType, OperationType, UserDefinedOperationType. */
  /** `userDefined` names an operation IFC4 has no value for: OperationType is then USERDEFINED. */
  door(e: ElementHead, height: number, width: number, operation: string, userDefined?: string): Ref<"IFCDOOR"> {
    const op = userDefined === undefined ? enumv(operation) : enumv("USERDEFINED");
    return this.file.add("IFCDOOR", [...elementHead(e), positiveLength(height, "OverallHeight"), positiveLength(width, "OverallWidth"), enumv("DOOR"), op, opt(userDefined, (u) => boundedText(u, "UserDefinedOperationType"))]);
  }

  /** IfcWindow: IfcElement's eight, OverallHeight, OverallWidth, PredefinedType, PartitioningType, UserDefinedPartitioningType. */
  window(e: ElementHead, height: number, width: number): Ref<"IFCWINDOW"> {
    return this.file.add("IFCWINDOW", [...elementHead(e), positiveLength(height, "OverallHeight"), positiveLength(width, "OverallWidth"), enumv("WINDOW"), enumv("SINGLE_PANEL"), UNSET]);
  }

  /** IfcStair: IfcElement's eight, PredefinedType. */
  stair(e: ElementHead, type: string): Ref<"IFCSTAIR"> {
    return this.file.add("IFCSTAIR", [...elementHead(e), enumv(type)]);
  }

  /** IfcStairFlight: IfcElement's eight, NumberOfRisers, NumberOfTreads, RiserHeight, TreadLength, PredefinedType. */
  stairFlight(e: ElementHead, risers: number, treads: number, riserHeight: number, treadLength: number): Ref<"IFCSTAIRFLIGHT"> {
    return this.file.add("IFCSTAIRFLIGHT", [...elementHead(e), int(risers), int(treads), positiveLength(riserHeight, "RiserHeight"), positiveLength(treadLength, "TreadLength"), enumv("STRAIGHT")]);
  }

  /** IfcCovering: IfcElement's eight, PredefinedType. */
  covering(e: ElementHead, type: string): Ref<"IFCCOVERING"> {
    return this.file.add("IFCCOVERING", [...elementHead(e), enumv(type)]);
  }

  /** IfcFurniture: IfcElement's eight, PredefinedType. */
  column(e: ElementHead, type: string): Ref<"IFCCOLUMN"> {
    return this.file.add("IFCCOLUMN", [...elementHead(e), enumv(type)]);
  }
  furniture(e: ElementHead, type: string): Ref<"IFCFURNITURE"> {
    return this.file.add("IFCFURNITURE", [...elementHead(e), enumv(type)]);
  }

  // ------------------------------------------------------------------ relationships (IfcRoot's four, then their own two)

  /** IfcRelAggregates: RelatingObject, RelatedObjects. */
  aggregates(guid: string, whole: Ref, parts: readonly Ref[]): void {
    this.file.add("IFCRELAGGREGATES", [...rooted(guid, undefined), whole, list(parts)]);
  }

  /** IfcRelContainedInSpatialStructure: RelatedElements, RelatingStructure. */
  contains(guid: string, structure: Ref, elements: readonly Ref[]): void {
    this.file.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [...rooted(guid, undefined), list(elements), structure]);
  }

  /** IfcRelVoidsElement: RelatingBuildingElement, RelatedOpeningElement. */
  voids(guid: string, element: Ref, opening: Ref<"IFCOPENINGELEMENT">): void {
    this.file.add("IFCRELVOIDSELEMENT", [...rooted(guid, undefined), element, opening]);
  }

  /** IfcRelFillsElement: RelatingOpeningElement, RelatedBuildingElement. */
  fills(guid: string, opening: Ref<"IFCOPENINGELEMENT">, element: Ref): void {
    this.file.add("IFCRELFILLSELEMENT", [...rooted(guid, undefined), opening, element]);
  }

  /** IfcRelCoversSpaces: RelatingSpace, RelatedCoverings. */
  coversSpace(guid: string, space: Ref<"IFCSPACE">, coverings: readonly Ref<"IFCCOVERING">[]): void {
    this.file.add("IFCRELCOVERSSPACES", [...rooted(guid, undefined), space, list(coverings)]);
  }

  /** IfcRelAssociatesMaterial: RelatedObjects, RelatingMaterial. */
  associatesMaterial(guid: string, objects: readonly Ref[], material: Material | LayerSetUsage): void {
    this.file.add("IFCRELASSOCIATESMATERIAL", [...rooted(guid, undefined), list(objects), material]);
  }

  /** IfcRelDefinesByProperties: RelatedObjects, RelatingPropertyDefinition. */
  definesByProperties(guid: string, objects: readonly Ref[], definition: Ref<"IFCPROPERTYSET"> | Ref<"IFCELEMENTQUANTITY">): void {
    this.file.add("IFCRELDEFINESBYPROPERTIES", [...rooted(guid, undefined), list(objects), definition]);
  }

  // ------------------------------------------------------------------ properties and quantities

  /** IfcPropertySingleValue: Name, Description, NominalValue, Unit. */
  property(name: string, value: PropertyValue): Property {
    return this.file.add("IFCPROPERTYSINGLEVALUE", [boundedText(name, "Name"), UNSET, propertyValue(value), UNSET]);
  }

  /** IfcPropertySet: IfcRoot's four, HasProperties. */
  propertySet(guid: string, name: string, properties: readonly Property[]): Ref<"IFCPROPERTYSET"> {
    return this.file.add("IFCPROPERTYSET", [...rooted(guid, name), list(properties)]);
  }

  /** IfcQuantityLength / Area / Volume: Name, Description, Unit, the value, Formula. */
  quantity(kind: "length" | "area" | "volume", name: string, value: number): Quantity {
    const entity = kind === "length" ? "IFCQUANTITYLENGTH" : kind === "area" ? "IFCQUANTITYAREA" : "IFCQUANTITYVOLUME";
    return this.file.add(entity, [boundedText(name, "Name"), UNSET, UNSET, real(value), UNSET]) as Quantity;
  }

  /** IfcElementQuantity: IfcRoot's four, MethodOfMeasurement, Quantities. */
  elementQuantity(guid: string, name: string, quantities: readonly Quantity[]): Ref<"IFCELEMENTQUANTITY"> {
    return this.file.add("IFCELEMENTQUANTITY", [...rooted(guid, name), UNSET, list(quantities)]);
  }

  // ------------------------------------------------------------------ materials

  /** IfcMaterial: Name, Description, Category. */
  material(name: string, category: string): Material {
    return this.file.add("IFCMATERIAL", [boundedText(name, "Name"), UNSET, boundedText(category, "Category")]);
  }

  /**
   * A single-layer wall build-up `thickness` deep, centred on the wall's axis: IfcMaterialLayer
   * (Material, LayerThickness, IsVentilated, Name, Description, Category, Priority),
   * IfcMaterialLayerSet (MaterialLayers, LayerSetName, Description) and IfcMaterialLayerSetUsage
   * (ForLayerSet, LayerSetDirection, DirectionSense, OffsetFromReferenceLine, ReferenceExtent).
   */
  layerSetUsage(material: Material, thickness: number, setName: string): LayerSetUsage {
    const layer = this.file.add("IFCMATERIALLAYER", [material, positiveLength(thickness, "LayerThickness"), UNSET, UNSET, UNSET, UNSET, UNSET]);
    const set = this.file.add("IFCMATERIALLAYERSET", [list([layer]), boundedText(setName, "LayerSetName"), UNSET]);
    return this.file.add("IFCMATERIALLAYERSETUSAGE", [set, enumv("AXIS2"), enumv("POSITIVE"), real(-thickness / 2), UNSET]);
  }
}
