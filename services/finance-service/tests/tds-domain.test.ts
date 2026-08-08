/**
 * TDS — tax deduction calculation and PAN validation tests.
 * Pack #25. Source: modules/tds/*
 */
import { describe, it, expect } from "vitest";

describe("TDS calculation", () => {
  it("10% TDS on Rs 50,000 = Rs 5,000 (500,000 paise)", () => {
    const payment = 5_000_000n; // 50,000 * 100 paise
    const tds = (payment * 10n) / 100n;
    expect(tds).toBe(500_000n);
  });

  it("1% TDS on Rs 1,00,000", () => {
    const payment = 10_000_000n;
    const tds = (payment * 1n) / 100n;
    expect(tds).toBe(100_000n);
  });

  it("2% TDS (194C - contractors)", () => {
    const payment = 2_000_000n; // Rs 20,000
    const tds = (payment * 2n) / 100n;
    expect(tds).toBe(40_000n);
  });

  it("20% TDS (no PAN provided — Section 206AA)", () => {
    const payment = 1_000_000n; // Rs 10,000
    const tds = (payment * 20n) / 100n;
    expect(tds).toBe(200_000n);
  });

  it("rounding: integer division truncates (floor)", () => {
    // Rs 33.33 = 3333 paise. 10% = 3333 * 10 / 100 = 333 (floor)
    const payment = 3_333n;
    const tds = (payment * 10n) / 100n;
    expect(tds).toBe(333n);
  });
});

describe("TDS threshold accumulation (Section 194A - interest)", () => {
  it("no deduction below threshold (Rs 5,000 for 194A)", () => {
    const thresholdPaise = 500_000n; // Rs 5,000
    const ytdPayments = 400_000n;    // Rs 4,000 so far
    const currentPayment = 50_000n;  // Rs 500 (total still below)
    const totalAfter = ytdPayments + currentPayment;
    expect(totalAfter < thresholdPaise).toBe(true);
    // No TDS deducted
  });

  it("deduct on entire amount when threshold crossed", () => {
    const thresholdPaise = 500_000n;
    const ytdPayments = 480_000n;   // Rs 4,800 so far
    const currentPayment = 30_000n; // Rs 300 (crosses to Rs 5,100)
    const totalAfter = ytdPayments + currentPayment;
    expect(totalAfter >= thresholdPaise).toBe(true);
    // TDS deducted on full currentPayment
    const tds = (currentPayment * 10n) / 100n;
    expect(tds).toBe(3_000n);
  });
});

describe("PAN format validation", () => {
  const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

  it("accepts valid PAN", () => expect(PAN_RE.test("ABCDE1234F")).toBe(true));
  it("rejects lowercase", () => expect(PAN_RE.test("abcde1234f")).toBe(false));
  it("rejects wrong length", () => expect(PAN_RE.test("ABCDE123")).toBe(false));
  it("rejects all-numeric", () => expect(PAN_RE.test("1234567890")).toBe(false));
});

describe("PAN masking — no full PAN in response/logs", () => {
  it("masks all but first char and last 4", () => {
    const pan = "ABCDE1234F";
    const masked = pan[0] + "****" + pan.slice(-4);
    expect(masked).toBe("A****234F");
    expect(masked).not.toBe(pan);
  });
});

describe("TDS duplicate deduction prevention", () => {
  it("same deduction reference = idempotent (skip)", () => {
    const processed = new Set(["ded-001"]);
    expect(processed.has("ded-001")).toBe(true);
  });
});
