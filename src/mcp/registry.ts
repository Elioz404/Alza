/**
 * WebMCP registration layer.
 *
 * Three things happen here that the rest of the app depends on:
 *  1. Tools are registered against the spec surface — `registerTool(descriptor, { signal, exposedTo })`
 *     — and are retired by aborting that signal, which is how WebMCP unregisters tools.
 *  2. Every execution is logged to the on-page activity feed, so agent actuation is visible
 *     (the spec's "tools run visibly on the page").
 *  3. Destructive tools pass through a human approval gate before they touch the model.
 *
 * And one thing happens before all of them: the input is validated against the tool's zod
 * schema — the same schema its published `inputSchema` is derived from — so what an agent
 * is told it may send and what the page accepts cannot drift apart.
 */

import { z } from "zod";
import { actions, store, logActivity, type ActionResult } from "../model/store";
import { describeIssues } from "../model/schemas";
import { isAllowedOrigin } from "../../config/origins.js";

/** A JSON Schema object, as published in a tool descriptor. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  /** short human-readable label; WebMCP tool descriptors carry a `title` alongside `name` */
  title?: string;
  description: string;
  /**
   * The single source of truth for the tool's arguments: validated in executeWrapped, and
   * turned into the descriptor's JSON `inputSchema` by inputSchemaOf.
   */
  input: S;
  annotations?: {
    readOnlyHint?: boolean;
    /**
     * MCP defines this hint; WebMCP's ToolAnnotations does not yet (it carries only
     * readOnlyHint and untrustedContentHint). So it rides on our own descriptor and is
     * enforced below in executeWrapped — the approval gate never depends on a browser
     * propagating it. If browsers ever mediate confirmation themselves, they will need
     * some equivalent signal for which tools are destructive.
     */
    destructiveHint?: boolean;
    untrustedContentHint?: boolean;
  };
  /** secure origins this tool is shared with (WebMCP cross-origin exposure) */
  exposedTo?: string[];
  /** plain-language sentence shown to the human when the approval gate stops this call */
  confirm?(input: z.output<S>): string;
  /** runs with input that has already passed `input`, typed accordingly */
  execute(input: z.output<S>): ActionResult | Promise<ActionResult>;
}

/**
 * Declare a tool. Only a helper for inference: `execute` and `confirm` get the parsed type of
 * `input`, so a tool body never casts its arguments.
 */
export const defineTool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> => def;

/** Recursively give every object schema a `required` list, as descriptors always had. */
function withRequiredLists(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withRequiredLists);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = withRequiredLists(v);
  if (out.type === "object" && out.properties && !out.required) out.required = [];
  return out;
}

const schemaCache = new WeakMap<z.ZodType, JsonSchema>();

/**
 * The JSON Schema an agent sees for a tool, derived from its zod schema. The `$schema`
 * dialect marker is dropped (descriptors never carried it) and empty `required` lists are
 * kept, so the published shape is what it was when these were written by hand.
 */
export function inputSchemaOf(def: Pick<ToolDef, "input">): JsonSchema {
  const cached = schemaCache.get(def.input);
  if (cached) return cached;
  const derived = { ...(z.toJSONSchema(def.input, { io: "input" }) as JsonSchema) };
  delete derived.$schema;
  const published = withRequiredLists(derived) as JsonSchema;
  schemaCache.set(def.input, published);
  return published;
}

/** Shape of a tool descriptor handed back by `getTools()`. */
export interface RemoteTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  origin?: string;
}

export interface RegisterOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface ModelContextLike {
  registerTool: (tool: Record<string, unknown>, options?: RegisterOptions) => unknown;
  /** legacy escape hatch: pre-AbortSignal runtimes only */
  unregisterTool?: (name: string) => void;
  getTools?: (options?: { fromOrigins?: string[] }) => Promise<RemoteTool[]> | RemoteTool[];
  executeTool?: (tool: RemoteTool, args: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
  addEventListener?: (type: string, listener: (e: unknown) => void) => void;
}

/** The WebMCP surface, if the runtime provides it (ChatGPT in-app browser / Chrome 149+ flag). */
export function getModelContext(): ModelContextLike | null {
  const d = document as unknown as { modelContext?: ModelContextLike };
  if (d.modelContext) return d.modelContext;
  const n = navigator as unknown as { modelContext?: ModelContextLike };
  if (n.modelContext) return n.modelContext;
  return null;
}

/** Tool results travel as text: agents read JSON fine, and every runtime accepts a string. */
const asText = (result: ActionResult): string => JSON.stringify(result);

/**
 * Run a tool the way WebMCP would: validation, approval gate, execution, activity log, text
 * result. The on-page ToolRunner uses this too, so the fallback path behaves identically.
 *
 * Validation comes first: input that does not match the schema is answered with the list of
 * problems and never reaches the gate (no prompt for a call that could not run) or execute.
 */
export async function executeWrapped<S extends z.ZodType>(
  def: ToolDef<S>,
  rawInput: unknown,
  ctx: { signal?: AbortSignal } = {},
): Promise<ActionResult> {
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    // bounded (VALIDATION_REPORT): this text is echoed to the agent and kept in the feed
    const issues = describeIssues(parsed.error);
    const invalid: ActionResult = {
      ok: false,
      summary: `Invalid input for ${def.name}: ${issues.join("; ")}. Nothing was changed — fix the arguments and call it again.`,
      issues,
    };
    logActivity("agent", def.name, invalid.summary, false);
    return invalid;
  }
  const input = parsed.data;
  if (def.annotations?.destructiveHint && store.getState().requireApproval) {
    const request = def.confirm ? def.confirm(input) : `run ${def.name}`;
    const outcome = await actions.requestApproval(def.name, request, input as Record<string, unknown>, ctx.signal);
    if (outcome !== "approved") {
      const denied: ActionResult = {
        ok: false,
        summary:
          outcome === "queue_full"
            ? `Blocked: too many requests are already waiting for the human, so "${request}" was not queued. Nothing was changed — wait until they answer the pending ones, then ask again.`
            : `Blocked: the human declined "${request}". Nothing was changed — ask them what to do instead.`,
      };
      logActivity("agent", def.name, denied.summary, false);
      return denied;
    }
  }
  let result: ActionResult;
  try {
    result = await def.execute(input);
  } catch (err) {
    result = { ok: false, summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
  logActivity("agent", def.name, result.summary, result.ok);
  return result;
}

/** Turn a ToolDef into the descriptor object WebMCP expects. */
export function wrapTool(def: ToolDef): Record<string, unknown> {
  return {
    name: def.name,
    ...(def.title ? { title: def.title } : {}),
    description: def.description,
    inputSchema: inputSchemaOf(def),
    ...(def.annotations ? { annotations: def.annotations } : {}),
    execute: async (input: unknown, ctx?: { signal?: AbortSignal }) => asText(await executeWrapped(def, input, ctx ?? {})),
  };
}

/**
 * Register a tool. The AbortSignal is the spec's unregistration handle: abort it and the
 * tool disappears from the agent's list (and a `toolchange` event fires).
 */
export function registerTool(mc: ModelContextLike, def: ToolDef, signal?: AbortSignal): boolean {
  const options: RegisterOptions = {};
  if (signal) options.signal = signal;
  if (def.exposedTo?.length) options.exposedTo = def.exposedTo;
  try {
    const maybe = mc.registerTool(wrapTool(def), options);
    if (maybe instanceof Promise) maybe.catch((err) => console.warn(`[webmcp] ${def.name} rejected`, err));
    return true;
  } catch (err) {
    console.warn(`[webmcp] failed to register ${def.name}`, err);
    return false;
  }
}

export function registerAll(mc: ModelContextLike, tools: ToolDef[], signal?: AbortSignal): number {
  let count = 0;
  for (const def of tools) if (registerTool(mc, def, signal)) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Cross-origin tools — the partner catalogue publishes its own WebMCP tools and
// exposes them to this origin; we discover and call them from here.
// ---------------------------------------------------------------------------

/**
 * The tools `fromOrigins` share with this page. The runtime is asked for exactly those
 * origins, but its answer is still checked here, because whatever survives is called and its
 * output reaches the agent: a tool is kept only when it declares an origin and that origin,
 * normalised, is exactly one of `fromOrigins`. A tool that does not say where it comes from is
 * dropped — it cannot be told apart from one that came from somewhere it should not.
 */
export async function discoverTools(mc: ModelContextLike, fromOrigins: string[]): Promise<RemoteTool[]> {
  if (!mc.getTools) return [];
  try {
    const all = await mc.getTools({ fromOrigins });
    return (Array.isArray(all) ? all : []).filter((t) => isAllowedOrigin(t?.origin, fromOrigins));
  } catch (err) {
    console.warn("[webmcp] cross-origin discovery failed", err);
    return [];
  }
}

export async function callRemoteTool(
  mc: ModelContextLike,
  tool: RemoteTool,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (!mc.executeTool) return null;
  const out = await mc.executeTool(tool, JSON.stringify(args));
  if (out == null) return null;
  if (typeof out === "string") return out;
  // some runtimes hand back MCP content blocks instead of a bare string
  const blocks = (out as { content?: Array<{ text?: string }> }).content;
  return blocks?.map((b) => b.text ?? "").join("\n") ?? JSON.stringify(out);
}
