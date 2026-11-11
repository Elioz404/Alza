/**
 * Top left of the plan: the plan's levels, top storey first as a section stacks them, as one
 * radio group (WAI-ARIA radio group: one tab stop, the arrow keys move and choose), and a
 * button that adds a level on top and starts working on it. The plan shows the level chosen
 * here, over a ghost of the one below (src/editor/Editor.tsx); PageUp and PageDown step through
 * the same levels from anywhere on the page (src/ui/shell/shortcuts.ts).
 *
 * Which level is being worked on is a view setting (pageActions.setActiveLevel), never an undo
 * step. Each change is said aloud through a polite status line, in either view, so a level
 * changed by key, by an agent's set_active_level or from here is heard the same way. A level a
 * pending request would remove is marked, and named so.
 *
 * Fetched after the first paint (src/ui/shell/CanvasRegion.tsx), with its stylesheet.
 */

import "./levels.css";
import { useId, useState } from "react";
import { activeLevelId, pageActions } from "../../model/store";
import { dispatch } from "../../model/commands";
import { levelsOf } from "../../model/levels";
import { MAX_LEVELS } from "../../model/limits";
import { IconButton, IconPlus, SegmentedControl, SegmentedControlItem } from "../primitives";
import { useAppStore } from "../useAppStore";
import { elevation } from "../inspector/entities";
import { useNotify } from "../shell/useNotify";

/** What the status line says when the level being worked on changes. */
export const workingOn = (name: string, at: number): string => `Working on ${name}, floor at ${elevation(at)}`;

/** Add a level on top of the plan, as the human, and work on it. The result's summary on a refusal. */
export function addLevelOnTop(): { ok: boolean; summary: string } {
  const r = dispatch({ type: "add_level" }, { actor: "human" });
  if (r.ok && typeof r.id === "string") pageActions.setActiveLevel(r.id);
  return r;
}

export function LevelSwitcher() {
  const is2d = useAppStore((s) => s.editor.view === "2d");
  const levels = useAppStore((s) => s.model.levels);
  const activeId = useAppStore(activeLevelId);
  const pendingIds = useAppStore((s) =>
    s.approvals
      .flatMap((a) => a.targets)
      .filter((t) => t.type === "level")
      .map((t) => t.id)
      .join(" "),
  );
  const notify = useNotify();
  const noteId = useId();
  const infos = levelsOf({ levels });
  const active = infos.find((l) => l.level.id === activeId) ?? infos[0];

  // the status line speaks only once the level has changed, not when the plan first shows
  const [heard, setHeard] = useState(activeId);
  const [said, setSaid] = useState("");
  if (heard !== activeId) {
    setHeard(activeId);
    setSaid(workingOn(active.level.name, active.elevation));
  }
  const status = (
    <p className="sr-only" role="status" aria-live="polite">
      {said}
    </p>
  );
  if (!is2d) return status;

  const pending = new Set(pendingIds ? pendingIds.split(" ") : []);
  const full = levels.length >= MAX_LEVELS;
  const add = () => {
    const r = addLevelOnTop();
    if (!r.ok) notify({ body: r.summary, type: "error" });
  };

  return (
    <section className="levels" aria-label="Levels">
      <SegmentedControl label="Level" size="sm" value={active.level.id} onChange={(id) => pageActions.setActiveLevel(id)} className="levels__list" aria-orientation="vertical">
        {[...infos].reverse().map((info) => (
          <SegmentedControlItem
            key={info.level.id}
            value={info.level.id}
            label={info.level.name}
            title={elevation(info.elevation)}
            className={pending.has(info.level.id) ? "levels__item levels__item--pending" : "levels__item"}
            aria-describedby={pending.has(info.level.id) ? noteId : undefined}
          />
        ))}
      </SegmentedControl>
      <p className="levels__at num" aria-hidden="true">
        {elevation(active.elevation)}
      </p>
      <IconButton
        icon={IconPlus}
        label="Add a level"
        hint="On top of the others, then work on it"
        disabledReason={full ? `The plan holds at most ${MAX_LEVELS} levels` : null}
        tooltipPlacement="end"
        onClick={add}
      />
      <span id={noteId} hidden>
        Removal pending
      </span>
      {status}
    </section>
  );
}
