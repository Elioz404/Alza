/**
 * The app has one module-level store. Vitest loads each test file in its own module graph,
 * so every file starts from a fresh store; within a file, tests put back the state the store
 * was created with. Updates are immutable, so the object captured here is never mutated.
 */
import { store, type AppState } from "../../src/model/store";
import { catalogOf, type KindDef } from "../../src/model/catalog";
import { putAsset, type AssetId } from "../../src/model/assets";

const pristine: AppState = store.getState();

export function resetStore(): void {
  store.setState(pristine, true);
}

/** Let pending promise callbacks and zero-delay timers run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A kind as the current plan's catalogue holds it (built-ins and the plan's own kinds). */
export const kindOf = (kind: string): KindDef | undefined => catalogOf(store.getState().model).get(kind);

/**
 * Hold an image of `bytes` bytes in the asset store and return its id, for an underlay to name.
 * Nothing refers to it yet, so put it in the same test step that sets the underlay.
 */
export const heldImage = (bytes = 4, type = "image/jpeg"): AssetId => putAsset(new Blob([new Uint8Array(bytes)], { type }));
