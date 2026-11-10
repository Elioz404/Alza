/**
 * The scripts drive the studio through its test hook, which only development builds and
 * builds made with the explicit switch carry (config/flags.js). Checked right after the page
 * loads, so pointing a script at a deployed build fails with the way out instead of with
 * "cannot read properties of undefined" halfway through.
 *
 * The hook is looked up once, by the name config/flags.js installs it under, and handed back
 * as a Playwright handle: the scripts call `hook.evaluate((h) => h.actions…)` and never spell
 * the global themselves, so renaming it is one edit.
 */
import { TEST_HOOK_ENV, TEST_HOOK_GLOBAL } from "../config/flags.js";

/**
 * @param {import("playwright").Page} page
 * @param {string} base the URL the page was loaded from, for the message
 * @returns {Promise<import("playwright").JSHandle<any>>} valid until the page navigates again
 */
export async function requireTestHook(page, base) {
  const present = await page.evaluate((name) => typeof Reflect.get(window, name) === "object", TEST_HOOK_GLOBAL);
  if (!present) {
    throw new Error(
      `${base} has no window.${TEST_HOOK_GLOBAL}: deployed builds do not carry the test hook. ` +
        `Run against \`npm run dev\`, or a local production build made with it ` +
        `(\`npm run build:local -- --test-hook\`, which sets ${TEST_HOOK_ENV}, then \`npm run serve:local\`).`,
    );
  }
  return page.evaluateHandle((name) => Reflect.get(window, name), TEST_HOOK_GLOBAL);
}
