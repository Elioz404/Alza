/**
 * What the scripts' test hook hands them (see testHook.ts): the store, every action, and the
 * same wrapped tool pipeline WebMCP uses, run as the agent the scripts stand in for (so it is
 * logged to the activity feed as one). Built here rather than in main.tsx, which, like the
 * presentation layers, changes the plan only through dispatch().
 */

import { actions, releaseHeldAsset, store } from "./model/store";
import { runTool } from "./mcp/tools";
import { blobFromDataUrl, putAsset } from "./model/assets";
import { sceneProbe, type SceneLocatable } from "./model/sceneBus";
import { presence } from "./model/presence";

export const testHookHandle = () => ({
  store,
  /** the shared session's presence: who is on the plan, what the agent touches (model/presence.ts) */
  presence,
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
  /** Where a wall, room, piece or stair shows on the 3D canvas (CSS pixels from its corner), or null. */
  sceneLocate: (type: SceneLocatable, id: string) => sceneProbe.locate?.(type, id) ?? null,
  /** Put the 3D camera at `position` looking at `target`, as a drag would; false when no view is mounted. */
  sceneLook: (position: [number, number, number], target: [number, number, number]) => {
    if (!sceneProbe.look) return false;
    sceneProbe.look(position, target);
    return true;
  },
});
