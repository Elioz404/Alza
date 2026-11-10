/**
 * The one place the dev scripts start Chromium (e2e-full.mjs, shots.mjs, record6.mjs).
 *
 * Every launch gets the WebMCP feature flag, and the headless ones also software WebGL
 * (swiftshader) so the 3D view renders on a machine without a GPU in the loop.
 *
 * Which Chromium: Playwright's own build by default (`npx playwright install chromium`).
 * When that exact build is not installed (Playwright pins one revision per release, and a
 * machine may only have a newer or older one), point ALZA_CHROMIUM_PATH at any Chromium or
 * Chrome executable and every script launches that instead. Nothing is downloaded either way.
 *
 *   ALZA_CHROMIUM_PATH=/path/to/chrome npm run e2e
 *
 * A headless-shell build is enough for e2e and shots; record6 opens a real window, so it needs
 * a full Chromium or Chrome there.
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright";

/** The environment variable that names the Chromium executable to launch. */
export const CHROMIUM_PATH_ENV = "ALZA_CHROMIUM_PATH";

/** What every launch needs: the page publishes its tools through WebMCP. */
export const WEBMCP_ARGS = Object.freeze(["--enable-features=WebMCP"]);

/** Headless launches render the 3D view in software. */
const HEADLESS_ARGS = Object.freeze([...WEBMCP_ARGS, "--enable-unsafe-swiftshader"]);

/**
 * The executable named by ALZA_CHROMIUM_PATH, or undefined for Playwright's default.
 * A path that does not exist is an error here, rather than Playwright's longer one later.
 * @returns {string | undefined}
 */
export function chromiumExecutable() {
  const path = process.env[CHROMIUM_PATH_ENV]?.trim();
  if (!path) return undefined;
  if (!existsSync(path)) throw new Error(`${CHROMIUM_PATH_ENV} names ${path}, which does not exist.`);
  return path;
}

/**
 * Turn Playwright's "Executable doesn't exist" into the way out.
 * @template T
 * @param {() => Promise<T>} launch
 * @returns {Promise<T>}
 */
async function explained(launch) {
  try {
    return await launch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!process.env[CHROMIUM_PATH_ENV] && /Executable doesn't exist|browserType\.launch/i.test(message)) {
      throw new Error(
        `Playwright could not start its Chromium build. Install it (\`npx playwright install chromium\`), ` +
          `or set ${CHROMIUM_PATH_ENV} to a Chromium or Chrome executable already on this machine.\n\n${message}`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * A headless browser for the battery and the stills.
 * @param {{ args?: string[] }} [options] extra Chromium switches
 * @returns {Promise<import("playwright").Browser>}
 */
export function launchHeadless({ args = [] } = {}) {
  return explained(() => chromium.launch({ executablePath: chromiumExecutable(), args: [...HEADLESS_ARGS, ...args] }));
}

/**
 * A headed, persistent browser for screen capture (record6.mjs): a real window with the GPU on.
 * @param {string} userDataDir
 * @param {Omit<import("playwright").LaunchOptions & import("playwright").BrowserContextOptions, "executablePath"> & { args?: string[] }} options
 * @returns {Promise<import("playwright").BrowserContext>}
 */
export function launchWindow(userDataDir, { args = [], ...options } = {}) {
  return explained(() =>
    chromium.launchPersistentContext(userDataDir, {
      ...options,
      headless: false,
      executablePath: chromiumExecutable(),
      args: [...WEBMCP_ARGS, ...args],
    }),
  );
}
