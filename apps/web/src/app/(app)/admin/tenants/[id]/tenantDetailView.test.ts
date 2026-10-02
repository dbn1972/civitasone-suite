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
  it("settingsRows is sorted and stringifies nested values", () => {
    expect(settingsRows({ b: { x: 1 }, a: "z", c: null })).toEqual([
      { key: "a", value: "z" }, { key: "b", value: '{"x":1}' }, { key: "c", value: "—" },
    ]);
    expect(settingsRows(undefined)).toEqual([]);
    const nested = settingsRows({ smtp: { host: "h", pass: "p1", deep: { apiKey: "k1", dsn: "d1" } }, list: [{ authToken: "t" }], msme: { gstin: "G" } });
    const dump = JSON.stringify(nested);
    for (const leak of ["p1", "k1", "d1", '"t"']) expect(dump).not.toContain(leak);
    expect(nested.find((r) => r.key === "smtp")!.value).toContain('"host":"h"');
    expect(dump).toContain("G");
    expect(settingsRows({ smtpPassword: "hunter2" })[0]!.value).toBe("••••••");
  });
});
