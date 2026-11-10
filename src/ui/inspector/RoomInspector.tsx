/**
 * Properties for a selected room: its name, floor finish, corner and size in metres, its area,
 * and removing it. Every field is one update_room or remove_room.
 */

import { pageActions } from "../../model/store";
import { COORD, FLOOR_FINISHES, ROOM_SIZE, SNAP, TEXT, type FloorFinish } from "../../model/limits";
import type { Room } from "../../model/types";
import { useNotify } from "../shell/useNotify";
import { Button, IconRoom, IconTrash, Section, SegmentedControl, SegmentedControlItem } from "../primitives";
import { EntityHead, InspectorFoot, PlanTextField, Stats, useCommit } from "./parts";
import { MeasureField, PointFields } from "./measure";
import { metres, squareMetres, roomArea } from "./entities";

const FINISH_LABEL: Record<FloorFinish, string> = { oak: "Oak", tile: "Tile", carpet: "Carpet", concrete: "Concrete" };

export function RoomInspector({ room }: { room: Room }) {
  const commit = useCommit();
  const notify = useNotify();
  const update = (patch: Partial<Pick<Room, "x" | "y" | "w" | "h" | "label" | "floor">>) => commit({ type: "update_room", id: room.id, patch });

  const remove = () => {
    const r = commit({ type: "remove_room", id: room.id });
    if (r.ok) {
      pageActions.selectRoom(null);
      notify({ body: `${room.label} removed`, undoable: true });
    }
  };

  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconRoom} title={room.label} sub={`Room, ${FINISH_LABEL[room.floor].toLowerCase()} floor`} id={room.id} />
        <Section>
          <PlanTextField
            label="Name"
            value={room.label}
            maxLength={TEXT.label}
            toCommand={(text) => ({ type: "update_room", id: room.id, patch: { label: text } })}
          />
          <div className="insp-choice">
            <span className="insp-choice__label" aria-hidden="true">
              Floor finish
            </span>
            <SegmentedControl label="Floor finish" size="sm" layout="fill" value={room.floor} onChange={(v) => update({ floor: v as FloorFinish })}>
              {FLOOR_FINISHES.map((f) => (
                <SegmentedControlItem key={f} value={f} label={FINISH_LABEL[f]} />
              ))}
            </SegmentedControl>
          </div>
        </Section>
        <Section title="Size and position" action={<span className="insp-aside">Snaps to {Math.round(SNAP * 100)} cm</span>}>
          <div className="insp-grid">
            <MeasureField label="Width" value={room.w} min={ROOM_SIZE.min} max={ROOM_SIZE.max} step={SNAP} onCommit={(v) => update({ w: v })} />
            <MeasureField label="Depth" value={room.h} min={ROOM_SIZE.min} max={ROOM_SIZE.max} step={SNAP} onCommit={(v) => update({ h: v })} />
          </div>
          <PointFields label="Top-left corner" x={room.x} y={room.y} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(p) => update(p)} />
          <Stats
            items={[
              { label: "Floor area", value: squareMetres(roomArea(room)) },
              { label: "Perimeter", value: metres(2 * (room.w + room.h)) },
            ]}
          />
          <p className="insp-help">A room is the floor and its name; the walls around it are drawn on their own.</p>
        </Section>
      </div>
      <InspectorFoot
        action={
          <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
            Delete room
          </Button>
        }
      />
    </div>
  );
}
