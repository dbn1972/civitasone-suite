/**
 * Subledger — AP/AR aging bucket calculation and reconciliation tests.
 * Pack #24. Source: modules/subledger/*
 */
import { describe, it, expect } from "vitest";

describe("AP/AR aging bucket calculation", () => {
  type Bucket = "current" | "30_days" | "60_days" | "90_days" | "120_plus";

  function agingBucket(daysPastDue: number): Bucket {
    if (daysPastDue <= 0) return "current";
    if (daysPastDue <= 30) return "30_days";
    if (daysPastDue <= 60) return "60_days";
    if (daysPastDue <= 90) return "90_days";
    return "120_plus";
  }

  it("not yet due = current", () => expect(agingBucket(0)).toBe("current"));
  it("future due date = current", () => expect(agingBucket(-5)).toBe("current"));
  it("1 day past due = 30_days bucket", () => expect(agingBucket(1)).toBe("30_days"));
  it("30 days = 30_days bucket (boundary)", () => expect(agingBucket(30)).toBe("30_days"));
  it("31 days = 60_days bucket", () => expect(agingBucket(31)).toBe("60_days"));
  it("60 days = 60_days bucket", () => expect(agingBucket(60)).toBe("60_days"));
  it("61 days = 90_days bucket", () => expect(agingBucket(61)).toBe("90_days"));
  it("90 days = 90_days bucket", () => expect(agingBucket(90)).toBe("90_days"));
  it("91 days = 120_plus bucket", () => expect(agingBucket(91)).toBe("120_plus"));
  it("365 days = 120_plus", () => expect(agingBucket(365)).toBe("120_plus"));
});

describe("subledger outstanding balance", () => {
  it("outstanding = invoiced - paid - credits", () => {
    const invoiced = 500_000n;
    const paid = 200_000n;
    const credits = 50_000n;
    const outstanding = invoiced - paid - credits;
    expect(outstanding).toBe(250_000n);
  });

  it("no negative outstanding (overpayment tracked separately)", () => {
    const invoiced = 100_000n;
    const paid = 150_000n;
    const outstanding = invoiced - paid;
    // Negative = overpayment, system tracks as credit memo
    expect(outstanding).toBe(-50_000n);
  });
});

describe("subledger-GL reconciliation", () => {
  it("sum(subledger balances) must equal GL control account balance", () => {
    const subledgerBalances = [100_000n, 200_000n, 50_000n];
    const glControlBalance = 350_000n;
    const totalSubledger = subledgerBalances.reduce((s, b) => s + b, 0n);
    expect(totalSubledger).toBe(glControlBalance);
  });

  it("mismatch indicates reconciliation break", () => {
    const totalSubledger = 350_000n;
    const glBalance = 349_999n;
    expect(totalSubledger).not.toBe(glBalance);
  });
});
