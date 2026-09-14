/**
 * flaky-skip-guard.mjs — fixture-based unit tests (REL-014).
 *
 * Exercises the exported pure functions directly (classification, title
 * extraction, and governance-comment parsing/evaluation) against in-memory
 * fixtures, mirroring tests/architecture/evidence-suite-dbs-guard.test.ts's
 * shape — the guard's own file-walk + baseline diff is exercised by running
 * it against the real tree in CI, not here.
 *
 * Run: pnpm exec vitest run tests/architecture/flaky-skip-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  classifySkipOccurrence,
  extractTitle,
  hasSecondArgument,
  parseGovernanceTag,
  evaluateGovernance,
} from "../../scripts/ci/flaky-skip-guard.mjs";

describe("flaky-skip-guard: classifySkipOccurrence()", () => {
  it("classifies describe.skipIf as env-gated", () => {
    expect(classifySkipOccurrence('describe.skipIf(!reachable)("suite", () => {')).toEqual({
      kind: "env-gated",
      label: "skipIf",
    });
  });

  it("classifies it.skip('name', fn) as hard (first arg is a string literal)", () => {
    expect(classifySkipOccurrence('  it.skip("does the thing", async () => {')).toEqual({
      kind: "hard",
      label: "it.skip",
    });
  });

  it("classifies describe.skip('name', fn) as hard", () => {
    expect(classifySkipOccurrence('describe.skip("suite", () => {')).toEqual({
      kind: "hard",
      label: "describe.skip",
    });
  });

  it("classifies test.skip(condition, 'msg') as runtime-conditional (first arg is not a string)", () => {
    expect(classifySkipOccurrence("    test.skip(stillMissing,")).toEqual({
      kind: "runtime-conditional",
      label: "test.skip",
    });
  });

  it("treats a bare 'test.skip(' with nothing after it yet as runtime-conditional (the real multi-line Playwright form)", () => {
    expect(classifySkipOccurrence("    test.skip(")).toEqual({
      kind: "runtime-conditional",
      label: "test.skip",
    });
  });

  it("classifies .todo( as hard regardless of prefix", () => {
    expect(classifySkipOccurrence('it.todo("not written yet")')).toEqual({ kind: "hard", label: ".todo" });
    expect(classifySkipOccurrence('describe.todo("later")')).toEqual({ kind: "hard", label: ".todo" });
  });

  it("classifies xdescribe/xit/xtest as hard", () => {
    expect(classifySkipOccurrence('xit("disabled", () => {})')).toEqual({ kind: "hard", label: "x-prefixed" });
    expect(classifySkipOccurrence('xdescribe("disabled suite", () => {')).toEqual({
      kind: "hard",
      label: "x-prefixed",
    });
  });

  it("does not flag an unrelated .skip( call, e.g. an RxJS-style operator on a plain identifier", () => {
    // `.skip(` alone with none of describe/it/test/skipIf/xdescribe/xit/xtest
    // in front of it must not match — this guard only governs test-framework
    // skips, not arbitrary library methods that happen to share the name.
    expect(classifySkipOccurrence("results.skip(5).take(3)")).toEqual(null);
  });

  it("returns null for a line with no skip-shaped call", () => {
    expect(classifySkipOccurrence('it("runs normally", () => {})')).toEqual(null);
  });
});

describe("flaky-skip-guard: extractTitle()", () => {
  it("pulls the quoted title out of the same line", () => {
    expect(extractTitle(['describe.skipIf(!reachable)("cdp repo — real Postgres", () => {'])).toBe(
      "cdp repo — real Postgres",
    );
  });

  it("looks ahead across lines when the title is not on the match line (multi-line call)", () => {
    expect(
      extractTitle([
        "describe.skipIf(",
        "  !reachable,",
        ")(",
        '  "rel-032 cast-vote tenant filter — real Postgres",',
      ]),
    ).toBe("rel-032 cast-vote tenant filter — real Postgres");
  });

  it("returns null when no quoted string of at least 6 chars is found", () => {
    expect(extractTitle(["it.skip(", "  async () => {"])).toBe(null);
  });
});

describe("flaky-skip-guard: hasSecondArgument()", () => {
  it("detects a comma indicating a second (message) argument was passed", () => {
    expect(hasSecondArgument(['test.skip(stillMissing, "reason text here");'])).toBe(true);
  });

  it("returns false for a single-argument test.skip(condition) with no message", () => {
    expect(hasSecondArgument(["test.skip(stillMissing);", "// next test starts here with no message arg"])).toBe(
      false,
    );
  });
});

describe("flaky-skip-guard: parseGovernanceTag() + evaluateGovernance()", () => {
  const TODAY = "2026-09-14";

  it("parses a reason with no expiry", () => {
    const tag = parseGovernanceTag("  // FLAKY-SKIP: payroll-service route, not hrms-service");
    expect(tag.reason).toBe("payroll-service route, not hrms-service");
    expect(tag.expires).toBe(null);
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "ok" });
  });

  it("parses a reason with a future expiry as ok", () => {
    const tag = parseGovernanceTag("// FLAKY-SKIP: requires real Postgres (expires: 2026-12-13)");
    expect(tag.expires).toBe("2026-12-13");
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "ok" });
  });

  it("treats a past expiry as expired, even with a real reason", () => {
    const tag = parseGovernanceTag("// FLAKY-SKIP: requires real Postgres (expires: 2026-01-01)");
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "expired", expires: "2026-01-01" });
  });

  it("returns status 'missing' when there is no tag at all", () => {
    expect(evaluateGovernance(parseGovernanceTag("const x = 1;"), TODAY)).toEqual({ status: "missing" });
    expect(evaluateGovernance(parseGovernanceTag(undefined), TODAY)).toEqual({ status: "missing" });
  });

  it("returns status 'empty' when the tag has neither a real reason nor an expiry", () => {
    const tag = parseGovernanceTag("// FLAKY-SKIP: tbd");
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "empty" });
  });

  it("an expiry alone (very short reason text) still counts as governed", () => {
    const tag = parseGovernanceTag("// FLAKY-SKIP: (expires: 2026-12-13)");
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "ok" });
  });

  it("matches a trailing same-line comment form too", () => {
    const tag = parseGovernanceTag(
      '  it.skip("x", fn); // FLAKY-SKIP: legacy, superseded (expires: 2026-12-13)',
    );
    expect(tag.reason).toBe("legacy, superseded");
    expect(evaluateGovernance(tag, TODAY)).toEqual({ status: "ok" });
  });
});
