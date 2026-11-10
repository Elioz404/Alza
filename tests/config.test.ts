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
  devOrigin,
  hostOriginsFor,
  parseOrigin,
  resolveOrigins,
  supplierOriginFor,
} from "../config/origins.js";
import { SUPPLIER_ORIGIN, SUPPLIER_URL } from "../src/mcp/supplier";

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

describe("supplierOriginFor / hostOriginsFor", () => {
  it("only lets a well-formed ?supplier= override the configured origin", () => {
    expect(supplierOriginFor(null, PARTNER_DEV_ORIGIN)).toBe(PARTNER_DEV_ORIGIN);
    expect(supplierOriginFor("https://other.example/", PARTNER_DEV_ORIGIN)).toBe("https://other.example");
    expect(supplierOriginFor("https://other.example/path", PARTNER_DEV_ORIGIN)).toBe(PARTNER_DEV_ORIGIN);
    expect(supplierOriginFor("javascript:alert(1)", PARTNER_DEV_ORIGIN)).toBe(PARTNER_DEV_ORIGIN);
  });

  it("builds the partner's host list from valid origins only", () => {
    expect(
      hostOriginsFor({
        configured: "https://studio.example.com",
        host: "not an origin",
        referrer: "https://studio.example.com/some/page?x=1",
        hostname: "partner.example.net",
      }),
    ).toEqual(["https://studio.example.com"]);
  });

  it("adds the dev studio when the partner is served from loopback", () => {
    expect(hostOriginsFor({ configured: STUDIO_DEV_ORIGIN, host: null, referrer: "", hostname: "localhost" })).toEqual([
      STUDIO_DEV_ORIGIN,
    ]);
  });
});

describe("the studio's partner origin", () => {
  it("comes from the config module: the dev partner under test, no subdomain guessing", () => {
    expect(SUPPLIER_ORIGIN).toBe(PARTNER_DEV_ORIGIN);
    expect(SUPPLIER_URL).toBe(`${PARTNER_DEV_ORIGIN}/partner/index.html`);
  });
});
