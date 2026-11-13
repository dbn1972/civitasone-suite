/**
 * S8 statutory-seams lane: PIN. The full computeSlip output (every field, every
 * earning/deduction line) for a matrix of government, EPF, NPS/UPS/GPF,
 * consolidated and deputation inputs, captured from main BEFORE the S8 seams
 * (per-employee PF wage basis, LWF, ESI contribution period) were added.
 * With every seam input omitted (flag off) the output must stay byte-identical.
 * Regenerate ONLY deliberately: UPDATE_S8_PIN=1 pnpm vitest run tests/s8-computeslip-pin.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeSlip, type SlipInput, type PensionScheme, type CityClass } from "../src/modules/payroll/domain.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/s8-computeslip-pin.json", import.meta.url));
const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x), 1);

const rupees = (n: number) => BigInt(n) * 100n;
const schemes: PensionScheme[] = ["EPF", "NPS", "UPS", "GPF", "NONE"];
const basics = [8_000, 14_999, 15_000, 18_500, 25_000, 56_100, 1_20_000].map(rupees);
const cases: Array<[string, SlipInput]> = [];
for (const scheme of schemes) {
  for (const basic of basics) {
    for (const [city, da] of [["X", 5500n], ["Y", 0n], ["Z", 2500n]] as Array<[CityClass, bigint]>) {
      const base: SlipInput = { basicMinor: basic, daRateBps: da, cityClass: city, pensionScheme: scheme, ptMinor: 20_000n, taxRegime: "new", fyStartYear: 2025 };
      cases.push([`${scheme}/${basic}/${city}`, base]);
      cases.push([`${scheme}/${basic}/${city}/nopf-noesi-noeps`, { ...base, statutoryPf: false, statutoryEsi: false, epsEligible: false }]);
      cases.push([`${scheme}/${basic}/${city}/adhoc`, {
        ...base,
        components: [
          { code: "LOP", name: "Loss of pay", type: "deduction", amountMinor: 150_000n },
          { code: "LOAN_EMI", name: "Loan EMI", type: "deduction", amountMinor: 500_000n },
          { code: "ARREARS", name: "Arrears", type: "earning", amountMinor: 250_000n },
        ],
        rawComponents: [{ code: "CONV", name: "Conveyance", type: "earning", fixedMinor: 160_000n }, { code: "SPL", name: "Special", type: "earning", pctOfBasic: 12.5 }],
        protectedNetFloorMinor: 500_000n, maxDeductionShareBps: 5000,
        monthsRemaining: 5, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: basic * 7n, months: 7 },
      }]);
    }
  }
}
// ESI band edges (gross at / around the 21,000 ceiling) and consolidated contract pay.
for (const gross of [20_999, 21_000, 21_001, 12_000]) {
  cases.push([`consolidated/${gross}`, { basicMinor: rupees(gross), payProfile: { kind: "consolidated_contract" }, pensionScheme: "EPF", ptMinor: 20_000n }]);
}
for (const basic of [15_000, 21_000]) {
  cases.push([`old-regime/${basic}`, { basicMinor: rupees(basic), taxRegime: "old", pensionScheme: "EPF", declaration: { rentPaidAnnualMinor: rupees(120_000), ded80cMinor: rupees(150_000) } }]);
}

describe("S8 pin: computeSlip output unchanged with every S8 seam input omitted", () => {
  const actual = Object.fromEntries(cases.map(([k, i]) => [k, JSON.parse(ser(computeSlip(i)))]));
  it("regenerates or matches the committed fixture", () => {
    if (process.env.UPDATE_S8_PIN === "1") { writeFileSync(FIXTURE, JSON.stringify(actual, null, 1) + "\n"); return; }
    const pinned = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(Object.keys(actual)).toEqual(Object.keys(pinned));
    expect(actual).toEqual(pinned);
  });
  it("covers a meaningful matrix", () => { expect(cases.length).toBeGreaterThan(300); });
});
