// Flat config. Three kinds of source live in this repo and each gets the globals of the
// place it actually runs: the app (browser, TypeScript + React), the partner origin (a plain
// browser script), and the Playwright/Node dev scripts.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  // build output, rendered media and deploy-tool state are not source
  globalIgnores(["dist/", "shots/", "videos/", ".netlify/", ".wrangler/"]),

  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "vite.config.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },
  {
    // vite.config.ts is evaluated by Node, not shipped to the browser
    files: ["vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // this file itself is only ever loaded by ESLint under Node
    files: ["eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["partner/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // The dev scripts run under Node, but the callbacks they hand to page.evaluate() are
    // serialised and executed inside the page, so both sets of globals are real here.
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
