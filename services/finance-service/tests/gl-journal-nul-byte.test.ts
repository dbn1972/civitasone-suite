/**
 * A NUL byte in a journal's text fields is refused at the schema boundary (400),
 * not allowed to reach Postgres, which rejects it ("invalid byte sequence ...
 * 0x00") and surfaced as an unhandled 500 from the duplicate-voucher lookup.
 * Found by the L4 API-contract lane (null bytes in string field -> rejected).
 */
import { describe, it, expect } from "vitest";
import { postJournalBody } from "../src/modules/gl/validators.js";

const lines = [
  { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
  { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
];
const base = { voucherNo: "VCH-1", type: "journal" as const, postingDate: "2024-07-01", lines };

describe("postJournalBody -- NUL bytes", () => {
  it("accepts a normal journal", () => {
    expect(postJournalBody.safeParse(base).success).toBe(true);
  });

  it("rejects a NUL in voucherNo with a field-level issue", () => {
    const r = postJournalBody.safeParse({ ...base, voucherNo: "VCH\u0000-NULL" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["voucherNo"]);
  });

  it("rejects a NUL in a line accountCode", () => {
    const r = postJournalBody.safeParse({
      ...base,
      lines: [{ ...lines[0]!, accountCode: "00\u00001" }, lines[1]],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a NUL in overrideReason", () => {
    const r = postJournalBody.safeParse({ ...base, budgetOverride: true, overrideReason: "ok\u0000" });
    expect(r.success).toBe(false);
  });
});
