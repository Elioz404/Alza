/**
 * The local static server. A malformed percent-escape used to throw out of the async handler
 * and take the whole process down; containment is a path.relative check, so escapes that
 * decode to a parent directory are refused however they are spelled.
 */
import { describe, expect, it, vi } from "vitest";
import { createStaticHandler, resolveRequestFile, type ResponseLike } from "../scripts/static-server.mjs";
import { headerRules, headersFor as hostHeadersFor } from "../config/headers.js";
import { PARTNER_DEV_ORIGIN, STUDIO_DEV_ORIGIN } from "../config/origins.js";

// The partner's source folder stands in for dist/: a real directory with an index.html. Relative
// paths resolve against the working directory, which is the repo root under vitest.
const ROOT = "partner";

const fakeResponse = () => {
  const res: ResponseLike & { headers: Record<string, string>; body?: unknown; ended: boolean } = {
    statusCode: 200,
    headersSent: false,
    headers: {},
    ended: false,
    setHeader(name, value) {
      res.headers[name] = value;
    },
    end(body) {
      res.body = body;
      res.ended = true;
    },
  };
  return res;
};

describe("resolveRequestFile", () => {
  it("answers a malformed percent-escape with 400", () => {
    expect(resolveRequestFile(ROOT, "/%E0%A4%A")).toMatchObject({ status: 400 });
    expect(resolveRequestFile(ROOT, "/%")).toMatchObject({ status: 400 });
    expect(resolveRequestFile(ROOT, "/a%00b")).toMatchObject({ status: 400 });
  });

  it("refuses an escaped climb out of the root", () => {
    expect(resolveRequestFile(ROOT, "/..%2Fpackage.json")).toMatchObject({ status: 403 });
    expect(resolveRequestFile(ROOT, "/assets/..%2F..%2F..%2Fpackage.json")).toMatchObject({ status: 403 });
  });

  it("keeps a file whose name merely starts with two dots", () => {
    expect(resolveRequestFile(ROOT, "/..hidden")).toMatchObject({ status: 200 });
  });

  it("serves a directory's index page and reports the decoded request path", () => {
    const target = resolveRequestFile(ROOT, "/?display=1");
    expect(target).toMatchObject({ status: 200, path: "/" });
    if (target.status === 200) expect(target.file.endsWith("index.html")).toBe(true);
    expect(resolveRequestFile(ROOT, "/view%2Ejs")).toMatchObject({ status: 200, path: "/view.js" });
  });
});

describe("createStaticHandler", () => {
  const headersFor = vi.fn((path: string) => ({ "X-Test-Path": path }));
  const handler = createStaticHandler({ root: ROOT, headersFor });

  it("survives a malformed request and keeps serving", async () => {
    const bad = fakeResponse();
    await expect(handler({ url: "/%E0%A4%A" }, bad)).resolves.toBeUndefined();
    expect(bad.statusCode).toBe(400);
    expect(bad.ended).toBe(true);

    const good = fakeResponse();
    await handler({ url: "/index.html" }, good);
    expect(good.statusCode).toBe(200);
    expect(good.headers["Content-Type"]).toMatch(/^text\/html/);
    expect(good.headers["X-Test-Path"]).toBe("/index.html");
  });

  it("answers 403 for a climb out of the root and 404 for a missing file", async () => {
    const out = fakeResponse();
    await handler({ url: "/..%2Fpackage.json" }, out);
    expect(out.statusCode).toBe(403);
    const missing = fakeResponse();
    await handler({ url: "/nope.js" }, missing);
    expect(missing.statusCode).toBe(404);
  });

  it.each([
    ["/%E0%A4%A", 400],
    ["/..%2Fpackage.json", 403],
    ["/nope.js", 404],
    ["/index.html", 200],
  ])("answers %s (%i) with the site's headers, as a host does", async (url, status) => {
    const rules = headerRules({ studio: STUDIO_DEV_ORIGIN, supplier: PARTNER_DEV_ORIGIN }, "partner");
    const site = createStaticHandler({ root: ROOT, headersFor: (path) => hostHeadersFor(rules, path) });
    const res = fakeResponse();
    await site({ url }, res);
    expect(res.statusCode).toBe(status);
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Content-Security-Policy"]).toMatch(/frame-ancestors /);
  });

  it("turns an unexpected failure into a 500 for that request alone", async () => {
    const broken = createStaticHandler({
      root: ROOT,
      headersFor: () => {
        throw new Error("boom");
      },
    });
    const res = fakeResponse();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(broken({ url: "/index.html" }, res)).resolves.toBeUndefined();
    error.mockRestore();
    expect(res.statusCode).toBe(500);
  });
});
