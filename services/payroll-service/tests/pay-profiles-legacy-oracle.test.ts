/**
 * PAY-PROFILES byte-identity proof, slip level: computeSlip() against a
 * VERBATIM copy of the pre-PAY-PROFILES computeSlip()
 * (tests/fixtures/legacy-compute-slip.ts, copied from origin/main fe23a8d16)
 * over thousands of seeded random inputs covering every legacy input:
 * basic (incl. sub-rupee paise), DA tiers, city classes, PT, all pension
 * schemes, PF/ESI engagement gates, both tax regimes with declarations, TDS
 * true-up, LOP / loan EMI / arrear recovery against the protected-net floor,
 * structure components (fixed and % of basic), ad-hoc earnings, LTC.
 *
 *  1. No payProfile, no floor          -> deep-equal, every field.
 *  2. Explicit govt_scale + the default floors, basic >= ₹18,000 and
 *     DA >= 50% (where the 30/20/10% slab always meets the floor)
 *                                      -> deep-equal.
 *  3. Control: where the floor binds the outputs DO differ (the oracle is
 *     not vacuous).
 */
import { describe, it, expect } from "vitest";
import { computeSlip, type SlipInput, type CityClass, type PensionScheme, type RawComponent, type PayComponent } from "../src/modules/payroll/domain.js";
import { legacyComputeSlip } from "./fixtures/legacy-compute-slip.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOORS: Record<CityClass, bigint> = { X: 540_000n, Y: 360_000n, Z: 180_000n };

function genInput(seed: number, opts: { minBasic?: bigint; minDaBps?: bigint } = {}): SlipInput {
  const r = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const big = (max: number) => BigInt(Math.floor(r() * max));
  const minBasic = opts.minBasic ?? 0n;
  const basicMinor = minBasic + big(25_000_000) + (r() < 0.2 ? big(100) : 0n);
  const daChoices = [0n, 1200n, 2499n, 2500n, 4600n, 4999n, 5000n, 5300n, 5500n, 5800n, 6000n].filter((d) => d >= (opts.minDaBps ?? 0n));
  const regime = r() < 0.5 ? "old" : "new";
  const components: PayComponent[] = [];
  if (r() < 0.3) components.push({ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: big(3_000_000) });
  if (r() < 0.25) components.push({ code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: big(2_000_000) });
  if (r() < 0.15) components.push({ code: "ARREAR_RECOVERY", name: "Arrear Recovery", type: "deduction", amountMinor: big(1_000_000) });
  if (r() < 0.25) components.push({ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: big(2_000_000) });
  if (r() < 0.15) components.push({ code: "BONUS", name: "Bonus", type: "earning", amountMinor: big(1_500_000) });
  const rawComponents: RawComponent[] = [];
  if (r() < 0.5) rawComponents.push({ code: "TA", name: "Transport", type: "earning", fixedMinor: pick([0n, 135_000n, 360_000n, 720_000n]) });
  if (r() < 0.3) rawComponents.push({ code: "SPL", name: "Special", type: "earning", pctOfBasic: pick([0, 2.5, 10, 12.75]) });
  if (r() < 0.3) rawComponents.push({ code: "WELFARE", name: "Welfare", type: "deduction", fixedMinor: big(50_000) });
  if (r() < 0.1) rawComponents.push({ code: "HRA", name: "ignored", type: "earning", fixedMinor: 999n });
  const input: SlipInput = {
    basicMinor,
    daRateBps: pick(daChoices),
    cityClass: pick(["X", "Y", "Z"] as const),
    ptMinor: pick([0n, 15_000n, 20_000n, 25_000n]),
    pensionScheme: pick<PensionScheme>(["GPF", "NPS", "EPF"]),
    statutoryPf: r() < 0.85,
    statutoryEsi: r() < 0.85,
    taxRegime: regime,
    fyStartYear: 2025,
    components,
    rawComponents,
    protectedNetFloorMinor: r() < 0.3 ? big(2_000_000) : 0n,
    ltcExemptTotalMinor: r() < 0.1 ? big(3_000_000) : 0n,
  };
  if (r() < 0.6) {
    input.tdsYtdMinor = big(20_000_000);
    input.monthsRemaining = 1 + Math.floor(r() * 12);
  }
  if (regime === "old" || r() < 0.2) {
    input.declaration = {
      rentPaidAnnualMinor: r() < 0.6 ? big(60_000_000) : 0n,
      ded80cMinor: big(30_000_000),
      ded80dMinor: big(10_000_000),
      otherDedMinor: r() < 0.3 ? big(5_000_000) : 0n,
      prevEmployerSalaryMinor: r() < 0.1 ? big(50_000_000) : 0n,
      otherSourcesIncomeMinor: r() < 0.1 ? big(10_000_000) : 0n,
      perquisitesMinor: r() < 0.1 ? big(5_000_000) : 0n,
    };
  }
  return input;
}

const N = 5000;

describe("computeSlip == pre-PAY-PROFILES computeSlip", () => {
  it(`${N} random legacy inputs (no profile, no floor): identical output`, () => {
    for (let seed = 1; seed <= N; seed++) {
      const expected = legacyComputeSlip(genInput(seed));
      const actual = computeSlip(genInput(seed));
      if (JSON.stringify(actual, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) !== JSON.stringify(expected, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))) {
        expect({ seed, actual }).toEqual({ seed, actual: expected });
      }
    }
  });

  it(`${N} inputs with explicit govt_scale + default floors where the slab meets the floor: identical output`, () => {
    for (let seed = 1; seed <= N; seed++) {
      const base = genInput(seed + 100_000, { minBasic: 1_800_000n, minDaBps: 5000n });
      const expected = legacyComputeSlip(base);
      const input = { ...genInput(seed + 100_000, { minBasic: 1_800_000n, minDaBps: 5000n }) };
      const actual = computeSlip({ ...input, payProfile: { kind: "govt_scale" }, hraFloorMinor: FLOORS[input.cityClass ?? "X"] });
      expect(actual).toEqual(expected);
    }
  });

  it("control: where the floor binds, the output differs by exactly the floor uplift", () => {
    const input: SlipInput = { basicMinor: 1_500_000n, daRateBps: 0n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2025 };
    const legacy = legacyComputeSlip(input);
    const floored = computeSlip({ ...input, hraFloorMinor: 540_000n });
    expect(floored.hraMinor - legacy.hraMinor).toBe(180_000n);
    expect(floored).not.toEqual(legacy);
  });
});
