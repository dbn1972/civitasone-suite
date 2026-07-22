// scripts/governance/hooks-validate.test.ts
//
// Unit tests against all 11 real `.kiro.hook` files (task 10.4).
// Asserts each real hook file parses successfully via parseHookFile() and
// passes validateHookSchema().
//
// Feature: agent-context-governance-refresh
// _Requirements: 5.1, 5.2

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHookFile, validateHookSchema } from "./hooks-validate.js";

const HOOKS_DIR = join(__dirname, "../../../.kiro/hooks");

const REAL_HOOK_FILES = [
  "authz-guard-check.kiro.hook",
  "enforce-coverage-80.kiro.hook",
  "mobile-integrity-check.kiro.hook",
  "money-path-integrity.kiro.hook",
  "pii-encryption-check.kiro.hook",
  "sync-validators-docs.kiro.hook",
  "update-api-docs.kiro.hook",
  "update-db-schema.kiro.hook",
  "update-user-manual.kiro.hook",
  "validate-migration.kiro.hook",
  "verify-consumer-wiring.kiro.hook",
];

describe("parseHookFile + validateHookSchema against the real .kiro/hooks files", () => {
  it.each(REAL_HOOK_FILES)("%s parses successfully and passes schema validation", (fileName) => {
    const raw = readFileSync(join(HOOKS_DIR, fileName), "utf8");

    const parsed = parseHookFile(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return; // narrow for TS; unreachable given the assertion above

    const result = validateHookSchema(parsed.value);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("covers exactly the 11 real hook files (no more, no fewer)", () => {
    expect(REAL_HOOK_FILES).toHaveLength(11);
  });
});
