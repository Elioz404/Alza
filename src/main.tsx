import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { store, actions, logActivity } from "./model/store";
import { seedLoft } from "./model/seed";
import { bootstrapWebMCP } from "./mcp/bootstrap";
import "./styles.css";

// First paint: the audited demo loft (0 issues) so the app opens with something beautiful.
if (store.getState().model.walls.length === 0) {
  actions.loadModel(seedLoft());
  logActivity("system", "seed", "Sunset Loft demo loaded — draw over it, or ask your agent to recreate your own plan.");
}

bootstrapWebMCP();

// Debug/testing hook (also handy for judges poking at the console).
// runTool executes the same wrapped tool pipeline WebMCP uses (logged to the activity feed).
import { runToolManually } from "./mcp/tools";
(window as unknown as { __alza: unknown }).__alza = { store, actions, runTool: runToolManually };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
