/**
 * Composite furniture builders — each kind is a small THREE.Group of primitives
 * with calibrated PBR materials. Local frame: footprint centered at origin,
 * width along +x, depth along +z, front facing +z.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { catalogByKind } from "../model/catalog";

const mat = (color: string, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const FABRIC = (c: string) => mat(c, 0.95);
const WOOD = (c: string) => mat(c, 0.6);
const METAL = (c: string) => mat(c, 0.35, 0.7);
const DARK = mat("#2e2c2a", 0.5);
const CERAMIC = (c = "#eef1f3") => mat(c, 0.12, 0.02); // glazed sanitaryware
const WATER = new THREE.MeshStandardMaterial({ color: "#9fc6dd", roughness: 0.05, transparent: true, opacity: 0.5 });
const PANE = new THREE.MeshPhysicalMaterial({ color: "#cfe3ee", roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide });

/**
 * Every furniture box gets a small chamfer — real objects have no razor edges, and the
 * highlight along a bevel is what stops the model reading as a stack of primitives.
 */
function bevelled(w: number, h: number, d: number): THREE.BufferGeometry {
  // thin slabs (rugs, panels, glass) keep sharp edges: a bevel comparable to the slab's own
  // thickness bends the face normals and shades the surface like a pillow
  if (Math.min(w, h, d) < 0.06) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 2, 0.014);
}

function B(
  w: number,
  h: number,
  d: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  ry = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(bevelled(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function C(
  rTop: number,
  rBot: number,
  h: number,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  seg = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function S(r: number, m: THREE.Material, x = 0, y = 0, z = 0, squashY = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
  mesh.position.set(x, y, z);
  mesh.scale.y = squashY;
  mesh.castShadow = true;
  return mesh;
}

type Builder = () => THREE.Group;

const sofa: Builder = () => {
  const g = new THREE.Group();
  const body = FABRIC("#7a8ba0");
  const cushion = FABRIC("#8b9cb2");
  g.add(B(2.1, 0.35, 0.9, body, 0, 0.22, 0)); // base
  g.add(B(2.1, 0.55, 0.22, body, 0, 0.62, -0.34)); // back
  g.add(B(0.22, 0.3, 0.9, body, -0.94, 0.5, 0)); // arm L
  g.add(B(0.22, 0.3, 0.9, body, 0.94, 0.5, 0)); // arm R
  g.add(B(0.82, 0.14, 0.6, cushion, -0.42, 0.46, 0.08)); // seat L
  g.add(B(0.82, 0.14, 0.6, cushion, 0.42, 0.46, 0.08)); // seat R
  g.add(B(0.82, 0.4, 0.14, cushion, -0.42, 0.72, -0.26)); // back cushion L
  g.add(B(0.82, 0.4, 0.14, cushion, 0.42, 0.72, -0.26)); // back cushion R
  for (const [x, z] of [[-0.95, 0.35], [0.95, 0.35], [-0.95, -0.35], [0.95, -0.35]] as const) {
    g.add(C(0.03, 0.03, 0.08, DARK, x, 0.04, z));
  }
  return g;
};

const armchair: Builder = () => {
  const g = new THREE.Group();
  const body = FABRIC("#8a9bb0");
  g.add(B(0.85, 0.35, 0.85, body, 0, 0.22, 0));
  g.add(B(0.85, 0.55, 0.2, body, 0, 0.62, -0.32));
  g.add(B(0.18, 0.28, 0.85, body, -0.34, 0.5, 0));
  g.add(B(0.18, 0.28, 0.85, body, 0.34, 0.5, 0));
  g.add(B(0.5, 0.12, 0.55, FABRIC("#9badc2"), 0, 0.45, 0.05));
  return g;
};

const coffeeTable: Builder = () => {
  const g = new THREE.Group();
  g.add(B(1.1, 0.05, 0.55, WOOD("#a08050"), 0, 0.4, 0));
  for (const [x, z] of [[-0.5, 0.22], [0.5, 0.22], [-0.5, -0.22], [0.5, -0.22]] as const) {
    g.add(B(0.05, 0.38, 0.05, WOOD("#7d6240"), x, 0.19, z));
  }
  return g;
};

const tvStand: Builder = () => {
  const g = new THREE.Group();
  g.add(B(1.6, 0.45, 0.4, WOOD("#5c5148"), 0, 0.25, 0));
  g.add(B(1.45, 0.8, 0.04, DARK, 0, 0.95, -0.1)); // TV panel
  g.add(B(0.3, 0.06, 0.18, DARK, 0, 0.52, -0.1)); // TV foot
  return g;
};

const bookshelf: Builder = () => {
  const g = new THREE.Group();
  const wood = WOOD("#8b6f4e");
  g.add(B(0.9, 1.9, 0.04, wood, 0, 0.95, -0.14)); // back
  g.add(B(0.04, 1.9, 0.32, wood, -0.43, 0.95, 0)); // side L
  g.add(B(0.04, 1.9, 0.32, wood, 0.43, 0.95, 0)); // side R
  const bookColors = ["#b5533c", "#3c6eb5", "#4f9e57", "#c9a227", "#7e57c2"];
  for (let i = 0; i < 5; i++) {
    const y = 0.12 + i * 0.36;
    g.add(B(0.86, 0.03, 0.3, wood, 0, y, 0)); // shelf
    for (let bIdx = 0; bIdx < 5; bIdx++) {
      const bx = -0.32 + bIdx * 0.15;
      g.add(B(0.1, 0.24 + (bIdx % 2) * 0.05, 0.2, mat(bookColors[(i + bIdx) % 5], 0.85), bx, y + 0.15, 0));
    }
  }
  g.add(B(0.86, 0.03, 0.3, wood, 0, 1.92, 0)); // top
  return g;
};

const rug: Builder = () => {
  const g = new THREE.Group();
  const m = B(2.4, 0.02, 1.7, mat("#b0987f", 1), 0, 0.045, 0);
  m.castShadow = false;
  g.add(m);
  const inner = B(2.1, 0.022, 1.4, mat("#c4ad8d", 1), 0, 0.046, 0);
  inner.castShadow = false;
  g.add(inner);
  return g;
};

const bedDouble: Builder = () => {
  const g = new THREE.Group();
  g.add(B(1.6, 0.25, 2.05, WOOD("#6f6156"), 0, 0.18, 0)); // frame
  g.add(B(1.5, 0.22, 1.95, FABRIC("#e8e4dc"), 0, 0.4, 0)); // mattress
  g.add(B(1.5, 0.1, 1.25, FABRIC("#9aa5b5"), 0, 0.48, 0.32)); // blanket
  g.add(B(0.62, 0.12, 0.38, FABRIC("#f2efe8"), -0.38, 0.52, -0.72)); // pillow L
  g.add(B(0.62, 0.12, 0.38, FABRIC("#f2efe8"), 0.38, 0.52, -0.72)); // pillow R
  g.add(B(1.6, 0.7, 0.08, WOOD("#6f6156"), 0, 0.5, -1.0)); // headboard
  return g;
};

const nightstand: Builder = () => {
  const g = new THREE.Group();
  g.add(B(0.45, 0.5, 0.4, WOOD("#7c6a54"), 0, 0.28, 0));
  g.add(B(0.37, 0.02, 0.32, WOOD("#8f7c64"), 0, 0.54, 0));
  g.add(B(0.2, 0.02, 0.02, METAL("#c9c9c9"), 0, 0.35, 0.2));
  return g;
};

const wardrobe: Builder = () => {
  const g = new THREE.Group();
  const wood = WOOD("#6f6156");
  g.add(B(1.5, 2.1, 0.6, wood, 0, 1.05, 0));
  g.add(B(0.02, 1.7, 0.02, METAL("#d8d8d8"), -0.06, 1.05, 0.31)); // handle L
  g.add(B(0.02, 1.7, 0.02, METAL("#d8d8d8"), 0.06, 1.05, 0.31)); // handle R
  g.add(B(1.54, 0.04, 0.64, WOOD("#5d5148"), 0, 2.12, 0)); // top trim
  return g;
};

const desk: Builder = () => {
  const g = new THREE.Group();
  g.add(B(1.3, 0.04, 0.65, WOOD("#a58a66"), 0, 0.73, 0));
  g.add(B(0.05, 0.71, 0.6, WOOD("#8a7050"), -0.6, 0.36, 0));
  g.add(B(0.05, 0.71, 0.6, WOOD("#8a7050"), 0.6, 0.36, 0));
  g.add(B(0.5, 0.03, 0.3, DARK, -0.2, 0.77, -0.1)); // laptop base
  g.add(B(0.5, 0.32, 0.02, DARK, -0.2, 0.93, -0.24)); // laptop screen
  return g;
};

const officeChair: Builder = () => {
  const g = new THREE.Group();
  g.add(B(0.55, 0.08, 0.55, FABRIC("#4a4f58"), 0, 0.5, 0)); // seat
  g.add(B(0.55, 0.6, 0.08, FABRIC("#4a4f58"), 0, 0.85, -0.26)); // back
  g.add(C(0.03, 0.03, 0.45, METAL("#9a9a9a"), 0, 0.25, 0)); // stem
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(B(0.3, 0.03, 0.05, METAL("#9a9a9a"), Math.cos(a) * 0.16, 0.03, Math.sin(a) * 0.16, -a));
  }
  return g;
};

const diningTable: Builder = () => {
  const g = new THREE.Group();
  g.add(B(1.6, 0.05, 0.9, WOOD("#b08d5f"), 0, 0.73, 0));
  for (const [x, z] of [[-0.72, 0.37], [0.72, 0.37], [-0.72, -0.37], [0.72, -0.37]] as const) {
    g.add(B(0.06, 0.71, 0.06, WOOD("#96754e"), x, 0.36, z));
  }
  return g;
};

const diningChair: Builder = () => {
  const g = new THREE.Group();
  const wood = WOOD("#96754e");
  g.add(B(0.45, 0.04, 0.45, wood, 0, 0.45, 0));
  g.add(B(0.45, 0.45, 0.04, wood, 0, 0.7, -0.2));
  for (const [x, z] of [[-0.19, 0.19], [0.19, 0.19], [-0.19, -0.19], [0.19, -0.19]] as const) {
    g.add(B(0.04, 0.44, 0.04, wood, x, 0.22, z));
  }
  return g;
};

const kitchenCounter: Builder = () => {
  const g = new THREE.Group();
  g.add(B(2.4, 0.85, 0.62, mat("#c9c2b8", 0.7), 0, 0.45, 0)); // body
  g.add(B(2.46, 0.05, 0.66, mat("#8d8578", 0.4), 0, 0.9, 0)); // worktop
  g.add(B(0.5, 0.02, 0.4, METAL("#b9c0c7"), -0.6, 0.93, 0)); // sink
  g.add(C(0.02, 0.02, 0.25, METAL("#b9c0c7"), -0.6, 1.02, -0.15)); // faucet
  g.add(B(0.6, 0.02, 0.45, DARK, 0.6, 0.93, 0)); // cooktop
  for (let i = 0; i < 4; i++) {
    g.add(B(0.02, 0.12, 0.02, METAL("#d8d8d8"), -1.0 + i * 0.66, 0.55, 0.32)); // handles
  }
  return g;
};

const fridge: Builder = () => {
  const g = new THREE.Group();
  const steel = mat("#c9d0d6", 0.28, 0.65);
  const doorFace = mat("#dbe1e6", 0.22, 0.7);
  const gasket = mat("#3f4448", 0.85);
  // carcass, set back so the doors stand proud of it like a real appliance
  g.add(B(0.68, 1.72, 0.62, mat("#aeb5bb", 0.5, 0.3), 0, 0.95, -0.03));
  g.add(B(0.7, 0.09, 0.7, mat("#8f959a", 0.7), 0, 0.045, 0)); // plinth
  g.add(B(0.72, 0.03, 0.72, steel, 0, 1.83, 0)); // top cap
  // fridge door (lower, tall) + freezer door (upper) with a shadow gap between them
  const doors: Array<[number, number]> = [
    [0.66, 0.5],
    [1.06, 1.24],
  ];
  for (const [dh, dy] of doors) {
    g.add(B(0.7, dh, 0.05, doorFace, 0, dy, 0.33));
    g.add(B(0.64, dh - 0.06, 0.012, gasket, 0, dy, 0.302)); // gasket seen at the edges
  }
  // full-height brushed handles on the opening side
  for (const [hy, hh] of [
    [0.5, 0.44],
    [1.24, 0.8],
  ] as const) {
    g.add(C(0.016, 0.016, hh, METAL("#8d949a"), 0.26, hy, 0.39));
    g.add(B(0.03, 0.03, 0.06, METAL("#8d949a"), 0.26, hy + hh / 2 - 0.02, 0.365));
    g.add(B(0.03, 0.03, 0.06, METAL("#8d949a"), 0.26, hy - hh / 2 + 0.02, 0.365));
  }
  // hinge barrels + a small control display
  for (const y of [0.28, 0.72, 0.86, 1.62]) g.add(C(0.022, 0.022, 0.05, METAL("#9aa0a6"), -0.335, y, 0.3));
  g.add(B(0.18, 0.07, 0.01, mat("#2b3238", 0.2), -0.16, 1.55, 0.357));
  return g;
};

const bedSingle: Builder = () => {
  const g = new THREE.Group();
  g.add(B(0.9, 0.22, 1.9, WOOD("#6f6156"), 0, 0.16, 0)); // frame
  g.add(B(0.84, 0.2, 1.8, FABRIC("#e8e4dc"), 0, 0.37, 0)); // mattress
  g.add(B(0.84, 0.09, 1.1, FABRIC("#a3adbb"), 0, 0.44, 0.3)); // blanket
  g.add(B(0.6, 0.11, 0.34, FABRIC("#f2efe8"), 0, 0.47, -0.64)); // pillow
  g.add(B(0.9, 0.62, 0.07, WOOD("#6f6156"), 0, 0.42, -0.92)); // headboard
  return g;
};

const bathtub: Builder = () => {
  const g = new THREE.Group();
  const cer = CERAMIC("#e8eef2");
  g.add(B(1.7, 0.14, 0.75, cer, 0, 0.07, 0)); // base
  g.add(B(1.7, 0.55, 0.1, cer, 0, 0.275, -0.325)); // long side (back)
  g.add(B(1.7, 0.55, 0.1, cer, 0, 0.275, 0.325)); // long side (front)
  g.add(B(0.1, 0.55, 0.75, cer, -0.8, 0.275, 0)); // end L
  g.add(B(0.1, 0.55, 0.75, cer, 0.8, 0.275, 0)); // end R
  const water = B(1.5, 0.26, 0.55, WATER, 0, 0.26, 0);
  water.castShadow = false;
  g.add(water);
  g.add(C(0.022, 0.022, 0.2, METAL("#c2c8cc"), -0.68, 0.63, -0.22)); // tap stem
  g.add(B(0.03, 0.03, 0.16, METAL("#c2c8cc"), -0.68, 0.71, -0.13)); // spout
  return g;
};

const shower: Builder = () => {
  const g = new THREE.Group();
  const cer = CERAMIC("#e4ebef");
  g.add(B(0.9, 0.1, 0.9, cer, 0, 0.05, 0)); // tray
  g.add(C(0.06, 0.06, 0.015, METAL("#b9c0c7"), 0, 0.105, 0)); // drain
  g.add(B(0.04, 1.95, 0.9, mat("#dfe6ea", 0.35), -0.43, 1.07, 0)); // tiled wall L
  g.add(B(0.9, 1.95, 0.04, mat("#dfe6ea", 0.35), 0, 1.07, -0.43)); // tiled wall back
  const p1 = B(0.9, 1.9, 0.02, PANE, 0, 1.05, 0.44); // glass front
  const p2 = B(0.02, 1.9, 0.9, PANE, 0.44, 1.05, 0); // glass side
  p1.castShadow = false;
  p2.castShadow = false;
  g.add(p1, p2);
  g.add(C(0.02, 0.02, 0.24, METAL("#b9c0c7"), -0.25, 1.85, -0.3)); // riser
  g.add(B(0.02, 0.02, 0.2, METAL("#b9c0c7"), -0.25, 1.96, -0.2)); // arm
  g.add(C(0.07, 0.07, 0.03, METAL("#b9c0c7"), -0.25, 1.94, -0.11)); // head
  return g;
};

const toilet: Builder = () => {
  const g = new THREE.Group();
  const cer = CERAMIC();
  g.add(B(0.36, 0.44, 0.17, cer, 0, 0.44, -0.235)); // cistern
  g.add(B(0.09, 0.02, 0.05, METAL("#c2c8cc"), 0, 0.665, -0.235)); // flush button
  g.add(B(0.2, 0.3, 0.28, cer, 0, 0.15, -0.06)); // pedestal
  g.add(C(0.17, 0.13, 0.34, cer, 0, 0.17, 0.09)); // bowl
  g.add(C(0.185, 0.185, 0.045, cer, 0, 0.36, 0.09)); // rim
  const seat = C(0.15, 0.15, 0.025, mat("#dfe4e7", 0.3), 0, 0.395, 0.09);
  g.add(seat);
  g.add(B(0.3, 0.03, 0.16, cer, 0, 0.4, -0.12)); // lid resting on the cistern
  return g;
};

const sink: Builder = () => {
  const g = new THREE.Group();
  const cer = CERAMIC("#e7ebee");
  g.add(C(0.1, 0.14, 0.66, cer, 0, 0.33, -0.02)); // pedestal
  g.add(B(0.55, 0.15, 0.42, cer, 0, 0.75, 0)); // basin block
  const bowl = C(0.17, 0.13, 0.1, mat("#dde4e8", 0.15), 0, 0.79, 0.02);
  g.add(bowl);
  g.add(B(0.55, 0.1, 0.04, cer, 0, 0.87, -0.19)); // backsplash
  g.add(C(0.02, 0.02, 0.14, METAL("#c2c8cc"), 0, 0.9, -0.15)); // tap stem
  g.add(B(0.03, 0.03, 0.13, METAL("#c2c8cc"), 0, 0.96, -0.09)); // spout
  return g;
};

const towelRail: Builder = () => {
  const g = new THREE.Group();
  const m = METAL("#c8ccd0");
  g.add(B(0.04, 0.04, 0.1, m, -0.27, 1.05, -0.02)); // bracket L
  g.add(B(0.04, 0.04, 0.1, m, 0.27, 1.05, -0.02)); // bracket R
  const bar = C(0.018, 0.018, 0.58, m, 0, 1.05, 0.03, 12);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  g.add(B(0.24, 0.55, 0.03, FABRIC("#dfe7ea"), -0.13, 0.78, 0.045)); // towel
  g.add(B(0.24, 0.42, 0.03, FABRIC("#c9d6da"), 0.14, 0.85, 0.045)); // towel
  return g;
};

const sofa3: Builder = () => {
  const g = new THREE.Group();
  const body = FABRIC("#6f8095");
  const cushion = FABRIC("#8293a8");
  g.add(B(2.6, 0.32, 0.95, body, 0, 0.21, 0)); // base
  g.add(B(2.6, 0.56, 0.24, body, 0, 0.6, -0.355)); // back
  g.add(B(0.24, 0.34, 0.95, body, -1.18, 0.52, 0)); // arm L
  g.add(B(0.24, 0.34, 0.95, body, 1.18, 0.52, 0)); // arm R
  for (const x of [-0.76, 0, 0.76]) {
    g.add(B(0.72, 0.16, 0.66, cushion, x, 0.45, 0.08)); // seat
    g.add(B(0.72, 0.42, 0.15, cushion, x, 0.72, -0.28)); // back cushion
  }
  for (const [x, z] of [[-1.18, 0.38], [1.18, 0.38], [-1.18, -0.38], [1.18, -0.38]] as const) {
    g.add(C(0.035, 0.03, 0.09, DARK, x, 0.045, z));
  }
  return g;
};

const sideTable: Builder = () => {
  const g = new THREE.Group();
  g.add(B(0.5, 0.04, 0.5, WOOD("#9a7b52"), 0, 0.48, 0));
  g.add(B(0.44, 0.03, 0.44, WOOD("#8a6c47"), 0, 0.2, 0)); // lower shelf
  for (const [x, z] of [[-0.21, 0.21], [0.21, 0.21], [-0.21, -0.21], [0.21, -0.21]] as const) {
    g.add(B(0.045, 0.46, 0.045, WOOD("#7d6244"), x, 0.23, z));
  }
  return g;
};

const sideboard: Builder = () => {
  const g = new THREE.Group();
  const wood = WOOD("#7d6a54");
  g.add(B(2.2, 0.62, 0.42, wood, 0, 0.42, 0)); // body
  g.add(B(2.26, 0.04, 0.46, WOOD("#6b5a47"), 0, 0.75, 0)); // top
  for (let i = 0; i < 4; i++) {
    const x = -0.825 + i * 0.55;
    g.add(B(0.52, 0.56, 0.02, WOOD("#8a7660"), x, 0.42, 0.215)); // door face
    g.add(B(0.12, 0.02, 0.02, METAL("#c9c9c9"), x, 0.42, 0.235)); // handle
  }
  for (const x of [-1.02, 1.02]) g.add(B(0.05, 0.11, 0.05, DARK, x, 0.055, 0)); // feet
  return g;
};

const tvSideboard: Builder = () => {
  const g = sideboard();
  const screenW = 1.25;
  const screenH = 0.72;
  const baseY = 0.77; // sideboard top
  g.add(B(0.42, 0.03, 0.24, DARK, 0, baseY + 0.015, 0)); // TV foot plate
  g.add(B(0.09, 0.11, 0.09, DARK, 0, baseY + 0.08, 0)); // neck
  g.add(B(screenW, screenH, 0.05, mat("#26292c", 0.45), 0, baseY + 0.14 + screenH / 2, -0.02)); // chassis
  const panel = B(screenW - 0.04, screenH - 0.04, 0.008, mat("#11161c", 0.12, 0.15), 0, baseY + 0.14 + screenH / 2, 0.008);
  panel.castShadow = false;
  g.add(panel); // glass
  g.add(B(screenW - 0.09, screenH - 0.09, 0.004, mat("#2f4a63", 0.08), 0, baseY + 0.14 + screenH / 2, 0.013)); // faint screen glow
  return g;
};

const diningTableOval: Builder = () => {
  const g = new THREE.Group();
  const top = C(0.95, 0.95, 0.05, WOOD("#b08d5f"), 0, 0.73, 0, 40);
  top.scale.z = 1.0 / 1.9; // ellipse: 1.9 m along x, 1.0 m along z
  g.add(top);
  const skirt = C(0.86, 0.86, 0.06, WOOD("#a07f53"), 0, 0.67, 0, 32);
  skirt.scale.z = 1.0 / 1.9;
  g.add(skirt);
  g.add(B(0.14, 0.62, 0.14, WOOD("#96754e"), -0.5, 0.35, 0)); // pedestal L
  g.add(B(0.14, 0.62, 0.14, WOOD("#96754e"), 0.5, 0.35, 0)); // pedestal R
  g.add(B(0.16, 0.05, 0.7, WOOD("#8a6a45"), -0.5, 0.04, 0)); // foot L
  g.add(B(0.16, 0.05, 0.7, WOOD("#8a6a45"), 0.5, 0.04, 0)); // foot R
  return g;
};

/** Shared carcass for the 1.2 m kitchen units so the run reads as one continuous worktop. */
function counterCarcass(): THREE.Group {
  const g = new THREE.Group();
  g.add(B(1.2, 0.78, 0.6, mat("#c9c2b8", 0.7), 0, 0.47, 0)); // body
  g.add(B(1.2, 0.06, 0.64, mat("#8d8578", 0.35), 0, 0.89, 0)); // worktop
  g.add(B(1.2, 0.08, 0.02, mat("#b6afa5", 0.8), 0, 0.04, 0.3)); // plinth recess
  return g;
}

const counterUnit: Builder = () => {
  const g = counterCarcass();
  for (const y of [0.72, 0.5, 0.26]) {
    g.add(B(1.12, 0.19, 0.02, mat("#d4cec5", 0.6), 0, y, 0.31)); // drawer front
    g.add(B(0.4, 0.02, 0.02, METAL("#d0d0d0"), 0, y + 0.06, 0.33)); // handle
  }
  return g;
};

const kitchenSinkUnit: Builder = () => {
  const g = counterCarcass();
  g.add(B(0.78, 0.03, 0.44, METAL("#b9c0c7"), 0, 0.9, 0)); // sink rim
  const bowl = B(0.66, 0.16, 0.36, mat("#9aa3ab", 0.25, 0.5), 0, 0.83, 0);
  g.add(bowl);
  g.add(C(0.022, 0.022, 0.28, METAL("#c2c8cc"), 0, 1.05, -0.2)); // tap
  g.add(B(0.03, 0.03, 0.18, METAL("#c2c8cc"), 0, 1.17, -0.12)); // spout
  g.add(B(1.12, 0.5, 0.02, mat("#d4cec5", 0.6), 0, 0.38, 0.31)); // doors
  g.add(B(0.02, 0.3, 0.02, METAL("#d0d0d0"), -0.1, 0.5, 0.33));
  g.add(B(0.02, 0.3, 0.02, METAL("#d0d0d0"), 0.1, 0.5, 0.33));
  return g;
};

const kitchenHobUnit: Builder = () => {
  const g = counterCarcass();
  g.add(B(0.72, 0.02, 0.46, DARK, 0, 0.92, 0)); // glass hob
  for (const [x, z] of [[-0.18, -0.11], [0.18, -0.11], [-0.18, 0.11], [0.18, 0.11]] as const) {
    g.add(C(0.07, 0.07, 0.012, mat("#3d3a37", 0.4), x, 0.935, z)); // burner
  }
  g.add(B(1.1, 0.56, 0.03, mat("#8f9499", 0.3, 0.6), 0, 0.44, 0.31)); // oven door
  g.add(B(0.86, 0.24, 0.01, mat("#2a2a2c", 0.15, 0.3), 0, 0.5, 0.325)); // oven glass
  g.add(B(0.9, 0.035, 0.035, METAL("#d0d0d0"), 0, 0.7, 0.34)); // oven handle
  return g;
};

/** Quarter-round wedge: flat backs along -x and -z (the two walls), rounded front. */
function wedge(r: number, h: number, m: THREE.Material, y: number, cast = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 30, 1, false, 0, Math.PI / 2), m);
  mesh.position.set(-0.7, y, -0.7);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

const cornerBath: Builder = () => {
  const g = new THREE.Group();
  const cer = CERAMIC("#e8eef2");
  g.add(wedge(1.4, 0.5, cer, 0.25)); // tub shell with the rounded front skirt
  g.add(wedge(1.16, 0.36, mat("#dfe9ee", 0.15), 0.34)); // basin, 2 cm proud of the rim so it reads as a recess
  g.add(wedge(1.1, 0.14, WATER, 0.44, false));
  g.add(C(0.025, 0.025, 0.24, METAL("#c2c8cc"), -0.56, 0.62, -0.56)); // tap
  const spout = B(0.2, 0.03, 0.03, METAL("#c2c8cc"), -0.44, 0.73, -0.44);
  spout.rotation.y = -Math.PI / 4;
  g.add(spout);
  return g;
};

const plant: Builder = () => {
  const g = new THREE.Group();
  g.add(C(0.14, 0.11, 0.28, mat("#a5663f", 0.8), 0, 0.14, 0)); // pot
  g.add(C(0.015, 0.02, 0.4, WOOD("#6b4f35"), 0, 0.45, 0)); // trunk
  const leaf = mat("#5d8a54", 0.9);
  g.add(S(0.22, leaf, 0, 0.75, 0, 1.15));
  g.add(S(0.16, mat("#6b9a60", 0.9), 0.12, 0.92, 0.06, 1.1));
  g.add(S(0.14, leaf, -0.13, 0.88, -0.05, 1.1));
  return g;
};

export const FURNITURE_BUILDERS: Record<string, Builder> = {
  sofa,
  sofa_3: sofa3,
  armchair,
  coffee_table: coffeeTable,
  side_table: sideTable,
  sideboard,
  tv_sideboard: tvSideboard,
  tv_stand: tvStand,
  bookshelf,
  rug,
  bed_double: bedDouble,
  bed_single: bedSingle,
  nightstand,
  wardrobe,
  desk,
  office_chair: officeChair,
  dining_table: diningTable,
  dining_table_oval: diningTableOval,
  dining_chair: diningChair,
  kitchen_counter: kitchenCounter,
  counter_unit: counterUnit,
  kitchen_sink_unit: kitchenSinkUnit,
  kitchen_hob_unit: kitchenHobUnit,
  fridge,
  bathtub,
  corner_bath: cornerBath,
  shower,
  toilet,
  sink,
  towel_rail: towelRail,
  plant,
};

/**
 * A part of an agent-authored piece. Local frame matches every other builder:
 * width along +x, depth along +z, y measured up from the floor, front facing +z.
 */
export interface PartSpec {
  shape?: "box" | "cylinder" | "sphere";
  x?: number;
  y?: number;
  z?: number;
  w?: number;
  h?: number;
  d?: number;
  color?: string;
  /** degrees about the vertical axis */
  rotation?: number;
  roughness?: number;
  metalness?: number;
}

/** Kinds an agent modelled at runtime with define_item_kind. */
const CUSTOM_PARTS = new Map<string, PartSpec[]>();

export function defineCustomKind(kind: string, parts: PartSpec[]): void {
  CUSTOM_PARTS.set(kind, parts);
}

export function hasCustomKind(kind: string): boolean {
  return CUSTOM_PARTS.has(kind);
}

function buildCustom(parts: PartSpec[], fallbackColor: string): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) {
    const w = Math.max(0.01, p.w ?? 0.3);
    const h = Math.max(0.01, p.h ?? 0.3);
    const d = Math.max(0.01, p.d ?? 0.3);
    const m = mat(p.color ?? fallbackColor, p.roughness ?? 0.7, p.metalness ?? 0);
    let mesh: THREE.Mesh;
    if (p.shape === "cylinder") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 24), m);
      mesh.scale.z = d / w; // an ellipse when depth differs from width
    } else if (p.shape === "sphere") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 20, 14), m);
      mesh.scale.set(1, h / w, d / w);
    } else {
      mesh = new THREE.Mesh(bevelled(w, h, d), m);
    }
    mesh.position.set(p.x ?? 0, (p.y ?? 0) + h / 2, p.z ?? 0);
    mesh.rotation.y = ((p.rotation ?? 0) * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/** Imported partner products have no hand-modelled builder: block them out from the catalogue box. */
function genericPiece(w: number, d: number, h: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const body = mat(color, 0.75);
  g.add(B(w, h * 0.86, d, body, 0, (h * 0.86) / 2 + 0.06, 0));
  g.add(B(w * 0.98, h * 0.08, d * 0.98, mat(color, 0.45), 0, h * 0.9, 0)); // top surface
  for (const [x, z] of [
    [-w / 2 + 0.06, d / 2 - 0.06],
    [w / 2 - 0.06, d / 2 - 0.06],
    [-w / 2 + 0.06, -d / 2 + 0.06],
    [w / 2 - 0.06, -d / 2 + 0.06],
  ] as const) {
    g.add(C(0.025, 0.025, 0.12, DARK, x, 0.06, z));
  }
  return g;
}

export function buildFurniture(kind: string): THREE.Group | null {
  const cat = catalogByKind(kind);
  const custom = CUSTOM_PARTS.get(kind);
  if (custom) return buildCustom(custom, cat?.color ?? "#9a9186");
  const b = FURNITURE_BUILDERS[kind];
  if (b) return b();
  return cat ? genericPiece(cat.w, cat.d, cat.h, cat.color) : null;
}
