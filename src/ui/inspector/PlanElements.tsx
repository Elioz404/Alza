/**
 * Everything on the level being worked on, listed: walls, rooms, doors and windows, furniture,
 * stairs, each a button that selects it, brings it into view and opens it here in Properties. It is the plan's
 * outline for a keyboard or a screen reader, where the drawing itself is a picture. Focus
 * moves to the plan, where the arrow keys nudge the selection and Delete removes it (the hint
 * bar says so); the inspector that edits it is here, where the list was.
 *
 * Names and figures are the ones every panel uses (entities.ts). Each group folds; they start
 * folded so the plan's own settings stay near the top.
 */

import type { ReactNode } from "react";
import { bus } from "../../model/sceneBus";
import type { PlanModel } from "../../model/types";
import { activeLevelId } from "../../model/store";
import { levelInfo, levelSlice } from "../../model/levels";
import { useAppStore } from "../useAppStore";
import { IconChevronDown, Section } from "../primitives";
import { focusCanvasRegion } from "../shell/ids";
import {
  FOCUS_ENTITY_EVENT,
  itemName,
  metres,
  openingName,
  roomArea,
  selectEntity,
  squareMetres,
  columnName,
  stairKind,
  stairName,
  wallLength,
  wallName,
  type EntityRef,
} from "./entities";

interface Element {
  ref: EntityRef;
  detail: ReactNode;
}

interface Group {
  title: string;
  elements: Element[];
}

/** The groups of what stands on one level (`model` is that level's slice); names are the whole plan's. */
function groupsOf(model: PlanModel, plan: PlanModel): Group[] {
  const wallById = new Map(model.walls.map((w) => [w.id, w]));
  const groups: Group[] = [
    {
      title: "Walls",
      elements: model.walls.map((w) => ({ ref: { type: "wall", id: w.id, name: wallName(plan, w) }, detail: metres(wallLength(w)) })),
    },
    {
      title: "Rooms",
      elements: model.rooms.map((r) => ({ ref: { type: "room", id: r.id, name: r.label }, detail: squareMetres(roomArea(r)) })),
    },
    {
      title: "Doors and windows",
      elements: model.openings.map((o) => {
        const wall = wallById.get(o.wallId);
        return { ref: { type: o.kind, id: o.id, name: openingName(plan, o) }, detail: wall ? `in ${wallName(plan, wall)}` : null };
      }),
    },
    {
      title: "Furniture",
      elements: model.items.map((it) => ({ ref: { type: "item", id: it.id, name: itemName(model, it) }, detail: null })),
    },
    {
      title: "Stairs",
      elements: model.stairs.map((st) => ({ ref: { type: "stair", id: st.id, name: stairName(plan, st) }, detail: stairKind(st) })),
    },
    {
      title: "Columns",
      elements: model.columns.map((c) => ({ ref: { type: "column", id: c.id, name: columnName(plan, c) }, detail: c.shape === "circle" ? `Ø ${metres(c.w)}` : `${c.w.toFixed(2)} × ${metres(c.d)}` })),
    },
  ];
  return groups.filter((g) => g.elements.length > 0);
}

export function PlanElements() {
  const plan = useAppStore((s) => s.model);
  const levelId = useAppStore(activeLevelId);
  const model = levelSlice(plan, levelId);
  const groups = groupsOf(model, plan);
  if (groups.length === 0) return null;
  const level = plan.levels.length > 1 ? levelInfo(plan, levelId)?.level.name : undefined;

  const open = (ref: EntityRef) => {
    selectEntity(model, ref);
    bus.emit(FOCUS_ENTITY_EVENT, ref);
    // this list gives way to the selection's inspector; focus goes to the plan, where the
    // selection's keys work, rather than to the top of the page
    focusCanvasRegion();
  };

  return (
    <Section title={level ? `On ${level}` : "On the plan"}>
      <p className="insp-help">Select anything here to edit it in Properties. Focus moves to the plan, where the arrow keys nudge it and Delete removes it.</p>
      <div className="insp-elements">
        {groups.map((g) => (
          <details key={g.title} className="insp-elements__group">
            <summary className="insp-elements__summary">
              <IconChevronDown size="sm" className="insp-elements__chevron" />
              <span className="insp-elements__title">{g.title}</span>
              <span className="insp-elements__count num">{g.elements.length}</span>
            </summary>
            <ul className="insp-list">
              {g.elements.map((el) => (
                <li key={el.ref.id}>
                  <button type="button" className="insp-element" onClick={() => open(el.ref)}>
                    <span className="insp-element__name">{el.ref.name}</span>
                    {el.detail ? <span className="insp-element__detail num">{el.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Section>
  );
}
