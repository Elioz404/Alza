/**
 * The IFC export: the STEP writer's encoding, the GlobalIds, and the plan's mapping, every file
 * read back and checked by a checker written apart from the exporter (support/ifcCheck.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedText, encodeString, formatReal, positiveLength, StepFile, str, real, int, enumv, UNSET, DERIVED, list, typed, bool } from "../src/export/ifc/step";
import { compressGuid, ifcGuid, GuidRegistry, IFC_GUID } from "../src/export/ifc/guid";
import { IfcExportRefused, writeIfc } from "../src/export/ifc";
import { doorFacing, doorOperation, wallIsExternal } from "../src/export/ifc/model";
import { cleanText } from "../src/model/text";
import { exportFileName } from "../src/export/download";
import { seedLoft, seedTownhouse, FIRST_LEVEL_ID } from "../src/model/seed";
import { migratePlan } from "../src/model/planFormat";
import { stairGeometry } from "../src/model/stairs";
import { piecesArea, regionPieces, type Poly } from "../src/model/region";
import { slabOutline } from "../src/model/floors";
import { FLOOR_FINISH_DEPTH, GROUND_LEVEL_ID, SLAB_THICKNESS, SUPPLIER, TEXT } from "../src/model/limits";
import { slabUnderside } from "../src/model/levels";
import { supplierKind } from "../src/model/catalog";
import type { Opening, PlanModel } from "../src/model/types";
import { checkIfc, decodeStepString, readStep, type IfcCheck, type StepEntity, type StepValue } from "./support/ifcCheck";
import { store, pageActions } from "../src/model/store";
import { runTool } from "../src/mcp/tools";
import { resetStore, flush } from "./support/store";

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

/** One extruded solid of a product's body, in the world: its outline seen from above (plan coordinates) and its height range. */
interface Solid {
  outline: Poly;
  z0: number;
  z1: number;
}
function solidsOf(c: IfcCheck, product: StepEntity): Solid[] {
  const frame = frameOf(c, product);
  const shape = c.deref(c.attr(product, "Representation"));
  if (!shape) return [];
  const body = refs(shape.attrs[2]).map((r) => c.deref(r)!).find((rep) => get(c, rep, "RepresentationIdentifier") === "Body");
  if (!body) return [];
  return refs(c.attr(body, "Items")).map((r) => {
    const solid = c.deref(r)!;
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
    } else {
      const curve = c.deref(c.attr(profile, "OuterCurve"))!;
      local = refs(curve.attrs[0]).map((p) => numbers(c, p) as [number, number]).slice(0, -1);
    }
    const outline = local.map(([x, y]) => {
      const w = compose(at, x, y, 0, 0);
      const [planX, planY] = onPlan(w.x, w.y);
      return { x: planX, y: planY };
    });
    return { outline, z0: at.z, z1: at.z + (get(c, solid, "Depth") as number) };
  });
}
/** Whether plan point (x, y) at height z is inside a convex outline's prism. */
function inside(s: Solid, x: number, y: number, z: number): boolean {
  if (z < s.z0 || z > s.z1) return false;
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
      ["room width 0", (p) => (p.rooms[0] = { ...p.rooms[0], w: 0 }), /room room_living: w /],
      ["room width -3", (p) => (p.rooms[0] = { ...p.rooms[0], w: -3 }), /room room_living: w /],
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
    const v1 = { name: loft.name, walls: loft.walls.map(unlevelled), openings: loft.openings, rooms: loft.rooms.map(unlevelled), items: loft.items.map(unlevelled), kinds: [], underlay: null };
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
