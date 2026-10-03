import { describe, it, expect } from "vitest";
import {
  validatePaySchedule, payDatesForMonth, isoWeek, canTransitionPensioner, maskPpoNo,
  revisionSanityIssue, buildReimbursementAttachmentKey, reimbursementAttachmentPrefix, receiptRuleViolation, receiptRequired,
} from "../src/modules/payroll/fin03-domain.js";
import { createSalaryRevisionBody, createReimbursementBody, updateSettingsBody } from "../src/modules/payroll/validators.js";
import { stateRulesBody } from "../src/modules/payroll/state-rules.js";
import { aggregateRegister } from "../src/modules/payroll/register.js";
import type { PayrollSlipRow } from "../src/modules/payroll/schema.js";

describe("pay-group schedules (GAP-PAYROLL-PAY-GROUPS-01)", () => {
  it("validates the combination for each frequency", () => {
    expect(validatePaySchedule({ frequency: "monthly", payDayOfMonth: 5 })).toBeNull();
    expect(validatePaySchedule({ frequency: "monthly", payDayOfMonth: 31, payLastDay: true })).toBeNull();
    expect(validatePaySchedule({ frequency: "monthly", payDayOfMonth: 5, payWeekday: 5 })).toMatch(/weekday/);
    expect(validatePaySchedule({ frequency: "weekly", payDayOfMonth: 5, payWeekday: 5 })).toBeNull();
    expect(validatePaySchedule({ frequency: "weekly", payDayOfMonth: 5, payLastDay: true })).toMatch(/monthly/);
    expect(validatePaySchedule({ frequency: "weekly", payDayOfMonth: 5, payWeekday: 5, payWeekParity: 1 })).toMatch(/bi-weekly/);
    expect(validatePaySchedule({ frequency: "bi_weekly", payDayOfMonth: 5, payWeekParity: 1 })).toMatch(/weekday/);
    expect(validatePaySchedule({ frequency: "bi_weekly", payDayOfMonth: 5, payWeekday: 5, payWeekParity: 1 })).toBeNull();
    // legacy weekly / bi-weekly rows (day-of-month only) stay valid
    expect(validatePaySchedule({ frequency: "weekly", payDayOfMonth: 28 })).toBeNull();
  });

  it("monthly: clamps 29-31 to the month's last day, or pays exactly on the last day", () => {
    expect(payDatesForMonth({ frequency: "monthly", payDayOfMonth: 31 }, 2026, 4)).toEqual(["2026-04-30"]);
    expect(payDatesForMonth({ frequency: "monthly", payDayOfMonth: 31 }, 2028, 2)).toEqual(["2028-02-29"]);
    expect(payDatesForMonth({ frequency: "monthly", payDayOfMonth: 5, payLastDay: true }, 2026, 2)).toEqual(["2026-02-28"]);
    expect(payDatesForMonth({ frequency: "monthly", payDayOfMonth: 5 }, 2026, 7)).toEqual(["2026-07-05"]);
  });

  it("weekly: every pay weekday in the month (ISO 5 = Friday)", () => {
    expect(payDatesForMonth({ frequency: "weekly", payDayOfMonth: 28, payWeekday: 5 }, 2026, 7))
      .toEqual(["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
    expect(payDatesForMonth({ frequency: "weekly", payDayOfMonth: 28, payWeekday: 7 }, 2026, 2)).toEqual(["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"]);
  });

  it("bi-weekly: alternate ISO weeks, odd vs even are complementary", () => {
    const odd = payDatesForMonth({ frequency: "bi_weekly", payDayOfMonth: 28, payWeekday: 5, payWeekParity: 1 }, 2026, 7);
    const even = payDatesForMonth({ frequency: "bi_weekly", payDayOfMonth: 28, payWeekday: 5, payWeekParity: 0 }, 2026, 7);
    expect([...odd, ...even].sort()).toEqual(["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
    expect(odd.every((d) => !even.includes(d))).toBe(true);
    // 2026-07-03 is ISO week 27 (odd)
    expect(isoWeek(2026, 7, 3)).toBe(27);
    expect(odd).toContain("2026-07-03");
  });

  it("a weekly group with no weekday (legacy) keeps the legacy day-of-month rule, so existing calendars do not move", () => {
    expect(payDatesForMonth({ frequency: "weekly", payDayOfMonth: 31 }, 2026, 4)).toEqual(["2026-04-30"]);
  });

  it("ISO week numbering around the year boundary", () => {
    expect(isoWeek(2026, 1, 1)).toBe(1);
    expect(isoWeek(2027, 1, 1)).toBe(53); // Fri 1 Jan 2027 belongs to week 53 of 2026
  });
});

describe("pensioner status + masking", () => {
  it("only active -> stopped | deceased and stopped -> deceased are allowed", () => {
    expect(canTransitionPensioner("active", "stopped")).toBe(true);
    expect(canTransitionPensioner("active", "deceased")).toBe(true);
    expect(canTransitionPensioner("stopped", "deceased")).toBe(true);
    expect(canTransitionPensioner("stopped", "stopped")).toBe(false);
    expect(canTransitionPensioner("stopped", "active")).toBe(false);
    expect(canTransitionPensioner("deceased", "stopped")).toBe(false);
    expect(canTransitionPensioner("deceased", "active")).toBe(false);
  });

  it("masks a PPO number to its last four characters", () => {
    expect(maskPpoNo("PPO/2024/00123")).toBe("••••0123");
    expect(maskPpoNo("AB")).toBe("••••");
    expect(maskPpoNo("")).toBe("");
    expect(maskPpoNo(null)).toBe("");
  });
});

describe("salary revision sanity (GAP-PAYROLL-SALARY-REVISIONS-03)", () => {
  const base = { oldBasicMinor: 4000000, newBasicMinor: 4400000, oldGrossMinor: 8000000, newGrossMinor: 8800000, revisionType: "annual_increment" };
  it("flags the first broken rule", () => {
    expect(revisionSanityIssue(base)).toBeNull();
    expect(revisionSanityIssue({ ...base, newGrossMinor: 4000000 })?.path).toBe("newGrossMinor");
    expect(revisionSanityIssue({ ...base, oldGrossMinor: 0 })?.path).toBe("oldGrossMinor");
    expect(revisionSanityIssue({ ...base, oldBasicMinor: 0 })?.path).toBe("oldGrossMinor");
    expect(revisionSanityIssue({ ...base, oldGrossMinor: 3000000 })?.path).toBe("oldGrossMinor");
    expect(revisionSanityIssue({ ...base, newBasicMinor: 3000000 })?.path).toBe("newBasicMinor");
    expect(revisionSanityIssue({ ...base, newBasicMinor: 3000000, revisionType: "correction" })).toBeNull();
    // a first-ever fixation (no old pay) is fine
    expect(revisionSanityIssue({ ...base, oldBasicMinor: 0, oldGrossMinor: 0 })).toBeNull();
  });

  it("is enforced by the zod boundary of POST /salary-revisions", () => {
    const body = { employeeId: "11111111-1111-4111-8111-111111111111", effectiveDate: "2026-04-01", orderNo: "ORD-1", ...base };
    expect(createSalaryRevisionBody.safeParse(body).success).toBe(true);
    const r = createSalaryRevisionBody.safeParse({ ...body, newGrossMinor: 4000000 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["newGrossMinor"]);
  });
});

describe("other boundaries", () => {
  it("state rules: only state / UT codes, upper-cased (PT slabs are versioned, not part of this body)", () => {
    expect(stateRulesBody.safeParse({ stateCode: "ZZ" }).success).toBe(false);
    expect(stateRulesBody.safeParse({ stateCode: "X" }).success).toBe(false);
    const ok = stateRulesBody.parse({ stateCode: " ka ", lwfEmployee: 100 });
    expect(ok.stateCode).toBe("KA");
    expect("ptSlabs" in ok).toBe(false);
  });

  it("settings accept the second-approver switch", () => {
    expect(updateSettingsBody.parse({ protectedNetFloorMinor: 0, salaryRevisionSecondApprover: false }).salaryRevisionSecondApprover).toBe(false);
    expect(updateSettingsBody.safeParse({ protectedNetFloorMinor: 0, salaryRevisionSecondApprover: "no" }).success).toBe(false);
  });

  it("reimbursement attachment keys are bounded to five", () => {
    const base = { employeeId: "11111111-1111-4111-8111-111111111111", category: "medical", amountMinor: 100, period: "2026-08" };
    expect(createReimbursementBody.safeParse({ ...base, attachmentKeys: ["a", "b", "c", "d", "e"] }).success).toBe(true);
    expect(createReimbursementBody.safeParse({ ...base, attachmentKeys: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });

  it("builds a tenant-scoped, sanitised receipt key", () => {
    const key = buildReimbursementAttachmentKey("t1", "actor1", "u1", "../my bill (1).pdf");
    expect(key.startsWith(reimbursementAttachmentPrefix("t1"))).toBe(true);
    expect(key).toBe("payroll/t1/reimbursements/actor1/u1/.._my_bill_1_.pdf");
    expect(key.split("/").slice(-1)[0]).not.toContain("/");
  });
});

describe("register GPF / NPS (GAP-PAYROLL-REGISTER-04)", () => {
  const slip = (over: Partial<PayrollSlipRow>): PayrollSlipRow => ({
    employeeId: "e1", grossMinor: 100000n, totalDeductionsMinor: 30000n, netPayMinor: 70000n,
    pfEmployeeMinor: 0n, esiMinor: 0n, tdsMinor: 5000n, gpfMinor: 10000n, npsEmployeeMinor: 8000n, npsEmployerMinor: 9000n,
    components: [], ...over,
  } as unknown as PayrollSlipRow);

  it("sums GPF and the EMPLOYEE NPS share (not the employer share) per department", () => {
    const rows = aggregateRegister(
      [slip({}), slip({ employeeId: "e2", gpfMinor: 20000n, npsEmployeeMinor: 0n })],
      new Map([["e1", { departmentId: "d1", departmentName: "Revenue" }], ["e2", { departmentId: "d1", departmentName: "Revenue" }]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalGpfMinor).toBe(30000n);
    expect(rows[0]!.totalNpsMinor).toBe(8000n);
  });
});

describe("receipt rule (GAP-PAYROLL-REIMBURSEMENTS-03, server-enforced)", () => {
  const own = (t: string, a: string) => `payroll/${t}/reimbursements/${a}/u1/bill.pdf`;
  it("uses the shared category list", () => {
    expect(["medical", "lta", "travel"].every(receiptRequired)).toBe(true);
    expect(["food", "fuel", "other"].some(receiptRequired)).toBe(false);
  });
  it("requires a receipt for medical / lta / travel and none for the rest", () => {
    expect(receiptRuleViolation("t", "a", "medical", undefined)).toBe("RECEIPT_REQUIRED");
    expect(receiptRuleViolation("t", "a", "lta", [])).toBe("RECEIPT_REQUIRED");
    expect(receiptRuleViolation("t", "a", "food", [])).toBeNull();
    expect(receiptRuleViolation("t", "a", "medical", [own("t", "a")])).toBeNull();
  });
  it("rejects keys of another tenant, another claimant, or with traversal", () => {
    expect(receiptRuleViolation("t", "a", "medical", [own("t2", "a")])).toBe("RECEIPT_KEY_INVALID");
    expect(receiptRuleViolation("t", "a", "medical", [own("t", "b")])).toBe("RECEIPT_KEY_INVALID");
    expect(receiptRuleViolation("t", "a", "food", [own("t", "b")])).toBe("RECEIPT_KEY_INVALID");
    expect(receiptRuleViolation("t", "a", "medical", ["payroll/t/reimbursements/a/../b/x.pdf"])).toBe("RECEIPT_KEY_INVALID");
  });
});
