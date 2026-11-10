/**
 * Discovering the partner's tools. The studio used to add a new `toolchange` listener every
 * time it (re)discovered — and it rediscovered on every failed call — and waited a fixed 1.2 s
 * for the partner frame when the first look came back empty. Now the listener is added once per
 * runtime, and the second look waits for the partner to say it is ready (or for the runtime's
 * `toolchange`), bounded by READY_TIMEOUT_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READY_TAG, READY_TIMEOUT_MS, announceReady, isReadyMessage } from "../partner/protocol.js";
import type { ModelContextLike, RemoteTool } from "../src/mcp/registry";

type Supplier = typeof import("../src/mcp/supplier");
type Store = typeof import("../src/model/store");

/** A fresh copy of the supplier module (and the store it reports to) for each test. */
async function load(): Promise<{ supplier: Supplier; store: Store["store"] }> {
  vi.resetModules();
  const supplier = await import("../src/mcp/supplier");
  const { store } = await import("../src/model/store");
  return { supplier, store };
}

/** A runtime whose partner tools appear when the test says so, and which counts its listeners. */
function runtime(origin: () => string) {
  const listeners: ((e: unknown) => void)[] = [];
  let tools: RemoteTool[] = [];
  const mc: ModelContextLike = {
    registerTool: () => undefined,
    getTools: () => tools,
    executeTool: vi.fn(async () => {
      throw new Error("the frame went away");
    }),
    addEventListener: (type, fn) => {
      if (type === "toolchange") listeners.push(fn);
    },
  };
  return {
    mc,
    listeners,
    publish() {
      tools = [
        { name: "nordika_list_products", origin: origin() },
        { name: "nordika_get_product", origin: origin() },
      ];
    },
    toolchange() {
      for (const fn of listeners) fn({});
    },
  };
}

/** Settle pending promise callbacks without moving the (fake) clock. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connectSupplier", () => {
  it("listens to toolchange once, however often it rediscovers", async () => {
    const { supplier } = await load();
    const rt = runtime(() => supplier.SUPPLIER_ORIGIN);
    rt.publish();
    await supplier.connectSupplier(rt.mc);
    await supplier.connectSupplier(rt.mc);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // every failed call re-discovers before falling back; none of them adds a listener
    for (let i = 0; i < 5; i++) await supplier.listProducts().catch(() => undefined);
    expect(rt.listeners).toHaveLength(1);
    expect(rt.mc.executeTool).toHaveBeenCalled();
  });

  it("takes the partner's tools as soon as the partner says it is ready, not after a fixed delay", async () => {
    const { supplier, store } = await load();
    const rt = runtime(() => supplier.SUPPLIER_ORIGIN);
    let done = false;
    void supplier.connectSupplier(rt.mc).then(() => (done = true));
    await settle();
    expect(done).toBe(false); // nothing yet: it is waiting
    rt.publish();
    window.dispatchEvent(new MessageEvent("message", { origin: supplier.SUPPLIER_ORIGIN, data: { [READY_TAG]: true } }));
    await settle();
    expect(done).toBe(true);
    expect(store.getState().supplierTools).toEqual(["nordika_list_products", "nordika_get_product"]);
  });

  it("is woken by the runtime's toolchange as well", async () => {
    const { supplier, store } = await load();
    const rt = runtime(() => supplier.SUPPLIER_ORIGIN);
    let done = false;
    void supplier.connectSupplier(rt.mc).then(() => (done = true));
    await settle();
    rt.publish();
    rt.toolchange();
    await settle();
    expect(done).toBe(true);
    expect(store.getState().supplierTools).toHaveLength(2);
  });

  it("ignores a ready message from any other origin, and gives up waiting after READY_TIMEOUT_MS", async () => {
    const { supplier, store } = await load();
    const rt = runtime(() => supplier.SUPPLIER_ORIGIN);
    let done = false;
    void supplier.connectSupplier(rt.mc).then(() => (done = true));
    await settle();
    window.dispatchEvent(new MessageEvent("message", { origin: "https://elsewhere.example", data: { [READY_TAG]: true } }));
    await settle();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(done).toBe(true);
    expect(store.getState().supplierTools).toEqual([]);
  });

  it("looks again when the ready message lands while the first look is still pending", async () => {
    const { supplier, store } = await load();
    const origin = supplier.SUPPLIER_ORIGIN;
    // a runtime that answers asynchronously, with no toolchange to fall back on: the first
    // answer is the snapshot from before the partner registered, delivered after it did
    let answerFirst: (tools: RemoteTool[]) => void = () => undefined;
    let calls = 0;
    const published: RemoteTool[] = [
      { name: "nordika_list_products", origin },
      { name: "nordika_get_product", origin },
    ];
    const mc: ModelContextLike = {
      registerTool: () => undefined,
      getTools: () => (++calls === 1 ? new Promise<RemoteTool[]>((resolve) => (answerFirst = resolve)) : published),
    };
    let done = false;
    void supplier.connectSupplier(mc).then(() => (done = true));
    await settle();
    window.dispatchEvent(new MessageEvent("message", { origin, data: { [READY_TAG]: true } }));
    answerFirst([]);
    await settle();
    expect(done).toBe(true); // no wait for a signal that has already come
    expect(calls).toBe(2);
    expect(store.getState().supplierTools).toEqual(["nordika_list_products", "nordika_get_product"]);
  });

  it("does not wait at all once the partner has already said it is ready", async () => {
    const { supplier } = await load();
    window.dispatchEvent(new MessageEvent("message", { origin: supplier.SUPPLIER_ORIGIN, data: { [READY_TAG]: true } }));
    const rt = runtime(() => supplier.SUPPLIER_ORIGIN);
    let done = false;
    void supplier.connectSupplier(rt.mc).then(() => (done = true));
    await settle();
    expect(done).toBe(true);
  });
});

describe("the partner's ready signal", () => {
  it("is posted to the parent once per trusted studio origin", () => {
    const postMessage = vi.fn();
    const win = { self: {}, parent: { postMessage } };
    announceReady(win, ["https://studio.example", "http://localhost:5199"]);
    expect(postMessage.mock.calls).toEqual([
      [{ [READY_TAG]: true }, "https://studio.example"],
      [{ [READY_TAG]: true }, "http://localhost:5199"],
    ]);
    expect(isReadyMessage(postMessage.mock.calls[0][0])).toBe(true);
  });

  it("is not posted by a page that is not embedded, nor to an empty list", () => {
    const postMessage = vi.fn();
    const self = { postMessage };
    announceReady({ self, parent: self }, ["https://studio.example"]);
    announceReady({ self: {}, parent: { postMessage } }, []);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("is recognised only in its exact shape", () => {
    for (const data of [null, "ready", { [READY_TAG]: "true" }, [true], { ready: true }]) expect(isReadyMessage(data)).toBe(false);
  });
});
