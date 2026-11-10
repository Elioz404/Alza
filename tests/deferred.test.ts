/**
 * What the first paint does not need is fetched after it (src/ui/deferred.tsx): once, kept once
 * it arrives, fetched again after a failure only when something asks, all of it prefetched when
 * the browser is idle. A deferred region shows a placeholder until its code is here and offers to
 * try again when it could not come; a lazy layer closes itself when its code could not come; a
 * menu's stand-in trigger hands over what was done to it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, useSyncExternalStore, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { deferred, loadable, overlayPlaceholder, preloadDeferred, prefetchWhenIdle, regionPlaceholder, registeredLoadables } from "../src/ui/deferred";
import { connectNoticeHost, notify, type Notice } from "../src/ui/shell/useNotify";
import { MOTION } from "../src/ui/theme/tokens";
import { lazyLayer, type LayerProps } from "../src/ui/LazyLayer";
import { createHandoff, receiveHandoff, standInTriggerProps } from "../src/ui/shell/menuTriggers";

let host: HTMLDivElement;
let root: Root;

/** Let a resolved or rejected import reach React, and React re-render. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

/** A module loader that resolves or rejects when the test says so. */
function controlled<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { load, resolve: (value: T) => resolve(value), reject: (error: Error) => reject(error) };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const Real = ({ word }: { word: string }) => createElement("p", { className: "real" }, word);

describe("a loadable", () => {
  it("is fetched once however many ask, and kept once it arrives", async () => {
    const code = loadable("once", vi.fn(async () => "here"));
    const [a, b] = await Promise.all([code.load(), code.load()]);
    expect([a, b]).toEqual(["here", "here"]);
    await code.load();
    expect(code.state()).toEqual({ value: "here", failed: false });
    expect(registeredLoadables()).toContain("once");
  });

  it("forgets a failed fetch, so the next request asks afresh", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("back");
    const code = loadable("flaky", load);
    await expect(code.load()).rejects.toThrow("offline");
    expect(code.state()).toEqual({ value: null, failed: true });
    await expect(code.load()).resolves.toBe("back");
    expect(load).toHaveBeenCalledTimes(2);
    expect(code.state().failed).toBe(false);
  });

  it("the prefetch fetches every one and never rejects", async () => {
    const ok = vi.fn(async () => 1);
    loadable("prefetched", ok);
    loadable("prefetch fails", () => Promise.reject(new Error("gone")));
    await expect(preloadDeferred()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("waits for the browser to be idle, with a deadline, and falls back to a timeout", () => {
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();
    prefetchWhenIdle({ requestIdleCallback, setTimeout }, 1234);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 1234 });
    expect(setTimeout).not.toHaveBeenCalled();
    prefetchWhenIdle({ setTimeout }, 1234);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});

describe("a deferred component", () => {
  it("shows its placeholder until the code is here, then the real thing with the same props", async () => {
    const { load, resolve } = controlled<ComponentType<{ word: string }>>();
    const Lazy = deferred("a region", load, regionPlaceholder);
    await act(async () => root.render(createElement(Lazy, { word: "hello" })));
    expect(host.querySelector(".deferred")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector(".real")).toBeNull();
    resolve(Real);
    await settle();
    expect(host.querySelector(".deferred")).toBeNull();
    expect(host.querySelector(".real")?.textContent).toBe("hello");
  });

  it("renders at once, with no placeholder, once its code was prefetched", async () => {
    const Lazy = deferred("a prefetched region", async () => Real, () => createElement("i", { className: "stand-in" }));
    await Lazy.preload();
    await act(async () => root.render(createElement(Lazy, { word: "now" })));
    expect(host.querySelector(".stand-in")).toBeNull();
    expect(host.querySelector(".real")?.textContent).toBe("now");
  });

  it("says when its code could not come, and Try again fetches it afresh", async () => {
    const load = vi.fn<() => Promise<ComponentType<{ word: string }>>>().mockRejectedValueOnce(new Error("stale chunk")).mockResolvedValue(Real);
    const Lazy = deferred("a failing region", load, regionPlaceholder);
    await act(async () => root.render(createElement(Lazy, { word: "again" })));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(host.querySelector(".deferred")?.getAttribute("aria-busy")).toBe("false");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".real")?.textContent).toBe("again");
  });
});

describe("a deferred overlay", () => {
  /** What the overlay has to show, set by the test: falsy for nothing, a new value for each new reason. */
  let need: unknown = null;
  const listeners = new Set<() => void>();
  const setNeed = (value: unknown) => {
    need = value;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const useNeeded = () => useSyncExternalStore(subscribe, () => need);
  beforeEach(() => {
    need = null;
  });
  const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? null;

  it("shows nothing while there is nothing to show, even when its code could not come", async () => {
    const load = vi.fn<() => Promise<ComponentType<{ word: string }>>>().mockRejectedValue(new Error("stale chunk"));
    const Lazy = deferred("a quiet overlay", load, overlayPlaceholder("The card", useNeeded));
    await act(async () => root.render(createElement(Lazy, { word: "card" })));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe("");
  });

  it("asks again for code that failed as soon as it has something to show, and shows it", async () => {
    const load = vi.fn<() => Promise<ComponentType<{ word: string }>>>().mockRejectedValueOnce(new Error("stale chunk")).mockResolvedValue(Real);
    const Lazy = deferred("a returning overlay", load, overlayPlaceholder("The card", useNeeded));
    await act(async () => root.render(createElement(Lazy, { word: "card" })));
    await settle();
    expect(host.querySelector(".real")).toBeNull();
    await act(async () => setNeed("request 1"));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".real")?.textContent).toBe("card");
  });

  it("says when it still could not come, asks again on the next reason, and Try again asks too", async () => {
    const load = vi
      .fn<() => Promise<ComponentType<{ word: string }>>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Real);
    const Lazy = deferred("a stubborn overlay", load, overlayPlaceholder("The card", useNeeded));
    await act(async () => root.render(createElement(Lazy, { word: "card" })));
    await settle();
    await act(async () => setNeed("request 1"));
    await settle();
    // one more ask for the new reason, and no loop when that one fails as well
    expect(load).toHaveBeenCalledTimes(2);
    expect(alertText()).toContain("The card could not be loaded.");
    await act(async () => setNeed("request 1, reviewed"));
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
    expect(alertText()).toContain("could not be loaded");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    await settle();
    expect(load).toHaveBeenCalledTimes(4);
    expect(alertText()).toBeNull();
    expect(host.querySelector(".real")?.textContent).toBe("card");
  });
});

describe("notices asked for before their host is here", () => {
  afterEach(() => vi.useRealTimers());

  it("wait for the host, and only as long as they would have stayed on screen", () => {
    vi.useFakeTimers();
    notify({ body: "Plan cleared", undoable: true });
    vi.advanceTimersByTime(MOTION.undoOfferMs);
    notify({ body: "Demo loaded", undoable: true });
    vi.advanceTimersByTime(MOTION.undoOfferMs - 1);
    notify({ body: "Blueprint not loaded", type: "error" });
    const shown: Notice[] = [];
    const disconnect = connectNoticeHost((notice) => shown.push(notice));
    // the first one's Undo would by now undo something else: it is gone, not offered late
    expect(shown.map((n) => n.body)).toEqual(["Demo loaded", "Blueprint not loaded"]);
    notify({ body: "now" });
    expect(shown.map((n) => n.body)).toContain("now");
    disconnect();
  });
});

describe("a lazy layer", () => {
  const Dialog = ({ isOpen }: LayerProps) => createElement("dialog", { open: isOpen, className: "layer" });

  it("mounts nothing until it first opens", async () => {
    const load = vi.fn(async () => Dialog);
    const Layer = lazyLayer("a quiet layer", load);
    await act(async () => root.render(createElement(Layer, { isOpen: false, onOpenChange: () => {} })));
    expect(host.querySelector(".layer")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Layer, { isOpen: true, onOpenChange: () => {} })));
    await settle();
    expect(host.querySelector(".layer")?.hasAttribute("open")).toBe(true);
    await act(async () => root.render(createElement(Layer, { isOpen: false, onOpenChange: () => {} })));
    // once opened it stays mounted, so its closing runs as written
    expect(host.querySelector(".layer")).not.toBeNull();
  });

  it("reports itself closed when its code cannot come, and the next opening asks again", async () => {
    const load = vi.fn<() => Promise<ComponentType<LayerProps>>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Dialog);
    const Layer = lazyLayer("a failing layer", load);
    // the control that opens it, which follows what the layer reports
    const onOpenChange = vi.fn();
    function Opener() {
      const [isOpen, setOpen] = useState(true);
      return createElement(
        "div",
        null,
        createElement("button", { className: "opener", onClick: () => setOpen(true) }, "Open"),
        createElement(Layer, {
          isOpen,
          onOpenChange: (next: boolean) => {
            onOpenChange(next);
            setOpen(next);
          },
        }),
      );
    }
    await act(async () => root.render(createElement(Opener)));
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(host.querySelector(".layer")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => (host.querySelector(".opener") as HTMLButtonElement).click());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".layer")?.hasAttribute("open")).toBe(true);
  });
});

describe("a menu's stand-in trigger", () => {
  it("is a closed menu button that remembers a press, and the menu opens from it as it arrives", () => {
    const handoff = createHandoff();
    const props = standInTriggerProps(handoff);
    expect(props).toMatchObject({ "aria-haspopup": "menu", "aria-expanded": false });
    props.onClick?.({} as never);
    const trigger = document.createElement("button");
    const click = vi.spyOn(trigger, "click");
    receiveHandoff(handoff, trigger);
    expect(click).toHaveBeenCalledTimes(1);
    // read and cleared: a later mount does not open it again
    receiveHandoff(handoff, trigger);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("opens on an arrow key, and leaves other keys alone", () => {
    const handoff = createHandoff();
    const props = standInTriggerProps(handoff);
    const key = (k: string) => ({ key: k, preventDefault: vi.fn() });
    const tab = key("Tab");
    props.onKeyDown?.(tab as never);
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(handoff.take().open).toBe(false);
    const down = key("ArrowDown");
    props.onKeyDown?.(down as never);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(handoff.take().open).toBe(true);
  });

  it("gives focus back to the menu's trigger when the stand-in had it", () => {
    const handoff = createHandoff();
    standInTriggerProps(handoff).onFocus?.({} as never);
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    (document.activeElement as HTMLElement | null)?.blur();
    receiveHandoff(handoff, trigger);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
