/**
 * Camera moves. Switching between Orbit, Top view and Walk used to jump: the camera was in one
 * place on one frame and somewhere else on the next. Here a switch, and the framing of a plan
 * that replaced the one on screen, eases from where the camera is to where the mode puts it,
 * over TRANSITIONS.seconds, driven by the render-on-demand loop (frames.ts): each step asks for
 * the next frame until the move is done, then the loop goes idle again.
 *
 * A move is a pose (position, look target, up) at each end. The camera travels on an arc, not a
 * straight line: when either end is below the walls' tops (Walk's eye is), the path rises over
 * them first — a cubic curve whose two inner points stand over its ends, at least
 * TRANSITIONS.clearance above the walls — so it climbs out of a room and drops into one from
 * above, and does not pass through a wall on the way. Where it looks turns as one rotation from the start's view to the
 * end's (a quaternion slerp), and the distance to what it looks at eases between the two, so the
 * view never swings while the path bends. Under prefers-reduced-motion a move takes no time at
 * all, and any input — a drag, a scroll, a walk key — finishes it at once, so the person is
 * never waiting on the camera.
 *
 * Plain three.js maths, no renderer: the tests drive it under Node.
 */

import * as THREE from "three";
import { CAMERA_FRAMING, TRANSITIONS, type EasingName } from "./config";

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}

export const EASINGS: Readonly<Record<EasingName, (t: number) => number>> = Object.freeze({
  linear: (t: number) => t,
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
});

/** Does the person ask for less motion? Read when a move starts, so a change applies to the next. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How long a move takes: TRANSITIONS.seconds, or nothing under reduced motion. */
export const moveSeconds = (reducedMotion: boolean): number => (reducedMotion ? 0 : TRANSITIONS.seconds);

/**
 * The radius a mode frames the plan by, in a view `aspect` wide (width / height). The Orbit and Top
 * framings fit the plan in a view at least CAMERA_FRAMING.fitAspect wide; a narrower one, a phone
 * held upright, frames a radius larger in proportion, so the camera stands back and the plan's
 * width still fits instead of being cut at both sides. A view with no size yet keeps the radius.
 */
export const framedRadius = (radius: number, aspect: number): number =>
  aspect > 0 && aspect < CAMERA_FRAMING.fitAspect ? (radius * CAMERA_FRAMING.fitAspect) / aspect : radius;

export const copyPose = (from: CameraPose, to: CameraPose): CameraPose => {
  to.position.copy(from.position);
  to.target.copy(from.target);
  to.up.copy(from.up);
  return to;
};

export const newPose = (): CameraPose => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) });

/** Which way a pose looks, as a rotation (a camera's: it looks down its -z, its up is its +y). */
function orientationOf(pose: CameraPose, out: THREE.Quaternion, scratch: THREE.Matrix4): THREE.Quaternion {
  return out.setFromRotationMatrix(scratch.lookAt(pose.position, pose.target, pose.up));
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/** One eased move from a pose to another. step() writes where the camera is now. */
export class CameraMove {
  private readonly from = newPose();
  private readonly to = newPose();
  /** the curve's inner points, over its two ends and clear of the walls, when the move arcs */
  private readonly over = [new THREE.Vector3(), new THREE.Vector3()] as const;
  private arc = false;
  private readonly turnFrom = new THREE.Quaternion();
  private readonly turnTo = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private reachFrom = 0;
  private reachTo = 0;
  private elapsed = 0;
  private seconds = 0;
  private running = false;
  private readonly ease: (t: number) => number;
  private readonly matrix = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  constructor(easing: EasingName = TRANSITIONS.easing) {
    this.ease = EASINGS[easing];
  }

  /**
   * Start a move from `from` to `to`, over walls whose tops stand at `walls` metres (the path
   * keeps TRANSITIONS.clearance over them wherever an end is lower). Returns false when it takes
   * no time (reduced motion, or the camera is already there): the caller puts the camera at `to`
   * itself.
   */
  start(from: CameraPose, to: CameraPose, seconds: number, walls = 0): boolean {
    copyPose(from, this.from);
    copyPose(to, this.to);
    this.elapsed = 0;
    this.seconds = seconds;
    const still = from.position.distanceToSquared(to.position) < 1e-8 && from.target.distanceToSquared(to.target) < 1e-8 && from.up.distanceToSquared(to.up) < 1e-8;
    this.running = seconds > 0 && !still;
    if (!this.running) return false;
    // over the walls when an end is among them: up from the start, across, and down to the end
    const clear = walls + TRANSITIONS.clearance;
    this.arc = walls > 0 && Math.min(from.position.y, to.position.y) < clear;
    const top = Math.max(from.position.y, to.position.y, clear);
    this.over[0].set(from.position.x, top, from.position.z);
    this.over[1].set(to.position.x, top, to.position.z);
    orientationOf(from, this.turnFrom, this.matrix);
    orientationOf(to, this.turnTo, this.matrix);
    this.reachFrom = from.position.distanceTo(from.target);
    this.reachTo = to.position.distanceTo(to.target);
    return true;
  }

  get active(): boolean {
    return this.running;
  }

  /** Where the move is going: the pose a finished (or interrupted) move leaves the camera in. */
  get destination(): CameraPose {
    return this.to;
  }

  /** Advance by `dt` seconds and write the pose into `out`. Returns true while the move goes on. */
  step(dt: number, out: CameraPose): boolean {
    if (!this.running) {
      copyPose(this.to, out);
      return false;
    }
    this.elapsed = Math.min(this.seconds, this.elapsed + dt);
    if (this.elapsed >= this.seconds) {
      // arrived: exactly where the mode puts the camera
      this.running = false;
      copyPose(this.to, out);
      return false;
    }
    const t = this.ease(this.elapsed / this.seconds);
    if (this.arc) {
      // a cubic Bézier from the start, by the points over each end, to the end
      const u = 1 - t;
      out.position
        .copy(this.from.position)
        .multiplyScalar(u * u * u)
        .addScaledVector(this.over[0], 3 * t * u * u)
        .addScaledVector(this.over[1], 3 * t * t * u)
        .addScaledVector(this.to.position, t * t * t);
    } else out.position.lerpVectors(this.from.position, this.to.position, t);
    // one turn from the start's view to the end's; the look target hangs ahead along it
    this.turn.slerpQuaternions(this.turnFrom, this.turnTo, t);
    const reach = this.reachFrom + (this.reachTo - this.reachFrom) * t;
    out.target.copy(this.scratch.copy(FORWARD).applyQuaternion(this.turn)).multiplyScalar(reach).add(out.position);
    out.up.copy(UP).applyQuaternion(this.turn).normalize();
    return true;
  }

  /** End the move now, at its destination (written into `out`). */
  finish(out: CameraPose): void {
    this.running = false;
    copyPose(this.to, out);
  }
}
