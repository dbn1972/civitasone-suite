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

  it("REL-040 regression: classifies a multi-line it.skip(\"name\", fn) as hard when the name is on the " +
    "next line rather than the match line, given the lookahead window", () => {
    const window = ["  it.skip(", '    "some flaky test",', "    () => {", "      /* body */", "    },", "  );"];
    expect(classifySkipOccurrence(window[0], window)).toEqual({
      kind: "hard",
      label: "it.skip",
    });
  });

  it("REL-040 regression: a genuine multi-line test.skip(condition, msg) with the condition on the next " +
    "line still classifies as runtime-conditional, not hard, given the lookahead window", () => {
    const window = ["  test.skip(", "    stillMissing,", '    "reason text here"', "  );"];
    expect(classifySkipOccurrence(window[0], window)).toEqual({
      kind: "runtime-conditional",
      label: "test.skip",
    });
  });

  it("without a window argument (single-line callers), a multi-line-formatted skip still falls back to the " +
    "old same-line-only behavior — the default keeps existing single-argument call sites unaffected", () => {
    expect(classifySkipOccurrence("  it.skip(")).toEqual({
      kind: "runtime-conditional",
      label: "it.skip",
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

describe("flaky-skip-guard: REL-040 end-to-end governance composition (regression)", () => {
  // scanRepo() itself isn't exported (it walks the real filesystem — see the
  // file header comment), so this mirrors its per-line decision composition
  // exactly against in-memory fixtures, the same way scanRepo() combines
  // these exported pure functions, to prove the fix holds at the level that
  // actually matters: the final governance verdict, not just classification
  // in isolation.
  const TODAY = "2026-09-14";

  function classifyAndGovern(lines, todayISO = TODAY) {
    const results = [];
    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, Math.min(i + 4, lines.length));
      const match = classifySkipOccurrence(lines[i], window);
      if (!match) continue;
      let governance;
      if (match.kind === "runtime-conditional" && hasSecondArgument(window)) {
        governance = { status: "self-documented" };
      } else {
        const sameLineTag = parseGovernanceTag(lines[i]);
        const prevLineTag = sameLineTag ? null : parseGovernanceTag(lines[i - 1]);
        governance = evaluateGovernance(sameLineTag ?? prevLineTag, todayISO);
      }
      results.push({ line: i + 1, kind: match.kind, governance });
    }
    return results;
  }

  it("flags a multi-line-formatted it.skip(\"name\", fn) with NO FLAKY-SKIP comment as missing governance " +
    "(previously silently accepted as self-documented via the runtime-conditional misclassification)", () => {
    const source = [
      'describe("some suite", () => {',
      "  it.skip(",
      '    "some flaky test",',
      "    () => {",
      "      expect(true).toBe(true);",
      "    },",
      "  );",
      "});",
    ];
    const results = classifyAndGovern(source);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ line: 2, kind: "hard", governance: { status: "missing" } });
  });

  it("a multi-line-formatted it.skip(\"name\", fn) WITH a FLAKY-SKIP comment on the line above is governed (ok)", () => {
    const source = [
      "  // FLAKY-SKIP: flaky against seeded data (expires: 2026-12-31)",
      "  it.skip(",
      '    "some flaky test",',
      "    () => {},",
      "  );",
    ];
    const results = classifyAndGovern(source);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ line: 2, kind: "hard", governance: { status: "ok" } });
  });

  it("a genuine multi-line Playwright test.skip(condition, msg) is still self-documented with no comment needed", () => {
    const source = ["  test.skip(", "    stillMissing,", '    "reason text here"', "  );"];
    const results = classifyAndGovern(source);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ line: 1, kind: "runtime-conditional", governance: { status: "self-documented" } });
  });
});
