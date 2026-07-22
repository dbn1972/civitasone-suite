// scripts/governance/hooks-referenced-paths.test.ts
//
// Unit tests for the worked example (task 12.4): resolves the
// `docs/database/` vs `docs/api/` existence question, and the
// `enforce-coverage-80.kiro.hook` templated pnpm invocation's
// literal-parts-only resolution against the root `vitest` devDependency.
//
// Feature: agent-context-governance-refresh
// _Requirements: 6.2, 6.3

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFileOrDirExists, checkPnpmScriptExists, extractReferencedPaths } from "./hooks-referenced-paths.js";

// repoRoot for checkFileOrDirExists is civitasone-suite/'s absolute path —
// every real hook's file-or-dir references are written relative to that
// directory (see hooks-referenced-paths.ts's module header note).
const SUITE_ROOT = join(__dirname, "../..");
const HOOKS_DIR = join(SUITE_ROOT, "../.kiro/hooks");

describe("worked example: docs/database/ vs docs/api/", () => {
  it("flags docs/database/ as non-existent (the real doc is civitasone-suite/docs/DATABASE-SCHEMA.md, not a docs/database/ directory)", () => {
    expect(checkFileOrDirExists(SUITE_ROOT, "docs/database/")).toBe(false);
  });

  it("flags docs/api/ as existing", () => {
    expect(checkFileOrDirExists(SUITE_ROOT, "docs/api/")).toBe(true);
  });

  it("no longer extracts docs/database/ from update-db-schema.kiro.hook's prompt (task 18.4 corrected the reference to docs/DATABASE-SCHEMA.md)", () => {
    const raw = readFileSync(join(HOOKS_DIR, "update-db-schema.kiro.hook"), "utf8");
    const hook = JSON.parse(raw) as { name: string; when: unknown; then: unknown };
    const referenced = extractReferencedPaths(hook);

    const dbRef = referenced.find((r) => r.rawText === "docs/database/");
    expect(dbRef).toBeUndefined();

    const fixedRef = referenced.find((r) => r.rawText === "docs/DATABASE-SCHEMA.md");
    expect(fixedRef).toBeDefined();
    expect(fixedRef?.kind).toBe("file-or-dir");
    expect(checkFileOrDirExists(SUITE_ROOT, fixedRef!.rawText)).toBe(true);
  });

  it("extracts docs/api/ from update-api-docs.kiro.hook's and sync-validators-docs.kiro.hook's prompts as file-or-dir references that resolve to existing", () => {
    for (const fileName of ["update-api-docs.kiro.hook", "sync-validators-docs.kiro.hook"]) {
      const raw = readFileSync(join(HOOKS_DIR, fileName), "utf8");
      const hook = JSON.parse(raw) as { name: string; when: unknown; then: unknown };
      const referenced = extractReferencedPaths(hook);

      const apiRef = referenced.find((r) => r.rawText === "docs/api/");
      expect(apiRef, `expected docs/api/ to be extracted from ${fileName}`).toBeDefined();
      expect(apiRef?.kind).toBe("file-or-dir");
      expect(checkFileOrDirExists(SUITE_ROOT, apiRef!.rawText)).toBe(true);
    }
  });
});

describe("worked example: enforce-coverage-80.kiro.hook templated pnpm invocation", () => {
  it("resolves via literal-parts checking against the root vitest devDependency, treating <service> as a wildcard segment", () => {
    const raw = readFileSync(join(HOOKS_DIR, "enforce-coverage-80.kiro.hook"), "utf8");
    const hook = JSON.parse(raw) as { name: string; when: unknown; then: unknown };
    const referenced = extractReferencedPaths(hook);

    const pnpmRef = referenced.find((r) => r.kind === "pnpm-script");
    expect(pnpmRef).toBeDefined();
    expect(pnpmRef?.rawText).toContain("--filter @civitasone/<service>");
    expect(pnpmRef?.rawText).toContain("exec vitest run");

    // A fake package map with no exact "@civitasone/<service>" entry, but a
    // real "root" entry declaring vitest as a devDependency (matching the
    // real civitasone-suite/package.json shape) — the <service> placeholder
    // must resolve as a wildcard, and the root-level devDependency must
    // satisfy the "exec vitest" check.
    const packageJsons = {
      root: {
        scripts: {},
        devDependencies: { vitest: "^2.1.9", "fast-check": "4.8.0" },
      },
      "@civitasone/finance-service": { scripts: { test: "vitest run" } },
    };

    expect(checkPnpmScriptExists(pnpmRef!.rawText, packageJsons)).toBe(true);
  });

  it("resolves against the real civitasone-suite/package.json's vitest devDependency", () => {
    const rootPackageJson = JSON.parse(readFileSync(join(SUITE_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(rootPackageJson.devDependencies.vitest).toBeDefined();

    const packageJsons = { root: rootPackageJson };
    const command = "pnpm --filter @civitasone/<service> exec vitest run --coverage";
    expect(checkPnpmScriptExists(command, packageJsons)).toBe(true);
  });
});
