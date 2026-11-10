/**
 * "Note for your agent": the composer that is always somewhere on the page. It sits at the top
 * of the Notes tab, and at the foot of Activity whenever another tab is showing, so a note is
 * never more than a click away and never offered twice at once.
 *
 * A note the person writes is signed by the person: dispatch({ type: "leave_note" }) as the
 * human, the same command an agent's leave_note runs.
 */
import "./notes.css";
import { useId, useState } from "react";
import { dispatch } from "../../model/commands";
import { TEXT } from "../../model/limits";
import { Button, Kbd, TextArea } from "../primitives";
import { useShell } from "../shell/ShellContext";

/** Show how much room is left once a note is this far into its limit. */
const NEAR_LIMIT = 0.9;

export function NoteForm({ placement }: { placement: "notes" | "activity" }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const noteId = `${id}-note`;
  const trimmed = text.trim();
  const left = TEXT.note - text.length;

  const send = () => {
    if (!trimmed) return;
    const r = dispatch({ type: "leave_note", text: trimmed }, { actor: "human" });
    if (r.ok) {
      setText("");
      setError(null);
    } else setError(r.summary);
  };

  return (
    <form
      className={`note-form note-form--${placement}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="field__label note-form__label" htmlFor={`${id}-text`}>
        Note for your agent
      </label>
      <TextArea
        id={`${id}-text`}
        className="note-form__text"
        value={text}
        rows={placement === "notes" ? 3 : 2}
        maxLength={TEXT.note}
        placeholder="For example: make the bedroom bigger"
        aria-describedby={noteId}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            // this chord is the note's own while typing here: nothing page-wide hears it
            e.preventDefault();
            e.stopPropagation();
            send();
          }
        }}
      />
      <div className="note-form__foot">
        <p id={noteId} className={error ? "note-form__error" : "note-form__hint"} role={error ? "alert" : undefined}>
          {error ?? (
            <>
              <Kbd keys="mod+enter" /> adds it
              {text.length >= TEXT.note * NEAR_LIMIT ? <span className="num">, {left} characters left</span> : null}
            </>
          )}
        </p>
        <Button type="submit" size="sm" disabledReason={trimmed ? null : "Write the note first"}>
          Add note
        </Button>
      </div>
    </form>
  );
}

/**
 * SLOT: the foot of Activity, pinned under its scrolling body (and shown when Activity is
 * folded). Hidden while the Notes tab is showing, which has the same composer at its top.
 */
export function NoteComposer() {
  const { tab } = useShell();
  if (tab === "notes") return null;
  return <NoteForm placement="activity" />;
}
