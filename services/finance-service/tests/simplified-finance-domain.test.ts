/**
 * Simplified Finance — auto-journal generation tests.
 * Pack #23. Source: modules/simplified/auto-journal.ts
 */
import { describe, it, expect } from "vitest";
import {
  rupeesToPaise,
  paiseToRupees,
  generateSalesInvoiceJournal,
  generatePaymentReceivedJournal,
  generatePurchaseJournal,
  generatePaymentMadeJournal,
  generateExpenseJournal,
  generateSalaryJournal,
} from "../src/modules/simplified/auto-journal.js";

describe("rupeesToPaise / paiseToRupees", () => {
  it("converts Rs 1,000 to 100,000 paise", () => expect(rupeesToPaise(1000)).toBe(100_000n));
  it("converts Rs 0.01 to 1 paise", () => expect(rupeesToPaise(0.01)).toBe(1n));
  it("converts Rs 99,999.99 correctly", () => expect(rupeesToPaise(99999.99)).toBe(9_999_999n));
  it("paiseToRupees: 100000 → 1000", () => expect(paiseToRupees(100_000n)).toBe(1000));
  it("paiseToRupees: 1 → 0.01", () => expect(paiseToRupees(1n)).toBe(0.01));
});

describe("generateSalesInvoiceJournal — balanced auto-journal", () => {
  it("generates balanced journal without GST", () => {
    const result = generateSalesInvoiceJournal({
      amountMinor: 100_000n, gstMinor: 0n, totalMinor: 100_000n,
      customerName: "ACME", invoiceNo: "INV-001",
    });
    expect(result.lines.length).toBe(2);
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
    expect(result.type).toBe("receipt");
  });

  it("generates 3-line journal with GST", () => {
    const result = generateSalesInvoiceJournal({
      amountMinor: 100_000n, gstMinor: 18_000n, totalMinor: 118_000n,
    });
    expect(result.lines.length).toBe(3);
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(118_000n);
  });
});

describe("generatePaymentReceivedJournal — balanced", () => {
  it("Dr Cash/Bank, Cr Receivable", () => {
    const result = generatePaymentReceivedJournal({ amountMinor: 50_000n, customerName: "Client" });
    expect(result.lines.length).toBe(2);
    expect(result.lines[0]!.accountCode).toBe("1001"); // Cash/Bank
    expect(BigInt(result.lines[0]!.debitMinor)).toBe(50_000n);
    expect(result.lines[1]!.accountCode).toBe("1002"); // Receivable
    expect(BigInt(result.lines[1]!.creditMinor)).toBe(50_000n);
  });
});

describe("generatePurchaseJournal — balanced", () => {
  it("generates balanced journal with GST input credit", () => {
    const result = generatePurchaseJournal({
      amountMinor: 80_000n, gstMinor: 14_400n, totalMinor: 94_400n, vendorName: "Supplier",
    });
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
    expect(totalDr).toBe(94_400n);
  });

  it("without GST: 2 lines only", () => {
    const result = generatePurchaseJournal({
      amountMinor: 50_000n, gstMinor: 0n, totalMinor: 50_000n,
    });
    expect(result.lines.length).toBe(2);
  });
});

describe("generatePaymentMadeJournal — balanced", () => {
  it("Dr Payable, Cr Cash/Bank", () => {
    const result = generatePaymentMadeJournal({ amountMinor: 30_000n, vendorName: "V" });
    expect(result.lines.length).toBe(2);
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
  });
});

describe("generateExpenseJournal — balanced with category mapping", () => {
  it("maps expense category to account code", () => {
    const result = generateExpenseJournal({
      amountMinor: 20_000n, gstMinor: 0n, totalMinor: 20_000n,
      category: "rent", vendorName: "Landlord",
    });
    expect(result.lines.length).toBe(2);
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
  });

  it("unknown category defaults to 5009 (Other Expense)", () => {
    const result = generateExpenseJournal({
      amountMinor: 5_000n, gstMinor: 0n, totalMinor: 5_000n,
      category: "unknown_category_xyz",
    });
    const expenseLine = result.lines.find(l => BigInt(l.debitMinor) > 0n && l.accountCode !== "2002");
    expect(expenseLine!.accountCode).toBe("5009");
  });
});

describe("generateSalaryJournal — balanced", () => {
  it("Dr Salary Expense, Cr Cash/Bank", () => {
    const result = generateSalaryJournal({ amountMinor: 45_000n });
    expect(result.lines[0]!.accountCode).toBe("5002");
    expect(result.lines[1]!.accountCode).toBe("1001");
    const totalDr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const totalCr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(totalDr).toBe(totalCr);
  });
});
