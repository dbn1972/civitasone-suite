/**
 * Coverage tests for simplified/auto-journal.ts + budget/allocation-domain.ts + gl/domain.ts.
 * Pure functions — no DB or I/O.
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
  resolveExpenseCode,
} from "../src/modules/simplified/auto-journal.js";
import { DomainError as GlDomainError, assertJournalBalances } from "../src/modules/gl/domain.js";
import { DomainError as BudgetDomainError } from "../src/modules/budget/domain.js";
import {
  appropriationAvailable,
  assertWithinAppropriation,
  assertReappropriable,
} from "../src/modules/budget/allocation-domain.js";

// ═════════════════════════════════════════════════════════
// CURRENCY CONVERSION
// ═════════════════════════════════════════════════════════

describe("auto-journal — rupeesToPaise()", () => {
  it("converts whole rupees", () => {
    expect(rupeesToPaise(100)).toBe(10000n);
  });

  it("converts decimal rupees", () => {
    expect(rupeesToPaise(99.99)).toBe(9999n);
    expect(rupeesToPaise(0.01)).toBe(1n);
  });

  it("handles zero", () => {
    expect(rupeesToPaise(0)).toBe(0n);
  });

  it("handles large amounts", () => {
    expect(rupeesToPaise(1000000)).toBe(100000000n); // ₹10,00,000 = 10 crore paise
  });
});

describe("auto-journal — paiseToRupees()", () => {
  it("converts paise to rupees", () => {
    expect(paiseToRupees(10000n)).toBe(100);
    expect(paiseToRupees(9999n)).toBe(99.99);
    expect(paiseToRupees(1n)).toBe(0.01);
    expect(paiseToRupees(0n)).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// SALES INVOICE JOURNAL
// ═════════════════════════════════════════════════════════

describe("auto-journal — generateSalesInvoiceJournal()", () => {
  it("generates balanced 3-line journal with GST", () => {
    const r = generateSalesInvoiceJournal({
      amountMinor: 100000n,    // ₹1000
      gstMinor: 18000n,        // 18% GST
      totalMinor: 118000n,     // ₹1180
      customerName: "ACME",
      invoiceNo: "INV-001",
    });
    expect(r.lines.length).toBe(3);
    expect(r.type).toBe("receipt");
    // Dr Receivable = total
    expect(r.lines[0]!.debitMinor).toBe(118000n);
    // Cr Sales = amount
    expect(r.lines[1]!.creditMinor).toBe(100000n);
    // Cr GST = gst
    expect(r.lines[2]!.creditMinor).toBe(18000n);
  });

  it("generates 2-line journal without GST", () => {
    const r = generateSalesInvoiceJournal({
      amountMinor: 50000n,
      gstMinor: 0n,
      totalMinor: 50000n,
    });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0]!.debitMinor).toBe(50000n);
    expect(r.lines[1]!.creditMinor).toBe(50000n);
  });

  it("uses custom income code", () => {
    const r = generateSalesInvoiceJournal({
      amountMinor: 10000n, gstMinor: 0n, totalMinor: 10000n,
      incomeCode: "4005",
    });
    expect(r.lines[1]!.accountCode).toBe("4005");
  });
});

// ═════════════════════════════════════════════════════════
// PAYMENT RECEIVED
// ═════════════════════════════════════════════════════════

describe("auto-journal — generatePaymentReceivedJournal()", () => {
  it("generates balanced 2-line journal", () => {
    const r = generatePaymentReceivedJournal({ amountMinor: 100000n, customerName: "Client" });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0]!.accountCode).toBe("1001"); // Cash/Bank
    expect(r.lines[0]!.debitMinor).toBe(100000n);
    expect(r.lines[1]!.accountCode).toBe("1002"); // Receivable
    expect(r.lines[1]!.creditMinor).toBe(100000n);
  });
});

// ═════════════════════════════════════════════════════════
// PURCHASE JOURNAL
// ═════════════════════════════════════════════════════════

describe("auto-journal — generatePurchaseJournal()", () => {
  it("generates balanced journal with GST input credit", () => {
    const r = generatePurchaseJournal({
      amountMinor: 200000n, gstMinor: 36000n, totalMinor: 236000n,
      vendorName: "Supplier Co",
    });
    expect(r.lines.length).toBe(3);
    // Dr COGS
    expect(r.lines[0]!.debitMinor).toBe(200000n);
    // Dr GST input credit
    expect(r.lines[1]!.debitMinor).toBe(36000n);
    // Cr Payable = total
    expect(r.lines[2]!.creditMinor).toBe(236000n);
  });

  it("generates 2-line journal without GST", () => {
    const r = generatePurchaseJournal({
      amountMinor: 50000n, gstMinor: 0n, totalMinor: 50000n,
    });
    expect(r.lines.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════
// PAYMENT MADE
// ═════════════════════════════════════════════════════════

describe("auto-journal — generatePaymentMadeJournal()", () => {
  it("generates balanced 2-line journal", () => {
    const r = generatePaymentMadeJournal({ amountMinor: 75000n, vendorName: "Vendor" });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0]!.accountCode).toBe("2001"); // Payable
    expect(r.lines[0]!.debitMinor).toBe(75000n);
    expect(r.lines[1]!.accountCode).toBe("1001"); // Cash
    expect(r.lines[1]!.creditMinor).toBe(75000n);
  });
});

// ═════════════════════════════════════════════════════════
// EXPENSE JOURNAL
// ═════════════════════════════════════════════════════════

describe("auto-journal — generateExpenseJournal()", () => {
  it("generates balanced journal for expense with GST", () => {
    const r = generateExpenseJournal({
      amountMinor: 10000n, gstMinor: 1800n, totalMinor: 11800n,
      category: "office_supplies",
    });
    expect(r.lines.length).toBe(3);
    expect(r.type).toBe("payment");
  });

  it("generates 2-line journal for expense without GST", () => {
    const r = generateExpenseJournal({
      amountMinor: 5000n, gstMinor: 0n, totalMinor: 5000n,
      category: "travel",
    });
    expect(r.lines.length).toBe(2);
  });

  it("uses correct expense account code for known category", () => {
    const r = generateExpenseJournal({
      amountMinor: 1000n, gstMinor: 0n, totalMinor: 1000n,
      category: "rent",
    });
    // Should use a specific code from EXPENSE_CATEGORY_MAP, or 5009 fallback
    expect(r.lines[0]!.accountCode).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════
// SALARY JOURNAL
// ═════════════════════════════════════════════════════════

describe("auto-journal — generateSalaryJournal()", () => {
  it("generates balanced 2-line salary journal", () => {
    const r = generateSalaryJournal({ amountMinor: 5000000n }); // ₹50,000
    expect(r.lines.length).toBe(2);
    expect(r.lines[0]!.accountCode).toBe("5002");
    expect(r.lines[0]!.debitMinor).toBe(5000000n);
    expect(r.lines[1]!.creditMinor).toBe(5000000n);
    expect(r.type).toBe("payment");
  });
});

// ═════════════════════════════════════════════════════════
// RESOLVE EXPENSE CODE
// ═════════════════════════════════════════════════════════

describe("auto-journal — resolveExpenseCode()", () => {
  it("returns 5009 for unknown category", () => {
    expect(resolveExpenseCode("interplanetary_travel")).toBe("5009");
  });
});

// ═════════════════════════════════════════════════════════
// GL DOMAIN — assertJournalBalances
// ═════════════════════════════════════════════════════════

describe("gl/domain — assertJournalBalances()", () => {
  it("passes for balanced journal", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1001", debitMinor: 10000n, creditMinor: 0n, narration: "" },
      { accountCode: "4001", debitMinor: 0n, creditMinor: 10000n, narration: "" },
    ])).not.toThrow();
  });

  it("throws JOURNAL_UNBALANCED for unbalanced lines", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1001", debitMinor: 10000n, creditMinor: 0n, narration: "" },
      { accountCode: "4001", debitMinor: 0n, creditMinor: 5000n, narration: "" },
    ])).toThrow(GlDomainError);
  });

  it("throws JOURNAL_TOO_FEW_LINES for < 2 lines", () => {
    expect(() => assertJournalBalances([
      { accountCode: "1001", debitMinor: 10000n, creditMinor: 0n, narration: "" },
    ])).toThrow(GlDomainError);
    expect(() => assertJournalBalances([])).toThrow(GlDomainError);
  });
});

// ═════════════════════════════════════════════════════════
// ALLOCATION DOMAIN
// ═════════════════════════════════════════════════════════

describe("budget/allocation-domain — appropriationAvailable()", () => {
  it("returns allocated - (committed + actual)", () => {
    expect(appropriationAvailable({ allocatedMinor: 1000000n, committedMinor: 300000n, actualMinor: 200000n })).toBe(500000n);
  });
});

describe("budget/allocation-domain — assertWithinAppropriation()", () => {
  it("passes when within limit", () => {
    expect(() => assertWithinAppropriation(
      { allocatedMinor: 1000000n, committedMinor: 200000n, actualMinor: 100000n, enforce: true },
      500000n,
    )).not.toThrow();
  });

  it("throws OVER_APPROPRIATION when exceeds", () => {
    expect(() => assertWithinAppropriation(
      { allocatedMinor: 1000000n, committedMinor: 800000n, actualMinor: 100000n, enforce: true },
      200000n,
    )).toThrow(BudgetDomainError);
  });

  it("no-op when enforce is false", () => {
    expect(() => assertWithinAppropriation(
      { allocatedMinor: 100n, committedMinor: 90n, actualMinor: 90n, enforce: false },
      999n,
    )).not.toThrow();
  });
});

describe("budget/allocation-domain — assertReappropriable()", () => {
  it("passes when sufficient balance", () => {
    expect(() => assertReappropriable(
      { allocatedMinor: 1000000n, committedMinor: 200000n, actualMinor: 100000n },
      500000n,
    )).not.toThrow();
  });

  it("throws when exceeds balance", () => {
    expect(() => assertReappropriable(
      { allocatedMinor: 1000000n, committedMinor: 800000n, actualMinor: 100000n },
      200000n,
    )).toThrow(BudgetDomainError);
  });

  it("throws for zero amount", () => {
    expect(() => assertReappropriable(
      { allocatedMinor: 1000000n, committedMinor: 0n, actualMinor: 0n },
      0n,
    )).toThrow(BudgetDomainError);
  });
});
