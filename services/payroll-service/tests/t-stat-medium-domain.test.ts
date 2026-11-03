/**
 * T-STAT medium findings, pure computeSlip side.
 *
 * M-NPS (F04): NPS (employee 10% / employer 14% of Basic + DA, CCS (NPS)
 * Rules) also applies to the Basic + DA part of arrears of pay and DA. HRA
 * arrears are not part of the NPS base.
 *
 * M-PT-BASIS (F08): professional tax slabs are on the monthly salary or wages
 * (gross earnings for the month, less loss of pay) -- not on Basic + DA.
 */
import { describe, it, expect } from "vitest";
import { computeSlip, type SlipInput } from "../src/modules/payroll/domain.js";

const R = (rupees: number): bigint => BigInt(rupees) * 100n;

const base: SlipInput = {
  basicMinor: R(30900), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS",
  taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
};

describe("T-STAT M-NPS: NPS on the Basic + DA part of arrears", () => {
  it("UATG1-34285 March slip: 10% / 14% on (48,822 + 18,960 + 5,000), not on 48,822 only", () => {
    const s = computeSlip({
      ...base,
      components: [{ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: R(27560) }],
      arrearPensionBaseMinor: R(18960 + 5000),
    });
    // Basic 30,900 + DA 17,922 = 48,822; + arrears basic/DA 23,960 = 72,782.
    expect(s.npsEmployeeMinor).toBe(R(7278)); // was 4,882 -> short by 2,396
    expect(s.npsEmployerMinor).toBe(R(10189)); // was 6,835 -> short by 3,354
    expect(s.npsPensionBaseMinor).toBe(R(72782));
  });

  it("no arrears: unchanged (10% / 14% of Basic + DA)", () => {
    const s = computeSlip(base);
    expect(s.npsEmployeeMinor).toBe(R(4882));
    expect(s.npsEmployerMinor).toBe(R(6835));
  });

  it("GPF subscriptions are not recomputed on arrears (only NPS is in scope)", () => {
    const s = computeSlip({ ...base, pensionScheme: "GPF", arrearPensionBaseMinor: R(23960) });
    expect(s.gpfMinor).toBe(R(4882));
  });
});

describe("T-STAT M-PT-BASIS: PT slab looked up on gross monthly salary", () => {
  it("the PT resolver receives gross earnings less LOP, not Basic + DA", () => {
    const seen: bigint[] = [];
    const s = computeSlip({
      ...base,
      components: [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: R(1000) }],
      ptForSalaryMinor: (salary) => { seen.push(salary); return R(200); },
    });
    // gross = 30,900 + 17,922 + HRA 9,270 = 58,092; less LOP 1,000.
    expect(s.grossMinor).toBe(R(58092));
    expect(seen).toEqual([R(57092)]);
    expect(s.ptMinor).toBe(R(200));
    expect(s.deductions.find((d) => d.code === "PT")?.amountMinor).toBe(R(200));
  });

  it("a salary of Rs 25,000 gross whose Basic + DA is below the Rs 25,000 slab now falls in it", () => {
    // Basic 13,000 + DA 58% 7,540 = 20,540; HRA 30% 3,900 + special pay 560 -> gross 25,000.
    const slab = (salary: bigint) => (salary >= R(25000) ? R(200) : 0n);
    const s = computeSlip({
      ...base, basicMinor: R(13000),
      rawComponents: [{ code: "SPL", name: "Special Pay", type: "earning", fixedMinor: R(560) }],
      ptForSalaryMinor: slab,
    });
    expect(s.grossMinor).toBe(R(25000));
    expect(s.ptMinor).toBe(R(200));
  });
});
