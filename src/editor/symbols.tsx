/**
 * Furniture as plan symbols: each built-in kind drawn the way a plan draws it (a sofa's back and
 * seat cushions, a bed's pillows and turned-down sheet, a hob's rings), in the piece's own frame
 * with its centre at the origin and its back edge at -d/2. Lengths are in metres, scaled by the
 * view's pixels per metre, so the detail grows and shrinks with the drawing.
 *
 * A kind without a symbol of its own (one an agent defined, a supplier's product) is drawn as its
 * footprint with an inset line, and carries its name when the name fits.
 */

import type { ReactNode } from "react";

/** Below this many pixels per metre the detail would be noise: every piece is its footprint. */
export const SYMBOL_DETAIL_MIN_SCALE = 40;

interface Frame {
  /** pixels per metre */
  S: number;
  /** half width and half depth, in pixels */
  hw: number;
  hd: number;
  W: number;
  D: number;
}

type Draw = (f: Frame) => ReactNode;

const box = (key: string, x: number, y: number, w: number, h: number, r: number, cls = "pl-f") => (
  <rect key={key} className={cls} x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} rx={r} />
);
const line = (key: string, d: string, cls = "pl-fd") => <path key={key} className={cls} d={d} />;
const ring = (key: string, cx: number, cy: number, r: number, cls = "pl-fd") => <circle key={key} className={cls} cx={cx} cy={cy} r={Math.max(0, r)} />;

/** a plain footprint: the fallback, and the far-zoom drawing of every piece */
const footprint: Draw = ({ S, hw, hd, W, D }) => box("body", -hw, -hd, W, D, 0.02 * S);

const sofa = (seats: number): Draw => ({ S, hw, hd, W, D }) => {
  const arm = 0.16 * S;
  const back = 0.2 * S;
  const seatW = (W - 2 * arm) / seats;
  let d = `M${-hw + arm} ${-hd + back}V${hd - 0.025 * S}M${hw - arm} ${-hd + back}V${hd - 0.025 * S}`;
  for (let i = 1; i < seats; i++) d += `M${-hw + arm + i * seatW} ${-hd + back}V${hd - 0.075 * S}`;
  return [box("body", -hw, -hd, W, D, 0.05 * S), box("back", -hw + arm, -hd, W - 2 * arm, back, 0.025 * S, "pl-fd-ink"), line("seats", d)];
};

const bed = (pillows: number): Draw => ({ S, hw, hd, W, D }) => {
  const inset = 0.06 * S;
  const pw = (W - inset * (pillows + 1)) / pillows;
  const sheet = -hd + 0.62 * S;
  const fold = 0.28 * S;
  const out: ReactNode[] = [box("body", -hw, -hd, W, D, 0.04 * S)];
  for (let i = 0; i < pillows; i++) out.push(box(`p${i}`, -hw + inset + i * (pw + inset), -hd + inset, pw, 0.36 * S, 0.05 * S, "pl-fd-ink"));
  out.push(line("sheet", `M${-hw} ${sheet}H${hw}M${hw} ${sheet + fold}L${hw - fold} ${sheet}`));
  return out;
};

const table: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.04 * S), box("top", -hw + 0.06 * S, -hd + 0.06 * S, W - 0.12 * S, D - 0.12 * S, 0.025 * S, "pl-fd")];

const ovalTable: Draw = ({ S, hw, hd }) => [
  <ellipse key="body" className="pl-f" rx={hw} ry={hd} />,
  <ellipse key="top" className="pl-fd" rx={Math.max(0, hw - 0.06 * S)} ry={Math.max(0, hd - 0.06 * S)} />,
];

const chair: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.05 * S), line("back", `M${-hw + 0.04 * S} ${-hd + 0.06 * S}H${hw - 0.04 * S}`, "pl-fd-ink")];

const armchair: Draw = ({ S, hw, hd, W, D }) => {
  const arm = 0.14 * S;
  const back = 0.18 * S;
  return [
    box("body", -hw, -hd, W, D, 0.06 * S),
    box("back", -hw + arm, -hd, W - 2 * arm, back, 0.025 * S, "pl-fd-ink"),
    line("arms", `M${-hw + arm} ${-hd + back}V${hd - 0.03 * S}M${hw - arm} ${-hd + back}V${hd - 0.03 * S}`),
  ];
};

const officeChair: Draw = ({ S, hw, hd }) => {
  const r = Math.min(hw, hd) - 0.04 * S;
  return [
    ring("seat", 0, 0.025 * S, r, "pl-f"),
    line("back", `M${-hw + 0.05 * S} ${-hd + 0.075 * S}Q0 ${-hd - 0.025 * S} ${hw - 0.05 * S} ${-hd + 0.075 * S}`, "pl-fd-ink"),
  ];
};

const desk: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.025 * S),
  line("pad", `M${-hw + 0.3 * S} ${-hd + 0.075 * S}h${Math.min(0.42 * S, W * 0.35)}`),
  box("screen", Math.min(-hw + 0.85 * S, hw - 0.4 * S), -hd + 0.1 * S, 0.3 * S, 0.18 * S, 0.0125 * S, "pl-fd"),
];

const sink = (key: string, x: number, y: number, w: number, h: number, S: number): ReactNode[] => [
  box(`${key}-bowl`, x, y, w, h, 0.075 * S, "pl-fd-ink"),
  ring(`${key}-drain`, x + w / 2, y + 0.06 * S, 0.025 * S),
];

const hob = (key: string, x: number, y: number, S: number): ReactNode[] =>
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([i, j]) => ring(`${key}${i}${j}`, x + 0.11 * S + i * 0.25 * S, y + 0.16 * S + j * 0.25 * S, (i ^ j ? 0.06 : 0.09) * S, "pl-fd-ink"));

const counter: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.02 * S),
  ...sink("sink", -hw + 0.55 * S, -hd + 0.1 * S, 0.55 * S, D - 0.2 * S, S),
  ...hob("hob", -hw + 1.6 * S, -hd, S),
];
const counterUnit: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.02 * S), line("doors", `M0 ${-hd}V${hd}`)];
const sinkUnit: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.02 * S), ...sink("sink", -0.3 * S, -hd + 0.1 * S, 0.6 * S, D - 0.2 * S, S)];
const hobUnit: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.02 * S), ...hob("hob", -0.36 * S, -hd, S)];

const fridge: Draw = ({ S, hw, hd, W, D }) => {
  const i = 0.05 * S;
  return [box("body", -hw, -hd, W, D, 0.025 * S), line("x", `M${-hw + i} ${-hd + i}L${hw - i} ${hd - i}M${hw - i} ${-hd + i}L${-hw + i} ${hd - i}`)];
};

const tvStand: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.025 * S), box("tv", -hw + 0.15 * S, -hd + 0.04 * S, W - 0.3 * S, 0.05 * S, 0.0125 * S, "pl-fd-ink")];

const sideboard: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.02 * S), line("doors", `M${-hw + W / 3} ${-hd}V${hd}M${-hw + (2 * W) / 3} ${-hd}V${hd}`)];

const shelf: Draw = ({ S, hw, hd, W, D }) => {
  let d = "";
  for (let i = 1; i < 4; i++) d += `M${-hw + (W * i) / 4} ${-hd}V${hd}`;
  return [box("body", -hw, -hd, W, D, 0.02 * S), line("bays", d)];
};

const rug: Draw = ({ S, hw, hd, W, D }) => [
  box("edge", -hw, -hd, W, D, 0.025 * S, "pl-rug"),
  box("field", -hw + 0.075 * S, -hd + 0.075 * S, W - 0.15 * S, D - 0.15 * S, 0.0125 * S, "pl-rug-in"),
];

const plant: Draw = ({ S, hw }) => {
  const r = hw;
  let d = "";
  for (let a = 0; a < 6; a++) {
    const t = (a * Math.PI) / 3 + 0.3;
    d += `M0 0L${(Math.cos(t) * r * 0.85).toFixed(1)} ${(Math.sin(t) * r * 0.85).toFixed(1)}`;
  }
  return [ring("pot", 0, 0, r, "pl-f"), line("leaves", d), ring("stem", 0, 0, 0.04 * S, "pl-fd-ink")];
};

const nightstand: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.025 * S), ring("lamp", 0, 0, 0.1 * S), ring("bulb", 0, 0, 0.04 * S)];

const wardrobe: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.02 * S),
  line("rail", `M${-hw + 0.05 * S} 0H${hw - 0.05 * S}M0 ${-hd}V${hd}`),
  line("doors", `M${-hw + 0.125 * S} ${hd - 0.04 * S}H${-0.125 * S}M${0.125 * S} ${hd - 0.04 * S}H${hw - 0.125 * S}`, "pl-fd-ink"),
];

const bathtub: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.05 * S),
  box("basin", -hw + 0.08 * S, -hd + 0.08 * S, W - 0.16 * S, D - 0.16 * S, Math.min(D, W) * 0.3, "pl-fd-ink"),
  ring("drain", -hw + 0.25 * S, 0, 0.03 * S),
];

const cornerBath: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.03 * S),
  line("basin", `M${-hw + 0.1 * S} ${-hd + 0.1 * S}H${hw - 0.35 * S}A${W - 0.45 * S} ${D - 0.45 * S} 0 0 1 ${-hw + 0.1 * S} ${hd - 0.35 * S}Z`, "pl-fd-ink"),
];

const shower: Draw = ({ S, hw, hd, W, D }) => [
  box("tray", -hw, -hd, W, D, 0.02 * S),
  line("fall", `M${-hw} ${-hd}L${hw} ${hd}M${hw} ${-hd}L${-hw} ${hd}`),
  ring("drain", 0, 0, 0.04 * S, "pl-fd-ink"),
];

const toilet: Draw = ({ S, hw, hd, W }) => {
  const tank = 0.18 * S;
  return [
    box("tank", -hw, -hd, W, tank, 0.025 * S),
    <ellipse key="bowl" className="pl-f" cx={0} cy={-hd + tank + (2 * hd - tank) / 2} rx={hw * 0.9} ry={(2 * hd - tank) / 2} />,
    <ellipse key="seat" className="pl-fd" cx={0} cy={-hd + tank + (2 * hd - tank) / 2} rx={hw * 0.6} ry={(2 * hd - tank) / 2 - 0.06 * S} />,
  ];
};

const washbasin: Draw = ({ S, hw, hd, W, D }) => [
  box("body", -hw, -hd, W, D, 0.04 * S),
  <ellipse key="bowl" className="pl-fd-ink" cx={0} cy={0.03 * S} rx={Math.max(0, hw - 0.07 * S)} ry={Math.max(0, hd - 0.08 * S)} />,
  ring("tap", 0, -hd + 0.05 * S, 0.02 * S),
];

const towelRail: Draw = ({ S, hw, hd, W, D }) => [box("body", -hw, -hd, W, D, 0.02 * S), line("bar", `M${-hw + 0.04 * S} 0H${hw - 0.04 * S}`, "pl-fd-ink")];

/**
 * A car seen from above, as a plan's reference vehicle is drawn: the body with rounded corners,
 * the windscreen and the rear window (trapezoids, wider at the bonnet and the boot), the roof
 * between them, the door mirrors. Its rear is the back edge (-d/2), its bonnet the front (+d/2),
 * so it parks nose in from the way its rotation faces. Proportions are fractions of the car's own
 * length and width, so the symbol fits any size the kind is given.
 */
const CAR = Object.freeze({
  /** from the front: where the windscreen starts and ends, and from the back the rear window */
  screen: [0.24, 0.39] as const,
  rear: [0.19, 0.29] as const,
  /** the glass's width at its wide and its narrow end, as fractions of the car's width */
  wide: 0.84,
  narrow: 0.7,
  /** corner radius, and the mirrors' reach and depth, fractions of the width */
  corner: 0.22,
  mirror: 0.09,
  mirrorDepth: 0.06,
});

const car: Draw = ({ hw, hd, W, D }) => {
  const front = (f: number) => hd - f * D;
  const back = (f: number) => -hd + f * D;
  const glass = (key: string, wideY: number, narrowY: number) =>
    line(
      key,
      `M${-hw * CAR.wide} ${wideY}L${hw * CAR.wide} ${wideY}L${hw * CAR.narrow} ${narrowY}L${-hw * CAR.narrow} ${narrowY}Z`,
      "pl-fd-ink",
    );
  const m = CAR.mirror * W;
  const md = CAR.mirrorDepth * W;
  const my = front(CAR.screen[0]) - md;
  return [
    box("body", -hw, -hd, W, D, CAR.corner * W),
    glass("screen", front(CAR.screen[0]), front(CAR.screen[1])),
    glass("rear", back(CAR.rear[0]), back(CAR.rear[1])),
    line("roof", `M${-hw * CAR.narrow} ${front(CAR.screen[1])}V${back(CAR.rear[1])}M${hw * CAR.narrow} ${front(CAR.screen[1])}V${back(CAR.rear[1])}`),
    box("mirror-l", -hw - m, my, m, md, md / 2),
    box("mirror-r", hw, my, m, md, md / 2),
  ];
};

const SYMBOLS: Readonly<Record<string, Draw>> = Object.freeze({
  sofa: sofa(3),
  sofa_3: sofa(3),
  armchair,
  coffee_table: table,
  side_table: table,
  sideboard,
  tv_sideboard: tvStand,
  tv_stand: tvStand,
  bookshelf: shelf,
  rug,
  bed_double: bed(2),
  bed_single: bed(1),
  nightstand,
  wardrobe,
  desk,
  office_chair: officeChair,
  dining_table: table,
  dining_table_oval: ovalTable,
  dining_chair: chair,
  kitchen_counter: counter,
  counter_unit: counterUnit,
  kitchen_sink_unit: sinkUnit,
  kitchen_hob_unit: hobUnit,
  fridge,
  bathtub,
  corner_bath: cornerBath,
  shower,
  toilet,
  sink: washbasin,
  towel_rail: towelRail,
  plant,
  car,
});

/** Whether a kind has a symbol of its own (it reads without its name). */
export const hasSymbol = (kind: string): boolean => Object.hasOwn(SYMBOLS, kind);

/** The plan symbol of a piece `w` by `d` metres at `S` pixels per metre. */
export function furnitureSymbol(kind: string, w: number, d: number, S: number): ReactNode {
  const frame: Frame = { S, hw: (w * S) / 2, hd: (d * S) / 2, W: w * S, D: d * S };
  if (S < SYMBOL_DETAIL_MIN_SCALE) return kind === "rug" ? rug(frame) : footprint(frame);
  const draw = SYMBOLS[kind];
  if (draw) return draw(frame);
  // a piece without a symbol: its footprint and an inset line, so it reads as furniture
  return [footprint(frame), box("inset", -frame.hw + 0.05 * S, -frame.hd + 0.05 * S, frame.W - 0.1 * S, frame.D - 0.1 * S, 0.0125 * S, "pl-fd")];
}
