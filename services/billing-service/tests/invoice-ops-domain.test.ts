import { describe, it, expect } from "vitest";
import { amountProblem, formatPaise, isSettleable, normaliseReference, paidOnProblem, referenceProblem, todayIst } from "../src/modules/invoice-ops/domain.js";

describe("offline payment rules (GAP-ADMIN-INVOICES-06)", () => {
  it("checks the reference format per mode, after upper-casing and removing spaces", () => {
    expect(referenceProblem("neft", normaliseReference("sbin 5233 4567 8901"))).toBeNull();
    expect(referenceProblem("neft", "SBIN52334567890")).toMatch(/16 characters/);
    expect(referenceProblem("neft", "1234523345678901")).toMatch(/16 characters/); // no bank code
    expect(referenceProblem("rtgs", "HDFCR52023010112345678")).toBeNull();
    expect(referenceProblem("rtgs", "SBIN523345678901")).toMatch(/22 characters/);
    expect(referenceProblem("cheque", "123456")).toBeNull();
    expect(referenceProblem("cheque", "12345")).toMatch(/6 digits/);
    expect(referenceProblem("cheque", "12A456")).toMatch(/6 digits/);
    expect(referenceProblem("dd", "123456789012")).toBeNull();
    expect(referenceProblem("dd", "1234567890123")).toMatch(/6 to 12/);
  });

  it("paid-on: a real date, not in the future, not before the invoice date", () => {
    expect(paidOnProblem("2026-09-15", "2026-10-03", "2026-09-01")).toBeNull();
    expect(paidOnProblem("2026-10-03", "2026-10-03", "2026-09-01")).toBeNull();
    expect(paidOnProblem("2026-10-04", "2026-10-03", "2026-09-01")).toMatch(/future/);
    expect(paidOnProblem("2026-08-31", "2026-10-03", "2026-09-01")).toMatch(/before the invoice/);
    expect(paidOnProblem("2026-02-30", "2026-10-03", "2026-01-01")).toMatch(/valid date/);
    expect(paidOnProblem("03/10/2026", "2026-10-03", "2026-01-01")).toMatch(/valid date/);
  });

  it("amount must equal the outstanding paise exactly", () => {
    expect(amountProblem(250050n, 0n, 250050n)).toBeNull();
    expect(amountProblem(250050n, 50000n, 200050n)).toBeNull();
    expect(amountProblem(250050n, 0n, 250049n)).toMatch(/must equal the outstanding amount \(250050 paise\)/);
    expect(amountProblem(250050n, 0n, 250051n)).toMatch(/partial offline payments are not supported/);
    expect(amountProblem(250050n, 250050n, 1n)).toMatch(/nothing outstanding/);
  });

  it("only unpaid, live invoices can be settled offline (webhook-paid, cancelled, draft never)", () => {
    for (const s of ["issued", "partially_paid", "overdue"]) expect(isSettleable(s)).toBe(true);
    for (const s of ["paid", "cancelled", "waived", "draft"]) expect(isSettleable(s)).toBe(false);
  });

  it("formats paise with lakh grouping and no floating point", () => {
    expect(formatPaise(250050n)).toBe("Rs 2,500.50");
    expect(formatPaise(1234567890n)).toBe("Rs 1,23,45,678.90");
    expect(formatPaise(5n)).toBe("Rs 0.05");
    expect(todayIst(new Date("2026-10-03T20:00:00Z"))).toBe("2026-10-04"); // already the 4th in India
  });
});
