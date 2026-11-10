/**
 * The underlay's image lives in the asset store, not in the plan. The undo history keeps the
 * plans it replaced by reference, so what it holds no longer grows with the size of the image;
 * get_model no longer sends the agent the pixels; and the image is released once neither the
 * plan nor any undo step refers to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNDO_DEPTH, releaseHeldAsset, store } from "../src/model/store";
import { dispatch } from "../src/model/commands";
import { assetCount, assetUrl, blobFromDataUrl, hasAsset, putAsset } from "../src/model/assets";
import { runTool } from "../src/mcp/tools";
import { seedLoft } from "../src/model/seed";
import type { Underlay } from "../src/model/types";
import { heldImage, resetStore } from "./support/store";

const human = { actor: "human" } as const;
const state = () => store.getState();

/** Upload the way the sidebar does: hold the image, dispatch the change, let go. */
function upload(bytes: number, over: Partial<Underlay> = {}): Underlay {
  const assetId = heldImage(bytes);
  const underlay: Underlay = { assetId, opacity: 0.5, x: 0, y: 0, w: 8, h: 6, pw: 1600, ph: 1200, ...over };
  dispatch({ type: "set_underlay", underlay }, human);
  releaseHeldAsset(assetId);
  return underlay;
}

/** What the undo history would cost to keep as data: the plans it refers to, serialised. */
const historyChars = () => JSON.stringify(state().undoStack).length;

beforeEach(resetStore);
afterEach(() => vi.restoreAllMocks());

describe("the undo history and the image", () => {
  /** An upload followed by sixty renames, as the plan-name field used to make them. */
  function renamesAfterUpload(bytes: number): number {
    resetStore();
    upload(bytes);
    for (let i = 0; i < 60; i++) dispatch({ type: "set_plan_name", name: `Plan ${i}` }, human);
    return historyChars();
  }

  it("does not grow with the size of the image", () => {
    const small = renamesAfterUpload(1024);
    const large = renamesAfterUpload(4 * 1024 * 1024);
    // 4 MB more image is the same history, give or take an id's digits
    expect(Math.abs(large - small)).toBeLessThan(200);
    expect(large).toBeLessThan(64 * 1024);
  });

  it("refers to the one underlay object instead of copying it into every step", () => {
    const underlay = upload(1024);
    for (let i = 0; i < 10; i++) dispatch({ type: "set_plan_name", name: `Plan ${i}` }, human);
    const held = state().undoStack.slice(1).map((step) => step.model.underlay);
    expect(held).toHaveLength(10);
    for (const u of held) expect(u).toBe(underlay);
    expect(state().model.underlay).toBe(underlay);
  });

  it("still brings the underlay back on undo, with its image", () => {
    const underlay = upload(1024);
    dispatch({ type: "set_underlay", underlay: null }, human);
    dispatch({ type: "clear_model" }, human);
    dispatch({ type: "undo" }, human);
    dispatch({ type: "undo" }, human);
    expect(state().model.underlay).toBe(underlay);
    expect(hasAsset(underlay.assetId)).toBe(true);
    expect(assetUrl(underlay.assetId)).toMatch(/^blob:/);
  });

  it("keeps the image while an undo step can still bring it back", () => {
    const underlay = upload(1024);
    dispatch({ type: "set_underlay", underlay: null }, human);
    for (let i = 0; i < UNDO_DEPTH - 2; i++) dispatch({ type: "set_plan_name", name: `Plan ${i}` }, human);
    expect(state().undoStack.some((s) => s.model.underlay === underlay)).toBe(true);
    expect(hasAsset(underlay.assetId)).toBe(true);
  });

  it("releases the image, and revokes its URL, once it falls out of the history", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const underlay = upload(1024);
    const url = assetUrl(underlay.assetId);
    dispatch({ type: "set_underlay", underlay: null }, human);
    for (let i = 0; i < UNDO_DEPTH; i++) dispatch({ type: "set_plan_name", name: `Plan ${i}` }, human);
    expect(state().undoStack.some((s) => s.model.underlay === underlay)).toBe(false);
    expect(hasAsset(underlay.assetId)).toBe(false);
    expect(assetUrl(underlay.assetId)).toBeNull();
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it("releases an image whose change was refused as soon as the uploader lets go", () => {
    const before = assetCount();
    const refused = upload(1024, { opacity: 2 });
    expect(state().model.underlay).toBeNull();
    expect(hasAsset(refused.assetId)).toBe(false);
    expect(assetCount()).toBe(before);
  });

  it("keeps an image its uploader still holds, whatever else changes meanwhile", () => {
    const id = heldImage(16);
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    dispatch({ type: "undo" }, human);
    expect(hasAsset(id)).toBe(true);
    releaseHeldAsset(id);
    expect(hasAsset(id)).toBe(false);
  });
});

describe("the plan names its image, it does not carry it", () => {
  it("get_model answers with the underlay's id and pixel size, never its bytes", async () => {
    const underlay = upload(2 * 1024 * 1024);
    const r = await runTool("get_model", {}, "agent");
    expect(r.ok).toBe(true);
    const sent = (r.model as { underlay: Record<string, unknown> }).underlay;
    expect(sent).toEqual(underlay);
    expect(sent).not.toHaveProperty("dataUrl");
    expect(JSON.stringify(r).length).toBeLessThan(8 * 1024);
  });

  it("a loaded plan keeps its underlay only if this page holds the image", () => {
    const underlay = upload(1024);
    const saved = JSON.parse(JSON.stringify(state().model));
    dispatch({ type: "load_model", model: saved }, human);
    expect(state().model.underlay).toEqual(underlay);
    dispatch({ type: "load_model", model: { ...seedLoft(), underlay: { ...underlay, assetId: "asset_from_elsewhere" } } }, human);
    expect(state().model.underlay).toBeNull();
  });
});

describe("blobFromDataUrl", () => {
  it("decodes base64 and plain data URLs to typed bytes, without a fetch", async () => {
    const png = blobFromDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(png.type).toBe("image/png");
    expect([...new Uint8Array(await png.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const text = blobFromDataUrl("data:text/plain,a%20b");
    expect(await text.text()).toBe("a b");
    expect(() => blobFromDataUrl("https://example.com/x.png")).toThrow(/data:/);
  });

  it("a put image is held until it is let go", () => {
    const id = putAsset(blobFromDataUrl("data:image/png;base64,iVBORw0KGgo="));
    dispatch({ type: "add_wall", ax: 0, ay: 0, bx: 4, by: 0 }, human);
    expect(hasAsset(id)).toBe(true);
    releaseHeldAsset(id);
    expect(hasAsset(id)).toBe(false);
  });
});
