/**
 * The plan as an IFC4 building model: what each part of the plan becomes, and where.
 *
 *   plan                      → IfcProject (SI metres, radians; a 3D "Model" context with Body
 *                               and Axis subcontexts, a 2D "Plan" one with FootPrint)
 *                               > IfcSite > IfcBuilding (named after the plan)
 *   level                     → IfcBuildingStorey, at its elevation (IfcRelAggregates), standing
 *                               on one IfcSlab FLOOR: under its rooms and its walls to their joints
 *                               (model/floors.ts, the 3D view's own slab outline), opened by an
 *                               IfcOpeningElement for every stair rising through it from below
 *   wall                      → IfcWall STANDARD: an Axis line and a Body extruded from its
 *                               centreline, butt-jointed to the walls it meets (model/joints.ts:
 *                               one wall fills each corner, the others stop at its face, so no two
 *                               bodies overlap), with a one-layer IfcMaterialLayerSetUsage,
 *                               Pset_WallCommon (IsExternal, when the rooms tell) and
 *                               Qto_WallBaseQuantities
 *   door / window             → an IfcOpeningElement voiding its wall (IfcRelVoidsElement),
 *                               filled (IfcRelFillsElement) by an IfcDoor / IfcWindow; a door's
 *                               placement faces the way its leaf swings (see doorFacing)
 *   room                      → an IfcSpace (LongName = its label) aggregated under its storey,
 *                               with Pset_SpaceCommon and Qto_SpaceBaseQuantities; and its floor
 *                               finish as an IfcCovering FLOORING laid on the slab, covering the
 *                               space (IfcRelCoversSpaces), in its finish's material
 *   stair                     → IfcStair, aggregating its IfcStairFlights (one per flight, with
 *                               risers, treads, riser height and going) and, for an L-shaped one,
 *                               its landing as an IfcSlab LANDING; Pset_StairCommon
 *   item                      → IfcFurniture with its catalogue box as body, standing on the floor
 *                               finish; a supplier product carries its sku and vendor in the
 *                               plan's own Alza_Product set
 *
 * Every element is contained in its level's storey (IfcRelContainedInSpatialStructure), placed
 * relative to it, and has a GlobalId derived from the plan's id and its own (guid.ts). Every name
 * the file holds is plan text made a clean label (model/text.ts, cut to STRING(255)).
 *
 * Plan coordinates have y growing down the sheet; IFC's are right-handed with Z up. A plan
 * point (x, y) is IFC (x, -y): the plan seen from above is the model seen from above.
 */

import type { Item, Level, Opening, PlanModel, Room, Stair, Wall } from "../../model/types";
import { catalogOf, SUPPLIER_KIND_PREFIX, isSupplierKind } from "../../model/catalog";
import { rectCorners, segLen, type ORect } from "../../model/geometry";
import { levelSlice, levelsOf, slabUnderside, stairGeometryIn, stairwellsOf, type LevelInfo } from "../../model/levels";
import { buttJointExtensions } from "../../model/joints";
import { slabOutline, stairwellPolys } from "../../model/floors";
import { piecesArea, regionPieces, type Piece, type Poly } from "../../model/region";
import { stairSplit } from "../../model/stairs";
import { cleanText } from "../../model/text";
import { DOOR_SWING_DEFAULTS, DOUBLE_DOOR_CLEAR, FLOOR_FINISH_DEPTH, REGION, SLAB_THICKNESS, SUPPLIER, TEXT } from "../../model/limits";
import { FLOOR_MATERIAL, FURNITURE_TYPE, IFC_NAMES, IFC_PSETS, IFC_REPRESENTATION as REP, IFC_SIZES, MODEL_PRECISION, STEP_LABEL_MAX, WALL_MATERIAL } from "./config";
import { IfcEntities, type Context, type ElementHead, type LayerSetUsage, type LocalPlacement, type Material, type ProductShape, type PropertyValue } from "./entities";
import type { Ref } from "./step";

const DEG = Math.PI / 180;

/** A plan point as IFC coordinates: y flipped, so the model keeps the plan's handedness seen from above. */
const at = (x: number, y: number): [number, number] => [x, -y];

/** An oriented plan rectangle's frame in IFC: its centre, and its local x axis. */
const rectFrame = (r: ORect): { centre: [number, number]; xAxis: [number, number] } => ({
  centre: at(r.cx, r.cy),
  // the plan's local x axis is (cos rot, sin rot); with y flipped it is (cos -rot, sin -rot)
  xAxis: [Math.cos(r.rot), -Math.sin(r.rot)],
});

const roomRect = (r: Room): ORect => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, hw: r.w / 2, hd: r.h / 2, rot: 0 });
const roomPoly = (r: Room): Poly => rectCorners(roomRect(r));

const inRoom = (rooms: readonly Room[], x: number, y: number): boolean => rooms.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

/** Plan text as an IFC label or identifier: a clean name (model/text.ts), at most STRING(255). */
const label = (text: string): string => cleanText(text, STEP_LABEL_MAX);

/**
 * A piece of a region (model/region.ts: a trapezoid) as the corners of a closed profile in IFC,
 * counter-clockwise seen from above, a side the piece has no height at given once. Null for a
 * piece too thin to be a face.
 */
function pieceCorners(p: Piece): [number, number][] | null {
  const ring = [
    at(p.x0, p.lo0),
    at(p.x1, p.lo1),
    at(p.x1, p.hi1),
    at(p.x0, p.hi0),
  ].filter((q, i, all) => {
    const next = all[(i + 1) % all.length];
    return Math.hypot(q[0] - next[0], q[1] - next[1]) > REGION.edgeTolerance;
  });
  if (ring.length < 3) return null;
  const twiceArea = ring.reduce((sum, q, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + q[0] * next[1] - next[0] * q[1];
  }, 0);
  if (Math.abs(twiceArea) / 2 < MODEL_PRECISION * MODEL_PRECISION) return null;
  return twiceArea > 0 ? ring : ring.reverse();
}

/**
 * Whether a wall is an outside wall, read off the rooms on its level: a step past each face, at
 * a few points along it, lands in a room on one side only (outside) or on both (a partition).
 * Undefined when the rooms do not say (no room on either side), so the property is left out.
 */
export function wallIsExternal(wall: Wall, rooms: readonly Room[]): boolean | undefined {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (len === 0) return undefined;
  const nx = -(wall.by - wall.ay) / len;
  const ny = (wall.bx - wall.ax) / len;
  const reach = wall.thickness / 2 + IFC_SIZES.roomProbe;
  let outside = 0;
  let inside = 0;
  for (const f of IFC_SIZES.roomProbeAt) {
    const px = wall.ax + (wall.bx - wall.ax) * f;
    const py = wall.ay + (wall.by - wall.ay) * f;
    const left = inRoom(rooms, px + nx * reach, py + ny * reach);
    const right = inRoom(rooms, px - nx * reach, py - ny * reach);
    if (left && right) inside++;
    else if (left !== right) outside++;
  }
  if (outside === inside) return undefined;
  return outside > inside;
}

/**
 * Which way a door's own placement faces, relative to its wall's frame (whose x axis runs A→B,
 * so its +Y is the left of A→B seen from above). IFC opens a swinging door towards its
 * placement's +Y, so the placement is turned half a turn about Z for a leaf that swings to the
 * right of A→B: either way, +Y is the side the leaf opens to. Null: the wall's own axes.
 */
export function doorFacing(opening: Opening): [number, number] | null {
  return (opening.side ?? DOOR_SWING_DEFAULTS.side) === "right" ? [-1, 0] : null;
}

/**
 * The IfcDoorTypeOperationEnum value of a door. IFC names a single swing by the side its hinges
 * are on as seen looking along the door placement's +Y, the way the leaf swings (doorFacing):
 * facing the side of the wall the leaf opens to, a leaf swinging to the right of A→B has the B
 * end on its left, one swinging to the left the A end. A door wide enough to hang as a pair
 * (DOUBLE_DOOR_CLEAR) swings both leaves one way.
 */
export function doorOperation(opening: Opening): string {
  if (opening.width > DOUBLE_DOOR_CLEAR) return "DOUBLE_DOOR_SINGLE_SWING";
  const hinge = opening.hinge ?? DOOR_SWING_DEFAULTS.hinge;
  const side = opening.side ?? DOOR_SWING_DEFAULTS.side;
  const leftEnd = side === "right" ? "b" : "a";
  return hinge === leftEnd ? "SINGLE_SWING_LEFT" : "SINGLE_SWING_RIGHT";
}

/** The plain-language counts of what was exported, by IFC class. */
export interface IfcElementCounts {
  storeys: number;
  walls: number;
  doors: number;
  windows: number;
  openings: number;
  slabs: number;
  coverings: number;
  spaces: number;
  stairs: number;
  stairFlights: number;
  furniture: number;
}

/** Builds the plan's IFC model into a STEP file, entity by entity. */
export class PlanToIfc {
  readonly ifc = new IfcEntities();
  private body!: Context;
  private axis!: Context;
  private footPrint!: Context;
  private plasterMaterial: Material | null = null;
  private readonly wallUsages = new Map<number, { usage: LayerSetUsage; walls: Ref[] }>();
  private readonly slabs: Ref[] = [];
  private readonly floorMaterials = new Map<string, { material: Material; coverings: Ref[] }>();

  constructor(private readonly model: PlanModel) {}

  /**
   * The GlobalId of `key` in this plan: keyed by the plan's own id as well as the entity's, so
   * the same plan exported again keeps every GlobalId, and no two plans share one, even where
   * their entities have the same ids (every plan's ground level is "level_ground").
   */
  private guid(key: string): string {
    return this.ifc.guid(`${this.model.id}:${key}`);
  }

  /** The plaster walls and slabs are written in, one material for both. */
  private plaster(): Material {
    return (this.plasterMaterial ??= this.ifc.material(WALL_MATERIAL.name, WALL_MATERIAL.category));
  }

  /** A body extruded straight up from `base` over an oriented rectangle. */
  private boxSolid(r: ORect, depth: number, base = 0) {
    const { centre, xAxis } = rectFrame(r);
    return this.ifc.extrusion(this.ifc.rectangle(centre, 2 * r.hw, 2 * r.hd, xAxis), depth, [0, 0, base]);
  }

  /** A region's pieces, each extruded straight up from `base`: the solids of one flat body. */
  private regionSolids(pieces: readonly Piece[], depth: number, base = 0) {
    return pieces.flatMap((p) => {
      const corners = pieceCorners(p);
      return corners ? [this.ifc.extrusion(this.ifc.polygon(corners), depth, [0, 0, base])] : [];
    });
  }

  private bodyShape(items: Parameters<IfcEntities["shapeRepresentation"]>[3]): ProductShape | null {
    if (items.length === 0) return null;
    return this.ifc.productShape([this.ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, items)]);
  }

  private properties(owner: Ref, key: string, set: string, values: readonly [string, PropertyValue][]): void {
    if (values.length === 0) return;
    const pset = this.ifc.propertySet(this.guid(`pset:${set}:${key}`), set, values.map(([name, value]) => this.ifc.property(name, value)));
    this.ifc.definesByProperties(this.guid(`rel:${set}:${key}`), [owner], pset);
  }

  private quantities(owner: Ref, key: string, set: string, values: readonly ["length" | "area" | "volume", string, number][]): void {
    const qto = this.ifc.elementQuantity(this.guid(`qto:${set}:${key}`), set, values.map(([kind, name, value]) => this.ifc.quantity(kind, name, value)));
    this.ifc.definesByProperties(this.guid(`rel:${set}:${key}`), [owner], qto);
  }

  /** The whole model, written. */
  build(): void {
    const ifc = this.ifc;
    const model3d = ifc.context(REP.model, 3);
    const plan2d = ifc.context(REP.plan, 2);
    this.body = ifc.subContext(REP.body, REP.model, model3d, "MODEL_VIEW");
    this.axis = ifc.subContext(REP.axis, REP.model, model3d, "GRAPH_VIEW");
    this.footPrint = ifc.subContext(REP.footPrint, REP.plan, plan2d, "PLAN_VIEW");
    const units = ifc.units([
      ifc.siUnit("LENGTHUNIT", "METRE"),
      ifc.siUnit("AREAUNIT", "SQUARE_METRE"),
      ifc.siUnit("VOLUMEUNIT", "CUBIC_METRE"),
      ifc.siUnit("PLANEANGLEUNIT", "RADIAN"),
    ]);
    const name = cleanText(this.model.name, TEXT.planName) || IFC_NAMES.building;
    const project = ifc.project(this.guid("project"), name, [model3d, plan2d], units);

    const sitePlacement = ifc.localPlacement(null, ifc.placement3([0, 0, 0]));
    const site = ifc.site(this.guid("site"), IFC_NAMES.site, sitePlacement);
    const buildingPlacement = ifc.localPlacement(sitePlacement, ifc.placement3([0, 0, 0]));
    const building = ifc.building(this.guid("building"), name, buildingPlacement);
    ifc.aggregates(this.guid("rel:aggregates:project"), project, [site]);
    ifc.aggregates(this.guid("rel:aggregates:site"), site, [building]);

    const storeys = levelsOf(this.model).map((info) => this.storey(info, buildingPlacement));
    ifc.aggregates(this.guid("rel:aggregates:building"), building, storeys);

    for (const [thickness, { usage, walls }] of this.wallUsages) ifc.associatesMaterial(this.guid(`rel:material:wall:${thickness}`), walls, usage);
    if (this.slabs.length > 0) ifc.associatesMaterial(this.guid("rel:material:slab"), this.slabs, this.plaster());
    for (const [finish, { material, coverings }] of this.floorMaterials) ifc.associatesMaterial(this.guid(`rel:material:floor:${finish}`), coverings, material);
  }

  /** One level: its storey, and everything on it. */
  private storey(info: LevelInfo, buildingPlacement: LocalPlacement): Ref<"IFCBUILDINGSTOREY"> {
    const ifc = this.ifc;
    const { level } = info;
    const placement = ifc.localPlacement(buildingPlacement, ifc.placement3([0, 0, info.elevation]));
    const storey = ifc.storey(this.guid(`level:${level.id}`), label(cleanText(level.name) || level.id), placement, info.elevation);

    const walls = this.model.walls.filter((w) => w.levelId === level.id);
    const rooms = this.model.rooms.filter((r) => r.levelId === level.id);
    const wells = stairwellPolys(this.model, level.id);
    const contained: Ref[] = [];
    for (const wall of walls) contained.push(...this.wall(wall, walls, rooms, placement));
    const slab = this.floorSlab(level, wells, placement);
    if (slab) contained.push(slab);
    const spaces = rooms.map((room) => {
      const space = this.space(room, level, placement);
      const covering = this.flooring(room, wells, placement);
      if (covering) {
        contained.push(covering);
        ifc.coversSpace(this.guid(`rel:covers:${room.id}`), space, [covering]);
      }
      return space;
    });
    for (const stair of this.model.stairs.filter((s) => s.levelId === level.id)) {
      const built = this.stair(stair, placement);
      if (built) contained.push(built);
    }
    for (const item of this.model.items.filter((i) => i.levelId === level.id)) contained.push(this.item(item, placement));

    if (spaces.length > 0) ifc.aggregates(this.guid(`rel:aggregates:spaces:${level.id}`), storey, spaces);
    if (contained.length > 0) ifc.contains(this.guid(`rel:contains:${level.id}`), storey, contained);
    return storey;
  }

  private wallUsage(thickness: number): { usage: LayerSetUsage; walls: Ref[] } {
    const known = this.wallUsages.get(thickness);
    if (known) return known;
    const mm = Math.round(thickness * 1000);
    const entry = { usage: this.ifc.layerSetUsage(this.plaster(), thickness, `${WALL_MATERIAL.name} ${mm} mm`), walls: [] as Ref[] };
    this.wallUsages.set(thickness, entry);
    return entry;
  }

  /** A wall, and the doors and windows in it: the elements its storey contains. */
  private wall(wall: Wall, levelWalls: readonly Wall[], rooms: readonly Room[], storeyPlacement: LocalPlacement): Ref[] {
    const ifc = this.ifc;
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    if (len === 0) return [];
    const dir: [number, number] = [(wall.bx - wall.ax) / len, -(wall.by - wall.ay) / len];
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([...at(wall.ax, wall.ay), 0], dir));
    // butt joints: a wall wholly inside the walls it meets would be cut to nothing, so it keeps its own length
    const butt = buttJointExtensions(wall, levelWalls);
    const [extA, extB] = len + butt[0] + butt[1] > MODEL_PRECISION ? butt : [0, 0];
    const bodyLength = len + extA + extB;
    const axis = ifc.shapeRepresentation(this.axis, REP.axis, REP.curve2d, [ifc.polyline([[0, 0], [len, 0]])]);
    const profile = ifc.rectangle([(len + extB - extA) / 2, 0], bodyLength, wall.thickness);
    const body = ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, [ifc.extrusion(profile, wall.height)]);
    const element = ifc.wall(
      { guid: this.guid(`wall:${wall.id}`), name: label(`${IFC_NAMES.wall} ${wall.id}`), placement, shape: ifc.productShape([axis, body]), tag: label(wall.id) },
      "STANDARD",
    );
    this.wallUsage(wall.thickness).walls.push(element);

    const external = wallIsExternal(wall, rooms);
    this.properties(element, wall.id, IFC_PSETS.wallCommon, external === undefined ? [] : [["IsExternal", { type: "IFCBOOLEAN", value: external }]]);

    // measured on the body as written, so the quantities and the solid agree
    const openings = this.model.openings.filter((o) => o.wallId === wall.id);
    const cut = openings.reduce((sum, o) => sum + o.width * Math.max(0, Math.min(o.height, wall.height - o.sill)), 0);
    const side = bodyLength * wall.height;
    this.quantities(element, wall.id, IFC_PSETS.wallQuantities, [
      ["length", "Length", bodyLength],
      ["length", "Width", wall.thickness],
      ["length", "Height", wall.height],
      ["area", "GrossFootprintArea", bodyLength * wall.thickness],
      ["area", "GrossSideArea", side],
      ["area", "NetSideArea", Math.max(0, side - cut)],
      ["volume", "GrossVolume", side * wall.thickness],
      ["volume", "NetVolume", Math.max(0, side - cut) * wall.thickness],
    ]);

    return [element, ...openings.map((o) => this.filledOpening(o, wall, len, element, placement))];
  }

  /**
   * A door or window: the opening it voids in its wall, and the door or window filling it. The
   * void reaches IFC_SIZES.openingOverreach past every face of the wall it cuts through (both
   * sides, and the wall's foot or top where the opening meets them), so the boolean that cuts
   * it never meets a face of the wall in its own plane.
   */
  private filledOpening(o: Opening, wall: Wall, len: number, wallElement: Ref, wallPlacement: LocalPlacement): Ref {
    const ifc = this.ifc;
    const placement = ifc.localPlacement(wallPlacement, ifc.placement3([o.t * len, 0, o.sill]));
    const reach = wall.thickness + 2 * IFC_SIZES.openingOverreach;
    const below = o.sill <= 0 ? IFC_SIZES.openingOverreach : 0;
    const above = o.sill + o.height >= wall.height ? IFC_SIZES.openingOverreach : 0;
    const void_ = ifc.opening({
      guid: this.guid(`opening:${o.id}`),
      name: label(`${IFC_NAMES.opening} ${o.id}`),
      placement,
      shape: this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], o.width, reach), o.height + below + above, [0, 0, -below])]),
      tag: label(o.id),
    });
    ifc.voids(this.guid(`rel:voids:${o.id}`), wallElement, void_);

    const facing = o.kind === "door" ? doorFacing(o) : null;
    const fillPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0], facing ?? undefined));
    const depth = o.kind === "door" ? IFC_SIZES.doorLeafDepth : IFC_SIZES.windowDepth;
    const head: ElementHead = {
      guid: this.guid(`${o.kind}:${o.id}`),
      name: label(`${o.kind === "door" ? IFC_NAMES.door : IFC_NAMES.window} ${o.id}`),
      placement: fillPlacement,
      // centred on its placement, so turning a door to face its swing leaves the leaf where it was
      shape: this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], o.width, depth), o.height)]),
      tag: label(o.id),
    };
    const fill = o.kind === "door" ? ifc.door(head, o.height, o.width, doorOperation(o)) : ifc.window(head, o.height, o.width);
    ifc.fills(this.guid(`rel:fills:${o.id}`), void_, fill);
    return fill;
  }

  /** A room as a space: its floor rectangle, extruded to the underside of the slab over it. */
  private space(room: Room, level: Level, storeyPlacement: LocalPlacement): Ref<"IFCSPACE"> {
    const ifc = this.ifc;
    const height = slabUnderside(level.height);
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const rect = roomRect(room);
    const outline = rectCorners(rect).map((p) => at(p.x, p.y));
    const footPrint = ifc.shapeRepresentation(this.footPrint, REP.footPrint, REP.curve2d, [ifc.polyline([...outline, outline[0]])]);
    const body = ifc.shapeRepresentation(this.body, REP.body, REP.sweptSolid, [this.boxSolid(rect, height)]);
    const longName = cleanText(room.label);
    const space = ifc.space(this.guid(`space:${room.id}`), label(room.id), label(longName || room.id), placement, ifc.productShape([footPrint, body]));
    const area = room.w * room.h;
    this.properties(space, room.id, IFC_PSETS.spaceCommon, [
      ["Reference", { type: "IFCIDENTIFIER", value: label(room.id) }],
      ["IsExternal", { type: "IFCBOOLEAN", value: false }],
    ]);
    this.quantities(space, room.id, IFC_PSETS.spaceQuantities, [
      ["length", "Height", height],
      ["length", "GrossPerimeter", 2 * (room.w + room.h)],
      ["area", "GrossFloorArea", area],
      ["area", "NetFloorArea", area],
      ["volume", "GrossVolume", area * height],
    ]);
    return space;
  }

  /**
   * The slab a level stands on: SLAB_THICKNESS deep, its top at the storey's floor, under the
   * level's rooms and its walls to their joints (model/floors.ts, as the 3D view builds it), so
   * it closes the floor line under every wall of the level below too. Every stair rising
   * through it from the level below opens it. Null when the level has nothing to stand on one.
   */
  private floorSlab(level: Level, wells: readonly Poly[], storeyPlacement: LocalPlacement): Ref<"IFCSLAB"> | null {
    const ifc = this.ifc;
    const outline = slabOutline(levelSlice(this.model, level.id));
    const pieces = regionPieces(outline);
    const shape = this.bodyShape(this.regionSolids(pieces, SLAB_THICKNESS, -SLAB_THICKNESS));
    if (!shape) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const levelName = cleanText(level.name) || level.id;
    const slab = ifc.slab({ guid: this.guid(`slab:${level.id}`), name: label(`${IFC_NAMES.floor} ${levelName}`), placement, shape, tag: label(level.id) }, "FLOOR");
    this.slabs.push(slab);

    const gross = piecesArea(pieces);
    const net = piecesArea(regionPieces(outline, wells));
    this.quantities(slab, level.id, IFC_PSETS.slabQuantities, [
      ["length", "Width", SLAB_THICKNESS],
      ["area", "GrossArea", gross],
      ["area", "NetArea", net],
      ["volume", "GrossVolume", gross * SLAB_THICKNESS],
      ["volume", "NetVolume", net * SLAB_THICKNESS],
    ]);

    const overreach = IFC_SIZES.openingOverreach;
    for (const { stair, geometry } of stairwellsOf(this.model, level.id)) {
      // the parts of the stairwell that take some of the slab away
      const through = geometry.footprint.filter((r) => piecesArea(regionPieces(outline, [rectCorners(r)])) < gross - REGION.probe * REGION.probe);
      if (through.length === 0) continue;
      const openingPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      const void_ = ifc.opening({
        guid: this.guid(`stairwell:${stair.id}`),
        name: label(`${IFC_NAMES.stairwell} ${stair.id}`),
        placement: openingPlacement,
        shape: this.bodyShape(through.map((r) => this.boxSolid(r, SLAB_THICKNESS + 2 * overreach, -SLAB_THICKNESS - overreach))),
        tag: label(stair.id),
      });
      ifc.voids(this.guid(`rel:voids:stairwell:${stair.id}`), slab, void_);
    }
    return slab;
  }

  /**
   * A room's floor finish: an IfcCovering FLOORING, FLOOR_FINISH_DEPTH thick, laid on the slab
   * over the room less any stairwell crossing it, in the finish's material, covering its space.
   * Null when a stairwell takes the whole room.
   */
  private flooring(room: Room, wells: readonly Poly[], storeyPlacement: LocalPlacement): Ref<"IFCCOVERING"> | null {
    const ifc = this.ifc;
    const pieces = regionPieces([roomPoly(room)], wells);
    const shape = this.bodyShape(this.regionSolids(pieces, FLOOR_FINISH_DEPTH));
    if (!shape) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const longName = cleanText(room.label);
    const covering = ifc.covering(
      { guid: this.guid(`flooring:${room.id}`), name: label(`${IFC_NAMES.flooring} ${longName || room.id}`), placement, shape, tag: label(room.id) },
      "FLOORING",
    );
    const finish = FLOOR_MATERIAL[room.floor];
    let entry = this.floorMaterials.get(room.floor);
    if (!entry) this.floorMaterials.set(room.floor, (entry = { material: ifc.material(finish.name, finish.category), coverings: [] }));
    entry.coverings.push(covering);
    const net = piecesArea(pieces);
    this.quantities(covering, room.id, IFC_PSETS.coveringQuantities, [
      ["length", "Width", FLOOR_FINISH_DEPTH],
      ["area", "GrossArea", room.w * room.h],
      ["area", "NetArea", net],
    ]);
    return covering;
  }

  /** A stair: its flights and landing as parts, the stair itself the element its storey contains. */
  private stair(stair: Stair, storeyPlacement: LocalPlacement): Ref<"IFCSTAIR"> | null {
    const ifc = this.ifc;
    const g = stairGeometryIn(this.model, stair);
    if (!g) return null;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([0, 0, 0]));
    const element = ifc.stair(
      { guid: this.guid(`stair:${stair.id}`), name: label(`${IFC_NAMES.stair} ${stair.id}`), placement, shape: null, tag: label(stair.id) },
      stair.shape === "l" ? "QUARTER_TURN_STAIR" : "STRAIGHT_RUN_STAIR",
    );
    const parts: Ref[] = [];
    // an L-shaped stair's first flight climbs to the landing (stairSplit risers), its second the rest;
    // each flight's last riser lands on the landing or the floor above, so it has one tread fewer
    const split = stair.shape === "l" ? stairSplit(stair, g.risers) : g.risers;
    const flightRisers = stair.shape === "l" ? [split, g.risers - split] : [g.risers];
    flightRisers.forEach((risers, f) => {
      const steps = g.steps.filter((s) => s.flight === f);
      const flightPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      parts.push(
        ifc.stairFlight(
          {
            guid: this.guid(`stair:${stair.id}:flight:${f}`),
            name: label(`${IFC_NAMES.flight} ${f + 1}`),
            placement: flightPlacement,
            shape: this.bodyShape(steps.map((s) => this.boxSolid(s.rect, s.top))),
          },
          risers,
          steps.length,
          g.riserHeight,
          g.going,
        ),
      );
    });
    if (g.landing) {
      const landingPlacement = ifc.localPlacement(placement, ifc.placement3([0, 0, 0]));
      parts.push(
        ifc.slab(
          { guid: this.guid(`stair:${stair.id}:landing`), name: IFC_NAMES.landing, placement: landingPlacement, shape: this.bodyShape([this.boxSolid(g.landing.rect, g.landing.top)]) },
          "LANDING",
        ),
      );
    }
    ifc.aggregates(this.guid(`rel:aggregates:stair:${stair.id}`), element, parts);
    this.properties(element, stair.id, IFC_PSETS.stairCommon, [
      ["NumberOfRiser", { type: "IFCCOUNTMEASURE", value: g.risers }],
      ["NumberOfTreads", { type: "IFCCOUNTMEASURE", value: g.steps.length }],
      ["RiserHeight", { type: "IFCPOSITIVELENGTHMEASURE", value: g.riserHeight }],
      ["TreadLength", { type: "IFCPOSITIVELENGTHMEASURE", value: g.going }],
    ]);
    return element;
  }

  /** A piece of furniture: its catalogue footprint and height as a box, turned as it stands, on the floor finish. */
  private item(item: Item, storeyPlacement: LocalPlacement): Ref<"IFCFURNITURE"> {
    const ifc = this.ifc;
    const def = catalogOf(this.model).get(item.kind);
    const turn = item.rotation * DEG;
    const placement = ifc.localPlacement(storeyPlacement, ifc.placement3([...at(item.x, item.y), FLOOR_FINISH_DEPTH], [Math.cos(turn), Math.sin(turn)]));
    const shape = def ? this.bodyShape([ifc.extrusion(ifc.rectangle([0, 0], def.w, def.d), def.h)]) : null;
    const element = ifc.furniture(
      { guid: this.guid(`item:${item.id}`), name: (def && cleanText(def.label)) || IFC_NAMES.unknownKind, objectType: label(item.kind), placement, shape, tag: label(item.id) },
      FURNITURE_TYPE[item.kind] ?? "NOTDEFINED",
    );
    if (isSupplierKind(item.kind)) {
      this.properties(element, item.id, IFC_PSETS.product, [
        ["Sku", { type: "IFCIDENTIFIER", value: label(item.kind.slice(SUPPLIER_KIND_PREFIX.length)) }],
        ["Vendor", { type: "IFCLABEL", value: SUPPLIER.vendor }],
      ]);
    }
    return element;
  }

  /** What the file holds, by the plan's kinds of thing. */
  counts(): IfcElementCounts {
    const c = this.ifc.file.entityCounts();
    const n = (type: string) => c[type] ?? 0;
    return {
      storeys: n("IFCBUILDINGSTOREY"),
      walls: n("IFCWALL"),
      doors: n("IFCDOOR"),
      windows: n("IFCWINDOW"),
      openings: n("IFCOPENINGELEMENT"),
      slabs: n("IFCSLAB"),
      coverings: n("IFCCOVERING"),
      spaces: n("IFCSPACE"),
      stairs: n("IFCSTAIR"),
      stairFlights: n("IFCSTAIRFLIGHT"),
      furniture: n("IFCFURNITURE"),
    };
  }
}
