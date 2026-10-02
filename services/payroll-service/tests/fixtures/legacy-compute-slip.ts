/**
 * VERBATIM copy of computeSlip() (and its private helpers) from
 * services/payroll-service/src/modules/payroll/domain.ts at origin/main
 * a426483c6 (after #1782, FR 53 subsistence) -- i.e. BEFORE PAY-PROFILES.
 * Used only as the oracle for the byte-identity property test
 * (pay-profiles-legacy-oracle.test.ts). Do not edit: it must keep describing
 * the legacy computation exactly.
 */
/* eslint-disable */
import { hraExemptionMinor, annualTaxFromTaxableMinor, trueUpTdsMinor, stdDeduction, divRoundBig, PLATFORM_DEFAULT_TENANT_ID } from "../../src/modules/tax/engine.js";
import { DEFAULT_STATUTORY_CONFIG, type SlipInput, type SlipResult, type PayComponent, type CityClass, type RawComponent } from "../../src/modules/payroll/domain.js";

/** Deduction codes treated as "recovery" — subject to the protected-net floor. */
const RECOVERY_CODES = new Set(["LOP", "LOAN_EMI", "ARREAR_RECOVERY"]);

const GPF_PCT     = 10n;
const NPS_EMP_PCT = 10n;
const NPS_ER_PCT  = 14n;
const GRATUITY_CAP = 200_000_000n; // 20 lakh INR

/** Round a paise amount to the nearest whole rupee (round-half-up). */
function roundRupee(x: bigint): bigint {
  if (x < 0n) return -roundRupee(-x);
  return ((x + 50n) / 100n) * 100n;
}

function pct(base: bigint, percent: bigint): bigint {
  return roundRupee((base * percent) / 100n);
}

/** 7th CPC HRA slab % by city class, escalating with DA threshold (25% / 50%). */
function hraSlabPct(cityClass: CityClass, daRateBps: bigint): bigint {
  const tier = daRateBps >= 5000n ? 2 : daRateBps >= 2500n ? 1 : 0; // DA>=50% / >=25%
  const table: Record<CityClass, [bigint, bigint, bigint]> = {
    X: [24n, 27n, 30n],
    Y: [16n, 18n, 20n],
    Z: [8n, 9n, 10n],
  };
  return table[cityClass][tier];
}

/**
 * Monthly amount of one configured structure component (fixed, or % of basic).
 * pctOfBasic takes precedence over fixedMinor when configured and > 0
 * (REL-009: was previously divided by 100n only, inflating every
 * percentage-based component 100x). Math.round(pctOfBasic * 100) preserves
 * 2 decimal places of the percentage as an integer, so the divisor must be
 * 10_000n: 100 to undo that pre-multiplication, and 100 to convert percent
 * to a fraction. E.g. pctOfBasic=12.5 -> round(1250) -> basic*1250/10_000.
 */
function rawComponentAmountMinor(basicMinor: bigint, c: RawComponent): bigint {
  return c.pctOfBasic != null && c.pctOfBasic > 0
    ? roundRupee((basicMinor * BigInt(Math.round(c.pctOfBasic * 100))) / 10_000n)
    : roundRupee(c.fixedMinor ?? 0n);
}

export function legacyComputeSlip(input: SlipInput): SlipResult {
  const {
    basicMinor,
    daRateBps = 0n,
    cityClass = "X",
    ptMinor = 0n,
    components = [],
    rawComponents = [],
    pensionScheme = "EPF",
    statutoryPf = true,
    statutoryEsi = true,
    taxRegime = "new",
    fyStartYear = 2025,
    declaration = {},
    tdsYtdMinor,
    monthsRemaining,
    protectedNetFloorMinor = 0n,
    ltcExemptTotalMinor = 0n,
    statutoryConfig = DEFAULT_STATUTORY_CONFIG,
    taxTenantId = PLATFORM_DEFAULT_TENANT_ID,
    earningsOverride,
  } = input;

  const earnings: PayComponent[] = [];
  const deductions: PayComponent[] = [];

  let daMinor: bigint;
  let hraMinor: bigint;
  if (earningsOverride) {
    // FR 53 suspension: subsistence.ts already built the pay lines (regular
    // days prorated + Subsistence Allowance + DA on it + continuing HRA/CCA).
    // Copied so the floor-trimming below never mutates the caller's objects.
    for (const c of earningsOverride.components) {
      (c.type === "earning" ? earnings : deductions).push({ ...c });
    }
    daMinor = earningsOverride.daMinor;
    hraMinor = earningsOverride.hraMinor;
  } else {
    // Basic is the first earning.
    earnings.push({ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: basicMinor });

    // Dearness Allowance = DA% of basic.
    daMinor = roundRupee((basicMinor * daRateBps) / 10000n);
    if (daMinor > 0n) earnings.push({ code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: daMinor });

    // HRA = city-class slab % of basic (escalates with DA threshold).
    hraMinor = pct(basicMinor, hraSlabPct(cityClass, daRateBps));
    if (hraMinor > 0n) earnings.push({ code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: hraMinor });

    // Evaluate remaining structure components (skip BASIC/DA/HRA — handled above).
    for (const c of rawComponents) {
      if (["BASIC", "DA", "HRA"].includes(c.code)) continue;
      const amt = rawComponentAmountMinor(basicMinor, c);
      if (amt === 0n) continue;
      (c.type === "earning" ? earnings : deductions).push({ code: c.code, name: c.name, type: c.type, amountMinor: amt });
    }
  }

  // Ad-hoc components (LOP, EMI, arrears, reimbursements).
  for (const c of components) {
    (c.type === "earning" ? earnings : deductions).push({ ...c, amountMinor: roundRupee(c.amountMinor) });
  }

  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);

  // Pension contributions are computed on Basic + DA. FR 53 suspension: only
  // the regular days' Basic + DA (FR 53(2)(ii): no GPF subscription from
  // subsistence allowance -- see subsistence.ts).
  const pensionBase = earningsOverride ? earningsOverride.pensionBaseMinor : basicMinor + daMinor;

  let pfEmployeeMinor = 0n, pfEmployerMinor = 0n, epsMinor = 0n, epfEmployerMinor = 0n;
  let gpfMinor = 0n, npsEmployeeMinor = 0n, npsEmployerMinor = 0n;

  if (pensionScheme === "GPF") {
    gpfMinor = pct(pensionBase, GPF_PCT);
  } else if (pensionScheme === "NPS") {
    // Pension scheme is authoritative per-employee: an employee on NPS always
    // gets NPS. (The engagement type gates payroll INCLUSION via isPayrollEligible
    // — an excluded type never reaches computeSlip — not which pension scheme
    // applies. Gating NPS by a type flag here previously zeroed pension entirely
    // for an NPS-scheme employee of a type with statutoryNps=false, with no
    // fall-through to EPF. statutoryNps is retained on SlipInput for callers but
    // no longer suppresses a scheme-driven contribution.)
    npsEmployeeMinor = pct(pensionBase, NPS_EMP_PCT);
    npsEmployerMinor = pct(pensionBase, NPS_ER_PCT);
  } else if (statutoryPf) {
    // Engagement gate: no EPF/EPS for a type whose policy excludes provident fund.
    const pfWage    = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    pfEmployeeMinor = pct(pfWage, statutoryConfig.pfRatePct);
    pfEmployerMinor = pct(pfWage, statutoryConfig.pfRatePct);
    const epsWage   = pensionBase > statutoryConfig.pfWageCapMinor ? statutoryConfig.pfWageCapMinor : pensionBase;
    epsMinor        = roundRupee((epsWage * statutoryConfig.epsRateBps) / 10000n);
    if (epsMinor > statutoryConfig.epsCapMinor) epsMinor = statutoryConfig.epsCapMinor;
    epfEmployerMinor = pfEmployerMinor - epsMinor;
  }

  // Engagement gate: ESI only when the type's policy allows it AND under the cap.
  const esiApplicable    = statutoryEsi && grossMinor <= statutoryConfig.esiWageCapMinor;
  const esiMinor         = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployeeRateBps) / 10000n) : 0n;
  const esiEmployerMinor = esiApplicable ? roundRupee((grossMinor * statutoryConfig.esiEmployerRateBps) / 10000n) : 0n;

  const pt = roundRupee(ptMinor);
  if (pt > 0n) deductions.push({ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: pt });

  // Monthly TDS (Sec 192) on real annual TAXABLE income: regime-aware, with
  // Sec 16 std deduction + PT, Sec 10(13A) HRA exemption, and Chapter VI-A (old regime).
  const annualGross = grossMinor * 12n;
  // Additions taxed under BOTH regimes (added before slabs):
  //  - perquisites Sec 17(2) (current employer, not part of cash gross),
  //  - previous-employer taxable salary for the FY (Sec 192(2)),
  //  - income from other sources.
  const perqMinor       = declaration.perquisitesMinor ?? 0n;
  const prevEmpSalMinor = declaration.prevEmployerSalaryMinor ?? 0n;
  const otherSrcMinor   = declaration.otherSourcesIncomeMinor ?? 0n;
  const extraIncome     = perqMinor + prevEmpSalMinor + otherSrcMinor;
  let annualTaxableMinor: bigint;
  // DOM-008: standard deduction now sourced from payroll.tax_slab_config (the
  // same FY-versioned config fnf/domain.ts and tax/routes.ts already read via
  // stdDeduction()) instead of a second literal that had to be kept in sync by
  // hand. stdDeduction() throws UnconfiguredFyError for an unregistered
  // (regime, FY) exactly like annualTaxFromTaxableMinor() below already does
  // for this same pair, so this adds no new failure mode.
  const stdDeductionMinor = BigInt(stdDeduction(taxRegime, fyStartYear, taxTenantId)) * 100n;
  if (taxRegime === "old") {
    const salaryHraAnnual   = (earningsOverride ? earningsOverride.hraSalaryMinor : basicMinor + daMinor) * 12n;
    const hraReceivedAnnual = hraMinor * 12n;
    const rentAnnual        = declaration.rentPaidAnnualMinor ?? 0n;
    const hraExempt = hraExemptionMinor(salaryHraAnnual, hraReceivedAnnual, rentAnnual, cityClass === "X");
    const d80c = declaration.ded80cMinor ?? 0n; const c80c = d80c > statutoryConfig.sec80cCapMinor ? statutoryConfig.sec80cCapMinor : d80c;
    const d80d = declaration.ded80dMinor ?? 0n; const c80d = d80d > statutoryConfig.sec80dCapMinor ? statutoryConfig.sec80dCapMinor : d80d;
    const other = declaration.otherDedMinor ?? 0n;
    annualTaxableMinor = annualGross + extraIncome - stdDeductionMinor - hraExempt - c80c - c80d - other - pt * 12n - ltcExemptTotalMinor;
  } else {
    annualTaxableMinor = annualGross + extraIncome - stdDeductionMinor - ltcExemptTotalMinor; // new regime: standard deduction + LTC exempt
  }
  if (annualTaxableMinor < 0n) annualTaxableMinor = 0n;
  const annualTaxMinor = annualTaxFromTaxableMinor(annualTaxableMinor, taxRegime, fyStartYear, taxTenantId);
  // LOW (payroll-calc audit): the flat /12 fallback (no monthsRemaining
  // supplied) used plain truncating division, the same under-withholding
  // pattern as the pension-run TDS bug (consumer.ts processPensionRun).
  // Currently unreachable in production -- computeAndInsertSlip's one real
  // caller (processPayrollRun) always supplies monthsRemaining -- but this
  // branch IS exercised directly by callers of computeSlip() that omit it
  // (e.g. a preview/estimate with no run context), so it is fixed for
  // consistency: round-half-up via tax/engine.ts's own divRoundBig, not a
  // flat truncate.
  const tdsMinor = monthsRemaining != null
    ? trueUpTdsMinor(annualTaxMinor, tdsYtdMinor ?? 0n, monthsRemaining)         // Sec 192 true-up
    : roundRupee(divRoundBig(annualTaxMinor, 12n));                              // flat /12 fallback

  // Statutory pension/insurance/tax deductions are never floored.
  const statutoryDeductions = pfEmployeeMinor + esiMinor + tdsMinor + gpfMinor + npsEmployeeMinor;

  // Split ad-hoc deductions into recovery (floor-capped) and fixed (e.g. PT, and
  // any structure-defined deduction). Fixed deductions are not subject to the floor.
  const recoveryRequested = deductions
    .filter((d) => RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);
  const fixedAdHoc = deductions
    .filter((d) => !RECOVERY_CODES.has(d.code))
    .reduce((s, d) => s + d.amountMinor, 0n);

  // Headroom available for recovery after gross less all non-recovery deductions,
  // keeping net at or above the protected floor.
  const nonRecovery   = statutoryDeductions + fixedAdHoc;
  const headroom      = grossMinor - nonRecovery - protectedNetFloorMinor;
  const recoveryCap   = headroom < 0n ? 0n : headroom;
  const recoveryApplied = recoveryRequested > recoveryCap ? recoveryCap : recoveryRequested;
  const recoveryCarryForwardMinor = recoveryRequested - recoveryApplied;

  // If recovery was capped, scale down the recovery deduction line items so the
  // persisted slip reflects what was actually withheld (carry the remainder).
  if (recoveryCarryForwardMinor > 0n && recoveryRequested > 0n) {
    let remainingToTrim = recoveryCarryForwardMinor;
    // Trim from the largest recovery lines first (deterministic by amount desc).
    const recoveryLines = deductions
      .filter((d) => RECOVERY_CODES.has(d.code))
      .sort((a, b) => (a.amountMinor < b.amountMinor ? 1 : -1));
    for (const line of recoveryLines) {
      if (remainingToTrim <= 0n) break;
      const trim = line.amountMinor < remainingToTrim ? line.amountMinor : remainingToTrim;
      line.amountMinor -= trim;
      remainingToTrim -= trim;
    }
    // Drop fully-trimmed recovery lines.
    for (let i = deductions.length - 1; i >= 0; i--) {
      const d = deductions[i]!;
      if (RECOVERY_CODES.has(d.code) && d.amountMinor === 0n) deductions.splice(i, 1);
    }
  }

  const totalDeductions = nonRecovery + recoveryApplied;
  const netRaw          = grossMinor - totalDeductions;
  // With the floor enforced, netRaw can still legitimately be 0 (no floor + full
  // recovery). negativeNet now only ever true if floor is 0 and fixed/statutory
  // alone exceed gross (an upstream data error worth flagging as an exception).
  const negativeNet     = netRaw < 0n;

  return {
    grossMinor,
    totalDeductionsMinor: totalDeductions,
    netPayMinor: negativeNet ? 0n : netRaw,
    recoveryCarryForwardMinor,
    daMinor, hraMinor, earnings, deductions,
    pfEmployeeMinor, pfEmployerMinor, epsMinor, epfEmployerMinor,
    esiMinor, esiEmployerMinor, ptMinor: pt, tdsMinor,
    gpfMinor, npsEmployeeMinor, npsEmployerMinor, annualTaxableMinor, negativeNet,
  };
}

