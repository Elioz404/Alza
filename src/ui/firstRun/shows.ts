/**
 * Whether the first-run state shows: in the first chunk, unlike the state itself, so the canvas
 * knows when it is missing (src/ui/shell/CanvasRegion.tsx).
 */
import { useAppStore } from "../useAppStore";

/** Is the sheet empty enough for the first-run state? */
export const useShowsFirstRun = (): boolean =>
  useAppStore(
    (s) =>
      s.editor.view === "2d" &&
      s.editor.drawMode === "select" &&
      s.model.walls.length + s.model.rooms.length + s.model.openings.length + s.model.items.length === 0 &&
      !s.model.underlay,
  );
