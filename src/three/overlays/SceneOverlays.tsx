/**
 * The 3D view's own chrome, floating over the scene: the camera switch (Orbit, Top view, Walk)
 * at the top left with the View settings beside it (ink edges, the cutaway and its height), and
 * one hint bar at the bottom centre that says what the pointer and the keys do in the current
 * camera, or how to finish placing a piece of furniture.
 *
 * The camera switch and the rail's 3D tools are the same three tools (RAIL_TOOLS in
 * src/ui/shell/tools.ts): one label, hint and shortcut each, read from there. Export stays in
 * the top bar's Export menu; nothing here duplicates it.
 *
 * Each component reads the narrowest slice of the store it shows (a camera name, a label, a
 * boolean), so an agent's run of edits does not re-render the scene's chrome.
 */

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { pageActions } from "../../model/store";
import { CAMERA_MODES, CUT_HEIGHT, CUT_HEIGHT_STEP, type CameraMode } from "../../model/limits";
import { catalogOf } from "../../model/catalog";
import { runToolManually } from "../../mcp/tools";
import { useAppStore } from "../../ui/useAppStore";
import { Button, IconButton, IconEye, Kbd, SegmentedControl, SegmentedControlItem, Switch, Tip } from "../../ui/primitives";
import { toolsFor, type RailTool } from "../../ui/shell/tools";
import { DESELECT, REMOVE, selectionTitle, type HintPart } from "../../ui/canvas/hints";
import { useBreakpoint } from "../../ui/theme/media";
import "./overlays.css";
import "./view.css";

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

/** Metres as the plan writes a height. */
const metres = (m: number) => `${m.toFixed(2)} m`;

/**
 * The View settings: a button that shows and hides a small panel of the 3D view's drawing style
 * (the store's editor.scene, the same settings set_3d_style changes). A disclosure, not a menu:
 * its controls are a switch, a switch and a slider, each with its own keys, and Escape or a
 * press outside closes it, focus back on the button.
 */
export function ViewSettings() {
  const scene = useAppStore((s) => s.editor.scene);
  const walking = useAppStore((s) => s.editor.camera === "walk");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sliderId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    // the panel's Escape: nothing else on the page answers it (a request card's Keep included)
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="scene-view" onKeyDown={onKeyDown}>
      <IconButton
        ref={buttonRef}
        icon={IconEye}
        label="View"
        hint="Ink edges and a cutaway"
        variant="ghost"
        className="scene-view__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div id={panelId} role="group" aria-label="View" className="scene-float scene-view__panel">
          <Switch
            label="Ink edges"
            description="Line every edge, as the plan does"
            labelPosition="start"
            labelSpacing="spread"
            value={scene.edges}
            onChange={(on) => pageActions.setSceneStyle({ edges: on })}
          />
          <Switch
            label="Cutaway"
            description={walking ? "Lifted while you walk" : "Slice the walls to look in"}
            labelPosition="start"
            labelSpacing="spread"
            value={scene.cutaway}
            onChange={(on) => pageActions.setSceneStyle({ cutaway: on })}
          />
          <div className="scene-view__cut">
            <label htmlFor={sliderId} className="scene-view__label">
              Cut height
            </label>
            {/* the slider says its value itself (aria-valuetext): this is its readout for the eye */}
            <span className="scene-view__value" aria-hidden="true">
              {metres(scene.cutHeight)}
            </span>
            <input
              id={sliderId}
              type="range"
              className="scene-view__slider"
              min={CUT_HEIGHT.min}
              max={CUT_HEIGHT.max}
              step={CUT_HEIGHT_STEP}
              value={scene.cutHeight}
              disabled={!scene.cutaway}
              aria-valuetext={`${scene.cutHeight.toFixed(2)} metres`}
              onChange={(e) => pageActions.setSceneStyle({ cutHeight: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : null}
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
  items.push(<Item key="select">Click a wall, room or piece to select it</Item>);
  return items;
}

/** A hint segment of words and keys (hints.ts), as an Item. */
function PartsItem({ parts }: { parts: readonly HintPart[] }) {
  const keys = parts.flatMap((p) => (typeof p === "string" ? [] : [p.kbd]));
  const words = parts.flatMap((p) => (typeof p === "string" ? [p] : [])).join(" ");
  return <Item keys={keys}>{words}</Item>;
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
 * The hint at the bottom of the scene, a polite status. While a piece is being placed it says
 * how to put it down (a click, or Enter for the middle of the view) and how to stop (Esc, or
 * Cancel); with something selected (a click on the model selects as the plan does) it names it,
 * as the plan's hint does, so the selection is announced, with its keys; otherwise it teaches
 * the camera, and with doors in the plan offers to swing them all.
 */
export function SceneHint() {
  const camera = useAppStore((s) => s.editor.camera);
  const hasDoors = useAppStore((s) => s.model.openings.some((o) => o.kind === "door"));
  // a string, so an edit that leaves the selection alone does not re-render the hint
  const selected = useAppStore((s) => selectionTitle(s.editor, s.model));
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
  const items = cameraItems(camera, hasDoors);
  if (selected) items.unshift(<PartsItem key="remove" parts={REMOVE} />, <PartsItem key="deselect" parts={DESELECT} />);
  return (
    <div className="scene-float scene-hint" role="status">
      <span className="scene-hint__tool">{selected ?? tool?.label ?? camera}</span>
      <span className="scene-hint__sep" aria-hidden="true" />
      <Segments items={items} />
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
        <ViewSettings />
      </div>
      <div className="scene-overlays__hint">
        <SceneHint />
      </div>
    </div>
  );
}
