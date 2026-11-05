/**
 * PR #2458 review SF3 (ERP-head decision 2026-11-05) -- producer/consumer
 * contract for the EPF A/c 2 minimum top-up journal payroll-service sends to
 * finance-service's journal command (finance.gl.post, generic journal path)
 * when a month's EPF challan is closed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminTopUpJournal } from "../../services/payroll-service/src/modules/statutory/admin-topup.js";
import { INTEGRATION } from "../../services/payroll-service/src/topics.js";
import { assertJournalBalances, assertJournalHasAmount } from "../../services/finance-service/src/modules/gl/domain.js";
import { COMMANDS as FINANCE_COMMANDS } from "../../services/finance-service/src/topics.js";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("EPF A/c 2 minimum top-up journal (payroll-service -> finance-service)", () => {
  it("payroll sends the journal on finance's journal command topic, from the shared builder", () => {
    expect(INTEGRATION.glPost).toBe(FINANCE_COMMANDS.journalPost);
    const src = read("services/payroll-service/src/modules/statutory/challan-close.ts");
    expect(src).toMatch(/topic: INTEGRATION\.glPost[\s\S]{0,200}adminTopUpJournal\(/);
    expect(read("services/finance-service/src/modules/gl/consumer.ts")).toMatch(/queue\.subscribe\(COMMANDS\.journalPost/);
  });

  it("the journal passes finance's journal rules and posts on the employer contribution heads", () => {
    const j = JSON.parse(JSON.stringify(adminTopUpJournal({ journalId: "00000000-0000-4000-8000-000000000001", tenantId: "t", period: "2027-02", topUpMinor: 5_000n, postingDate: "2027-03-15" })));
    expect(() => assertJournalBalances(j.lines)).not.toThrow();
    expect(() => assertJournalHasAmount(j.lines)).not.toThrow();
    expect(j).toMatchObject({ type: "payroll_accrual", voucherNo: "PAY/EPF-A2/2027-02", postingDate: "2027-03-15" });
    expect(j.lines.map((l: { accountCode: string }) => l.accountCode)).toEqual(["5002", "2103"]);
    for (const l of j.lines) expect(typeof l.debitMinor).toBe("string");
  });
});
