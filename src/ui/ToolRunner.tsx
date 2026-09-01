/**
 * Manual ToolRunner — executes the exact same tools the WebMCP agent gets, through the
 * same wrapper (approval gate + activity log included).
 * Guarantees judges can always run the tools, even without a WebMCP runtime.
 */

import { useState } from "react";
import { TOOLS, EXTEND_SELECTED_WALL, runToolManually } from "../mcp/tools";

const EXAMPLES: Record<string, string> = {
  add_wall: '{ "ax": 0, "ay": 0, "bx": 4, "by": 0 }',
  add_door: '{ "wallId": "wall_s", "t": 0.5 }',
  add_window: '{ "wallId": "wall_n", "t": 0.5 }',
  add_room: '{ "x": 0, "y": 0, "w": 4, "h": 3, "label": "Studio", "floor": "oak" }',
  place_item: '{ "kind": "sofa", "x": 2, "y": 2, "rotation": 0 }',
  move_item: '{ "id": "sofa", "x": 3, "y": 3 }',
  set_camera: '{ "mode": "walk" }',
  set_plan_name: '{ "name": "My loft" }',
  measure: '{ "x1": 0, "y1": 0, "x2": 3, "y2": 4 }',
  leave_note: '{ "text": "Check the north wall measurement with the owner." }',
  extend_selected_wall: '{ "meters": 0.5, "end": "b" }',
};

export function ToolRunner() {
  const [tool, setTool] = useState("get_model");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const all = [...TOOLS, EXTEND_SELECTED_WALL];
  const def = all.find((t) => t.name === tool);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const input = args.trim() ? JSON.parse(args) : {};
      const r = await runToolManually(tool, input);
      setResult(JSON.stringify(r, null, 2));
    } catch (err) {
      setResult(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="toolrunner">
      <div className="toolrunner-row">
        <select
          value={tool}
          onChange={(e) => {
            setTool(e.target.value);
            setArgs(EXAMPLES[e.target.value] ?? "{}");
            setResult(null);
          }}
        >
          {all.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
              {t.annotations?.readOnlyHint ? " ·read" : t.annotations?.destructiveHint ? " ·destructive" : ""}
            </option>
          ))}
        </select>
        <button onClick={run} disabled={running} className="primary">
          {running ? "Running…" : "Run tool"}
        </button>
      </div>
      {def && <p className="toolrunner-desc">{def.description}</p>}
      <textarea
        value={args}
        onChange={(e) => setArgs(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder='{ "arg": "value" }'
      />
      {result && <pre className="toolrunner-result">{result}</pre>}
    </div>
  );
}
