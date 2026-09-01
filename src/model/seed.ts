/**
 * Seed: "Sunset Loft" — an 8 × 6 m loft, fully furnished, audited to 0 issues.
 * Layout:
 *   - Open-plan living/kitchen on the left (0–4.925 m)
 *   - Bedroom top-right, bathroom bottom-right (5–8 m block)
 *   - Entrance door bottom-left, windows on top/left/right walls
 */

import type { PlanModel } from "./types";

export const seedLoft = (): PlanModel => ({
  name: "Sunset Loft",
  walls: [
    // exterior (thickness 0.15, height 2.7)
    { id: "wall_n", ax: 0, ay: 0, bx: 8, by: 0, thickness: 0.15, height: 2.7 },
    { id: "wall_e", ax: 8, ay: 0, bx: 8, by: 6, thickness: 0.15, height: 2.7 },
    { id: "wall_s", ax: 8, ay: 6, bx: 0, by: 6, thickness: 0.15, height: 2.7 },
    { id: "wall_w", ax: 0, ay: 6, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
    // interior block (thickness 0.1)
    { id: "wall_bed_w", ax: 5, ay: 0, bx: 5, by: 3.4, thickness: 0.1, height: 2.7 },
    { id: "wall_bed_s", ax: 5, ay: 3.4, bx: 8, by: 3.4, thickness: 0.1, height: 2.7 },
    { id: "wall_bath_w", ax: 5, ay: 3.4, bx: 5, by: 6, thickness: 0.1, height: 2.7 },
  ],
  openings: [
    // entrance (bottom wall, center x = 1.0)
    { id: "door_main", kind: "door", wallId: "wall_s", t: 0.875, width: 0.9, sill: 0, height: 2.1 },
    // bedroom door (vertical wall x=5, center y = 2.55)
    { id: "door_bed", kind: "door", wallId: "wall_bed_w", t: 0.75, width: 0.9, sill: 0, height: 2.1 },
    // bathroom door (vertical wall x=5, center y = 5.35 — clear of the south corner)
    { id: "door_bath", kind: "door", wallId: "wall_bath_w", t: 0.75, width: 0.8, sill: 0, height: 2.1 },
    // big living window (top wall, center x = 4.16)
    { id: "win_living", kind: "window", wallId: "wall_n", t: 0.52, width: 1.5, sill: 0.9, height: 1.2 },
    // dining window (left wall, center y = 3.0)
    { id: "win_dining", kind: "window", wallId: "wall_w", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
    // bedroom window (right wall, center y = 1.5)
    { id: "win_bed", kind: "window", wallId: "wall_e", t: 0.25, width: 1.2, sill: 0.9, height: 1.2 },
    // bathroom window (right wall, center y = 4.5)
    { id: "win_bath", kind: "window", wallId: "wall_e", t: 0.75, width: 0.6, sill: 1.2, height: 0.9 },
  ],
  rooms: [
    { id: "room_living", x: 0.075, y: 0.075, w: 4.85, h: 5.85, label: "Living & Kitchen", floor: "oak" },
    { id: "room_bed", x: 5.075, y: 0.075, w: 2.85, h: 3.25, label: "Bedroom", floor: "carpet" },
    { id: "room_bath", x: 5.075, y: 3.475, w: 2.85, h: 2.45, label: "Bathroom", floor: "tile" },
  ],
  items: [
    // kitchen strip along the top wall (fronts face into the room)
    { id: "item_counter", kind: "kitchen_counter", x: 1.3, y: 0.385, rotation: 0 },
    { id: "item_fridge", kind: "fridge", x: 2.85, y: 0.45, rotation: 0 },
    // dining (chairs face the table)
    { id: "item_dining", kind: "dining_table", x: 1.2, y: 2.6, rotation: 0 },
    { id: "item_chair1", kind: "dining_chair", x: 0.6, y: 3.3, rotation: 180 },
    { id: "item_chair2", kind: "dining_chair", x: 1.8, y: 3.3, rotation: 180 },
    { id: "item_chair3", kind: "dining_chair", x: 0.6, y: 1.9, rotation: 0 },
    { id: "item_chair4", kind: "dining_chair", x: 1.8, y: 1.9, rotation: 0 },
    // desk corner (desk back flush to the north wall; chair faces the desk)
    { id: "item_desk", kind: "desk", x: 4.25, y: 0.45, rotation: 0 },
    { id: "item_office_chair", kind: "office_chair", x: 4.15, y: 1.35, rotation: 180 },
    // living (sofa faces north toward the TV; shelf books face east)
    { id: "item_sofa", kind: "sofa", x: 3.0, y: 5.3, rotation: 180 },
    { id: "item_coffee", kind: "coffee_table", x: 2.9, y: 4.3, rotation: 0 },
    { id: "item_rug", kind: "rug", x: 2.9, y: 4.8, rotation: 0 },
    { id: "item_tv", kind: "tv_stand", x: 4.7, y: 4.0, rotation: 270 },
    { id: "item_shelf", kind: "bookshelf", x: 0.25, y: 4.2, rotation: 90 },
    { id: "item_plant", kind: "plant", x: 7.7, y: 3.05, rotation: 0 },
    // bedroom (headboard north, wardrobe doors face into the room)
    { id: "item_bed", kind: "bed_double", x: 6.85, y: 1.2, rotation: 0 },
    { id: "item_night", kind: "nightstand", x: 5.8, y: 0.35, rotation: 0 },
    { id: "item_wardrobe", kind: "wardrobe", x: 6.7, y: 3.0, rotation: 180 },
  ],
  underlay: null,
});
