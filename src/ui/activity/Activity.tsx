/**
 * Activity: every change to the plan, yours and your agent's, newest first. It is the plan's
 * revision list: a change gets a number, and the same number marks it on the drawing.
 *
 * Each row says when, who (a mark and the word: Agent, You, System), what happened in a
 * sentence whose entity names select the entity, and which tool did it. A request still waiting
 * for your approval is highlighted, in the error colour, with Review. Refusals and failures are
 * set in the error colour too. All / Agent / You filters the list.
 *
 * Only a new entry is announced, politely, in a region of its own: its actor and its sentence,
 * whatever the filter shows. The list itself is not live, so a filter that reveals old rows,
 * or an empty state that changes its words, says nothing. A new request is announced by the
 * request card (PlanMarks), not twice.
 */

import "./activity.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry, ActivitySource, PendingApproval } from "../../model/types";
import { store } from "../../model/store";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import {
  Button,
  DeltaMark,
  EmptyState,
  IconActivity,
  IconAgent,
  IconCheck,
  IconClose,
  IconError,
  IconEye,
  IconNote,
  IconPerson,
  IconSystem,
  IconUndo,
  SegmentedControl,
  SegmentedControlItem,
  type IconComponent,
} from "../primitives";
import { requestReview } from "../approvals/review";
import { APPROVED_PREFIX, REQUEST_PREFIX, kindOf, pendingByLine, useRevisionNumbers, type EntryKind } from "./revisions";
import { Sentence } from "./Sentence";
import { segmentsOf } from "./entities";

type Filter = "all" | "agent" | "human";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "agent", label: "Agent" },
  { value: "human", label: "You" },
];

const EMPTY: Record<Filter, { title: string; body: string }> = {
  all: {
    title: "No changes yet",
    body: "Every edit to the plan lands here, yours and your agent’s, newest first. Agent changes are also marked on the drawing.",
  },
  agent: {
    title: "Nothing from your agent yet",
    body: "When your agent reads or changes the plan, each call shows here with the tool it used.",
  },
  human: {
    title: "Nothing from you yet",
    body: "Your edits show here as you make them, each one numbered like its mark on the drawing.",
  },
};

export const ACTOR: Record<ActivitySource, { word: string; icon: IconComponent }> = {
  agent: { word: "Agent", icon: IconAgent },
  human: { word: "You", icon: IconPerson },
  system: { word: "System", icon: IconSystem },
};

const KIND_ICON: Partial<Record<EntryKind, IconComponent>> = {
  note: IconNote,
  undo: IconUndo,
  read: IconEye,
  system: IconSystem,
  failure: IconError,
};

const clock = (at: number, seconds = false): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(seconds ? { second: "2-digit" } : {}) });

/**
 * The row's mark: the revision number for a change (the number its mark carries on the
 * drawing), the error-coloured delta for a request, an icon for anything else.
 */
function Mark({ entry, kind, n }: { entry: ActivityEntry; kind: EntryKind; n?: number }) {
  if (kind === "request") return <DeltaMark tone="destructive" />;
  if (n !== undefined) return <DeltaMark n={n} tone={entry.source === "agent" ? "agent" : "human"} label={`Change ${n}`} />;
  if (kind === "decision") {
    const Icon = entry.summary.startsWith(APPROVED_PREFIX) ? IconCheck : IconClose;
    return <Icon size="sm" />;
  }
  const Icon = KIND_ICON[kind] ?? IconActivity;
  return <Icon size="sm" />;
}

function Row({ entry, n, pending }: { entry: ActivityEntry; n?: number; pending?: PendingApproval }) {
  const kind = kindOf(entry);
  const { setPanelOpen } = useShell();
  const drawer = useBreakpoint("drawer");
  const actor = ACTOR[entry.source];
  // A request still waiting reads as the request itself, and "Waiting for you" says the rest.
  // Once answered, the line no longer waits: the decision is the line above it.
  const asked = kind === "request" ? entry.summary.slice(REQUEST_PREFIX.length) : null;
  const text = asked === null ? entry.summary : pending ? asked : `Asked for your approval: ${asked}`;
  const review = () => {
    if (!pending) return;
    // the card is on the plan, which the drawer covers on narrow screens
    if (drawer) setPanelOpen(false);
    requestReview(pending.id);
  };
  return (
    <li className={`act-row act-row--${kind}${pending ? " act-row--pending" : ""}`}>
      <span className="act-row__mark">
        <Mark entry={entry} kind={kind} n={n} />
      </span>
      <div className="act-row__body">
        <p className="act-row__text">
          <Sentence text={text} />
        </p>
        <p className="act-row__meta">
          <span className={`actor actor--${entry.source}`}>
            <actor.icon size="xs" />
            {actor.word}
          </span>
          <code className="code act-row__tool">{entry.tool}</code>
          {pending ? <span className="act-row__waiting">Waiting for you</span> : null}
        </p>
        {pending ? (
          <Button size="sm" variant="secondary" className="act-row__review" onClick={review}>
            Review
          </Button>
        ) : null}
      </div>
      <time className="act-row__time num" dateTime={new Date(entry.at).toISOString()} title={clock(entry.at, true)}>
        {clock(entry.at)}
      </time>
    </li>
  );
}

/** The newest entry, in words, once the feed grows: "Agent: Wall 3 updated." */
function NewEntryAnnouncer() {
  const activity = useAppStore((s) => s.activity);
  const [said, setSaid] = useState("");
  // the last entry already accounted for, by id: the feed is capped, so its length stops growing
  const last = useRef(activity.at(-1)?.id);
  useEffect(() => {
    const at = activity.findIndex((e) => e.id === last.current);
    const fresh = at >= 0 ? activity.slice(at + 1) : activity.slice(-1);
    last.current = activity.at(-1)?.id;
    const newest = fresh.filter((e) => kindOf(e) !== "request").at(-1);
    if (!newest) return;
    // names as the plan has them when the entry lands
    const sentence = segmentsOf(newest.summary, store.getState().model)
      .map((s) => s.text)
      .join("");
    setSaid(`${ACTOR[newest.source].word}: ${sentence}`);
  }, [activity]);
  return (
    <p className="sr-only" aria-live="polite">
      {said}
    </p>
  );
}

export function ActivityList() {
  const activity = useAppStore((s) => s.activity);
  const approvals = useAppStore((s) => s.approvals);
  const [filter, setFilter] = useState<Filter>("all");

  const numbers = useRevisionNumbers();
  const pending = useMemo(() => pendingByLine(approvals, activity), [approvals, activity]);
  const rows = useMemo(
    () => activity.filter((e) => filter === "all" || e.source === filter).reverse(),
    [activity, filter],
  );

  return (
    <div className="act">
      <div className="act__bar">
        <SegmentedControl label="Show activity from" value={filter} onChange={(v) => setFilter(v as Filter)} size="sm">
          {FILTERS.map((f) => (
            <SegmentedControlItem key={f.value} value={f.value} label={f.label} />
          ))}
        </SegmentedControl>
      </div>
      <NewEntryAnnouncer />
      {rows.length === 0 ? (
        <div className="act__empty">
          <EmptyState title={EMPTY[filter].title} body={EMPTY[filter].body} />
        </div>
      ) : (
        <ol className="act__rows" aria-label="Activity, newest first">
          {rows.map((e) => (
            <Row key={e.id} entry={e} n={numbers.get(e.id)} pending={pending.get(e.id)} />
          ))}
        </ol>
      )}
    </div>
  );
}
