/**
 * What the scripts' test hook hands them (see testHook.ts): the store, every action, and the
 * same wrapped tool pipeline WebMCP uses, run as the agent the scripts stand in for (so it is
 * logged to the activity feed as one). Built here rather than in main.tsx, which, like the
 * presentation layers, changes the plan only through dispatch().
 */

import { actions, releaseHeldAsset, store } from "./model/store";
import { runTool } from "./mcp/tools";
import { blobFromDataUrl, putAsset } from "./model/assets";
import { sceneProbe } from "./model/sceneBus";

export const testHookHandle = () => ({
  store,
  actions,
  runTool: (name: string, input: unknown) => runTool(name, input, "agent"),
  /**
   * Hold an image given as a data: URL and return the asset id an underlay refers to it by.
   * The hook holds it until releaseImage; from then on the plans that name it keep it.
   */
  putImage: (dataUrl: string) => putAsset(blobFromDataUrl(dataUrl)),
  releaseImage: (assetId: string) => releaseHeldAsset(assetId),
  /** What the mounted 3D view holds on the GPU and how often it has drawn, or null when none is mounted. */
  sceneStats: () => sceneProbe.read?.() ?? null,
});
