/**
 * WebMCP registration layer.
 *
 * Three things happen here that the rest of the app depends on:
 *  1. Tools are registered against the spec surface — `registerTool(descriptor, { signal, exposedTo })`
 *     — and are retired by aborting that signal, which is how WebMCP unregisters tools.
 *  2. Every execution is logged to the on-page activity feed, so agent actuation is visible
 *     (the spec's "tools run visibly on the page").
 *  3. Destructive tools pass through a human approval gate before they touch the model.
 */

import { actions, store, logActivity, type ActionResult } from "../model/store";

export interface ToolDef {
  name: string;
  /** short human-readable label; WebMCP tool descriptors carry a `title` alongside `name` */
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    untrustedContentHint?: boolean;
  };
  /** secure origins this tool is shared with (WebMCP cross-origin exposure) */
  exposedTo?: string[];
  /** plain-language sentence shown to the human when the approval gate stops this call */
  confirm?: (input: Record<string, never>) => string;
  execute: (input: Record<string, never>) => ActionResult | Promise<ActionResult>;
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
 * Run a tool the way WebMCP would: approval gate, execution, activity log, text result.
 * The on-page ToolRunner uses this too, so the fallback path behaves identically.
 */
export async function executeWrapped(
  def: ToolDef,
  input: Record<string, never>,
  ctx: { signal?: AbortSignal } = {},
): Promise<ActionResult> {
  if (def.annotations?.destructiveHint && store.getState().requireApproval) {
    const request = def.confirm ? def.confirm(input) : `run ${def.name}`;
    const granted = await actions.requestApproval(def.name, request, input, ctx.signal);
    if (!granted) {
      const denied: ActionResult = {
        ok: false,
        summary: `Blocked: the human declined "${request}". Nothing was changed — ask them what to do instead.`,
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
    inputSchema: def.inputSchema,
    ...(def.annotations ? { annotations: def.annotations } : {}),
    execute: async (input: Record<string, never>, ctx?: { signal?: AbortSignal }) =>
      asText(await executeWrapped(def, input ?? ({} as Record<string, never>), ctx ?? {})),
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

export async function discoverTools(mc: ModelContextLike, fromOrigins: string[]): Promise<RemoteTool[]> {
  if (!mc.getTools) return [];
  try {
    const all = await mc.getTools({ fromOrigins });
    return (all ?? []).filter((t) => !t.origin || fromOrigins.some((o) => t.origin?.startsWith(o)));
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
