/**
 * Properties for a selected wall: its geometry in metres (length, thickness, height, angle, and
 * the two end points), the doors and windows in it, each editable in place, adding a door or a
 * window, and removing the wall. Every field is one edit_wall, move_opening, set_door_swing or
 * remove_opening, the same commands an agent calls.
 */

import { useId } from "react";
import { pageActions, type WallPatch } from "../../model/store";
import { COORD, SNAP, WALL_HEIGHT, WALL_MIN_LENGTH, WALL_THICKNESS, type Hinge, type SwingSide } from "../../model/limits";
import type { Opening, Wall } from "../../model/types";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import {
  Button,
  IconDoor,
  IconPlus,
  IconTrash,
  IconWall,
  IconWindow,
  Section,
  SegmentedControl,
  SegmentedControlItem,
} from "../primitives";
import { AgentCallout, EntityHead, InspectorFoot, Stats, useCommit, useOpenRow } from "./parts";
import { isCurved, sagittaOf, wallArc, wallEdge } from "../../model/shapes";
import { MeasureField, PointFields } from "./measure";
import {
  metres,
  openingName,
  openingOffset,
  openingTFor,
  wallAngle,
  wallEndFor,
  wallChord,
  wallLength,
  wallName,
  wallPlace,
} from "./entities";

/** Angles are typed to a tenth of a degree. */
const ANGLE_STEP = 0.1;
/** Thickness is typed to the centimetre. */
const THICKNESS_STEP = 0.01;

function OpeningEditor({ wall, opening, onDone }: { wall: Wall; opening: Opening; onDone: () => void }) {
  const commit = useCommit();
  const notify = useNotify();
  const name = useAppStore((s) => openingName(s.model, opening));
  const isDoor = opening.kind === "door";
  const remove = () => {
    const r = commit({ type: "remove_opening", id: opening.id });
    if (r.ok) notify({ body: `${name} removed`, undoable: true });
  };
  return (
    <div className="insp-opening__editor">
      <MeasureField
        label="Distance from the wall's start"
        value={openingOffset(wall, opening)}
        min={0}
        max={wallLength(wall) - opening.width}
        step={SNAP}
        onCommit={(v) => commit({ type: "move_opening", id: opening.id, t: openingTFor(wall, opening, v) })}
      />
      {isDoor ? (
        <div className="insp-grid">
          <div className="insp-choice">
            <span className="insp-choice__label" aria-hidden="true">
              Hinged at
            </span>
            <SegmentedControl
              label="Hinged at"
              size="sm"
              layout="fill"
              value={opening.hinge ?? "a"}
              onChange={(v) => commit({ type: "set_door_swing", id: opening.id, hinge: v as Hinge })}
            >
              <SegmentedControlItem value="a" label="Start" />
              <SegmentedControlItem value="b" label="End" />
            </SegmentedControl>
          </div>
          <div className="insp-choice">
            <span className="insp-choice__label" aria-hidden="true">
              Opens to the
            </span>
            <SegmentedControl
              label="Opens to the"
              size="sm"
              layout="fill"
              value={opening.side ?? "right"}
              onChange={(v) => commit({ type: "set_door_swing", id: opening.id, side: v as SwingSide })}
            >
              <SegmentedControlItem value="left" label="Left" />
              <SegmentedControlItem value="right" label="Right" />
            </SegmentedControl>
          </div>
        </div>
      ) : null}
      <p className="insp-help">
        {isDoor ? "Left and right as seen walking from the wall's start to its end. " : ""}
        Width and height are set when it is added.
      </p>
      <div className="insp-row insp-row--spread">
        <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
          Remove {opening.kind}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function OpeningsOnWall({ wall }: { wall: Wall }) {
  const openings = useAppStore((s) => s.model.openings);
  const all = useAppStore((s) => s.model);
  const commit = useCommit();
  const mine = openings.filter((o) => o.wallId === wall.id);
  const [editing, setEditing] = useOpenRow(mine.map((o) => o.id));
  const editorId = useId();

  return (
    <Section title="Openings on this wall" action={<span className="insp-aside num">{mine.length}</span>}>
      {mine.length === 0 ? (
        <p className="insp-help">No doors or windows on this wall.</p>
      ) : (
        <ul className="insp-list">
          {mine.map((o) => {
            const Icon = o.kind === "door" ? IconDoor : IconWindow;
            const open = editing === o.id;
            return (
              <li key={o.id} className="insp-opening" data-open={open}>
                <div className="insp-opening__row">
                  <span className="insp-opening__icon" aria-hidden="true">
                    <Icon size="sm" />
                  </span>
                  <span className="insp-opening__main">
                    <span className="insp-opening__name">{openingName(all, o)}</span>
                    <span className="insp-opening__meta num">
                      {metres(o.width)} wide, {metres(Math.max(0, openingOffset(wall, o)))} from the start
                      {o.kind === "window" ? `, sill ${metres(o.sill)}` : ""}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open}
                    aria-controls={open ? `${editorId}-${o.id}` : undefined}
                    aria-label={`Edit ${openingName(all, o)}`}
                    onClick={() => setEditing(open ? null : o.id)}
                  >
                    Edit
                  </Button>
                </div>
                {open ? (
                  <div id={`${editorId}-${o.id}`}>
                    <OpeningEditor wall={wall} opening={o} onDone={() => setEditing(null)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="insp-row">
        <Button size="sm" icon={IconPlus} onClick={() => commit({ type: "add_door", wallId: wall.id, t: 0.5 })}>
          Door
        </Button>
        <Button size="sm" icon={IconPlus} onClick={() => commit({ type: "add_window", wallId: wall.id, t: 0.5 })}>
          Window
        </Button>
      </div>
    </Section>
  );
}

/**
 * A wall's bend, from the keyboard: how far its middle stands off the straight line between its
 * ends (positive to the wall's left, walking from its start to its end), and Straighten. On the
 * plan, the same bend is the handle at the wall's middle.
 */
function BendSection({ wall, onEdit }: { wall: Wall; onEdit: (patch: WallPatch) => void }) {
  const arc = wallArc(wall);
  const half = wallChord(wall) / 2;
  return (
    <Section title="Bend" action={<span className="insp-aside">{arc ? "Curved" : "Straight"}</span>}>
      <MeasureField label="Bend at the middle" value={sagittaOf(wallEdge(wall))} min={-half} max={half} step={SNAP} onCommit={(v) => onEdit({ curve: { sagitta: v } })} />
      {arc ? (
        <>
          <Stats
            items={[
              { label: "Length along the arc", value: metres(arc.length) },
              { label: "Radius", value: metres(arc.radius) },
            ]}
          />
          <div className="insp-row">
            <Button size="sm" onClick={() => onEdit({ curve: { sagitta: 0 } })}>
              Straighten
            </Button>
          </div>
        </>
      ) : null}
      <p className="insp-help">Positive bends to the left walking from the start to the end; 0 is straight. Doors and windows are measured along the arc.</p>
    </Section>
  );
}

export function WallInspector({ wall }: { wall: Wall }) {
  const model = useAppStore((s) => s.model);
  const commit = useCommit();
  const notify = useNotify();
  const name = wallName(model, wall);
  // a curved wall's Length field is its chord: the straight distance its end is set at
  const length = wallChord(wall);
  const curved = isCurved(wall);
  const angle = wallAngle(wall);
  // a field that was not given stays as it is (edit_wall skips undefined keys)
  const edit = (patch: WallPatch) => commit({ type: "edit_wall", id: wall.id, patch });

  const remove = () => {
    const r = commit({ type: "remove_wall", id: wall.id });
    if (r.ok) {
      pageActions.selectWall(null);
      notify({ body: `${name} removed`, undoable: true });
    }
  };

  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconWall} title={name} sub={wallPlace(model, wall) ?? "Not along any room"} id={wall.id} />
        <Section title="Geometry" action={<span className="insp-aside">Snaps to {Math.round(SNAP * 100)} cm</span>}>
          <div className="insp-grid">
            <MeasureField label={curved ? "Chord" : "Length"} value={length} min={WALL_MIN_LENGTH} step={SNAP} onCommit={(v) => edit(wallEndFor(wall, v, angle))} />
            <MeasureField
              label="Thickness"
              value={wall.thickness}
              min={WALL_THICKNESS.min}
              max={WALL_THICKNESS.max}
              step={THICKNESS_STEP}
              onCommit={(v) => edit({ thickness: v })}
            />
            <MeasureField label="Height" value={wall.height} min={WALL_HEIGHT.min} max={WALL_HEIGHT.max} step={SNAP} onCommit={(v) => edit({ height: v })} />
            <MeasureField label="Angle" unit="°" digits={1} value={angle} step={ANGLE_STEP} onCommit={(v) => edit(wallEndFor(wall, length, v))} />
          </div>
          <PointFields label="Start point" x={wall.ax} y={wall.ay} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(p) => edit({ ax: p.x, ay: p.y })} />
          <PointFields label="End point" x={wall.bx} y={wall.by} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(p) => edit({ bx: p.x, by: p.y })} />
          <p className="insp-help">
            Length and angle move the end point; the start stays where it is.
          </p>
        </Section>
        <BendSection wall={wall} onEdit={edit} />
        <OpeningsOnWall wall={wall} />
        <Section>
          <AgentCallout>
            While this wall is selected, your agent can also lengthen it with one call, <span className="code">extend_selected_wall</span>.
          </AgentCallout>
        </Section>
      </div>
      <InspectorFoot
        action={
          <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
            Delete wall
          </Button>
        }
      />
    </div>
  );
}
