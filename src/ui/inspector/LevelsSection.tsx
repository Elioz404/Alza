/**
 * The plan's levels in Properties (with nothing selected): each storey's name and floor-to-floor
 * height, where its floor stands, moving it up or down the stack, removing it, and adding one on
 * top. Where each floor stands follows from the heights below it (src/model/levels.ts), so it is
 * shown, never typed. The level being worked on is marked; choosing another is the level
 * switcher's (over the plan) or PageUp and PageDown.
 *
 * Every field is one update_level, add_level or remove_level, as the person, the same commands
 * an agent's tools run. It uses the number fields, so it is fetched after the first paint.
 */

import "./levels.css";
import { useRef } from "react";
import { activeLevelId, pageActions } from "../../model/store";
import { levelStats, levelsOf, type LevelInfo } from "../../model/levels";
import { LEVEL_HEIGHT, MAX_LEVELS, SNAP, TEXT } from "../../model/limits";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import { Badge, Button, IconChevronDown, IconPlus, IconTrash, Section } from "../primitives";
import { PlanTextField, useCommit } from "./parts";
import { MeasureField } from "./measure";
import { elevation } from "./entities";
import { addLevelOnTop } from "../canvas/LevelSwitcher";

/** What stands on a level, in a few words: "7 walls, 3 rooms, 1 stair". */
function contentsOf(stats: ReturnType<typeof levelStats>): string {
  const parts = [
    [stats.walls, "wall"],
    [stats.rooms, "room"],
    [stats.items, "item"],
    [stats.stairs, "stair"],
  ] as const;
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
  return said.length > 0 ? said.join(", ") : "Nothing on it yet";
}

/** The attribute a level's row carries its level's id in, so focus can find a row after a removal. */
const ROW_LEVEL_ATTR = "data-level-id";

interface LevelRowProps {
  info: LevelInfo;
  count: number;
  isActive: boolean;
  /** after this level is removed: hand focus on, to the level now in its place (an id), or past the list */
  onRemoved: (neighbourId: string | undefined) => void;
}

function LevelRow({ info, count, isActive, onRemoved }: LevelRowProps) {
  const model = useAppStore((s) => s.model);
  const commit = useCommit();
  const notify = useNotify();
  const { level, index } = info;
  const remove = () => {
    // the row now in this one's place, top first: the level under it, or (the ground gone) the one over it
    const neighbour = (model.levels[index - 1] ?? model.levels[index + 1])?.id;
    const r = commit({ type: "remove_level", id: level.id });
    if (!r.ok) return;
    notify({ body: `Level “${level.name}” removed`, undoable: true });
    onRemoved(neighbour);
  };
  return (
    <li className="insp-level" aria-current={isActive ? "true" : undefined} {...{ [ROW_LEVEL_ATTR]: level.id }}>
      {/* every field and button in the row is announced in its level's name: several rows share their labels */}
      <div className="insp-level__body" role="group" aria-label={level.name}>
        <div className="insp-row insp-row--spread">
          <span className="insp-level__at num">{elevation(info.elevation)}</span>
          {isActive ? <Badge tone="accent">Working on it</Badge> : (
            <Button size="sm" variant="ghost" onClick={() => pageActions.setActiveLevel(level.id)}>
              Work on it
            </Button>
          )}
        </div>
        <PlanTextField label="Name" value={level.name} maxLength={TEXT.label} toCommand={(text) => ({ type: "update_level", id: level.id, patch: { name: text } })} />
        <MeasureField
          label="Floor to floor"
          value={level.height}
          min={LEVEL_HEIGHT.min}
          max={LEVEL_HEIGHT.max}
          step={SNAP}
          onCommit={(v) => commit({ type: "update_level", id: level.id, patch: { height: v } })}
        />
        <p className="insp-help">{contentsOf(levelStats(model, level.id))}</p>
        <div className="insp-row">
          <Button size="sm" disabledReason={index === count - 1 ? "It is the top level" : null} onClick={() => commit({ type: "update_level", id: level.id, patch: { order: index + 1 } })}>
            Move up
          </Button>
          <Button size="sm" disabledReason={index === 0 ? "It is the ground level" : null} onClick={() => commit({ type: "update_level", id: level.id, patch: { order: index - 1 } })}>
            Move down
          </Button>
          <Button size="sm" variant="danger-quiet" icon={IconTrash} disabledReason={count === 1 ? "A plan keeps at least one level" : null} onClick={remove}>
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

export function LevelsSection() {
  const levels = useAppStore((s) => s.model.levels);
  const activeId = useAppStore(activeLevelId);
  const notify = useNotify();
  const infos = levelsOf({ levels });
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** A removed row's focus goes to the row now in its place (its name), or to Add when none is left. */
  const focusAfterRemoval = (neighbourId: string | undefined) => {
    requestAnimationFrame(() => {
      const row = neighbourId ? [...(listRef.current?.querySelectorAll<HTMLElement>(`[${ROW_LEVEL_ATTR}]`) ?? [])].find((r) => r.getAttribute(ROW_LEVEL_ATTR) === neighbourId) : undefined;
      (row?.querySelector<HTMLElement>("input") ?? addRef.current)?.focus();
    });
  };
  const add = () => {
    const r = addLevelOnTop();
    if (!r.ok) notify({ body: r.summary, type: "error" });
  };
  return (
    <Section title="Levels" action={<span className="insp-aside num">{levels.length}</span>}>
      <details className="insp-elements__group" open={levels.length > 1}>
        <summary className="insp-elements__summary">
          <IconChevronDown size="sm" className="insp-elements__chevron" />
          <span className="insp-elements__title">Storeys, top first</span>
        </summary>
        <ul className="insp-levels" ref={listRef}>
          {[...infos].reverse().map((info) => (
            <LevelRow key={info.level.id} info={info} count={infos.length} isActive={info.level.id === activeId} onRemoved={focusAfterRemoval} />
          ))}
        </ul>
      </details>
      <div className="insp-stack">
        <Button ref={addRef} size="sm" icon={IconPlus} disabledReason={levels.length >= MAX_LEVELS ? `The plan holds at most ${MAX_LEVELS} levels` : null} onClick={add}>
          Add a level on top
        </Button>
        <p className="insp-help">Each floor stands on the one below it: change a storey's height and every floor above moves with it, and its walls that met the floor above grow or shrink to meet it again.</p>
      </div>
    </Section>
  );
}
