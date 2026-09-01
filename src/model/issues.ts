/**
 * Constraint engine — the metric precision checker agents use to self-repair.
 * Every rule returns issues with entity refs so callers can act on them.
 */

import type { Issue, Opening, PlanModel, Wall } from "./types";
import {
  aabbOverlap,
  areCollinear,
  collinearOverlap,
  dist,
  pointOnSeg,
  pointSegDist,
  satRectRect,
  satRectWall,
  segLen,
  segPoint,
  segmentsCross,
  wallAsRect,
  type ORect,
  type Pt,
} from "./geometry";
import { catalogByKind } from "./catalog";

const MIN_WALL_LEN = 0.2; // 20 cm
const ENDPOINT_SNAP = 0.08; // endpoints closer than this count as connected
const DOOR_CLEAR = 0.1; // furniture must keep this margin in front of openings

const wA = (w: Wall): Pt => ({ x: w.ax, y: w.ay });
const wB = (w: Wall): Pt => ({ x: w.bx, y: w.by });

/** Center point of an opening in world coordinates. */
export function openingCenter(wall: Wall, o: Opening): Pt {
  return segPoint(wA(wall), wB(wall), o.t);
}

/** Opening span (start/end t) clamped so the full vano fits inside the wall. */
export function openingSpan(wall: Wall, o: Opening): [number, number] {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const half = o.width / 2 / Math.max(len, 1e-9);
  return [o.t - half, o.t + half];
}

/** Clamp an opening's t so the whole vano stays inside the wall. Returns null if the wall is too short. */
export function clampOpeningT(wall: Wall, width: number, t: number): number | null {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (width > len - 0.02) return null;
  const half = width / 2 / len;
  const lo = half;
  const hi = 1 - half;
  return Math.min(hi, Math.max(lo, t));
}

export function checkModel(model: PlanModel): Issue[] {
  const issues: Issue[] = [];
  const { walls, openings, rooms, items } = model;

  // ---- Walls ---------------------------------------------------------------
  for (const w of walls) {
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    if (len < MIN_WALL_LEN) {
      issues.push({
        severity: "error",
        code: "wall_too_short",
        message: `Wall ${w.id} is only ${(len * 100).toFixed(0)} cm long (min ${MIN_WALL_LEN * 100} cm).`,
        refs: [w.id],
      });
    }
  }

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      // Collinear overlap (total or partial)
      const ov = collinearOverlap(wA(a), wB(a), wA(b), wB(b));
      if (ov > 0.01) {
        issues.push({
          severity: "error",
          code: "walls_overlap_collinear",
          message: `Walls ${a.id} and ${b.id} overlap collinearly for ${(ov * 100).toFixed(0)} cm.`,
          refs: [a.id, b.id],
        });
        continue;
      }
      // Mid-span crossing (T-junctions at endpoints are legal)
      if (!areCollinear(wA(a), wB(a), wA(b), wB(b)) && segmentsCross(wA(a), wB(a), wA(b), wB(b))) {
        issues.push({
          severity: "error",
          code: "walls_cross",
          message: `Walls ${a.id} and ${b.id} cross mid-span.`,
          refs: [a.id, b.id],
        });
      }
    }
  }

  // Loose ends: an endpoint that touches nothing (T-junctions count as connected)
  for (const w of walls) {
    for (const end of [wA(w), wB(w)] as const) {
      let connected = false;
      for (const other of walls) {
        if (other.id === w.id) continue;
        if (
          dist(end, wA(other)) < ENDPOINT_SNAP ||
          dist(end, wB(other)) < ENDPOINT_SNAP ||
          pointOnSeg(end, wA(other), wB(other), ENDPOINT_SNAP)
        ) {
          connected = true;
          break;
        }
      }
      if (!connected && walls.length > 1) {
        issues.push({
          severity: "warning",
          code: "wall_loose_end",
          message: `Wall ${w.id} has a loose end at (${end.x.toFixed(2)}, ${end.y.toFixed(2)}).`,
          refs: [w.id],
        });
      }
    }
  }

  // ---- Openings --------------------------------------------------------------
  const wallById = new Map(walls.map((w) => [w.id, w]));
  for (const o of openings) {
    const wall = wallById.get(o.wallId);
    if (!wall) {
      issues.push({
        severity: "error",
        code: "opening_orphan",
        message: `${o.kind} ${o.id} references missing wall ${o.wallId}.`,
        refs: [o.id],
      });
      continue;
    }
    const [t0, t1] = openingSpan(wall, o);
    if (t0 < -1e-6 || t1 > 1 + 1e-6) {
      issues.push({
        severity: "error",
        code: "opening_overflow",
        message: `${o.kind} ${o.id} extends past the end of wall ${wall.id}.`,
        refs: [o.id, wall.id],
      });
    }
    if (o.sill + o.height > wall.height + 1e-6) {
      issues.push({
        severity: "error",
        code: "opening_too_tall",
        message: `${o.kind} ${o.id} (sill ${o.sill}m + height ${o.height}m) exceeds wall height ${wall.height}m.`,
        refs: [o.id, wall.id],
      });
    }
    // Overlap between openings on the same wall
    for (const other of openings) {
      if (other.id <= o.id || other.wallId !== o.wallId) continue;
      const [s0, s1] = openingSpan(wall, other);
      if (Math.min(t1, s1) - Math.max(t0, s0) > 1e-6) {
        issues.push({
          severity: "error",
          code: "openings_overlap",
          message: `${o.kind} ${o.id} overlaps ${other.kind} ${other.id} on wall ${wall.id}.`,
          refs: [o.id, other.id, wall.id],
        });
      }
    }
    // A different wall ENDING inside this opening's span
    for (const other of walls) {
      if (other.id === wall.id) continue;
      for (const end of [wA(other), wB(other)] as const) {
        if (pointOnSeg(end, wA(wall), wB(wall), 0.02)) {
          // param of the endpoint along the host wall
          const len = segLen(wall.ax, wall.ay, wall.bx, wall.by) || 1;
          const dx = wall.bx - wall.ax;
          const dy = wall.by - wall.ay;
          const t = ((end.x - wall.ax) * dx + (end.y - wall.ay) * dy) / (len * len);
          if (t > t0 + 0.01 && t < t1 - 0.01) {
            issues.push({
              severity: "error",
              code: "wall_ends_in_opening",
              message: `Wall ${other.id} ends inside the ${o.kind} ${o.id} of wall ${wall.id}.`,
              refs: [other.id, o.id, wall.id],
            });
          }
        }
      }
    }
  }

  // ---- Rooms -----------------------------------------------------------------
  for (const r of rooms) {
    if (r.w < 0.5 || r.h < 0.5) {
      issues.push({
        severity: "error",
        code: "room_too_small",
        message: `Room "${r.label}" is smaller than 0.5 × 0.5 m.`,
        refs: [r.id],
      });
    }
    // Floating: no wall edge near any room edge
    const edges: [Pt, Pt][] = [
      [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
      [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
      [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
      [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
    ];
    let touching = false;
    outer: for (const [e0, e1] of edges) {
      for (const w of walls) {
        if (
          pointSegDist(e0, wA(w), wB(w)) < 0.25 ||
          pointSegDist(e1, wA(w), wB(w)) < 0.25
        ) {
          touching = true;
          break outer;
        }
      }
    }
    if (!touching && walls.length > 0) {
      issues.push({
        severity: "warning",
        code: "room_floating",
        message: `Room "${r.label}" is not bounded by any wall.`,
        refs: [r.id],
      });
    }
    // Door check: at least one door opening near the room boundary
    const hasDoor = openings.some((o) => {
      if (o.kind !== "door") return false;
      const wall = wallById.get(o.wallId);
      if (!wall) return false;
      const c = openingCenter(wall, o);
      return edges.some(([e0, e1]) => pointSegDist(c, e0, e1) < 0.3);
    });
    if (!hasDoor && openings.length > 0) {
      issues.push({
        severity: "warning",
        code: "room_no_door",
        message: `Room "${r.label}" has no door on its boundary.`,
        refs: [r.id],
      });
    }
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (aabbOverlap(rooms[i], rooms[j])) {
        issues.push({
          severity: "error",
          code: "rooms_overlap",
          message: `Rooms "${rooms[i].label}" and "${rooms[j].label}" overlap.`,
          refs: [rooms[i].id, rooms[j].id],
        });
      }
    }
  }

  // ---- Furniture ---------------------------------------------------------------
  const itemRect = (it: { kind: string; x: number; y: number; rotation: number }): ORect | null => {
    const c = catalogByKind(it.kind);
    if (!c) return null;
    return { cx: it.x, cy: it.y, hw: c.w / 2, hd: c.d / 2, rot: (-it.rotation * Math.PI) / 180 };
  };

  for (const it of items) {
    const cat = catalogByKind(it.kind);
    if (!cat) {
      issues.push({
        severity: "error",
        code: "item_unknown",
        message: `Item ${it.id} has unknown kind "${it.kind}".`,
        refs: [it.id],
      });
      continue;
    }
    const r = itemRect(it)!;
    // vs walls: touching (leaning) is legal, crossing through is an error
    for (const w of walls) {
      if (satRectWall(r, w, 0.02)) {
        // tolerance 0.02: penetration up to 2 cm still counts as "leaning"
        issues.push({
          severity: "error",
          code: "item_through_wall",
          message: `${cat.label} crosses wall ${w.id}.`,
          refs: [it.id, w.id],
        });
      }
    }
    // blocking openings (doors fully; windows only below sill line matters less — matiz antepecho)
    for (const o of openings) {
      const wall = wallById.get(o.wallId);
      if (!wall) continue;
      const c = openingCenter(wall, o);
      const clearance: ORect = {
        cx: c.x,
        cy: c.y,
        hw: o.width / 2 + DOOR_CLEAR,
        hd: wall.thickness / 2 + (o.kind === "door" ? 0.8 : 0.4),
        rot: Math.atan2(wall.by - wall.ay, wall.bx - wall.ax),
      };
      if (satRectRect(r, clearance)) {
        if (o.kind === "door") {
          issues.push({
            severity: "error",
            code: "item_blocks_door",
            message: `${cat.label} blocks the swing path of door ${o.id}.`,
            refs: [it.id, o.id],
          });
        } else if (cat.h > o.sill) {
          issues.push({
            severity: "warning",
            code: "item_blocks_window",
            message: `${cat.label} (h ${cat.h}m) sits in front of window ${o.id} (sill ${o.sill}m).`,
            refs: [it.id, o.id],
          });
        }
      }
    }
    // vs other furniture (rugs exempt)
    for (const other of items) {
      if (other.id <= it.id) continue;
      const oc = catalogByKind(other.kind);
      if (!oc) continue;
      if (cat.isRug || oc.isRug) continue;
      const or2 = itemRect(other)!;
      if (satRectRect(r, or2, 0.01)) {
        issues.push({
          severity: "error",
          code: "items_overlap",
          message: `${cat.label} overlaps ${oc.label}.`,
          refs: [it.id, other.id],
        });
      }
    }
    // outside every room
    if (rooms.length > 0) {
      const inside = rooms.some(
        (rm) => it.x >= rm.x - 0.05 && it.x <= rm.x + rm.w + 0.05 && it.y >= rm.y - 0.05 && it.y <= rm.y + rm.h + 0.05,
      );
      if (!inside) {
        issues.push({
          severity: "warning",
          code: "item_outside_rooms",
          message: `${cat.label} is outside every room.`,
          refs: [it.id],
        });
      }
    }
  }

  return issues;
}
