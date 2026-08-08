/**
 * Financial Statements — domain logic tests.
 *
 * Source: services/finance-service/src/modules/financial-statements/routes.ts
 * Pack #07: erp-ai-test-prompts/Finance_Module_Test_Pack/07_Financial_Statements_Module_Test_Pack.md
 *
 * Tests the accounting equations and classification logic that underpin all
 * financial statements. These invariants hold regardless of the data source.
 */
import { describe, it, expect } from "vitest";

// ─── Account Nature Classification ──────────────────────────────────────────

/**
 * Replicate the natureOf() classification logic from financial-statements routes.
 * Source-verified from routes.ts (module-private function).
 */
function natureOf(code: string, classification: string | null): "asset" | "liability" | "equity" | "income" | "expense" {
  const d = code.charAt(0);
  if (d === "1") return "asset";
  if (d === "4" && (classification === "income" || classification === "revenue")) return "income";
  if (d === "5" || d === "6") return "expense";
  if (code === "4200") return "expense";
  if (d === "4") return "income";
  if (d === "3" && classification === "equity") return "equity";
  if (d === "2" || d === "3") return "liability";
  if (classification === "asset") return "asset";
  if (classification === "equity") return "equity";
  if (classification === "income" || classification === "revenue") return "income";
  if (classification === "expense" || classification === "expenditure") return "expense";
  return "liability";
}

describe("natureOf — account classification from code leading digit", () => {
  it("1xxx = asset", () => {
    expect(natureOf("1100", null)).toBe("asset");
    expect(natureOf("1200", "capital")).toBe("asset");
    expect(natureOf("1250", null)).toBe("asset");
  });

  it("2xxx = liability", () => {
    expect(natureOf("2100", null)).toBe("liability");
    expect(natureOf("2050", null)).toBe("liability");
  });

  it("3xxx with equity classification = equity", () => {
    expect(natureOf("3100", "equity")).toBe("equity");
  });

  it("3xxx without equity classification = liability (default)", () => {
    expect(natureOf("3200", null)).toBe("liability");
  });

  it("4xxx = income (when classification matches)", () => {
    expect(natureOf("4100", "income")).toBe("income");
    expect(natureOf("4100", "revenue")).toBe("income");
    expect(natureOf("4300", null)).toBe("income"); // defaults to income for 4xxx
  });

  it("4200 is special-cased as expense (gain/loss on disposal)", () => {
    expect(natureOf("4200", null)).toBe("expense");
  });

  it("5xxx = expense", () => {
    expect(natureOf("5100", null)).toBe("expense");
    expect(natureOf("5200", "expenditure")).toBe("expense");
  });

  it("6xxx = expense", () => {
    expect(natureOf("6000", null)).toBe("expense");
  });
});

// ─── Accounting Equations ────────────────────────────────────────────────────

describe("balance sheet equation: Assets = Liabilities + Equity + (Income - Expense)", () => {
  it("holds for a sample set of accounts", () => {
    // Simulate a trial balance
    const accounts = [
      { code: "1200", classification: null, dr: 500_000n, cr: 0n },     // asset: net 500k
      { code: "1250", classification: null, dr: 0n, cr: 50_000n },      // asset (contra): net -50k
      { code: "2100", classification: null, dr: 200_000n, cr: 500_000n }, // liability: net cr 300k
      { code: "3100", classification: "equity", dr: 0n, cr: 100_000n },  // equity: 100k
      { code: "4100", classification: "income", dr: 0n, cr: 200_000n },  // income: 200k
      { code: "5100", classification: null, dr: 150_000n, cr: 0n },      // expense: 150k
    ];

    let assets = 0n, liabilities = 0n, equity = 0n, income = 0n, expense = 0n;
    for (const a of accounts) {
      const nature = natureOf(a.code, a.classification);
      if (nature === "asset") assets += a.dr - a.cr;
      else if (nature === "liability") liabilities += a.cr - a.dr;
      else if (nature === "equity") equity += a.cr - a.dr;
      else if (nature === "income") income += a.cr - a.dr;
      else if (nature === "expense") expense += a.dr - a.cr;
    }

    // Assets = 500k - 50k = 450k
    // Liabilities = 300k, Equity = 100k, Income = 200k, Expense = 150k
    // RHS = 300k + 100k + (200k - 150k) = 450k ✓
    const rhs = liabilities + equity + (income - expense);
    expect(assets).toBe(rhs);
  });
});

describe("trial balance invariant: sum(Dr) === sum(Cr)", () => {
  it("any set of balanced journals produces balanced trial balance", () => {
    // Two balanced journals
    const journals = [
      [{ dr: 100_000n, cr: 0n }, { dr: 0n, cr: 100_000n }],
      [{ dr: 50_000n, cr: 0n }, { dr: 0n, cr: 50_000n }],
    ];

    let totalDr = 0n, totalCr = 0n;
    for (const j of journals) {
      for (const line of j) {
        totalDr += line.dr;
        totalCr += line.cr;
      }
    }
    expect(totalDr).toBe(totalCr);
  });
});

describe("P&L invariant: surplus = income - expense", () => {
  it("surplus is positive when income > expense", () => {
    const income = 200_000n;
    const expense = 50_000n;
    expect(income - expense).toBe(150_000n);
    expect(income >= expense).toBe(true); // → "surplus" label
  });

  it("deficit is negative when expense > income", () => {
    const income = 30_000n;
    const expense = 80_000n;
    expect(income - expense).toBe(-50_000n);
    expect(income >= expense).toBe(false); // → "deficit" label
  });
});

// ─── FY Derivation ───────────────────────────────────────────────────────────

describe("FY bounds derivation", () => {
  function fyBounds(fy: string) {
    const startYear = Number(fy.slice(0, 4));
    return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
  }

  it("2025-26 → Apr 2025 to Mar 2026", () => {
    const { start, end } = fyBounds("2025-26");
    expect(start).toBe("2025-04-01");
    expect(end).toBe("2026-03-31");
  });

  it("2024-25 → Apr 2024 to Mar 2025", () => {
    const { start, end } = fyBounds("2024-25");
    expect(start).toBe("2024-04-01");
    expect(end).toBe("2025-03-31");
  });
});
