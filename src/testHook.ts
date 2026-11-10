/**
 * The page's test hook: `window.__alza`, the handle the Playwright scripts drive the app
 * through (the store, every action, and the same wrapped tool pipeline WebMCP uses).
 *
 * It is a back door around the approval gate by design — `actions.setRequireApproval(false)`
 * is one call away — so whether it exists is decided at build time by config/flags.js, never
 * at runtime: development builds have it, shipped builds do not.
 */

import { TEST_HOOK_GLOBAL, testHookEnabled } from "../config/flags.js";

/**
 * Install `hook` on `target` when this build allows it. Returns whether it did.
 *
 * @param env this build's environment — `import.meta.env` in the app, a stand-in in tests
 */
export function installTestHook(target: object, env: Record<string, unknown>, hook: object): boolean {
  if (!testHookEnabled(env)) return false;
  Object.defineProperty(target, TEST_HOOK_GLOBAL, { value: hook, configurable: true, writable: false, enumerable: false });
  return true;
}
