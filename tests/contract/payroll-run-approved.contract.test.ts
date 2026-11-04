/**
 * UAT b18 (ERP-head decision 2026-11-05, PR #2458) -- producer/consumer
 * contract for payroll.run.approved (payroll-service -> finance-service GL
 * accrual). The employer EDLI (EPFO A/c 21), EPF admin charges (A/c 2) and the
 * Government 8.5% UPS pool share are payable and must be accrued, each on its
 * own line, without changing the long-standing employer-contribution pair.
 * Feeds the exact payload payroll builds to the finance line builder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runApprovedPayload } from "../../services/payroll-service/src/modules/payroll/run-approved-payload.js";
import { payrollAccrualLines, EMPLOYER_EXPENSE_HEAD, EMPLOYER_PAYABLE_HEAD } from "../../services/finance-service/src/modules/integrations/payroll-accrual.js";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const balanced = (lines: Array<{ debitMinor: bigint; creditMinor: bigint }>) => lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0n) === 0n;
const rows = (lines: ReturnType<typeof payrollAccrualLines>) => lines.map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString(), l.narration]);

const base = { runId: "11111111-1111-4111-8111-111111111111", month: "2027-02", totalGrossMinor: 21_375_600n, totalNetMinor: 20_295_600n, totalEmployerContribMinor: 1_080_000n };

describe("payroll.run.approved contract (payroll-service -> finance-service)", () => {
  it("payroll emits the shared payload builder on EVENTS.runApproved, with the run EDLI / admin / UPS pool totals", () => {
    const src = read("services/payroll-service/src/modules/payroll/consumer.ts");
    expect(src).toMatch(/topic: EVENTS\.runApproved[\s\S]{0,200}payload: runApprovedPayload\(/);
    expect(src).toMatch(/sumEmployerChargesByRunTx\(tx, p\.id, p\.tenantId\)/);
    expect(read("services/finance-service/src/topics.ts")).toMatch(/payrollRunApproved:\s*"payroll\.run\.approved"/);
  });

  it("finance builds the accrual from the shared line builder", () => {
    const src = read("services/finance-service/src/modules/integrations/consumer.ts");
    const at = src.indexOf("CONSUMED_EVENTS.payrollRunApproved");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 1500)).toMatch(/payrollAccrualLines\(p\)/);
  });

  it("EDLI, EPF admin and UPS pool are posted as their own balanced lines, apart from the employer contributions", () => {
    const payload = runApprovedPayload({ ...base, edliMinor: 45_000n, epfAdminMinor: 45_000n, upsPoolMinor: 671_500n, legalEntityId: null });
    expect(payload).toMatchObject({ totalEdliMinor: "45000", totalEpfAdminMinor: "45000", totalUpsPoolMinor: "671500" });
    expect(payload).not.toHaveProperty("legalEntityId");
    const lines = payrollAccrualLines(JSON.parse(JSON.stringify(payload)));
    expect(rows(lines)).toEqual([
      ["5001", "21375600", "0", "Salary expense"],
      ["2101", "0", "20295600", "Net salary payable"],
      ["2102", "0", "1080000", "Statutory deductions payable"],
      [EMPLOYER_EXPENSE_HEAD, "1080000", "0", "Employer contributions expense"],
      [EMPLOYER_PAYABLE_HEAD, "0", "1080000", "Employer contributions payable"],
      [EMPLOYER_EXPENSE_HEAD, "45000", "0", "Employer EDLI contribution (EPFO A/c 21)"],
      [EMPLOYER_PAYABLE_HEAD, "0", "45000", "EDLI contribution payable to EPFO (A/c 21)"],
      [EMPLOYER_EXPENSE_HEAD, "45000", "0", "EPF administrative charges (EPFO A/c 2)"],
      [EMPLOYER_PAYABLE_HEAD, "0", "45000", "EPF administrative charges payable to EPFO (A/c 2)"],
      [EMPLOYER_EXPENSE_HEAD, "671500", "0", "Government UPS pool corpus contribution (8.5%)"],
      [EMPLOYER_PAYABLE_HEAD, "0", "671500", "UPS pool corpus contribution payable"],
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("zero charges add no lines; a payload from an older payroll build (no new fields) posts exactly the old lines", () => {
    const zero = payrollAccrualLines(JSON.parse(JSON.stringify(runApprovedPayload({ ...base, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n }))));
    const legacy = payrollAccrualLines({ runId: base.runId, month: base.month, totalGrossMinor: "21375600", totalNetMinor: "20295600", totalEmployerContribMinor: "1080000" });
    expect(rows(zero)).toEqual(rows(legacy));
    expect(legacy).toHaveLength(5);
    expect(balanced(legacy)).toBe(true);
  });

  it("the legal entity travels when the run has one", () => {
    expect(runApprovedPayload({ ...base, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n, legalEntityId: "le-1" }).legalEntityId).toBe("le-1");
  });
});
