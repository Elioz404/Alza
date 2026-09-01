/**
 * WebMCP bootstrap — registers the tool set, drives the DYNAMIC tool lifecycle
 * (`extend_selected_wall` exists only while the human has a wall selected: it is registered
 * with its own AbortController and retired by aborting that signal, which is how the spec
 * unregisters a tool and what makes the runtime fire `toolchange`), and updates the
 * "Site tools live" pill.
 */

import { store, actions, logActivity } from "../model/store";
import { getModelContext, registerAll, registerTool, type ModelContextLike } from "./registry";
import { TOOLS, EXTEND_SELECTED_WALL } from "./tools";
import { connectSupplier } from "./supplier";

let started = false;

/** Aborted only if the whole session tears down; keeps every static tool registered. */
const sessionTools = new AbortController();

export function bootstrapWebMCP(): void {
  if (started) return;
  started = true;

  const mc: ModelContextLike | null = getModelContext();
  if (!mc) {
    // Progressive enhancement: without a WebMCP runtime the app is still a full product,
    // and the built-in ToolRunner executes the same tools through the same pipeline.
    actions.setWebmcpStatus("off");
    logActivity("system", "webmcp", "No WebMCP runtime detected — manual ToolRunner available.", true);
    void connectSupplier(null);
    return;
  }

  const count = registerAll(mc, TOOLS, sessionTools.signal);
  actions.setWebmcpStatus("live");
  logActivity("system", "webmcp", `Site tools live: ${count}/${TOOLS.length} registered.`, true);

  // ---- dynamic tool lifecycle ----
  // One AbortController per registration. Aborting it is the unregistration.
  let dynamic: AbortController | null = null;
  const syncDynamicTool = (selectedWallId: string | null) => {
    if (selectedWallId && !dynamic) {
      dynamic = new AbortController();
      if (registerTool(mc, EXTEND_SELECTED_WALL, dynamic.signal)) {
        logActivity("system", "toolchange", `Dynamic tool published: ${EXTEND_SELECTED_WALL.name} (wall ${selectedWallId} selected).`, true);
      } else {
        dynamic = null;
      }
    } else if (!selectedWallId && dynamic) {
      dynamic.abort(); // ← the spec's unregistration path
      dynamic = null;
      // pre-AbortSignal runtimes: fall back to the imperative call if they offer one
      try {
        mc.unregisterTool?.(EXTEND_SELECTED_WALL.name);
      } catch {
        /* nothing to do — the signal already retired it on conforming runtimes */
      }
      logActivity("system", "toolchange", `Dynamic tool withdrawn: ${EXTEND_SELECTED_WALL.name} (selection cleared).`, true);
    }
  };
  syncDynamicTool(store.getState().editor.selectedWallId);
  store.subscribe((s, prev) => {
    if (s.editor.selectedWallId !== prev.editor.selectedWallId) {
      syncDynamicTool(s.editor.selectedWallId);
    }
  });

  // spec toolchange event — logged once (some runtimes fire it per registration)
  let toolchangeSeen = false;
  mc.addEventListener?.("toolchange", () => {
    if (toolchangeSeen) return;
    toolchangeSeen = true;
    logActivity("system", "toolchange", "Runtime acknowledged the tool list.", true);
  });

  // ---- cross-origin: discover the partner catalogue's own tools ----
  void connectSupplier(mc);
}
