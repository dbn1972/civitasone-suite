/**
 * PAY-PROFILES: turn one employee's HRMS payroll-input record (pay profile +
 * deputation pay terms) and the tenant's effective allowance rules into the
 * concrete inputs the payroll run feeds computeSlip. Pure, so the run, the
 * preflight check, the tax HRA-exemption path and the HRA-floor impact
 * report all derive pay inputs identically.
 *
 * An employee with no pay profile (an HRMS that predates PAY-PROFILES, or no
 * approved profile) plans as govt_scale with exactly the inputs the run used
 * before: HRMS basic (revision-aware), central DA rate, the run structure,
 * HRMS pension scheme, LOP as a deduction on Basic + DA.
 */
import type { PayrollInputEmployee, PayProfile } from "../../shared/hrms-client.js";
import type { CityClass, PensionScheme, SlipPayProfile, DeputationStationType } from "../payroll/domain.js";
import { deputationAllowanceMinor } from "../payroll/domain.js";
import type { AllowanceRules } from "./allowance-rules.js";

export interface EmployeePayPlan {
  profile: PayProfile;
  slipProfile: SlipPayProfile;
  /** Basic before any payroll salary revision (consolidated: the full monthly amount). */
  profileBasicMinor: bigint;
  /** Whether a payroll salary revision may override profileBasicMinor (and generate retro arrears). */
  applyRevisions: boolean;
  /** Whether the run's structure components apply. */
  applyRunStructure: boolean;
  /** "deduction": LOP line on (Basic + DA [+ DEP_ALLOW]); "prorate": earnings pro-rated by paid days. */
  lopMode: "deduction" | "prorate";
  /**
   * Retro arrears for a back-dated revision: "central" prices each period at
   * that period's central DA (legacy); "plan_rate" prices every period at the
   * plan's own DA rate -- a parent-State-DA deputationist, whose parent DA
   * history is not recorded (preflight warns to verify such arrears).
   */
  arrearDaBasis: "central" | "plan_rate";
  daRateBps: bigint;
  pensionScheme: PensionScheme;
  hraFloorMinor: bigint;
  /** Persisted on the slip (payroll_slips.profile_snapshot). */
  snapshot: Record<string, unknown>;
}

export type PlanResult = { ok: true; plan: EmployeePayPlan } | { ok: false; code: string; message: string };

function monthBounds(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

const fail = (code: string, emp: Pick<PayrollInputEmployee, "employeeNo">, detail: string): PlanResult =>
  ({ ok: false, code, message: `[${code}] employee ${emp.employeeNo}: ${detail}` });

export function planEmployeePay(
  emp: PayrollInputEmployee,
  month: string,
  centralDaRateBps: bigint,
  rules: AllowanceRules,
): PlanResult {
  const cityClass: CityClass = emp.cityClass ?? "X";
  const feed = emp.payProfile;
  const profile: PayProfile = feed?.profile ?? "govt_scale";
  const hraFloorMinor = rules.hraFloorMinor[cityClass];
  const base = {
    profile: profile,
    profileId: feed?.profileId ?? null,
    hraFloorMinor: hraFloorMinor.toString(),
    eligibleForGratuity: emp.engagement?.eligibleForGratuity ?? null,
    leaveEncashmentEligible: emp.engagement?.leaveEncashment ?? null,
    engagementCategory: emp.engagement?.category ?? null,
  };

  if (profile === "govt_scale") {
    return {
      ok: true,
      plan: {
        profile, slipProfile: { kind: "govt_scale" },
        profileBasicMinor: BigInt(emp.basicMinor),
        applyRevisions: true, applyRunStructure: true, lopMode: "deduction", arrearDaBasis: "central",
        daRateBps: centralDaRateBps,
        pensionScheme: emp.pensionScheme ?? "NPS",
        hraFloorMinor,
        snapshot: { ...base, daSource: "central", daRateBps: centralDaRateBps.toString() },
      },
    };
  }

  if (profile === "ctc_contract") {
    return fail("CTC_PROFILE_NOT_SUPPORTED", emp, "the ctc_contract pay profile is computed by the CTC module, which is not deployed yet (PAY-PROFILES PR3)");
  }

  if (profile === "consolidated_contract") {
    if (!feed?.consolidatedMonthlyMinor) return fail("CONSOLIDATED_AMOUNT_MISSING", emp, "consolidated_contract profile carries no consolidated monthly amount");
    const amount = BigInt(feed.consolidatedMonthlyMinor);
    return {
      ok: true,
      plan: {
        profile, slipProfile: { kind: "consolidated_contract" },
        profileBasicMinor: amount,
        applyRevisions: false, applyRunStructure: false, lopMode: "prorate", arrearDaBasis: "central",
        daRateBps: 0n, pensionScheme: "EPF", hraFloorMinor: 0n,
        snapshot: { ...base, hraFloorMinor: "0", consolidatedMonthlyMinor: amount.toString() },
      },
    };
  }

  // Deputation profiles (Option A / Option B).
  const dep = feed?.deputation;
  if (!dep) return fail("DEPUTATION_TERMS_MISSING", emp, `${profile} profile carries no deputation pay terms`);
  const expected = profile === "deputation_parent_scale" ? "parent_scale" : "post_scale";
  if (dep.option !== expected) return fail("DEPUTATION_OPTION_MISMATCH", emp, `${profile} needs a ${expected} deputation, found ${dep.option ?? "none"}`);
  const { start, end } = monthBounds(month);
  // A deputation profile whose deputation no longer covers the month --
  // cancelled, ended, or repatriated before the month began (repatriation
  // leaves the approved profile open until HR closes it) -- FAILS the run
  // naming the employee rather than silently falling back to govt_scale:
  // a repatriated deputed-IN employee is usually not ours to pay at all, and
  // a deputed-OUT one needs an explicit profile decision. Preflight lists it.
  const repatriatedBefore = dep.status === "repatriated" && (dep.repatriatedOn == null || dep.repatriatedOn < start);
  if (dep.status === "cancelled" || repatriatedBefore || dep.tenureFrom > end || dep.tenureTo < start) {
    return fail("DEPUTATION_NOT_IN_FORCE", emp, `deputation ${dep.id} (${dep.status}${dep.repatriatedOn ? ` on ${dep.repatriatedOn}` : ""}, ${dep.tenureFrom}..${dep.tenureTo}) does not cover ${month}; close or replace the pay profile`);
  }
  let daRateBps = centralDaRateBps;
  if (dep.daSource === "parent") {
    if (dep.parentDaRateBps == null) return fail("PARENT_DA_RATE_REQUIRED", emp, "deputation DA source is 'parent' but no parent DA rate is recorded");
    daRateBps = BigInt(dep.parentDaRateBps);
  }
  const pensionScheme: PensionScheme = dep.parentPensionScheme ?? emp.pensionScheme ?? "NPS";
  const depBase = {
    ...base,
    deputationId: dep.id, direction: dep.direction, option: dep.option, stationType: dep.stationType,
    foreignService: dep.foreignService, parentOrganisation: dep.parentOrganisation,
    daSource: dep.daSource, daRateBps: daRateBps.toString(), pensionScheme,
  };

  if (profile === "deputation_post_scale") {
    if (dep.postBasicMinor == null) return fail("POST_BASIC_REQUIRED", emp, "Option B deputation has no post basic recorded");
    return {
      ok: true,
      plan: {
        profile, slipProfile: { kind: "deputation_post_scale" },
        profileBasicMinor: BigInt(dep.postBasicMinor),
        applyRevisions: true, applyRunStructure: true, lopMode: "deduction",
        arrearDaBasis: dep.daSource === "parent" ? "plan_rate" : "central",
        daRateBps, pensionScheme, hraFloorMinor,
        snapshot: depBase,
      },
    };
  }

  // Option A: parent scale + deputation (duty) allowance.
  if (dep.direction === "in" && dep.parentBasicMinor == null) {
    return fail("PARENT_BASIC_REQUIRED", emp, "Option A deputed-IN employee has no parent basic recorded");
  }
  const stationType: DeputationStationType | null = dep.stationType;
  const rule = stationType ? rules.deputation[stationType] : null;
  const allowance = {
    mode: dep.allowanceMode,
    fixedMinor: BigInt(dep.fixedAllowanceMinor),
    stationType,
    rule,
  } as const;
  const profileBasicMinor = dep.parentBasicMinor != null ? BigInt(dep.parentBasicMinor) : BigInt(emp.basicMinor);
  const preview = deputationAllowanceMinor(profileBasicMinor, allowance);
  return {
    ok: true,
    plan: {
      profile, slipProfile: { kind: "deputation_parent_scale", allowance },
      profileBasicMinor,
      applyRevisions: true, applyRunStructure: true, lopMode: "deduction",
      arrearDaBasis: dep.daSource === "parent" ? "plan_rate" : "central",
      daRateBps, pensionScheme, hraFloorMinor,
      snapshot: {
        ...depBase,
        allowanceMode: dep.allowanceMode,
        allowanceBasis: preview.basis,
        allowanceRule: rule ? { rateBps: rule.rateBps.toString(), capMinor: rule.capMinor.toString() } : null,
        fixedAllowanceMinor: dep.fixedAllowanceMinor,
      },
    },
  };
}
