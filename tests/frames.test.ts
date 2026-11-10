/**
 * The 3D view renders on demand: a frame is drawn when something asked for one, and the loop
 * keeps going only while a frame says something is still moving. It used to draw — with
 * post-processing — sixty times a second while nothing on screen changed.
 */
import { describe, expect, it } from "vitest";
import { frameLoop, type FrameScheduler } from "../src/three/frames";
import { FRAMES } from "../src/three/config";

/** A scheduler the test steps by hand: tick(ms) runs the pending frame at that timestamp. */
function manualScheduler() {
  let next: ((t: number) => void) | null = null;
  let requests = 0;
  const scheduler: FrameScheduler = {
    request(cb) {
      next = cb;
      requests++;
      return requests;
    },
    cancel() {
      next = null;
    },
  };
  return {
    scheduler,
    get pending() {
      return next !== null;
    },
    get requests() {
      return requests;
    },
    tick(time: number) {
      const cb = next;
      next = null;
      cb?.(time);
    },
  };
}

describe("frameLoop", () => {
  it("draws nothing until asked, and one frame for any number of asks", () => {
    const s = manualScheduler();
    let drawn = 0;
    const loop = frameLoop(() => {
      drawn++;
      return false;
    }, s.scheduler);
    expect(s.pending).toBe(false);
    for (let i = 0; i < 40; i++) loop.invalidate();
    expect(s.requests).toBe(1);
    s.tick(16);
    expect(drawn).toBe(1);
    expect(s.pending).toBe(false); // idle: nothing asked for another
    expect(loop.frames).toBe(1);
  });

  it("keeps drawing while a frame reports motion, then goes idle", () => {
    const s = manualScheduler();
    let motionLeft = 3;
    const loop = frameLoop(() => motionLeft-- > 0, s.scheduler);
    loop.invalidate();
    for (let t = 0; s.pending; t += 16) s.tick(t);
    expect(loop.frames).toBe(4);
    expect(s.pending).toBe(false);
  });

  it("advances the first frame after an idle spell by nothing, and no frame by more than the cap", () => {
    const s = manualScheduler();
    const steps: number[] = [];
    let again = true;
    const loop = frameLoop((dt) => {
      steps.push(dt);
      return again;
    }, s.scheduler);
    loop.invalidate();
    s.tick(1000);
    s.tick(1016);
    s.tick(5000); // a stalled tab
    again = false;
    s.tick(5016);
    loop.invalidate();
    s.tick(60_000); // after a minute idle
    expect(steps[0]).toBe(0);
    expect(steps[1]).toBeCloseTo(0.016);
    expect(steps[2]).toBe(FRAMES.maxStepSeconds);
    expect(steps[4]).toBe(0);
  });

  it("renderNow draws in this task, for a capture", () => {
    const s = manualScheduler();
    let drawn = 0;
    const loop = frameLoop(() => {
      drawn++;
      return false;
    }, s.scheduler);
    loop.invalidate();
    loop.renderNow();
    expect(drawn).toBe(1);
    expect(s.pending).toBe(false); // the pending frame was folded into it
  });

  it("stop cancels a pending frame and ignores later asks", () => {
    const s = manualScheduler();
    let drawn = 0;
    const loop = frameLoop(() => {
      drawn++;
      return true;
    }, s.scheduler);
    loop.invalidate();
    loop.stop();
    s.tick(16);
    loop.invalidate();
    loop.renderNow();
    expect(drawn).toBe(0);
    expect(s.pending).toBe(false);
  });
});
