/** The Notes tab's count, for its badge: in the first chunk, unlike the tab's body. */
import { useAppStore } from "../useAppStore";

export const useNoteCount = (): number => useAppStore((s) => s.notes.length);
