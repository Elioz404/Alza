/**
 * A production build aimed at the two local origins that serve-local.mjs serves, so the
 * shipped code path — baked origins, full CSP, no `?supplier=` / `?host=` overrides — can be
 * exercised on this machine before it is deployed.
 *
 *   npm run build:local                  # then: npm run serve:local
 *   npm run build:local -- --test-hook   # the same, with the test hook for the Playwright scripts
 *
 * The origins come from config/origins.js and reach Vite as process env, which beats
 * .env.production. Because they are loopback origins the build goes to LOCAL_DIST_DIR, not to
 * the dist/ the deploy scripts publish (config/sites.js outputDirFor), and the test hook is
 * only accepted alongside them (config/flags.js). Nothing else differs from `npm run build`.
 */
import { build } from "vite";
import { ORIGIN_ENV, PARTNER_DEV_ORIGIN, STUDIO_DEV_ORIGIN } from "../config/origins.js";
import { TEST_HOOK_ENV } from "../config/flags.js";
import { outputDirFor } from "../config/sites.js";
import { REPO_ROOT } from "./paths.mjs";

process.env[ORIGIN_ENV.studio] = STUDIO_DEV_ORIGIN;
process.env[ORIGIN_ENV.supplier] = PARTNER_DEV_ORIGIN;
process.env[TEST_HOOK_ENV] = process.argv.includes("--test-hook") ? "1" : "0";

await build({ root: REPO_ROOT, configFile: `${REPO_ROOT}/vite.config.ts` });
const out = outputDirFor({ studio: STUDIO_DEV_ORIGIN, supplier: PARTNER_DEV_ORIGIN });
console.log(`${out}/ built for ${STUDIO_DEV_ORIGIN} + ${PARTNER_DEV_ORIGIN}${process.env[TEST_HOOK_ENV] === "1" ? " (with the test hook)" : ""}`);
