/**
 * The 3D view's own chrome, floating over the scene: the camera switch (Orbit, Top view, Walk)
 * at the top left, and one hint bar at the bottom centre that says what the pointer and the
 * keys do in the current camera, or how to finish placing a piece of furniture.
 *
 * The camera switch and the rail's 3D tools are the same three tools (RAIL_TOOLS in
 * src/ui/shell/tools.ts): one label, hint and shortcut each, read from there. Export stays in
 * the top bar's Export menu; nothing here duplicates it.
 *
 * Each component reads the narrowest slice of the store it shows (a camera name, a label, a
 * boolean), so an agent's run of edits does not re-render the scene's chrome.
 */

import { Fragment, type ReactNode } from "react";
import { pageActions } from "../../model/store";
import { CAMERA_MODES, type CameraMode } from "../../model/limits";
import { catalogOf } from "../../model/catalog";
import { runToolManually } from "../../mcp/tools";
import { useAppStore } from "../../ui/useAppStore";
import { Button, Kbd, SegmentedControl, SegmentedControlItem, Tip } from "../../ui/primitives";
import { toolsFor, type RailTool } from "../../ui/shell/tools";
import { useBreakpoint } from "../../ui/theme/media";
import "./overlays.css";

/** The rail's camera tools, in rail order: Orbit 1, Top view 2, Walk 3. */
const CAMERA_TOOLS: readonly RailTool[] = toolsFor("3d").filter((t) => (CAMERA_MODES as readonly string[]).includes(t.id));

const isCameraMode = (v: string): v is CameraMode => (CAMERA_MODES as readonly string[]).includes(v);

/** The camera switch: a radio group, arrow keys move between the three. */
export function CameraToolbar() {
  const camera = useAppStore((s) => s.editor.camera);
  const phone = useBreakpoint("phone");
  return (
    <div className="scene-float scene-toolbar">
      <SegmentedControl
        label="Camera"
        value={camera}
        size="sm"
        onChange={(next) => {
          if (isCameraMode(next)) pageActions.setCamera(next);
        }}
      >
        {CAMERA_TOOLS.map((t) => (
          <Tip key={t.id} content={t.hint} shortcut={t.shortcut} alignment="start">
            <SegmentedControlItem value={t.id} label={t.label} isLabelHidden={phone} icon={<t.icon size="sm" />} aria-keyshortcuts={t.shortcut} />
          </Tip>
        ))}
      </SegmentedControl>
    </div>
  );
}

/** One segment of the hint bar: Kbd chips and the words that go with them. */
function Item({ keys, children }: { keys?: readonly string[]; children: ReactNode }) {
  return (
    <span className="scene-hint__item">
      {keys?.map((k) => <Kbd key={k} keys={k} />)}
      <span>{children}</span>
    </span>
  );
}

/** The hint bar's segments for a camera, in reading order. */
function cameraItems(camera: CameraMode, hasDoors: boolean): ReactNode[] {
  const items: ReactNode[] = [];
  if (camera === "walk") {
    items.push(
      <Item key="keys" keys={["w", "a", "s", "d"]}>
        or the arrow keys to walk
      </Item>,
      <Item key="look">Drag to look around</Item>,
    );
  } else if (camera === "top") {
    items.push(<Item key="pan">Drag to pan</Item>, <Item key="zoom">Scroll to zoom</Item>);
  } else {
    items.push(<Item key="orbit">Drag to orbit</Item>, <Item key="zoom">Scroll to zoom</Item>);
  }
  if (hasDoors) items.push(<Item key="door">Click a door to open or close it</Item>);
  return items;
}

/** Segments with a hairline between each, never a dot-joined string. */
function Segments({ items }: { items: ReactNode[] }) {
  return items.map((item, i) => (
    <Fragment key={i}>
      {i > 0 ? <span className="scene-hint__sep" aria-hidden="true" /> : null}
      {item}
    </Fragment>
  ));
}

/**
 * The hint at the bottom of the scene. While a piece is being placed it says how to put it
 * down (a click, or Enter for the middle of the view) and how to stop (Esc, or Cancel);
 * otherwise it teaches the camera, and with doors in the plan offers to swing them all.
 */
export function SceneHint() {
  const camera = useAppStore((s) => s.editor.camera);
  const hasDoors = useAppStore((s) => s.model.openings.some((o) => o.kind === "door"));
  // a string, so a plan change that leaves it alone does not re-render the hint
  const placing = useAppStore((s) => {
    const kind = s.editor.drawMode === "place" ? s.editor.placingKind : null;
    return kind ? (catalogOf(s.model).get(kind)?.label ?? kind) : null;
  });
  const tool = CAMERA_TOOLS.find((t) => t.id === camera);

  if (placing) {
    return (
      <div className="scene-float scene-hint scene-hint--placing" role="status">
        <span className="scene-hint__tool">Placing {placing}</span>
        <Segments
          items={[
            <Item key="click">Click the floor to put it down</Item>,
            <Item key="enter" keys={["enter"]}>
              puts it in the middle
            </Item>,
            <Item key="esc" keys={["esc"]}>
              stops placing
            </Item>,
          ]}
        />
        <Button size="sm" variant="ghost" className="scene-hint__cancel" onClick={() => pageActions.setDrawMode("select")}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="scene-float scene-hint" role="status">
      <span className="scene-hint__tool">{tool?.label ?? camera}</span>
      <span className="scene-hint__sep" aria-hidden="true" />
      <Segments items={cameraItems(camera, hasDoors)} />
      {hasDoors ? (
        // the same set_doors call a click on a leaf makes, for every door, from the keyboard too
        <Button size="sm" variant="ghost" className="scene-hint__action" onClick={() => void runToolManually("set_doors", { state: "toggle" })}>
          Swing the doors
        </Button>
      ) : null}
    </div>
  );
}

/** The chrome, in its own layer over the scene: pointer events only on the floating pieces. */
export function SceneOverlays() {
  return (
    <div className="scene-overlays">
      <div className="scene-overlays__toolbar">
        <CameraToolbar />
      </div>
      <div className="scene-overlays__hint">
        <SceneHint />
      </div>
    </div>
  );
}
