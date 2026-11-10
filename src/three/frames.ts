/**
 * Render on demand. The 3D view used to draw sixty frames a second, post-processing and all,
 * while nothing on screen moved. Here a frame is drawn only when something asked for one —
 * input, the camera controls, a plan change, a resize — and a frame that is still in motion
 * (a door mid-swing, the walker with a key held, the camera easing to a stop) asks for the
 * next one by returning true. When nothing is in motion the loop is idle and costs nothing.
 *
 * The clock is the frame callback's own timestamp. The first frame after an idle spell
 * advances by zero, so a door does not leap by the length of the pause, and no step is longer
 * than FRAMES.maxStepSeconds.
 */

import { FRAMES } from "./config";

/** Draw one frame, advancing animations by `dt` seconds. Return true if another frame is needed. */
export type FrameFn = (dt: number) => boolean;

export interface FrameLoop {
  /** Ask for a frame. Any number of asks before it is drawn are one frame. */
  invalidate(): void;
  /** Draw a frame now, in this task — what a capture of the canvas needs. */
  renderNow(): void;
  /** Stop for good: a pending frame is cancelled and later asks are ignored. */
  stop(): void;
  /** How many frames have been drawn. */
  readonly frames: number;
}

export interface FrameScheduler {
  request(cb: (time: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export function frameLoop(draw: FrameFn, scheduler: FrameScheduler = browserScheduler): FrameLoop {
  let handle: number | null = null;
  /** timestamp of the last frame of the current run of frames; null while idle */
  let last: number | null = null;
  let frames = 0;
  let stopped = false;

  const run = (dt: number): void => {
    frames++;
    const again = draw(dt);
    if (again) schedule();
    else last = null;
  };

  const onFrame = (time: number): void => {
    handle = null;
    if (stopped) return;
    const dt = last === null ? 0 : Math.min(FRAMES.maxStepSeconds, Math.max(0, (time - last) / 1000));
    last = time;
    run(dt);
  };

  function schedule(): void {
    if (stopped || handle !== null) return;
    handle = scheduler.request(onFrame);
  }

  return {
    invalidate: schedule,
    renderNow() {
      if (stopped) return;
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      // drawn out of band: it does not advance anything, and the run of frames carries on after it
      run(0);
    },
    stop() {
      stopped = true;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    },
    get frames() {
      return frames;
    },
  };
}
