/**
 * A sentence the page wrote about the plan, with every entity it names linked by name. Clicking
 * a name selects that thing on the plan and shows it in Properties.
 */

import "./activity.css";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { segmentsOf } from "./entities";
import { FOCUS_ENTITY_EVENT, selectEntity } from "../inspector/entities";
import { bus } from "../../model/sceneBus";

export function Sentence({ text }: { text: string }) {
  const model = useAppStore((s) => s.model);
  const { setTab } = useShell();
  return (
    <>
      {segmentsOf(text, model).map((s, i) =>
        s.kind === "text" ? (
          s.text
        ) : s.kind === "code" ? (
          <code key={i} className="code">
            {s.text}
          </code>
        ) : (
          <button
            key={i}
            type="button"
            className="entity-link"
            onClick={() => {
              selectEntity(model, s.ref);
              bus.emit(FOCUS_ENTITY_EVENT, s.ref);
              setTab("properties");
            }}
          >
            {s.text}
          </button>
        ),
      )}
    </>
  );
}
