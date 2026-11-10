// the theme first: its stylesheet declares the cascade layers every other stylesheet uses
import "./ui/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { store } from "./model/store";
import { dispatch } from "./model/commands";
import { seedLoft } from "./model/seed";
import { bootstrapWebMCP } from "./mcp/bootstrap";
import { installTestHook } from "./testHook";
import { testHookHandle } from "./testHookHandle";
import { prefetchWhenIdle } from "./ui/deferred";
import { MOTION } from "./ui/theme/tokens";

// First paint: the audited demo loft (0 issues) so the app opens with something beautiful.
// The page loads it itself, and there is nothing before it to undo back to.
if (store.getState().model.walls.length === 0) {
  dispatch({ type: "load_model", model: seedLoft() }, { actor: "system", as: "seed", undoable: false });
}

bootstrapWebMCP();

// The scripts' test hook. Development builds only, unless a local build opts in — see testHook.ts.
installTestHook(window, import.meta.env, testHookHandle());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// First paint needs only the shell, the plan and the plan's Properties. Once that is rendered,
// the rest of the studio's code (the other tabs, the menus, the inspectors, Activity's details)
// is fetched while the browser is idle, so the first click on any of them finds it here. An idle
// callback, not an animation frame: a tab opened in the background paints no frames, and its
// code would otherwise wait until it is shown.
prefetchWhenIdle(window, MOTION.prefetchTimeoutMs);
