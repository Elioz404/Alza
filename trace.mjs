/**
 * The plan, read off plan-source.jpeg.
 *
 * Scale: the drawing carries no dimension, so the exterior width is fixed at 10.00 m —
 * which is exactly the one measurement the tracing protocol tells the agent to ask a human
 * for. At that width the source image runs 138.2 px/m, its exterior box sits at pixels
 * (333, 222)..(1715, 1764), and every number below is a pixel measurement converted with
 *
 *     world = (pixel - origin) / 138.2
 *
 * Verified by pinning the drawing under the model at that scale and comparing.
 *
 *   WALLS  [ax, ay, bx, by, thickness]
 *   OPEN   built from the wall ids the live model returns, so it survives re-ordering
 *   ROOMS  [x, y, w, h, label, floor]
 *   FURN   [kind, x, y, rotation]   rotation = the direction the piece FACES
 */

export const W = 10.0;      // exterior width, metres
export const H = 11.16;     // exterior depth, metres

export const WALLS = [
  [0, 0, W, 0, 0.2],                 // 0  north
  [W, 0, W, H, 0.2],                 // 1  east
  [W, H, 0, H, 0.2],                 // 2  south
  [0, H, 0, 0, 0.2],                 // 3  west
  [4.50, 0, 4.50, 4.00, 0.1],        // 4  bathroom 1, west side
  [6.37, 0, 6.37, 4.00, 0.1],        // 5  bathroom 1 east side / bedroom 1 west side
  [4.50, 2.68, 6.37, 2.68, 0.1],     // 6  bathroom 1, back
  [3.68, 4.00, W, 4.00, 0.1],        // 7  the long east-west wall that closes the north half
  [7.21, 4.00, 7.21, 7.70, 0.1],     // 8  spine: hall against the dressing room and bathroom 2
  [7.21, 6.02, W, 6.02, 0.1],        // 9  dressing room / bathroom 2
  [5.40, 7.70, W, 7.70, 0.1],        // 10 bedroom 3, north
  [5.40, 6.43, 5.40, H, 0.1],        // 11 living against bedroom 3
];

export const OPEN = (w) => [
  // --- exterior windows: three down the west flank, one north, two south, one east
  ["add_window", { wallId: w[3], t: 0.755, width: 1.71, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[3], t: 0.477, width: 1.71, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[3], t: 0.229, width: 1.67, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[0], t: 0.776, width: 1.74, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[2], t: 0.785, width: 1.78, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[2], t: 0.267, width: 1.77, sill: 0.9, height: 1.2 }],
  ["add_window", { wallId: w[1], t: 0.607, width: 1.00, sill: 0.9, height: 1.2 }],
  // --- front door, south wall
  ["add_door", { wallId: w[2], t: 0.533, width: 0.85, height: 2.1 }],
  // --- the laundry off the hall, bathroom 1 as an ensuite off bedroom 1
  ["add_door", { wallId: w[7], t: 0.220, width: 0.90 }],
  ["add_door", { wallId: w[5], t: 0.550, width: 0.80, hinge: "b" }],
  ["add_door", { wallId: w[7], t: 0.640, width: 0.85 }],
  // --- bedroom 2 and bathroom 2, both off the spine
  ["add_door", { wallId: w[8], t: 0.040, width: 0.85, side: "right" }],
  ["add_door", { wallId: w[8], t: 0.859, width: 0.85, hinge: "b", side: "right" }],
  // --- bedroom 3
  ["add_door", { wallId: w[10], t: 0.150, width: 0.90 }],
];

export const ROOMS = [
  [0.10, 0.10, 4.30, 2.20, "Kitchen", "tile"],
  [0.10, 2.35, 4.30, 3.20, "Dining", "oak"],
  [0.10, 5.60, 5.20, 5.45, "Living", "oak"],
  [4.60, 0.10, 1.67, 2.48, "Bathroom 1", "tile"],
  [4.60, 2.78, 1.67, 1.12, "Laundry", "tile"],
  [4.60, 4.10, 2.50, 1.50, "Hall", "tile"],
  [6.47, 0.10, 3.43, 3.80, "Bedroom 1", "oak"],
  [7.31, 4.10, 2.59, 1.82, "Dressing", "oak"],
  [7.31, 6.12, 2.59, 1.48, "Bathroom 2", "tile"],
  [5.50, 7.80, 4.40, 3.26, "Bedroom 3", "oak"],
];

export const FURN = [
  // ---- kitchen: three 1.20 m units along the north wall, then tall units turning south.
  // Positions come from the catalogue footprints, not from the drawn outlines: the drawing
  // sketches the run, the real units have to sit end to end without overlapping.
  ["kitchen_sink_unit", 0.81, 0.41, 0],
  ["kitchen_hob_unit", 2.01, 0.41, 0],
  ["counter_unit", 3.21, 0.41, 0],
  ["fridge", 4.10, 1.14, 270],
  ["counter_unit", 4.14, 2.09, 270],
  ["counter_unit", 4.14, 3.29, 270],

  // ---- dining: the oval runs north-south, six chairs clear of its rim
  ["dining_table_oval", 1.78, 3.64, 90],
  ["dining_chair", 1.03, 3.20, 90],
  ["dining_chair", 1.03, 4.08, 90],
  ["dining_chair", 2.53, 3.20, 270],
  ["dining_chair", 2.53, 4.08, 270],
  ["dining_chair", 1.78, 2.44, 0],
  ["dining_chair", 1.78, 4.84, 180],

  // ---- living
  ["coffee_table", 3.20, 8.69, 90],
  ["armchair", 2.13, 6.86, 0],
  ["side_table", 0.72, 6.91, 0],
  ["tv_sideboard", 5.14, 8.40, 270],

  // ---- bathroom 1, ensuite off bedroom 1. The door's swing takes the east side of the
  // room, so the basin and WC sit in the west strip under the shower.
  ["sink", 4.78, 1.70, 90],
  ["toilet", 4.90, 2.35, 90],

  // ---- bedroom 1
  ["bed_double", 8.80, 1.99, 270],
  ["nightstand", 9.70, 0.83, 270],
  ["nightstand", 9.70, 3.14, 270],

  // ---- dressing room: one L-shaped run, defined below

  // ---- bathroom 2
  ["sink", 7.83, 6.34, 0],
  ["toilet", 8.63, 6.47, 0],

  // ---- bedroom 3
  ["desk", 5.78, 9.62, 90],
  ["office_chair", 6.50, 9.62, 270],
  ["bed_single", 9.11, 9.77, 0],
  ["nightstand", 8.32, 10.31, 0],
  ["sideboard", 8.41, 7.95, 0],

  // ---- laundry
];

/* The two symbols the catalogue has no honest match for. Rule 6 of the tracing protocol
   forbids approximating a distinctive symbol with the nearest stock item, so both are
   modelled at the size the drawing draws them and then placed like anything else.

   Local frame: x is the piece's width, z its depth, y is a part's BOTTOM, and the piece
   faces +z. The sofa's west arm runs along z with its back at -x; its south arm runs
   along x with its back at +z, so the L opens north-east into the room. */
export const DEFINE = [
  ["define_item_kind", {
    kind: "sofa_l",
    label: "L-shaped sofa",
    w: 2.66, d: 3.11, h: 0.78,
    color: "#8C99A8",
    category: "living",
    parts: [
      { shape: "box", x: -0.885, y: 0, z: -0.335, w: 0.89, d: 2.44, h: 0.42 },
      { shape: "box", x: -1.180, y: 0, z: -0.335, w: 0.30, d: 2.44, h: 0.78 },
      { shape: "box", x: 0, y: 0, z: 1.220, w: 2.66, d: 0.67, h: 0.42 },
      { shape: "box", x: 0, y: 0, z: 1.405, w: 2.66, d: 0.30, h: 0.78 },
    ],
  }],
  ["define_item_kind", {
    kind: "corner_shower",
    label: "Corner shower",
    w: 1.21, d: 1.16, h: 2.0,
    color: "#DDE4E9",
    category: "bath",
    parts: [
      { shape: "box", x: 0, y: 0, z: 0, w: 1.21, d: 1.16, h: 0.06, color: "#E8EDF0" },
      { shape: "box", x: 0, y: 0.06, z: 0.55, w: 1.21, d: 0.05, h: 1.94, color: "#CFDCE4" },
      { shape: "box", x: 0.58, y: 0.06, z: 0, w: 0.05, d: 1.16, h: 1.94, color: "#CFDCE4" },
    ],
  }],
  // The drawing's bath is 1.53 x 0.86 m, running parallel to the east wall — shorter than
  // the catalogue's 1.70. Rule 6 covers a piece drawn at a different size, so it is
  // defined at the size the plan draws rather than forced in at the stock one.
  ["define_item_kind", {
    kind: "bathtub_compact",
    label: "Compact bath",
    w: 1.53, d: 0.86, h: 0.58,
    color: "#EDF1F3",
    category: "bath",
    parts: [
      { shape: "box", x: 0, y: 0, z: 0, w: 1.53, d: 0.86, h: 0.58, color: "#F2F5F7" },
      { shape: "box", x: 0, y: 0.44, z: 0, w: 1.35, d: 0.68, h: 0.14, color: "#D8E2E8" },
    ],
  }],
  /* The dressing room is drawn as one 1.98 x 1.70 m block filling the room, which is a run
     of wardrobes, not furniture standing in the middle. Modelled as a real L turning the
     north-east corner: full-height carcasses, a lighter door face set proud of each, and
     slim vertical handles — a fitted wardrobe rather than a box. Local frame: x is width,
     z is depth, y is a part's bottom, and the piece faces +z. */
  ["define_item_kind", {
    kind: "wardrobe_l",
    label: "L-shaped fitted wardrobe",
    w: 1.60, d: 1.92, h: 2.20,
    color: "#C9BCA8",
    category: "bedroom",
    parts: [
      { shape: "box", x: 0.00, y: 0, z: -0.66, w: 1.60, d: 0.60, h: 2.20, color: "#C4B6A1" },
      { shape: "box", x: 0.50, y: 0, z: 0.18, w: 0.60, d: 1.32, h: 2.20, color: "#C4B6A1" },
      { shape: "box", x: 0.00, y: 0.04, z: -0.355, w: 1.54, d: 0.03, h: 2.12, color: "#DED3C2" },
      { shape: "box", x: 0.215, y: 0.04, z: 0.18, w: 0.03, d: 1.26, h: 2.12, color: "#DED3C2" },
      { shape: "box", x: -0.36, y: 0.90, z: -0.335, w: 0.03, d: 0.03, h: 0.90, color: "#5B5347" },
      { shape: "box", x: 0.36, y: 0.90, z: -0.335, w: 0.03, d: 0.03, h: 0.90, color: "#5B5347" },
      { shape: "box", x: 0.198, y: 0.90, z: 0.42, w: 0.03, d: 0.03, h: 0.90, color: "#5B5347" },
    ],
  }],
  // A washing machine: 31 catalogue kinds and not one of them is white goods for a
  // laundry, so the agent models it rather than standing a fridge in for it. The laundry
  // is 1.77 m wide with two doors, whose swing zones cover it end to end — the machine
  // takes the corner and the checker flags the clearance, which is true of the drawing.
  ["define_item_kind", {
    kind: "washing_machine",
    label: "Washing machine",
    w: 0.60, d: 0.60, h: 0.85,
    color: "#F2F2F0",
    category: "kitchen",
    parts: [
      { shape: "box", x: 0, y: 0, z: 0, w: 0.60, d: 0.60, h: 0.85, color: "#F4F4F2" },
      { shape: "box", x: 0, y: 0.26, z: 0.29, w: 0.36, d: 0.03, h: 0.36, color: "#39424A" },
      { shape: "box", x: 0, y: 0.70, z: 0.29, w: 0.46, d: 0.03, h: 0.08, color: "#D8DADC" },
    ],
  }],
];

export const DEFINED_ITEMS = [
  ["sofa_l", 1.59, 9.07, 0],
  ["wardrobe_l", 9.10, 5.00, 0],
  ["corner_shower", 5.22, 0.69, 0],
  ["bathtub_compact", 9.43, 6.90, 270],
  ["washing_machine", 6.00, 3.55, 180],
];

/** Rule 2: place the best reading of an ambiguous symbol, and say so. */
export const NOTES = [
  ["leave_note", {
    text:
      "Ambiguous symbol, room between the hall and bedroom 1. The plan draws a plain " +
      "1.97 x 1.58 m rectangle there. Read as a run of wardrobes, not a bed: the bed in " +
      "bedroom 1 is drawn with pillow divisions and this is not, and at 2.64 x 2.10 m " +
      "clear the room cannot hold a 2.05 m bed alongside any door swing. Traced as a " +
      "dressing room giving access to bedroom 1. Worth confirming against the original.",
  }],
  ["leave_note", {
    text:
      "Scale assumption: the drawing carries no dimension, so the exterior width was set " +
      "to 10.00 m, giving 10.00 x 11.16 m overall. Every coordinate follows from that one " +
      "number — confirm it before anything is built.",
  }],
];
