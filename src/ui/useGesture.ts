/**
 * A continuous edit from the UI — a drag, typing in a field, a slider — as one Gesture
 * (model/commands.ts): every frame applies at once, the whole gesture is one undo step and one
 * line in the activity feed. The gesture starts with its first update and is closed by end(),
 * which the component calls when the hand lets go (pointer up, blur, key up) — or by the hook
 * itself when the component goes away mid-gesture (an agent's build_3d swaps the 2D editor
 * out under a drag), so a change that was made is never left without its feed line.
 */

import { useEffect, useMemo, useRef } from "react";
import { beginGesture, type Command, type Gesture } from "../model/commands";
import type { ActionResult } from "../model/store";

export interface GestureHandle {
  update(command: Command): ActionResult;
  end(): void;
}

export function useGesture(): GestureHandle {
  const current = useRef<Gesture | null>(null);
  const handle = useMemo<GestureHandle>(
    () => ({
      update: (command) => (current.current ??= beginGesture({ actor: "human" })).update(command),
      end: () => {
        current.current?.end();
        current.current = null;
      },
    }),
    [],
  );
  // an unmount mid-gesture closes it like letting go does
  useEffect(() => handle.end, [handle]);
  return handle;
}
