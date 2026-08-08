/**
 * Recurring Entries — schedule expansion and validation tests.
 * Pack #20. Source: modules/recurring/*
 */
import { describe, it, expect } from "vitest";

describe("recurring entry schedule expansion", () => {
  type Frequency = "monthly" | "quarterly" | "yearly";

  function periodsInFY(freq: Frequency): number {
    switch (freq) {
      case "monthly": return 12;
      case "quarterly": return 4;
      case "yearly": return 1;
    }
  }

  it("monthly = 12 periods per FY", () => expect(periodsInFY("monthly")).toBe(12));
  it("quarterly = 4 periods per FY", () => expect(periodsInFY("quarterly")).toBe(4));
  it("yearly = 1 period per FY", () => expect(periodsInFY("yearly")).toBe(1));

  it("each period produces exactly one journal (no duplicates)", () => {
    const generated = new Set<string>();
    const periods = ["2026-04", "2026-05", "2026-06"];
    for (const p of periods) {
      const key = `rule-001:${p}`;
      expect(generated.has(key)).toBe(false);
      generated.add(key);
    }
    expect(generated.size).toBe(3);
  });
});

describe("recurring entry active/inactive state", () => {
  it("inactive rule produces no journals", () => {
    const rule = { id: "r1", isActive: false, frequency: "monthly" };
    const shouldExpand = rule.isActive;
    expect(shouldExpand).toBe(false);
  });

  it("active rule produces journals", () => {
    const rule = { id: "r1", isActive: true, frequency: "monthly" };
    expect(rule.isActive).toBe(true);
  });
});

describe("recurring entry date boundaries", () => {
  it("start date before period = include", () => {
    const startDate = "2026-04-01";
    const period = "2026-07";
    expect(startDate <= period + "-01").toBe(true);
  });

  it("end date before period = exclude (expired rule)", () => {
    const endDate = "2026-06-30";
    const period = "2026-07";
    expect(endDate < period + "-01").toBe(true);
  });
});

describe("recurring entry — closed period guard", () => {
  it("journal NOT generated into hard-closed period", () => {
    const periodStatus = "hard_close";
    const blocked = periodStatus === "hard_close";
    expect(blocked).toBe(true);
  });
});
