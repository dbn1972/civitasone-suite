import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, COMMANDS } from "../../topics.js";
import * as lopRepo from "./lop-repo.js";
import { leaveLopDays } from "./lop-math.js";
import { fetchAttendanceLopApplies, fetchLeaveLopFractionBps } from "../../shared/hrms-client.js";
import * as statutoryRepo from "../statutory/repo.js";
import { completedYearsPgAct, computeLeaveEncashmentGrossMinor } from "../payroll/domain.js";
import { calendarServiceYears, computeGratuityByRule, loadGratuityRule } from "../gratuity-rules/rules.js";
import { NonRetryableError } from "@civitasone/queue";
import { computeLtcExemption } from "../tax/ltc-exemption.js";
import { ltcExemptions } from "../fnf/schema.js";
import { randomUUID } from "node:crypto";
import { enqueue } from "../../shared/outbox.js";

/**
 * PAY-PROFILES: the separation event's own profile summary (hrms emits the
 * profile in force on the separation date), used when the employee has no
 * slip computed under a profile yet -- e.g. a deputed-IN employee leaving in
 * their first month. Same shape separationPayProfile() reads off a slip.
 */
export function eventPayProfileRow(ev: { profile?: string; deputationDirection?: string | null; consolidatedMonthlyMinor?: string | null } | undefined):
  { pay_profile: string; profile_snapshot: Record<string, unknown> } | null {
  if (!ev?.profile) return null;
  return {
    pay_profile: ev.profile,
    profile_snapshot: {
      ...(ev.deputationDirection ? { direction: ev.deputationDirection } : {}),
      ...(ev.consolidatedMonthlyMinor ? { consolidatedMonthlyMinor: ev.consolidatedMonthlyMinor } : {}),
    },
  };
}

/**
 * PAY-PROFILES: how a separation is settled given the pay profile on the
 * employee's latest slip (null for slips that predate PAY-PROFILES, which
 * keeps the legacy settlement exactly). Pure; exported for tests.
 */
export function separationPayProfile(row: { pay_profile: string; profile_snapshot: Record<string, unknown> | null } | null): {
  finalSalaryOnly: boolean;
  noCentralDa: boolean;
  eligibleForGratuity: boolean;
  /** Consolidated pay: leave encashment only when the engagement policy grants it. */
  leaveEncashmentEligible: boolean;
  consolidatedMonthlyMinor: bigint | null;
  daRateBpsOverride: bigint | null;
} {
  const snap = row?.profile_snapshot ?? {};
  const profile = row?.pay_profile ?? null;
  const deputation = profile === "deputation_parent_scale" || profile === "deputation_post_scale";
  const consolidated = profile === "consolidated_contract";
  const consolidatedAmount = typeof snap.consolidatedMonthlyMinor === "string" && /^\d+$/.test(snap.consolidatedMonthlyMinor)
    ? BigInt(snap.consolidatedMonthlyMinor) : null;
  const parentDa = deputation && snap.daSource === "parent" && typeof snap.daRateBps === "string" && /^\d+$/.test(snap.daRateBps)
    ? BigInt(snap.daRateBps) : null;
  return {
    finalSalaryOnly: deputation && snap.direction === "in",
    noCentralDa: consolidated,
    eligibleForGratuity: snap.eligibleForGratuity !== false,
    leaveEncashmentEligible: consolidated ? snap.leaveEncashmentEligible === true : snap.leaveEncashmentEligible !== false,
    consolidatedMonthlyMinor: consolidated ? consolidatedAmount : null,
    daRateBpsOverride: parentDa,
  };
}

const AUDIT = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.employeeCreated, async (msg) => {
    // Acknowledged: warm-cache for future payroll run input resolution.
    // Currently a no-op (data fetched via hrms-client at run time), but the
    // subscription is registered so the queue contract holds and messages don't
    // dead-letter.
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
  });

  queue.subscribe(CONSUMED_EVENTS.leaveApproved, async (msg) => {
    const p = msg.payload as { employeeId: string; leaveTypeId?: string; daysApplied: number; daysExact?: number; dayPart?: string; fromDate: string };
    const month = p.fromDate.slice(0, 7);
    // BUG-2 fix: gate the ledger write itself on the same DIC engagement
    // exemption the live-pull payroll-input feed applies (consultant/
    // third-party/apprentice are never docked salary LOP). Without this, an
    // exempt employee's approved leave still lands in payrollLopLedger, and
    // the payroll run PREFERS the ledger over the correctly-exempting feed
    // whenever any ledger row exists for the month (see payroll/consumer.ts's
    // "M2 LOP double-count" comment) -- silently overriding the exclusion.
    // Checked BEFORE opening the transaction (a network call) and before
    // markProcessed, mirroring the attendanceMarked status filter below: a
    // legitimately-skipped message is simply never claimed, so a redelivery
    // just re-evaluates the same (idempotent) skip decision.
    if (!(await fetchAttendanceLopApplies(msg.tenantId, p.employeeId))) return;
    // HIGH fix (LOP-ignores-leave-type bug): every approved leave day used
    // to count fully toward LOP with no regard for whether the leave type
    // is paid or unpaid. leaveTypeId is only absent on a message published
    // by pre-fix hrms-service code still in flight at deploy time; treating
    // that (rare, transient) case as "fully counts as LOP" preserves this
    // handler's exact prior behaviour for it rather than silently exempting
    // it. Same before-markProcessed placement as the exemption check above,
    // for the same idempotent-redelivery reason.
    const lopFractionBps = p.leaveTypeId
      ? await fetchLeaveLopFractionBps(msg.tenantId, p.leaveTypeId)
      : 10000;
    if (lopFractionBps === 0) return; // fully-paid leave type: nothing to ledger.
    // Rounded to the nearest whole day: payrollLopLedger.lopDays (and the
    // final deduction formula in payroll/consumer.ts, which converts it via
    // BigInt(lopDays)) are integer-day-count today. For the two
    // classifications currently in use (0 and 10000 bps -- see migration
    // 0151_leave_type_lop_fraction.sql) this is always exact, since either
    // branch above already short-circuits or multiplies by 1. Only a
    // genuinely partial type (currently just HPL at 5000 bps / half pay)
    // rounds -- e.g. 3 days -> 1.5 -> 2. Exact fractional-day precision would
    // additionally require widening payroll_lop_ledger.lop_days to a decimal
    // type and reworking that BigInt conversion; deliberately not done here
    // to avoid a wide change to the live payroll deduction formula for a
    // capability only one real leave type currently uses -- see this
    // change's PR description.
    // GAP-HR-LEAVE-APPLY-05: part-day (half-day / short) leave is carried to
    // two decimals instead of being rounded up to a whole LOP day -- see
    // lop-math.ts. Whole-day leave is unchanged.
    const lopDays = leaveLopDays(p, lopFractionBps);
    if (lopDays <= 0) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "leave", lopDays);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.attendanceMarked, async (msg) => {
    const p = msg.payload as { employeeId: string; attendanceDate: string; status: string };
    if (p.status !== "absent" && p.status !== "half_day") return;
    const month = p.attendanceDate.slice(0, 7);
    // BUG-2 fix: same engagement-exemption gate as leaveApproved above.
    if (!(await fetchAttendanceLopApplies(msg.tenantId, p.employeeId))) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "attendance", 1);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.employeeSeparated, async (msg) => {
    const p = msg.payload as {
      employeeId: string; effectiveDate: string; basicMinor?: string; dateOfJoining?: string;
      separationType?: string; encashmentDays?: number; taxRegime?: "old" | "new"; employeeCategory?: string;
      /** PAY-PROFILES: profile in force on the separation date (hrms). */
      payProfile?: { profile?: string; deputationDirection?: string | null; consolidatedMonthlyMinor?: string | null };
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // PAY-PROFILES: the employee's most recent slip records which pay
      // computation applied (migration 0055). Slips computed before
      // PAY-PROFILES carry no profile, so everything below is unchanged for
      // them and for govt-scale staff.
      const lastProfileRows = (await tx.execute(sql`
        SELECT pay_profile, profile_snapshot
        FROM payroll.payroll_slips
        WHERE tenant_id = ${msg.tenantId}::uuid AND employee_id = ${p.employeeId}::uuid AND pay_profile IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `)) as unknown as Array<{ pay_profile: string; profile_snapshot: Record<string, unknown> | null }>;
      const separationProfile = separationPayProfile(lastProfileRows[0] ?? eventPayProfileRow(p.payProfile));
      const basicMinor = separationProfile.consolidatedMonthlyMinor ?? BigInt(p.basicMinor ?? "0");
      const join = new Date(p.dateOfJoining ?? p.effectiveDate);
      const sep = new Date(p.effectiveDate);
      const years = Math.max(0, (sep.getTime() - join.getTime()) / (365.25 * 86400000));
      // Gratuity emoluments = last Basic + DA (CCS/Gratuity Act). Resolve DA rate at separation.
      // bug-fix (silent-DA-gap): mirrors the identical fix in
      // payroll/consumer.ts's resolveDaRateBps -- a tenant with NO rate row
      // covering the separation date at all is a configuration gap (not a
      // deliberate zero rate, which would be an explicit rate_bps=0 row), and
      // silently treating it as 0n understated gratuity emoluments with no
      // signal anywhere. This handler has no run row to mark 'failed', so it
      // throws and lets the queue's standard consumer-error handling
      // (logged + dead-lettered, same as any other failed event handler)
      // hold the message for redelivery once the rate is configured, instead
      // of computing and persisting a wrong (understated) gratuity amount.
      // PAY-PROFILES: consolidated pay has no central DA, so its wages are the
      // consolidated amount alone and no DA rate is needed.
      let lastDaMinor = 0n;
      if (!separationProfile.noCentralDa) {
        const daRows = (await tx.execute(sql`
          SELECT rate_bps FROM payroll.dearness_allowance_rates
          WHERE tenant_id = ${msg.tenantId}::uuid AND effective_from <= ${p.effectiveDate}::date
          ORDER BY effective_from DESC LIMIT 1
        `)) as unknown as Array<{ rate_bps: number | string }>;
        if (daRows.length === 0) {
          throw new NonRetryableError(`DA_RATE_NOT_CONFIGURED: no Dearness Allowance rate configured for tenant ${msg.tenantId} covering separation date ${p.effectiveDate}; add a payroll.dearness_allowance_rates row (rate_bps=0 if DA genuinely does not apply) before this employee's gratuity can be computed`);
        }
        const daRateBps = separationProfile.daRateBpsOverride ?? BigInt(daRows[0]!.rate_bps);
        lastDaMinor = (basicMinor * daRateBps) / 10000n;
      }
      // BUG FIX (death/disablement gratuity denial): separationType was
      // already destructured above (it's used for the fnfCompute payload
      // below) but was never passed into computeGratuity, so its 5-year
      // floor applied unconditionally -- a death or disablement separation
      // under 5 years silently computed (and persisted) a zero gratuity,
      // contrary to the Payment of Gratuity Act, 1972 §4(1) first proviso /
      // Code on Social Security, 2020 §53(1) proviso, which waive that floor
      // for exactly those two causes. See
      // MIN_SERVICE_WAIVED_SEPARATION_TYPES in payroll/domain.ts.
      // PAY-PROFILES: a deputed-IN employee's gratuity is the PARENT
      // organisation's liability -- this tenant settles the final salary
      // only; likewise when the engagement is not gratuity-eligible.
      // GAP-PAYROLL-STATUTORY-GRATUITY-01: the rule set (Payment of Gratuity
      // Act vs CCS DCRG), 5-year floor and ceiling come from the tenant's
      // effective-dated statutory.gratuity_rule_config row; no row => the
      // built-in Payment of Gratuity Act default (unchanged behaviour).
      const gratuityRule = await loadGratuityRule(tx, msg.tenantId, p.effectiveDate);
      const gratuityMinor = separationProfile.finalSalaryOnly || !separationProfile.eligibleForGratuity
        ? 0n
        : computeGratuityByRule(
            gratuityRule,
            // DCRG counts completed six-monthly periods: use calendar months so an exact anniversary is not lost to days/365.25.
            gratuityRule.ruleSet === "ccs_dcrg" ? calendarServiceYears(join, sep) : years,
            basicMinor, lastDaMinor, p.separationType, p.effectiveDate);
      // BUG FIX: this used to `return` here whenever gratuityMinor was 0
      // (< 5 years' qualifying service), which skipped the fnfCompute
      // publish below entirely -- a short-tenure separation got NO F&F
      // settlement at all, not even for leave encashment/notice pay it was
      // still owed regardless of gratuity eligibility. The statutory
      // gratuity ledger record below is still gratuity-only and is
      // correctly skipped when there is nothing to record.
      if (gratuityMinor > 0n) {
        await statutoryRepo.insertGratuity(tx, {
          id: randomUUID(),
          tenantId: msg.tenantId,
          employeeId: p.employeeId,
          separationRef: `separation:${p.effectiveDate}`,
          yearsOfService: years.toFixed(2),
          lastBasicMinor: basicMinor,
          gratuityMinor,
          currency: "INR",
          status: "computed",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "payroll", action: "gratuity_compute", resourceType: "gratuity", resourceId: p.employeeId, outcome: "success" },
        });
      }

      // BUG FIX (all-zero F&F settlement): this used to publish fnfCompute
      // with ONLY {employeeId, tenantId, separationDate, separationType:
      // "retirement" (hardcoded, ignoring the real separation type carried
      // on this same event)} -- every other FnfInput field fnf/consumer.ts
      // needs (gratuityGrossMinor, leaveEncashmentGrossMinor,
      // lastDrawnWagesMinor, completedYears, leaveBalanceDays,
      // employeeCategory, ...) was simply absent. fnf/consumer.ts builds
      // FnfInput straight off an `as`-cast of this payload with `?? "0"`/
      // `?? 0` fallbacks on every one of those fields, so every real
      // separation processed through this automatic path (as opposed to
      // the manual finance-admin form at POST /v1/payroll/fnf/compute,
      // which requires a human to type these in) silently persisted an
      // all-zero fnf_settlements row: gratuity, leave encashment and net
      // payable all 0 regardless of the employee's actual tenure or pay.
      //
      // completedYears reuses the exact 6-month-rounding rule computeGratuity
      // itself applies (completedYearsPgAct, exported from payroll/domain.ts)
      // so the tenure figure feeding the Sec 10(10)/10(10AA) exemption-
      // ceiling formulas (tax/exemptions.ts) can never drift from the tenure
      // gratuityMinor above was actually computed from.
      //
      // leaveEncashmentGrossMinor mirrors hrms-service's own EL-encashment
      // rule (pension/engine.ts's elEncashment: (Basic+DA)/30 * min(balance,
      // 300 days)) but is computed here off THIS service's own DA-rate
      // lookup (lastDaMinor above) instead of hrms-service's hardcoded
      // DEFAULT_DA_RATE_PCT, so gratuity and leave encashment for the same
      // separation are never priced off two different DA rates.
      // encashmentDays is the day-count hrms-service already includes on
      // this event (the caller-supplied number of days being encashed,
      // set on employee/consumer.ts's separateEmployee) -- previously read
      // by nothing on this side either.
      //
      // employeeCategory defaults to "non_govt_covered" when the event
      // doesn't carry one, mirroring hrms-service's own established default
      // for this same unresolved case (hrms-service's fnf-route.ts:
      // `employeeCategory: body.employeeCategory ?? "non_govt_covered"`).
      // taxRegime prefers the employee's own declared regime (now included
      // on the event -- see employee/consumer.ts) and otherwise falls back
      // to "new", matching hrms_employees.tax_regime's own column default.
      //
      // salaryYtdMinor/tdsYtdMinor/Chapter VI-A deductions are left at 0:
      // this automatic path has no FY payroll-run history to pull them
      // from, and the settlement is created in "draft" status specifically
      // so payroll/finance can review and true it up before disbursal --
      // this affects only the TDS-on-separation estimate, never the
      // gratuity/leave-encashment gross figures or their exemptions.
      const completedYears = completedYearsPgAct(years);
      const leaveBalanceDays = p.encashmentDays ?? 0;
      // PAY-PROFILES: no leave encashment from this tenant for a deputed-IN
      // employee (the parent organisation encashes on final separation).
      const leaveEncashmentGrossMinor = separationProfile.finalSalaryOnly || !separationProfile.leaveEncashmentEligible
        ? 0n
        : computeLeaveEncashmentGrossMinor(basicMinor, lastDaMinor, leaveBalanceDays);
      const lastDrawnWagesMinor = basicMinor + lastDaMinor;
      const fyStartYear = sep.getMonth() >= 3 ? sep.getFullYear() : sep.getFullYear() - 1;

      await enqueue(tx, {
        topic: COMMANDS.fnfCompute,
        eventType: COMMANDS.fnfCompute,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          employeeId: p.employeeId,
          tenantId: msg.tenantId,
          separationDate: p.effectiveDate,
          separationType: p.separationType ?? "retirement",
          employeeCategory: p.employeeCategory ?? "non_govt_covered",
          gratuityGrossMinor: gratuityMinor.toString(),
          leaveEncashmentGrossMinor: leaveEncashmentGrossMinor.toString(),
          lastDrawnWagesMinor: lastDrawnWagesMinor.toString(),
          completedYears,
          avgSalaryLast10MonthsMinor: lastDrawnWagesMinor.toString(),
          leaveBalanceDays,
          taxRegime: p.taxRegime ?? "new",
          salaryYtdMinor: "0",
          tdsYtdMinor: "0",
          fyStartYear,
          // PAY-PROFILES: terminal-benefit gates (fnf/domain.ts zeroes the
          // gross when false). Only sent when a profile says so, so the
          // payload is unchanged for every pre-PAY-PROFILES separation.
          ...(separationProfile.finalSalaryOnly || !separationProfile.eligibleForGratuity ? { eligibleForGratuity: false } : {}),
          ...(separationProfile.finalSalaryOnly || !separationProfile.leaveEncashmentEligible ? { leaveEncashmentEligible: false } : {}),
        },
      });
    });
  });

  queue.subscribe(CONSUMED_EVENTS.financePaymentMade, async (msg) => {
    const p = msg.payload as { payrollRunId?: string; outcome?: string };
    if (!p.payrollRunId || p.outcome !== "success") return;
    const { markSlipsPaidForRun } = await import("../payroll/repo.js");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await markSlipsPaidForRun(tx, p.payrollRunId!, msg.actorId);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.ltcClaimApproved, async (msg) => {
    const p = msg.payload as {
      claimId: string;
      employeeId: string;
      claimType: string;
      approvedFareMinor: string;
      entitlementMinor: string;
      blockYear: string;
      ltcType: "hometown" | "all_india";
      usedInBlock: number;
    };
    // Only process LTC claims
    if (p.claimType !== "ltc") return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const result = computeLtcExemption({
        approvedFareMinor: BigInt(p.approvedFareMinor),
        entitlementMinor: BigInt(p.entitlementMinor),
        ltcType: p.ltcType,
        blockYear: p.blockYear,
        usedInBlock: p.usedInBlock,
      });

      // Determine FY from current date
      const now = new Date();
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const fy = `${fyStartYear}-${(fyStartYear + 1) % 100}`;

      await tx.insert(ltcExemptions).values({
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        fy,
        claimId: p.claimId,
        blockYear: p.blockYear,
        ltcType: p.ltcType,
        approvedFareMinor: BigInt(p.approvedFareMinor),
        exemptAmountMinor: result.exemptMinor,
      });

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "payroll", action: "ltc_exemption_compute", resourceType: "ltc_exemption", resourceId: p.claimId, outcome: "success" },
      });
    });
  });
}
