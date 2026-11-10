/**
 * The cross-origin trust boundary, from both sides.
 *
 * The studio keeps only remote tools whose declared origin is exactly the partner's — a prefix
 * match let "https://partner.example.com.evil.net" through, and a tool with no origin at all
 * was kept too. The partner answers only the studio it was built for, fails closed when that
 * list is empty, and runs nothing until the request names one of its tools with an object of
 * arguments. Its shop window is built from text nodes, so a product name is never markup.
 */
import { describe, expect, it, vi } from "vitest";
import { discoverTools, type ModelContextLike, type RemoteTool } from "../src/mcp/registry";
import {
  ECHOED_TOOL_NAME_MAX_LENGTH,
  MESSAGE_ID_MAX_LENGTH,
  REQUEST_TAG,
  RESULT_TAG,
  createRequestHandler,
  parseRequest,
} from "../partner/protocol.js";
import { renderProducts } from "../partner/view.js";

const PARTNER = "https://partner.example.com";

const contextOffering = (tools: RemoteTool[]): ModelContextLike => ({ registerTool: () => undefined, getTools: () => tools });

describe("discoverTools", () => {
  it("drops a tool whose origin only starts with the partner's", async () => {
    const tools = await discoverTools(
      contextOffering([
        { name: "real", origin: PARTNER },
        { name: "suffix", origin: `${PARTNER}.evil.net` },
        { name: "port", origin: `${PARTNER}:8443` },
        { name: "scheme", origin: "http://partner.example.com" },
      ]),
      [PARTNER],
    );
    expect(tools.map((t) => t.name)).toEqual(["real"]);
  });

  it("drops a tool that declares no origin, or one that is not an origin", async () => {
    const tools = await discoverTools(
      contextOffering([
        { name: "none" },
        { name: "empty", origin: "" },
        { name: "opaque", origin: "null" },
        { name: "garbage", origin: "partner.example.com" },
        { name: "real", origin: PARTNER },
      ]),
      [PARTNER],
    );
    expect(tools.map((t) => t.name)).toEqual(["real"]);
  });

  it("compares normalised origins, so formatting differences still match", async () => {
    const tools = await discoverTools(
      contextOffering([
        { name: "slash", origin: `${PARTNER}/` },
        { name: "case", origin: "https://PARTNER.Example.com:443" },
      ]),
      ["https://partner.example.com/"],
    );
    expect(tools.map((t) => t.name)).toEqual(["slash", "case"]);
  });

  it("keeps nothing when no origin is allowed", async () => {
    expect(await discoverTools(contextOffering([{ name: "real", origin: PARTNER }]), [])).toEqual([]);
  });
});

describe("the partner's request parser", () => {
  const run = vi.fn((input: Record<string, unknown>) => ({ echoed: input }));
  const tools = new Map([["nordika_list_products", { name: "nordika_list_products", run }]]);
  const request = (over: Record<string, unknown> = {}) => ({ [REQUEST_TAG]: true, id: "sup_1", tool: "nordika_list_products", args: {}, ...over });

  it("accepts a well-formed request for a known tool", () => {
    expect(parseRequest(request({ args: { inStock: true } }), tools)).toMatchObject({ kind: "run", id: "sup_1", args: { inStock: true } });
    // no args at all is an empty object, as before
    expect(parseRequest(request({ args: undefined }), tools)).toMatchObject({ kind: "run", args: {} });
  });

  it.each([
    ["not an object", "hello"],
    ["null", null],
    ["no tag", { id: "sup_1", tool: "nordika_list_products" }],
    ["a tag that is not true", { [REQUEST_TAG]: "yes", id: "sup_1", tool: "nordika_list_products" }],
    ["no id", { [REQUEST_TAG]: true, tool: "nordika_list_products" }],
    ["a numeric id", { [REQUEST_TAG]: true, id: 1, tool: "nordika_list_products" }],
    ["an oversized id", { [REQUEST_TAG]: true, id: "x".repeat(MESSAGE_ID_MAX_LENGTH + 1), tool: "nordika_list_products" }],
  ])("ignores a message with %s", (_, data) => {
    expect(parseRequest(data, tools)).toEqual({ kind: "ignore" });
  });

  it("rejects an unknown tool, or one inherited from Object.prototype", () => {
    expect(parseRequest(request({ tool: "rm_rf" }), tools)).toMatchObject({ kind: "reject", id: "sup_1" });
    expect(parseRequest(request({ tool: "constructor" }), tools)).toMatchObject({ kind: "reject" });
    expect(parseRequest(request({ tool: 42 }), tools)).toMatchObject({ kind: "reject" });
  });

  it("echoes no more of an unknown tool name than its own limit allows", () => {
    const parsed = parseRequest(request({ tool: "x".repeat(ECHOED_TOOL_NAME_MAX_LENGTH * 4) }), tools);
    expect(parsed.kind).toBe("reject");
    if (parsed.kind === "reject") expect(parsed.error).toContain(`"${"x".repeat(ECHOED_TOOL_NAME_MAX_LENGTH)}"`);
  });

  it.each([
    ["an array", [1, 2]],
    ["a string", "inStock"],
    ["null", null],
    ["a number", 3],
  ])("rejects arguments that are %s", (_, args) => {
    expect(parseRequest(request({ args }), tools)).toMatchObject({ kind: "reject" });
  });
});

describe("the partner's message handler", () => {
  const STUDIO = "https://studio.example.com";
  const setup = (allowedOrigins: string[]) => {
    const run = vi.fn(() => ({ products: [] }));
    const handle = createRequestHandler({ allowedOrigins, tools: [{ name: "nordika_list_products", run }] });
    const source = { postMessage: vi.fn() };
    const send = (origin: string, data: unknown) => handle({ origin, data, source });
    return { run, source, send };
  };
  const request = (over: Record<string, unknown> = {}) => ({ [REQUEST_TAG]: true, id: "sup_7", tool: "nordika_list_products", ...over });

  it("answers the configured studio, to its own origin only", () => {
    const { run, source, send } = setup([STUDIO]);
    send(STUDIO, request({ args: { category: "living" } }));
    expect(run).toHaveBeenCalledWith({ category: "living" });
    expect(source.postMessage).toHaveBeenCalledWith({ [RESULT_TAG]: true, id: "sup_7", ok: true, result: { products: [] } }, STUDIO);
  });

  it("ignores every other origin, including a look-alike", () => {
    const { run, source, send } = setup([STUDIO]);
    send("https://attacker.example", request());
    send(`${STUDIO}.evil.net`, request());
    send("null", request());
    expect(run).not.toHaveBeenCalled();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("fails closed: an empty allowlist answers nobody", () => {
    const { run, source, send } = setup([]);
    send(STUDIO, request());
    send("https://attacker.example", request());
    expect(run).not.toHaveBeenCalled();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("answers a malformed request from the studio with an error and runs nothing", () => {
    const { run, source, send } = setup([STUDIO]);
    send(STUDIO, request({ tool: "nope" }));
    send(STUDIO, request({ args: ["x"] }));
    expect(run).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledTimes(2);
    for (const [reply] of source.postMessage.mock.calls) expect(reply).toMatchObject({ [RESULT_TAG]: true, ok: false });
  });

  it("turns a tool that throws into an error reply instead of a dead listener", () => {
    const handle = createRequestHandler({
      allowedOrigins: [STUDIO],
      tools: [
        {
          name: "nordika_list_products",
          run: () => {
            throw new Error("stock service down");
          },
        },
      ],
    });
    const source = { postMessage: vi.fn() };
    handle({ origin: STUDIO, data: request(), source });
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: "stock service down" }), STUDIO);
  });
});

describe("the partner's shop window", () => {
  const product = (over: Record<string, unknown> = {}) => ({
    sku: "NK-TST-01",
    name: "Test sofa",
    w: 2,
    d: 0.9,
    price: 500,
    color: "#8d8577",
    stock: 3,
    ...over,
  });

  it("renders a product's text as text, never as markup", () => {
    const list = document.createElement("ul");
    const name = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    renderProducts(list, [product({ name, sku: "<script>x</script>" })]);
    expect(list.querySelector("img, b, script")).toBeNull();
    expect(list.querySelector(".name")?.textContent).toBe(name);
    expect(list.querySelector(".dims")?.textContent).toContain("<script>x</script>");
  });

  it("shows stock, price and swatch, and replaces the previous rows", () => {
    const list = document.createElement("ul");
    renderProducts(list, [product(), product({ sku: "NK-OOS-01", stock: 0 })]);
    renderProducts(list, [product(), product({ sku: "NK-OOS-01", stock: 0 })]);
    expect(list.children).toHaveLength(2);
    const [inStock, out] = [...list.children];
    expect(inStock.querySelector(".dims")?.textContent).toBe("NK-TST-01 · 2.00 × 0.90 m · 3 in stock");
    expect(out.querySelector(".oos")?.textContent).toBe("out of stock");
    expect(inStock.querySelector(".price")?.textContent).toBe("€500");
    expect((inStock.querySelector(".swatch") as HTMLElement).style.background).not.toBe("");
  });
});
