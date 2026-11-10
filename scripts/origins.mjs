/**
 * The production origins, for scripts that drive the deployed site. They are read the same way
 * vite.config.ts reads them — Vite's loadEnv over .env.production, validated by
 * config/origins.js — so a script can never aim at an address the build would not ship.
 */
import { loadEnv } from "vite";
import { ORIGIN_ENV, resolveOrigins } from "../config/origins.js";
import { REPO_ROOT } from "./paths.mjs";

/** @returns {{ studio: string, supplier: string }} */
export const productionOrigins = () =>
  resolveOrigins(loadEnv("production", REPO_ROOT, Object.values(ORIGIN_ENV)), { production: true });
