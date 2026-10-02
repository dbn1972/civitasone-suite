import { describe, it, expect } from "vitest";
import { buildVoucherLines, fmtMinor, escHtml } from "../src/modules/voucher-print/render.js";

describe("voucher print totals are bigint (no float drift)", () => {
  it("sums above 2^53 paise exactly", () => {
    const big = 9007199254740993n; // 2^53 + 1
    const r = buildVoucherLines([
      { accountCode: "1000", debitMinor: big.toString(), creditMinor: "0" },
      { accountCode: "2000", debitMinor: "1", creditMinor: big.toString() },
    ]);
    expect(r.totalDebit).toBe(fmtMinor(big + 1n));
    expect(r.totalCredit).toBe(fmtMinor(big));
    expect(r.totalCredit.endsWith("47,409.93")).toBe(true); // a float sum would have shown ...409.92
    expect(r.totalDebit).not.toBe(r.totalCredit);
  });
  it("formats paise with Indian grouping and 2 decimals", () => {
    expect(fmtMinor(12345678n)).toBe("1,23,456.78");
    expect(fmtMinor(5n)).toBe("0.05");
    expect(fmtMinor(-250n)).toBe("-2.50");
  });
  it("escapes account codes", () => {
    expect(escHtml("<b>")).toBe("&lt;b&gt;");
    expect(buildVoucherLines([{ accountCode: "<x>", debitMinor: 1, creditMinor: 0 }]).lineRows).toContain("&lt;x&gt;");
  });
});
