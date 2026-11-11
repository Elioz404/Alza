/**
 * The one-line hint at the bottom of the canvas: the tool in use or what is selected, then what
 * the hand can do next, each with its key ("Wall selected | Drag an end to move it | Del remove
 * | Esc deselect"). Segments are kept apart by dividers, never dot-joined. On a phone only the
 * first action shows.
 *
 * Plan view only: the 3D view carries its own hint bar (src/three/overlays/SceneOverlays.tsx),
 * which also says how to finish placing a piece and offers to swing the doors, so the two
 * never sit on top of each other.
 */
import "./canvas.css";
import { Kbd } from "../primitives";
import { useAppStore } from "../useAppStore";
import { activeLevelId } from "../../model/store";
import { useCanvas } from "../../editor/canvasState";
import { hintFor, type HintPart } from "./hints";

const part = (p: HintPart, i: number) => (typeof p === "string" ? <span key={i}>{p}</span> : <Kbd key={i} keys={p.kbd} />);

export function HintBar() {
  const editor = useAppStore((s) => s.editor);
  const model = useAppStore((s) => s.model);
  const levelId = useAppStore(activeLevelId);
  const tool = useCanvas((s) => s.tool);
  const spacePan = useCanvas((s) => s.spacePan);
  const openingFits = useCanvas((s) => s.openingFits);
  const stairRotation = useCanvas((s) => s.stairRotation);
  if (editor.view !== "2d") return null;
  const hint = hintFor({ editor, model, levelId, tool, spacePan, openingFits, stairRotation });

  return (
    <div className="hint" role="status" aria-live="polite">
      <span className="hint__tool">{hint.title}</span>
      {hint.segments.map((segment, i) => (
        <span key={i} className="hint__item">
          <span className="hint__sep" aria-hidden="true" />
          {segment.map(part)}
        </span>
      ))}
    </div>
  );
}
