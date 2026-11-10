/**
 * The store, read from React. Kept out of src/model, which has no React in it: the domain and
 * its store run the same in a component, a tool call and a Node test.
 */

import { useStore } from "zustand";
import { store, type AppState } from "../model/store";

export const useAppStore = <T>(selector: (s: AppState) => T): T => useStore(store, selector);
