/**
 * Code the first paint does not need, fetched apart from the entry chunk: the side panel's other
 * tabs, the inspectors for a selection, Activity's details, the plan and export menus, the notice
 * host, the first-run state, the approval card, the shortcut sheet and the Clear-plan dialog.
 *
 * One mechanism for all of them:
 *
 * - `loadable(name, load)` is a piece of code that is fetched once and then kept. Every one is
 *   registered, so `prefetchWhenIdle()` (called by src/main.tsx after the first paint) fetches
 *   them all while the browser is idle, and the first click on a tab, a menu or a wall finds its
 *   code already here. Nothing is fetched twice; a failed fetch is forgotten, so the next request
 *   asks for it afresh (a stale chunk after a redeploy, a dropped connection).
 * - `deferred(name, load, placeholder)` is a component over a loadable. Until its code arrives it
 *   renders the placeholder (a box the region already sizes, so nothing moves when the content
 *   lands) and asks for the code; once the code is here it renders the real component at once,
 *   with no Suspense fallback in between. If the code could not arrive, the placeholder is told:
 *   `RegionPlaceholder` then offers to try again, and `overlayPlaceholder` asks again whenever
 *   its overlay has something new to show, and offers to try again too.
 * - LazyLayer.tsx builds the rarely opened layers on the same loadables.
 *
 * The 3D view is not one of them: three.js is far larger than everything here together and
 * only the 3D view needs it, so it is still fetched when the view first opens (LazyView.tsx).
 */

import { useEffect, useRef, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { Button } from "./primitives";

/** What has arrived of a loadable: its value once loaded, and whether the last fetch failed. */
export interface LoadState<T> {
  readonly value: T | null;
  readonly failed: boolean;
}

export interface Loadable<T> {
  /** names it in warnings and in tests */
  readonly name: string;
  /** what has arrived; the same object until something changes, as useSyncExternalStore needs */
  state(): LoadState<T>;
  /** fetch it, or join the fetch under way; resolves with the value once it is here */
  load(): Promise<T>;
  subscribe(listener: () => void): () => void;
}

const registry = new Set<Loadable<unknown>>();

/** A piece of code fetched once, kept once it arrives, and registered for the idle prefetch. */
export function loadable<T>(name: string, load: () => Promise<T>): Loadable<T> {
  let state: LoadState<T> = { value: null, failed: false };
  let pending: Promise<T> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: LoadState<T>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const code: Loadable<T> = {
    name,
    state: () => state,
    load() {
      if (state.value !== null) return Promise.resolve(state.value);
      if (pending) return pending;
      // asking again after a failure: it is no longer failed, only on its way
      if (state.failed) set({ value: null, failed: false });
      pending = load().then(
        (value) => {
          pending = null;
          set({ value, failed: false });
          return value;
        },
        (error: unknown) => {
          pending = null;
          console.warn(`[alza] ${name} could not be loaded`, error);
          set({ value: null, failed: true });
          throw error;
        },
      );
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  registry.add(code as Loadable<unknown>);
  return code;
}

/** Every registered loadable, by name (for tests and the size report). */
export const registeredLoadables = (): readonly string[] => [...registry].map((code) => code.name);

/**
 * Fetch every registered piece of code not yet here. Never rejects: a piece that fails stays
 * failed until something asks for it again.
 */
export async function preloadDeferred(): Promise<void> {
  await Promise.all([...registry].map((code) => code.load().catch(() => undefined)));
}

/** The browser's idle callback where there is one, a short timeout where there is not. */
interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  setTimeout: (callback: () => void, ms: number) => number;
}

/**
 * Once the first paint is done and the browser is idle, fetch the rest. `timeoutMs` bounds how
 * long an always-busy page waits before fetching anyway.
 */
export function prefetchWhenIdle(win: IdleWindow, timeoutMs: number): void {
  whenIdle(win, timeoutMs, () => void preloadDeferred());
}

/** Run `task` once the browser is idle, or `timeoutMs` from now at the latest. */
export function whenIdle(win: IdleWindow, timeoutMs: number, task: () => void): void {
  if (win.requestIdleCallback) win.requestIdleCallback(task, { timeout: timeoutMs });
  else win.setTimeout(task, 0);
}

/** What a deferred component's placeholder is told about its code. */
export interface PlaceholderState {
  /** the last fetch failed */
  failed: boolean;
  /** ask for the code again */
  retry(): void;
}

export type DeferredComponent<P> = ComponentType<P> & {
  /** fetch the code ahead of the first render */
  preload(): Promise<void>;
};

/**
 * React to a loadable: what has arrived, and a request for it whenever `wanted` turns true (on
 * mount, for a component that is always wanted) while it is not here. A failed fetch is not
 * retried by itself: the next mount, the next opening or the placeholder's Try again asks again.
 */
export function useLoadable<T>(code: Loadable<T>, wanted = true): LoadState<T> {
  const state = useSyncExternalStore(code.subscribe, code.state, code.state);
  useEffect(() => {
    if (wanted && code.state().value === null) code.load().catch(() => undefined);
  }, [code, wanted]);
  return state;
}

/**
 * A component fetched apart from the first chunk. `placeholder` stands in for it until its code
 * arrives and gets the same props, so it can match the real thing's box (or its trigger).
 */
export function deferred<P extends object>(
  name: string,
  load: () => Promise<ComponentType<P>>,
  placeholder: (props: P, state: PlaceholderState) => ReactNode,
): DeferredComponent<P> {
  const code = loadable(name, load);
  const retry = () => void code.load().catch(() => undefined);
  function Deferred(props: P) {
    const { value: Real, failed } = useLoadable(code);
    return Real ? <Real {...props} /> : placeholder(props, { failed, retry });
  }
  Deferred.displayName = `Deferred(${name})`;
  return Object.assign(Deferred, { preload: () => code.load().then(() => undefined) });
}

/**
 * The placeholder for a region of the page (a tab's body, an inspector, Activity's details): an
 * empty box that fills the room the region already has, so nothing moves when the content lands.
 * If the code could not be fetched, it says so and offers to try again.
 */
export function RegionPlaceholder({ failed, retry }: PlaceholderState) {
  return (
    <div className="deferred" aria-busy={!failed}>
      {failed ? (
        <div className="deferred__failed" role="alert">
          <p>This part of the page could not be loaded.</p>
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A region placeholder, in the shape `deferred` takes. */
export const regionPlaceholder = (_props: object, state: PlaceholderState) => <RegionPlaceholder {...state} />;

/** Where an overlay's failure notice sits: over the canvas, or at the edge of the page. */
export type OverlayPlacement = "canvas" | "page";

/**
 * The placeholder for an overlay: something absent until it has something to show (the
 * approval card, the first-run state, the notices), so there is no box to hold. It renders
 * nothing while its code is on its way, or while there is nothing to show.
 *
 * `useNeeded` says whether there is: falsy when there is nothing, and a value that changes with
 * each new reason to show it (a request arriving, a Review pressed, a notice asked for). While
 * the code is missing because its last fetch failed, every new reason asks for it again, and
 * the overlay says it could not be loaded and offers to try again, so what it would show is
 * never silently missing. A fetch that fails again is not retried until the next reason.
 */
export function overlayPlaceholder(what: string, useNeeded: () => unknown, placement: OverlayPlacement = "canvas") {
  function OverlayPlaceholder({ failed, retry }: PlaceholderState) {
    const need = useNeeded();
    const askedFor = useRef<unknown>(null);
    useEffect(() => {
      if (!need || !failed || askedFor.current === need) return;
      askedFor.current = need;
      retry();
    }, [need, failed, retry]);
    if (!need || !failed) return null;
    return (
      <div className={`deferred__failed deferred-overlay deferred-overlay--${placement}`} role="alert">
        <p>{what} could not be loaded.</p>
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  OverlayPlaceholder.displayName = `OverlayPlaceholder(${what})`;
  return (_props: object, state: PlaceholderState) => <OverlayPlaceholder {...state} />;
}
