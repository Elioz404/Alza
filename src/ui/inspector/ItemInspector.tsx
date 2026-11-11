/**
 * Properties for a selected piece of furniture: where its centre is, how it is turned, its size
 * (from the catalogue, so it is read here, not typed), and removing it. Every field is one
 * move_item or remove_item.
 */

import { pageActions } from "../../model/store";
import { catalogOf } from "../../model/catalog";
import { COORD, QUARTER_TURN, ROTATION, SNAP, quarterTurned } from "../../model/limits";
import type { Item } from "../../model/types";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import { Badge, Button, IconFurniture, IconTrash, Section } from "../primitives";
import { EntityHead, InspectorFoot, Stats, useCommit } from "./parts";
import { MeasureField, PointFields, ROTATION_STEP } from "./measure";
import { degrees, itemName, metres, roomAt } from "./entities";


const SOURCE_BADGE = { supplier: { tone: "neutral", text: "Nordika" }, custom: { tone: "agent", text: "Made by your agent" } } as const;

export function ItemInspector({ item }: { item: Item }) {
  const model = useAppStore((s) => s.model);
  const commit = useCommit();
  const notify = useNotify();
  const def = catalogOf(model).get(item.kind);
  const name = itemName(model, item);
  const room = roomAt(model, item.x, item.y);
  const badge = def && def.source !== "builtin" ? SOURCE_BADGE[def.source] : null;

  const remove = () => {
    const r = commit({ type: "remove_item", id: item.id });
    if (r.ok) {
      pageActions.selectItem(null);
      notify({ body: `${name} removed`, undoable: true });
    }
  };

  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconFurniture} title={name} sub={room ? `In ${room.label}` : "Outside every room"} id={item.id} />
        {badge ? (
          <p className="insp-row">
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </p>
        ) : null}
        <Section title="Placement" action={<span className="insp-aside">Snaps to {Math.round(SNAP * 100)} cm</span>}>
          <PointFields label="Centre" x={item.x} y={item.y} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(p) => commit({ type: "move_item", id: item.id, ...p })} />
          <div className="insp-grid insp-grid--end">
            <MeasureField
              label="Rotation"
              unit="°"
              digits={1}
              value={item.rotation}
              min={ROTATION.min}
              max={ROTATION.max}
              step={ROTATION_STEP}
              onCommit={(v) => commit({ type: "move_item", id: item.id, rotation: v })}
            />
            <Button size="md" onClick={() => commit({ type: "move_item", id: item.id, rotation: quarterTurned(item.rotation) })}>
              Turn {degrees(QUARTER_TURN)}
            </Button>
          </div>
        </Section>
        {def ? (
          <Section title="Size">
            <Stats
              items={[
                { label: "Width", value: metres(def.w) },
                { label: "Depth", value: metres(def.d) },
                { label: "Height", value: metres(def.h) },
              ]}
            />
            <p className="insp-help">The size comes from the catalogue. To use another size, place a different piece.</p>
          </Section>
        ) : (
          <Section>
            <p className="insp-error" role="alert">
              This piece's kind is not in the catalogue, so its size is unknown. Remove it, or ask your agent to define the kind again.
            </p>
          </Section>
        )}
      </div>
      <InspectorFoot
        action={
          <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
            Delete item
          </Button>
        }
      />
    </div>
  );
}
