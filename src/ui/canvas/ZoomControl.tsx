/**
 * The zoom group at the bottom left of the plan (zoom out, the zoom as a percentage, zoom in,
 * Fit), with the scale bar above it. The view is the editor's (src/editor/canvasState.ts):
 * 15 to 600 pixels per metre, x1.12 a step; 100% draws a metre as 100 pixels.
 */
import "./canvas.css";
import { Button, IconButton, IconFit, IconMinus, IconPlus, Tip } from "../primitives";
import { useAppStore } from "../useAppStore";
import { fitPlan, useCanvas, zoomIn, zoomOut, zoomTo, ZOOM } from "../../editor/canvasState";
import { scaleBarMetres } from "../../editor/drawing";

/** Trim a scale figure: 2, 0.5, 0.25. */
const figure = (m: number): string => String(Number(m.toFixed(2)));

function ScaleBar({ scale }: { scale: number }) {
  const total = scaleBarMetres(scale);
  const unit = (total * scale) / 4;
  return (
    <figure className="scalebar" aria-label={`Scale bar, ${figure(total)} m`}>
      <svg className="scalebar__bar" width={unit * 4} height="6" viewBox={`0 0 ${unit * 4} 6`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} className={i % 2 === 0 ? "scalebar__dark" : "scalebar__light"} x={i * unit + 0.5} y="0.5" width={unit - 1} height="5" />
        ))}
      </svg>
      <figcaption className="scalebar__figures num" aria-hidden="true">
        <span>0</span>
        <span>{figure(total / 2)}</span>
        <span>{figure(total)} m</span>
      </figcaption>
    </figure>
  );
}

export function ZoomControl() {
  const is2d = useAppStore((s) => s.editor.view === "2d");
  const scale = useCanvas((s) => s.view.scale);
  if (!is2d) return null;
  const pct = Math.round((scale / ZOOM.unit) * 100);
  return (
    <div className="zoom-dock">
      <ScaleBar scale={scale} />
      <div className="zoom" role="group" aria-label="Zoom">
        <IconButton
          icon={IconMinus}
          iconSize="sm"
          label="Zoom out"
          shortcut="-"
          tooltipPlacement="above"
          disabledReason={scale <= ZOOM.min ? "The plan is already as far out as it goes" : null}
          onClick={zoomOut}
        />
        <Tip content="Back to 100%" placement="above">
          <button type="button" className="zoom__value num" aria-label={`Zoom ${pct}%. Back to 100%`} onClick={() => zoomTo(ZOOM.unit)}>
            {pct}%
          </button>
        </Tip>
        <IconButton
          icon={IconPlus}
          iconSize="sm"
          label="Zoom in"
          shortcut="plus"
          tooltipPlacement="above"
          disabledReason={scale >= ZOOM.max ? "The plan is already as close as it goes" : null}
          onClick={zoomIn}
        />
        <span className="zoom__sep" aria-hidden="true" />
        <Tip content="Fit the plan to the view" shortcut="shift+1" placement="above">
          <Button variant="ghost" size="sm" icon={IconFit} onClick={() => fitPlan()}>
            Fit
          </Button>
        </Tip>
      </div>
    </div>
  );
}
