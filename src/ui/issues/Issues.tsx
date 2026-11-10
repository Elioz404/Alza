/**
 * The Issues tab: the checker's findings (issuesOf(model), the same list get_issues gives an
 * agent), errors first, then warnings. Each finding names the things it is about the way the
 * rest of the page does ("Wall 3", "Door 1", "Sofa") instead of by id, and selecting it selects
 * that thing on the plan. An empty plan has nothing to check, which is not the same as a plan
 * that passes, so the two say different things.
 */
import "./issues.css";
import { bus } from "../../model/sceneBus";
import { issuesOf } from "../../model/issues";
import { catalogOf } from "../../model/catalog";
import type { Issue, IssueSeverity, PlanModel } from "../../model/types";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import { Badge, EmptyState, IconCheck, IconChevronRight, IconError, IconIssues, IconWarning, Section } from "../primitives";
import { capitalise, entityById, FOCUS_ENTITY_EVENT, selectEntity, type EntityRef } from "../inspector/entities";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A finding as the person reads it: its sentence with names for ids, and what it points at. */
export interface IssueView {
  severity: IssueSeverity;
  code: string;
  sentence: string;
  /** the entities it is about that are on the plan, first one first */
  targets: EntityRef[];
}

/**
 * The checker writes its messages for agents, with ids ("Wall wall_e has a loose end").
 * Here every id it refers to is replaced by that entity's name, together with the word the
 * message puts in front of it ("wall", "door"), so the name reads on its own ("Wall 3 has a
 * loose end"). A partner product is named by its own label rather than its kind id.
 */
export function describeIssue(model: PlanModel, issue: Issue): IssueView {
  const catalog = catalogOf(model);
  const targets: EntityRef[] = [];
  let sentence = issue.message;
  for (const id of issue.refs) {
    const ref = entityById(model, id);
    if (!ref) continue;
    targets.push(ref);
    const named = new RegExp(`\\b(?:walls?|doors?|windows?|items?|rooms?)\\s+${escapeRegExp(id)}\\b`, "gi");
    sentence = sentence.replace(named, ref.name).split(id).join(ref.name);
    if (ref.type === "item") {
      const item = model.items.find((i) => i.id === id);
      const def = item ? catalog.get(item.kind) : undefined;
      if (def?.source === "supplier") sentence = sentence.split(def.kind).join(def.label);
    }
  }
  return { severity: issue.severity, code: issue.code, sentence: capitalise(sentence), targets };
}

const GROUPS: readonly { severity: IssueSeverity; title: string; word: string; icon: typeof IconError }[] = [
  { severity: "error", title: "Errors", word: "Error", icon: IconError },
  { severity: "warning", title: "Warnings", word: "Warning", icon: IconWarning },
];

function IssueRow({ view, word, icon: Icon }: { view: IssueView; word: string; icon: typeof IconError }) {
  const model = useAppStore((s) => s.model);
  const { setPanelOpen } = useShell();
  const narrow = useBreakpoint("drawer");
  const target = view.targets[0];

  const body = (
    <>
      <Icon size="sm" className={`issue__icon issue__icon--${view.severity}`} />
      <span className="issue__text">
        <span className="sr-only">{word}: </span>
        {view.sentence}
      </span>
    </>
  );

  if (!target) return <li className="issue">{body}</li>;

  const locate = () => {
    selectEntity(model, target);
    bus.emit(FOCUS_ENTITY_EVENT, target);
    // over the plan, the drawer would hide what was just selected
    if (narrow) setPanelOpen(false);
  };

  return (
    <li className="issue">
      <button type="button" className="issue__button" onClick={locate}>
        {body}
        <IconChevronRight size="sm" className="issue__go" />
      </button>
    </li>
  );
}

export function Issues() {
  const model = useAppStore((s) => s.model);
  const isEmpty = model.walls.length + model.rooms.length + model.items.length + model.openings.length === 0;

  if (isEmpty) {
    return (
      <div className="issues">
        <EmptyState
          icon={IconIssues}
          title="Nothing to check yet"
          body="Once the plan has walls, rooms or furniture, this lists what does not fit: loose wall ends, doors and windows that overrun their wall, furniture that blocks a door."
        />
      </div>
    );
  }

  const views = issuesOf(model).map((i) => describeIssue(model, i));
  if (views.length === 0) {
    return (
      <div className="issues">
        <EmptyState
          icon={IconCheck}
          title="No issues found"
          body="Every wall connects, every door and window fits its wall, and nothing blocks a door or sits outside a room."
        />
      </div>
    );
  }

  return (
    <div className="issues">
      <p className="issues__lead">Choose a finding to select it on the plan.</p>
      {GROUPS.map(({ severity, title, word, icon }) => {
        const list = views.filter((v) => v.severity === severity);
        if (list.length === 0) return null;
        return (
          <Section
            key={severity}
            className="issues__group"
            title={
              <span className="issues__title">
                {title}
                <Badge tone={severity === "error" ? "error" : "warning"}>{list.length}</Badge>
              </span>
            }
          >
            <ul className="issues__list">
              {list.map((v, idx) => (
                <IssueRow key={`${v.code}-${idx}`} view={v} word={word} icon={icon} />
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}

