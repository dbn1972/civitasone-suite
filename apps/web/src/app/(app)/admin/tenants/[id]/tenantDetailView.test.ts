import { describe, it, expect } from "vitest";
import { seatsInUse, usagePillClass, settingsRows } from "./tenantDetailView";

const m = (users: number | null) => ({ module: "x", enabled: "Yes", users, lastActivity: "—", usage: "—" });

describe("tenantDetailView", () => {
  it("seatsInUse sums reported counts and is null (dash) when none reported", () => {
    expect(seatsInUse([m(10), m(10)])).toBe(20);
    expect(seatsInUse([m(null), m(4)])).toBe(4);
    expect(seatsInUse([m(null)])).toBeNull();
    expect(seatsInUse([])).toBeNull();
  });
  it("usagePillClass gives High/Medium/Low distinct tones", () => {
    expect(new Set([usagePillClass("High"), usagePillClass("Medium"), usagePillClass("Low")]).size).toBe(3);
    expect(usagePillClass("—")).toBe("info");
  });
  it("settingsRows is sorted, labels keys and stringifies nested values", () => {
    // GAP2-ADMIN-TENANTS-DETAIL-01: keys are now human-labelled (title-cased)
    // and sorted by the original key.
    expect(settingsRows({ b: { x: 1 }, a: "z", c: null })).toEqual([
      { key: "A", value: "z" }, { key: "B", value: '{"x":1}' }, { key: "C", value: "—" },
    ]);
    expect(settingsRows(undefined)).toEqual([]);
    const nested = settingsRows({ smtp: { host: "h", pass: "p1", deep: { apiKey: "k1", dsn: "d1" } }, list: [{ authToken: "t" }], msme: { gstin: "G" } });
    const dump = JSON.stringify(nested);
    for (const leak of ["p1", "k1", "d1", '"t"']) expect(dump).not.toContain(leak);
    expect(nested.find((r) => r.key === "Smtp")!.value).toContain('"host":"h"');
    expect(dump).toContain("G");
    expect(settingsRows({ smtpPassword: "hunter2" })[0]!.value).toBe("••••••");
  });

  // GAP2-ADMIN-TENANTS-DETAIL-01: structural/internal keys surfaced elsewhere
  // (approvalPolicy -> ApprovalPolicyCard) must not be dumped as a raw blob;
  // known keys get human labels.
  it("settingsRows omits structural keys and labels known keys", () => {
    const rows = settingsRows({ approvalPolicy: { requireTwo: true }, orgType: "psu", gstin: "22AAAAA0000A1Z5" });
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain("approvalPolicy");
    expect(keys).not.toContain("Approval Policy");
    expect(rows.find((r) => r.key === "Organisation Type")!.value).toBe("psu");
    expect(rows.find((r) => r.key === "GSTIN")!.value).toBe("22AAAAA0000A1Z5");
  });
});
