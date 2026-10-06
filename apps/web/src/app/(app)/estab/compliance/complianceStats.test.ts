import { describe, it, expect } from "vitest";
import {
  daysBetween,
  countEscalated,
  complianceRate,
  ESCALATION_DAYS,
  type ComplianceItemLike,
} from "./complianceStats";

// ---------------------------------------------------------------------------
// GAP-ESTAB-COMPLIANCE-01 — escalation is now "overdue > ESCALATION_DAYS days"
// ---------------------------------------------------------------------------
describe("daysBetween", () => {
  it("returns 0 for same day", () => {
    expect(daysBetween("2026-09-29", "2026-09-29")).toBe(0);
  });
  it("returns positive when a > b", () => {
    expect(daysBetween("2026-10-06", "2026-09-29")).toBe(7);
  });
  it("returns negative when a < b", () => {
    expect(daysBetween("2026-09-29", "2026-10-06")).toBe(-7);
  });
  it("handles ISO timestamps by truncating to date", () => {
    expect(daysBetween("2026-10-06T23:59:59Z", "2026-10-06T00:00:00Z")).toBe(0);
  });
  it("returns 0 for invalid dates", () => {
    expect(daysBetween("invalid", "2026-10-06")).toBe(0);
  });
});

describe("countEscalated", () => {
  const today = "2026-10-06";
  const items = (specs: Array<{ status: ComplianceItemLike["status"]; dueDate: string }>): ComplianceItemLike[] =>
    specs.map((s) => ({ status: s.status, dueDate: s.dueDate }));

  it("counts only overdue items older than ESCALATION_DAYS", () => {
    const data = items([
      { status: "overdue", dueDate: "2026-09-28" }, // 8 days ago → escalated
      { status: "overdue", dueDate: "2026-09-29" }, // 7 days ago → NOT escalated (== threshold)
      { status: "overdue", dueDate: "2026-10-05" }, // 1 day ago → not escalated
      { status: "pending", dueDate: "2026-09-01" }, // old but not overdue status
      { status: "complied", dueDate: "2026-09-01" },
    ]);
    expect(countEscalated(data, today)).toBe(1);
  });

  it("returns 0 when no items", () => {
    expect(countEscalated([], today)).toBe(0);
  });

  it("returns 0 when all overdue items are recent", () => {
    const data = items([
      { status: "overdue", dueDate: "2026-10-05" },
      { status: "overdue", dueDate: "2026-10-04" },
    ]);
    expect(countEscalated(data, today)).toBe(0);
  });

  it("ESCALATION_DAYS is 7", () => {
    expect(ESCALATION_DAYS).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// GAP-ESTAB-COMPLIANCE-02 — null rate on empty register
// ---------------------------------------------------------------------------
describe("complianceRate", () => {
  it("returns null for empty items", () => {
    expect(complianceRate([])).toBeNull();
  });

  it("returns 0 when none complied", () => {
    const data: ComplianceItemLike[] = [
      { status: "pending", dueDate: "2026-10-10" },
      { status: "overdue", dueDate: "2026-09-01" },
    ];
    expect(complianceRate(data)).toBe(0);
  });

  it("returns 100 when all complied", () => {
    const data: ComplianceItemLike[] = [
      { status: "complied", dueDate: "2026-10-10" },
    ];
    expect(complianceRate(data)).toBe(100);
  });

  it("returns 50 when half complied", () => {
    const data: ComplianceItemLike[] = [
      { status: "complied", dueDate: "2026-10-01" },
      { status: "pending", dueDate: "2026-10-10" },
    ];
    expect(complianceRate(data)).toBe(50);
  });
});
