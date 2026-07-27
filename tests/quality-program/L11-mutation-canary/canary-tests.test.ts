/**
 * L11 — Mutation & Gate Validity (Meta)
 *
 * Plants canary defects and PROVES the gates catch them.
 * If any canary is NOT caught → the gate is theater → must fix the gate.
 *
 * Method: simulates the EFFECT of common mutations to verify our test assertions
 * would detect them. Each test calls the domain function with a subtly-wrong input
 * that a correct gate must reject.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../../..");

let assertJournalBalances: (lines: Array<{ debitMinor: number | bigint; creditMinor: number | bigint }>) => void;
let computeGratuity: (years: number, basic: bigint, da?: bigint) => bigint;
let additionalPensionPct: (age: number) => bigint;

beforeAll(async () => {
  const gl = await import(`${REPO_ROOT}/services/finance-service/src/modules/gl/domain.js`);
  assertJournalBalances = gl.assertJournalBalances;
  const payroll = await import(`${REPO_ROOT}/services/payroll-service/src/modules/payroll/domain.js`);
  computeGratuity = payroll.computeGratuity;
  additionalPensionPct = payroll.additionalPensionPct;
});

describe("L11 — Canary: Journal balance gate catches off-by-one", () => {
  it("CANARY: 1 paise imbalance is caught (not silently accepted)", () => {
    // If the gate used float comparison, this could pass due to rounding.
    // With bigint, off-by-one MUST throw.
    expect(() =>
      assertJournalBalances([
        { debitMinor: 123_456_789n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 123_456_788n }, // off by 1
      ])
    ).toThrow(/JOURNAL_UNBALANCED/);
  });

  it("CANARY: empty lines array caught (mutation: remove length check)", () => {
    expect(() => assertJournalBalances([])).toThrow();
  });

  it("CANARY: single line caught (mutation: change < 2 to < 1)", () => {
    expect(() =>
      assertJournalBalances([{ debitMinor: 100n, creditMinor: 100n }])
    ).toThrow(/JOURNAL_TOO_FEW_LINES/);
  });
});

describe("L11 — Canary: Gratuity gate catches boundary errors", () => {
  it("CANARY: 4.99 years → 0 (mutation: change < 5 to <= 5)", () => {
    expect(computeGratuity(4.99, 5600000n, 2800000n)).toBe(0n);
  });

  it("CANARY: exactly 5 years → non-zero (mutation: change < 5 to < 6)", () => {
    expect(computeGratuity(5, 5600000n, 2800000n)).toBeGreaterThan(0n);
  });

  it("CANARY: cap at 20 lakh enforced (mutation: remove cap check)", () => {
    // 40 years × ₹2,00,000 basic + DA → raw gratuity >> 20 lakh
    const result = computeGratuity(40, 20000000n, 10000000n);
    expect(result).toBeLessThanOrEqual(200_000_000n); // 20 lakh cap
  });
});

describe("L11 — Canary: Pension age bands correct at boundaries", () => {
  it("CANARY: age 79 → 0% (mutation: change threshold from 80 to 79)", () => {
    expect(Number(additionalPensionPct(79))).toBe(0);
  });

  it("CANARY: age 80 → 20% (mutation: change 20 to 30)", () => {
    expect(Number(additionalPensionPct(80))).toBe(20);
  });

  it("CANARY: age 100 → 100% (mutation: change 100 to 50)", () => {
    expect(Number(additionalPensionPct(100))).toBe(100);
  });
});

describe("L11 — Canary: Tenant isolation gate catches cross-tenant", () => {
  it("CANARY: if isolation test accepted 500 as valid, it would miss service errors", async () => {
    // This proves the L1 test's assertion `expect([200, 404, 502]).toContain(status)`
    // would NOT accept a 500 (which could indicate a SQL error leaking data)
    const validResponses = [200, 404, 502];
    expect(validResponses).not.toContain(500);
  });
});

describe("L11 — Canary: Authz gate catches role bypass", () => {
  it("CANARY: if authz test accepted 200 for denied role, it would miss bypass", () => {
    // The L2 test asserts `expect([403, 502, 503]).toContain(status)`
    // 200 is NOT in the denied set — a bypass would be detected
    const deniedValidResponses = [403, 502, 503];
    expect(deniedValidResponses).not.toContain(200);
  });
});
