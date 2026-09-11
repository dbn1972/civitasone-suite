/**
 * DOM-010 regression: period-close/repo.ts's getPeriodStatusDb/getPeriodStatusTx
 * used to fall back to "open" for ANY period string with no
 * finance_period_close row — including a malformed/garbled one that was
 * never a real accounting period to begin with (e.g. one sliced from a bad
 * postingDate upstream). That let a bogus period sail through gl/consumer.ts's
 * postJournal as if it were legitimately open.
 *
 * These tests exercise the REAL (unmocked) module directly. The malformed-
 * period branch returns "unknown" before ever touching the database, so the
 * tx-scoped variant is tested here with a tx stub that throws on any query —
 * proving the short-circuit happens before any DB round-trip, not just that
 * the return value happens to be right.
 */
import { describe, it, expect } from "vitest";
import { getPeriodStatusDb, getPeriodStatusTx } from "../src/modules/period-close/repo.js";

const ANY_TENANT = "10000000-aaaa-4000-8000-000000000001";

const MALFORMED_PERIODS = [
  "",
  "bad",
  "2026",           // missing month
  "2026-1",         // month not zero-padded
  "2026-13",        // month out of range
  "2026-00",        // month out of range
  "26-01",          // year not 4 digits
  "2026/01",        // wrong separator
];

describe("DOM-010 — period-close/repo.ts fails closed on an unrecognized period", () => {
  it("getPeriodStatusDb REGRESSION: returns 'unknown' for a malformed period, never 'open'", async () => {
    for (const bad of MALFORMED_PERIODS) {
      await expect(getPeriodStatusDb(ANY_TENANT, bad)).resolves.toBe("unknown");
    }
  });

  it("getPeriodStatusTx REGRESSION: returns 'unknown' for a malformed period WITHOUT ever querying the tx", async () => {
    const tx = {
      select: () => {
        throw new Error("must not query the DB for a period that isn't even shaped like a period");
      },
    };
    for (const bad of MALFORMED_PERIODS) {
      await expect(getPeriodStatusTx(tx, ANY_TENANT, bad)).resolves.toBe("unknown");
    }
  });

  it("a well-formed period is unaffected: getPeriodStatusTx still resolves it via the DB, not the malformed short-circuit", async () => {
    // A well-formed period with no close row must still reach the query and
    // fall back to "open" there — proving the fix only narrows the "unknown"
    // classification to genuinely malformed input, not to every period.
    const rows: unknown[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    };
    await expect(getPeriodStatusTx(tx, ANY_TENANT, "2026-01")).resolves.toBe("open");
  });
});
