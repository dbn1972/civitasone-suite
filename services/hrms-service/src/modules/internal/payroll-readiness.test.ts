import { describe, it, expect } from "vitest";
import { payrollReadinessIssues, collectPayrollReadiness } from "./routes.js";

describe("payrollReadinessIssues (GAP-PAYROLL-DETAIL-05)", () => {
  const ok = { pan: "ABCDE1234F", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234" };

  it("a complete employee has no issues", () => {
    expect(payrollReadinessIssues(ok)).toEqual([]);
  });

  it("flags a missing or blank PAN as MISSING_PAN and a malformed one as INVALID_PAN", () => {
    expect(payrollReadinessIssues({ ...ok, pan: null })).toEqual(["MISSING_PAN"]);
    expect(payrollReadinessIssues({ ...ok, pan: "   " })).toEqual(["MISSING_PAN"]);
    expect(payrollReadinessIssues({ ...ok, pan: "ABCDE12345" })).toEqual(["INVALID_PAN"]);
    expect(payrollReadinessIssues({ ...ok, pan: "abcde1234f" })).toEqual([]); // case-insensitive, as entered
  });

  it("flags a missing account number and a missing / malformed IFSC", () => {
    expect(payrollReadinessIssues({ ...ok, bankAccountNo: null })).toEqual(["MISSING_BANK_ACCOUNT"]);
    expect(payrollReadinessIssues({ ...ok, bankIfsc: null })).toEqual(["INVALID_IFSC"]);
    expect(payrollReadinessIssues({ ...ok, bankIfsc: "SBIN1001234" })).toEqual(["INVALID_IFSC"]); // 5th char must be 0
    expect(payrollReadinessIssues({ pan: null, bankAccountNo: "", bankIfsc: "" })).toEqual(["MISSING_PAN", "MISSING_BANK_ACCOUNT", "INVALID_IFSC"]);
  });

  it("returns codes only -- never the values themselves", () => {
    const out = payrollReadinessIssues({ pan: "ABCDE12345", bankAccountNo: "123456789012", bankIfsc: "BAD" });
    expect(JSON.stringify(out)).not.toContain("ABCDE12345");
    expect(JSON.stringify(out)).not.toContain("123456789012");
  });
});

describe("collectPayrollReadiness keyset paging (GAP-PAYROLL-DETAIL-05)", () => {
  const good = { pan: "ABCDE1234F", bankAccountNo: "123456789012", bankIfsc: "SBIN0001234" };
  // 1200 employees ordered by id; one issue employee deep on the third page, one separated.
  const all = Array.from({ length: 1200 }, (_, i) => ({ id: String(i + 1).padStart(6, "0"), status: "active", ...good }));
  all[1050] = { ...all[1050]!, pan: null as unknown as string };
  all[3] = { ...all[3]!, status: "separated", pan: null as unknown as string };
  const calls: Array<string | null> = [];
  // Mimics employeeRepo.listPageAfterId: id > afterId ORDER BY id LIMIT n.
  const fetchPage = async (afterId: string | null, limit: number) => {
    calls.push(afterId);
    return all.filter((e) => afterId === null || e.id > afterId).slice(0, limit);
  };

  it("reports an issue employee on a later page exactly once, skips separated, and pages by id", async () => {
    const out = await collectPayrollReadiness(fetchPage, 500);
    expect(out).toEqual([{ employeeId: all[1050]!.id, issues: ["MISSING_PAN"] }]);
    expect(calls).toEqual([null, all[499]!.id, all[999]!.id]);
  });

  it("an exact multiple of the page size ends on the empty page without repeating anyone", async () => {
    const out = await collectPayrollReadiness(fetchPage, 400);
    expect(out.filter((o) => o.employeeId === all[1050]!.id)).toHaveLength(1);
  });
});
