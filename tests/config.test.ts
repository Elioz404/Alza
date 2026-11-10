/**
 * The origin configuration every piece of the exchange reads. A production build must fail on
 * a missing or malformed origin instead of shipping headers that name nobody, and the dev
 * fallbacks must be the ports the dev servers actually bind.
 */
import { describe, expect, it } from "vitest";
import {
  ORIGIN_ENV,
  OriginConfigError,
  PARTNER_DEV_ORIGIN,
  PARTNER_DEV_PORT,
  STUDIO_DEV_ORIGIN,
  STUDIO_DEV_PORT,
  canonicalOrigin,
  devOrigin,
  hostOriginsFor,
  isAllowedOrigin,
  parseOrigin,
  resolveOrigins,
  supplierOriginFor,
} from "../config/origins.js";
import { SUPPLIER_ORIGIN, SUPPLIER_URL, supplierFrameSrc } from "../src/mcp/supplier";

const prodEnv = {
  [ORIGIN_ENV.studio]: "https://studio.example.com",
  [ORIGIN_ENV.supplier]: "https://partner.example.net",
};

describe("parseOrigin", () => {
  it("accepts an https origin and returns it canonical", () => {
    expect(parseOrigin("https://partner.example.net", "x")).toBe("https://partner.example.net");
    expect(parseOrigin("https://partner.example.net/", "x")).toBe("https://partner.example.net");
    expect(parseOrigin("  https://Partner.Example.net:8443  ", "x")).toBe("https://partner.example.net:8443");
  });

  it("allows plain http only on loopback hosts", () => {
    expect(parseOrigin("http://localhost:5200", "x")).toBe("http://localhost:5200");
    expect(parseOrigin("http://127.0.0.1:5200", "x")).toBe("http://127.0.0.1:5200");
    expect(() => parseOrigin("http://partner.example.net", "x")).toThrow(/https/);
  });

  it.each([
    ["a path", "https://partner.example.net/partner"],
    ["a query", "https://partner.example.net/?a=1"],
    ["an empty query", "https://partner.example.net?"],
    ["a fragment", "https://partner.example.net/#top"],
    ["credentials", "https://user:pw@partner.example.net"],
    ["another scheme", "ftp://partner.example.net"],
    ["javascript", "javascript:alert(1)"],
    ["no scheme", "partner.example.net"],
    ["garbage", "not a url"],
  ])("rejects an origin with %s", (_, value) => {
    expect(() => parseOrigin(value, "VITE_SUPPLIER_ORIGIN")).toThrow(OriginConfigError);
  });

  it.each([undefined, null, "", "   ", 42])("rejects a missing value (%s)", (value) => {
    expect(() => parseOrigin(value, "VITE_SUPPLIER_ORIGIN")).toThrow(/VITE_SUPPLIER_ORIGIN is not set/);
  });
});

describe("resolveOrigins", () => {
  it("returns both validated origins for a production build", () => {
    expect(resolveOrigins(prodEnv, { production: true })).toEqual({
      studio: "https://studio.example.com",
      supplier: "https://partner.example.net",
    });
  });

  it.each([ORIGIN_ENV.studio, ORIGIN_ENV.supplier])("fails a production build without %s", (name) => {
    const env = { ...prodEnv, [name]: undefined };
    expect(() => resolveOrigins(env, { production: true })).toThrow(new RegExp(`${name} is required`));
  });

  it("fails a production build with a malformed origin", () => {
    const env = { ...prodEnv, [ORIGIN_ENV.supplier]: "https://partner.example.net/partner/index.html" };
    expect(() => resolveOrigins(env, { production: true })).toThrow(OriginConfigError);
  });

  it("falls back to the dev servers' ports outside a build", () => {
    expect(resolveOrigins({}, { production: false })).toEqual({ studio: STUDIO_DEV_ORIGIN, supplier: PARTNER_DEV_ORIGIN });
    expect(STUDIO_DEV_ORIGIN).toBe(`http://localhost:${STUDIO_DEV_PORT}`);
    expect(PARTNER_DEV_ORIGIN).toBe(`http://localhost:${PARTNER_DEV_PORT}`);
  });

  it("keeps the dev fallback on the loopback host the page was served from", () => {
    expect(resolveOrigins({}, { production: false, devHost: "127.0.0.1" }).supplier).toBe(devOrigin(PARTNER_DEV_PORT, "127.0.0.1"));
    // a non-loopback host never becomes an http dev origin
    expect(devOrigin(PARTNER_DEV_PORT, "evil.example")).toBe(PARTNER_DEV_ORIGIN);
  });

  it("still validates an origin that is set outside a build", () => {
    expect(() => resolveOrigins({ [ORIGIN_ENV.supplier]: "http://partner.example.net" }, { production: false })).toThrow(
      OriginConfigError,
    );
  });
});

describe("canonicalOrigin / isAllowedOrigin", () => {
  it("normalises an origin, or returns null for anything that is not one", () => {
    expect(canonicalOrigin("https://Partner.Example.net:443/")).toBe("https://partner.example.net");
    expect(canonicalOrigin("https://partner.example.net/some/page?x=1")).toBe("https://partner.example.net");
    expect(canonicalOrigin("null")).toBeNull();
    expect(canonicalOrigin("data:text/html,hi")).toBeNull();
    expect(canonicalOrigin("")).toBeNull();
    expect(canonicalOrigin(undefined)).toBeNull();
  });

  it("matches by equality, never by prefix", () => {
    const allowed = ["https://partner.example.com"];
    expect(isAllowedOrigin("https://partner.example.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://PARTNER.example.com:443", allowed)).toBe(true);
    expect(isAllowedOrigin("https://partner.example.com.evil.net", allowed)).toBe(false);
    expect(isAllowedOrigin("https://partner.example.com:8443", allowed)).toBe(false);
    expect(isAllowedOrigin("http://partner.example.com", allowed)).toBe(false);
    expect(isAllowedOrigin("null", allowed)).toBe(false);
  });

  it("allows nothing when the list is empty", () => {
    expect(isAllowedOrigin("https://anyone.example", [])).toBe(false);
    expect(isAllowedOrigin(STUDIO_DEV_ORIGIN, [])).toBe(false);
  });
});

describe("supplierOriginFor", () => {
  it("ignores ?supplier= outside a development build", () => {
    expect(supplierOriginFor({ override: "https://attacker.example", configured: PARTNER_DEV_ORIGIN, dev: false })).toBe(
      PARTNER_DEV_ORIGIN,
    );
  });

  it("lets a well-formed ?supplier= override the configured origin in development only", () => {
    const dev = (override: string | null) => supplierOriginFor({ override, configured: PARTNER_DEV_ORIGIN, dev: true });
    expect(dev(null)).toBe(PARTNER_DEV_ORIGIN);
    expect(dev("https://other.example/")).toBe("https://other.example");
    expect(dev("https://other.example/path")).toBe(PARTNER_DEV_ORIGIN);
    expect(dev("javascript:alert(1)")).toBe(PARTNER_DEV_ORIGIN);
  });
});

describe("hostOriginsFor", () => {
  const embedded = {
    configured: "https://studio.example.com",
    host: "https://attacker.example",
    referrer: "https://attacker.example/frame.html",
    hostname: "localhost",
  };

  it("trusts only the configured studio in a shipped build, whatever the embedder says", () => {
    expect(hostOriginsFor({ ...embedded, dev: false })).toEqual(["https://studio.example.com"]);
  });

  it("is empty — and so allows nobody — when the configured studio is not an origin", () => {
    const list = hostOriginsFor({ ...embedded, configured: "not an origin", dev: false });
    expect(list).toEqual([]);
    expect(isAllowedOrigin("https://attacker.example", list)).toBe(false);
  });

  it("lets ?host=, the referrer and the local studio extend the list in development", () => {
    expect(hostOriginsFor({ ...embedded, dev: true })).toEqual([
      "https://studio.example.com",
      "https://attacker.example",
      STUDIO_DEV_ORIGIN,
    ]);
  });

  it("still drops values that are not origins in development", () => {
    expect(
      hostOriginsFor({
        configured: "https://studio.example.com",
        host: "not an origin",
        referrer: "https://studio.example.com/some/page?x=1",
        hostname: "partner.example.net",
        dev: true,
      }),
    ).toEqual(["https://studio.example.com"]);
  });
});

describe("the studio's partner origin", () => {
  it("comes from the config module: the dev partner under test, no subdomain guessing", () => {
    expect(SUPPLIER_ORIGIN).toBe(PARTNER_DEV_ORIGIN);
    expect(SUPPLIER_URL).toBe(`${PARTNER_DEV_ORIGIN}/partner/index.html`);
  });

  it("frames the partner with a ?host= hint only in development", () => {
    expect(supplierFrameSrc({ dev: false })).toBe(SUPPLIER_URL);
    expect(supplierFrameSrc({ dev: false, display: true })).toBe(`${SUPPLIER_URL}?display=1`);
    const dev = new URL(supplierFrameSrc({ dev: true, display: true }));
    expect(dev.searchParams.get("host")).toBe(location.origin);
    expect(dev.searchParams.get("display")).toBe("1");
  });
});
