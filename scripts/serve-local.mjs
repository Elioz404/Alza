/**
 * Two origins, two sites. The studio and the partner must be DIFFERENT origins for the
 * cross-origin WebMCP exchange to be real, and the browser only delegates the `tools`
 * feature when the headers say so — Netlify/Cloudflare read those from each site's _headers,
 * which a plain static server ignores. So this sends them itself, from the same module
 * (config/headers.js) the build writes the _headers files from, so local and production match.
 *
 *   npm run build:local        # a production build aimed at the two local origins
 *   npm run serve:local        # studio and partner on their dev ports   (or: node scripts/serve-local.mjs)
 *
 * It serves the local build's output (LOCAL_DIST_DIR in config/sites.js), one site directory
 * per port, as the hosts do — never dist/, which holds the build for the deployed origins and
 * is what the deploy scripts publish. The ports are the dev ports from config/origins.js, so
 * the studio here sits on the origin the partner already authorises.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fromRoot } from "./paths.mjs";
import { createStaticHandler } from "./static-server.mjs";
import { HEADERS_FILE, headerRules, headersFor, renderHeadersFile } from "../config/headers.js";
import { PARTNER_DEV_ORIGIN, PARTNER_DEV_PORT, STUDIO_DEV_ORIGIN, STUDIO_DEV_PORT, devOrigin } from "../config/origins.js";
import { LOCAL_DIST_DIR, siteDir } from "../config/sites.js";

const ORIGINS = { studio: STUDIO_DEV_ORIGIN, supplier: PARTNER_DEV_ORIGIN };

/**
 * @param {import("../config/sites.js").Site} site
 * @param {number} port
 */
function serve(site, port) {
  const dir = siteDir(LOCAL_DIST_DIR, site);
  const rules = headerRules(ORIGINS, site);
  // The headers sent below name the local origins; a _headers that names others means the
  // build is stale (or was made by hand for other origins) and the two pages will not pair up.
  try {
    if (readFileSync(fromRoot(dir, HEADERS_FILE), "utf8") !== renderHeadersFile(rules)) {
      console.warn(`${dir}/ was built for other origins than ${STUDIO_DEV_ORIGIN} + ${PARTNER_DEV_ORIGIN}; run \`npm run build:local\` first.`);
    }
  } catch {
    console.warn(`${dir}/ has no build in it; run \`npm run build:local\` first.`);
  }
  const handler = createStaticHandler({ root: fromRoot(dir), headersFor: (path) => headersFor(rules, path) });
  createServer(handler).listen(port, () => console.log(`  ${devOrigin(port)}  ${dir}/`));
}

serve("studio", STUDIO_DEV_PORT);
serve("partner", PARTNER_DEV_PORT);
console.log(`sirviendo ${LOCAL_DIST_DIR}/ en dos origenes; Ctrl+C para parar`);
