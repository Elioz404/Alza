/**
 * The partner origin in development: the same Vite project, served on the partner's own port
 * so the browser treats it as a second origin. The port comes from config/origins.js, the one
 * file the studio, the partner and the static server all read it from.
 *
 *   npm run partner        # http://localhost:<PARTNER_DEV_PORT>/partner/index.html
 */
import { createServer } from "vite";
import { PARTNER_DEV_PORT } from "../config/origins.js";
import { REPO_ROOT } from "./paths.mjs";

// Inline config wins over vite.config.ts, so only the port differs from `npm run dev`.
const server = await createServer({ root: REPO_ROOT, server: { port: PARTNER_DEV_PORT, strictPort: true } });
await server.listen();
server.printUrls();
