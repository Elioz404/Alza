/**
 * Build-time switches, read by vite.config.ts (which fails the build on a bad value) and by
 * the bundle through import.meta.env.
 *
 * Plain JavaScript for the same reason as config/origins.js: the browser bundle, the Vite
 * config and the Node scripts all load it as-is.
 */

import { LOOPBACK_HOSTS, isLoopbackHost } from "./origins.js";

/**
 * The build variable that keeps the page's test hook (`window.__alza`) in a production build.
 *
 * The hook hands out the store, every action and the tool pipeline, which is exactly what the
 * Playwright scripts need and exactly what must not ship: any agent able to evaluate script in
 * the page could switch the approval gate off or approve its own request. Development builds
 * always have it; a production build only when this is set, for a local build that the
 * scripts drive (`npm run build:local -- --test-hook`). The build refuses it for any origin
 * that is not loopback (assertTestHookOrigins), so a deployed build cannot carry it.
 */
export const TEST_HOOK_ENV = "VITE_ALZA_TEST_HOOK";

/** The global the hook is installed as, and the scripts in scripts/ read. */
export const TEST_HOOK_GLOBAL = "__alza";

/** Raised for a build switch with a value that is neither on nor off. */
export class BuildFlagError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BuildFlagError";
  }
}

const ON = Object.freeze(["1", "true"]);
const OFF = Object.freeze(["", "0", "false"]);

/**
 * Read one on/off build variable. Unset is off. Anything other than the spellings above is an
 * error rather than a guess, so a typo cannot silently decide which way a security switch goes.
 *
 * @param {Record<string, unknown>} env
 * @param {string} name
 * @returns {boolean}
 */
export function readFlag(env, name) {
  const value = env[name];
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  if (ON.includes(text)) return true;
  if (OFF.includes(text)) return false;
  throw new BuildFlagError(`${name} must be one of ${[...ON, ...OFF.filter(Boolean)].join(" / ")} (or unset), got "${value}".`);
}

/**
 * Refuse a production build that carries the test hook but trusts an origin off this machine.
 *
 * The hook exists for the Playwright scripts, which drive a build on loopback origins; a
 * build for any other origin is one that gets deployed, and shipping the hook there would put
 * the approval gate one `evaluate` away from any agent on the page. So the switch is honoured
 * only together with two loopback origins, whichever way it was set (`build:local
 * --test-hook`, or a line left in .env.production), and the build fails otherwise.
 *
 * @param {boolean} hook whether the switch is on (readFlag(env, TEST_HOOK_ENV))
 * @param {{ studio: string, supplier: string }} origins validated, canonical (config/origins.js)
 */
export function assertTestHookOrigins(hook, origins) {
  if (!hook) return;
  const remote = [origins.studio, origins.supplier].filter((origin) => !isLoopbackHost(new URL(origin).hostname));
  if (remote.length > 0) {
    throw new BuildFlagError(
      `${TEST_HOOK_ENV} is only allowed in a build for ${LOOPBACK_HOSTS.join(" / ")} origins, and this one is for ${remote.join(" + ")}.`,
    );
  }
}

/**
 * Whether this build installs the test hook: every development build, and a production build
 * only on the explicit switch.
 *
 * @param {Record<string, unknown>} env Vite's `import.meta.env`, or `{ DEV, ...loadEnv() }`
 * @returns {boolean}
 */
export const testHookEnabled = (env) => env.DEV === true || readFlag(env, TEST_HOOK_ENV);
