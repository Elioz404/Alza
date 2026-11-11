// Flat config. Three kinds of source live in this repo and each gets the globals of the
// place it actually runs: the app (browser, TypeScript + React), the partner origin (a plain
// browser script), and the Playwright/Node dev scripts.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import { DIST_DIR, LOCAL_DIST_DIR } from "./config/sites.js";

// ---- layering: model ← mcp, session ← ui / three / editor ----
// Each layer may import from the ones below it and never from the ones above, so the domain
// can be tested and reused without a renderer, a framework or the agent surface. The rules
// match import specifiers: a relative path into a higher layer's directory, or a package that
// belongs up there (three.js, React — and zustand's React entry, as opposed to zustand/vanilla).
const intoDirs = (dirs) => `^\\.{1,2}/(\\.\\./)*(${dirs.join("|")})(/|$)`;
const PRESENTATION_PACKAGES = "^(three|react|react-dom|zustand)(/|$)";
const ZUSTAND_VANILLA = "^zustand/vanilla$";
const packagesAbove = `(?!${ZUSTAND_VANILLA})${PRESENTATION_PACKAGES}`;

const layer = (message, ...regexes) => ({
  "no-restricted-imports": ["error", { patterns: regexes.map((regex) => ({ regex, message })) }],
});

const MODEL_RULES = layer(
  "src/model is the pure domain: it may not depend on the agent adapter (mcp), the shared session (session), the presentation layers (ui, three, editor) or their packages.",
  intoDirs(["mcp", "session", "ui", "three", "editor"]),
  packagesAbove,
);
// The shared session keeps the tabs on one plan through the model's own pipeline (dispatch): it
// sits on the model beside the agent adapter, and knows nothing of either's presentation.
const SESSION_RULES = layer(
  "src/session sits on the model: it may not depend on the agent adapter (mcp), the presentation layers (ui, three, editor) or their packages.",
  intoDirs(["mcp", "ui", "three", "editor"]),
  packagesAbove,
);
const MCP_RULES = layer(
  "src/mcp is the agent adapter over the model: it may not depend on the presentation layers (ui, three, editor) or their packages.",
  intoDirs(["ui", "three", "editor"]),
  packagesAbove,
);
// The presentation layers — and the entry point that mounts them — change the plan through
// dispatch() (src/model/commands.ts), so every change they make is checked, recorded as one
// undo step and attributed in the activity feed. Calling the raw actions, or writing to the
// feed by hand, would skip that.
const PRESENTATION_RULES = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          regex: "(^|/)model/store$",
          importNames: ["actions", "logActivity"],
          message: "Change the plan with dispatch() from model/commands, and the page with pageActions.",
        },
      ],
    },
  ],
};

export default defineConfig(
  // build output, rendered media and deploy-tool state are not source
  globalIgnores([`${DIST_DIR}/`, `${LOCAL_DIST_DIR}/`, "shots/", "videos/", ".netlify/", ".wrangler/"]),

  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "vite.config.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },
  { files: ["src/model/**/*.{ts,tsx}"], rules: MODEL_RULES },
  { files: ["src/mcp/**/*.{ts,tsx}"], rules: MCP_RULES },
  { files: ["src/session/**/*.{ts,tsx}"], rules: SESSION_RULES },
  { files: ["src/{ui,three,editor}/**/*.{ts,tsx}", "src/main.tsx"], rules: PRESENTATION_RULES },
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
    // shared by the browser bundles, vite.config.ts and the Node scripts, so it may lean on
    // neither environment's globals
    files: ["config/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals["shared-node-browser"] },
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
