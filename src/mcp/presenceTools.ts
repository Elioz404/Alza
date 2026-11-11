/**
 * The shared session's tools: get_presence (what the person is doing right now, and who else is
 * on the plan) and point_at (show the person something). Both read the presence store
 * (model/presence.ts); neither changes the plan. What they answer is fetched the first time an
 * agent asks (presenceAnswers.ts); the descriptions are here, as every tool's is at registration.
 */

import { z } from "zod";
import { ref, text } from "../model/schemas";
import { SESSION } from "../model/limits";
import { defineTool, type ToolDef } from "./registry";

const answers = () => import("./presenceAnswers");

/**
 * How every tool that changes the plan behaves while the person is editing what it touches
 * (registry.ts, personEditingRefusal): said once, where an agent learns what the person holds.
 */
const CONFLICT_RULE =
  'While the person edits an entity (a drag, a nudge, typing), a call that would change it is refused with `conflict.code` "person_editing", `conflict.entityIds` and `conflict.retryAfterMs`: nothing changes; wait, then call again.';

export const PRESENCE_TOOLS: ToolDef[] = [
  defineTool({
    name: "get_presence",
    title: "What the person is doing right now",
    description:
      `What the person is doing now: their level and view (plan or 3D, camera), selection, what they are editing (\`editing\` ids), their pointer and what it is over, the plan area on their screen (\`viewport\`) — plan metres — and in 3D where they look from (\`look\`). If they switched sharing off, \`sharing\` is false and pointer, hover, viewport and look are null. \`tabs\`: other tabs of this browser on the plan. ${CONFLICT_RULE}`,
    input: z.strictObject({}),
    annotations: { readOnlyHint: true },
    execute: async () => (await answers()).presenceForAgent(),
  }),
  defineTool({
    name: "point_at",
    title: "Point at something for the person",
    description:
      `Show the person something on the plan: a marker on a wall, door, window, room, piece or stair (\`target\`, an id or a name) with your short \`message\`, for ${SESSION.pointMs / 1000} seconds, on the plan and in 3D. It changes nothing: use it to ask "this one?" before an edit.`,
    input: z.strictObject({ target: ref, message: text(SESSION.pointMessage) }),
    execute: async (i) => (await answers()).pointAt(i),
  }),
];
