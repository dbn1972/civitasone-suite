/**
 * Workforce Core — posting-ledger flag parsing (ST-M01-07).
 *
 * The flag is the "live behind a flag" switch (M01 exit criterion 2). It must
 * default OFF and only turn on for the exact string "true" (no z.coerce.boolean,
 * house rule 8).
 */
import { describe, it, expect } from "vitest";
import { isPostingLedgerEnabled, POSTING_LEDGER_FLAG } from "../src/modules/workforce-core/config.js";

describe("workforce-core posting-ledger flag", () => {
  it("is off when unset (fail-safe default)", () => {
    expect(isPostingLedgerEnabled({})).toBe(false);
  });

  it('is on only for the exact string "true" (case/space tolerant)', () => {
    expect(isPostingLedgerEnabled({ [POSTING_LEDGER_FLAG]: "true" })).toBe(true);
    expect(isPostingLedgerEnabled({ [POSTING_LEDGER_FLAG]: "TRUE" })).toBe(true);
    expect(isPostingLedgerEnabled({ [POSTING_LEDGER_FLAG]: "  true  " })).toBe(true);
  });

  it("is off for every non-true value", () => {
    for (const v of ["false", "1", "0", "yes", "on", "", "enabled", "True x"]) {
      expect(isPostingLedgerEnabled({ [POSTING_LEDGER_FLAG]: v })).toBe(false);
    }
  });

  it("exposes a stable flag name", () => {
    expect(POSTING_LEDGER_FLAG).toBe("WORKFORCE_CORE_LEDGER_ENABLED");
  });
});
