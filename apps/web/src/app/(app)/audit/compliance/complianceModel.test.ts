import { describe, it, expect } from "vitest";
import type { AuditComplianceItem } from "@civitasone/types";
import { complianceCounts, partitionCompliance } from "./complianceModel";

function item(partial: Partial<AuditComplianceItem>): AuditComplianceItem {
  return {
    id: "x",
    lawOrRule: "Rule",
    requirement: "req",
    frequency: "annual",
    dueDate: "2026-01-01",
    department: "Dept",
    status: "pending",
    ...partial,
  } as AuditComplianceItem;
}

describe("complianceCounts (GAP-AUDIT-COMPLIANCE-04)", () => {
  it("score denominator is actionable (complied+pending+overdue), excluding na", () => {
    const items = [
      item({ status: "complied" }),
      item({ status: "complied" }),
      item({ status: "pending" }),
      item({ status: "na" }),
    ];
    const c = complianceCounts(items);
    expect(c.actionable).toBe(3); // 2 complied + 1 pending
    expect(c.scorePct).toBe(67); // round(2/3*100)
    expect(c.openActions).toBe(1); // pending + overdue
    expect(c.na).toBe(1);
  });

  it("scorePct is null when nothing is actionable", () => {
    const c = complianceCounts([item({ status: "na" })]);
    expect(c.scorePct).toBeNull();
    expect(c.openActions).toBe(0);
  });
});

describe("partitionCompliance (GAP-AUDIT-COMPLIANCE-03)", () => {
  it("an item matching both DPDP and regulatory terms appears in exactly one card", () => {
    const items = [item({ id: "a", lawOrRule: "DPDP Data ISO 27001" })];
    const { dpdp, regulatory, other } = partitionCompliance(items);
    expect(dpdp).toHaveLength(1);
    expect(regulatory).toHaveLength(0);
    expect(other).toHaveLength(0);
  });

  it("no item is duplicated; unmatched items land in 'other'", () => {
    const items = [
      item({ id: "a", lawOrRule: "DPDP Act" }),
      item({ id: "b", lawOrRule: "CERT-In direction" }),
      item({ id: "c", lawOrRule: "Municipal bye-law" }),
    ];
    const { dpdp, regulatory, other } = partitionCompliance(items);
    expect(dpdp.map((i) => i.id)).toEqual(["a"]);
    expect(regulatory.map((i) => i.id)).toEqual(["b"]);
    expect(other.map((i) => i.id)).toEqual(["c"]);
    const all = [...dpdp, ...regulatory, ...other].map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
