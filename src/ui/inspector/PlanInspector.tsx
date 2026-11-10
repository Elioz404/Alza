/**
 * Properties with nothing selected: the plan itself. Its name (the field the plan menu's Rename
 * focuses), what it holds and the list of it (each thing selectable from the keyboard), the
 * blueprint to trace, the approval policy, the demo, and clearing it behind a confirmation.
 */

import { useRef, useState } from "react";
import { pageActions, releaseHeldAsset } from "../../model/store";
import { dispatch } from "../../model/commands";
import { seedLoft } from "../../model/seed";
import { putAsset } from "../../model/assets";
import { OPACITY, TEXT, UNDERLAY } from "../../model/limits";
import { decodeUnderlay } from "../underlay";
import { useGesture } from "../useGesture";
import { useAppStore } from "../useAppStore";
import { useNotify } from "../shell/useNotify";
import { PLAN_NAME_FIELD_ID } from "../shell/ids";
import { Button, Field, IconImage, IconPlan, IconTrash, Section, Switch } from "../primitives";
import { EntityHead, PlanTextField, Stats } from "./parts";
import { PlanElements } from "./PlanElements";
import { lazyLayer } from "../LazyLayer";

/** The Clear-plan confirmation, fetched the first time it opens. */
const ClearPlanDialog = lazyLayer("the Clear-plan confirmation", () => import("./ClearPlanDialog").then((m) => m.ClearPlanDialog));
import { metres, squareMetres, roomArea } from "./entities";
import { APPROVAL_POLICY_SECTION_ID, approvalPolicySentence, GATED_TOOLS, POLICY_SWITCH_LABEL } from "./policy";

/** The file types the blueprint chooser offers, in words: "PNG, JPEG, WebP, GIF or BMP". */
const ACCEPTED_NAMES = UNDERLAY.acceptedTypes.map((t) => t.replace("image/", "").toUpperCase().replace("WEBP", "WebP"));
const ACCEPTED_WORDS = `${ACCEPTED_NAMES.slice(0, -1).join(", ")} or ${ACCEPTED_NAMES.at(-1)}`;
const MAX_MB = Math.round(UNDERLAY.maxFileBytes / (1024 * 1024));
/** The opacity slider moves in twentieths. */
const OPACITY_STEP = 0.05;

function PlanFigures() {
  const walls = useAppStore((s) => s.model.walls.length);
  const rooms = useAppStore((s) => s.model.rooms);
  const items = useAppStore((s) => s.model.items.length);
  const doors = useAppStore((s) => s.model.openings.filter((o) => o.kind === "door").length);
  const windows = useAppStore((s) => s.model.openings.filter((o) => o.kind === "window").length);
  const area = rooms.reduce((a, r) => a + roomArea(r), 0);
  return (
    <Stats
      items={[
        { label: "Walls", value: walls },
        { label: "Rooms", value: rooms.length },
        { label: "Items", value: items },
        { label: "Doors", value: doors },
        { label: "Windows", value: windows },
        { label: "Floor area", value: area > 0 ? squareMetres(area) : "0 m²" },
      ]}
    />
  );
}

function Blueprint() {
  const underlay = useAppStore((s) => s.model.underlay);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const opacityEdit = useGesture();

  const upload = async (file: File) => {
    // checked, bounded and re-encoded to a small JPEG before it reaches the model (see underlay.ts)
    setError(null);
    setReading(true);
    let decoded;
    try {
      decoded = await decodeUnderlay(file);
    } catch (err) {
      // the file never became an underlay, so there is no change to dispatch: say so here
      setError(`Blueprint not loaded: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      setReading(false);
    }
    // The image goes to the asset store and the plan refers to it by id. Once the change is
    // made the plan keeps it (and its undo history, after); a refused one lets it go at once.
    const assetId = putAsset(decoded.image);
    const r = dispatch({ type: "set_underlay", underlay: { ...decoded.underlay, assetId } }, { actor: "human" });
    releaseHeldAsset(assetId);
    if (!r.ok) setError(`Blueprint not loaded: ${r.summary}`);
  };

  return (
    <Section title="Blueprint underlay">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={UNDERLAY.acceptedTypes.join(",")}
        aria-label="Blueprint image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // let the same file be chosen again after a refusal
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div className="insp-stack">
        <Button
          icon={IconImage}
          isBlock
          aria-busy={reading || undefined}
          disabledReason={reading ? "Reading the image" : null}
          onClick={() => fileRef.current?.click()}
        >
          {reading ? "Reading the image…" : underlay ? "Replace the image…" : "Choose an image to trace…"}
        </Button>
        {error ? (
          <p className="insp-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="insp-help">
            {ACCEPTED_WORDS}, up to {MAX_MB} MB. Trace walls over it, then remove it when you are done.
          </p>
        )}
      </div>
      {underlay ? (
        <>
          <Field label="Opacity" labelEnd={<span className="insp-value num">{Math.round(underlay.opacity * 100)}%</span>}>
            {(ids) => (
              <input
                {...ids}
                type="range"
                className="insp-range"
                min={OPACITY.min}
                max={OPACITY.max}
                step={OPACITY_STEP}
                value={underlay.opacity}
                onChange={(e) => {
                  // one gesture per slide: the plan follows every step, the feed and undo get
                  // one entry, and a refusal is reported there rather than swallowed
                  opacityEdit.update({ type: "set_underlay", underlay: { ...underlay, opacity: Number(e.target.value) } });
                }}
                onPointerUp={opacityEdit.end}
                onKeyUp={opacityEdit.end}
                onBlur={opacityEdit.end}
              />
            )}
          </Field>
          <div className="insp-stack">
            <p className="insp-help">
              The image is <span className="num">{metres(underlay.w)}</span> wide on the plan. To set its true scale, share the same image with
              your agent and tell it one real length printed on the drawing.
            </p>
            <div className="insp-row">
              <Button size="sm" variant="danger-quiet" icon={IconTrash} onClick={() => dispatch({ type: "set_underlay", underlay: null }, { actor: "human" })}>
                Remove the image
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Section>
  );
}

function ApprovalSwitch() {
  const on = useAppStore((s) => s.requireApproval);
  return (
    <Section className="insp-policy" id={APPROVAL_POLICY_SECTION_ID}>
      <Switch
        label={POLICY_SWITCH_LABEL}
        value={on}
        onChange={(checked) => pageActions.setRequireApproval(checked)}
        description={approvalPolicySentence(on)}
        labelPosition="start"
        labelSpacing="spread"
      />
      <p className="insp-policy__tools">
        <span className="insp-policy__tools-label">Tools it covers</span>{" "}
        <span className="code">{GATED_TOOLS.map((t) => t.name).join(", ")}</span>
      </p>
    </Section>
  );
}

function PlanActions() {
  const isEmpty = useAppStore((s) => s.model.walls.length + s.model.rooms.length + s.model.items.length + s.model.openings.length === 0);
  const notify = useNotify();
  const [confirming, setConfirming] = useState(false);

  const loadDemo = () => {
    const r = dispatch({ type: "load_model", model: seedLoft() }, { actor: "human" });
    if (r.ok) notify({ body: "Sunset Loft demo loaded", undoable: true });
    else notify({ body: r.summary, type: "error" });
  };
  const clear = () => {
    setConfirming(false);
    const r = dispatch({ type: "clear_model" }, { actor: "human" });
    if (r.ok) notify({ body: "Plan cleared", undoable: true });
    else notify({ body: r.summary, type: "error" });
  };

  return (
    <Section title="Start over">
      <div className="insp-stack">
        <div className="insp-row">
          <Button size="sm" onClick={loadDemo}>
            Load Sunset Loft demo
          </Button>
          <Button size="sm" variant="danger-quiet" icon={IconTrash} disabledReason={isEmpty ? "The plan is already empty" : null} onClick={() => setConfirming(true)}>
            Clear plan…
          </Button>
        </div>
        <p className="insp-help">The demo replaces this plan. Undo brings either one back.</p>
      </div>
      <ClearPlanDialog isOpen={confirming} onOpenChange={setConfirming} onAction={clear} />
    </Section>
  );
}

export function PlanInspector() {
  const name = useAppStore((s) => s.model.name);
  return (
    <div className="insp">
      <div className="insp-body">
        <EntityHead icon={IconPlan} tone="neutral" title="Plan" sub="Nothing selected. These settings apply to the whole plan." />
        <Section>
          <PlanTextField
            label="Plan name"
            id={PLAN_NAME_FIELD_ID}
            value={name}
            maxLength={TEXT.planName}
            toCommand={(text) => ({ type: "set_plan_name", name: text })}
          />
          <PlanFigures />
        </Section>
        <PlanElements />
        <Blueprint />
        <ApprovalSwitch />
        <PlanActions />
      </div>
    </div>
  );
}
