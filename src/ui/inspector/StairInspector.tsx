/**
 * Properties for a selected stair: its shape (straight, or L-shaped with a quarter landing that
 * turns left or right), where its bottom riser is and which way it climbs, its width, and its
 * steps: the risers and the going, worked out from the storey height and the comfort rule
 * unless they are set here. The figures that follow (riser height, 2R+G, headroom) are the
 * same ones the checker reads (src/model/stairs.ts), so what this says and what Issues says
 * agree. Every field is one move_stair or update_stair; removing it is one remove_stair.
 */

import { pageActions } from "../../model/store";
import { levelAbove, levelInfo, stairGeometryIn } from "../../model/levels";
import { stairSplit } from "../../model/stairs";
import { COORD, QUARTER_TURN, ROTATION, SNAP, STAIR, STAIR_SHAPES, STAIR_TURNS, quarterTurned, type StairShape, type StairTurn } from "../../model/limits";
import type { Stair } from "../../model/types";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import { Button, IconStair, IconTrash, Section, SegmentedControl, SegmentedControlItem } from "../primitives";
import { EntityHead, InspectorFoot, Stats, useCommit } from "./parts";
import { MeasureField, PointFields, ROTATION_STEP } from "./measure";
import { degrees, metres, stairKind, stairName } from "./entities";

const SHAPE_LABEL: Record<StairShape, string> = { straight: "Straight", l: "L-shaped" };
const TURN_LABEL: Record<StairTurn, string> = { left: "Left", right: "Right" };
/** Risers are counted whole, and the going typed in steps of 5 mm. */
const COUNT_STEP = 1;
const GOING_STEP = 0.005;

const centimetres = (m: number): string => `${(m * 100).toFixed(1)} cm`;

export function StairInspector({ stair }: { stair: Stair }) {
  const model = useAppStore((s) => s.model);
  const commit = useCommit();
  const notify = useNotify();
  const name = stairName(model, stair);
  const geometry = stairGeometryIn(model, stair);
  const from = levelInfo(model, stair.levelId);
  const to = levelAbove(model, stair.levelId);
  const update = (patch: Partial<Pick<Stair, "width" | "shape" | "turn" | "split" | "risers" | "tread">>) => commit({ type: "update_stair", id: stair.id, patch });
  const move = (at: { x?: number; y?: number; rotation?: number }) => commit({ type: "move_stair", id: stair.id, ...at });

  const remove = () => {
    const r = commit({ type: "remove_stair", id: stair.id });
    if (r.ok) {
      pageActions.selectStair(null);
      notify({ body: `${name} removed`, undoable: true });
    }
  };

  const where = to ? `From ${from?.level.name ?? "its level"} up to ${to.level.name}` : `On ${from?.level.name ?? "its level"}, with no level above to reach`;

  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconStair} title={name} sub={`${stairKind(stair)}. ${where}`} id={stair.id} />
        <Section>
          <div className="insp-choice">
            <span className="insp-choice__label" aria-hidden="true">
              Shape
            </span>
            <SegmentedControl label="Shape" size="sm" layout="fill" value={stair.shape} onChange={(v) => update({ shape: v as StairShape })}>
              {STAIR_SHAPES.map((s) => (
                <SegmentedControlItem key={s} value={s} label={SHAPE_LABEL[s]} />
              ))}
            </SegmentedControl>
          </div>
          {stair.shape === "l" && geometry ? (
            <>
              <div className="insp-choice">
                <span className="insp-choice__label" aria-hidden="true">
                  Turns at the landing
                </span>
                <SegmentedControl label="Turns at the landing" size="sm" layout="fill" value={stair.turn ?? STAIR_TURNS[0]} onChange={(v) => update({ turn: v as StairTurn })}>
                  {STAIR_TURNS.map((t) => (
                    <SegmentedControlItem key={t} value={t} label={TURN_LABEL[t]} />
                  ))}
                </SegmentedControl>
              </div>
              <MeasureField
                label="Risers before the landing"
                unit=""
                digits={0}
                value={stairSplit(stair, geometry.risers)}
                min={1}
                max={geometry.risers - 1}
                step={COUNT_STEP}
                onCommit={(v) => update({ split: Math.round(v) })}
              />
            </>
          ) : null}
        </Section>
        <Section title="Placement" action={<span className="insp-aside">Snaps to {Math.round(SNAP * 100)} cm</span>}>
          <PointFields label="Bottom riser" x={stair.x} y={stair.y} min={COORD.min} max={COORD.max} step={SNAP} onCommit={(p) => move(p)} />
          <div className="insp-grid insp-grid--end">
            <MeasureField
              label="Climbs towards"
              unit="°"
              digits={1}
              value={stair.rotation}
              min={ROTATION.min}
              max={ROTATION.max}
              step={ROTATION_STEP}
              onCommit={(v) => move({ rotation: v })}
            />
            <Button size="md" onClick={() => move({ rotation: quarterTurned(stair.rotation) })}>
              Turn {degrees(QUARTER_TURN)}
            </Button>
          </div>
          <MeasureField label="Width" value={stair.width} min={STAIR.width.min} max={STAIR.width.max} step={SNAP} onCommit={(v) => update({ width: v })} />
        </Section>
        {geometry ? (
          <Section title="Steps">
            <div className="insp-grid">
              <MeasureField
                label="Risers"
                unit=""
                digits={0}
                value={geometry.risers}
                min={STAIR.risers.min}
                max={STAIR.risers.max}
                step={COUNT_STEP}
                onCommit={(v) => update({ risers: Math.round(v) })}
              />
              <MeasureField
                label="Going"
                digits={3}
                value={geometry.going}
                min={STAIR.treadSet.min}
                max={STAIR.treadSet.max}
                step={GOING_STEP}
                onCommit={(v) => update({ tread: v })}
              />
            </div>
            <Stats
              items={[
                { label: "Climbs", value: metres(geometry.rise) },
                { label: "Riser", value: centimetres(geometry.riserHeight) },
                { label: "2 risers + going", value: centimetres(geometry.stepRule) },
                { label: "Headroom", value: metres(geometry.headroom) },
              ]}
            />
            <p className="insp-help">
              Risers between {centimetres(STAIR.riser.min)} and {centimetres(STAIR.riser.max)}, a going between {centimetres(STAIR.tread.min)} and{" "}
              {centimetres(STAIR.tread.max)}, and 2 risers + going near {centimetres(STAIR.stepRule.target)} make a comfortable stair. Issues says when this one is not.
            </p>
          </Section>
        ) : null}
      </div>
      <InspectorFoot
        action={
          <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={remove}>
            Delete stair
          </Button>
        }
      />
    </div>
  );
}
