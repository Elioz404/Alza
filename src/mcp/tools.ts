/**
 * The 26 WebMCP tools (+ 1 dynamic, registered in bootstrap.ts).
 * Every tool calls THE SAME actions the UI buttons use — one store, human and agent co-edit.
 * Arguments accept human names ("bedroom", "sofa") as well as ids.
 */

import { actions, store, type ActionResult } from "../model/store";
import { checkModel } from "../model/issues";
import { CATALOG } from "../model/catalog";
import { SUPPLIER_ORIGIN, getProduct, listProducts } from "./supplier";
import { dist, segLen } from "../model/geometry";
import { bus, EVENTS } from "../three/exportBus";
import { executeWrapped, type ToolDef } from "./registry";

const num = { type: "number" } as const;
const str = { type: "string" } as const;

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/**
 * The house rule for reproducing someone's plan. It travels with `get_underlay` because that is
 * the tool an agent reaches for the moment a drawing is involved: the default is FIDELITY —
 * copy what is drawn, at the size it is drawn, and model anything the catalogue is missing.
 */
export const TRACING_PROTOCOL: string[] = [
  "1. Calibrate first, and get the drawing into BOTH places. You need it uploaded on the page (that is what carries the scale) AND pasted into your conversation (that is the only way you can see it) — get_underlay returns the mapping, never the pixels. Then ask the human for ONE real dimension and call calibrate_underlay with two points on the image and that distance. Measure in fractions of the image, never in pixels, and convert with the `mapping` get_underlay hands you. Note the order: clear_model also clears the underlay, so empty the plan BEFORE the image is loaded, never after.",
  "2. Copy the drawing, do not redesign it. Reproduce the walls, openings and rooms that are actually drawn — the same count, the same positions, the same proportions. Do not add rooms, move doors to where they would be tidier, or 'improve' the layout. If something in the drawing is ambiguous, place your best reading and say so with leave_note rather than inventing.",
  "3. Structure before contents: outer walls, then partitions (add_wall), then openings on the walls that carry them (add_door / add_window), then rooms (add_room), then furniture.",
  "4. Match every opening to its drawing. Doors and windows go where the plan puts them, at the width the plan shows, and add_door's `hinge` and `side` must match the swing arc drawn on the paper.",
  "5. Furnish what is drawn, piece by piece. Every symbol on the plan becomes an item — no more, no fewer. Match its position, its orientation (rotation is which way the piece FACES) and its real size.",
  "6. Never approximate a distinctive symbol with the nearest stock item. If the plan shows a corner bath, an L-shaped sofa, a piano or a kitchen island and the catalogue has no such kind, call define_item_kind to model it at the size the plan draws — optionally with `parts` for real 3D geometry — and then place it. get_item_catalog is a convenience, not a constraint.",
  "7. Sit furniture against the walls the drawing sits it against: offset the centre by depth/2 from the wall FACE (centreline ± thickness/2), not from the centreline.",
  "8. Verify, then repair. Call get_issues, fix every error it reports, and call it again until only intentional warnings remain. Finish with build_3d so the human sees the result.",
];

export const TOOLS: ToolDef[] = [
  // ------------------------------------------------------------------ reads
  {
    name: "get_model",
    description:
      "Read the full floor plan: walls (endpoints, thickness, height), openings (doors/windows with position along their wall), rooms (metric rects with labels), furniture, and plan name. All units are meters.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const m = store.getState().model;
      return {
        ok: true,
        summary: `Plan "${m.name}": ${m.walls.length} walls, ${m.openings.length} openings, ${m.rooms.length} rooms, ${m.items.length} items.`,
        model: m,
      };
    },
  },
  {
    name: "get_issues",
    description:
      "Run the constraint checker over the plan. Detects: too-short walls, loose ends, collinear overlaps, mid-span crossings, openings overflowing their wall or overlapping each other, walls ending inside an opening, floating/overlapping/doorless rooms, furniture crossing walls, blocking doors/windows, or colliding. Use it after editing to self-repair.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const issues = checkModel(store.getState().model);
      return {
        ok: true,
        summary: issues.length === 0 ? "0 issues — the plan is clean." : `${issues.length} issue(s) found.`,
        issues,
      };
    },
  },
  {
    name: "get_item_catalog",
    description: "List the furniture catalog: kind, label, footprint (width × depth in meters) and height.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => ({
      ok: true,
      summary: `${CATALOG.length} furniture kinds available.`,
      catalog: CATALOG.map(({ kind, label, w, d, h, category }) => ({ kind, label, w, d, h, category })),
    }),
  },
  {
    name: "get_editor_state",
    description:
      "Read what the human is doing right now: 2D/3D view, camera mode, selected wall/item/room, current draw mode.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const e = store.getState().editor;
      return { ok: true, summary: `View ${e.view}, camera ${e.camera}, selected wall: ${e.selectedWallId ?? "none"}.`, editor: e };
    },
  },
  {
    name: "measure",
    description:
      "Measure a distance: between two points (x1,y1)-(x2,y2), or the length of a wall by id. Returns meters.",
    inputSchema: obj(
      { x1: num, y1: num, x2: num, y2: num, wallId: str },
      [],
    ),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      if (i.wallId) {
        const w = store.getState().model.walls.find((x) => x.id === i.wallId || x.id.includes(i.wallId as string));
        if (!w) return { ok: false, summary: `Wall "${i.wallId}" not found.` };
        const len = segLen(w.ax, w.ay, w.bx, w.by);
        return { ok: true, summary: `Wall ${w.id} is ${len.toFixed(2)} m long.`, meters: len };
      }
      const d = dist({ x: i.x1 as number, y: i.y1 as number }, { x: i.x2 as number, y: i.y2 as number });
      return { ok: true, summary: `Distance: ${d.toFixed(2)} m.`, meters: d };
    },
  },
  {
    name: "get_underlay",
    title: "Blueprint underlay + tracing protocol",
    description:
      "Read the blueprint underlay: whether a reference plan image is loaded, the world rectangle it covers (metres), the mapping from image fractions to world coordinates — and the PROTOCOL for tracing it. Call this FIRST whenever the human gives you a plan to reproduce. Tracing needs the drawing in two places and this tool tells you which are missing: uploaded on the page (carries the scale) and pasted into your conversation (the only way you can see it). This tool never returns the pixels — it returns where the drawing sits in world metres so you can convert what you measure on your own copy. Measure in fractions of the image, not pixels: the page holds a resized copy.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const u = store.getState().model.underlay;
      if (!u)
        return {
          ok: true,
          summary:
            'No underlay loaded. Tracing needs the drawing in TWO places, and neither replaces the other: ' +
            '(1) ask the human to upload it on the page via sidebar → "Blueprint underlay" — that is what sets the scale ' +
            'and lets them watch your walls land on it; and (2) ask them to paste the SAME image into this conversation, ' +
            'because this tool returns the scale and the mapping, never the pixels — you cannot see the drawing otherwise.',
          loaded: false,
          needs: [
            'human uploads the image on the page (sidebar → "Blueprint underlay") — sets the scale',
            'human pastes the same image into this conversation — so you can read it',
            'human gives you ONE real dimension on the drawing — so calibrate_underlay can be true',
          ],
          protocol: TRACING_PROTOCOL,
        };
      return {
        ok: true,
        summary: `Underlay covers x ${u.x.toFixed(2)}..${(u.x + u.w).toFixed(2)}, y ${u.y.toFixed(2)}..${(u.y + u.h).toFixed(2)} (${u.w.toFixed(2)} × ${u.h.toFixed(2)} m), opacity ${u.opacity}. Read the drawing from the copy in your conversation, measure in FRACTIONS of it, and convert with "mapping". Follow the "protocol" field to reproduce it faithfully.`,
        loaded: true,
        rect: { x: u.x, y: u.y, w: u.w, h: u.h },
        opacity: u.opacity,
        // The page re-encodes uploads to <=1600 px, so its copy is usually a different
        // pixel size from the file the human pasted into the conversation. Fractions are
        // identical in both, which is why the mapping is expressed in fractions.
        pageImagePixels: u.pw && u.ph ? { w: u.pw, h: u.ph } : null,
        mapping: {
          howToMeasure:
            'Measure on YOUR copy of the image as fractions of its width and height: u = x_px / image_width, v = y_px / image_height, both 0..1 from the top-left corner.',
          toWorld: 'world_x = rect.x + u * rect.w ; world_y = rect.y + v * rect.h',
          metresPerFullWidth: u.w,
          metresPerFullHeight: u.h,
          warning:
            'Do not reuse pixel numbers across the two copies: the page holds a resized one. Fractions are safe, pixels are not.',
        },
        protocol: TRACING_PROTOCOL,
      };
    },
  },
  {
    name: "calibrate_underlay",
    description:
      "Scale the loaded blueprint image to real-world meters. Give two points on the image as fractions (u, v in 0..1; u = right, v = down) and the REAL distance between them in meters (e.g. a dimension printed on the plan). The underlay is resized preserving aspect, keeping the first point fixed. Call after the human uploads the plan, before tracing walls over it.",
    inputSchema: obj({ u1: num, v1: num, u2: num, v2: num, meters: num, opacity: num }, ["u1", "v1", "u2", "v2", "meters"]),
    execute: (i) =>
      actions.calibrateUnderlay(i.u1 as number, i.v1 as number, i.u2 as number, i.v2 as number, i.meters as number, i.opacity as number | undefined),
  },

  // ------------------------------------------------------------------ walls
  {
    name: "add_wall",
    description:
      "Add a wall segment from (ax,ay) to (bx,by) in meters. Coordinates snap to a 5 cm grid. Default thickness 0.15 m (use 0.1 for interior), height 2.7 m.",
    inputSchema: obj(
      { ax: num, ay: num, bx: num, by: num, thickness: num, height: num },
      ["ax", "ay", "bx", "by"],
    ),
    execute: (i) =>
      actions.addWall(i.ax as number, i.ay as number, i.bx as number, i.by as number, i.thickness as number | undefined, i.height as number | undefined),
  },
  {
    name: "edit_wall",
    description: "Move endpoints or change thickness/height of an existing wall (by id). Endpoints snap to 5 cm.",
    inputSchema: obj(
      { id: str, ax: num, ay: num, bx: num, by: num, thickness: num, height: num },
      ["id"],
    ),
    execute: (i) => actions.editWall(i.id as string, i as never),
  },
  {
    name: "remove_wall",
    description: "Remove a wall by id. Its doors and windows are removed too.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `delete wall ${i.id} (and every door and window on it)`,
    execute: (i) => actions.removeWall(i.id as string),
  },

  // ------------------------------------------------------------------ openings
  {
    name: "add_door",
    description:
      "Add a door on a wall. t is the position of the door CENTER along the wall (0..1). Default width 0.9 m, height 2.1 m; a door wider than 1.2 m is built as a double door with two leaves. The vano is clamped so it always fits inside the wall; too-wide doors are rejected with the wall length. hinge picks the jamb the hinges sit on (\"a\" = the wall's A end, the default; \"b\" = the B end) and side picks which way the leaf swings, as seen walking the wall from A to B: \"right\" (default) or \"left\". Match these to the swing arc drawn on the plan.",
    inputSchema: obj(
      {
        wallId: str,
        t: num,
        width: num,
        height: num,
        hinge: { type: "string", enum: ["a", "b"] },
        side: { type: "string", enum: ["left", "right"] },
      },
      ["wallId", "t"],
    ),
    execute: (i) =>
      actions.addOpening("door", i.wallId as string, i.t as number, i.width as number | undefined, 0, i.height as number | undefined, {
        hinge: i.hinge as "a" | "b" | undefined,
        side: i.side as "left" | "right" | undefined,
      }),
  },
  {
    name: "set_door_swing",
    description:
      "Change how an existing door opens: hinge (\"a\" | \"b\" — which jamb carries the hinges) and/or side (\"left\" | \"right\" — which way the leaf swings, walking the wall from its A endpoint to its B endpoint). Re-run build_3d to see it.",
    inputSchema: obj({ id: str, hinge: { type: "string", enum: ["a", "b"] }, side: { type: "string", enum: ["left", "right"] } }, ["id"]),
    execute: (i) => actions.setDoorSwing(i.id as string, i.hinge as "a" | "b" | undefined, i.side as "left" | "right" | undefined),
  },
  {
    name: "add_window",
    description:
      "Add a window on a wall. t is the position of the window CENTER along the wall (0..1). Default width 1.2 m, sill 0.9 m, height 1.2 m. The vano is clamped to fit.",
    inputSchema: obj({ wallId: str, t: num, width: num, sill: num, height: num }, ["wallId", "t"]),
    execute: (i) =>
      actions.addOpening("window", i.wallId as string, i.t as number, i.width as number | undefined, i.sill as number | undefined, i.height as number | undefined),
  },
  {
    name: "move_opening",
    description: "Move a door or window along its wall to a new center position t (0..1). Clamped to fit.",
    inputSchema: obj({ id: str, t: num }, ["id", "t"]),
    execute: (i) => actions.moveOpening(i.id as string, i.t as number),
  },
  {
    name: "remove_opening",
    description: "Remove a door or window by id.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove opening ${i.id}`,
    execute: (i) => actions.removeOpening(i.id as string),
  },

  // ------------------------------------------------------------------ rooms
  {
    name: "add_room",
    description:
      "Add a room: a metric rectangle (x, y = top-left corner, w, h in meters) with a label and floor finish (oak | tile | carpet | concrete).",
    inputSchema: obj(
      { x: num, y: num, w: num, h: num, label: str, floor: str },
      ["x", "y", "w", "h", "label"],
    ),
    execute: (i) => actions.addRoom(i.x as number, i.y as number, i.w as number, i.h as number, i.label as string, i.floor as string | undefined),
  },
  {
    name: "update_room",
    description: "Update a room by id or label (e.g. \"bedroom\"): move, resize, relabel, or change floor finish.",
    inputSchema: obj(
      { id: str, x: num, y: num, w: num, h: num, label: str, floor: str },
      ["id"],
    ),
    execute: (i) => actions.updateRoom(i.id as string, i as never),
  },
  {
    name: "remove_room",
    description: "Remove a room by id or label.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the room "${i.id}"`,
    execute: (i) => actions.removeRoom(i.id as string),
  },

  // ------------------------------------------------------------------ furniture
  {
    name: "place_item",
    description:
      "Place furniture from the catalog at (x, y) = center in meters. rotation (degrees, counterclockwise) sets which way the piece FACES: 0 = faces +y (down/south on the plan), 90 = faces +x (right/east), 180 = faces -y (up/north), 270 = faces -x (left/west). The back of a sofa, bed headboard, wardrobe or counter is opposite the facing direction — so a sofa against the SOUTH wall needs rotation 180, and one against the WEST wall needs rotation 90. To sit a piece flush against a wall, offset its center by depth/2 from the wall FACE (centerline ± thickness/2), not from the centerline. Use get_item_catalog for footprints; get_issues reports crossings and blocked doors.",
    inputSchema: obj({ kind: str, x: num, y: num, rotation: num }, ["kind", "x", "y"]),
    execute: (i) => actions.placeItem(i.kind as string, i.x as number, i.y as number, i.rotation as number | undefined),
  },
  {
    name: "define_item_kind",
    title: "Model a new piece of furniture",
    description:
      "Create a piece of furniture that is NOT in the catalogue, then place it with place_item. Use this whenever the plan draws something the catalogue does not have, or draws it at a different size — a corner bath, an L-shaped sofa, a kitchen island, a piano. Do NOT approximate with the nearest stock item when the plan shows something specific: define the real thing. " +
      "Required: kind (a stable snake_case id), label, and the true footprint w × d and height h in METRES. " +
      "Optional `parts` models it in 3D from primitives; without it the piece is blocked out from its footprint. Each part is { shape: \"box\" | \"cylinder\" | \"sphere\", x, y, z, w, h, d, color, rotation }, in the piece's OWN local frame: x runs along its width, z along its depth, y is height above the floor and is the part's BOTTOM (a 0.4 m tall seat resting on the floor is y:0, h:0.4). The piece faces +z, so a backrest sits at negative z and the front is positive z — that keeps it consistent with the rotation convention in place_item. For a cylinder, w is the diameter and d makes it an ellipse. Sizes are metres, colours are hex.",
    inputSchema: obj(
      {
        kind: str,
        label: str,
        w: num,
        d: num,
        h: num,
        color: str,
        category: { type: "string", enum: ["living", "bedroom", "kitchen", "bath", "office", "decor"] },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              shape: { type: "string", enum: ["box", "cylinder", "sphere"] },
              x: num,
              y: num,
              z: num,
              w: num,
              h: num,
              d: num,
              color: str,
              rotation: num,
            },
            required: [],
            additionalProperties: false,
          },
        },
      },
      ["kind", "label", "w", "d", "h"],
    ),
    execute: (i) =>
      actions.defineItemKind({
        kind: i.kind as string,
        label: i.label as string,
        w: i.w as number,
        d: i.d as number,
        h: i.h as number,
        color: i.color as string | undefined,
        category: i.category as string | undefined,
        parts: i.parts as never,
      }),
  },
  {
    name: "move_item",
    description: "Move or rotate a furniture item by id or kind (e.g. \"sofa\"). Same rotation convention as place_item: 0 faces +y, 90 faces +x, 180 faces -y, 270 faces -x.",
    inputSchema: obj({ id: str, x: num, y: num, rotation: num }, ["id"]),
    execute: (i) => actions.moveItem(i.id as string, i.x as number | undefined, i.y as number | undefined, i.rotation as number | undefined),
  },
  {
    name: "remove_item",
    description: "Remove a furniture item by id or kind.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the ${i.id}`,
    execute: (i) => actions.removeItem(i.id as string),
  },

  // ------------------------------------------------------------------ model / view
  {
    name: "set_plan_name",
    description: "Rename the plan.",
    inputSchema: obj({ name: str }, ["name"]),
    execute: (i) => actions.setPlanName(i.name as string),
  },
  {
    name: "clear_model",
    description: "Clear the whole plan (walls, openings, rooms, furniture, notes). Use when the user asks to start over.",
    inputSchema: obj({}),
    annotations: { destructiveHint: true },
    confirm: () => "erase the whole plan — every wall, opening, room and piece of furniture",
    execute: () => actions.clearModel(),
  },
  {
    name: "build_3d",
    description:
      "Raise the plan into 3D: extrudes walls with real openings, resolves corner joints, builds furniture, and switches the human's view to the 3D scene. Call after drawing so the user sees the result.",
    inputSchema: obj({}),
    execute: () => actions.build3d(),
  },
  {
    name: "set_camera",
    description:
      "Move the 3D camera: \"orbit\" (default 3/4 view), \"top\" (plan view from above), \"walk\" (first-person at 1.6 m — the user walks with WASD). Implies switching to 3D.",
    inputSchema: obj({ mode: { type: "string", enum: ["orbit", "top", "walk"] } }, ["mode"]),
    execute: (i) => actions.setCamera(i.mode as "orbit" | "top" | "walk"),
  },

  {
    name: "set_doors",
    description:
      "Swing the door leaves in the 3D scene open or shut (build_3d must have run). state: \"open\", \"closed\" or \"toggle\". Pass an opening id to act on one door, or omit it to act on every door in the plan. The human can do the same by clicking a leaf in the 3D view.",
    inputSchema: obj({ state: { type: "string", enum: ["open", "closed", "toggle"] }, id: str }, ["state"]),
    execute: (i) => {
      const id = i.id as string | undefined;
      const doors = store.getState().model.openings.filter((o) => o.kind === "door");
      if (id && !doors.some((o) => o.id === id)) return { ok: false, summary: `No door with id "${id}".` };
      if (doors.length === 0) return { ok: false, summary: "The plan has no doors yet." };
      bus.emit(EVENTS.SET_DOORS, { state: i.state as string, id });
      const n = id ? 1 : doors.length;
      return { ok: true, summary: `${n} door(s) set to "${i.state}".` };
    },
  },

  // ------------------------------------------------------------------ cross-origin (partner catalogue)
  {
    name: "get_supplier_catalog",
    title: "Supplier catalogue (cross-origin)",
    description:
      "Read the furniture catalogue published by the PARTNER ORIGIN (Nordika) as its own WebMCP tools — sku, name, category, real footprint in metres, price and stock. Alza discovers those tools with getTools({fromOrigins}) and calls them with executeTool(), so the data crosses origins in the browser with no server in between. Filter with category (living | bedroom | office | dining), maxPrice, maxWidth (metres) or inStock. Pair it with place_supplier_product to drop a real product into the plan at its true size.",
    inputSchema: obj({ category: str, maxPrice: num, maxWidth: num, inStock: { type: "boolean" } }, []),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (i) => {
      try {
        const { products, transport } = await listProducts(i as Record<string, unknown>);
        return {
          ok: true,
          summary: `${products.length} product(s) from ${SUPPLIER_ORIGIN} via ${transport === "webmcp" ? "cross-origin WebMCP" : "postMessage fallback"}.`,
          origin: SUPPLIER_ORIGIN,
          transport,
          products,
        };
      } catch (err) {
        return { ok: false, summary: `Supplier unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  },
  {
    name: "place_supplier_product",
    title: "Place a supplier product",
    description:
      "Buy-in-place: fetch one product from the partner origin by sku, add it to this plan's catalogue at the supplier's REAL dimensions, and place it at (x, y) = centre in metres with the usual rotation convention. The constraint checker then treats it like any other piece, so a sofa that does not fit is caught before anyone orders it.",
    inputSchema: obj({ sku: str, x: num, y: num, rotation: num }, ["sku", "x", "y"]),
    execute: async (i) => {
      let product;
      try {
        const res = await getProduct(String(i.sku));
        product = res.product;
      } catch (err) {
        return { ok: false, summary: `Supplier unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!product) return { ok: false, summary: `The supplier has no product "${i.sku}".` };
      const imported = actions.importSupplierProduct(product);
      const kind = imported.kind as string;
      const placed = actions.placeItem(kind, i.x as number, i.y as number, i.rotation as number | undefined);
      if (!placed.ok) return placed;
      const stock = product.stock === 0 ? " — note: currently OUT OF STOCK at the supplier" : "";
      return {
        ok: true,
        summary: `${product.name} (${product.sku}, ${product.w} × ${product.d} m, €${product.price}) placed from ${SUPPLIER_ORIGIN}${stock}.`,
        id: placed.id,
        product,
      };
    },
  },

  // ------------------------------------------------------------------ collaboration
  {
    name: "leave_note",
    description:
      "Leave a note on the plan for the human (or read theirs): design rationale, questions, measurements to verify. Notes are visible in the Notes panel.",
    inputSchema: obj({ text: str }, ["text"]),
    execute: (i) => actions.leaveNote("agent", i.text as string),
  },
  {
    name: "get_notes",
    description: "Read all notes left on the plan by the human and by agents.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const notes = store.getState().notes;
      return { ok: true, summary: `${notes.length} note(s).`, notes };
    },
  },
];

/** The dynamic tool — registered only while the human has a wall selected (see bootstrap.ts). */
export const EXTEND_SELECTED_WALL: ToolDef = {
  name: "extend_selected_wall",
  description:
    "DYNAMIC TOOL — available only while the human has a wall selected. Extends the wall the human is pointing at by `meters` (positive grows, negative shrinks) from its `end` (\"a\" = start, \"b\" = end).",
  inputSchema: obj({ meters: num, end: { type: "string", enum: ["a", "b"] } }, ["meters", "end"]),
  execute: (i) => {
    const id = store.getState().editor.selectedWallId;
    if (!id) return { ok: false, summary: "No wall is selected right now — the human must select one first." };
    const w = store.getState().model.walls.find((x) => x.id === id);
    if (!w) return { ok: false, summary: "Selected wall no longer exists." };
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const dx = (w.bx - w.ax) / len;
    const dy = (w.by - w.ay) / len;
    const m = i.meters as number;
    const patch =
      (i.end as string) === "a"
        ? { ax: w.ax - dx * m, ay: w.ay - dy * m }
        : { bx: w.bx + dx * m, by: w.by + dy * m };
    return actions.editWall(id, patch);
  },
};

/**
 * Runner behind the on-page ToolRunner. It goes through the SAME wrapper WebMCP uses —
 * approval gate, activity log and all — so the fallback path is not a second code path.
 */
export async function runToolManually(name: string, input: Record<string, never>): Promise<ActionResult> {
  const def = [...TOOLS, EXTEND_SELECTED_WALL].find((t) => t.name === name);
  if (!def) return { ok: false, summary: `Unknown tool "${name}".` };
  return executeWrapped(def, input);
}

export { bus, EVENTS };
