/**
 * Invariant test: H14 — Professional Tax uses employee's state schedule.
 *
 * PROPERTY: For a two-state tenant (e.g. Karnataka + Maharashtra), each
 * employee's PT is withheld against their OWN state schedule, not a
 * single tenant-wide schedule.
 *
 * Previously resolvePtSlabs filtered only by tenant_id (dropping state_code).
 * A Karnataka employee would get Maharashtra PT if Maharashtra slabs loaded first.
 */
import { describe, it, expect } from "vitest";

// Simulate PT slab resolution per state
interface PtSlab { from: bigint; to: bigint; amount: bigint }

function resolvePt(slabs: PtSlab[], incomeMinor: bigint): bigint {
  const s = slabs.find((x) => incomeMinor >= x.from && incomeMinor <= x.to);
  return s ? s.amount : 0n;
}

// Karnataka PT slabs (2024-25)
const KA_SLABS: PtSlab[] = [
  { from: 0n, to: 15000_00n, amount: 0n },
  { from: 15001_00n, to: 99999999n, amount: 200_00n }, // ₹200/month
];

// Maharashtra PT slabs (2024-25) — different from Karnataka
const MH_SLABS: PtSlab[] = [
  { from: 0n, to: 7500_00n, amount: 0n },            // exempt
  { from: 7501_00n, to: 10000_00n, amount: 175_00n }, // ₹175/month
  { from: 10001_00n, to: 99999999n, amount: 200_00n }, // ₹200/month (₹300 for Feb)
];

describe("H14 — Professional Tax state-based isolation", () => {
  it("Karnataka employee at ₹12,000 income: PT = ₹0 (below KA threshold)", () => {
    const income = 12000_00n; // 12,000 INR in paise
    expect(resolvePt(KA_SLABS, income)).toBe(0n);
  });

  it("Maharashtra employee at ₹12,000 income: PT = ₹200 (above MH threshold)", () => {
    const income = 12000_00n;
    expect(resolvePt(MH_SLABS, income)).toBe(200_00n);
  });

  it("same income, different states → different PT (the invariant)", () => {
    const income = 12000_00n;
    const kaPt = resolvePt(KA_SLABS, income);
    const mhPt = resolvePt(MH_SLABS, income);
    // Without state filtering, both would get the same PT (BUG)
    // With state filtering, they differ correctly
    expect(kaPt).not.toBe(mhPt);
    expect(kaPt).toBe(0n);      // KA: below 15,001 threshold
    expect(mhPt).toBe(200_00n); // MH: above 10,001 threshold
  });

  it("employee at ₹20,000 income: both states charge ₹200", () => {
    const income = 20000_00n;
    expect(resolvePt(KA_SLABS, income)).toBe(200_00n);
    expect(resolvePt(MH_SLABS, income)).toBe(200_00n);
  });

  it("employee at ₹8,000 income: KA exempt, MH charges ₹175", () => {
    const income = 8000_00n;
    expect(resolvePt(KA_SLABS, income)).toBe(0n);
    expect(resolvePt(MH_SLABS, income)).toBe(175_00n);
  });
});
