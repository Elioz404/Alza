/**
 * The app has one module-level store. Vitest loads each test file in its own module graph,
 * so every file starts from a fresh store; within a file, tests put back the state the store
 * was created with. Updates are immutable, so the object captured here is never mutated.
 */
import { store, type AppState } from "../../src/model/store";

const pristine: AppState = store.getState();

export function resetStore(): void {
  store.setState(pristine, true);
}

/** Let pending promise callbacks and zero-delay timers run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
