/**
 * The first-run state on an empty sheet: a ghost room with its dimension, "Draw your space at
 * true size", Draw a room (R) as the one primary action, Draw walls (W), the Sunset Loft demo
 * and tracing a blueprint, and what an agent can do here.
 *
 * It shows only while there is nothing to look at: Plan view, no walls, rooms, openings,
 * furniture or blueprint, and the Select tool. Choosing a tool hands the sheet back to the
 * drawing (the state would sit under the pointer otherwise), and Esc brings it back. Its text
 * lets pointer events through to the sheet; only its controls take them.
 *
 * Every action is one that exists elsewhere: the rail's draw modes, the plan menu's demo
 * (with its Undo notice), and the blueprint upload the Properties panel offers.
 */

import { useId, useRef } from "react";
import { pageActions, releaseHeldAsset } from "../../model/store";
import { dispatch } from "../../model/commands";
import { seedLoft } from "../../model/seed";
import { putAsset } from "../../model/assets";
import { UNDERLAY } from "../../model/limits";
import { useAppStore } from "../useAppStore";
import { decodeUnderlay } from "../underlay";
import { Button, IconAgent, IconRoom, IconWall, ariaShortcut } from "../primitives";
import { useNotify } from "../shell/useNotify";
import { toolsFor } from "../shell/tools";
import "./firstRun.css";

/** The rail's shortcut for a draw tool, so the chips here never disagree with it. */
const shortcutOf = (id: string): string | undefined => toolsFor("2d").find((t) => t.id === id)?.shortcut;
const ROOM_KEY = shortcutOf("room");
const WALL_KEY = shortcutOf("wall");

/** Is the sheet empty enough for the first-run state? */
const useShowsFirstRun = (): boolean =>
  useAppStore(
    (s) =>
      s.editor.view === "2d" &&
      s.editor.drawMode === "select" &&
      s.model.walls.length + s.model.rooms.length + s.model.openings.length + s.model.items.length === 0 &&
      !s.model.underlay,
  );

/** The ghost room: a 4.00 × 2.60 m rectangle in the selection's colour, dimensioned. */
function GhostRoom() {
  return (
    <svg className="first-run__sketch" viewBox="0 0 220 150" aria-hidden="true" focusable="false">
      <rect className="first-run__ghost-fill" x="30" y="22" width="160" height="104" rx="1" />
      <rect className="first-run__ghost" x="30" y="22" width="160" height="104" rx="1" />
      <circle className="first-run__ghost-dot" cx="30" cy="22" r="4" />
      <circle className="first-run__ghost-dot" cx="190" cy="126" r="4" />
      <text className="first-run__ghost-text" x="110" y="78">
        4.00 × 2.60 m
      </text>
      <path className="first-run__dim-line" d="M24 12H196" />
      <path className="first-run__dim-tick" d="M26 16L34 8M186 16L194 8" />
      <text className="first-run__dim-text" x="110" y="8">
        4.00
      </text>
    </svg>
  );
}

/** What an agent can do here, true to whether one is connected and to the approval policy. */
function AgentCard() {
  const live = useAppStore((s) => s.webmcpStatus === "live");
  const asks = useAppStore((s) => s.requireApproval);
  return (
    <aside className="first-run__agent" aria-label="Plan with an agent">
      <IconAgent className="first-run__agent-icon" />
      <div>
        <strong className="first-run__agent-title">Plan with an agent</strong>
        <p className="first-run__agent-body">
          {live
            ? "Your agent is connected. Ask it to draw, furnish and check the plan with you."
            : "Open this page in a browser with WebMCP and your agent can draw, furnish and check the plan with you."}{" "}
          {asks
            ? "Anything destructive waits for your approval."
            : "Destructive changes run without asking; turn approval on in Properties."}
        </p>
      </div>
    </aside>
  );
}

export function FirstRun() {
  const shows = useShowsFirstRun();
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  if (!shows) return null;

  const loadDemo = () => {
    const r = dispatch({ type: "load_model", model: seedLoft() }, { actor: "human" });
    if (r.ok) notify({ body: "Sunset Loft demo loaded", undoable: true });
    else notify({ body: r.summary, type: "error" });
  };

  // the same path as the Properties panel's upload: checked, bounded and re-encoded before it
  // reaches the model (src/ui/underlay.ts), then referred to by asset id
  const traceBlueprint = async (file: File) => {
    let decoded;
    try {
      decoded = await decodeUnderlay(file);
    } catch (err) {
      notify({ body: `Blueprint not loaded: ${err instanceof Error ? err.message : String(err)}`, type: "error" });
      return;
    }
    const assetId = putAsset(decoded.image);
    const r = dispatch({ type: "set_underlay", underlay: { ...decoded.underlay, assetId } }, { actor: "human" });
    releaseHeldAsset(assetId);
    if (r.ok) notify({ body: "Blueprint loaded. Trace over it with Draw walls; set its opacity in Properties." });
    else notify({ body: `Blueprint not loaded: ${r.summary}`, type: "error" });
  };

  return (
    <section className="first-run" aria-labelledby={titleId}>
      <GhostRoom />
      <h2 id={titleId} className="first-run__title">
        Draw your space at true size
      </h2>
      <p className="first-run__body">
        Start with a room or a run of walls. Then furnish it from the library, check that everything fits, and walk through it in
        3D.
      </p>
      <div className="first-run__actions">
        <Button
          variant="primary"
          icon={IconRoom}
          shortcut={ROOM_KEY}
          aria-keyshortcuts={ROOM_KEY ? ariaShortcut(ROOM_KEY) : undefined}
          onClick={() => pageActions.setDrawMode("room")}>
          Draw a room
        </Button>
        <Button
          icon={IconWall}
          shortcut={WALL_KEY}
          aria-keyshortcuts={WALL_KEY ? ariaShortcut(WALL_KEY) : undefined}
          onClick={() => pageActions.setDrawMode("wall")}>
          Draw walls
        </Button>
      </div>
      <div className="first-run__links">
        <button type="button" className="first-run__link" onClick={loadDemo}>
          Open the Sunset Loft demo
        </button>
        <button type="button" className="first-run__link" onClick={() => fileRef.current?.click()}>
          Trace a blueprint
        </button>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept={UNDERLAY.acceptedTypes.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void traceBlueprint(file);
          }}
        />
      </div>
      <AgentCard />
    </section>
  );
}
