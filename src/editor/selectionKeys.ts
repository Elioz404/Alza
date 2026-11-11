/**
 * The keys that act on the selection, the same whichever view shows it: Delete or Backspace
 * removes the selected wall, piece, room, stair or column, Ctrl/Cmd+Z undoes the last change, and Escape lets
 * go of the selection. The plan (src/editor/Editor.tsx) and the 3D view (src/three/Scene3D.tsx)
 * both answer them through here, so a piece selected by a click on the model is removed, and
 * the removal undone, exactly as on the plan.
 *
 * Each view keeps its own guards before it asks: a key typed into a field, pressed inside a
 * dialog, a menu or a popover, or already answered by something else (defaultPrevented) is not
 * the selection's.
 */

import { pageActions, store } from "../model/store";
import { dispatch } from "../model/commands";

const human = { actor: "human" } as const;

/** Let go of whatever is selected. */
export function deselectAll(): void {
  pageActions.selectWall(null);
  pageActions.selectItem(null);
  pageActions.selectRoom(null);
  pageActions.selectStair(null);
  pageActions.selectColumn(null);
}

/** Remove what is selected (a wall, then a piece, a room, a stair, a column), as the human. Returns whether anything was. */
export function removeSelected(): boolean {
  const { selectedWallId, selectedItemId, selectedRoomId, selectedStairId, selectedColumnId } = store.getState().editor;
  if (selectedWallId) {
    dispatch({ type: "remove_wall", id: selectedWallId }, human);
    pageActions.selectWall(null);
  } else if (selectedItemId) {
    dispatch({ type: "remove_item", id: selectedItemId }, human);
    pageActions.selectItem(null);
  } else if (selectedRoomId) {
    dispatch({ type: "remove_room", id: selectedRoomId }, human);
    pageActions.selectRoom(null);
  } else if (selectedStairId) {
    dispatch({ type: "remove_stair", id: selectedStairId }, human);
    pageActions.selectStair(null);
  } else if (selectedColumnId) {
    dispatch({ type: "remove_column", id: selectedColumnId }, human);
    pageActions.selectColumn(null);
  } else return false;
  return true;
}

/**
 * Answer Delete / Backspace (remove the selection) and Ctrl/Cmd+Z (undo). Returns whether the
 * key was one of them. (Escape is each view's own: it first ends what the view is in the middle
 * of — a wall run, a placement — and deselects only when there is nothing else to end.)
 */
export function handleSelectionKey(e: KeyboardEvent): boolean {
  if (e.key === "Delete" || e.key === "Backspace") {
    removeSelected();
    return true;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    dispatch({ type: "undo" }, human);
    return true;
  }
  return false;
}
