/**
 * The studio fetches what the first paint does not need after it (src/ui/deferred.tsx): the
 * other tabs, the selection inspectors, Activity's details, the menus, the first-run state.
 * A test that renders one of those regions waits for its code here, as the page's idle
 * prefetch would, and then for React to render what arrived.
 */
import { act } from "react";
import { preloadDeferred } from "../../src/ui/deferred";

export const loadDeferred = (): Promise<void> => act(() => preloadDeferred());
