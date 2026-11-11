/**
 * The IFC export: the STEP writer's encoding, the GlobalIds, and the plan's mapping, every file
 * read back and checked by a checker written apart from the exporter (support/ifcCheck.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedText, encodeString, formatReal, positiveLength, StepFile, str, real, int, enumv, UNSET, DERIVED, list, typed, bool } from "../src/export/ifc/step";
import { compressGuid, ifcGuid, GuidRegistry, IFC_GUID } from "../src/export/ifc/guid";
import { IfcExportRefused, writeIfc } from "../src/export/ifc";
import { columnIsExternal, doorFacing, doorOperation, wallIsExternal } from "../src/export/ifc/model";
import { cleanText } from "../src/model/text";
import { exportFileName } from "../src/export/download";
import { seedLoft, seedTownhouse, FIRST_LEVEL_ID } from "../src/model/seed";
import { migratePlan } from "../src/model/planFormat";
import { stairGeometry } from "../src/model/stairs";
import { piecesArea, regionPieces, type Poly } from "../src/model/region";
import { slabOutline } from "../src/model/floors";
import { FLOOR_FINISH_DEPTH, GROUND_LEVEL_ID, SLAB_THICKNESS, STRAIGHT_SAGITTA, SUPPLIER, TEXT } from "../src/model/limits";
import { elevationOf, slabUnderside } from "../src/model/levels";
import { supplierKind } from "../src/model/catalog";
import type { Opening, PlanModel } from "../src/model/types";
import { checkIfc, curveMeasure, curvePoints, decodeStepString, readStep, type IfcCheck, type StepEntity, type StepValue } from "./support/ifcCheck";
import { store, pageActions } from "../src/model/store";
import { runTool } from "../src/mcp/tools";
import { resetStore, flush } from "./support/store";
import { isCurved, outlineAnchor, outlineBounds, outlinePerimeter, outlineRect, rectOutline, roomArea, wallArc, wallLength, wallPointAt } from "../src/model/shapes";
import { seedCrescent, CRESCENT_FIRST_LEVEL_ID } from "../src/model/demoCrescent";
import { columnFootprint, columnWalls } from "../src/model/columns";
import { wallPosts } from "../src/model/columnCuts";

/** a moment in local time: the header writes the local date and time */
const NOW = new Date(2026, 10, 10, 9, 30, 0);

/** The plan written and checked: the check's findings must be none. */
function exported(model: PlanModel): IfcCheck & { text: string } {
  const { text } = writeIfc(model, { now: NOW });
  const check = checkIfc(text);
  expect(check.errors).toEqual([]);
  return { ...check, text };
}

const value = (v: StepValue): unknown =>
  v.t === "typed" && v.type === "IFCBOOLEAN" && v.value.t === "enum" ? v.value.v === "T" : (v.t === "str" || v.t === "real" || v.t === "int" || v.t === "enum" ? v.v : v.t === "typed" ? value(v.value) : v.t === "unset" ? null : v);
const all = (c: IfcCheck, type: string): StepEntity[] => c.byType.get(type) ?? [];
const get = (c: IfcCheck, e: StepEntity, name: string): unknown => value(c.attr(e, name));
const byTag = (c: IfcCheck, type: string, tag: string): StepEntity => {
  const found = all(c, type).find((e) => get(c, e, "Tag") === tag);
  if (!found) throw new Error(`no ${type} tagged ${tag}`);
  return found;
};
const refs = (v: StepValue): StepValue[] => (v.t === "list" ? v.items : [v]);
const numbers = (c: IfcCheck, v: StepValue): number[] => {
  const point = c.deref(v)!;
  const coords = point.attrs[0];
  return coords.t === "list" ? coords.items.map((x) => value(x) as number) : [];
};
/** Properties of an object in the named property set, by property name. */
function propertiesOf(c: IfcCheck, owner: StepEntity, set: string): Record<string, unknown> | undefined {
  for (const rel of all(c, "IFCRELDEFINESBYPROPERTIES")) {
    const objects = c.attr(rel, "RelatedObjects");
    if (objects.t !== "list" || !objects.items.some((o) => o.t === "ref" && o.id === owner.id)) continue;
    const def = c.deref(c.attr(rel, "RelatingPropertyDefinition"))!;
    if (get(c, def, "Name") !== set) continue;
    const items = c.attr(def, def.type === "IFCPROPERTYSET" ? "HasProperties" : "Quantities");
    if (items.t !== "list") return undefined;
    return Object.fromEntries(
      items.items.map((i) => {
        const p = c.deref(i)!;
        return [get(c, p, "Name"), value(p.attrs[p.type === "IFCPROPERTYSINGLEVALUE" ? 2 : 3])];
      }),
    );
  }
  return undefined;
}
/** The material an object is associated with, by name. */
function materialOf(c: IfcCheck, owner: StepEntity): unknown {
  const rel = all(c, "IFCRELASSOCIATESMATERIAL").find((r) => refs(c.attr(r, "RelatedObjects")).some((o) => o.t === "ref" && o.id === owner.id));
  return rel ? get(c, c.deref(c.attr(rel, "RelatingMaterial"))!, "Name") : undefined;
}
/** The point a local placement puts its origin at, relative to its parent. */
function placementAt(c: IfcCheck, e: StepEntity): number[] {
  const lp = c.deref(c.attr(e, "ObjectPlacement"))!;
  const axis = c.deref(lp.attrs[1])!;
  return numbers(c, axis.attrs[0]);
}

/** Where a local placement stands in the world: its origin and the angle of its x axis about Z. */
interface Frame {
  x: number;
  y: number;
  z: number;
  angle: number;
}
const angleOf = (c: IfcCheck, ref: StepValue): number => {
  if (ref.t !== "ref") return 0;
  const [dx, dy] = numbers(c, ref);
  return Math.atan2(dy, dx);
};
/** A frame composed onto its parent (every axis the export writes is Z up). */
const compose = (parent: Frame, x: number, y: number, z: number, angle: number): Frame => ({
  x: parent.x + x * Math.cos(parent.angle) - y * Math.sin(parent.angle),
  y: parent.y + x * Math.sin(parent.angle) + y * Math.cos(parent.angle),
  z: parent.z + z,
  angle: parent.angle + angle,
});
const WORLD: Frame = { x: 0, y: 0, z: 0, angle: 0 };
/** A local placement's frame in the world, through the whole PlacementRelTo chain. */
function worldFrame(c: IfcCheck, lp: StepEntity): Frame {
  const rel = lp.attrs[0];
  const parent = rel.t === "ref" ? worldFrame(c, c.deref(rel)!) : WORLD;
  const axis = c.deref(lp.attrs[1])!;
  const [x, y, z] = numbers(c, axis.attrs[0]);
  return compose(parent, x, y, z, angleOf(c, axis.attrs[2]));
}
const frameOf = (c: IfcCheck, e: StepEntity): Frame => worldFrame(c, c.deref(c.attr(e, "ObjectPlacement"))!);
/** An IFC world direction on the plan (y down the sheet). */
const onPlan = (x: number, y: number): [number, number] => [x, -y];

/**
 * One extruded solid of a product's body, in the world: its outline seen from above (plan
 * coordinates) and its height range; for a boolean DIFFERENCE, its first operand's, with the
 * solids it is less of.
 */
interface Solid {
  outline: Poly;
  z0: number;
  z1: number;
  less: Solid[];
}
/** The sides a circle profile is read as. */
const CIRCLE_SIDES = 96;
/** `step`: the angle an arc of an indexed curve is cut at, radians (curvePoints). */
function solidsOf(c: IfcCheck, product: StepEntity, step?: number): Solid[] {
  const frame = frameOf(c, product);
  const shape = c.deref(c.attr(product, "Representation"));
  if (!shape) return [];
  const body = refs(shape.attrs[2]).map((r) => c.deref(r)!).find((rep) => get(c, rep, "RepresentationIdentifier") === "Body");
  if (!body) return [];
  return refs(c.attr(body, "Items")).map((r) => solidIn(c, frame, c.deref(r)!, step));
}
function solidIn(c: IfcCheck, frame: Frame, solid: StepEntity, step?: number): Solid {
  if (solid.type === "IFCBOOLEANRESULT") {
    expect(get(c, solid, "Operator")).toBe("DIFFERENCE");
    const first = solidIn(c, frame, c.deref(c.attr(solid, "FirstOperand"))!, step);
    return { ...first, less: [...first.less, solidIn(c, frame, c.deref(c.attr(solid, "SecondOperand"))!, step)] };
  }
  const position = c.deref(c.attr(solid, "Position"))!;
  const [px, py, pz] = numbers(c, position.attrs[0]);
  const at = compose(frame, px, py, pz, 0);
  const profile = c.deref(c.attr(solid, "SweptArea"))!;
  let local: [number, number][];
  if (profile.type === "IFCRECTANGLEPROFILEDEF") {
    const p2 = c.deref(c.attr(profile, "Position"))!;
    const [cx, cy] = numbers(c, p2.attrs[0]);
    const a = angleOf(c, p2.attrs[1]);
    const hx = (get(c, profile, "XDim") as number) / 2;
    const hy = (get(c, profile, "YDim") as number) / 2;
    local = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  } else if (profile.type === "IFCCIRCLEPROFILEDEF") {
    const [cx, cy] = numbers(c, c.deref(c.attr(profile, "Position"))!.attrs[0]);
    const radius = get(c, profile, "Radius") as number;
    local = Array.from({ length: CIRCLE_SIDES }, (_, i) => [cx + radius * Math.cos((i / CIRCLE_SIDES) * 2 * Math.PI), cy + radius * Math.sin((i / CIRCLE_SIDES) * 2 * Math.PI)]);
  } else {
    // a polyline, or an indexed curve with arcs (cut into degrees by the checker)
    local = curvePoints(c, c.deref(c.attr(profile, "OuterCurve"))!, step);
  }
  const outline = local.map(([x, y]) => {
    const w = compose(at, x, y, 0, 0);
    const [planX, planY] = onPlan(w.x, w.y);
    return { x: planX, y: planY };
  });
  return { outline, z0: at.z, z1: at.z + (get(c, solid, "Depth") as number), less: [] };
}
/** Whether plan point (x, y) at height z is inside a convex outline's prism (and none it is less of). */
function inside(s: Solid, x: number, y: number, z: number): boolean {
  if (z < s.z0 || z > s.z1) return false;
  if (s.less.some((l) => inside(l, x, y, z))) return false;
  let sign = 0;
  for (let i = 0; i < s.outline.length; i++) {
    const a = s.outline[i];
    const b = s.outline[(i + 1) % s.outline.length];
    const cross = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
    if (cross === 0) continue;
    if (sign === 0) sign = cross;
    else if (cross !== sign) return false;
  }
  return true;
}
/** The products whose bodies hold plan point (x, y) at height z. */
const solidsAt = (c: IfcCheck, types: readonly string[], x: number, y: number, z: number): StepEntity[] =>
  types.flatMap((t) => all(c, t)).filter((e) => solidsOf(c, e).some((s) => inside(s, x, y, z)));
/** The area two convex outlines share. */
const overlap = (a: Poly, b: Poly): number => piecesArea(regionPieces([a])) + piecesArea(regionPieces([b])) - piecesArea(regionPieces([a, b]));

// ---------------------------------------------------------------------------- the STEP writer

describe("STEP encoding", () => {
  it("doubles apostrophes and reverse solidi, and writes printable ASCII as itself", () => {
    expect(encodeString("O'Brien")).toBe("O''Brien");
    expect(encodeString("a\\b")).toBe("a\\\\b");
    expect(encodeString("Living & Kitchen (2)")).toBe("Living & Kitchen (2)");
  });

  it("writes accented text as \\X2\\ groups, astral characters as \\X4\\, and reads back the same", () => {
    expect(encodeString("Baño")).toBe("Ba\\X2\\00F1\\X0\\o");
    expect(encodeString("Habitación pequeña")).toBe("Habitaci\\X2\\00F3\\X0\\n peque\\X2\\00F1\\X0\\a");
    expect(encodeString("Ñu")).toBe("\\X2\\00D1\\X0\\u");
    expect(encodeString("plant 🌿")).toBe("plant \\X4\\0001F33F\\X0\\");
    for (const s of ["Baño", "Cocina–comedor", "Ático 🌿 é", "it's \\ fine", "日本語"]) expect(decodeStepString(encodeString(s))).toBe(s);
  });

  it("encodes control characters and lone surrogates instead of writing them raw", () => {
    expect(encodeString("a\nb")).toBe("a\\X2\\000A\\X0\\b");
    expect(encodeString("\ud800")).toBe("\\X2\\FFFD\\X0\\");
  });

  it("always writes a real with its decimal point, rounded, and refuses what is not finite", () => {
    expect(formatReal(3)).toBe("3.");
    expect(formatReal(2.7)).toBe("2.7");
    expect(formatReal(-0)).toBe("0.");
    expect(formatReal(-1e-9)).toBe("0.");
    expect(formatReal(0.00001)).toBe("0.00001");
    expect(formatReal(-1.25)).toBe("-1.25");
    expect(formatReal(1 / 3)).toBe("0.3333333");
    expect(() => formatReal(Number.NaN)).toThrow();
    expect(() => formatReal(Infinity)).toThrow();
    expect(() => int(1.5)).toThrow();
  });

  it("writes a magnitude past fixed notation in STEP's exponent form, which reads back as the same number", () => {
    expect(formatReal(1e22)).toBe("1.E22");
    expect(formatReal(-1e21)).toBe("-1.E21");
    expect(formatReal(1.5e22)).toBe("1.5E22");
    expect(formatReal(9.99e20)).toBe("999000000000000000000.");
    const f = new StepFile();
    f.add("IFCCARTESIANPOINT", [list([real(1e22), real(-2.5e21), real(0)])]);
    const text = f.serialize({ description: [""], implementationLevel: "2;1", fileName: "t.ifc", timeStamp: "", author: [""], organization: [""], preprocessor: "", originatingSystem: "", authorization: "", schemas: ["IFC4"] });
    const [point] = readStep(text).entities.values();
    expect(point.attrs[0]).toEqual({ t: "list", items: [{ t: "real", v: 1e22 }, { t: "real", v: -2.5e21 }, { t: "real", v: 0 }] });
  });

  it("refuses a positive length that is none once written, and a label past STRING(255)", () => {
    expect(() => positiveLength(0, "XDim")).toThrow(/XDim must be a positive length/);
    expect(() => positiveLength(-0.1, "Depth")).toThrow(/Depth/);
    // 4e-8 is written as 0.: a positive length that is zero in the file
    expect(() => positiveLength(4e-8, "YDim")).toThrow(/YDim/);
    expect(positiveLength(0.0000001, "YDim")).toEqual(real(0.0000001));
    expect(() => boundedText("x".repeat(256), "Name")).toThrow(/Name is longer than 255/);
    expect(boundedText("ñ".repeat(255), "Name")).toEqual(str("ñ".repeat(255)));
  });

  it("writes $, *, enumerations, booleans, lists and typed values, and numbers instances in order", () => {
    const f = new StepFile();
    const a = f.add("IFCCARTESIANPOINT", [list([real(0), real(1.5), real(2)])]);
    const b = f.add("IFCTEST", [a, UNSET, DERIVED, enumv("area"), bool(true), bool(false), typed("IFCLABEL", str("x")), int(3)]);
    expect(b.id).toBe(2);
    const text = f.serialize({
      description: ["ViewDefinition [DesignTransferView_V1.0]"],
      implementationLevel: "2;1",
      fileName: "t.ifc",
      timeStamp: "2026-11-10T09:30:00",
      author: [""],
      organization: [""],
      preprocessor: "p",
      originatingSystem: "o",
      authorization: "",
      schemas: ["IFC4"],
    });
    expect(text).toContain("#1=IFCCARTESIANPOINT((0.,1.5,2.));\n#2=IFCTEST(#1,$,*,.AREA.,.T.,.F.,IFCLABEL('x'),3);");
    expect(text.startsWith("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [DesignTransferView_V1.0]'),'2;1');")).toBe(true);
    expect(text).toContain("FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n");
    expect(text.endsWith("ENDSEC;\nEND-ISO-10303-21;\n")).toBe(true);
    expect(() => f.add("not an entity", [])).toThrow();
  });

  it("writes a shared instance once", () => {
    const f = new StepFile();
    const a = f.addShared("IFCDIRECTION", [list([real(0), real(0), real(1)])]);
    const b = f.addShared("IFCDIRECTION", [list([real(0), real(0), real(1)])]);
    expect(b).toBe(a);
    expect(f.size).toBe(1);
  });
});

describe("GlobalIds", () => {
  it("compresses 128 bits into IFC's 22 characters (buildingSMART's algorithm)", () => {
    expect(compressGuid(new Uint8Array(16))).toBe("0000000000000000000000");
    expect(compressGuid(new Uint8Array(16).fill(0xff))).toBe("3$$$$$$$$$$$$$$$$$$$$$");
    // 0x01 then fifteen zero bytes: the first byte is two characters, value 1
    expect(compressGuid(Uint8Array.from([1, ...new Array(15).fill(0)]))).toBe("0100000000000000000000");
  });

  it("derives the same id from the same key, different ids from different keys, all valid", () => {
    expect(ifcGuid("wall:wall_n")).toBe(ifcGuid("wall:wall_n"));
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => ifcGuid(`item:item_${i}`)));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(IFC_GUID);
  });

  it("refuses a key twice", () => {
    const r = new GuidRegistry();
    r.take("a");
    expect(() => r.take("a")).toThrow();
  });
});

// ---------------------------------------------------------------------------- the plan as IFC

describe("IFC export of the demo loft", () => {
  const loft = seedLoft();
  const c = exported(loft);
  const [storey] = all(c, "IFCBUILDINGSTOREY");

  it("writes an IFC4 header for the Design Transfer View, named after the plan, stamped when written", () => {
    expect(c.file.header.schemas).toEqual(["IFC4"]);
    expect(c.file.header.description).toEqual(["ViewDefinition [DesignTransferView_V1.0]"]);
    expect(c.file.header.fileName).toBe("sunset-loft.ifc");
    expect(c.file.header.timeStamp).toBe("2026-11-10T09:30:00");
  });

  it("has one storey, at the ground, standing on one slab, with every element of the plan in it", () => {
    expect(all(c, "IFCBUILDINGSTOREY")).toHaveLength(1);
    expect(get(c, storey, "Name")).toBe("Ground floor");
    expect(get(c, storey, "Elevation")).toBe(0);
    expect(get(c, all(c, "IFCPROJECT")[0], "Name")).toBe("Sunset Loft");
    expect(get(c, all(c, "IFCBUILDING")[0], "Name")).toBe("Sunset Loft");
    expect(all(c, "IFCWALL")).toHaveLength(loft.walls.length);
    expect(all(c, "IFCDOOR")).toHaveLength(loft.openings.filter((o) => o.kind === "door").length);
    expect(all(c, "IFCWINDOW")).toHaveLength(loft.openings.filter((o) => o.kind === "window").length);
    expect(all(c, "IFCOPENINGELEMENT")).toHaveLength(loft.openings.length);
    expect(all(c, "IFCSPACE")).toHaveLength(loft.rooms.length);
    expect(all(c, "IFCSLAB")).toHaveLength(1);
    expect(all(c, "IFCCOVERING")).toHaveLength(loft.rooms.length);
    expect(all(c, "IFCFURNITURE")).toHaveLength(loft.items.length);
    expect(all(c, "IFCSTAIR")).toHaveLength(0);
    for (const id of c.storeyOf.values()) expect(id).toBe(storey.id);
    // walls, doors and windows, one floor covering per room, the slab, the furniture
    expect(c.storeyOf.size).toBe(loft.walls.length + loft.openings.length + loft.rooms.length + 1 + loft.items.length);
  });

  it("places each wall at its A end, along its centreline, with y flipped into IFC's frame", () => {
    const north = byTag(c, "IFCWALL", "wall_n");
    expect(placementAt(c, north)).toEqual([0, 0, 0]);
    const east = byTag(c, "IFCWALL", "wall_e");
    expect(placementAt(c, east)).toEqual([8, 0, 0]);
    const axis = c.deref(c.deref(c.attr(east, "ObjectPlacement"))!.attrs[1])!;
    const ref = c.deref(axis.attrs[2])!.attrs[0];
    // A (8, 0) to B (8, 6) runs down the sheet: -Y in IFC
    expect(ref.t === "list" && ref.items.map((v) => value(v))).toEqual([0, -1, 0]);
  });

  it("gives each wall its quantities, measured on its body, its layer of plaster and, from the rooms, whether it is outside", () => {
    for (const id of ["wall_n", "wall_e", "wall_s", "wall_w"]) expect(propertiesOf(c, byTag(c, "IFCWALL", id), "Pset_WallCommon")).toEqual({ IsExternal: true });
    for (const id of ["wall_bed_w", "wall_bed_s", "wall_bath_w"]) expect(propertiesOf(c, byTag(c, "IFCWALL", id), "Pset_WallCommon")).toEqual({ IsExternal: false });
    const q = propertiesOf(c, byTag(c, "IFCWALL", "wall_e"), "Qto_WallBaseQuantities")!;
    // wall_e sorts before wall_n and wall_s, so it fills both its corners: 6 m and half of each 0.15 m partner
    const length = 6 + 0.15;
    expect(q.Length as number).toBeCloseTo(length, 9);
    expect(q).toMatchObject({ Width: 0.15, Height: 2.7 });
    expect(q.GrossSideArea as number).toBeCloseTo(length * 2.7, 9);
    // wall_e holds two windows: 1.2 × 1.2 and 0.6 × 0.9
    expect(q.NetSideArea as number).toBeCloseTo(length * 2.7 - 1.44 - 0.54, 6);
    // the bedroom's west wall stops at wall_n's inner face: 3.4 m less half of 0.15
    expect(propertiesOf(c, byTag(c, "IFCWALL", "wall_bed_w"), "Qto_WallBaseQuantities")!.Length as number).toBeCloseTo(3.4 - 0.075, 9);
    expect(all(c, "IFCMATERIALLAYERSETUSAGE")).toHaveLength(2);
    expect(all(c, "IFCMATERIAL").map((m) => get(c, m, "Name")).sort()).toEqual(["Carpet", "Ceramic tile", "Oak flooring", "Plaster"]);
  });

  it("butt-joints the walls: no two bodies overlap, and every corner and junction is filled by exactly one", () => {
    const walls = all(c, "IFCWALL");
    const outlines = walls.map((w) => solidsOf(c, w)[0].outline);
    for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) expect(overlap(outlines[i], outlines[j]), `${get(c, walls[i], "Tag")} × ${get(c, walls[j], "Tag")}`).toBeLessThan(1e-9);
    // the four outer corners, the T where the bedroom wall meets wall_n, either side of the three-way joint at (5, 3.4), the T at wall_e
    for (const [x, y] of [[0, 0], [8, 0], [8, 6], [0, 6], [5, 0.02], [5.02, 3.42], [5.02, 3.38], [5.07, 3.4], [7.99, 3.4], [-0.07, -0.07], [8.07, 6.07]]) {
      expect(solidsAt(c, ["IFCWALL"], x, y, 1).map((w) => get(c, w, "Tag")), `(${x}, ${y})`).toHaveLength(1);
    }
  });

  it("cuts every door and window into its wall and fills the opening, at its size", () => {
    const door = byTag(c, "IFCDOOR", "door_main");
    expect(get(c, door, "OverallWidth")).toBe(0.9);
    expect(get(c, door, "OverallHeight")).toBe(2.1);
    const win = byTag(c, "IFCWINDOW", "win_bath");
    expect(get(c, win, "OverallWidth")).toBe(0.6);
    // the opening sits at t × length along its wall, at the sill
    const opening = byTag(c, "IFCOPENINGELEMENT", "win_bath");
    expect(placementAt(c, opening)).toEqual([4.5, 0, 1.2]);
  });

  it("reaches every void past the wall faces it cuts through, the floor included, so no face is shared", () => {
    for (const o of loft.openings) {
      const wall = loft.walls.find((w) => w.id === o.wallId)!;
      const [voidSolid] = solidsOf(c, byTag(c, "IFCOPENINGELEMENT", o.id));
      const [wallSolid] = solidsOf(c, byTag(c, "IFCWALL", wall.id));
      if (o.sill <= 0) expect(voidSolid.z0, o.id).toBeLessThan(wallSolid.z0);
      else expect(voidSolid.z0, o.id).toBeCloseTo(o.sill, 9);
      expect(voidSolid.z1, o.id).toBeCloseTo(o.sill + o.height, 9);
      // and through both faces of the wall
      const [ax, ay] = [wall.ax + (wall.bx - wall.ax) * o.t, wall.ay + (wall.by - wall.ay) * o.t];
      const len = Math.hypot(wall.bx - wall.ax, wall.by - wall.ay);
      const [nx, ny] = [-(wall.by - wall.ay) / len, (wall.bx - wall.ax) / len];
      for (const s of [1, -1]) expect(inside(voidSolid, ax + s * nx * (wall.thickness / 2 + 0.01), ay + s * ny * (wall.thickness / 2 + 0.01), o.sill + o.height / 2), o.id).toBe(true);
    }
    // an opening that reaches the wall's top reaches past it
    const tall = seedLoft();
    tall.openings = [{ id: "win_top", kind: "window", wallId: "wall_n", t: 0.3, width: 1, sill: 1.5, height: 1.2 }];
    const k = exported(tall);
    const [voidSolid] = solidsOf(k, byTag(k, "IFCOPENINGELEMENT", "win_top"));
    expect(voidSolid.z1).toBeGreaterThan(2.7);
    expect(voidSolid.z0).toBeCloseTo(1.5, 9);
    expect(get(k, byTag(k, "IFCWINDOW", "win_top"), "OverallHeight")).toBe(1.2);
  });

  it("makes every room a space under its storey, named, covered by its floor finish", () => {
    const bath = all(c, "IFCSPACE").find((s) => get(c, s, "Name") === "room_bath")!;
    expect(get(c, bath, "LongName")).toBe("Bathroom");
    expect(propertiesOf(c, bath, "Pset_SpaceCommon")).toEqual({ Reference: "room_bath", IsExternal: false });
    const q = propertiesOf(c, bath, "Qto_SpaceBaseQuantities")!;
    expect(q.GrossFloorArea as number).toBeCloseTo(2.85 * 2.45, 9);
    expect(q.Height as number).toBeCloseTo(slabUnderside(loft.levels[0].height), 9);
    const finish = byTag(c, "IFCCOVERING", "room_bath");
    expect(get(c, finish, "PredefinedType")).toBe("FLOORING");
    expect(materialOf(c, finish)).toBe("Ceramic tile");
    expect(propertiesOf(c, finish, "Qto_CoveringBaseQuantities")).toMatchObject({ Width: FLOOR_FINISH_DEPTH });
    const covers = all(c, "IFCRELCOVERSSPACES").find((r) => value(c.attr(r, "RelatingSpace")) && (c.attr(r, "RelatingSpace") as { id: number }).id === bath.id)!;
    expect(refs(c.attr(covers, "RelatedCoverings")).map((r) => (r as { id: number }).id)).toEqual([finish.id]);
    // laid on the slab, from the floor up
    const [solid] = solidsOf(c, finish);
    expect([solid.z0, solid.z1]).toEqual([0, FLOOR_FINISH_DEPTH]);
  });

  it("lays the storey's slab under its rooms and its walls, in plaster", () => {
    const [slab] = all(c, "IFCSLAB");
    expect(get(c, slab, "PredefinedType")).toBe("FLOOR");
    expect(get(c, slab, "Tag")).toBe(GROUND_LEVEL_ID);
    expect(materialOf(c, slab)).toBe("Plaster");
    const q = propertiesOf(c, slab, "Qto_SlabBaseQuantities")!;
    expect(q.Width).toBe(SLAB_THICKNESS);
    // the floor the 3D view builds: the rooms, and the walls to their joints
    expect(q.GrossArea as number).toBeCloseTo(piecesArea(regionPieces(slabOutline(loft))), 9);
    for (const [x, y] of [[0, 0], [4, 3], [8.07, 6.07], [5, 1]]) expect(solidsAt(c, ["IFCSLAB"], x, y, -SLAB_THICKNESS / 2), `(${x}, ${y})`).toHaveLength(1);
    expect(solidsAt(c, ["IFCSLAB"], 8.1, 3, -SLAB_THICKNESS / 2)).toHaveLength(0);
  });

  it("stands the furniture on the floor finish, with its catalogue names and types", () => {
    const desk = byTag(c, "IFCFURNITURE", "item_desk");
    expect(get(c, desk, "Name")).toBe("Desk");
    expect(get(c, desk, "ObjectType")).toBe("desk");
    expect(get(c, desk, "PredefinedType")).toBe("DESK");
    expect(placementAt(c, desk)[2]).toBe(FLOOR_FINISH_DEPTH);
    expect(get(c, byTag(c, "IFCFURNITURE", "item_fridge"), "PredefinedType")).toBe("NOTDEFINED");
  });

  it("is the same file every time the same plan is exported at the same moment", () => {
    expect(writeIfc({ ...seedLoft(), id: loft.id }, { now: NOW }).text).toBe(c.text);
  });

  it("keeps every element's GlobalId when the plan around it changes", () => {
    const more = { ...seedLoft(), id: loft.id };
    more.items.unshift({ id: "item_new", levelId: more.levels[0].id, kind: "plant", x: 3, y: 3, rotation: 0 });
    more.walls = more.walls.filter((w) => w.id !== "wall_bed_s");
    const after = exported(more);
    const guid = (k: IfcCheck, type: string, tag: string) => get(k, byTag(k, type, tag), "GlobalId");
    for (const [type, tag] of [["IFCWALL", "wall_n"], ["IFCDOOR", "door_main"], ["IFCFURNITURE", "item_desk"], ["IFCCOVERING", "room_living"], ["IFCSLAB", GROUND_LEVEL_ID]]) {
      expect(guid(after, type, tag)).toBe(guid(c, type, tag));
    }
    expect(get(after, all(after, "IFCPROJECT")[0], "GlobalId")).toBe(get(c, all(c, "IFCPROJECT")[0], "GlobalId"));
  });

  it("shares no GlobalId with another plan, even one with the same ids in it", () => {
    const guids = (k: IfcCheck) => new Set([...k.file.entities.values()].flatMap((e) => (e.attrs[0]?.t === "str" && IFC_GUID.test(e.attrs[0].v) ? [e.attrs[0].v] : [])));
    const mine = guids(c);
    for (const other of [seedTownhouse(), seedLoft()]) {
      const theirs = guids(exported(other));
      expect([...theirs].filter((g) => mine.has(g))).toEqual([]);
    }
  });

  it("summarises what it wrote", () => {
    const { summary, text } = writeIfc(loft, { now: NOW });
    expect(summary).toMatchObject({
      schema: "IFC4",
      fileName: "sunset-loft.ifc",
      bytes: text.length,
      elements: { storeys: 1, walls: 7, doors: 3, windows: 4, openings: 7, slabs: 1, coverings: 3, spaces: 3, stairs: 0, stairFlights: 0, furniture: loft.items.length },
    });
    expect(Object.values(summary.entities).reduce((a, b) => a + b, 0)).toBe(c.file.entities.size);
  });
});

describe("IFC export of the two-storey townhouse", () => {
  const house = seedTownhouse();
  const c = exported(house);
  const storeys = all(c, "IFCBUILDINGSTOREY");

  it("has one storey per level, in order, at each level's elevation", () => {
    expect(storeys.map((s) => [get(c, s, "Name"), get(c, s, "Elevation")])).toEqual([
      ["Ground floor", 0],
      ["First floor", house.levels[0].height],
    ]);
    expect(placementAt(c, storeys[1])).toEqual([0, 0, house.levels[0].height]);
  });

  it("puts each level's walls, rooms, slab and furniture in its storey", () => {
    const first = storeys[1].id;
    for (const w of house.walls) expect(c.storeyOf.get(byTag(c, "IFCWALL", w.id).id)).toBe(storeys[w.levelId === FIRST_LEVEL_ID ? 1 : 0].id);
    expect(c.storeyOf.get(byTag(c, "IFCFURNITURE", "f_item_bed").id)).toBe(first);
    expect(c.storeyOf.get(byTag(c, "IFCDOOR", "f_door_bed").id)).toBe(first);
    expect(c.storeyOf.get(byTag(c, "IFCSLAB", FIRST_LEVEL_ID).id)).toBe(first);
    expect(c.storeyOf.get(byTag(c, "IFCCOVERING", "f_room_bed").id)).toBe(first);
    const spacesUnder = (storey: StepEntity) =>
      all(c, "IFCRELAGGREGATES")
        .filter((r) => r.attrs[4].t === "ref" && r.attrs[4].id === storey.id)
        .flatMap((r) => (r.attrs[5].t === "list" ? r.attrs[5].items : []))
        .map((v) => get(c, c.deref(v)!, "LongName"));
    expect(spacesUnder(storeys[0])).toEqual(["Living"]);
    expect(spacesUnder(storeys[1])).toEqual(["Landing", "Bedroom"]);
  });

  it("closes the floor line: the first floor's slab fills the band between the ground walls' tops and its floor, under every wall", () => {
    const top = house.levels[0].height;
    const band = slabUnderside(top) + SLAB_THICKNESS / 2;
    // the ground walls stop at the slab's underside
    for (const w of all(c, "IFCWALL").filter((e) => c.storeyOf.get(e.id) === storeys[0].id)) expect(solidsOf(c, w)[0].z1).toBeCloseTo(slabUnderside(top), 9);
    // on the north and south walls' centrelines, under the first floor's partition, in a corner, in a room
    for (const [x, y] of [[4, 0], [4, 6], [2.5, 3], [0, 0], [8.07, -0.07], [4, 3]]) {
      expect(solidsAt(c, ["IFCSLAB", "IFCWALL"], x, y, band).map((e) => get(c, e, "Tag")), `(${x}, ${y})`).toEqual([FIRST_LEVEL_ID]);
    }
    // and the first floor's partition stands on it
    expect(solidsAt(c, ["IFCWALL"], 2.5, 3, top + 0.05).map((e) => get(c, e, "Tag"))).toEqual(["f_wall_hall"]);
  });

  it("writes the stair with its flight's risers and goings, on the ground floor", () => {
    const g = stairGeometry(house.stairs[0], house.levels[0].height);
    const [stair] = all(c, "IFCSTAIR");
    expect(get(c, stair, "PredefinedType")).toBe("STRAIGHT_RUN_STAIR");
    expect(c.storeyOf.get(stair.id)).toBe(storeys[0].id);
    const [flight] = all(c, "IFCSTAIRFLIGHT");
    expect(all(c, "IFCSTAIRFLIGHT")).toHaveLength(1);
    expect(get(c, flight, "NumberOfRisers")).toBe(g.risers);
    expect(get(c, flight, "NumberOfTreads")).toBe(g.risers - 1);
    expect(get(c, flight, "RiserHeight") as number).toBeCloseTo(g.riserHeight, 6);
    expect(get(c, flight, "TreadLength") as number).toBeCloseTo(g.going, 6);
    expect(c.storeyOf.get(flight.id)).toBe(storeys[0].id);
    // one solid per tread, each up to its tread's top
    expect(solidsOf(c, flight)).toHaveLength(g.steps.length);
    expect(propertiesOf(c, stair, "Pset_StairCommon")).toMatchObject({ NumberOfRiser: g.risers, NumberOfTreads: g.steps.length });
  });

  it("opens the first floor's slab where the stair rises through it, and the finish of the room it crosses", () => {
    const wells = all(c, "IFCOPENINGELEMENT").filter((o) => get(c, o, "Tag") === "stair_main");
    expect(wells).toHaveLength(1);
    const host = all(c, "IFCRELVOIDSELEMENT").find((r) => r.attrs[5].t === "ref" && r.attrs[5].id === wells[0].id)!;
    expect(get(c, c.deref(host.attrs[4])!, "Tag")).toBe(FIRST_LEVEL_ID);
    const g = stairGeometry(house.stairs[0], house.levels[0].height);
    const centre = g.footprint[0];
    const finish = byTag(c, "IFCCOVERING", "f_room_hall");
    expect(solidsOf(c, finish).some((s) => inside(s, centre.cx, centre.cy, house.levels[0].height + FLOOR_FINISH_DEPTH / 2))).toBe(false);
    const q = propertiesOf(c, byTag(c, "IFCSLAB", FIRST_LEVEL_ID), "Qto_SlabBaseQuantities")!;
    expect(q.GrossArea as number).toBeGreaterThan(q.NetArea as number);
  });

  it("summarises both storeys", () => {
    expect(writeIfc(house, { now: NOW }).summary.elements).toEqual({
      storeys: 2,
      walls: 9,
      doors: 2,
      windows: 2,
      openings: 5,
      slabs: 2,
      coverings: 3,
      spaces: 3,
      stairs: 1,
      stairFlights: 1,
      furniture: 3,
      columns: 0,
    });
  });
});

describe("IFC export of what plans can hold", () => {
  it("writes an L-shaped stair as two flights and a landing, the risers adding up", () => {
    const house = seedTownhouse();
    house.stairs = [{ id: "stair_l", levelId: house.levels[0].id, shape: "l", x: 6, y: 5, rotation: 180, width: 0.9, turn: "left" }];
    const c = exported(house);
    const g = stairGeometry(house.stairs[0], house.levels[0].height);
    expect(get(c, all(c, "IFCSTAIR")[0], "PredefinedType")).toBe("QUARTER_TURN_STAIR");
    const flights = all(c, "IFCSTAIRFLIGHT");
    expect(flights).toHaveLength(2);
    expect(flights.reduce((n, f) => n + (get(c, f, "NumberOfRisers") as number), 0)).toBe(g.risers);
    expect(flights.reduce((n, f) => n + (get(c, f, "NumberOfTreads") as number), 0)).toBe(g.steps.length);
    const landing = all(c, "IFCSLAB").find((s) => get(c, s, "PredefinedType") === "LANDING")!;
    expect(c.storeyOf.get(landing.id)).toBe(all(c, "IFCBUILDINGSTOREY")[0].id);
  });

  it("encodes Spanish names and keeps a partner's text to a clean name, with its sku and vendor in the plan's own set", () => {
    const plan = seedLoft();
    plan.name = "Casa de Begoña";
    plan.rooms[0] = { ...plan.rooms[0], label: "Salón–comedor" };
    const kind = supplierKind("NK-SOF-3S");
    // a partner's name with a NUL, a line break, a right-to-left override, a zero-width space and an isolate
    plan.kinds = [{ kind, label: "Sofá 'Åsa'\u0000\n');#1=IFCWALL(‮exe.tab​⁦x⁩", w: 2, d: 0.9, h: 0.8, color: "#777777", category: "living", source: "supplier" }];
    plan.items = [{ id: "item_nk", levelId: plan.levels[0].id, kind, x: 3, y: 3, rotation: 90 }];
    const { text } = writeIfc(plan, { now: NOW });
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(text).toContain("Casa de Bego\\X2\\00F1\\X0\\a");
    const c = checkIfc(text);
    expect(c.errors).toEqual([]);
    expect(get(c, all(c, "IFCPROJECT")[0], "Name")).toBe("Casa de Begoña");
    expect(all(c, "IFCSPACE").map((s) => get(c, s, "LongName"))).toContain("Salón–comedor");
    const sofa = byTag(c, "IFCFURNITURE", "item_nk");
    expect(get(c, sofa, "Name")).toBe("Sofá 'Åsa' ');#1=IFCWALL(exe.tabx");
    expect(text).not.toMatch(/\\X2\\(202E|200B|2066|2069)/);
    expect(all(c, "IFCWALL")).toHaveLength(plan.walls.length);
    expect(propertiesOf(c, sofa, "Alza_Product")).toEqual({ Sku: "NK-SOF-3S", Vendor: SUPPLIER.vendor });
    expect([...c.file.entities.values()].filter((e) => e.type === "IFCPROPERTYSET").every((p) => !/^Alza_/.test(String(get(c, p, "Name"))) || !/^Pset_/.test(String(get(c, p, "Name"))))).toBe(true);
  });

  it("cuts names to the plan's text limits, drops invisible formatting, and gives a nameless plan a name", () => {
    expect([...cleanText("x".repeat(500))]).toHaveLength(TEXT.label);
    expect(cleanText("  a \t\n b  ")).toBe("a b");
    expect(cleanText("Sofa‮exe.tab​⁦x⁩ y")).toBe("Sofaexe.tabx y");
    const c = exported({ ...seedLoft(), name: "   " });
    expect(get(c, all(c, "IFCPROJECT")[0], "Name")).toBe("Building");
    expect(exportFileName("   ", "ifc")).toBe("plan.ifc");
  });

  it("writes every id and kind from a loaded plan as a clean label within STRING(255)", () => {
    const plan = seedLoft();
    const roomId = "a'b\n);#99=IFCWALL(" + "z".repeat(400);
    plan.rooms[0] = { ...plan.rooms[0], id: roomId };
    plan.items[0] = { ...plan.items[0], kind: "k".repeat(500) };
    plan.walls[0] = { ...plan.walls[0], id: "w‮" + "x".repeat(300) };
    plan.openings = plan.openings.map((o) => (o.wallId === "wall_n" ? { ...o, wallId: plan.walls[0].id } : o));
    const c = exported(plan);
    const space = all(c, "IFCSPACE").find((s) => String(get(c, s, "Name")).startsWith("a'b"))!;
    expect(get(c, space, "Name")).toBe(cleanText(roomId, 255));
    expect([...String(get(c, space, "Name"))]).toHaveLength(255);
    expect(propertiesOf(c, space, "Pset_SpaceCommon")!.Reference).toBe(cleanText(roomId, 255));
    const odd = all(c, "IFCFURNITURE").find((f) => String(get(c, f, "ObjectType")).startsWith("kkk"))!;
    expect(String(get(c, odd, "ObjectType"))).toHaveLength(255);
    const wall = all(c, "IFCWALL").find((w) => String(get(c, w, "Tag")).startsWith("w"))!;
    expect(String(get(c, wall, "Tag"))).not.toContain("‮");
    for (const e of c.file.entities.values()) for (const v of e.attrs) if (v.t === "str") expect(v.v).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  it("names the file from the plan's name made safe: capped, with no control, invisible or reserved characters", () => {
    const long = "x".repeat(100000);
    expect(exportFileName(long, "ifc").length).toBeLessThanOrEqual(TEXT.planName + ".ifc".length);
    expect(exportFileName("Casa ' \n é‮gpj.exe", "ifc")).toBe("casa-'-égpj.exe.ifc");
    expect(exportFileName("a/b\\c:d*e?f\"g<h>i|j", "obj")).toBe("a-b-c-d-e-f-g-h-i-j.obj");
    expect(exportFileName("..hidden", "png")).toBe("hidden.png");
    const plan = { ...seedLoft(), name: long };
    const { summary, text } = writeIfc(plan, { now: NOW });
    expect(summary.fileName.length).toBeLessThanOrEqual(TEXT.planName + ".ifc".length);
    expect(readStep(text).header.fileName).toBe(summary.fileName);
  });

  it("refuses a loaded plan whose numbers break their ranges, naming them, instead of writing a broken file", () => {
    const cases: [string, (p: PlanModel) => void, RegExp][] = [
      ["wall thickness 0", (p) => (p.walls[0] = { ...p.walls[0], thickness: 0 }), /wall wall_n: thickness/],
      ["wall thickness -0.1", (p) => (p.walls[0] = { ...p.walls[0], thickness: -0.1 }), /wall wall_n: thickness/],
      ["wall height 0", (p) => (p.walls[0] = { ...p.walls[0], height: 0 }), /wall wall_n: height/],
      ["opening width 0", (p) => (p.openings[0] = { ...p.openings[0], width: 0 }), /door door_main: width/],
      ["room width 0", (p) => (p.rooms[0] = { ...p.rooms[0], points: rectOutline(0, 0, 0, 3) }), /room room_living: width /],
      ["a room corner at 1e22", (p) => (p.rooms[0] = { ...p.rooms[0], points: rectOutline(0, 0, 1e22, 3) }), /room room_living: points\.1\.x /],
      ["a room edge bent past a half circle", (p) => (p.rooms[0] = { ...p.rooms[0], points: [{ x: 0, y: 0, bulge: 2 }, { x: 3, y: 0 }, { x: 3, y: 3 }] }), /room room_living: points\.0\.bulge /],
      ["a wall bent past a half circle", (p) => (p.walls[0] = { ...p.walls[0], bulge: -1.5 }), /wall wall_n: bulge /],
      ["level height 0.1", (p) => (p.levels[0] = { ...p.levels[0], height: 0.1 }), /level level_ground: height/],
      ["a coordinate of 1e22", (p) => (p.walls[0] = { ...p.walls[0], bx: 1e22 }), /wall wall_n: bx/],
    ];
    for (const [what, breakIt, says] of cases) {
      const migrated = migratePlan(seedLoft());
      if (!migrated.ok) throw new Error(migrated.summary);
      const plan = structuredClone(migrated.model);
      breakIt(plan);
      expect(() => writeIfc(plan, { now: NOW }), what).toThrow(IfcExportRefused);
      expect(() => writeIfc(plan, { now: NOW }), what).toThrow(says);
    }
    const many = seedLoft();
    many.walls = many.walls.map((w) => ({ ...w, thickness: 0 }));
    expect(() => writeIfc(many)).toThrow(/And 4 more\. Fix them, then export again\./);
  });

  it("exports an empty plan as its storey alone", () => {
    const c = exported({ ...seedLoft(), walls: [], openings: [], rooms: [], items: [], stairs: [] });
    expect(all(c, "IFCBUILDINGSTOREY")).toHaveLength(1);
    expect(all(c, "IFCSLAB")).toHaveLength(0);
    expect(all(c, "IFCRELCONTAINEDINSPATIALSTRUCTURE")).toHaveLength(0);
  });

  it("exports a plan saved before levels existed, once it is migrated, under the id it is given", () => {
    const loft = seedLoft();
    // format 1: no version, no levels, no stairs, no plan id, and no entity names its level
    const unlevelled = <T extends { levelId: string }>(e: T) => {
      const copy: Partial<T> = { ...e };
      delete copy.levelId;
      return copy;
    };
    const v1 = { name: loft.name, walls: loft.walls.map(unlevelled), openings: loft.openings, rooms: loft.rooms.map(({ points, ...r }) => unlevelled({ ...r, ...outlineBounds(points) })), items: loft.items.map(unlevelled), kinds: [], underlay: null };
    const migrated = migratePlan(v1);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.model.id).toMatch(/^plan_[0-9a-f]{32}$/);
    expect(exported(migrated.model).text).toBe(writeIfc({ ...loft, id: migrated.model.id }, { now: NOW }).text);
    // a plan saved with an id keeps it; one saved in the current format without one gets one
    const again = migratePlan(JSON.parse(JSON.stringify(loft)));
    expect(again.ok && again.model.id).toBe(loft.id);
    const { id: _dropped, ...unidentified } = loft;
    void _dropped;
    const given = migratePlan(unidentified);
    expect(given.ok && given.model.id).toMatch(/^plan_[0-9a-f]{32}$/);
    expect(given.ok && given.model.id).not.toBe(loft.id);
  });

  it("names a door's swing by the side its hinges are on, looking the way it opens", () => {
    const door = (hinge: "a" | "b", side: "left" | "right", width = 0.9): Opening => ({ id: "d", kind: "door", wallId: "w", t: 0.5, width, sill: 0, height: 2.1, hinge, side });
    expect(doorOperation(door("b", "right"))).toBe("SINGLE_SWING_LEFT");
    expect(doorOperation(door("a", "right"))).toBe("SINGLE_SWING_RIGHT");
    expect(doorOperation(door("a", "left"))).toBe("SINGLE_SWING_LEFT");
    expect(doorOperation(door("b", "left"))).toBe("SINGLE_SWING_RIGHT");
    expect(doorOperation(door("a", "right", 1.6))).toBe("DOUBLE_DOOR_SINGLE_SWING");
    expect(doorFacing(door("a", "right"))).toEqual([-1, 0]);
    expect(doorFacing(door("a", "left"))).toBeNull();
  });

  it("faces every door the way its leaf swings, its hinge on the jamb the plan hangs it on, in any wall", () => {
    // a wall at an angle, run both ways, and a door of each hinge and side in each
    for (const [ax, ay, bx, by] of [[1, 1, 5, 4], [5, 4, 1, 1], [0, 0, 0, 4]]) {
      for (const hinge of ["a", "b"] as const) {
        for (const side of ["left", "right"] as const) {
          const plan = { ...seedLoft(), walls: [{ id: "w", levelId: GROUND_LEVEL_ID, ax, ay, bx, by, thickness: 0.15, height: 2.7 }], rooms: [], items: [] };
          plan.openings = [{ id: "d", kind: "door", wallId: "w", t: 0.5, width: 0.9, sill: 0, height: 2.1, hinge, side }];
          const c = exported(plan);
          const d = byTag(c, "IFCDOOR", "d");
          const f = frameOf(c, d);
          const len = Math.hypot(bx - ax, by - ay);
          const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
          // the editor's "right" of A→B on the y-down sheet; the leaf swings to it, or to the other side
          const swing = side === "right" ? [-uy, ux] : [uy, -ux];
          // IFC opens a door towards its placement's +Y
          const [yx, yy] = onPlan(-Math.sin(f.angle), Math.cos(f.angle));
          expect(yx * swing[0] + yy * swing[1], `${hinge}/${side}`).toBeCloseTo(1, 9);
          // SINGLE_SWING_LEFT hangs the leaf on the jamb at -X, seen looking along +Y; RIGHT at +X
          const sense = get(c, d, "OperationType") === "SINGLE_SWING_LEFT" ? -1 : 1;
          const [hx, hy] = onPlan(sense * Math.cos(f.angle), sense * Math.sin(f.angle));
          const toHinge = hinge === "a" ? [-ux, -uy] : [ux, uy];
          expect(hx * toHinge[0] + hy * toHinge[1], `${hinge}/${side}`).toBeCloseTo(1, 9);
          // and the leaf stays in the middle of the wall, where the opening is
          expect([f.x, -f.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([(ax + bx) / 2, (ay + by) / 2].map((v) => Math.round(v * 1e6) / 1e6));
        }
      }
    }
  });

  it("leaves IsExternal out where no room tells", () => {
    expect(wallIsExternal({ id: "w", levelId: "l", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 }, [])).toBeUndefined();
  });

  it("checks its own checker: a broken file is caught", () => {
    const { text } = writeIfc(seedLoft(), { now: NOW });
    expect(checkIfc(text.replace(/IFCWALL\('([^']+)'/, "IFCWALL('bad'")).errors.join()).toMatch(/invalid GlobalId/);
    expect(checkIfc(text.replace(/(#\d+=IFCDOOR\()/, "$1$,")).errors.join()).toMatch(/has 14 attributes, IFC4 has 13/);
    expect(checkIfc(text.replace(/=IFCRELFILLSELEMENT\([^;]*\);/, "=IFCMATERIAL('x',$,$);")).errors.join()).toMatch(/filled 0 times/);
    expect(checkIfc(text.replace(/IFCBUILDINGSTOREY\(([^;]*),0\.\);/, "IFCBUILDINGSTOREY($1,0);")).errors.join()).toMatch(/must be a REAL/);
    expect(() => readStep(text.replace("ENDSEC;\nDATA;", "DATA;"))).toThrow();
    // a wall whose body is a point: the reference resolves, to the wrong kind of entity
    const point = /^#(\d+)=IFCCARTESIANPOINT\(/m.exec(text)![1];
    const wallShape = /^(#\d+=IFCWALL\((?:[^,]*,){6})#\d+/m;
    expect(checkIfc(text.replace(wallShape, `$1#${point}`)).errors.join()).toMatch(/IFCWALL\.Representation refers to #\d+, a IFCCARTESIANPOINT/);
    // a set of the application's own under buildingSMART's prefix
    expect(checkIfc(text.replace("'Qto_WallBaseQuantities'", "'Pset_Mine'")).errors.join()).toMatch(/Pset_Mine takes buildingSMART's prefix/);
    // a label past STRING(255)
    expect(checkIfc(text.replace("'wall_n'", `'${"n".repeat(256)}'`)).errors.join()).toMatch(/longer than STRING\(255\)/);
  });
});

// ---------------------------------------------------------------------------- free shapes

describe("IFC export of free shapes: the Crescent House", () => {
  const house = seedCrescent();
  const c = exported(house);
  const curved = house.walls.filter((w) => isCurved(w));
  /** a representation of a product, by identifier */
  const representation = (e: StepEntity, id: string): StepEntity | undefined => {
    const shape = c.deref(c.attr(e, "Representation"));
    return shape ? refs(shape.attrs[2]).map((r) => c.deref(r)!).find((rep) => get(c, rep, "RepresentationIdentifier") === id) : undefined;
  };
  /** the curve a representation holds, or the outer curve of the profile its one solid rises from */
  const curveOf = (rep: StepEntity): StepEntity => {
    const item = c.deref(refs(c.attr(rep, "Items"))[0])!;
    return item.type === "IFCEXTRUDEDAREASOLID" ? c.deref(c.attr(c.deref(c.attr(item, "SweptArea"))!, "OuterCurve"))! : item;
  };
  const arcsIn = (curve: StepEntity) => (curve.type === "IFCINDEXEDPOLYCURVE" ? refs(curve.attrs[1]).filter((s) => s.t === "typed" && s.type === "IFCARCINDEX").length : 0);
  /** whether plan point p is inside an outline (even-odd: any outline, convex or not) */
  const within = (outline: Poly, x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[j];
      const b = outline[i];
      if (b.y > y !== a.y > y && x < ((a.x - b.x) * (y - b.y)) / (a.y - b.y) + b.x) inside = !inside;
    }
    return inside;
  };

  it("writes the curves the export may write, well formed: the checker finds nothing", () => {
    // exported() has checked it; the curves are there, and a broken one is caught
    expect(all(c, "IFCINDEXEDPOLYCURVE").length).toBeGreaterThan(0);
    expect(all(c, "IFCCARTESIANPOINTLIST2D")).toHaveLength(all(c, "IFCINDEXEDPOLYCURVE").length);
    const text = writeIfc(house, { now: NOW }).text;
    expect(checkIfc(text.replace(/IFCARCINDEX\(\((\d+),(\d+),(\d+)\)\)/, "IFCARCINDEX(($1,$2))")).errors.join()).toMatch(/IFCARCINDEX of 2 points/);
    expect(checkIfc(text.replace(/IFCLINEINDEX\(\((\d+),(\d+)\)\)/, "IFCLINEINDEX(($1,999))")).errors.join()).toMatch(/indexes past/);
  });

  it("gives each curved wall its arc as its Axis, as long as the wall along its centreline", () => {
    expect(curved.length).toBeGreaterThan(0);
    for (const w of curved) {
      const e = byTag(c, "IFCWALL", w.id);
      const axis = curveOf(representation(e, "Axis")!);
      expect(axis.type, w.id).toBe("IFCINDEXEDPOLYCURVE");
      expect(arcsIn(axis), w.id).toBe(1);
      expect(curveMeasure(c, axis).length, w.id).toBeCloseTo(wallLength(w), 6);
      // the arc in the world passes through the wall's two ends and its middle
      const pts = curvePoints(c, axis);
      const frame = frameOf(c, e);
      const world = (q: [number, number]) => {
        const p = compose(frame, q[0], q[1], 0, 0);
        return onPlan(p.x, p.y);
      };
      const [x0, y0] = world(pts[0]);
      const [x1, y1] = world(pts[pts.length - 1]);
      expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e6) / 1e6), w.id).toEqual([w.ax, w.ay, w.bx, w.by]);
      const mid = wallPointAt(w, 0.5);
      expect(pts.some((q) => Math.hypot(world(q)[0] - mid.x, world(q)[1] - mid.y) < 1e-6), w.id).toBe(true);
    }
  });

  it("extrudes each curved wall from its curved outline: its faces concentric arcs, its area its thickness by its length", () => {
    for (const w of curved) {
      const e = byTag(c, "IFCWALL", w.id);
      const profile = curveOf(representation(e, "Body")!);
      expect(arcsIn(profile), w.id).toBe(2);
      const q = propertiesOf(c, e, "Qto_WallBaseQuantities")!;
      const { area } = curveMeasure(c, profile);
      // an annular sector is its width times its centreline's length; its ends, cut along the faces they meet,
      // add or take a sliver no wider than the wall
      expect(Math.abs(area - w.thickness * (q.Length as number)), w.id).toBeLessThan(w.thickness * w.thickness);
      expect(q.GrossFootprintArea as number, w.id).toBeCloseTo(area, 6);
      expect(q.GrossVolume as number, w.id).toBeCloseTo(area * w.height, 5);
      // the faces stand half the thickness either side of the arc at its middle
      const [solid] = solidsOf(c, e);
      const arc = wallArc(w)!;
      const m = wallPointAt(w, 0.5);
      const out = { x: (m.x - arc.center.x) / arc.radius, y: (m.y - arc.center.y) / arc.radius };
      for (const [d, inside] of [
        [0, true],
        [w.thickness / 2 - 0.005, true],
        [-(w.thickness / 2 - 0.005), true],
        [w.thickness / 2 + 0.005, false],
        [-(w.thickness / 2 + 0.005), false],
      ] as const) {
        expect(within(solid.outline, m.x + out.x * d, m.y + out.y * d), `${w.id} at ${d}`).toBe(inside);
      }
    }
  });

  // a heavy check: every pair of walls' bodies intersected, their arcs read to a tenth of a degree
  it("butt-joints curved and straight walls alike, at any angle: corners filled, no two bodies overlapping", () => {
    const level = (id: string) => all(c, "IFCWALL").filter((e) => house.walls.find((w) => w.id === get(c, e, "Tag"))!.levelId === id);
    for (const levelId of [GROUND_LEVEL_ID, CRESCENT_FIRST_LEVEL_ID]) {
      const walls = level(levelId);
      // arcs read finely (a tenth of a degree): where an arc cap meets an arc face, the slivers between their chords are far under a square millimetre
      const outlines = walls.map((w) => solidsOf(c, w, Math.PI / 1800)[0].outline);
      const boxes = outlines.map((o) => [Math.min(...o.map((p) => p.x)), Math.max(...o.map((p) => p.x)), Math.min(...o.map((p) => p.y)), Math.max(...o.map((p) => p.y))]);
      const apart = (i: number, j: number) => boxes[i][0] > boxes[j][1] || boxes[j][0] > boxes[i][1] || boxes[i][2] > boxes[j][3] || boxes[j][2] > boxes[i][3];
      for (let i = 0; i < walls.length; i++)
        for (let j = i + 1; j < walls.length; j++) {
          if (apart(i, j)) continue;
          expect(overlap(outlines[i], outlines[j]), `${get(c, walls[i], "Tag")} × ${get(c, walls[j], "Tag")}`).toBeLessThan(1e-6);
        }
    }
    // the curved facade's two ends, and the 60° and 120° corners of the guest wing, are each filled
    const W_ = house.walls;
    const end = (id: string, e: "a" | "b") => {
      const w = W_.find((x) => x.id === id)!;
      return e === "a" ? [w.ax, w.ay] : [w.bx, w.by];
    };
    for (const [id, e] of [["g_facade", "a"], ["g_facade", "b"], ["g_wing_n", "a"], ["g_wing_s", "b"], ["g_wing_end", "a"]] as const) {
      const [x, y] = end(id, e);
      expect(all(c, "IFCWALL").filter((wall) => solidsOf(c, wall).some((sd) => within(sd.outline, x, y))).length, `${id}.${e}`).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  it("butt-joints straight walls meeting at 30, 45 and 60 degrees: each end cut along the face it meets, exactly", () => {
    for (const angle of [30, 45, 60]) {
      const r = (angle * Math.PI) / 180;
      const plan = seedLoft();
      const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({ id, levelId: GROUND_LEVEL_ID, ax, ay, bx, by, thickness: 0.2, height: 2.7 });
      // an L at the angle, and a stem meeting the long wall mid-span at the angle (a T)
      plan.walls = [wall("long", 0, 0, 6, 0), wall("leg", 0, 0, 4 * Math.cos(r), 4 * Math.sin(r)), wall("stem", 3, 0, 3 + 3 * Math.cos(r), 3 * Math.sin(r))];
      plan.openings = [];
      plan.rooms = [];
      plan.items = [];
      const k = exported(plan);
      const walls = all(k, "IFCWALL");
      const outlines = walls.map((w) => solidsOf(k, w)[0].outline);
      for (let i = 0; i < walls.length; i++)
        for (let j = i + 1; j < walls.length; j++) expect(overlap(outlines[i], outlines[j]), `${angle}°: ${get(k, walls[i], "Tag")} × ${get(k, walls[j], "Tag")}`).toBeLessThan(1e-6);
      // the L's outer corner, where the two outer faces meet, is filled; the stem's two faces end on the long wall's face
      const outer = { x: -0.1 / Math.tan(r / 2), y: -0.1 };
      const probe = { x: outer.x + Math.cos(r / 2) * 0.01, y: outer.y + Math.sin(r / 2) * 0.01 };
      expect(walls.filter((w) => solidsOf(k, w).some((s) => inside(s, probe.x, probe.y, 1))).length, `${angle}°`).toBe(1);
      const stem = outlines[walls.findIndex((w) => get(k, w, "Tag") === "stem")];
      expect(stem.filter((p) => Math.abs(p.y - 0.1) < 1e-6).length, `${angle}°`).toBe(2);
    }
  });

  it("puts every opening in a curved wall on its arc: across its chord, its void between the two radial cuts", () => {
    const onArcs = house.openings.filter((o) => curved.some((w) => w.id === o.wallId));
    expect(onArcs.some((o) => o.kind === "door")).toBe(true);
    for (const o of onArcs) {
      const w = house.walls.find((x) => x.id === o.wallId)!;
      const half = o.width / 2 / wallLength(w);
      const a = wallPointAt(w, o.t - half);
      const b = wallPointAt(w, o.t + half);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const fill = byTag(c, o.kind === "door" ? "IFCDOOR" : "IFCWINDOW", o.id);
      expect(get(c, fill, "OverallWidth") as number, o.id).toBeCloseTo(chord, 6);
      // the void's frame stands on the chord's middle, its x axis along the chord
      const v = byTag(c, "IFCOPENINGELEMENT", o.id);
      const f = frameOf(c, v);
      const [px, py] = onPlan(f.x, f.y);
      expect(Math.hypot(px - (a.x + b.x) / 2, py - (a.y + b.y) / 2), o.id).toBeLessThan(1e-6);
      expect(Math.abs(Math.sin(f.angle - Math.atan2(-(b.y - a.y), b.x - a.x))), o.id).toBeLessThan(1e-6);
      expect(f.z, o.id).toBeCloseTo(elevationOf(house, w.levelId) + o.sill, 9);
      // it cuts right through the wall at the arc's middle, and stops at the radial cuts
      const [solid] = solidsOf(c, v);
      const arc = wallArc(w)!;
      const radial = (t: number, d: number) => {
        const p = wallPointAt(w, t);
        return [p.x + ((p.x - arc.center.x) / arc.radius) * d, p.y + ((p.y - arc.center.y) / arc.radius) * d] as const;
      };
      for (const d of [0, w.thickness / 2 + 0.01, -(w.thickness / 2 + 0.01)]) expect(within(solid.outline, ...radial(o.t, d)), `${o.id} across at ${d}`).toBe(true);
      const outside = 0.01 / wallLength(w);
      expect(within(solid.outline, ...radial(o.t - half - outside, 0)), `${o.id} before its cut`).toBe(false);
      expect(within(solid.outline, ...radial(o.t + half + outside, 0)), `${o.id} past its cut`).toBe(false);
      expect(within(solid.outline, ...radial(o.t - half + outside, 0)), `${o.id} inside its cut`).toBe(true);
    }
  });

  it("draws every room's space from its outline, arcs and all: its area and perimeter are the plan's", () => {
    const shaped = house.rooms.filter((r) => !outlineRect(r.points));
    expect(shaped.some((r) => r.points.some((p) => p.bulge))).toBe(true);
    for (const r of house.rooms) {
      const space = all(c, "IFCSPACE").find((s) => get(c, s, "Name") === r.id)!;
      const foot = curveOf(representation(space, "FootPrint")!);
      const body = curveOf(representation(space, "Body")!);
      const curvedRoom = r.points.some((p) => p.bulge);
      expect(foot.type, r.id).toBe(curvedRoom ? "IFCINDEXEDPOLYCURVE" : "IFCPOLYLINE");
      expect(curveMeasure(c, foot).area, r.id).toBeCloseTo(roomArea(r), 6);
      expect(curveMeasure(c, foot).length, r.id).toBeCloseTo(outlinePerimeter(r.points), 6);
      expect(curveMeasure(c, body).area, r.id).toBeCloseTo(roomArea(r), 6);
      const q = propertiesOf(c, space, "Qto_SpaceBaseQuantities")!;
      expect(q.GrossFloorArea as number, r.id).toBeCloseTo(roomArea(r), 6);
      expect(q.GrossPerimeter as number, r.id).toBeCloseTo(outlinePerimeter(r.points), 6);
      // its finish covers it, from its own outline where no stairwell crosses it
      const finish = byTag(c, "IFCCOVERING", r.id);
      const cover = propertiesOf(c, finish, "Qto_CoveringBaseQuantities")!;
      expect(cover.GrossArea as number, r.id).toBeCloseTo(roomArea(r), 6);
      // the anchor its label goes at is inside its body
      const anchor = outlineAnchor(r.points);
      expect(solidsOf(c, space).some((s) => within(s.outline, anchor.x, anchor.y)), r.id).toBe(true);
    }
  });

  it("lays each storey's slab under its shaped rooms and walls: the 3D view's floor", () => {
    for (const levelId of [GROUND_LEVEL_ID, CRESCENT_FIRST_LEVEL_ID]) {
      const slab = byTag(c, "IFCSLAB", levelId);
      const q = propertiesOf(c, slab, "Qto_SlabBaseQuantities")!;
      const slice = { rooms: house.rooms.filter((r) => r.levelId === levelId), walls: house.walls.filter((w) => w.levelId === levelId) };
      expect(q.GrossArea as number, levelId).toBeCloseTo(piecesArea(regionPieces(slabOutline(slice))), 6);
      // under the curved facade's middle, where it bows furthest out
      const facade = slice.walls.find((w) => isCurved(w))!;
      const m = wallPointAt(facade, 0.5);
      expect(solidsAt(c, ["IFCSLAB"], m.x, m.y, -SLAB_THICKNESS / 2).length, levelId).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------- the tool

describe("export_ifc", () => {
  const downloads: { name: string; type: string; size: number }[] = [];
  beforeEach(() => {
    resetStore();
    downloads.length = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const b = blob as Blob;
      downloads.push({ name: "", type: b.type, size: b.size });
      return "blob:ifc";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads[downloads.length - 1].name = this.download;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  /** The pending request, once the call has parked it. */
  const pending = async () => {
    for (let i = 0; i < 20 && store.getState().approvals.length === 0; i++) await flush();
    return store.getState().approvals[0];
  };

  it("asks the human first, then downloads the plan as an .ifc and tells the agent what it holds, not the file", async () => {
    store.setState({ model: seedTownhouse() });
    const call = runTool("export_ifc", {}, "agent");
    const ask = await pending();
    expect(ask).toMatchObject({ tool: "export_ifc", actor: "agent", targets: [{ type: "file", id: "hillside-townhouse.ifc", label: "hillside-townhouse.ifc" }] });
    await flush();
    expect(downloads).toHaveLength(0);
    pageActions.resolveApproval(ask.id, true);
    const r = await call;
    await flush();
    expect(r.ok).toBe(true);
    expect(downloads).toEqual([{ name: "hillside-townhouse.ifc", type: "application/x-step", size: expect.any(Number) }]);
    expect(r).toMatchObject({ ifc: { schema: "IFC4", fileName: "hillside-townhouse.ifc", bytes: downloads[0].size, elements: { storeys: 2, stairs: 1 } } });
    expect(r.summary).toMatch(/^IFC4 file "hillside-townhouse\.ifc" \(\d+\.\d kB\) downloaded for the human: 2 storeys, 9 walls/);
    expect(JSON.stringify(r)).not.toContain("ISO-10303-21");
  });

  it("downloads nothing when the human declines, and asks even with the approval policy off", async () => {
    store.setState({ model: seedLoft(), requireApproval: false });
    const call = runTool("export_ifc", {}, "agent");
    const ask = await pending();
    expect(ask?.tool).toBe("export_ifc");
    pageActions.resolveApproval(ask.id, false);
    const r = await call;
    await flush();
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/declined/);
    expect(downloads).toHaveLength(0);
  });

  it("answers a plan it will not write with the reason, and downloads nothing", async () => {
    const plan = seedLoft();
    plan.walls[0] = { ...plan.walls[0], thickness: 0 };
    store.setState({ model: plan });
    const call = runTool("export_ifc", {}, "agent");
    pageActions.resolveApproval((await pending()).id, true);
    const r = await call;
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/wall wall_n: thickness must be a finite number from 0\.02 to 1 m \(got 0\)/);
    expect(downloads).toHaveLength(0);
    expect(store.getState().model).toBe(plan);
  });

  it("refuses arguments", async () => {
    const r = await runTool("export_ifc", { level: "x" }, "agent");
    expect(r.ok).toBe(false);
    expect(store.getState().approvals).toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });
});

describe("bows too slight to be arcs", () => {
  // a bow given as its sagitta on the loft's first wall and its first room's first edge
  const bowed = (sagitta: number): PlanModel => {
    const loft = seedLoft();
    const room = loft.rooms[0];
    const bulgeOn = (a: { x: number; y: number }, b: { x: number; y: number }) => (2 * sagitta) / Math.hypot(b.x - a.x, b.y - a.y);
    return {
      ...loft,
      walls: loft.walls.map((w, i) => (i === 0 ? { ...w, bulge: bulgeOn({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }) } : w)),
      rooms: loft.rooms.map((r) => (r === room ? { ...r, points: r.points.map((p, i) => (i === 0 ? { ...p, bulge: bulgeOn(p, r.points[1]) } : p)) } : r)),
    };
  };

  it("writes a wall and a room edge bowed under the file's precision as straight: lines, not arcs through three points on one line", () => {
    for (const sagitta of [3e-8, 1e-7, 1e-6, STRAIGHT_SAGITTA * 0.9]) {
      const { text } = exported(bowed(sagitta));
      expect(text, `sagitta ${sagitta}`).not.toMatch(/IFCARCINDEX/);
    }
  });

  it("writes a bow at the file's precision and past it as arcs the checker accepts", () => {
    for (const sagitta of [STRAIGHT_SAGITTA * 1.1, 1e-4, 1e-3]) expect(exported(bowed(sagitta)).text, `sagitta ${sagitta}`).toMatch(/IFCARCINDEX/);
  });
});

describe("IFC export of columns over open ground: the Crescent House's carport", () => {
  const house = seedCrescent();
  const c = exported(house);
  const ground = house.levels[0];
  /** a product's Body representation */
  const bodyOf = (check: IfcCheck, e: StepEntity): StepEntity =>
    refs(check.deref(check.attr(e, "Representation"))!.attrs[2])
      .map((r) => check.deref(r)!)
      .find((rep) => get(check, rep, "RepresentationIdentifier") === "Body")!;

  it("writes every column as an IfcColumn: its section extruded to the slab over it, load bearing, in concrete", () => {
    const columns = all(c, "IFCCOLUMN");
    expect(columns).toHaveLength(house.columns.length);
    expect(house.columns.length).toBeGreaterThan(0);
    expect(writeIfc(house, { now: NOW }).summary.elements.columns).toBe(house.columns.length);
    const height = slabUnderside(ground.height);
    for (const col of house.columns) {
      const e = byTag(c, "IFCCOLUMN", col.id);
      expect(get(c, e, "PredefinedType")).toBe("COLUMN");
      expect(c.storeyOf.get(e.id), col.id).toBeDefined();
      const [solid] = solidsOf(c, e);
      expect(solid.z0).toBeCloseTo(0, 9);
      expect(solid.z1).toBeCloseTo(height, 9);
      // its footprint is the plan's section, where it stands
      const xs = solid.outline.map((p) => p.x);
      const ys = solid.outline.map((p) => p.y);
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual(
        [col.x - col.w / 2, col.x + col.w / 2, col.y - col.d / 2, col.y + col.d / 2].map((v) => Math.round(v * 1e6) / 1e6),
      );
      expect(propertiesOf(c, e, "Pset_ColumnCommon")).toMatchObject({ Reference: col.id, LoadBearing: true, IsExternal: true });
      const q = propertiesOf(c, e, "Qto_ColumnBaseQuantities")!;
      expect(q.Length as number).toBeCloseTo(height, 9);
      expect(q.CrossSectionArea as number).toBeCloseTo(col.w * col.d, 9);
      expect(q.GrossVolume as number).toBeCloseTo(col.w * col.d * height, 9);
    }
    const rel = all(c, "IFCRELASSOCIATESMATERIAL").find((r) => refs(c.attr(r, "RelatedObjects")).some((o) => c.deref(o)!.type === "IFCCOLUMN"))!;
    expect(get(c, c.deref(c.attr(rel, "RelatingMaterial"))!, "Name")).toBe("Concrete");
    expect(refs(c.attr(rel, "RelatedObjects"))).toHaveLength(house.columns.length);
  });

  it("writes a wall a column stands in less the column: a CSG body, no two bodies overlapping, its footprint less the column's", () => {
    const inWall = house.columns.find((col) => columnWalls(house.walls, col).length > 0)!;
    expect(inWall).toBeDefined();
    const [w] = columnWalls(house.walls, inWall);
    const e = byTag(c, "IFCWALL", w.id);
    expect(get(c, bodyOf(c, e), "RepresentationType")).toBe("CSG");
    const [solid] = solidsOf(c, e);
    expect(solid.less).toHaveLength(1);
    // the column's solid reaches past the wall's foot and top, so the boolean leaves no skin
    expect(solid.less[0].z0).toBeLessThan(solid.z0);
    expect(solid.less[0].z1).toBeGreaterThan(solid.z1);
    // at the column's middle, half way up: the column, and not the wall
    const z = 1.2;
    expect(solidsAt(c, ["IFCWALL", "IFCCOLUMN"], inWall.x, inWall.y, z).map((x) => x.type)).toEqual(["IFCCOLUMN"]);
    // a step back along the wall: the wall, and not the column
    expect(solidsAt(c, ["IFCWALL", "IFCCOLUMN"], inWall.x - inWall.w / 2 - 0.05, inWall.y, z).map((x) => get(c, x, "Tag"))).toEqual([w.id]);
    // the wall's quantities are the body's: its footprint less the column's share of it
    const q = propertiesOf(c, e, "Qto_WallBaseQuantities")!;
    const full = piecesArea(regionPieces([solid.outline]));
    const shared = full - piecesArea(regionPieces([solid.outline], [solid.less[0].outline]));
    expect(shared).toBeGreaterThan(0);
    expect(q.GrossFootprintArea as number).toBeCloseTo(full - shared, 3);
    // the column takes the wall's whole thickness at its end: the body's run, side and volume are less it too
    const [post] = wallPosts(w, [inWall], house);
    const taken = (Math.min(post.t1, 1) - Math.max(post.t0, 0)) * wallLength(w);
    expect(taken).toBeGreaterThan(0);
    const run = Math.max(...solid.outline.map((p) => p.x)) - Math.min(...solid.outline.map((p) => p.x));
    expect(q.Length as number).toBeCloseTo(run - taken, 6);
    expect(q.GrossSideArea as number).toBeCloseTo((q.Length as number) * w.height, 6);
    expect(q.GrossVolume as number).toBeCloseTo((q.GrossFootprintArea as number) * w.height, 6);
    // every other wall is still a plain swept solid
    expect(all(c, "IFCSHAPEREPRESENTATION").filter((rep) => get(c, rep, "RepresentationType") === "CSG")).toHaveLength(1);
  });

  it("writes the carport as an outside space where a car parks, under the studio's floor", () => {
    const carport = house.rooms.find((r) => r.kind === "open")!;
    const space = (id: string) => all(c, "IFCSPACE").find((x) => get(c, x, "Name") === id)!;
    expect(get(c, space(carport.id), "PredefinedType")).toBe("PARKING");
    expect(propertiesOf(c, space(carport.id), "Pset_SpaceCommon")).toMatchObject({ IsExternal: true });
    // every enclosed room stays a SPACE, inside
    for (const r of house.rooms.filter((x) => x.kind !== "open")) {
      expect(get(c, space(r.id), "PredefinedType"), r.id).toBe("SPACE");
      expect(propertiesOf(c, space(r.id), "Pset_SpaceCommon"), r.id).toMatchObject({ IsExternal: false });
    }
    // over the middle of the carport: the first floor's slab, its underside the carport's ceiling
    const box = outlineBounds(carport.points);
    const [x, y] = [box.x + box.w / 2, box.y + box.h / 2];
    const elevation = elevationOf(house, CRESCENT_FIRST_LEVEL_ID);
    expect(solidsAt(c, ["IFCSLAB"], x, y, elevation - SLAB_THICKNESS / 2).map((e) => get(c, e, "Tag"))).toEqual([CRESCENT_FIRST_LEVEL_ID]);
    expect(solidsAt(c, ["IFCSLAB"], x, y, elevation - SLAB_THICKNESS - 0.01)).toHaveLength(0);
  });

  it("writes the sectional garage door as an IfcDoor whose operation IFC4 has no value for, facing its wall", () => {
    const gd = house.openings.find((o) => o.style === "garage")!;
    const e = byTag(c, "IFCDOOR", gd.id);
    expect(get(c, e, "PredefinedType")).toBe("DOOR");
    expect(get(c, e, "OperationType")).toBe("USERDEFINED");
    expect(get(c, e, "UserDefinedOperationType")).toBe("SECTIONAL");
    expect(get(c, e, "OverallWidth") as number).toBeCloseTo(gd.width, 9);
    expect(get(c, e, "OverallHeight") as number).toBeCloseTo(gd.height, 9);
    // no swing to face: its placement keeps its opening's axes
    const placement = c.deref(c.attr(e, "ObjectPlacement"))!;
    expect(c.deref(placement.attrs[1])!.attrs[2].t).toBe("unset");
    // every hinged door keeps an operation IFC4 names, and none of its own
    for (const d of all(c, "IFCDOOR").filter((x) => x !== e)) {
      expect(get(c, d, "OperationType")).not.toBe("USERDEFINED");
      expect(get(c, d, "UserDefinedOperationType")).toBeNull();
    }
    // the checker holds the two together
    expect(checkIfc(c.text.replace(/'SECTIONAL'/, "$")).errors.join()).toMatch(/OperationType USERDEFINED with UserDefinedOperationType unset/);
  });

  it("writes the car as furniture: its catalogue box, its kind its object type", () => {
    const car = house.items.find((i) => i.kind === "car")!;
    const e = byTag(c, "IFCFURNITURE", car.id);
    expect(get(c, e, "ObjectType")).toBe("car");
    expect(get(c, e, "Name")).toBe("Car");
    const [solid] = solidsOf(c, e);
    expect(solid.z1 - solid.z0).toBeCloseTo(1.5, 9);
    expect(piecesArea(regionPieces([solid.outline]))).toBeCloseTo(1.8 * 4.5, 6);
  });

  it("cuts a column shorter than its wall only up to its top: the wall stays whole over it, its volume less the column's share up to there", () => {
    const inWall = house.columns.find((col) => columnWalls(house.walls, col).length > 0)!;
    const [w] = columnWalls(house.walls, inWall);
    const short = 1;
    const plan: PlanModel = { ...house, columns: house.columns.map((col) => (col.id === inWall.id ? { ...col, height: short } : col)) };
    const s = exported(plan);
    const e = byTag(s, "IFCWALL", w.id);
    const [solid] = solidsOf(s, e);
    expect(solid.less).toHaveLength(1);
    // from under the wall's foot to the column's own top, and not past it
    expect(solid.less[0].z0).toBeLessThan(solid.z0);
    expect(solid.less[0].z1).toBeCloseTo(short, 9);
    // over the column, the wall; under its top, the column alone
    expect(solidsAt(s, ["IFCWALL", "IFCCOLUMN"], inWall.x, inWall.y, short + 0.5).map((x) => get(s, x, "Tag"))).toEqual([w.id]);
    expect(solidsAt(s, ["IFCWALL", "IFCCOLUMN"], inWall.x, inWall.y, short / 2).map((x) => x.type)).toEqual(["IFCCOLUMN"]);
    const q = propertiesOf(s, e, "Qto_WallBaseQuantities")!;
    const full = piecesArea(regionPieces([solid.outline]));
    const shared = full - piecesArea(regionPieces([solid.outline], [solid.less[0].outline]));
    expect(q.GrossFootprintArea as number).toBeCloseTo(full - shared, 3);
    expect(q.GrossVolume as number).toBeCloseTo(full * w.height - shared * short, 3);
    // a wall the column stops in is not shortened: it runs on over the column
    const run = Math.max(...solid.outline.map((p) => p.x)) - Math.min(...solid.outline.map((p) => p.x));
    expect(q.Length as number).toBeCloseTo(run, 6);
  });

  it("writes a column in an inside partition as inside, one in an outside wall or out in the open as outside", () => {
    const partition = house.walls.find((w) => w.id === "f_x5")!;
    const plan: PlanModel = {
      ...house,
      columns: [
        ...house.columns,
        // on the partition between two first-floor rooms, and free in the middle of one
        { id: "in_partition", levelId: CRESCENT_FIRST_LEVEL_ID, shape: "square", x: partition.ax, y: (partition.ay + partition.by) / 2, w: 0.3, d: 0.3, rotation: 0 },
      ],
    };
    const room = house.rooms.find((r) => r.levelId === GROUND_LEVEL_ID && r.kind !== "open" && outlineAnchor(r.points).clearance > 0.6)!;
    const anchor = outlineAnchor(room.points);
    plan.columns.push({ id: "in_room", levelId: GROUND_LEVEL_ID, shape: "circle", x: anchor.x, y: anchor.y, w: 0.3, d: 0.3, rotation: 0 });
    const s = exported(plan);
    const external = (id: string) => propertiesOf(s, byTag(s, "IFCCOLUMN", id), "Pset_ColumnCommon")!.IsExternal;
    expect(wallIsExternal(partition, plan.rooms.filter((r) => r.levelId === partition.levelId))).toBe(false);
    expect(external("in_partition")).toBe(false);
    expect(external("in_room")).toBe(false);
    // the carport's, in its outside wall and out in the open
    for (const col of house.columns) expect(external(col.id), col.id).toBe(true);
    expect(columnIsExternal(house.columns[0], house.walls, house.rooms)).toBe(true);
  });

  it("writes a round column with a circle profile, and a rotated one turned as the plan turns it", () => {
    const plan: PlanModel = {
      ...house,
      columns: [
        { id: "round", levelId: GROUND_LEVEL_ID, shape: "circle", x: 30, y: 0, w: 0.4, d: 0.4, rotation: 0 },
        { id: "turned", levelId: GROUND_LEVEL_ID, shape: "rectangle", x: 32, y: 0, w: 0.5, d: 0.25, rotation: 30 },
      ],
    };
    const r = exported(plan);
    const round = byTag(r, "IFCCOLUMN", "round");
    const item = r.deref(refs(r.attr(bodyOf(r, round), "Items"))[0])!;
    const profile = r.deref(r.attr(item, "SweptArea"))!;
    expect(profile.type).toBe("IFCCIRCLEPROFILEDEF");
    expect(get(r, profile, "Radius") as number).toBeCloseTo(0.2, 9);
    expect(propertiesOf(r, round, "Qto_ColumnBaseQuantities")!.CrossSectionArea as number).toBeCloseTo(Math.PI * 0.04, 6);
    // its corners are the plan's (model/columns.ts columnFootprint), wherever they are listed from
    const [turned] = solidsOf(r, byTag(r, "IFCCOLUMN", "turned"));
    for (const corner of columnFootprint(plan.columns[1])) expect(Math.min(...turned.outline.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)))).toBeLessThan(1e-6);
  });
});
