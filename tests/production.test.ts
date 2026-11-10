/**
 * The shipped code path. The suite normally runs as a development build, where the debugging
 * overrides and the test hook are meant to work; here the environment is switched to what a
 * production bundle sees, and the modules are loaded fresh under it, to prove that none of
 * those escape hatches survive into a build that ships.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN_ENV } from "../config/origins.js";
import { TEST_HOOK_ENV, TEST_HOOK_GLOBAL } from "../config/flags.js";
import { installTestHook } from "../src/testHook";
import { REQUEST_TAG, RESULT_TAG } from "../partner/protocol.js";

const STUDIO = "https://studio.example.com";
const PARTNER = "https://partner.example.net";
const ATTACKER = "https://attacker.example";

const asProduction = () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("PROD", true);
  vi.stubEnv(ORIGIN_ENV.studio, STUDIO);
  vi.stubEnv(ORIGIN_ENV.supplier, PARTNER);
};

let startUrl = "";
beforeEach(() => {
  startUrl = location.href;
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, "", startUrl);
});

describe("the test hook", () => {
  it("is not installed by a production build", () => {
    asProduction();
    const target = {};
    expect(installTestHook(target, import.meta.env, { store: {} })).toBe(false);
    expect(TEST_HOOK_GLOBAL in target).toBe(false);
  });

  it("is installed by a development build", () => {
    const target: Record<string, unknown> = {};
    const hook = { store: {} };
    expect(installTestHook(target, import.meta.env, hook)).toBe(true);
    expect(target[TEST_HOOK_GLOBAL]).toBe(hook);
  });

  it("is installed by a production build only on the explicit switch", () => {
    asProduction();
    vi.stubEnv(TEST_HOOK_ENV, "1");
    const target: Record<string, unknown> = {};
    expect(installTestHook(target, import.meta.env, {})).toBe(true);
  });

  it("refuses a switch value it cannot read rather than guessing", () => {
    asProduction();
    vi.stubEnv(TEST_HOOK_ENV, "yes please");
    expect(() => installTestHook({}, import.meta.env, {})).toThrow(/VITE_ALZA_TEST_HOOK/);
  });
});

describe("the studio's partner origin in a production build", () => {
  it("is the baked one, whatever ?supplier= says", async () => {
    asProduction();
    history.replaceState(null, "", `/?supplier=${encodeURIComponent(ATTACKER)}`);
    const { SUPPLIER_ORIGIN, SUPPLIER_URL, supplierFrameSrc } = await import("../src/mcp/supplier");
    expect(SUPPLIER_ORIGIN).toBe(PARTNER);
    expect(SUPPLIER_URL.startsWith(`${PARTNER}/`)).toBe(true);
    // and the shipped studio sends the partner no ?host= hint
    expect(new URL(supplierFrameSrc()).searchParams.has("host")).toBe(false);
  });

  it("can still be overridden in development, which is what the switch is for", async () => {
    history.replaceState(null, "", `/?supplier=${encodeURIComponent(ATTACKER)}`);
    const { SUPPLIER_ORIGIN } = await import("../src/mcp/supplier");
    expect(SUPPLIER_ORIGIN).toBe(ATTACKER);
  });
});

describe("the partner page in a production build", () => {
  const mountPartner = async (search: string) => {
    document.body.innerHTML = '<span id="pill"></span><ul id="list"></ul>';
    history.replaceState(null, "", `/partner/index.html${search}`);
    await import("../partner/supplier.js");
  };
  const ask = (origin: string) => {
    const source = { postMessage: vi.fn() };
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { [REQUEST_TAG]: true, id: "sup_1", tool: "nordika_list_products", args: {} },
        source: source as unknown as MessageEventSource,
      }),
    );
    return source.postMessage;
  };

  it("ignores ?host= and answers only the studio it was built for", async () => {
    asProduction();
    await mountPartner(`?host=${encodeURIComponent(ATTACKER)}`);
    expect(ask(ATTACKER)).not.toHaveBeenCalled();
    const reply = ask(STUDIO);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]).toEqual([expect.objectContaining({ [RESULT_TAG]: true, ok: true }), STUDIO]);
    expect(document.querySelectorAll("#list li").length).toBeGreaterThan(0);
  });
});
