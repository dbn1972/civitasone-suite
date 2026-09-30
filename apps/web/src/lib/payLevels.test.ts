import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serviceGroup, isValidPayLevel, MIN_PAY_LEVEL, MAX_PAY_LEVEL } from "./payLevels";

/**
 * GAP-HR-DESIGNATIONS-01 / GAP-HR-EMPLOYEES-NEW-05.
 *
 * Before this fix, DesignationsTable.tsx and the add-employee wizard's
 * Step2.tsx each hard-coded their own level→group boundaries and disagreed
 * (level 1-3 was Group-D on one screen and Group-C on the other; level 10-11
 * was Group-B on one screen and Group-A on the other). These tests pin the
 * one correct boundary (DoPT S.O. 3964(F), 9 Aug 2018: Group C 1-5, Group B
 * 6-9, Group A 10-18) and then statically confirm neither consuming file has
 * re-introduced a second, independent copy of it.
 */
describe("serviceGroup — 7th CPC / DoPT S.O. 3964(F) boundaries", () => {
  it("classifies Group C at the low end (levels 1-5)", () => {
    expect(serviceGroup(1)).toBe("Group-C");
    expect(serviceGroup(5)).toBe("Group-C");
  });

  it("classifies Group B in the middle (levels 6-9)", () => {
    expect(serviceGroup(6)).toBe("Group-B");
    expect(serviceGroup(9)).toBe("Group-B");
  });

  it("classifies Group A at the top (levels 10-18), with no gap or overlap at the boundary", () => {
    expect(serviceGroup(10)).toBe("Group-A");
    expect(serviceGroup(18)).toBe("Group-A");
  });

  it("never returns the retired 'Group-D' classification", () => {
    // Group D was merged into Group C after the 6th CPC; level 3 (the old
    // "Group-D" example from DesignationsTable's pre-fix heuristic) must
    // classify as Group-C now, not Group-D.
    expect(serviceGroup(3)).toBe("Group-C");
    for (let level = MIN_PAY_LEVEL; level <= MAX_PAY_LEVEL; level++) {
      expect(serviceGroup(level)).not.toBe("Group-D");
    }
  });

  it("returns null for missing, non-integer, or out-of-range levels — never guesses", () => {
    expect(serviceGroup(null)).toBeNull();
    expect(serviceGroup(undefined)).toBeNull();
    expect(serviceGroup(0)).toBeNull();
    expect(serviceGroup(-1)).toBeNull();
    expect(serviceGroup(19)).toBeNull();
    expect(serviceGroup(40)).toBeNull();
    expect(serviceGroup(7.5)).toBeNull();
  });

  it("covers every level 1-18 with exactly one group (no gaps, no overlaps)", () => {
    for (let level = MIN_PAY_LEVEL; level <= MAX_PAY_LEVEL; level++) {
      expect(serviceGroup(level)).not.toBeNull();
    }
  });
});

describe("isValidPayLevel", () => {
  it("accepts 1-18 and rejects everything else", () => {
    expect(isValidPayLevel(1)).toBe(true);
    expect(isValidPayLevel(18)).toBe(true);
    expect(isValidPayLevel(0)).toBe(false);
    expect(isValidPayLevel(19)).toBe(false);
    expect(isValidPayLevel(1.5)).toBe(false);
    expect(isValidPayLevel("10")).toBe(false);
    expect(isValidPayLevel(null)).toBe(false);
  });
});

/**
 * Structural parity guard: this is the test that "would fail if they ever
 * diverge again" (GAP-HR-EMPLOYEES-NEW-05 acceptance). A unit test on
 * serviceGroup() alone can't catch a screen quietly re-adding its OWN
 * boundary table beside the shared import, which is exactly how the two
 * screens disagreed before this fix — so this asserts both consuming files
 * import the shared helper and neither re-declares a local level→group table.
 */
describe("DesignationsTable and the employee wizard share one serviceGroup()", () => {
  // vitest.config.ts resolves the "@" alias from process.cwd() (apps/web),
  // so anchor these direct file reads the same way rather than __dirname,
  // which isn't reliable across this project's ESM/vite-node test runner.
  const webRoot = process.cwd();
  const designationsTableSrc = readFileSync(
    join(webRoot, "src/app/(app)/hr/designations/DesignationsTable.tsx"),
    "utf8",
  );
  const step2Src = readFileSync(
    join(webRoot, "src/app/(app)/hr/employees/new/steps/Step2.tsx"),
    "utf8",
  );

  it("DesignationsTable.tsx imports serviceGroup from the shared lib", () => {
    expect(designationsTableSrc).toMatch(/from ["']@\/lib\/payLevels["']/);
    expect(designationsTableSrc).toMatch(/\bserviceGroup\b/);
  });

  it("Step2.tsx imports serviceGroup from the shared lib", () => {
    expect(step2Src).toMatch(/from ["'](@\/lib\/payLevels|(\.\.\/)+lib\/payLevels)["']/);
    expect(step2Src).toMatch(/\bserviceGroup\b/);
  });

  it("neither file re-declares its own level→group boundary table", () => {
    // Strip comments first — both files legitimately MENTION the retired
    // symbol names in an explanatory comment about this very fix; what must
    // never come back is the symbol as actual code (a re-declared constant
    // or a second hand-rolled boundary chain).
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const rawSrc of [designationsTableSrc, step2Src]) {
      const src = stripComments(rawSrc);
      expect(src).not.toMatch(/\bCPC7_GRADE_PAY\b/);
      expect(src).not.toMatch(/\bGRADE_VALUES\b/);
      // A second, hand-rolled boundary chain (e.g. `level <= 9`) would be
      // the exact shape of the original bug reappearing.
      expect(src).not.toMatch(/level\s*<=\s*\d+\s*\)?\s*return\s*["']Group/);
    }
  });
});
