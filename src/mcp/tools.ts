/**
 * The 31 WebMCP tools (+ 1 dynamic, registered in bootstrap.ts).
 * Every tool calls THE SAME actions the UI buttons use — one store, human and agent co-edit.
 * Arguments accept human names ("bedroom", "sofa") as well as ids.
 *
 * Each tool's arguments are a zod schema built from the domain ranges in model/limits.ts. The
 * JSON Schema an agent reads is derived from it (registry.ts → inputSchemaOf), the wrapper
 * validates every call against it, and `execute` receives the parsed, typed result.
 */

import { z } from "zod";
import { actions, findWall, store, type ActionResult } from "../model/store";
import { checkModel } from "../model/issues";
import { CATALOG, supplierKind } from "../model/catalog";
import { SUPPLIER_ORIGIN, getProduct, listProducts } from "./supplier";
import { dist, segLen } from "../model/geometry";
import { bus, EVENTS } from "../three/exportBus";
import { defineTool, executeWrapped, type ToolDef } from "./registry";
import {
  DEFAULT_FLOOR,
  DOOR_DEFAULTS,
  FLOOR_FINISHES,
  FURNITURE_DIM,
  ROOM_SIZE,
  SNAP,
  SUPPLIER,
  TEXT,
  WALL_DEFAULTS,
  WINDOW_DEFAULTS,
} from "../model/limits";
import {
  calibrationMeters,
  cameraMode,
  coord,
  doorState,
  floorFinish,
  furnitureDim,
  hexColor,
  hinge,
  imageFraction,
  inRange,
  itemCategory,
  kindId,
  label,
  opacity,
  openingHeight,
  openingSill,
  openingT,
  openingWidth,
  partList,
  ref,
  roomSize,
  rotation,
  signedLength,
  supplierSku,
  swingSide,
  text,
  wallEnd,
  wallHeight,
  wallThickness,
} from "../model/schemas";

/** Every tool's arguments are a closed object: unknown keys are an error, not ignored. */
const args = z.strictObject;
const noArgs = z.strictObject({});

const snapCm = Math.round(SNAP * 100);

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
  defineTool({
    name: "get_model",
    title: "Read the whole plan",
    description:
      "Read the full floor plan: walls (endpoints, thickness, height), openings (doors/windows with position along their wall), rooms (metric rects with labels), furniture, and plan name. All units are meters.",
    input: noArgs,
    annotations: { readOnlyHint: true },
    execute: () => {
      const m = store.getState().model;
      return {
        ok: true,
        summary: `Plan "${m.name}": ${m.walls.length} walls, ${m.openings.length} openings, ${m.rooms.length} rooms, ${m.items.length} items.`,
        model: m,
      };
    },
  }),
  defineTool({
    name: "get_issues",
    title: "Check the plan for problems",
    description:
      "Run the constraint checker over the plan. Detects: too-short walls, loose ends, collinear overlaps, mid-span crossings, openings overflowing their wall or overlapping each other, walls ending inside an opening, floating/overlapping/doorless rooms, furniture crossing walls, blocking doors/windows, or colliding. Use it after editing to self-repair.",
    input: noArgs,
    annotations: { readOnlyHint: true },
    execute: () => {
      const issues = checkModel(store.getState().model);
      return {
        ok: true,
        summary: issues.length === 0 ? "0 issues — the plan is clean." : `${issues.length} issue(s) found.`,
        issues,
      };
    },
  }),
  defineTool({
    name: "get_item_catalog",
    title: "Furniture catalogue",
    description: "List the furniture catalog: kind, label, footprint (width × depth in meters) and height.",
    input: noArgs,
    annotations: { readOnlyHint: true },
    execute: () => ({
      ok: true,
      summary: `${CATALOG.length} furniture kinds available.`,
      catalog: CATALOG.map(({ kind, label, w, d, h, category }) => ({ kind, label, w, d, h, category })),
    }),
  }),
  defineTool({
    name: "get_editor_state",
    title: "What the human is doing right now",
    description:
      "Read what the human is doing right now: 2D/3D view, camera mode, selected wall/item/room, current draw mode.",
    input: noArgs,
    annotations: { readOnlyHint: true },
    execute: () => {
      const e = store.getState().editor;
      return { ok: true, summary: `View ${e.view}, camera ${e.camera}, selected wall: ${e.selectedWallId ?? "none"}.`, editor: e };
    },
  }),
  defineTool({
    name: "measure",
    title: "Measure a distance",
    description:
      "Measure a distance: between two points (x1,y1)-(x2,y2), or the length of a wall by id. Returns meters.",
    // Published as one object with every field optional, which is what agents read today; the
    // transform turns it into the two shapes measure really takes, so the body narrows on
    // `wallId` instead of asserting that the points are there.
    input: args({
      x1: coord.optional(),
      y1: coord.optional(),
      x2: coord.optional(),
      y2: coord.optional(),
      wallId: ref.optional(),
    }).transform(({ wallId, x1, y1, x2, y2 }, ctx) => {
      if (wallId !== undefined) return { wallId };
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
        return { wallId: undefined, from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
      }
      ctx.addIssue({ code: "custom", message: "give wallId, or all four of x1, y1, x2, y2" });
      return z.NEVER;
    }),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      if (i.wallId !== undefined) {
        const w = findWall(i.wallId);
        if (!w) return { ok: false, summary: `Wall "${i.wallId}" not found.` };
        const len = segLen(w.ax, w.ay, w.bx, w.by);
        return { ok: true, summary: `Wall ${w.id} is ${len.toFixed(2)} m long.`, meters: len };
      }
      const d = dist(i.from, i.to);
      return { ok: true, summary: `Distance: ${d.toFixed(2)} m.`, meters: d };
    },
  }),
  defineTool({
    name: "get_underlay",
    title: "Blueprint underlay + tracing protocol",
    description:
      "Read the blueprint underlay: whether a reference plan image is loaded, the world rectangle it covers (metres), the mapping from image fractions to world coordinates — and the PROTOCOL for tracing it. Call this FIRST whenever the human gives you a plan to reproduce. Tracing needs the drawing in two places and this tool tells you which are missing: uploaded on the page (carries the scale) and pasted into your conversation (the only way you can see it). This tool never returns the pixels — it returns where the drawing sits in world metres so you can convert what you measure on your own copy. Measure in fractions of the image, not pixels: the page holds a resized copy.",
    input: noArgs,
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
  }),
  defineTool({
    name: "calibrate_underlay",
    title: "Set the drawing's true scale",
    description:
      "Scale the loaded blueprint image to real-world meters. Give two points on the image as fractions (u, v in 0..1; u = right, v = down) and the REAL distance between them in meters (e.g. a dimension printed on the plan). The underlay is resized preserving aspect, keeping the first point fixed. Call after the human uploads the plan, before tracing walls over it.",
    input: args({
      u1: imageFraction,
      v1: imageFraction,
      u2: imageFraction,
      v2: imageFraction,
      meters: calibrationMeters,
      opacity: opacity.optional(),
    }),
    execute: (i) => actions.calibrateUnderlay(i.u1, i.v1, i.u2, i.v2, i.meters, i.opacity),
  }),

  // ------------------------------------------------------------------ walls
  defineTool({
    name: "add_wall",
    title: "Add a wall",
    description:
      `Add a wall segment from (ax,ay) to (bx,by) in meters. Coordinates snap to a ${snapCm} cm grid. Default thickness ${WALL_DEFAULTS.thickness} m (use 0.1 for interior), height ${WALL_DEFAULTS.height} m.`,
    input: args({
      ax: coord,
      ay: coord,
      bx: coord,
      by: coord,
      thickness: wallThickness.optional(),
      height: wallHeight.optional(),
    }),
    execute: (i) => actions.addWall(i.ax, i.ay, i.bx, i.by, i.thickness, i.height),
  }),
  defineTool({
    name: "edit_wall",
    title: "Edit a wall",
    description: `Move endpoints or change thickness/height of an existing wall (by id). Endpoints snap to ${snapCm} cm.`,
    input: args({
      id: ref,
      ax: coord.optional(),
      ay: coord.optional(),
      bx: coord.optional(),
      by: coord.optional(),
      thickness: wallThickness.optional(),
      height: wallHeight.optional(),
    }),
    // the lookup key is split off; only the geometry goes into the patch
    execute: ({ id, ...patch }) => actions.editWall(id, patch),
  }),
  defineTool({
    name: "remove_wall",
    title: "Remove a wall",
    description: "Remove a wall by id. Its doors and windows are removed too.",
    input: args({ id: ref }),
    annotations: { destructiveHint: true },
    confirm: (i) => `delete wall ${i.id} (and every door and window on it)`,
    execute: (i) => actions.removeWall(i.id),
  }),

  // ------------------------------------------------------------------ openings
  defineTool({
    name: "add_door",
    title: "Add a door",
    description:
      `Add a door on a wall. t is the position of the door CENTER along the wall (0..1). Default width ${DOOR_DEFAULTS.width} m, height ${DOOR_DEFAULTS.height} m; a door wider than 1.2 m is built as a double door with two leaves. The vano is clamped so it always fits inside the wall; too-wide doors are rejected with the wall length. hinge picks the jamb the hinges sit on ("a" = the wall's A end, the default; "b" = the B end) and side picks which way the leaf swings, as seen walking the wall from A to B: "right" (default) or "left". Match these to the swing arc drawn on the plan.`,
    input: args({
      wallId: ref,
      t: openingT,
      width: openingWidth.optional(),
      height: openingHeight.optional(),
      hinge: hinge.optional(),
      side: swingSide.optional(),
    }),
    execute: (i) =>
      actions.addOpening("door", i.wallId, i.t, i.width, DOOR_DEFAULTS.sill, i.height, { hinge: i.hinge, side: i.side }),
  }),
  defineTool({
    name: "set_door_swing",
    title: "Change how a door opens",
    description:
      "Change how an existing door opens: hinge (\"a\" | \"b\" — which jamb carries the hinges) and/or side (\"left\" | \"right\" — which way the leaf swings, walking the wall from its A endpoint to its B endpoint). Re-run build_3d to see it.",
    input: args({ id: ref, hinge: hinge.optional(), side: swingSide.optional() }),
    execute: (i) => actions.setDoorSwing(i.id, i.hinge, i.side),
  }),
  defineTool({
    name: "add_window",
    title: "Add a window",
    description:
      `Add a window on a wall. t is the position of the window CENTER along the wall (0..1). Default width ${WINDOW_DEFAULTS.width} m, sill ${WINDOW_DEFAULTS.sill} m, height ${WINDOW_DEFAULTS.height} m. The vano is clamped to fit.`,
    input: args({
      wallId: ref,
      t: openingT,
      width: openingWidth.optional(),
      sill: openingSill.optional(),
      height: openingHeight.optional(),
    }),
    execute: (i) => actions.addOpening("window", i.wallId, i.t, i.width, i.sill, i.height),
  }),
  defineTool({
    name: "move_opening",
    title: "Move a door or window",
    description: "Move a door or window along its wall to a new center position t (0..1). Clamped to fit.",
    input: args({ id: ref, t: openingT }),
    execute: (i) => actions.moveOpening(i.id, i.t),
  }),
  defineTool({
    name: "remove_opening",
    title: "Remove a door or window",
    description: "Remove a door or window by id.",
    input: args({ id: ref }),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove opening ${i.id}`,
    execute: (i) => actions.removeOpening(i.id),
  }),

  // ------------------------------------------------------------------ rooms
  defineTool({
    name: "add_room",
    title: "Add a room",
    description:
      `Add a room: a metric rectangle (x, y = top-left corner, w, h in meters, at least ${ROOM_SIZE.min} m each) with a label and floor finish (${FLOOR_FINISHES.join(" | ")}; default ${DEFAULT_FLOOR}).`,
    input: args({ x: coord, y: coord, w: roomSize, h: roomSize, label, floor: floorFinish.optional() }),
    execute: (i) => actions.addRoom(i.x, i.y, i.w, i.h, i.label, i.floor),
  }),
  defineTool({
    name: "update_room",
    title: "Update a room",
    description: "Update a room by id or label (e.g. \"bedroom\"): move, resize, relabel, or change floor finish.",
    input: args({
      id: ref,
      x: coord.optional(),
      y: coord.optional(),
      w: roomSize.optional(),
      h: roomSize.optional(),
      label: label.optional(),
      floor: floorFinish.optional(),
    }),
    // `id` addresses the room and is never part of the patch: passing the whole input let it
    // overwrite the room's real id with whatever label the agent used to find it
    execute: ({ id, ...patch }) => actions.updateRoom(id, patch),
  }),
  defineTool({
    name: "remove_room",
    title: "Remove a room",
    description: "Remove a room by id or label.",
    input: args({ id: ref }),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the room "${i.id}"`,
    execute: (i) => actions.removeRoom(i.id),
  }),

  // ------------------------------------------------------------------ furniture
  defineTool({
    name: "place_item",
    title: "Place furniture",
    description:
      "Place furniture from the catalog at (x, y) = center in meters. rotation (degrees, counterclockwise) sets which way the piece FACES: 0 = faces +y (down/south on the plan), 90 = faces +x (right/east), 180 = faces -y (up/north), 270 = faces -x (left/west). The back of a sofa, bed headboard, wardrobe or counter is opposite the facing direction — so a sofa against the SOUTH wall needs rotation 180, and one against the WEST wall needs rotation 90. To sit a piece flush against a wall, offset its center by depth/2 from the wall FACE (centerline ± thickness/2), not from the centerline. Use get_item_catalog for footprints; get_issues reports crossings and blocked doors.",
    input: args({ kind: kindId, x: coord, y: coord, rotation: rotation.optional() }),
    execute: (i) => actions.placeItem(i.kind, i.x, i.y, i.rotation),
  }),
  defineTool({
    name: "define_item_kind",
    title: "Model a new piece of furniture",
    description:
      "Create a piece of furniture that is NOT in the catalogue, then place it with place_item. Use this whenever the plan draws something the catalogue does not have, or draws it at a different size — a corner bath, an L-shaped sofa, a kitchen island, a piano. Do NOT approximate with the nearest stock item when the plan shows something specific: define the real thing. " +
      "Required: kind (a stable snake_case id), label, and the true footprint w × d and height h in METRES. " +
      "Optional `parts` models it in 3D from primitives; without it the piece is blocked out from its footprint. Each part is { shape: \"box\" | \"cylinder\" | \"sphere\", x, y, z, w, h, d, color, rotation }, in the piece's OWN local frame: x runs along its width, z along its depth, y is height above the floor and is the part's BOTTOM (a 0.4 m tall seat resting on the floor is y:0, h:0.4). The piece faces +z, so a backrest sits at negative z and the front is positive z — that keeps it consistent with the rotation convention in place_item. For a cylinder, w is the diameter and d makes it an ellipse. Sizes are metres, colours are hex.",
    input: args({
      kind: kindId,
      label,
      w: furnitureDim,
      d: furnitureDim,
      h: furnitureDim,
      color: hexColor.optional(),
      category: itemCategory.optional(),
      parts: partList.optional(),
    }),
    execute: (i) => actions.defineItemKind(i),
  }),
  defineTool({
    name: "move_item",
    title: "Move or rotate furniture",
    description: "Move or rotate a furniture item by id or kind (e.g. \"sofa\"). Same rotation convention as place_item: 0 faces +y, 90 faces +x, 180 faces -y, 270 faces -x.",
    input: args({ id: ref, x: coord.optional(), y: coord.optional(), rotation: rotation.optional() }),
    execute: (i) => actions.moveItem(i.id, i.x, i.y, i.rotation),
  }),
  defineTool({
    name: "remove_item",
    title: "Remove furniture",
    description: "Remove a furniture item by id or kind.",
    input: args({ id: ref }),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the ${i.id}`,
    execute: (i) => actions.removeItem(i.id),
  }),

  // ------------------------------------------------------------------ model / view
  defineTool({
    name: "set_plan_name",
    title: "Rename the plan",
    description: "Rename the plan.",
    input: args({ name: text(TEXT.planName) }),
    execute: (i) => actions.setPlanName(i.name),
  }),
  defineTool({
    name: "clear_model",
    title: "Erase the whole plan",
    description: "Clear the whole plan (walls, openings, rooms, furniture, notes). Use when the user asks to start over.",
    input: noArgs,
    annotations: { destructiveHint: true },
    confirm: () => "erase the whole plan — every wall, opening, room and piece of furniture",
    execute: () => actions.clearModel(),
  }),
  defineTool({
    name: "build_3d",
    title: "Raise the plan into 3D",
    description:
      "Raise the plan into 3D: extrudes walls with real openings, resolves corner joints, builds furniture, and switches the human's view to the 3D scene. Call after drawing so the user sees the result.",
    input: noArgs,
    execute: () => actions.build3d(),
  }),
  defineTool({
    name: "set_camera",
    title: "Move the 3D camera",
    description:
      "Move the 3D camera: \"orbit\" (default 3/4 view), \"top\" (plan view from above), \"walk\" (first-person at 1.6 m — the user walks with WASD). Implies switching to 3D.",
    input: args({ mode: cameraMode }),
    execute: (i) => actions.setCamera(i.mode),
  }),

  defineTool({
    name: "set_doors",
    title: "Open or shut the doors in 3D",
    description:
      "Swing the door leaves in the 3D scene open or shut (build_3d must have run). state: \"open\", \"closed\" or \"toggle\". Pass an opening id to act on one door, or omit it to act on every door in the plan. The human can do the same by clicking a leaf in the 3D view.",
    input: args({ state: doorState, id: ref.optional() }),
    execute: (i) => {
      const { id } = i;
      const doors = store.getState().model.openings.filter((o) => o.kind === "door");
      if (id && !doors.some((o) => o.id === id)) return { ok: false, summary: `No door with id "${id}".` };
      if (doors.length === 0) return { ok: false, summary: "The plan has no doors yet." };
      bus.emit(EVENTS.SET_DOORS, { state: i.state, id });
      const n = id ? 1 : doors.length;
      return { ok: true, summary: `${n} door(s) set to "${i.state}".` };
    },
  }),

  // ------------------------------------------------------------------ cross-origin (partner catalogue)
  defineTool({
    name: "get_supplier_catalog",
    title: "Supplier catalogue (cross-origin)",
    description:
      "Read the furniture catalogue published by the PARTNER ORIGIN (Nordika) as its own WebMCP tools — sku, name, category, real footprint in metres, price and stock. Alza discovers those tools with getTools({fromOrigins}) and calls them with executeTool(), so the data crosses origins in the browser with no server in between. Filter with category (living | bedroom | office | dining), maxPrice, maxWidth (metres) or inStock. Pair it with place_supplier_product to drop a real product into the plan at its true size.",
    input: args({
      category: text(TEXT.category).optional(),
      maxPrice: inRange(SUPPLIER.price).optional(),
      maxWidth: inRange(FURNITURE_DIM).optional(),
      inStock: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (i) => {
      try {
        const { products, rejected, transport } = await listProducts(i);
        const dropped = rejected > 0 ? ` ${rejected} malformed product(s) from the supplier were dropped.` : "";
        return {
          ok: true,
          summary: `${products.length} product(s) from ${SUPPLIER_ORIGIN} via ${transport === "webmcp" ? "cross-origin WebMCP" : "postMessage fallback"}.${dropped}`,
          origin: SUPPLIER_ORIGIN,
          transport,
          products,
          rejected,
        };
      } catch (err) {
        return { ok: false, summary: `Supplier unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  }),
  defineTool({
    name: "place_supplier_product",
    title: "Place a supplier product",
    description:
      "Buy-in-place: fetch one product from the partner origin by sku, add it to this plan's catalogue at the supplier's REAL dimensions, and place it at (x, y) = centre in metres with the usual rotation convention. The constraint checker then treats it like any other piece, so a sofa that does not fit is caught before anyone orders it.",
    input: args({ sku: supplierSku, x: coord, y: coord, rotation: rotation.optional() }),
    execute: async (i) => {
      let product;
      try {
        const res = await getProduct(i.sku);
        product = res.product;
      } catch (err) {
        return { ok: false, summary: `Supplier call failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!product) return { ok: false, summary: `The supplier has no product "${i.sku}".` };
      const imported = actions.importSupplierProduct(product);
      if (!imported.ok) return imported;
      const placed = actions.placeItem(supplierKind(product.sku), i.x, i.y, i.rotation);
      if (!placed.ok) return placed;
      const stock = product.stock === 0 ? " — note: currently OUT OF STOCK at the supplier" : "";
      return {
        ok: true,
        summary: `${product.name} (${product.sku}, ${product.w} × ${product.d} m, €${product.price}) placed from ${SUPPLIER_ORIGIN}${stock}.`,
        id: placed.id,
        product,
      };
    },
  }),

  // ------------------------------------------------------------------ collaboration
  defineTool({
    name: "leave_note",
    title: "Leave a note on the plan",
    description:
      "Leave a note on the plan for the human (or read theirs): design rationale, questions, measurements to verify. Notes are visible in the Notes panel.",
    input: args({ text: text(TEXT.note) }),
    execute: (i) => actions.leaveNote("agent", i.text),
  }),
  defineTool({
    name: "get_notes",
    title: "Read the notes on the plan",
    description: "Read all notes left on the plan by the human and by agents.",
    input: noArgs,
    annotations: { readOnlyHint: true },
    execute: () => {
      const notes = store.getState().notes;
      return { ok: true, summary: `${notes.length} note(s).`, notes };
    },
  }),
];

/** The dynamic tool — registered only while the human has a wall selected (see bootstrap.ts). */
export const EXTEND_SELECTED_WALL: ToolDef = defineTool({
  name: "extend_selected_wall",
  title: "Extend the wall the human selected",
  description:
    "DYNAMIC TOOL — available only while the human has a wall selected. Extends the wall the human is pointing at by `meters` (positive grows, negative shrinks) from its `end` (\"a\" = start, \"b\" = end).",
  input: args({ meters: signedLength, end: wallEnd }),
  execute: (i) => {
    const id = store.getState().editor.selectedWallId;
    if (!id) return { ok: false, summary: "No wall is selected right now — the human must select one first." };
    const w = store.getState().model.walls.find((x) => x.id === id);
    if (!w) return { ok: false, summary: "Selected wall no longer exists." };
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const dx = (w.bx - w.ax) / len;
    const dy = (w.by - w.ay) / len;
    const m = i.meters;
    const patch =
      i.end === "a"
        ? { ax: w.ax - dx * m, ay: w.ay - dy * m }
        : { bx: w.bx + dx * m, by: w.by + dy * m };
    return actions.editWall(id, patch);
  },
});

/**
 * Runner behind the on-page ToolRunner. It goes through the SAME wrapper WebMCP uses —
 * approval gate, activity log and all — so the fallback path is not a second code path.
 */
export async function runToolManually(name: string, input: unknown): Promise<ActionResult> {
  const def = [...TOOLS, EXTEND_SELECTED_WALL].find((t) => t.name === name);
  if (!def) return { ok: false, summary: `Unknown tool "${name}".` };
  return executeWrapped(def, input);
}

export { bus, EVENTS };
