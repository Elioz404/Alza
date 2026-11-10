/**
 * The postMessage transport to the partner has one owner. SupplierBridge registers the frame
 * window it mounted and unregisters it when it goes; the transport talks to that window and to
 * nothing it finds by searching the page's DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPLIER_ORIGIN, listProducts, registerSupplierFrame } from "../src/mcp/supplier";

/** A partner window that answers every call with an empty listing, from the partner's origin. */
function partnerWindow() {
  const postMessage = vi.fn<(msg: { id: string }, targetOrigin: string) => boolean>((msg) =>
    window.dispatchEvent(
      new MessageEvent("message", { origin: SUPPLIER_ORIGIN, data: { __alzaSupplierResult: true, id: msg.id, ok: true, result: { products: [] } } }),
    ),
  );
  return { win: { postMessage } as unknown as Window, postMessage };
}

const releases: (() => void)[] = [];
afterEach(() => {
  while (releases.length) releases.pop()!();
  vi.restoreAllMocks();
});

describe("the supplier transport", () => {
  it("fails plainly when no frame is registered, even if partner-looking frames are on the page", async () => {
    // The transport used to look frames up by CSS class and post to whatever it found. The test
    // DOM loads no frames, so the page "has" one wherever the transport might look for it.
    const stray = partnerWindow();
    const frameEl = { contentWindow: stray.win } as unknown as HTMLIFrameElement;
    vi.spyOn(document, "querySelector").mockReturnValue(frameEl);
    vi.spyOn(document, "querySelectorAll").mockReturnValue([frameEl] as unknown as NodeListOf<Element>);
    vi.spyOn(document, "getElementsByClassName").mockReturnValue([frameEl] as unknown as HTMLCollectionOf<Element>);
    await expect(listProducts()).rejects.toThrow(/not loaded/);
    expect(stray.postMessage).not.toHaveBeenCalled();
  });

  it("talks to the window its owner registered", async () => {
    const { win, postMessage } = partnerWindow();
    releases.push(registerSupplierFrame(win));
    const r = await listProducts();
    expect(r.transport).toBe("postmessage");
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][1]).toBe(SUPPLIER_ORIGIN);
  });

  it("stops talking to it once the owner unregisters", async () => {
    const { win, postMessage } = partnerWindow();
    registerSupplierFrame(win)();
    await expect(listProducts()).rejects.toThrow(/not loaded/);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("a stale unregister does not take the transport away from a newer frame", async () => {
    const old = partnerWindow();
    const fresh = partnerWindow();
    const releaseOld = registerSupplierFrame(old.win);
    releases.push(registerSupplierFrame(fresh.win));
    releaseOld();
    await listProducts();
    expect(fresh.postMessage).toHaveBeenCalledTimes(1);
    expect(old.postMessage).not.toHaveBeenCalled();
  });
});
