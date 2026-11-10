/**
 * The "Developer tools" disclosure under Activity, closed by default: every tool the agent
 * sees, runnable by hand. The count is read off the tool list, never written by hand.
 */
import "./activity.css";
import { TOOLS, EXTEND_SELECTED_WALL } from "../../mcp/tools";
import { IconChevronRight, IconTool } from "../primitives";
import { ToolRunner } from "./ToolRunner";

export function DeveloperTools() {
  return (
    <details className="dev-tools">
      <summary className="dev-tools__summary">
        <IconTool size="sm" />
        Developer tools
        <IconChevronRight size="xs" className="dev-tools__chevron" />
      </summary>
      <div className="dev-tools__body">
        <p className="dev-tools__intro">
          The {TOOLS.length} tools your agent sees through WebMCP, plus <code className="code">{EXTEND_SELECTED_WALL.name}</code> while a
          wall is selected. A tool run here works exactly as when your agent calls it, and shows in Activity as yours.
        </p>
        <ToolRunner />
      </div>
    </details>
  );
}
