// scripts/governance/correction-gate.property.test.ts
//
// Property test for the apply-vs-flag correction gate (task 14.6).
// Uses fast-check (already a devDependency) — see design.md's "Correctness
// Properties" section for Property 10's full statement.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyOrFlag, classifyCorrection } from "./correction-gate.js";
import type { Correction } from "./types.js";

// ── Arbitraries for Property 10 (applyOrFlag) ───────────────────────────────

const arbHookFile = fc.constantFrom(
  "authz-guard-check.kiro.hook",
  "enforce-coverage-80.kiro.hook",
  "update-db-schema.kiro.hook",
  "verify-consumer-wiring.kiro.hook"
);

const arbField = fc.constantFrom("then.prompt", "when.patterns[0]", "when.patterns[1]", "version", "when.type", "then.command");

const arbShortText = fc.string({ minLength: 0, maxLength: 40 });

/** A one-character-diff pair: `after` differs from `before` by exactly one
 * appended/changed character, used to test that textual triviality never
 * overrides the flag. */
const arbTrivialDiffPair = arbShortText.chain((base) =>
  fc.tuple(fc.constant(base), fc.constant(`${base}x`))
);

const arbCorrection: fc.Arbitrary<Correction> = fc
  .tuple(arbHookFile, arbField, arbShortText, arbShortText, fc.boolean())
  .map(([hookFile, field, before, after, touchesRolesCommandsOrBusinessRules]) => ({
    hookFile,
    field,
    before,
    after,
    touchesRolesCommandsOrBusinessRules,
  }));

const arbTrivialCorrection: fc.Arbitrary<Correction> = fc
  .tuple(arbHookFile, arbField, arbTrivialDiffPair, fc.boolean())
  .map(([hookFile, field, [before, after], touchesRolesCommandsOrBusinessRules]) => ({
    hookFile,
    field,
    before,
    after,
    touchesRolesCommandsOrBusinessRules,
  }));

describe("Property 10: Corrections touching roles, commands, or business rules are always flagged, never auto-applied", () => {
  // Feature: agent-context-governance-refresh, Property 10: For any Correction object, if touchesRolesCommandsOrBusinessRules is true, the Refresh_Process's apply-or-flag decision is always needs-manual-review and the hook file is left unmodified for that correction; if false, the correction may be auto-applied. This must hold even when the correction is textually trivial (e.g. a one-character diff) — triviality never overrides the flag.

  it("flags every correction with touchesRolesCommandsOrBusinessRules=true as needs-manual-review, and never calls applyFn for it", () => {
    fc.assert(
      fc.property(arbCorrection, (correction) => {
        let applyFnCalled = false;
        const result = applyOrFlag(correction, () => {
          applyFnCalled = true;
          return "applied";
        });

        if (correction.touchesRolesCommandsOrBusinessRules) {
          expect(result.applied).toBe(false);
          expect(applyFnCalled).toBe(false);
          expect(result.result).toBeUndefined();
        } else {
          expect(result.applied).toBe(true);
          expect(applyFnCalled).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("triviality never overrides the flag: a one-character-diff correction is still flagged when touchesRolesCommandsOrBusinessRules is true, and still auto-applied when false", () => {
    fc.assert(
      fc.property(arbTrivialCorrection, (correction) => {
        let applyFnCalled = false;
        const result = applyOrFlag(correction, () => {
          applyFnCalled = true;
          return "applied";
        });

        if (correction.touchesRolesCommandsOrBusinessRules) {
          expect(result.applied).toBe(false);
          expect(applyFnCalled).toBe(false);
        } else {
          expect(result.applied).toBe(true);
          expect(applyFnCalled).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── classifyCorrection() itself: planted differences ────────────────────────
//
// Generates before/after text pairs with planted role-word / command /
// business-rule-marker differences and confirms classifyCorrection detects
// them (returns true), and generates pairs with only trivial/cosmetic
// differences (whitespace, a path string change) and confirms it does NOT
// flag them (returns false).

const ROLE_WORDS = ["approver", "submitter", "maker", "checker", "admin", "officer", "chairperson"];
const COMMAND_TOOLS = ["pnpm", "npm", "vitest", "docker", "git"];
const COMMAND_ACTIONS = ["test", "build", "lint", "deploy", "run"];

const arbSurroundingText = fc.stringMatching(/^[A-Za-z0-9 ,.'"/_-]{0,60}$/);

describe("classifyCorrection: planted role/command/business-rule differences are detected", () => {
  it("detects a planted role-word difference between before and after", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.constantFrom(...ROLE_WORDS), fc.constantFrom(...ROLE_WORDS), arbSurroundingText, arbSurroundingText).filter(
          ([roleBefore, roleAfter]) => roleBefore !== roleAfter
        ),
        ([roleBefore, roleAfter, prefix, suffix]) => {
          const before = `${prefix} ${roleBefore} ${suffix}`;
          const after = `${prefix} ${roleAfter} ${suffix}`;
          expect(classifyCorrection(before, after, "then.prompt")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detects a planted command-token difference between before and after", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.constantFrom(...COMMAND_TOOLS), fc.constantFrom(...COMMAND_TOOLS)).filter(([a, b]) => a !== b),
        fc.constantFrom(...COMMAND_ACTIONS),
        ([toolBefore, toolAfter], action) => {
          const before = `run: ${toolBefore} ${action}`;
          const after = `run: ${toolAfter} ${action}`;
          expect(classifyCorrection(before, after, "then.command")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detects a planted business-rule-marker difference between before and after", () => {
    const before = "The approver must be different from the submitter.";
    const after = "The approver should ideally be different from the submitter, but it is optional.";
    // "must" (normative marker) is present in `before`'s matched sentence but
    // not reproduced identically in `after`'s rephrased sentence, so the set
    // of business-rule-like sentences differs.
    expect(classifyCorrection(before, after, "then.prompt")).toBe(true);
  });

  it("does NOT flag a purely cosmetic whitespace difference", () => {
    fc.assert(
      fc.property(arbSurroundingText, (text) => {
        const before = text;
        const after = `  ${text}  `; // only whitespace added
        expect(classifyCorrection(before, after, "then.prompt")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("does NOT flag a path-string-only change (the docs/database/ -> docs/DATABASE-SCHEMA.md worked example)", () => {
    const before = "Update the schema documentation under docs/database/ to match the migration.";
    const after = "Update the schema documentation under docs/DATABASE-SCHEMA.md to match the migration.";
    expect(classifyCorrection(before, after, "then.prompt")).toBe(false);
  });
});
