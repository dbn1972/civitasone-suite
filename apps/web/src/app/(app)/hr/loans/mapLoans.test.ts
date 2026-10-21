import { describe, it, expect } from "vitest";
import { mapLoans, type ApiLoan } from "./mapLoans";

const BASE: ApiLoan = {
  id: "l1", employeeId: "e1", employeeName: "Asha Verma", department: "Finance", loanType: "hba",
  sanctionedAmountMinor: 120000000, emiMinor: 1000000, outstandingMinor: 90000000,
  totalEmis: 12, emisPaid: 3, status: "active",
};
const label = (code: string) => code.toUpperCase();

describe("mapLoans EMI progress (GAP-HR-LOANS-03)", () => {
  it("3 of 12 instalments paid reads '3 / 12' and keeps the raw counts for the bar", () => {
    const [row] = mapLoans([BASE], label);
    expect(row!.emiProgress).toBe("3 / 12");
    expect(row!.emisPaid).toBe(3);
    expect(row!.totalEmis).toBe(12);
  });

  it("a loan with no instalment schedule (totalEmis 0) is a dash, not '0 / 0'", () => {
    const [row] = mapLoans([{ ...BASE, totalEmis: 0, emisPaid: 0 }], label);
    expect(row!.emiProgress).toBe("—");
  });

  it("missing / non-numeric counts degrade to a dash instead of NaN", () => {
    const [row] = mapLoans([{ ...BASE, totalEmis: undefined as unknown as number, emisPaid: undefined as unknown as number }], label);
    expect(row!.emiProgress).toBe("—");
    expect(row!.totalEmis).toBe(0);
    expect(row!.emisPaid).toBe(0);
  });

  it("money fields stay as minor-unit numbers, passed through untouched (no float math)", () => {
    const [row] = mapLoans([BASE], label);
    expect(row!.sanctionedAmount).toBe(120000000);
    expect(row!.emi).toBe(1000000);
    expect(row!.balance).toBe(90000000);
  });

  it("never shows a raw UUID: a missing employee name is 'Unknown employee'", () => {
    const [row] = mapLoans([{ ...BASE, employeeName: undefined }], label);
    expect(row!.employee).toBe("Unknown employee");
  });
});
