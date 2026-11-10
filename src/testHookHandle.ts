/**
 * What the scripts' test hook hands them (see testHook.ts): the store, every action, and the
 * same wrapped tool pipeline WebMCP uses, run as the agent the scripts stand in for (so it is
 * logged to the activity feed as one). Built here rather than in main.tsx, which, like the
 * presentation layers, changes the plan only through dispatch().
 */

import { actions, store } from "./model/store";
import { runTool } from "./mcp/tools";

export const testHookHandle = () => ({
  store,
  actions,
  runTool: (name: string, input: unknown) => runTool(name, input, "agent"),
});
