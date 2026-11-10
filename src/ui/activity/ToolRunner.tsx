/**
 * Run a tool by hand: the exact tools the agent gets over WebMCP, through the same wrapper
 * (validation, resolution, the approval gate, the activity feed). It is the human pressing Run,
 * so the feed attributes each call to the human, and a note left from here is theirs. It works
 * without any agent runtime, so every tool can always be tried.
 */

import { useId, useState } from "react";
import { TOOLS, EXTEND_SELECTED_WALL, runToolManually } from "../../mcp/tools";
import { useAppStore } from "../useAppStore";
import { Button, Field, TextArea } from "../primitives";

/** A filled-in example for each tool that takes arguments; the rest start from {}. */
const EXAMPLES: Record<string, string> = {
  add_wall: '{ "ax": 0, "ay": 0, "bx": 4, "by": 0 }',
  add_door: '{ "wallId": "wall_s", "t": 0.5 }',
  add_window: '{ "wallId": "wall_n", "t": 0.5 }',
  add_room: '{ "x": 0, "y": 0, "w": 4, "h": 3, "label": "Studio", "floor": "oak" }',
  place_item: '{ "kind": "sofa", "x": 2, "y": 2, "rotation": 0 }',
  move_item: '{ "id": "sofa", "x": 3, "y": 3 }',
  set_camera: '{ "mode": "walk" }',
  set_3d_style: '{ "edges": true, "cutaway": true, "cutHeight": 1.2 }',
  set_plan_name: '{ "name": "My loft" }',
  measure: '{ "x1": 0, "y1": 0, "x2": 3, "y2": 4 }',
  leave_note: '{ "text": "Check the north wall measurement with the owner." }',
  extend_selected_wall: '{ "meters": 0.5, "end": "b" }',
};

const ALL_TOOLS = [...TOOLS, EXTEND_SELECTED_WALL];

/**
 * How a tool is marked in the list: what kind of tool it is, from its annotations, and for one
 * that removes things whether it waits for you, from the approval policy as it stands.
 */
const effectOf = (t: (typeof ALL_TOOLS)[number], asks: boolean): string =>
  t.annotations?.readOnlyHint ? "reads" : t.annotations?.destructiveHint ? (asks ? "removes, asks first" : "removes") : "edits";

interface Outcome {
  ok: boolean;
  text: string;
}

export function ToolRunner() {
  const [tool, setTool] = useState("get_model");
  const [args, setArgs] = useState("{}");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false);
  const asks = useAppStore((s) => s.requireApproval);
  const selectId = useId();
  const resultId = useId();
  // a destructive call from here waits on the plan like the agent's would
  const waiting = useAppStore((s) => running && s.approvals.some((a) => a.actor === "human" && a.tool === tool));

  const def = ALL_TOOLS.find((t) => t.name === tool);

  const run = async () => {
    setRunning(true);
    setOutcome(null);
    try {
      const input = args.trim() ? JSON.parse(args) : {};
      const r = await runToolManually(tool, input);
      setOutcome({ ok: r.ok, text: JSON.stringify(r, null, 2) });
    } catch (err) {
      setOutcome({ ok: false, text: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}. Fix the arguments and run it again.` });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="runner">
      <div className="field">
        <label className="field__label" htmlFor={selectId}>
          Tool
        </label>
        <div className="runner__row">
          <select
            id={selectId}
            className="input runner__select code"
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setArgs(EXAMPLES[e.target.value] ?? "{}");
              setOutcome(null);
            }}
          >
            {ALL_TOOLS.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({effectOf(t, asks)})
              </option>
            ))}
          </select>
          {/* stays the same element while it runs, so focus stays on it */}
          <Button size="md" variant="primary" onClick={running ? undefined : run} aria-disabled={running || undefined} aria-busy={running || undefined}>
            {waiting ? "Waiting for you" : running ? "Running" : "Run tool"}
          </Button>
        </div>
        {waiting ? <p className="field__help runner__waiting">Waiting for your approval on the plan. Review it there to finish this run.</p> : null}
        {def ? <p className="field__help runner__desc">{def.description}</p> : null}
      </div>
      <Field label="Arguments (JSON)" help="Validated against the tool’s schema before it runs.">
        {(ids) => <TextArea {...ids} className="code runner__args" value={args} onChange={(e) => setArgs(e.target.value)} rows={3} spellCheck={false} />}
      </Field>
      {outcome ? (
        <div className={`runner__result${outcome.ok ? "" : " runner__result--failed"}`} role="status" aria-labelledby={resultId}>
          <p id={resultId} className="runner__result-head">
            {outcome.ok ? "Result" : "Not done"}
          </p>
          <pre className="code runner__result-body">{outcome.text}</pre>
        </div>
      ) : null}
    </div>
  );
}
