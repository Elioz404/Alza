/**
 * Where the dev scripts find the repo. They live in scripts/ but read and write things at the
 * root (dist/, shots/, videos/, plan-source.jpeg), and they used to resolve those against the
 * cwd — so they only worked when launched from the root. Resolving from this file instead
 * makes `npm run …`, `node scripts/x.mjs` and a run from any other directory equivalent.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute path of something addressed relative to the repo root. */
export const fromRoot = (...segments) => resolve(REPO_ROOT, ...segments);
