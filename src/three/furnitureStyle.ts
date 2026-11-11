/**
 * The furniture's tuning: every proportion, radius, profile and budget the built-in pieces
 * (furniture.ts) are modelled from, in metres unless a name says otherwise (a `…Fraction` or a
 * ratio is a share of the length it names). Colours are tokens (src/ui/theme/sceneTokens.ts
 * FURNITURE); finishes are the shared surfaces (surfaces.ts).
 *
 * A piece is modelled from its catalogue definition: its body fills the kind's w × d × h
 * exactly (model/catalog.ts), the height being what the plan and the agents know the piece by
 * (a worktop's, a bed's, a TV stand's own). What a few pieces carry on top — a tap, a television,
 * a headboard and its pillows — stands over that height by the kind's `fit.rise`, inside the
 * same footprint.
 *
 * Plain data, no three.js: the tests read it under Node.
 */

/** A turned profile: [radius as a fraction of the part's radius, height as a fraction of its length], bottom up. */
export type Profile = readonly (readonly [number, number])[];

export const FURNITURE_STYLE = Object.freeze({
  /** how exactly a built piece fills its catalogue box */
  fit: Object.freeze({
    /** a built piece's bounding box may differ from w × h × d by at most this much */
    tolerance: 0.002,
    /** the design is fitted to the box by a scale; it must already be this close (fraction) */
    maxScale: 0.06,
    /** by kind: how far the fittings stand over the catalogue height (a tap, a TV, a headboard) */
    rise: Object.freeze({
      tv_stand: 0.75,
      bed_double: 0.45,
      bed_single: 0.45,
      kitchen_counter: 0.3,
      kitchen_sink_unit: 0.3,
    } as Readonly<Record<string, number>>),
  }),

  /**
   * The most one piece may cost, by kind (`default` for any kind not named): triangles drawn,
   * and draw calls (one mesh per surface it is made of).
   */
  budget: Object.freeze({
    default: 2000,
    sofa: 3000,
    sofa_3: 4000,
    armchair: 2200,
    bed_double: 3000,
    bed_single: 2400,
  } as Readonly<Record<string, number>>),
  drawCalls: 10,

  /** edges: hard parts take a small bevel, soft ones (cushions, mattresses) a rounded one */
  bevel: Object.freeze({
    hard: 0.008,
    /** a bevel never exceeds this fraction of the part's thinnest side */
    maxFraction: 0.3,
    /** below this thickness a slab keeps sharp edges (a rug, a panel) */
    sharpBelow: 0.012,
    soft: 0.045,
    /** grid lines across one rounded edge, and across a soft part's flat faces per metre */
    edgeSegments: 1,
    softEdgeSegments: 2,
    softPerMetre: 2.5,
    softMaxSegments: 5,
  }),

  /** how many sides round things are turned with */
  segments: Object.freeze({
    large: 28,
    medium: 18,
    small: 10,
    /** a printed ring (the hob's), thin enough that many sides cost little */
    ring: 28,
    /** a quarter round seen whole (the corner bath's front) */
    quarter: 24,
    /** a bulb or a caster: a sphere's rings, as a share of its sides */
    sphereRings: 0.7,
    /** a turned leg or a rail seen from across the room */
    leg: 8,
    /** an oval or a rounded outline, along its whole edge */
    outline: 48,
    /** a rounded corner of an extruded outline */
    corner: 4,
    /** steps round a rounded-over edge (a disc), and the sharpest turn between two wall faces still shaded as one curve (radians) */
    edge: 2,
    smoothTurn: 0.6,
  }),

  /** turned and tapered leg profiles, [radius fraction, height fraction] bottom up */
  legs: Object.freeze({
    turned: Object.freeze([
      [0.62, 0],
      [0.7, 0.04],
      [0.62, 0.1],
      [0.78, 0.22],
      [0.55, 0.36],
      [0.66, 0.6],
      [0.82, 0.78],
      [1, 0.86],
      [1, 1],
    ]) as Profile,
    tapered: Object.freeze([
      [0.55, 0],
      [1, 1],
    ]) as Profile,
  }),

  /** upholstered seating: sofas and the armchair */
  seating: Object.freeze({
    legHeight: 0.1,
    legRadius: 0.022,
    legInset: 0.07,
    frameTop: 0.32,
    armWidth: 0.2,
    armHeight: 0.62,
    backDepth: 0.2,
    backFrameHeightFraction: 0.86,
    seatThickness: 0.14,
    seatGap: 0.012,
    seatSag: 0.02,
    backThickness: 0.17,
    backSag: 0.012,
    backLean: 0.12,
    cushionRadius: 0.05,
    frameRadius: 0.035,
    armRadius: 0.06,
    /** the throw pillow on the end of a three-seater */
    pillow: Object.freeze({ size: 0.34, thickness: 0.13, sag: 0.03, lean: 0.35 }),
  }),

  /** tables and desks */
  tables: Object.freeze({
    topThickness: 0.035,
    apronHeight: 0.08,
    apronInset: 0.06,
    apronThickness: 0.02,
    legSide: 0.05,
    legInset: 0.05,
    coffee: Object.freeze({ cornerRadius: 0.08, shelfHeight: 0.12, shelfThickness: 0.02, legRadius: 0.024 }),
    side: Object.freeze({
      topThickness: 0.03,
      baseRadiusFraction: 0.62,
      baseThickness: 0.025,
      column: Object.freeze([
        [0.07, 0],
        [0.06, 0.12],
        [0.035, 0.3],
        [0.05, 0.5],
        [0.03, 0.7],
        [0.045, 0.92],
        [0.06, 1],
      ]) as Profile,
    }),
    oval: Object.freeze({
      edgeBevel: 0.012,
      /** the tulip pedestal: [radius, height fraction] bottom up, scaled to the top's oval */
      pedestal: Object.freeze([
        [0.34, 0],
        [0.33, 0.025],
        [0.22, 0.06],
        [0.1, 0.16],
        [0.055, 0.4],
        [0.05, 0.72],
        [0.08, 0.9],
        [0.2, 0.97],
        [0.24, 1],
      ]) as Profile,
      pedestalStretch: 1.5,
    }),
    desk: Object.freeze({ pedestalWidth: 0.4, drawers: 3, panelHeight: 0.32, legSide: 0.045 }),
  }),

  /** chairs */
  chairs: Object.freeze({
    seatHeight: 0.46,
    seatThickness: 0.03,
    padThickness: 0.04,
    padSag: 0.008,
    /** grid steps per metre across the seat pad: enough for its sag to show */
    padGrid: 6,
    legRadius: 0.019,
    postSide: 0.035,
    rail: 0.03,
    spindles: 3,
    spindleRadius: 0.009,
    backRailHeight: 0.07,
    /** the seat pad's rounded edge */
    padRadius: 0.018,
    /** the side stretchers: their height as a share of the seat frame's, and their side */
    stretcherHeight: 0.32,
    stretcher: 0.018,
    office: Object.freeze({
      seatHeight: 0.48,
      seatThickness: 0.08,
      seatDepth: 0.48,
      backHeight: 0.5,
      backThickness: 0.07,
      backSag: 0.015,
      /** the seat's and the back's rounded edges */
      seatRadius: 0.036,
      backRadius: 0.032,
      armHeight: 0.22,
      armPad: 0.05,
      columnRadius: 0.025,
      starArm: 0.04,
      /** the star's arms are this high, round a hub of this radius */
      starArmHeight: 0.024,
      hubRadius: 0.048,
      caster: 0.028,
      arms: 5,
      /** the plastic shell under the seat: this share of the seat's width and depth, this thick */
      shellFraction: 0.9,
      shellThickness: 0.02,
      /** the steel spine up the back: its width and depth, and how far up the back it reaches (share) */
      spine: Object.freeze({ width: 0.04, depth: 0.02, reachFraction: 1 / 3 }),
      /**
       * an armrest: a bracket out from under the seat shell to a post, the post up to a pad. The
       * post stands this far back of the seat's centre (share of its depth), the pad a little less.
       */
      arm: Object.freeze({ post: 0.02, depth: 0.04, bracket: 0.02, back: 0.1, padBack: 0.05, padDepthFraction: 0.55, padThickness: 0.02, padRadius: 0.008 }),
    }),
  }),

  /** cabinets: sideboards, the wardrobe, the nightstand, the TV stand, the kitchen units */
  cabinets: Object.freeze({
    gap: 0.004,
    frontThickness: 0.018,
    topThickness: 0.025,
    legHeight: 0.14,
    legRadius: 0.018,
    plinth: 0.08,
    plinthRecess: 0.05,
    /** a front's edge bevel, as a share of its thickness */
    frontBevelFraction: 0.25,
    /**
     * a bar pull: its bar and how far it stands off the front; its posts are set in from the
     * bar's ends by a share of its length (at most `postInsetBars` bars' widths), and are a share
     * of the bar thick. A pull is never longer than a share of its front (`maxFrontFraction`); a
     * drawer's runs `drawerLengths` door pulls long.
     */
    handle: Object.freeze({ bar: 0.012, standoff: 0.025, length: 0.16, postInsetFraction: 0.15, postInsetBars: 2, postFraction: 0.35, maxFrontFraction: 0.5, drawerLengths: 2 }),
    knob: Object.freeze([
      [0.4, 0],
      [0.45, 0.4],
      [1, 0.75],
      [0.9, 1],
    ]) as Profile,
    knobRadius: 0.014,
    knobDepth: 0.022,
    /**
     * the screen on the sideboard and the TV stand: the sideboard's cabinet top it stands on (the
     * stand's is the stand's own height), its 16:9 face at most a share of the piece's width, its
     * bezel, its foot and the neck (a share of the neck's height wide) between
     */
    tv: Object.freeze({
      sideboardTop: 0.75,
      screenRatio: 0.5625,
      maxWidthFraction: 0.94,
      bezel: 0.012,
      screenThickness: 0.003,
      depth: 0.04,
      footWidth: 0.42,
      footDepth: 0.12,
      neck: 0.07,
      neckWidthFraction: 0.6,
      foot: 0.012,
    }),
    wardrobe: Object.freeze({ doors: 3, cornice: 0.04, handleLength: 0.5, handleHeight: 0.5 }),
    nightstand: Object.freeze({ drawers: 2 }),
  }),

  /** the kitchen run */
  kitchen: Object.freeze({
    /** the worktop is at the unit's catalogue height; a tap stands over it by the kind's fit.rise */
    worktopThickness: 0.04,
    carcassDepthInset: 0.02,
    sink: Object.freeze({ w: 0.56, d: 0.4, depth: 0.18, wall: 0.008, corner: 0.05 }),
    /** the gooseneck tap; it stands this many base radii behind the sink's cut */
    tap: Object.freeze({ radius: 0.016, reach: 0.2, base: 0.028, setBack: 1.5 }),
    /** the hob; its rings are set in from its corners by a share of its depth */
    hob: Object.freeze({ w: 0.6, d: 0.5, thickness: 0.006, corner: 0.01, ringInsetFraction: 0.25, ring: Object.freeze({ inner: 0.075, outer: 0.09, lift: 0.0015 }) }),
    oven: Object.freeze({ windowInset: 0.09, handleDrop: 0.06, strip: 0.08, knobs: 4 }),
  }),

  /** the bathroom */
  bath: Object.freeze({
    rim: 0.06,
    rimHeight: 0.5,
    /** the tub floor inside the shell */
    floor: 0.06,
    waterDepth: 0.16,
    corner: 0.2,
    /** the corner bath is drawn round a point this far (a fraction of its radius) out along its diagonal */
    cornerMiddle: 0.35,
    /** the corner bath's mixer: this far along its back wall, as a share of its radius */
    cornerTapAt: 0.45,
    /** a deck mixer: its column, its spout (a share of the column thick), how far the spout reaches */
    tap: Object.freeze({ radius: 0.018, spoutFraction: 0.7, reach: 0.12 }),
    toilet: Object.freeze({
      bowl: Object.freeze([
        [0.12, 0],
        [0.13, 0.25],
        [0.165, 0.7],
        [0.185, 0.93],
        [0.19, 1],
      ]) as Profile,
      bowlHeight: 0.4,
      bowlDepth: 0.46,
      cisternDepth: 0.17,
      cisternHeight: 0.36,
      seatThickness: 0.025,
      button: 0.04,
      /** the seat ring's radius and the lid's, as shares of the bowl's rim */
      seatFraction: 0.8,
      lidFraction: 0.96,
      /** the cistern's width, the trap's width, as shares of the piece's; where the trap starts (share of the cistern's depth) */
      cisternWidthFraction: 0.94,
      trapWidthFraction: 0.55,
      trapBackFraction: 0.5,
      /** the cistern's rounded edge and the flush button's radius, as shares of the cistern's depth */
      cisternRadiusFraction: 0.2,
      buttonFraction: 0.2,
    }),
    basin: Object.freeze({
      rim: 0.78,
      /** the deck round the bowl, the wider deck behind it the tap stands on, its thickness and the bowl wall */
      deck: 0.03,
      tapDeck: 0.08,
      deckThickness: 0.05,
      wall: 0.008,
      bowlDepth: 0.15,
      /** the bowl's section: its flat floor and its belly, as shares of its radius, the belly this far down (share of its depth) */
      bowlFloorFraction: 0.5,
      bowlBellyFraction: 0.92,
      bowlBellyDepth: 0.4,
      column: Object.freeze([
        [0.11, 0],
        [0.075, 0.2],
        [0.06, 0.6],
        [0.075, 0.9],
        [0.1, 1],
      ]) as Profile,
    }),
    /**
     * the shower: tray, tiled walls, glass and frame, the head; the riser rail runs between
     * shares of the height, the head's arm reaches `armReach` heads out, the mixer is set at a
     * share of the height
     */
    shower: Object.freeze({ tray: 0.06, wall: 0.04, glass: 0.008, frame: 0.012, head: 0.1, railFrom: 0.45, railTo: 0.92, armReach: 1.6, mixerAt: 0.42 }),
    /**
     * the heated ladder rail: its tube, its rungs from `rungFrom` to `rungTo` of the height, the
     * stays to the wall at `stays` of it; stays and rungs are a share of the tube thick; two towels
     * hang over rungs counted from the top, at a share of the width across, a share of it wide,
     * dropping a share of their rung's height
     */
    rail: Object.freeze({
      tube: 0.014,
      bars: 7,
      standoff: 0.05,
      towel: 0.008,
      rungFrom: 0.3,
      rungTo: 0.92,
      stays: Object.freeze([0.25, 0.85]),
      stayFraction: 0.6,
      rungFraction: 0.7,
      towels: Object.freeze([
        Object.freeze({ at: -0.2, width: 0.42, rung: 2 }),
        Object.freeze({ at: 0.2, width: 0.36, rung: 4 }),
      ]),
      towelDrop: 0.55,
    }),
  }),

  /** beds */
  beds: Object.freeze({
    legHeight: 0.1,
    railHeight: 0.18,
    railThickness: 0.04,
    /** the frame's rounded edge */
    frameRadius: 0.012,
    /** the mattress is as thick as the bed's height leaves it (never thinner than this) */
    minMattress: 0.12,
    mattressRadius: 0.06,
    duvetThickness: 0.05,
    /** the duvet drops over the mattress's sides by a share of its thickness, and sags by a share of its own */
    duvetDrop: 0.6,
    duvetSag: 0.25,
    duvetCoverage: 0.68,
    duvetOverhang: 0.03,
    /** the sheet turned down over the duvet: its depth, and how many duvets thick its top stands */
    foldDepth: 0.22,
    foldRise: 1.5,
    pillowDepth: 0.36,
    pillowThickness: 0.13,
    pillowSag: 0.035,
    /** pillows lean back (radians), their edges rounded by a share of their thickness, set off the headboard by gaps */
    pillowTilt: 0.18,
    pillowRadiusFraction: 0.42,
    pillowGaps: 4,
    headboardDepth: 0.08,
    /** a channel's rounded edge, as a share of the headboard's depth */
    channelRadiusFraction: 1 / 3,
    channels: 6,
    /** a bed this wide or wider takes two pillows */
    doubleFrom: 1.2,
  }),

  /** the bookshelf and what stands on it */
  shelves: Object.freeze({
    board: 0.022,
    back: 0.008,
    plinth: 0.06,
    tiers: 5,
    bookDepth: Object.freeze([0.16, 0.24]),
    bookWidth: Object.freeze([0.018, 0.045]),
    bookHeight: Object.freeze([0.17, 0.29]),
    /** of each tier's width, how much stands full of books, and how much that varies by tier */
    fill: 0.82,
    fillJitter: 0.2,
    /** a tier with a lying stack at its far end stands this much full */
    stackedFill: 0.55,
    /** the last upright book leans on the run (radians) */
    lean: 0.25,
    /** the lying stack: how many books, each this share of an upright one */
    stack: 3,
    stackScale: 0.8,
  }),

  /** the plant */
  plant: Object.freeze({
    pot: Object.freeze([
      [0.72, 0],
      [0.78, 0.06],
      [0.95, 0.88],
      [1, 0.9],
      [1, 1],
    ]) as Profile,
    potHeight: 0.3,
    potRadiusFraction: 0.68,
    /** the soil: this share of the pot's radius, at this share of its height */
    soilFraction: 0.94,
    soilLevel: 0.9,
    /** the stem: this share of the plant's height, tapering to this share of its radius */
    stemHeight: 0.6,
    stemTaper: 0.6,
    leaves: 22,
    leafLength: 0.24,
    leafWidth: 0.08,
    leafThickness: 0.01,
    /** the top leaf is this much shorter than the bottom one */
    leafShrink: 0.35,
    /**
     * how steeply a leaf rises (radians): `pitch` at the bottom, `pitchRise` more at the top, and
     * up to `pitchJitter` more by chance; leaves start at `start` of the way up, and stand out
     * from the stem by `reach` of the room the pot leaves them
     */
    leafPitch: 0.25,
    leafPitchRise: 0.9,
    leafPitchJitter: 0.15,
    leafStart: 0.25,
    leafReach: 0.3,
    stem: 0.008,
  }),

  /** the floor lamp */
  lamp: Object.freeze({
    baseThickness: 0.025,
    /** the base's section: [radius as a share of the lamp's, height as a share of the base's] */
    base: Object.freeze([
      [0, 0],
      [0.62, 0],
      [0.64, 0.6],
      [0.5, 1],
      [0, 1],
    ]) as Profile,
    stemRadius: 0.012,
    /** the stem reaches this share up into the shade, tapering to this share of its radius */
    stemInto: 0.4,
    stemTaper: 0.8,
    shadeHeight: 0.32,
    shadeTopFraction: 0.72,
    shadeWall: 0.004,
    bulb: 0.035,
    /** the bulb hangs at this share of the shade's height */
    bulbAt: 0.45,
  }),

  /**
   * the rug: a bound border round a woven field, and at each short end a cotton fringe, one
   * band of fine strands (the linen's weave) a step lighter than the border
   */
  rug: Object.freeze({ border: 0.12, fringe: 0.05, fringeThickness: 0.006 }),

  /**
   * the fridge; its door pulls are a share of their door long, and its display is a share of
   * the width wide, so high, set a share of the freezer door down from its top
   */
  fridge: Object.freeze({ plinth: 0.09, cap: 0.03, doorThickness: 0.05, split: 0.36, gap: 0.006, radius: 0.02, pullFraction: 0.6, display: Object.freeze({ widthFraction: 0.26, height: 0.072, dropFraction: 0.15 }) }),

  /**
   * the car, a reference object kept low-poly (furniture.ts car): a body and a glasshouse, each a
   * side profile extruded across it, a roof panel over the glass, four wheels (axles a share of
   * half its length either side of its middle) with hubs, and two lamps on its nose
   */
  car: Object.freeze({
    /** the body's side profile, [share of half its length (+ toward the nose), share of its height] */
    body: Object.freeze([
      [-0.99, 0.16],
      [-0.99, 0.42],
      [-0.94, 0.6],
      [0.34, 0.6],
      [0.92, 0.5],
      [0.99, 0.42],
      [0.99, 0.18],
      [0.93, 0.11],
      [-0.94, 0.11],
    ] as const),
    /** the glasshouse's profile: from inside the body's top, raked to the roof */
    glass: Object.freeze([
      [-0.84, 0.56],
      [0.4, 0.56],
      [0.06, 0.965],
      [-0.6, 0.965],
    ] as const),
    /**
     * the roof panel's ends, shares of half the length: the glasshouse's top, so the roof closes
     * it rather than sitting on it like a lid; and how far it stands past the glass at the sides,
     * just enough that its sides and the glass's are never one plane
     */
    roof: Object.freeze([-0.6, 0.06] as const),
    roofThickness: 0.06,
    roofOverhang: 0.008,
    /**
     * the pillars between its windows, in the body's paint: each a share of half the car's length
     * wide, standing `pillarProud` metres out of the glass's sides (half the roof's overhang, so
     * neither shares a plane with the roof's side); the middle one at `pillarB` along the glass's top
     */
    pillarWidth: 0.05,
    pillarProud: 0.004,
    pillarB: -0.27,
    /** the tyres stand this far proud of the body's sides */
    wheelProud: 0.04,
    wheelRadius: 0.32,
    wheelWidth: 0.21,
    axleFraction: 0.62,
    hubRadius: 0.17,
    hubDepth: 0.02,
    /** the hubs stand this far out of the tyres, at the car's width */
    hubProud: 0.006,
    cabinWidthFraction: 0.88,
    /** a lamp's width (share of the body's), height and foot (shares of the car's), set in from the side; the lamps are the front of the car, the body's nose just behind them */
    lamp: Object.freeze([0.18, 0.06, 0.4] as const),
    lampDepth: 0.03,
    lampInset: 0.08,
  }),

  /** a kind with no builder and no parts: blocked out from its footprint */
  generic: Object.freeze({ plinth: 0.06, plinthInset: 0.03, topFraction: 0.06, radius: 0.02 }),

  /**
   * an agent's parts: the bevel a box part gets, by how soft its surface is, the sides a round
   * part is turned with, and the size of a part that gives none (never smaller than `minSize`)
   */
  parts: Object.freeze({ softRadius: 0.03, hardRadius: 0.006, roundSegments: 20, sphereSegments: 16, defaultSize: 0.3, minSize: 0.01 }),
});

/** The surfaces that never cast a shadow: see-through, glowing or lying flat. */
export const NO_SHADOW_SURFACES: ReadonlySet<string> = new Set(["glass", "water", "screen"]);

/**
 * How far a kind's fittings stand over its catalogue height (FURNITURE_STYLE.fit.rise): only the
 * built-in pieces have fittings; an agent's parts and an imported block stand inside their box.
 */
export const riseOf = (def: { readonly kind: string; readonly source: string }): number =>
  def.source === "builtin" ? (FURNITURE_STYLE.fit.rise[def.kind] ?? 0) : 0;
