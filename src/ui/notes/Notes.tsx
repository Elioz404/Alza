/**
 * The Notes tab: the plan's shared margin. The composer on top, then every note, newest first,
 * each signed You or Agent (a mark and the word, never colour alone) with the time it was left.
 * Agents read these with get_notes and write them with leave_note.
 */
import "./notes.css";
import { useAppStore } from "../useAppStore";
import { EmptyState, IconAgent, IconNote, IconPerson } from "../primitives";
import { NoteForm } from "./NoteComposer";

const AUTHOR = {
  human: { word: "You", icon: IconPerson },
  agent: { word: "Agent", icon: IconAgent },
} as const;

/** Times read the way the rest of the page's English does: a 24-hour clock. */
const TIME_LOCALE = "en-GB";

/** "10:45" today, "3 Nov, 10:45" on another day. */
function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(TIME_LOCALE, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(TIME_LOCALE, { day: "numeric", month: "short" })}, ${time}`;
}

export function Notes() {
  const notes = useAppStore((s) => s.notes);
  return (
    <div className="notes">
      <NoteForm placement="notes" />
      {notes.length === 0 ? (
        <EmptyState
          icon={IconNote}
          title="No notes yet"
          body="Notes are the plan's shared margin. You and your agent both read and write here, so it is a good place for a request or a measurement to check."
        />
      ) : (
        <ol className="notes__list" aria-label="Notes, newest first">
          {[...notes].reverse().map((n) => {
            const author = AUTHOR[n.author];
            const Icon = author.icon;
            return (
              <li key={n.id} className={`note note--${n.author}`}>
                <div className="note__meta">
                  <span className="note__mark" aria-hidden="true">
                    <Icon size="xs" />
                  </span>
                  <span className="note__author">{author.word}</span>
                  <time className="note__time num" dateTime={new Date(n.at).toISOString()}>
                    {when(n.at)}
                  </time>
                </div>
                <p className="note__text">{n.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export const useNoteCount = (): number => useAppStore((s) => s.notes.length);
