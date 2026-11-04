/**
 * UAT b18 (EPF for contract staff, 2026-11-05) -- pure rules.
 *   D4  ECR 2.0 text layout ("#~#", 11 fields, fixed order) -- golden file.
 *   D3  UAN must be 12 digits; members with a missing / invalid UAN are listed.
 *   D5  employer EDLI (0.5% of EDLI wages capped at Rs 15,000) and EPF admin
 *       charges (0.5% of EPF wages, Rs 500 establishment minimum), configurable.
 *   D6  the PF wage is the wage actually used: min(Basic + DA, ceiling).
 *   D1  UPS contributions (employee 10%, Government 18.5% of Basic + DA).
 * Expected values are worked by hand from the statutory rates, not from the code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildEcrFile, formatEcrLine, isValidUan, uanProblems, ncpDaysFromComponents, ecrText, ECR_FIELD_SEPARATOR,
} from "../src/modules/statutory/ecr-domain.js";
import {
  epfEmployerCharges, epfAdminChargeForPeriod, DEFAULT_STATUTORY_CONFIG, resolveStatutoryConfig, computeSlip, upsPoolShareMinor,
} from "../src/modules/payroll/domain.js";
import { computedSchemeOf } from "../src/modules/payroll/pension-scheme-retro.js";
import { missingRegimes, fyLabel } from "../src/modules/tax/config-check.js";

const GOLDEN = readFileSync(new URL("./fixtures/ecr-2.0-golden.txt", import.meta.url), "utf8");

describe("D4: ECR 2.0 text file (#~# separator, EPFO column order)", () => {
  it("matches the golden file byte for byte", () => {
    const body = buildEcrFile([
      { uan: "100200300400", memberName: "Asha Kumari", grossWages: 33840, epfWages: 15000, epsWages: 15000, edliWages: 15000,
        epfContributionEe: 1800, epsContributionEr: 1250, epfEpsDiffEr: 550, ncpDays: 0, refundOfAdvances: 0 },
      // A crafted name cannot inject a separator or a line break.
      { uan: "100200300401", memberName: "Ravi #~# Prasad\r\n", grossWages: 12500, epfWages: 12000, epsWages: 12000, edliWages: 12000,
        epfContributionEe: 1440, epsContributionEr: 1000, epfEpsDiffEr: 440, ncpDays: 2, refundOfAdvances: 0 },
    ]);
    expect(body).toBe(GOLDEN);
  });

  it("every golden line has exactly 11 fields, no pipe, whole numbers in fields 3-11", () => {
    const lines = GOLDEN.split("\r\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain("|");
      const f = line.split(ECR_FIELD_SEPARATOR);
      expect(f).toHaveLength(11);
      expect(isValidUan(f[0])).toBe(true);
      for (const n of f.slice(2)) expect(n).toMatch(/^\d+$/);
    }
  });

  it("field order is UAN, name, gross, EPF, EPS, EDLI wages, EE, EPS, EPF-EPS diff, NCP, refund", () => {
    const line = formatEcrLine({ uan: "123456789012", memberName: "N", grossWages: 3, epfWages: 4, epsWages: 5, edliWages: 6,
      epfContributionEe: 7, epsContributionEr: 8, epfEpsDiffEr: 9, ncpDays: 10, refundOfAdvances: 11 });
    expect(line).toBe("123456789012#~#N#~#3#~#4#~#5#~#6#~#7#~#8#~#9#~#10#~#11");
  });

  it("ecrText strips # ~ CR LF and collapses whitespace", () => {
    expect(ecrText(" A#B~C\r\nD ")).toBe("A B C D");
    expect(ecrText(null)).toBe("");
  });
});

describe("D3: UAN validation for EPF members", () => {
  it("a UAN is exactly 12 digits", () => {
    expect(isValidUan("100200300400")).toBe(true);
    expect(isValidUan("10020030040")).toBe(false);   // 11 digits
    expect(isValidUan("1002003004000")).toBe(false); // 13 digits
    expect(isValidUan("UAN100200300")).toBe(false);
    expect(isValidUan("")).toBe(false);
    expect(isValidUan(null)).toBe(false);
  });

  it("lists every member with a missing or invalid UAN, and nobody else", () => {
    expect(uanProblems([
      { employeeId: "e1", employeeNo: "UATG1-25595", uan: null },
      { employeeId: "e2", employeeNo: "UATG1-37007", uan: "  " },
      { employeeId: "e3", employeeNo: "UATG1-71359", uan: "12345" },
      { employeeId: "e4", employeeNo: "UATG1-34944", uan: "100200300400" },
    ])).toEqual([
      { employeeId: "e1", employeeNo: "UATG1-25595", problem: "missing" },
      { employeeId: "e2", employeeNo: "UATG1-37007", problem: "missing" },
      { employeeId: "e3", employeeNo: "UATG1-71359", problem: "invalid" },
    ]);
  });

  it("NCP days are the slip LOP days, rounded to whole days", () => {
    expect(ncpDaysFromComponents([{ code: "BASIC" }, { code: "LOP", lopDays: 2 }, { code: "LOP", lopDays: 0.5 }])).toBe(3);
    expect(ncpDaysFromComponents([{ code: "BASIC" }])).toBe(0);
  });
});

describe("D5 / D6: EPF wage used, EDLI and admin charges (employer only)", () => {
  const cfg = DEFAULT_STATUTORY_CONFIG;

  it("defaults: EDLI 0.5% capped at Rs 15,000 wages, admin 0.5%, admin minimum Rs 500", () => {
    expect(cfg.edliRateBps).toBe(50n);
    expect(cfg.edliWageCapMinor).toBe(1_500_000n);
    expect(cfg.epfAdminRateBps).toBe(50n);
    expect(cfg.epfAdminMinMinor).toBe(50_000n);
  });

  it("UAT employee: Basic + DA Rs 28,440 -> PF wage Rs 15,000 (not 28,440), EDLI Rs 75, admin Rs 75", () => {
    expect(epfEmployerCharges(2_844_000n, cfg)).toEqual({
      pfWageMinor: 1_500_000n, edliWageMinor: 1_500_000n, edliMinor: 7_500n, epfAdminMinor: 7_500n,
    });
  });

  it("below the ceiling the full Basic + DA is used: Rs 12,000 -> EDLI Rs 60, admin Rs 60", () => {
    expect(epfEmployerCharges(1_200_000n, cfg)).toEqual({
      pfWageMinor: 1_200_000n, edliWageMinor: 1_200_000n, edliMinor: 6_000n, epfAdminMinor: 6_000n,
    });
  });

  it("rates are configurable (a tenant row with EDLI 1% and admin 0.65%)", () => {
    const c = { ...cfg, edliRateBps: 100n, epfAdminRateBps: 65n };
    // admin 0.65% x 15,000 = 97.50 -> Rs 98 (rupee rounding, half up)
    expect(epfEmployerCharges(2_000_000n, c)).toMatchObject({ edliMinor: 15_000n, epfAdminMinor: 9_800n });
  });

  it("A/c 2 for the month is at least the Rs 500 minimum when there is any member, 0 when none", () => {
    expect(epfAdminChargeForPeriod(45_000n, 6, cfg)).toBe(50_000n);   // 6 x Rs 75 = Rs 450 -> Rs 500
    expect(epfAdminChargeForPeriod(150_000n, 20, cfg)).toBe(150_000n);
    expect(epfAdminChargeForPeriod(0n, 0, cfg)).toBe(0n);
  });

  it("resolveStatutoryConfig carries the new fields from a config row", () => {
    const r = resolveStatutoryConfig([{ ...cfg, tenantId: null, effectiveFrom: "2000-01-01", edliRateBps: 40n }], "t", "2027-02");
    expect(r.edliRateBps).toBe(40n);
    expect(r.epfAdminMinMinor).toBe(50_000n);
  });

  it("the charges never change the slip: computeSlip net pay is the same with or without them", () => {
    const s = computeSlip({ basicMinor: 1_800_000n, daRateBps: 5800n, cityClass: "X", pensionScheme: "EPF", fyStartYear: 2026 });
    expect(s.pfEmployeeMinor).toBe(180_000n); // 12% of Rs 15,000
    expect(s.epsMinor).toBe(125_000n);
    expect(s.netPayMinor).toBe(s.grossMinor - s.totalDeductionsMinor);
  });
});

describe("D1: UPS contributions and the retro report scheme inference", () => {
  it("UPS: employee 10%; Government 10% individual + 8.5% pool (separate) = 18.5% of Basic + DA; no EPF", () => {
    // Basic Rs 50,000 + DA 0 -> employee Rs 5,000, individual Rs 5,000, pool Rs 4,250 (total Govt Rs 9,250)
    const s = computeSlip({ basicMinor: 5_000_000n, daRateBps: 0n, cityClass: "Z", pensionScheme: "UPS", fyStartYear: 2026 });
    expect(s.npsEmployeeMinor).toBe(500_000n);
    expect(s.npsEmployerMinor).toBe(500_000n);
    expect(upsPoolShareMinor(s.npsPensionBaseMinor)).toBe(425_000n);
    expect(s.npsEmployerMinor + upsPoolShareMinor(s.npsPensionBaseMinor)).toBe(925_000n);
    expect(s.pfEmployeeMinor).toBe(0n);
    expect(s.gpfMinor).toBe(0n);
    // the pool share never touches the slip: net is unchanged by it
    expect(s.netPayMinor).toBe(s.grossMinor - s.totalDeductionsMinor);
  });

  it("UPS pool share rounds to the rupee (8.5% of Rs 28,440 = Rs 2,417.40 -> Rs 2,417) and is 0 on no base", () => {
    expect(upsPoolShareMinor(2_844_000n)).toBe(241_700n);
    expect(upsPoolShareMinor(0n)).toBe(0n);
  });

  it("NPS is unchanged: employee 10%, employer 14%", () => {
    const s = computeSlip({ basicMinor: 5_000_000n, daRateBps: 0n, cityClass: "Z", pensionScheme: "NPS", fyStartYear: 2026 });
    expect(s.npsEmployeeMinor).toBe(500_000n);
    expect(s.npsEmployerMinor).toBe(700_000n);
  });

  it("computedSchemeOf tells GPF / NPS / UPS / EPF / none apart from the slip columns", () => {
    const z = { gpfMinor: 0n, npsEmployeeMinor: 0n, npsEmployerMinor: 0n, pfEmployeeMinor: 0n };
    expect(computedSchemeOf({ ...z, gpfMinor: 100n })).toBe("GPF");
    expect(computedSchemeOf({ ...z, npsEmployeeMinor: 500_000n, npsEmployerMinor: 700_000n })).toBe("NPS");
    expect(computedSchemeOf({ ...z, npsEmployeeMinor: 500_000n, npsEmployerMinor: 500_000n })).toBe("UPS");
    expect(computedSchemeOf({ ...z, pfEmployeeMinor: 180_000n })).toBe("EPF");
    expect(computedSchemeOf(z)).toBe("NONE");
  });
});

describe("D2: tax config pre-check helpers", () => {
  it("both regimes are required for the FY", () => {
    expect(missingRegimes(["new", "old"])).toEqual([]);
    expect(missingRegimes(["new"])).toEqual(["old"]);
    expect(missingRegimes([])).toEqual(["new", "old"]);
  });
  it("FY label", () => { expect(fyLabel(2027)).toBe("2027-28"); expect(fyLabel(2099)).toBe("2099-00"); });
});
