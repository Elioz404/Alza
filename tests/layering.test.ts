/**
 * The layering rule, model ← mcp ← ui / three / editor, is enforced by ESLint
 * (eslint.config.js), so CI catches a regression. These run the project's own config: probes
 * prove each rule fires on what it forbids and stays quiet on what is allowed, and the real
 * source of each lower layer is checked to obey it.
 */
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint();

/** The layer-rule messages ESLint reports for `code` as if it were the file at `filePath`. */
async function restricted(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const use = (...names: string[]) => `export const used = [${names.join(", ")}];\n`;

describe("src/model is the pure domain", () => {
  it.each([
    ['import { buildFurniture } from "../three/furniture";', "buildFurniture"],
    ['import { TOOLS } from "../mcp/tools";', "TOOLS"],
    ['import { App } from "../ui/App";', "App"],
    ['import { Editor } from "../editor/Editor";', "Editor"],
    ['import * as THREE from "three";', "THREE"],
    ['import { useState } from "react";', "useState"],
    ['import { useStore } from "zustand";', "useStore"],
  ])("refuses %s", async (line, name) => {
    expect(await restricted("src/model/probe.ts", line + "\n" + use(name))).toHaveLength(1);
  });

  it("allows its own modules, zod and the framework-free store", async () => {
    const code = [
      'import { z } from "zod";',
      'import { createStore } from "zustand/vanilla";',
      'import { snap } from "./geometry";',
      use("z", "createStore", "snap"),
    ].join("\n");
    expect(await restricted("src/model/probe.ts", code)).toEqual([]);
  });
});

describe("src/mcp sits on the model, below the presentation layers", () => {
  it.each([
    ['import { buildFurniture } from "../three/furniture";', "buildFurniture"],
    ['import { App } from "../ui/App";', "App"],
    ['import * as THREE from "three";', "THREE"],
  ])("refuses %s", async (line, name) => {
    expect(await restricted("src/mcp/probe.ts", line + "\n" + use(name))).toHaveLength(1);
  });

  it("allows the model", async () => {
    expect(await restricted("src/mcp/probe.ts", 'import { store } from "../model/store";\n' + use("store"))).toEqual([]);
  });
});

describe("the presentation layers change the plan through dispatch", () => {
  it.each(["src/ui/probe.tsx", "src/editor/probe.tsx", "src/three/probe.ts"])("%s may not take the raw actions or log by hand", async (file) => {
    const code = 'import { actions, logActivity } from "../model/store";\n' + use("actions", "logActivity");
    expect(await restricted(file, code)).toHaveLength(2);
  });

  it("so does the entry point that mounts them", async () => {
    const code = 'import { actions, logActivity } from "./model/store";\n' + use("actions", "logActivity");
    expect(await restricted("src/main.tsx", code)).toHaveLength(2);
  });

  it("may take dispatch, pageActions and the store itself", async () => {
    const code = [
      'import { store, pageActions } from "../model/store";',
      'import { dispatch } from "../model/commands";',
      use("store", "pageActions", "dispatch"),
    ].join("\n");
    expect(await restricted("src/ui/probe.tsx", code)).toEqual([]);
  });
});

describe("the source obeys the layers", () => {
  it("src/model, src/mcp, the presentation layers and the entry point lint clean under their rules", async () => {
    const results = await eslint.lintFiles(["src/model", "src/mcp", "src/ui", "src/three", "src/editor", "src/main.tsx"]);
    const broken = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => `${r.filePath}:${m.line} ${m.message}`),
    );
    expect(broken).toEqual([]);
  }, 30_000);
});
