/**
 * L10 — Domain Correctness: Finance (P0 for money)
 *
 * Asserts double-entry invariants and budget rules against golden oracles.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import { readFileSync } from "fs";

const REPO_ROOT = resolve(__dirname, "../../..");
const goldens = JSON.parse(readFileSync(resolve(__dirname, "../goldens/finance-goldens.json"), "utf-8"));

let assertJournalBalances: (lines: Array<{ debitMinor: number | bigint; creditMinor: number | bigint }>) => void;

beforeAll(async () => {
  const domain = await import(
    `${REPO_ROOT}/services/finance-service/src/modules/gl/domain.js`
  );
  assertJournalBalances = domain.assertJournalBalances;
});

describe("L10 — Double-entry journal balance (vs golden oracle)", () => {
  describe("balanced journals (should NOT throw)", () => {
    for (const tc of goldens.journal_double_entry.balanced) {
      it(`${tc.note ?? "balanced journal"}`, () => {
        expect(() => assertJournalBalances(tc.lines)).not.toThrow();
      });
    }
  });

  describe("unbalanced journals (should throw)", () => {
    for (const tc of goldens.journal_double_entry.unbalanced) {
      it(`${tc.note ?? "unbalanced journal"}`, () => {
        expect(() => assertJournalBalances(tc.lines)).toThrow(/JOURNAL/);
      });
    }
  });
});

describe("L10 — Double-entry: bigint precision (no float drift)", () => {
  it("amounts above 2^53 remain precise", () => {
    const large = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    expect(() =>
      assertJournalBalances([
        { debitMinor: large, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: large },
      ])
    ).not.toThrow();
  });

  it("off-by-one at scale is caught", () => {
    const large = 9_007_199_254_740_993n;
    expect(() =>
      assertJournalBalances([
        { debitMinor: large, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: large - 1n },
      ])
    ).toThrow(/JOURNAL_UNBALANCED/);
  });
});
