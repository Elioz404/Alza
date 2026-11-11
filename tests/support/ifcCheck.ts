/**
 * An IFC4 checker for the tests, written apart from the exporter so it can catch it out: its
 * own STEP (ISO 10303-21) reader and its own table of the IFC4 entities the export may write.
 * Nothing here is imported from src/export/ifc.
 *
 * The attribute lists are IFC4 ADD2 TC1's, read off each entity's "Attribute inheritance"
 * table (https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/ + the path noted
 * on each row), inherited attributes first, as STEP writes them. A name ending in "?" is
 * OPTIONAL; one starting with "*" is redeclared DERIVE by the entity, so STEP writes `*` there;
 * after a ":", the entities an entity-valued attribute may refer to.
 */

/** A value as the file wrote it. */
export type StepValue =
  | { t: "ref"; id: number }
  | { t: "str"; v: string }
  | { t: "real"; v: number }
  | { t: "int"; v: number }
  | { t: "enum"; v: string }
  | { t: "unset" }
  | { t: "derived" }
  | { t: "list"; items: StepValue[] }
  | { t: "typed"; type: string; value: StepValue };

export interface StepEntity {
  id: number;
  type: string;
  attrs: StepValue[];
}

export interface StepFileRead {
  header: { description: string[]; fileName: string; timeStamp: string; schemas: string[] };
  entities: Map<number, StepEntity>;
}

// Entity-valued attributes name the entities IFC4 lets them refer to after a ":" (the
// attribute's type, or the SELECT / supertype it is declared as, spelled out as the concrete
// entities that belong to it); a list attribute's members must each be one of them.
const PLACEMENTS = "IFCLOCALPLACEMENT|IFCGRIDPLACEMENT";
const AXIS2 = "IFCAXIS2PLACEMENT2D|IFCAXIS2PLACEMENT3D";
const CONTEXTS = "IFCGEOMETRICREPRESENTATIONCONTEXT|IFCGEOMETRICREPRESENTATIONSUBCONTEXT";
const UNITS = "IFCSIUNIT|IFCDERIVEDUNIT|IFCCONVERSIONBASEDUNIT|IFCCONTEXTDEPENDENTUNIT|IFCMONETARYUNIT";
const NAMED_UNITS = "IFCSIUNIT|IFCCONVERSIONBASEDUNIT|IFCCONTEXTDEPENDENTUNIT";
const PROFILES = "IFCRECTANGLEPROFILEDEF|IFCARBITRARYCLOSEDPROFILEDEF|IFCARBITRARYPROFILEDEFWITHVOIDS|IFCCIRCLEPROFILEDEF";
const CURVES = "IFCPOLYLINE|IFCINDEXEDPOLYCURVE|IFCCOMPOSITECURVE|IFCTRIMMEDCURVE|IFCBSPLINECURVEWITHKNOTS";
const ITEMS = `IFCEXTRUDEDAREASOLID|IFCREVOLVEDAREASOLID|IFCBOOLEANRESULT|IFCBOOLEANCLIPPINGRESULT|IFCFACETEDBREP|IFCMAPPEDITEM|${CURVES}`;
/** IfcSpatialElement */
const SPATIAL_TYPES = "IFCSITE|IFCBUILDING|IFCBUILDINGSTOREY|IFCSPACE";
/** IfcElement */
const ELEMENT_TYPES = "IFCWALL|IFCSLAB|IFCDOOR|IFCWINDOW|IFCSTAIR|IFCSTAIRFLIGHT|IFCFURNITURE|IFCCOVERING|IFCOPENINGELEMENT";
/** IfcProduct */
const PRODUCTS = `${SPATIAL_TYPES}|${ELEMENT_TYPES}`;
/** IfcObjectDefinition */
const OBJECTS = `IFCPROJECT|${PRODUCTS}`;
const MATERIALS = "IFCMATERIAL|IFCMATERIALLIST|IFCMATERIALLAYER|IFCMATERIALLAYERSET|IFCMATERIALLAYERSETUSAGE|IFCMATERIALPROFILESET|IFCMATERIALPROFILESETUSAGE|IFCMATERIALCONSTITUENTSET";
const PROPERTIES = "IFCPROPERTYSINGLEVALUE|IFCPROPERTYENUMERATEDVALUE|IFCPROPERTYLISTVALUE|IFCPROPERTYBOUNDEDVALUE|IFCPROPERTYTABLEVALUE|IFCPROPERTYREFERENCEVALUE|IFCCOMPLEXPROPERTY";
const QUANTITIES = "IFCQUANTITYLENGTH|IFCQUANTITYAREA|IFCQUANTITYVOLUME|IFCQUANTITYCOUNT|IFCQUANTITYWEIGHT|IFCQUANTITYTIME";

const ROOT = ["GlobalId", "OwnerHistory?:IFCOWNERHISTORY", "Name?", "Description?"];
const PRODUCT = [...ROOT, "ObjectType?", `ObjectPlacement?:${PLACEMENTS}`, "Representation?:IFCPRODUCTDEFINITIONSHAPE"];
const ELEMENT = [...PRODUCT, "Tag?"];
const SPATIAL = [...PRODUCT, "LongName?", "CompositionType?"];

/** Every entity the export may write, with its attributes in order (see the file comment). */
export const IFC4_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  // schema/ifcgeometryresource/lexical/ifccartesianpoint.htm
  IFCCARTESIANPOINT: ["Coordinates"],
  // schema/ifcgeometryresource/lexical/ifcdirection.htm
  IFCDIRECTION: ["DirectionRatios"],
  // schema/ifcgeometryresource/lexical/ifcaxis2placement3d.htm
  IFCAXIS2PLACEMENT3D: ["Location:IFCCARTESIANPOINT", "Axis?:IFCDIRECTION", "RefDirection?:IFCDIRECTION"],
  // schema/ifcgeometryresource/lexical/ifcaxis2placement2d.htm
  IFCAXIS2PLACEMENT2D: ["Location:IFCCARTESIANPOINT", "RefDirection?:IFCDIRECTION"],
  // schema/ifcgeometryresource/lexical/ifcpolyline.htm
  IFCPOLYLINE: ["Points:IFCCARTESIANPOINT"],
  // schema/ifcgeometryresource/lexical/ifccartesianpointlist2d.htm
  IFCCARTESIANPOINTLIST2D: ["CoordList"],
  // schema/ifcgeometryresource/lexical/ifcindexedpolycurve.htm (Segments: IfcSegmentIndexSelect, IfcLineIndex or IfcArcIndex)
  IFCINDEXEDPOLYCURVE: ["Points:IFCCARTESIANPOINTLIST2D|IFCCARTESIANPOINTLIST3D", "Segments?", "SelfIntersect?"],
  // schema/ifcgeometricconstraintresource/lexical/ifclocalplacement.htm
  IFCLOCALPLACEMENT: [`PlacementRelTo?:${PLACEMENTS}`, `RelativePlacement:${AXIS2}`],
  // schema/ifcprofileresource/lexical/ifcrectangleprofiledef.htm
  IFCRECTANGLEPROFILEDEF: ["ProfileType", "ProfileName?", "Position?:IFCAXIS2PLACEMENT2D", "XDim", "YDim"],
  // schema/ifcprofileresource/lexical/ifcarbitraryclosedprofiledef.htm
  IFCARBITRARYCLOSEDPROFILEDEF: ["ProfileType", "ProfileName?", `OuterCurve:${CURVES}`],
  // schema/ifcgeometricmodelresource/lexical/ifcextrudedareasolid.htm
  IFCEXTRUDEDAREASOLID: [`SweptArea:${PROFILES}`, "Position?:IFCAXIS2PLACEMENT3D", "ExtrudedDirection:IFCDIRECTION", "Depth"],
  // schema/ifcrepresentationresource/lexical/ifcgeometricrepresentationcontext.htm
  IFCGEOMETRICREPRESENTATIONCONTEXT: ["ContextIdentifier?", "ContextType?", "CoordinateSpaceDimension", "Precision?", `WorldCoordinateSystem:${AXIS2}`, "TrueNorth?:IFCDIRECTION"],
  // schema/ifcrepresentationresource/lexical/ifcgeometricrepresentationsubcontext.htm
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: [
    "ContextIdentifier?",
    "ContextType?",
    "*CoordinateSpaceDimension",
    "*Precision",
    "*WorldCoordinateSystem",
    "*TrueNorth",
    "ParentContext:IFCGEOMETRICREPRESENTATIONCONTEXT",
    "TargetScale?",
    "TargetView",
    "UserDefinedTargetView?",
  ],
  // schema/ifcrepresentationresource/lexical/ifcshaperepresentation.htm
  IFCSHAPEREPRESENTATION: [`ContextOfItems:${CONTEXTS}`, "RepresentationIdentifier?", "RepresentationType?", `Items:${ITEMS}`],
  // schema/ifcrepresentationresource/lexical/ifcproductdefinitionshape.htm
  IFCPRODUCTDEFINITIONSHAPE: ["Name?", "Description?", "Representations:IFCSHAPEREPRESENTATION|IFCTOPOLOGYREPRESENTATION"],
  // schema/ifcmeasureresource/lexical/ifcsiunit.htm
  IFCSIUNIT: ["*Dimensions", "UnitType", "Prefix?", "Name"],
  // schema/ifcmeasureresource/lexical/ifcunitassignment.htm
  IFCUNITASSIGNMENT: [`Units:${UNITS}`],
  // schema/ifckernel/lexical/ifcproject.htm
  IFCPROJECT: [...ROOT, "ObjectType?", "LongName?", "Phase?", `RepresentationContexts?:${CONTEXTS}`, "UnitsInContext?:IFCUNITASSIGNMENT"],
  // schema/ifcproductextension/lexical/ifcsite.htm
  IFCSITE: [...SPATIAL, "RefLatitude?", "RefLongitude?", "RefElevation?", "LandTitleNumber?", "SiteAddress?:IFCPOSTALADDRESS"],
  // schema/ifcproductextension/lexical/ifcbuilding.htm
  IFCBUILDING: [...SPATIAL, "ElevationOfRefHeight?", "ElevationOfTerrain?", "BuildingAddress?:IFCPOSTALADDRESS"],
  // schema/ifcproductextension/lexical/ifcbuildingstorey.htm
  IFCBUILDINGSTOREY: [...SPATIAL, "Elevation?"],
  // schema/ifcproductextension/lexical/ifcspace.htm
  IFCSPACE: [...SPATIAL, "PredefinedType?", "ElevationWithFlooring?"],
  // schema/ifcsharedbldgelements/lexical/ifcwall.htm
  IFCWALL: [...ELEMENT, "PredefinedType?"],
  // schema/ifcsharedbldgelements/lexical/ifcslab.htm
  IFCSLAB: [...ELEMENT, "PredefinedType?"],
  // schema/ifcsharedbldgelements/lexical/ifccovering.htm
  IFCCOVERING: [...ELEMENT, "PredefinedType?"],
  // schema/ifcproductextension/lexical/ifcopeningelement.htm
  IFCOPENINGELEMENT: [...ELEMENT, "PredefinedType?"],
  // schema/ifcsharedbldgelements/lexical/ifcdoor.htm
  IFCDOOR: [...ELEMENT, "OverallHeight?", "OverallWidth?", "PredefinedType?", "OperationType?", "UserDefinedOperationType?"],
  // schema/ifcsharedbldgelements/lexical/ifcwindow.htm
  IFCWINDOW: [...ELEMENT, "OverallHeight?", "OverallWidth?", "PredefinedType?", "PartitioningType?", "UserDefinedPartitioningType?"],
  // schema/ifcsharedbldgelements/lexical/ifcstair.htm
  IFCSTAIR: [...ELEMENT, "PredefinedType?"],
  // schema/ifcsharedbldgelements/lexical/ifcstairflight.htm
  IFCSTAIRFLIGHT: [...ELEMENT, "NumberOfRisers?", "NumberOfTreads?", "RiserHeight?", "TreadLength?", "PredefinedType?"],
  // schema/ifcsharedfacilitieselements/lexical/ifcfurniture.htm
  IFCFURNITURE: [...ELEMENT, "PredefinedType?"],
  // schema/ifckernel/lexical/ifcrelaggregates.htm
  IFCRELAGGREGATES: [...ROOT, `RelatingObject:${OBJECTS}`, `RelatedObjects:${OBJECTS}`],
  // schema/ifcproductextension/lexical/ifcrelcontainedinspatialstructure.htm
  IFCRELCONTAINEDINSPATIALSTRUCTURE: [...ROOT, `RelatedElements:${PRODUCTS}`, `RelatingStructure:${SPATIAL_TYPES}`],
  // schema/ifcproductextension/lexical/ifcrelvoidselement.htm
  IFCRELVOIDSELEMENT: [...ROOT, `RelatingBuildingElement:${ELEMENT_TYPES}`, "RelatedOpeningElement:IFCOPENINGELEMENT|IFCVOIDINGFEATURE"],
  // schema/ifcproductextension/lexical/ifcrelfillselement.htm
  IFCRELFILLSELEMENT: [...ROOT, "RelatingOpeningElement:IFCOPENINGELEMENT", `RelatedBuildingElement:${ELEMENT_TYPES}`],
  // schema/ifcproductextension/lexical/ifcrelcoversspaces.htm
  IFCRELCOVERSSPACES: [...ROOT, "RelatingSpace:IFCSPACE", "RelatedCoverings:IFCCOVERING"],
  // schema/ifckernel/lexical/ifcrelassociatesmaterial.htm
  IFCRELASSOCIATESMATERIAL: [...ROOT, `RelatedObjects:${OBJECTS}`, `RelatingMaterial:${MATERIALS}`],
  // schema/ifckernel/lexical/ifcreldefinesbyproperties.htm
  IFCRELDEFINESBYPROPERTIES: [...ROOT, `RelatedObjects:${OBJECTS}`, "RelatingPropertyDefinition:IFCPROPERTYSET|IFCELEMENTQUANTITY"],
  // schema/ifckernel/lexical/ifcpropertyset.htm
  IFCPROPERTYSET: [...ROOT, `HasProperties:${PROPERTIES}`],
  // schema/ifcproductextension/lexical/ifcelementquantity.htm
  IFCELEMENTQUANTITY: [...ROOT, "MethodOfMeasurement?", `Quantities:${QUANTITIES}`],
  // schema/ifcpropertyresource/lexical/ifcpropertysinglevalue.htm
  IFCPROPERTYSINGLEVALUE: ["Name", "Description?", "NominalValue?", `Unit?:${UNITS}`],
  // schema/ifcquantityresource/lexical/ifcquantitylength.htm (and …area.htm, …volume.htm)
  IFCQUANTITYLENGTH: ["Name", "Description?", `Unit?:${NAMED_UNITS}`, "LengthValue", "Formula?"],
  IFCQUANTITYAREA: ["Name", "Description?", `Unit?:${NAMED_UNITS}`, "AreaValue", "Formula?"],
  IFCQUANTITYVOLUME: ["Name", "Description?", `Unit?:${NAMED_UNITS}`, "VolumeValue", "Formula?"],
  // schema/ifcmaterialresource/lexical/ifcmaterial.htm
  IFCMATERIAL: ["Name", "Description?", "Category?"],
  // schema/ifcmaterialresource/lexical/ifcmateriallayer.htm
  IFCMATERIALLAYER: ["Material?:IFCMATERIAL", "LayerThickness", "IsVentilated?", "Name?", "Description?", "Category?", "Priority?"],
  // schema/ifcmaterialresource/lexical/ifcmateriallayerset.htm
  IFCMATERIALLAYERSET: ["MaterialLayers:IFCMATERIALLAYER", "LayerSetName?", "Description?"],
  // schema/ifcmaterialresource/lexical/ifcmateriallayersetusage.htm
  IFCMATERIALLAYERSETUSAGE: ["ForLayerSet:IFCMATERIALLAYERSET", "LayerSetDirection", "DirectionSense", "OffsetFromReferenceLine", "ReferenceExtent?"],
};

/** One attribute of an IFC4_ATTRIBUTES row, read. */
interface AttributeSpec {
  name: string;
  optional: boolean;
  derived: boolean;
  /** the entities a reference in it may point at; undefined for an attribute that holds no reference */
  refersTo?: ReadonlySet<string>;
}
const readSpec = (a: string): AttributeSpec => {
  const [head, types] = a.split(":");
  return {
    name: head.replace(/^\*/, "").replace(/\?$/, ""),
    optional: head.endsWith("?"),
    derived: head.startsWith("*"),
    refersTo: types ? new Set(types.split("|")) : undefined,
  };
};
const SPECS: Readonly<Record<string, readonly AttributeSpec[]>> = Object.fromEntries(Object.entries(IFC4_ATTRIBUTES).map(([type, attrs]) => [type, attrs.map(readSpec)]));

/**
 * Attributes typed IfcLabel or IfcIdentifier (STRING(255)) in the entities above; IfcText ones
 * (Description) have no limit. Typed values IFCLABEL(…) and IFCIDENTIFIER(…) are held to it too.
 */
const LABELS = new Set(["Name", "ObjectType", "Tag", "LongName", "Phase", "ContextIdentifier", "ContextType", "RepresentationIdentifier", "RepresentationType", "ProfileName", "Category", "LayerSetName", "LandTitleNumber", "MethodOfMeasurement"]);
const LABEL_MAX = 255;
/**
 * The property and quantity sets IFC4 defines that the export may write. The "Pset_" and "Qto_"
 * prefixes are buildingSMART's: a set named with one must be one of these, and a set of the
 * application's own must take neither.
 */
const STANDARD_SETS = new Set([
  "Pset_WallCommon",
  "Pset_SpaceCommon",
  "Pset_SlabCommon",
  "Pset_StairCommon",
  "Pset_CoveringCommon",
  "Pset_DoorCommon",
  "Pset_WindowCommon",
  "Qto_WallBaseQuantities",
  "Qto_SpaceBaseQuantities",
  "Qto_SlabBaseQuantities",
  "Qto_CoveringBaseQuantities",
  "Qto_DoorBaseQuantities",
  "Qto_WindowBaseQuantities",
]);

/** The enumeration values IFC4 allows for the enumerated attributes the export writes, by entity and attribute. */
const ENUMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  IFCWALL: { PredefinedType: ["MOVABLE", "PARAPET", "PARTITIONING", "PLUMBINGWALL", "SHEAR", "SOLIDWALL", "STANDARD", "POLYGONAL", "ELEMENTEDWALL", "USERDEFINED", "NOTDEFINED"] },
  IFCSLAB: { PredefinedType: ["FLOOR", "ROOF", "LANDING", "BASESLAB", "USERDEFINED", "NOTDEFINED"] },
  IFCCOVERING: {
    PredefinedType: ["CEILING", "FLOORING", "CLADDING", "ROOFING", "MOLDING", "SKIRTINGBOARD", "INSULATION", "MEMBRANE", "SLEEVING", "WRAPPING", "USERDEFINED", "NOTDEFINED"],
  },
  IFCOPENINGELEMENT: { PredefinedType: ["OPENING", "RECESS", "USERDEFINED", "NOTDEFINED"] },
  IFCDOOR: {
    PredefinedType: ["DOOR", "GATE", "TRAPDOOR", "USERDEFINED", "NOTDEFINED"],
    OperationType: [
      "SINGLE_SWING_LEFT", "SINGLE_SWING_RIGHT", "DOUBLE_DOOR_SINGLE_SWING", "DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT",
      "DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT", "DOUBLE_SWING_LEFT", "DOUBLE_SWING_RIGHT", "DOUBLE_DOOR_DOUBLE_SWING",
      "SLIDING_TO_LEFT", "SLIDING_TO_RIGHT", "DOUBLE_DOOR_SLIDING", "FOLDING_TO_LEFT", "FOLDING_TO_RIGHT", "DOUBLE_DOOR_FOLDING",
      "REVOLVING", "ROLLINGUP", "SWING_FIXED_LEFT", "SWING_FIXED_RIGHT", "USERDEFINED", "NOTDEFINED",
    ],
  },
  IFCWINDOW: {
    PredefinedType: ["WINDOW", "SKYLIGHT", "LIGHTDOME", "USERDEFINED", "NOTDEFINED"],
    PartitioningType: ["SINGLE_PANEL", "DOUBLE_PANEL_VERTICAL", "DOUBLE_PANEL_HORIZONTAL", "TRIPLE_PANEL_VERTICAL", "TRIPLE_PANEL_BOTTOM", "TRIPLE_PANEL_TOP", "TRIPLE_PANEL_LEFT", "TRIPLE_PANEL_RIGHT", "TRIPLE_PANEL_HORIZONTAL", "USERDEFINED", "NOTDEFINED"],
  },
  IFCSTAIR: {
    PredefinedType: [
      "STRAIGHT_RUN_STAIR", "TWO_STRAIGHT_RUN_STAIR", "QUARTER_WINDING_STAIR", "QUARTER_TURN_STAIR", "HALF_WINDING_STAIR", "HALF_TURN_STAIR",
      "TWO_QUARTER_WINDING_STAIR", "TWO_QUARTER_TURN_STAIR", "THREE_QUARTER_WINDING_STAIR", "THREE_QUARTER_TURN_STAIR", "SPIRAL_STAIR",
      "DOUBLE_RETURN_STAIR", "CURVED_RUN_STAIR", "TWO_CURVED_RUN_STAIR", "USERDEFINED", "NOTDEFINED",
    ],
  },
  IFCSTAIRFLIGHT: { PredefinedType: ["STRAIGHT", "WINDER", "SPIRAL", "CURVED", "FREEFORM", "USERDEFINED", "NOTDEFINED"] },
  IFCFURNITURE: { PredefinedType: ["CHAIR", "TABLE", "DESK", "BED", "FILECABINET", "SHELF", "SOFA", "USERDEFINED", "NOTDEFINED"] },
  IFCSPACE: { CompositionType: ["COMPLEX", "ELEMENT", "PARTIAL"], PredefinedType: ["SPACE", "PARKING", "GFA", "INTERNAL", "EXTERNAL", "USERDEFINED", "NOTDEFINED"] },
  IFCSITE: { CompositionType: ["COMPLEX", "ELEMENT", "PARTIAL"] },
  IFCBUILDING: { CompositionType: ["COMPLEX", "ELEMENT", "PARTIAL"] },
  IFCBUILDINGSTOREY: { CompositionType: ["COMPLEX", "ELEMENT", "PARTIAL"] },
  IFCRECTANGLEPROFILEDEF: { ProfileType: ["CURVE", "AREA"] },
  IFCARBITRARYCLOSEDPROFILEDEF: { ProfileType: ["CURVE", "AREA"] },
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: { TargetView: ["ELEVATION_VIEW", "GRAPH_VIEW", "MODEL_VIEW", "PLAN_VIEW", "REFLECTED_PLAN_VIEW", "SECTION_VIEW", "SKETCH_VIEW", "USERDEFINED", "NOTDEFINED"] },
  IFCSIUNIT: {
    UnitType: ["AREAUNIT", "LENGTHUNIT", "PLANEANGLEUNIT", "VOLUMEUNIT"],
    Name: ["METRE", "SQUARE_METRE", "CUBIC_METRE", "RADIAN"],
  },
  IFCMATERIALLAYERSETUSAGE: { LayerSetDirection: ["AXIS1", "AXIS2", "AXIS3"], DirectionSense: ["POSITIVE", "NEGATIVE"] },
};

/** Attributes that are REAL (a decimal point required) or INTEGER (none allowed), by entity; "[]" marks a list of them. */
const NUMBERS: Readonly<Record<string, Readonly<Record<string, "real" | "int" | "real[]">>>> = {
  IFCCARTESIANPOINT: { Coordinates: "real[]" },
  IFCDIRECTION: { DirectionRatios: "real[]" },
  IFCRECTANGLEPROFILEDEF: { XDim: "real", YDim: "real" },
  IFCEXTRUDEDAREASOLID: { Depth: "real" },
  IFCGEOMETRICREPRESENTATIONCONTEXT: { CoordinateSpaceDimension: "int", Precision: "real" },
  IFCBUILDINGSTOREY: { Elevation: "real" },
  IFCDOOR: { OverallHeight: "real", OverallWidth: "real" },
  IFCWINDOW: { OverallHeight: "real", OverallWidth: "real" },
  IFCSTAIRFLIGHT: { NumberOfRisers: "int", NumberOfTreads: "int", RiserHeight: "real", TreadLength: "real" },
  IFCQUANTITYLENGTH: { LengthValue: "real" },
  IFCQUANTITYAREA: { AreaValue: "real" },
  IFCQUANTITYVOLUME: { VolumeValue: "real" },
  IFCMATERIALLAYER: { LayerThickness: "real" },
  IFCMATERIALLAYERSETUSAGE: { OffsetFromReferenceLine: "real" },
};

/** Lengths that must be positive when set (IfcPositiveLengthMeasure); so must every typed IFCPOSITIVELENGTHMEASURE(…). */
const POSITIVE: Readonly<Record<string, readonly string[]>> = {
  IFCRECTANGLEPROFILEDEF: ["XDim", "YDim"],
  IFCEXTRUDEDAREASOLID: ["Depth"],
  IFCDOOR: ["OverallHeight", "OverallWidth"],
  IFCWINDOW: ["OverallHeight", "OverallWidth"],
  IFCSTAIRFLIGHT: ["RiserHeight", "TreadLength"],
};

/** Entities with a GlobalId (subtypes of IfcRoot). */
const ROOTED = new Set(Object.entries(SPECS).filter(([, attrs]) => attrs[0].name === "GlobalId").map(([name]) => name));
/** Elements that must stand in exactly one storey, directly or as a part of one that does. */
export const ELEMENTS = new Set(["IFCWALL", "IFCSLAB", "IFCCOVERING", "IFCDOOR", "IFCWINDOW", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCFURNITURE"]);
const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;

// ---------------------------------------------------------------------------- reader

class SyntaxError_ extends Error {}

/** Decode the inside of a STEP string, checking its escapes (ISO 10303-21, 7.3.3). */
export function decodeStepString(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) throw new SyntaxError_(`character U+${code.toString(16)} is not allowed unescaped in a string`);
    if (ch === "'") {
      if (raw[i + 1] !== "'") throw new SyntaxError_("a lone apostrophe inside a string");
      out += "'";
      i += 2;
    } else if (ch === "\\") {
      if (raw[i + 1] === "\\") {
        out += "\\";
        i += 2;
      } else if (raw.startsWith("\\X2\\", i) || raw.startsWith("\\X4\\", i)) {
        const width = raw[i + 2] === "2" ? 4 : 8;
        const end = raw.indexOf("\\X0\\", i + 4);
        if (end < 0) throw new SyntaxError_("an unterminated \\X2\\ or \\X4\\ group");
        const digits = raw.slice(i + 4, end);
        if (digits.length === 0 || digits.length % width !== 0 || !/^[0-9A-F]+$/.test(digits)) throw new SyntaxError_(`a malformed \\X${width / 2}\\ group "${digits}"`);
        for (let k = 0; k < digits.length; k += width) out += String.fromCodePoint(parseInt(digits.slice(k, k + width), 16));
        i = end + 4;
      } else if (raw.startsWith("\\X\\", i)) {
        const digits = raw.slice(i + 3, i + 5);
        if (!/^[0-9A-F]{2}$/.test(digits)) throw new SyntaxError_("a malformed \\X\\ escape");
        out += String.fromCharCode(parseInt(digits, 16));
        i += 5;
      } else {
        throw new SyntaxError_(`an unknown escape at "${raw.slice(i, i + 4)}"`);
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Read a parameter list starting at `text[pos]` === "(", returning the values and where it ended. */
function readList(text: string, start: number): [StepValue[], number] {
  if (text[start] !== "(") throw new SyntaxError_(`expected "(" at ${start}`);
  const items: StepValue[] = [];
  let pos = start + 1;
  const skip = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };
  skip();
  if (text[pos] === ")") return [items, pos + 1];
  for (;;) {
    skip();
    const [value, next] = readValue(text, pos);
    items.push(value);
    pos = next;
    skip();
    if (text[pos] === ",") {
      pos++;
      continue;
    }
    if (text[pos] === ")") return [items, pos + 1];
    throw new SyntaxError_(`expected "," or ")" at ${pos}, found "${text.slice(pos, pos + 10)}"`);
  }
}

function readValue(text: string, pos: number): [StepValue, number] {
  const ch = text[pos];
  if (ch === "$") return [{ t: "unset" }, pos + 1];
  if (ch === "*") return [{ t: "derived" }, pos + 1];
  if (ch === "(") {
    const [items, next] = readList(text, pos);
    return [{ t: "list", items }, next];
  }
  if (ch === "#") {
    const m = /^#(\d+)/.exec(text.slice(pos, pos + 20));
    if (!m) throw new SyntaxError_(`a malformed reference at ${pos}`);
    return [{ t: "ref", id: Number(m[1]) }, pos + m[0].length];
  }
  if (ch === "'") {
    let end = pos + 1;
    for (;;) {
      const q = text.indexOf("'", end);
      if (q < 0) throw new SyntaxError_("an unterminated string");
      if (text[q + 1] === "'") {
        end = q + 2;
        continue;
      }
      return [{ t: "str", v: decodeStepString(text.slice(pos + 1, q)) }, q + 1];
    }
  }
  if (ch === ".") {
    const m = /^\.([A-Z_][A-Z0-9_]*)\./.exec(text.slice(pos, pos + 80));
    if (!m) throw new SyntaxError_(`a malformed enumeration at ${pos}`);
    return [{ t: "enum", v: m[1] }, pos + m[0].length];
  }
  const num = /^[+-]?\d+(\.\d*(E[+-]?\d+)?)?/.exec(text.slice(pos, pos + 40));
  if (num && num[0].length > 0) {
    const token = num[0];
    return [token.includes(".") ? { t: "real", v: Number(token) } : { t: "int", v: Number(token) }, pos + token.length];
  }
  const typed = /^([A-Z][A-Z0-9_]*)\(/.exec(text.slice(pos, pos + 80));
  if (typed) {
    const [items, next] = readList(text, pos + typed[1].length);
    if (items.length !== 1) throw new SyntaxError_(`typed value ${typed[1]} must hold one value`);
    return [{ t: "typed", type: typed[1], value: items[0] }, next];
  }
  throw new SyntaxError_(`an unexpected "${text.slice(pos, pos + 10)}" at ${pos}`);
}

/** Read a whole STEP file. Throws on any syntax error. */
export function readStep(text: string): StepFileRead {
  const lines = text.split("\n");
  if (lines[0] !== "ISO-10303-21;") throw new SyntaxError_("the file does not start with ISO-10303-21;");
  if (!text.trimEnd().endsWith("END-ISO-10303-21;")) throw new SyntaxError_("the file does not end with END-ISO-10303-21;");
  const headerStart = text.indexOf("HEADER;");
  const dataStart = text.indexOf("\nDATA;\n");
  const headerEnd = text.indexOf("ENDSEC;", headerStart);
  if (headerStart < 0 || dataStart < 0 || headerEnd > dataStart) throw new SyntaxError_("the HEADER and DATA sections are missing or out of order");
  const dataEnd = text.lastIndexOf("\nENDSEC;");
  const headerText = text.slice(headerStart + "HEADER;".length, headerEnd);
  const header: Record<string, StepValue[]> = {};
  for (const m of headerText.matchAll(/(FILE_DESCRIPTION|FILE_NAME|FILE_SCHEMA)(\(.*\));/g)) header[m[1]] = readList(m[2], 0)[0];
  const strings = (v: StepValue | undefined): string[] => (v?.t === "list" ? v.items.map((i) => (i.t === "str" ? i.v : "")) : []);
  const string = (v: StepValue | undefined): string => (v?.t === "str" ? v.v : "");
  if (!header.FILE_DESCRIPTION || !header.FILE_NAME || !header.FILE_SCHEMA) throw new SyntaxError_("the header lacks FILE_DESCRIPTION, FILE_NAME or FILE_SCHEMA");
  if (header.FILE_DESCRIPTION.length !== 2 || header.FILE_NAME.length !== 7 || header.FILE_SCHEMA.length !== 1) throw new SyntaxError_("a header entity has the wrong number of attributes");

  const entities = new Map<number, StepEntity>();
  const data = text.slice(dataStart + "\nDATA;\n".length, dataEnd);
  let pos = 0;
  while (pos < data.length) {
    while (pos < data.length && /\s/.test(data[pos])) pos++;
    if (pos >= data.length) break;
    const head = /^#(\d+)=([A-Z][A-Z0-9_]*)/.exec(data.slice(pos, pos + 120));
    if (!head) throw new SyntaxError_(`expected an entity instance at "${data.slice(pos, pos + 30)}"`);
    const id = Number(head[1]);
    if (id <= 0) throw new SyntaxError_(`#${id} is not a positive id`);
    if (entities.has(id)) throw new SyntaxError_(`#${id} is defined twice`);
    const [attrs, next] = readList(data, pos + head[0].length);
    if (data[next] !== ";") throw new SyntaxError_(`#${id} is not closed by ";"`);
    entities.set(id, { id, type: head[2], attrs });
    pos = next + 1;
  }
  return {
    header: {
      description: strings(header.FILE_DESCRIPTION[0]),
      fileName: string(header.FILE_NAME[0]),
      timeStamp: string(header.FILE_NAME[1]),
      schemas: strings(header.FILE_SCHEMA[0]),
    },
    entities,
  };
}

// ---------------------------------------------------------------------------- checks

export interface IfcCheck {
  file: StepFileRead;
  errors: string[];
  /** entities by IFC type */
  byType: Map<string, StepEntity[]>;
  /** an entity's attribute by name */
  attr(e: StepEntity, name: string): StepValue;
  /** a reference attribute's target */
  deref(v: StepValue): StepEntity | undefined;
  /** the storey each element stands in (directly or as a part), by element id */
  storeyOf: Map<number, number>;
}

// ---------------------------------------------------------------------------- curves

/** An indexed curve's segments, as their kind and their 1-based point indices (unchecked). */
function segmentsOf(curve: StepEntity): { kind: string; indices: number[] }[] {
  const segs = curve.attrs[1];
  if (segs.t !== "list") return [];
  return segs.items.map((sg) => ({
    kind: sg.t === "typed" ? sg.type : "",
    indices: sg.t === "typed" && sg.value.t === "list" ? sg.value.items.map((i) => (i.t === "int" ? i.v : NaN)) : [],
  }));
}

/** A 2D point list's points. */
function pointsOf(file: StepFileRead, curve: StepEntity): [number, number][] {
  const list = curve.attrs[0].t === "ref" ? file.entities.get(curve.attrs[0].id) : undefined;
  const coords = list?.attrs[0];
  if (!coords || coords.t !== "list") return [];
  return coords.items.map((p) => (p.t === "list" ? [(p.items[0] as { v: number }).v, (p.items[1] as { v: number }).v] : [NaN, NaN]));
}

/** What is wrong with an indexed curve's segments, or null. */
function indexedCurveProblem(file: StepFileRead, curve: StepEntity): string | null {
  const pts = pointsOf(file, curve);
  const segs = segmentsOf(curve);
  if (segs.length === 0) return "an IfcIndexedPolyCurve without segments (the export always writes them)";
  let end: number | null = null;
  for (const sg of segs) {
    if (sg.kind !== "IFCLINEINDEX" && sg.kind !== "IFCARCINDEX") return `a segment ${sg.kind || "untyped"} is neither IFCLINEINDEX nor IFCARCINDEX`;
    if (sg.indices.some((i) => !Number.isInteger(i) || i < 1 || i > pts.length)) return `a segment indexes past the ${pts.length} points (${sg.indices.join(",")})`;
    if (sg.kind === "IFCARCINDEX" && sg.indices.length !== 3) return `an IFCARCINDEX of ${sg.indices.length} points, not 3`;
    if (sg.kind === "IFCLINEINDEX" && sg.indices.length < 2) return "an IFCLINEINDEX of fewer than 2 points";
    if (end !== null && sg.indices[0] !== end) return `a segment starts at point ${sg.indices[0]}, not where the last ended (${end})`;
    if (sg.kind === "IFCARCINDEX") {
      const [a, m, b] = sg.indices.map((i) => pts[i - 1]);
      const cross = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]);
      if (Math.abs(cross) < 1e-12) return `an arc through three points on one line (${sg.indices.join(",")})`;
    }
    end = sg.indices[sg.indices.length - 1];
  }
  return null;
}

/** The circle through three points: its centre and radius. */
function circleThrough(a: [number, number], m: [number, number], b: [number, number]): { cx: number; cy: number; r: number } {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const sq = (p: [number, number]) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
  const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/** The signed angle an arc from a through m to b turns, seen from its centre. */
function arcSweep(a: [number, number], m: [number, number], b: [number, number]): { cx: number; cy: number; r: number; start: number; sweep: number } {
  const c = circleThrough(a, m, b);
  const ang = (p: [number, number]) => Math.atan2(p[1] - c.cy, p[0] - c.cx);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const start = ang(a);
  const toM = norm(ang(m) - start);
  const toB = norm(ang(b) - start);
  // counter-clockwise from a, m comes before b; else the arc runs clockwise
  const sweep = toM < toB ? toB : toB - 2 * Math.PI;
  return { ...c, start, sweep };
}

/**
 * The points along a curve the export writes (an IfcPolyline, or an IfcIndexedPolyCurve, its
 * arcs cut every `step` radians or finer), in its own 2D frame, without repeating its first point
 * at its end: what the tests measure a profile or an axis by.
 */
export function curvePoints(check: Pick<IfcCheck, "file">, curve: StepEntity, step = Math.PI / 180): [number, number][] {
  const { file } = check;
  if (curve.type === "IFCPOLYLINE") {
    const pts = (curve.attrs[0] as { items: StepValue[] }).items.map((r) => {
      const p = file.entities.get((r as { id: number }).id)!;
      const c = p.attrs[0] as { items: { v: number }[] };
      return [c.items[0].v, c.items[1].v] as [number, number];
    });
    const [f0, l0] = [pts[0], pts[pts.length - 1]];
    return pts.length > 1 && f0[0] === l0[0] && f0[1] === l0[1] ? pts.slice(0, -1) : pts;
  }
  if (curve.type !== "IFCINDEXEDPOLYCURVE") throw new Error(`no points for a ${curve.type}`);
  const pts = pointsOf(file, curve);
  const out: [number, number][] = [];
  for (const sg of segmentsOf(curve)) {
    const idx = sg.indices.map((i) => pts[i - 1]);
    if (sg.kind === "IFCLINEINDEX") {
      for (const p of idx.slice(0, -1)) out.push(p);
      continue;
    }
    const { cx, cy, r, start, sweep } = arcSweep(idx[0], idx[1], idx[2]);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
    for (let k = 0; k < n; k++) {
      const phi = start + (sweep * k) / n;
      out.push([cx + r * Math.cos(phi), cy + r * Math.sin(phi)]);
    }
  }
  const last = segmentsOf(curve).at(-1);
  const end = last ? pts[last.indices[last.indices.length - 1] - 1] : undefined;
  if (end && out.length > 0 && Math.hypot(end[0] - out[0][0], end[1] - out[0][1]) > 1e-9) out.push(end);
  return out;
}

/**
 * A closed curve's area and a curve's length, exact for its arcs (each arc's circular segment
 * added to its chord's share of the polygon): what the tests compare with the plan's own.
 */
export function curveMeasure(check: Pick<IfcCheck, "file">, curve: StepEntity): { area: number; length: number } {
  const { file } = check;
  if (curve.type !== "IFCINDEXEDPOLYCURVE") {
    const pts = curvePoints(check, curve);
    let area = 0;
    let length = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      area += (p[0] * q[1] - q[0] * p[1]) / 2;
      length += Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    return { area: Math.abs(area), length };
  }
  const pts = pointsOf(file, curve);
  let area = 0;
  let length = 0;
  for (const sg of segmentsOf(curve)) {
    const idx = sg.indices.map((i) => pts[i - 1]);
    if (sg.kind === "IFCLINEINDEX") {
      for (let k = 0; k + 1 < idx.length; k++) {
        area += (idx[k][0] * idx[k + 1][1] - idx[k + 1][0] * idx[k][1]) / 2;
        length += Math.hypot(idx[k + 1][0] - idx[k][0], idx[k + 1][1] - idx[k][1]);
      }
      continue;
    }
    const [a, , b] = idx;
    const { r, sweep } = arcSweep(idx[0], idx[1], idx[2]);
    area += (a[0] * b[1] - b[0] * a[1]) / 2 + ((r * r) / 2) * (Math.abs(sweep) - Math.sin(Math.abs(sweep))) * Math.sign(sweep);
    length += r * Math.abs(sweep);
  }
  return { area: Math.abs(area), length };
}

const refsIn = (v: StepValue): number[] => (v.t === "ref" ? [v.id] : v.t === "list" ? v.items.flatMap(refsIn) : v.t === "typed" ? refsIn(v.value) : []);

/** Check a file the export wrote; `errors` is empty when it is a well-formed IFC4 model of the kind the export promises. */
export function checkIfc(text: string): IfcCheck {
  const file = readStep(text);
  const errors: string[] = [];
  const { entities } = file;
  const byType = new Map<string, StepEntity[]>();
  for (const e of entities.values()) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  const of = (type: string) => byType.get(type) ?? [];
  const attrIndex = (type: string, name: string) => (SPECS[type] ?? []).findIndex((a) => a.name === name);
  const attr = (e: StepEntity, name: string): StepValue => {
    const i = attrIndex(e.type, name);
    if (i < 0) throw new Error(`${e.type} has no attribute ${name}`);
    return e.attrs[i];
  };
  const deref = (v: StepValue) => (v.t === "ref" ? entities.get(v.id) : undefined);

  if (file.header.schemas.join() !== "IFC4") errors.push(`FILE_SCHEMA is (${file.header.schemas.join()}), not ('IFC4')`);
  if (!/^ViewDefinition \[[A-Za-z]+View(_V\d+\.\d+)?\]$/.test(file.header.description[0] ?? "")) errors.push(`FILE_DESCRIPTION names no view definition: ${file.header.description[0]}`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(file.header.timeStamp)) errors.push(`FILE_NAME's time stamp is not ISO 8601: ${file.header.timeStamp}`);

  // every instance: a known entity, the right number of attributes, required ones set, numbers
  // typed, labels in their length, references resolved and to the kind of entity IFC4 allows
  const guids = new Set<string>();
  const longLabels = (v: StepValue): boolean =>
    v.t === "typed" ? (["IFCLABEL", "IFCIDENTIFIER"].includes(v.type) && v.value.t === "str" && [...v.value.v].length > LABEL_MAX) || longLabels(v.value) : v.t === "list" && v.items.some(longLabels);
  for (const e of entities.values()) {
    const spec = SPECS[e.type];
    if (!spec) {
      errors.push(`#${e.id}: ${e.type} is not an entity the export may write`);
      continue;
    }
    if (e.attrs.length !== spec.length) {
      errors.push(`#${e.id}: ${e.type} has ${e.attrs.length} attributes, IFC4 has ${spec.length}`);
      continue;
    }
    spec.forEach((a, i) => {
      const v = e.attrs[i];
      const { name } = a;
      if (a.derived && v.t !== "derived") errors.push(`#${e.id}: ${e.type}.${name} is derived and must be *`);
      if (!a.derived && v.t === "derived") errors.push(`#${e.id}: ${e.type}.${name} is not derived, so it cannot be *`);
      if (!a.derived && !a.optional && v.t === "unset") errors.push(`#${e.id}: ${e.type}.${name} is required`);
      for (const r of refsIn(v)) {
        const target = entities.get(r);
        if (!target) continue;
        if (!a.refersTo) errors.push(`#${e.id}: ${e.type}.${name} holds a reference (#${r}), but it is no entity-valued attribute`);
        else if (!a.refersTo.has(target.type)) errors.push(`#${e.id}: ${e.type}.${name} refers to #${r}, a ${target.type}, which IFC4 does not allow there`);
      }
      if (LABELS.has(name) && v.t === "str" && [...v.v].length > LABEL_MAX) errors.push(`#${e.id}: ${e.type}.${name} is longer than STRING(${LABEL_MAX})`);
      if (longLabels(v)) errors.push(`#${e.id}: ${e.type}.${name} holds a label longer than STRING(${LABEL_MAX})`);
      const allowed = ENUMS[e.type]?.[name];
      if (allowed && v.t !== "unset" && (v.t !== "enum" || !allowed.includes(v.v))) errors.push(`#${e.id}: ${e.type}.${name} is ${JSON.stringify(v)}, not one of IFC4's values`);
      const number = NUMBERS[e.type]?.[name];
      if (number && v.t !== "unset") {
        const values = number === "real[]" ? (v.t === "list" ? v.items : [v]) : [v];
        const want = number === "int" ? "int" : "real";
        if (number === "real[]" && v.t !== "list") errors.push(`#${e.id}: ${e.type}.${name} must be a list`);
        for (const x of values) if (x.t !== want) errors.push(`#${e.id}: ${e.type}.${name} must be ${want === "real" ? "a REAL, written with a decimal point" : "an INTEGER"} (got ${x.t})`);
      }
      if ((POSITIVE[e.type] ?? []).includes(name) && v.t !== "unset" && !(v.t === "real" && v.v > 0)) errors.push(`#${e.id}: ${e.type}.${name} must be a positive length`);
      if (v.t === "typed" && v.type === "IFCPOSITIVELENGTHMEASURE" && !(v.value.t === "real" && v.value.v > 0)) errors.push(`#${e.id}: ${e.type}.${name} must be a positive length`);
    });
    for (const r of e.attrs.flatMap(refsIn)) if (!entities.has(r)) errors.push(`#${e.id}: ${e.type} refers to #${r}, which the file does not define`);
    if (ROOTED.has(e.type)) {
      const g = e.attrs[0];
      if (g.t !== "str" || !GUID.test(g.v)) errors.push(`#${e.id}: ${e.type} has an invalid GlobalId ${JSON.stringify(g)}`);
      else if (guids.has(g.v)) errors.push(`#${e.id}: GlobalId ${g.v} is used twice`);
      else guids.add(g.v);
    }
  }
  // indexed curves: two coordinates a point, segments of the right size indexing the point list,
  // each starting where the last ended, an arc through three points not on one line; a closed
  // profile's curve ends where it starts
  for (const list2d of of("IFCCARTESIANPOINTLIST2D")) {
    const coords = list2d.attrs[0];
    if (coords.t !== "list" || coords.items.length === 0) errors.push(`#${list2d.id}: IFCCARTESIANPOINTLIST2D.CoordList must be a list of points`);
    else
      for (const p of coords.items)
        if (p.t !== "list" || p.items.length !== 2 || p.items.some((x) => x.t !== "real")) errors.push(`#${list2d.id}: IFCCARTESIANPOINTLIST2D.CoordList holds a point that is not two REALs`);
  }
  for (const curve of of("IFCINDEXEDPOLYCURVE")) {
    const problem = indexedCurveProblem(file, curve);
    if (problem) errors.push(`#${curve.id}: ${problem}`);
  }
  for (const profile of of("IFCARBITRARYCLOSEDPROFILEDEF")) {
    const curve = entities.get((profile.attrs[2] as { id: number }).id);
    if (curve?.type === "IFCINDEXEDPOLYCURVE" && !indexedCurveProblem(file, curve)) {
      const segs = segmentsOf(curve);
      const first = segs[0].indices[0];
      const last = segs[segs.length - 1].indices[segs[segs.length - 1].indices.length - 1];
      if (first !== last) errors.push(`#${profile.id}: the closed profile's curve #${curve.id} ends at point ${last}, not where it starts (${first})`);
    }
  }
  if (errors.length > 0) return { file, errors, byType, attr, deref, storeyOf: new Map() };

  // project, units, contexts
  const projects = of("IFCPROJECT");
  if (projects.length !== 1) errors.push(`the file has ${projects.length} IfcProject, not one`);
  const project = projects[0];
  if (project) {
    const units = deref(attr(project, "UnitsInContext"));
    const unitList = units ? refsIn(attr(units, "Units")).map((id) => entities.get(id)!) : [];
    const unit = (type: string) => unitList.find((u) => u.type === "IFCSIUNIT" && (attr(u, "UnitType") as { v: string }).v === type);
    const named = (u: StepEntity | undefined) => (u ? (attr(u, "Name") as { v: string }).v : undefined);
    if (named(unit("LENGTHUNIT")) !== "METRE" || attr(unit("LENGTHUNIT")!, "Prefix").t !== "unset") errors.push("the length unit is not the metre");
    if (named(unit("PLANEANGLEUNIT")) !== "RADIAN") errors.push("the plane angle unit is not the radian");
    const contexts = refsIn(attr(project, "RepresentationContexts")).map((id) => entities.get(id)!);
    const contextTypes = contexts.map((c) => (attr(c, "ContextType") as { v: string }).v).sort();
    if (contextTypes.join() !== "Model,Plan") errors.push(`the project's contexts are ${contextTypes.join()}, not Model and Plan`);
  }
  for (const set of [...of("IFCPROPERTYSET"), ...of("IFCELEMENTQUANTITY")]) {
    const name = (attr(set, "Name") as { v?: string }).v ?? "";
    if (/^(Pset|Qto)_/.test(name) && !STANDARD_SETS.has(name)) errors.push(`#${set.id}: ${name} takes buildingSMART's prefix but is no IFC4 standard set`);
  }
  for (const rep of of("IFCSHAPEREPRESENTATION")) {
    const ctx = deref(attr(rep, "ContextOfItems"));
    if (!ctx || !ctx.type.startsWith("IFCGEOMETRICREPRESENTATION")) errors.push(`#${rep.id}: a shape representation outside any context`);
  }

  // spatial structure: project > site > building > storeys (> spaces), by aggregation
  const aggregatesOf = new Map<number, number[]>();
  const wholeOf = new Map<number, number[]>();
  for (const rel of of("IFCRELAGGREGATES")) {
    const whole = (attr(rel, "RelatingObject") as { id: number }).id;
    for (const part of refsIn(attr(rel, "RelatedObjects"))) {
      aggregatesOf.set(whole, [...(aggregatesOf.get(whole) ?? []), part]);
      wholeOf.set(part, [...(wholeOf.get(part) ?? []), whole]);
    }
  }
  const partsOfType = (whole: StepEntity | undefined, type: string) => (whole ? (aggregatesOf.get(whole.id) ?? []).map((id) => entities.get(id)!).filter((e) => e.type === type) : []);
  const sites = partsOfType(project, "IFCSITE");
  if (sites.length !== 1 || of("IFCSITE").length !== 1) errors.push("the project does not aggregate exactly one site");
  const buildings = partsOfType(sites[0], "IFCBUILDING");
  if (buildings.length !== 1 || of("IFCBUILDING").length !== 1) errors.push("the site does not aggregate exactly one building");
  const storeys = partsOfType(buildings[0], "IFCBUILDINGSTOREY");
  if (storeys.length !== of("IFCBUILDINGSTOREY").length || storeys.length === 0) errors.push("not every storey is aggregated by the building");
  for (const e of entities.values()) if ((wholeOf.get(e.id) ?? []).length > 1) errors.push(`#${e.id}: ${e.type} is a part of ${wholeOf.get(e.id)!.length} wholes`);
  for (const space of of("IFCSPACE")) {
    const whole = (wholeOf.get(space.id) ?? []).map((id) => entities.get(id)!);
    if (whole.length !== 1 || whole[0].type !== "IFCBUILDINGSTOREY") errors.push(`#${space.id}: the space is not aggregated under one storey`);
  }

  // containment: every element in exactly one storey, directly or as a part of an element that is
  const contained = new Map<number, number[]>();
  for (const rel of of("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const structure = deref(attr(rel, "RelatingStructure"));
    if (structure?.type !== "IFCBUILDINGSTOREY") errors.push(`#${rel.id}: elements are contained in a ${structure?.type}, not a storey`);
    for (const el of refsIn(attr(rel, "RelatedElements"))) contained.set(el, [...(contained.get(el) ?? []), structure!.id]);
  }
  const storeyOf = new Map<number, number>();
  for (const type of ELEMENTS) {
    for (const e of of(type)) {
      const direct = contained.get(e.id) ?? [];
      const wholes = (wholeOf.get(e.id) ?? []).map((id) => entities.get(id)!).filter((w) => ELEMENTS.has(w.type));
      const viaWhole = wholes.flatMap((w) => contained.get(w.id) ?? []);
      const all = [...direct, ...viaWhole];
      if (all.length !== 1) errors.push(`#${e.id}: ${e.type} stands in ${all.length} storeys, not one`);
      else storeyOf.set(e.id, all[0]);
      if (direct.length > 0 && wholes.length > 0) errors.push(`#${e.id}: ${e.type} is both contained and a part`);
    }
  }

  // openings: each voids one element and, in a wall, is filled by exactly one door or window
  const voids = new Map<number, number[]>();
  for (const rel of of("IFCRELVOIDSELEMENT")) {
    const opening = (attr(rel, "RelatedOpeningElement") as { id: number }).id;
    voids.set(opening, [...(voids.get(opening) ?? []), (attr(rel, "RelatingBuildingElement") as { id: number }).id]);
  }
  const fills = new Map<number, number[]>();
  const filled = new Map<number, number>();
  for (const rel of of("IFCRELFILLSELEMENT")) {
    const opening = (attr(rel, "RelatingOpeningElement") as { id: number }).id;
    const element = (attr(rel, "RelatedBuildingElement") as { id: number }).id;
    fills.set(opening, [...(fills.get(opening) ?? []), element]);
    filled.set(element, (filled.get(element) ?? 0) + 1);
  }
  for (const o of of("IFCOPENINGELEMENT")) {
    const hosts = voids.get(o.id) ?? [];
    if (hosts.length !== 1) {
      errors.push(`#${o.id}: the opening voids ${hosts.length} elements, not one`);
      continue;
    }
    const host = entities.get(hosts[0])!;
    const fillers = fills.get(o.id) ?? [];
    if (host.type === "IFCWALL" && fillers.length !== 1) errors.push(`#${o.id}: the opening in wall #${host.id} is filled ${fillers.length} times, not once`);
    if (host.type === "IFCSLAB" && fillers.length !== 0) errors.push(`#${o.id}: a stairwell is filled`);
    if (!["IFCWALL", "IFCSLAB"].includes(host.type)) errors.push(`#${o.id}: the opening voids a ${host.type}`);
    for (const f of fillers) if (!["IFCDOOR", "IFCWINDOW"].includes(entities.get(f)!.type)) errors.push(`#${o.id}: filled by a ${entities.get(f)!.type}`);
  }
  for (const type of ["IFCDOOR", "IFCWINDOW"]) for (const e of of(type)) if (filled.get(e.id) !== 1) errors.push(`#${e.id}: the ${type} fills ${filled.get(e.id) ?? 0} openings, not one`);

  // placements: each chains, through PlacementRelTo, to the placement of what it stands in
  const placementOf = (e: StepEntity) => (attr(e, "ObjectPlacement") as { t: string; id: number }).id;
  const chainReaches = (from: number, target: number): boolean => {
    const seen = new Set<number>();
    for (let p: number | undefined = from; p !== undefined; ) {
      if (seen.has(p)) return false;
      seen.add(p);
      if (p === target) return true;
      const lp = entities.get(p);
      if (lp?.type !== "IFCLOCALPLACEMENT") return false;
      const rel = attr(lp, "PlacementRelTo");
      p = rel.t === "ref" ? rel.id : undefined;
    }
    return false;
  };
  for (const [id, storey] of storeyOf) {
    const e = entities.get(id)!;
    if (attr(e, "ObjectPlacement").t !== "ref") errors.push(`#${id}: ${e.type} has no placement`);
    else if (!chainReaches(placementOf(e), placementOf(entities.get(storey)!))) errors.push(`#${id}: ${e.type}'s placement does not chain to its storey's`);
  }
  for (const o of of("IFCOPENINGELEMENT")) {
    const host = voids.get(o.id)?.[0];
    if (host !== undefined && !chainReaches(placementOf(o), placementOf(entities.get(host)!))) errors.push(`#${o.id}: the opening's placement does not chain to its host's`);
  }
  for (const space of of("IFCSPACE")) {
    const storey = wholeOf.get(space.id)?.[0];
    if (storey !== undefined && !chainReaches(placementOf(space), placementOf(entities.get(storey)!))) errors.push(`#${space.id}: the space's placement does not chain to its storey's`);
  }
  for (const storey of storeys) if (!chainReaches(placementOf(storey), placementOf(buildings[0]))) errors.push(`#${storey.id}: the storey's placement does not chain to the building's`);

  return { file, errors, byType, attr, deref, storeyOf };
}
