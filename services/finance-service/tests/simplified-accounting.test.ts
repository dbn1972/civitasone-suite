/**
 * Simplified Accounting Module — Unit & Integration Tests
 *
 * Tests the auto-journal generation logic (pure domain) and the HTTP routes
 * (integration against in-memory Fastify). Covers:
 *
 * 1. Auto-journal balance invariant — every generated journal balances.
 * 2. Rupee ↔ paise conversion accuracy.
 * 3. Sales invoice journal generation (with and without GST).
 * 4. Payment received journal generation.
 * 5. Expense recording with GST input credit.
 * 6. Payment made journal.
 * 7. Expense category resolution.
 * 8. Route-level validation (bad inputs → 400).
 * 9. Edition guard (non-MSME → 403).
 * 10. Role-based access control.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
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
import { MSME_CHART_OF_ACCOUNTS, EXPENSE_CATEGORY_MAP } from "../src/modules/simplified/seed.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";

function token(roles = ["finance_officer"], edition = "small_office") {
  return signToken(
    { sub: "00000000-aaaa-4000-8000-0000000000ab", tid: TENANT, roles, sid: "sess-simplified" },
    SECRET,
  );
}

afterAll(async () => { await sqlClient.end(); });

// ─── 1. Rupee ↔ Paise Conversion ────────────────────────────────────────

describe("rupeesToPaise / paiseToRupees", () => {
  it("converts whole rupees to paise", () => {
    expect(rupeesToPaise(50000)).toBe(5000000n);
  });

  it("converts fractional rupees correctly (no float drift)", () => {
    expect(rupeesToPaise(99.99)).toBe(9999n);
    expect(rupeesToPaise(0.01)).toBe(1n);
    expect(rupeesToPaise(123456.78)).toBe(12345678n);
  });

  it("round-trips without loss", () => {
    const paise = rupeesToPaise(12345.67);
    expect(paiseToRupees(paise)).toBe(12345.67);
  });

  it("handles zero", () => {
    expect(rupeesToPaise(0)).toBe(0n);
    expect(paiseToRupees(0n)).toBe(0);
  });
});

// ─── 2. Sales Invoice Journal (with GST) ────────────────────────────────

describe("generateSalesInvoiceJournal", () => {
  it("generates balanced 3-line journal with GST", () => {
    const result = generateSalesInvoiceJournal({
      amountMinor: 5000000n,  // ₹50,000
      gstMinor: 900000n,      // ₹9,000 (18% GST)
      totalMinor: 5900000n,   // ₹59,000
      customerName: "Acme Corp",
      invoiceNo: "INV-001",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.type).toBe("receipt");

    // Dr Receivable = total (including GST)
    expect(result.lines[0]!.accountCode).toBe("1002");
    expect(result.lines[0]!.debitMinor).toBe(5900000n);

    // Cr Sales = base amount
    expect(result.lines[1]!.accountCode).toBe("4001");
    expect(result.lines[1]!.creditMinor).toBe(5000000n);

    // Cr GST Payable
    expect(result.lines[2]!.accountCode).toBe("2002");
    expect(result.lines[2]!.creditMinor).toBe(900000n);

    // Journal MUST balance
    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });

  it("generates 2-line journal without GST", () => {
    const result = generateSalesInvoiceJournal({
      amountMinor: 5000000n,
      gstMinor: 0n,
      totalMinor: 5000000n,
      customerName: "Beta Ltd",
    });

    expect(result.lines).toHaveLength(2);
    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(5000000n);
  });

  it("uses the correct income code for service income", () => {
    const result = generateSalesInvoiceJournal({
      amountMinor: 100000n,
      gstMinor: 0n,
      totalMinor: 100000n,
      incomeCode: "4002",
    });
    expect(result.lines[1]!.accountCode).toBe("4002");
  });
});

// ─── 3. Payment Received Journal ────────────────────────────────────────

describe("generatePaymentReceivedJournal", () => {
  it("Dr Cash, Cr Receivable — always balanced", () => {
    const result = generatePaymentReceivedJournal({
      amountMinor: 5900000n,
      customerName: "Acme Corp",
      invoiceNo: "INV-001",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.accountCode).toBe("1001"); // Cash/Bank
    expect(result.lines[0]!.debitMinor).toBe(5900000n);
    expect(result.lines[1]!.accountCode).toBe("1002"); // Receivable
    expect(result.lines[1]!.creditMinor).toBe(5900000n);

    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });
});

// ─── 4. Purchase Journal (with GST input credit) ────────────────────────

describe("generatePurchaseJournal", () => {
  it("Dr COGS + Dr GST input credit, Cr Payable — balanced", () => {
    const result = generatePurchaseJournal({
      amountMinor: 3000000n, // ₹30,000
      gstMinor: 540000n,     // ₹5,400 (18%)
      totalMinor: 3540000n,  // ₹35,400
      vendorName: "Supplier X",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]!.accountCode).toBe("5001"); // COGS
    expect(result.lines[0]!.debitMinor).toBe(3000000n);
    expect(result.lines[1]!.accountCode).toBe("2002"); // GST input credit (debit reduces liability)
    expect(result.lines[1]!.debitMinor).toBe(540000n);
    expect(result.lines[2]!.accountCode).toBe("2001"); // Payable
    expect(result.lines[2]!.creditMinor).toBe(3540000n);

    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });

  it("works without GST (2 lines)", () => {
    const result = generatePurchaseJournal({
      amountMinor: 1000000n,
      gstMinor: 0n,
      totalMinor: 1000000n,
      vendorName: "Vendor Y",
    });

    expect(result.lines).toHaveLength(2);
    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });
});

// ─── 5. Payment Made Journal ────────────────────────────────────────────

describe("generatePaymentMadeJournal", () => {
  it("Dr Payable, Cr Cash — balanced", () => {
    const result = generatePaymentMadeJournal({
      amountMinor: 3540000n,
      vendorName: "Supplier X",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.accountCode).toBe("2001");
    expect(result.lines[0]!.debitMinor).toBe(3540000n);
    expect(result.lines[1]!.accountCode).toBe("1001");
    expect(result.lines[1]!.creditMinor).toBe(3540000n);

    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });
});

// ─── 6. Expense Journal ─────────────────────────────────────────────────

describe("generateExpenseJournal", () => {
  it("routes to correct expense account by category", () => {
    const result = generateExpenseJournal({
      amountMinor: 500000n,
      gstMinor: 0n,
      totalMinor: 500000n,
      category: "rent",
      vendorName: "Landlord",
    });

    expect(result.lines[0]!.accountCode).toBe("5003"); // Rent
    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });

  it("includes GST input credit when applicable", () => {
    const result = generateExpenseJournal({
      amountMinor: 100000n,
      gstMinor: 18000n,
      totalMinor: 118000n,
      category: "professional_fees",
      vendorName: "Lawyer",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]!.accountCode).toBe("5008"); // Professional Fees
    expect(result.lines[1]!.accountCode).toBe("2002"); // GST input credit
    expect(result.lines[2]!.accountCode).toBe("1001"); // Cash
    expect(result.lines[2]!.creditMinor).toBe(118000n);
  });

  it("defaults unknown categories to 5009 (Other Expense)", () => {
    const result = generateExpenseJournal({
      amountMinor: 50000n,
      gstMinor: 0n,
      totalMinor: 50000n,
      category: "random_stuff",
    });
    expect(result.lines[0]!.accountCode).toBe("5009");
  });
});

// ─── 7. Salary Journal ──────────────────────────────────────────────────

describe("generateSalaryJournal", () => {
  it("Dr Salary, Cr Cash — balanced", () => {
    const result = generateSalaryJournal({
      amountMinor: 2500000n, // ₹25,000
      description: "May 2026 salary",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.accountCode).toBe("5002");
    expect(result.lines[1]!.accountCode).toBe("1001");

    const dr = result.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = result.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(2500000n);
  });
});

// ─── 8. Expense Category Resolution ────────────────────────────────────

describe("resolveExpenseCode", () => {
  it("resolves known categories", () => {
    expect(resolveExpenseCode("purchase")).toBe("5001");
    expect(resolveExpenseCode("salary")).toBe("5002");
    expect(resolveExpenseCode("rent")).toBe("5003");
    expect(resolveExpenseCode("utilities")).toBe("5004");
    expect(resolveExpenseCode("transport")).toBe("5005");
    expect(resolveExpenseCode("office_supplies")).toBe("5006");
    expect(resolveExpenseCode("marketing")).toBe("5007");
    expect(resolveExpenseCode("professional_fees")).toBe("5008");
  });

  it("normalizes spaces and hyphens to underscores", () => {
    expect(resolveExpenseCode("Office Supplies")).toBe("5006");
    expect(resolveExpenseCode("professional-fees")).toBe("5008");
  });

  it("falls back to 5009 for unknown categories", () => {
    expect(resolveExpenseCode("misc")).toBe("5009");
    expect(resolveExpenseCode("unknown_thing")).toBe("5009");
  });
});

// ─── 9. MSME Chart of Accounts Seed Data ────────────────────────────────

describe("MSME Chart of Accounts seed", () => {
  it("has exactly 4 group accounts", () => {
    const groups = MSME_CHART_OF_ACCOUNTS.filter((a) => a.isGroup);
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.code).sort()).toEqual(["1000", "2000", "4000", "5000"]);
  });

  it("every non-group account has a valid parent", () => {
    const groupCodes = new Set(MSME_CHART_OF_ACCOUNTS.filter((a) => a.isGroup).map((a) => a.code));
    for (const account of MSME_CHART_OF_ACCOUNTS) {
      if (!account.isGroup) {
        expect(groupCodes.has(account.parentCode!)).toBe(true);
      }
    }
  });

  it("has unique codes", () => {
    const codes = MSME_CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("income codes start with 4, expense with 5, asset with 1, liability with 2", () => {
    for (const a of MSME_CHART_OF_ACCOUNTS) {
      if (a.category === "income") expect(a.code.startsWith("4")).toBe(true);
      if (a.category === "expense") expect(a.code.startsWith("5")).toBe(true);
      if (a.category === "asset") expect(a.code.startsWith("1")).toBe(true);
      if (a.category === "liability") expect(a.code.startsWith("2")).toBe(true);
    }
  });
});

// ─── 10. Route Integration Tests ────────────────────────────────────────

describe("Simplified routes — integration", () => {
  it("POST /record-income returns 202 with valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 50000,
        customerName: "Test Customer",
        gstRate: 18,
        invoiceNo: "INV-100",
        incomeType: "sales",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
    expect(body.correlationId).toBeDefined();
  });

  it("POST /record-expense returns 202 with valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-expense",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 12000,
        category: "rent",
        vendorName: "Landlord LLC",
        gstRate: 0,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /record-payment-received returns 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-payment-received",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 59000,
        customerName: "Acme Corp",
        invoiceNo: "INV-001",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /record-payment-made returns 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-payment-made",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 35400,
        vendorName: "Supplier Z",
        description: "Raw materials",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects invalid amount (zero) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 0,
        customerName: "Nobody",
        gstRate: 18,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative amount with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-expense",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: -5000,
        category: "rent",
        gstRate: 0,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing required fields with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: { amount: 1000 }, // missing customerName
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("blocks non-MSME edition with 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        "x-tenant-edition": "govt_department",
      },
      payload: {
        amount: 50000,
        customerName: "Test",
        gstRate: 18,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EDITION_RESTRICTED");
  });

  it("blocks unauthorized role with 403", async () => {
    const citizenToken = signToken(
      { sub: "00000000-aaaa-4000-8000-0000000000ab", tid: TENANT, roles: ["citizen"], sid: "sess-c" },
      SECRET,
    );
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/simplified/record-income",
      headers: {
        authorization: `Bearer ${citizenToken}`,
        "content-type": "application/json",
        "x-tenant-edition": "small_office",
      },
      payload: {
        amount: 50000,
        customerName: "Test",
        gstRate: 18,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("GET /summary returns the expected shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/summary?period=2026-06",
      headers: {
        authorization: `Bearer ${token()}`,
        "x-tenant-edition": "small_office",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("period", "2026-06");
    expect(body).toHaveProperty("totalIncome");
    expect(body).toHaveProperty("totalExpense");
    expect(body).toHaveProperty("profit");
    expect(body).toHaveProperty("cashBalance");
    expect(body).toHaveProperty("receivables");
    expect(body).toHaveProperty("payables");
    expect(body).toHaveProperty("gstLiability");
    expect(typeof body.totalIncome).toBe("number");
    expect(typeof body.profit).toBe("number");
  });

  it("GET /income returns paginated list", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/income?limit=10",
      headers: {
        authorization: `Bearer ${token()}`,
        "x-tenant-edition": "small_office",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("pagination");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /expenses returns paginated list", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/expenses?limit=10",
      headers: {
        authorization: `Bearer ${token()}`,
        "x-tenant-edition": "small_office",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /cashflow returns weekly data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/simplified/cashflow",
      headers: {
        authorization: `Bearer ${token()}`,
        "x-tenant-edition": "small_office",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ─── 11. Journal Balance Invariant (property-style) ─────────────────────

describe("All auto-journal generators ALWAYS produce balanced journals", () => {
  function assertBalanced(lines: Array<{ debitMinor: bigint | number | string; creditMinor: bigint | number | string }>) {
    const dr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBeGreaterThan(0n);
  }

  const testAmounts = [1n, 100n, 999999n, 12345678n, 99999999999n];

  for (const amount of testAmounts) {
    const gst = amount * 18n / 100n;
    const total = amount + gst;

    it(`sales invoice balanced for amount=${amount}`, () => {
      const { lines } = generateSalesInvoiceJournal({ amountMinor: amount, gstMinor: gst, totalMinor: total });
      assertBalanced(lines);
    });

    it(`payment received balanced for amount=${amount}`, () => {
      const { lines } = generatePaymentReceivedJournal({ amountMinor: total });
      assertBalanced(lines);
    });

    it(`purchase balanced for amount=${amount}`, () => {
      const { lines } = generatePurchaseJournal({ amountMinor: amount, gstMinor: gst, totalMinor: total });
      assertBalanced(lines);
    });

    it(`payment made balanced for amount=${amount}`, () => {
      const { lines } = generatePaymentMadeJournal({ amountMinor: total });
      assertBalanced(lines);
    });

    it(`expense balanced for amount=${amount}`, () => {
      const { lines } = generateExpenseJournal({ amountMinor: amount, gstMinor: gst, totalMinor: total, category: "rent" });
      assertBalanced(lines);
    });

    it(`salary balanced for amount=${amount}`, () => {
      const { lines } = generateSalaryJournal({ amountMinor: amount });
      assertBalanced(lines);
    });
  }
});
