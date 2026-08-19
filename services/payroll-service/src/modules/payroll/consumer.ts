import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { payrollPensioners } from "./schema.js";
import * as repo from "./repo.js";
import * as loansRepo from "../loans/repo.js";
import * as lopRepo from "../integration/lop-repo.js";
import * as statutoryRepo from "../statutory/repo.js";
import { sql } from "drizzle-orm";
import { computeSlip, computePension, assertRunStatusTransition, DomainError, hraSlabPct, roundRupee, isPayrollEligible, type PensionScheme, type CityClass, type RawComponent, type SlipResult } from "./domain.js";
import { annualTaxFromTaxableMinor, type Regime } from "../tax/engine.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

/** Resolve the DA rate (basis points) effective for the run month (Iter1). */
async function resolveDaRateBps(tenantId: string, month: string): Promise<bigint> {
  const rows = (await db.execute(sql`
    SELECT rate_bps FROM payroll.dearness_allowance_rates
    WHERE tenant_id = ${tenantId}::uuid AND effective_from <= ${month + "-01"}::date
    ORDER BY effective_from DESC LIMIT 1
  `)) as unknown as Array<{ rate_bps: number | string }>;
  const v = rows[0]?.rate_bps;
  return v != null ? BigInt(v) : 0n;
}

/** Active Professional Tax slabs for the tenant + state (H14 fix). */
async function resolvePtSlabs(tenantId: string, stateCode?: string): Promise<Array<{ from: bigint; to: bigint; amount: bigint }>> {
  // H14 FIX: filter by employee's state_code. Without this, a two-state tenant
  // (e.g. Karnataka + Maharashtra) would apply the same PT schedule to everyone.
  const rows = stateCode
    ? (await db.execute(sql`
        SELECT slab_from_minor, slab_to_minor, pt_amount_minor
        FROM payroll.payroll_professional_tax
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true AND state_code = ${stateCode}
        ORDER BY slab_from_minor
      `)) as unknown as Array<{ slab_from_minor: string | number; slab_to_minor: string | number; pt_amount_minor: string | number }>
    : (await db.execute(sql`
        SELECT slab_from_minor, slab_to_minor, pt_amount_minor
        FROM payroll.payroll_professional_tax
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true
        ORDER BY slab_from_minor
      `)) as unknown as Array<{ slab_from_minor: string | number; slab_to_minor: string | number; pt_amount_minor: string | number }>;
  return rows.map((r) => ({ from: BigInt(r.slab_from_minor), to: BigInt(r.slab_to_minor), amount: BigInt(r.pt_amount_minor) }));
}

function resolvePt(slabs: Array<{ from: bigint; to: bigint; amount: bigint }>, incomeMinor: bigint): bigint {
  const s = slabs.find((x) => incomeMinor >= x.from && incomeMinor <= x.to);
  return s ? s.amount : 0n;
}

/** Employee's submitted tax declaration for the FY (drives old-regime TDS exemptions). */
async function resolveDeclaration(tenantId: string, employeeId: string, fy: string): Promise<{
  regime: "old" | "new"; rentPaidAnnualMinor: bigint; ded80cMinor: bigint; ded80dMinor: bigint; otherDedMinor: bigint;
  prevEmployerSalaryMinor: bigint; prevEmployerTdsMinor: bigint; otherSourcesIncomeMinor: bigint; perquisitesMinor: bigint;
} | null> {
  const rows = (await db.execute(sql`
    SELECT regime, section_80c, section_80d, other_deductions,
           COALESCE(rent_paid_minor, 0) AS rent_paid_minor,
           COALESCE(prev_employer_salary_minor, 0) AS prev_employer_salary_minor,
           COALESCE(prev_employer_tds_minor, 0)    AS prev_employer_tds_minor,
           COALESCE(other_sources_income_minor, 0) AS other_sources_income_minor,
           COALESCE(perquisites_minor, 0)          AS perquisites_minor
    FROM payroll.payroll_tax_declarations
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy}
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ regime: string; section_80c: string | number; section_80d: string | number; other_deductions: string | number; rent_paid_minor: string | number; prev_employer_salary_minor: string | number; prev_employer_tds_minor: string | number; other_sources_income_minor: string | number; perquisites_minor: string | number }>;
  const d = rows[0];
  if (!d) return null;
  return {
    regime: d.regime === "old" ? "old" : "new",
    rentPaidAnnualMinor: BigInt(d.rent_paid_minor),
    ded80cMinor: BigInt(d.section_80c),
    ded80dMinor: BigInt(d.section_80d),
    otherDedMinor: BigInt(d.other_deductions),
    prevEmployerSalaryMinor: BigInt(d.prev_employer_salary_minor),
    prevEmployerTdsMinor: BigInt(d.prev_employer_tds_minor),
    otherSourcesIncomeMinor: BigInt(d.other_sources_income_minor),
    perquisitesMinor: BigInt(d.perquisites_minor),
  };
}

/**
 * TDS already deducted this FY before the given run month (for Sec 192 true-up).
 * M3: only count TDS whose source run is approved/disbursed. A draft/processing/
 * failed (or out-of-order/abandoned) run must not corrupt the YTD true-up.
 */
async function resolveTdsYtdMinor(tenantId: string, employeeId: string, fyStart: number, beforeMonth: string): Promise<bigint> {
  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(t.tds_minor), 0)::text AS ytd
    FROM statutory.payroll_tds t
    JOIN payroll.payroll_runs r ON r.id = t.run_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.employee_id = ${employeeId}::uuid
      AND t.period >= ${`${fyStart}-04`} AND t.period < ${beforeMonth}
      AND r.status IN ('approved', 'disbursed')
  `)) as unknown as Array<{ ytd: string | number }>;
  return BigInt(rows[0]?.ytd ?? 0);
}

/** P3: configurable protected-net floor (paise) for the tenant; 0 if unset. */
async function resolveProtectedNetFloorMinor(tenantId: string): Promise<bigint> {
  const rows = (await db.execute(sql`
    SELECT protected_net_floor_minor FROM payroll.payroll_settings
    WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ protected_net_floor_minor: string | number }>;
  const v = rows[0]?.protected_net_floor_minor;
  return v != null ? BigInt(v) : 0n;
}

/**
 * P2: latest salary revision effective on/before the run month, if any.
 * Drives the Basic the run pays (HRMS basic is the fallback when none exists).
 */
async function resolveLatestRevision(tenantId: string, employeeId: string, month: string): Promise<{ newBasicMinor: bigint; effectiveDate: string } | null> {
  const rows = (await db.execute(sql`
    SELECT new_basic_minor, effective_date::text AS effective_date
    FROM payroll.payroll_salary_revisions
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND effective_date <= ${month + "-01"}::date
    ORDER BY effective_date DESC, created_at DESC LIMIT 1
  `)) as unknown as Array<{ new_basic_minor: string | number; effective_date: string }>;
  const r = rows[0];
  if (!r) return null;
  return { newBasicMinor: BigInt(r.new_basic_minor), effectiveDate: r.effective_date };
}

/**
 * P2: for every salary revision whose effective_date precedes the run month,
 * generate month-by-month retro arrears for the (new basic - old basic) delta
 * plus recomputed DA/HRA, from the effective month up to (but excluding) the
 * run month. Idempotent: the unique partial index
 * ux_payroll_arrears_revision_period(tenant,employee,component,from_period)
 * WHERE source='revision' makes re-inserts a no-op.
 */
async function generateRetroArrears(
  tx: typeof db,
  tenantId: string,
  employeeId: string,
  runMonth: string,
  daRateBps: bigint,
  cityClass: CityClass,
  actorId: string,
): Promise<void> {
  const revs = (await tx.execute(sql`
    SELECT old_basic_minor, new_basic_minor, effective_date::text AS effective_date
    FROM payroll.payroll_salary_revisions
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND to_char(effective_date,'YYYY-MM') < ${runMonth}
    ORDER BY effective_date ASC
  `)) as unknown as Array<{ old_basic_minor: string | number; new_basic_minor: string | number; effective_date: string }>;
  const hraPct = hraSlabPct(cityClass, daRateBps);
  for (const r of revs) {
    const oldBasic = BigInt(r.old_basic_minor);
    const newBasic = BigInt(r.new_basic_minor);
    const effMonth = r.effective_date.slice(0, 7); // YYYY-MM
    // Per-month delta = delta basic + delta DA + delta HRA on the basic delta.
    const basicDelta = newBasic - oldBasic;
    if (basicDelta === 0n) continue;
    const daDelta  = roundRupee((basicDelta * daRateBps) / 10000n);
    const hraDelta = roundRupee((basicDelta * hraPct) / 100n);
    const perMonth = basicDelta + daDelta + hraDelta;
    // H1: a back-dated pay DECREASE (negative delta) is an overpayment that must
    // be RECOVERED, not paid as a negative earning. A negative EARNING bypasses
    // the protected-net floor (ARREAR is not a RECOVERY_CODE) and can silently
    // clamp net to 0. Route the absolute overpayment as an ARREAR_RECOVERY
    // *deduction* row (component_code='ARREAR_RECOVERY'), which IS floor-protected
    // and carry-forward-eligible in computeSlip. Positive deltas stay 'ARREAR'.
    const isRecovery = perMonth < 0n;
    const componentCode = isRecovery ? "ARREAR_RECOVERY" : "ARREAR";
    const storedDiff = isRecovery ? -perMonth : perMonth; // store positive magnitude
    const reason = isRecovery
      ? "salary revision overpayment recovery"
      : "salary revision retro arrears";
    // Iterate effMonth .. runMonth-1 inclusive.
    let [y, m] = effMonth.split("-").map(Number) as [number, number];
    const [ry, rm] = runMonth.split("-").map(Number) as [number, number];
    while (y < ry || (y === ry && m < rm)) {
      const period = `${y}-${String(m).padStart(2, "0")}`;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_arrears
          (tenant_id, employee_id, component_code, from_period, to_period,
           old_amount_minor, new_amount_minor, difference_minor, reason, status, source, created_by)
        VALUES
          (${tenantId}::uuid, ${employeeId}::uuid, ${componentCode}, ${period}, ${period},
           ${oldBasic.toString()}::bigint, ${newBasic.toString()}::bigint, ${storedDiff.toString()}::bigint,
           ${reason}, 'approved', 'revision', ${actorId}::uuid)
        ON CONFLICT (tenant_id, employee_id, component_code, from_period) WHERE source = 'revision'
        DO NOTHING
      `);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  }
}

/**
 * P1: pull this employee's recorded-but-unpaid earnings (arrears, bonus,
 * reimbursements) that are due in/by the run month, and return them as ad-hoc
 * EARNING components plus the source row ids to mark consumed after the slip is
 * persisted. Arrears: status in (pending,approved) up to run month; bonus:
 * approved; reimbursements: approved up to run month.
 */
async function collectAdHocEarnings(
  tx: typeof db,
  tenantId: string,
  employeeId: string,
  runMonth: string,
): Promise<{
  components: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint }>;
  arrearIds: string[]; bonusIds: string[]; reimbIds: string[];
}> {
  const components: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint }> = [];
  // C1: lock the candidate rows FOR UPDATE so a concurrent (regular vs
  // supplementary) run cannot also collect+pay the same unconsumed rows. The
  // lock is held to the end of the surrounding processPayrollRun transaction;
  // the second run blocks here and, once the first commits its consume markers,
  // re-reads with the marker-IS-NULL filter and sees nothing left to pay.
  const arrears = (await tx.execute(sql`
    SELECT id, component_code, difference_minor FROM payroll.payroll_arrears
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND status IN ('pending','approved') AND run_id IS NULL
      AND from_period <= ${runMonth}
    ORDER BY from_period
    FOR UPDATE
  `)) as unknown as Array<{ id: string; component_code: string; difference_minor: string | number }>;
  for (const a of arrears) {
    const amt = BigInt(a.difference_minor);
    if (amt === 0n) continue;
    // H1: ARREAR_RECOVERY rows are overpayment recoveries — emit them as a
    // floor-protected DEDUCTION (positive magnitude), not a negative earning.
    if (a.component_code === "ARREAR_RECOVERY") {
      components.push({ code: "ARREAR_RECOVERY", name: "Arrears Recovery", type: "deduction", amountMinor: amt });
    } else {
      components.push({ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: amt });
    }
  }
  const bonus = (await tx.execute(sql`
    SELECT id, bonus_amount_minor FROM payroll.payroll_bonus
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND status = 'approved' AND paid_in_run_id IS NULL
    FOR UPDATE
  `)) as unknown as Array<{ id: string; bonus_amount_minor: string | number }>;
  for (const b of bonus) {
    const amt = BigInt(b.bonus_amount_minor);
    if (amt !== 0n) components.push({ code: "BONUS", name: "Bonus", type: "earning", amountMinor: amt });
  }
  const reimb = (await tx.execute(sql`
    SELECT id, amount_minor FROM payroll.payroll_reimbursements
    WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
      AND status = 'approved' AND paid_in_run_id IS NULL
      AND period <= ${runMonth}
    FOR UPDATE
  `)) as unknown as Array<{ id: string; amount_minor: string | number }>;
  for (const r of reimb) {
    const amt = BigInt(r.amount_minor);
    if (amt !== 0n) components.push({ code: "REIMB", name: "Reimbursement", type: "earning", amountMinor: amt });
  }
  return {
    components,
    arrearIds: arrears.map((a) => a.id),
    bonusIds: bonus.map((b) => b.id),
    reimbIds: reimb.map((r) => r.id),
  };
}

const AUDIT = "audit.event.record";
const EFT_INITIATE = "finance.payment.eft.initiate";
// Sentinel structure id for runs that have no salary structure (pensioner runs).
const NIL_STRUCTURE_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Multi-DDO: the set of department ids that belong to a DDO for the tenant.
 * Returns null when no mapping exists (caller then pays the whole tenant — the
 * legacy whole-tenant run). When a ddoCode is given but unmapped, an empty set
 * is returned so the run pays nobody rather than silently paying everyone.
 */
async function resolveDdoDepartments(tenantId: string, ddoCode: string | null): Promise<Set<string> | null> {
  if (!ddoCode) return null;
  const rows = (await db.execute(sql`
    SELECT department_id FROM payroll.payroll_ddo_departments
    WHERE tenant_id = ${tenantId}::uuid AND ddo_code = ${ddoCode}
  `)) as unknown as Array<{ department_id: string }>;
  return new Set(rows.map((r) => r.department_id));
}

export function registerPayrollConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.structureCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; description?: string; isDefault: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertStructure(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        description: p.description ?? null, isDefault: p.isDefault, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "payroll_structure", p.id);
    });
  });

  // runCreate triggers processPayrollRun/processPensionRun which iterates every
  // employee; 300s prevents redelivery of a still-running large-tenant run.
  queue.subscribe(COMMANDS.runCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; runNo: string; month: string;
      departmentId?: string; structureId?: string; runType?: string; ddoCode?: string;
    };
    const runType: "regular" | "supplementary" | "arrears" | "pensioner" =
      p.runType === "supplementary" || p.runType === "arrears" || p.runType === "pensioner" ? p.runType : "regular";
    const ddoCode = p.ddoCode ?? null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P3 (Iter2): the dup-guard blocks only a second *regular* run per
      // tenant+month+DDO. Supplementary/arrears/pensioner (off-cycle) runs are
      // allowed alongside the regular run. The DB partial-unique index enforces
      // the same rule (COALESCE(ddo_code,'__ALL__')) as a belt-and-suspenders
      // guard — so two DDOs each get one regular run in the same month.
      if (runType === "regular") {
        const dup = (await tx.execute(sql`
          SELECT 1 FROM payroll.payroll_runs
          WHERE tenant_id = ${p.tenantId}::uuid AND month = ${p.month}
            AND status <> 'failed' AND run_type = 'regular'
            AND COALESCE(ddo_code, '__ALL__') = ${ddoCode ?? "__ALL__"}
          LIMIT 1
        `)) as unknown as Array<unknown>;
        if (dup.length > 0) {
          throw new DomainError("DUPLICATE_RUN_FOR_PERIOD", `a regular payroll run already exists for ${p.month}${ddoCode ? ` (DDO ${ddoCode})` : ""}`);
        }
      }
      await repo.insertRun(tx, {
        id: p.id, tenantId: p.tenantId, runNo: p.runNo, month: p.month,
        departmentId: p.departmentId ?? null, structureId: p.structureId ?? NIL_STRUCTURE_ID,
        runType, ddoCode,
        totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
    try {
      if (runType === "pensioner") {
        await processPensionRun(msg, { id: p.id, tenantId: p.tenantId, month: p.month, ddoCode });
      } else {
        await processPayrollRun(msg, { ...p, structureId: p.structureId ?? NIL_STRUCTURE_ID, runType, ddoCode });
      }
    } catch (err) {
      await db.transaction(async (tx) => {
        await repo.updateRun(tx, p.id, { status: "failed", updatedBy: msg.actorId });
      });
      throw err;
    }
  }, { visibilityTimeout: 300 });

  queue.subscribe(COMMANDS.runApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      // Iter2: maker-checker — the approver must differ from the run creator.
      if (run.createdBy === p.approvedBy) {
        throw new DomainError("SELF_APPROVAL_FORBIDDEN", "payroll run approver must differ from its creator");
      }
      assertRunStatusTransition(run.status, "approved");
      const slips = await repo.listSlipsByRun(p.id, p.tenantId);
      const totalGross = slips.reduce((s, sl) => s + sl.grossMinor, 0n);
      const totalNet = slips.reduce((s, sl) => s + sl.netPayMinor, 0n);
      const totalEmployerContrib = await statutoryRepo.sumEmployerContribByRun(p.id, p.tenantId);
      await repo.updateRun(tx, p.id, {
        status: "approved",
        totalGrossMinor: totalGross,
        totalNetMinor: totalNet,
        approvedBy: p.approvedBy,
        approvedAt: new Date(),
        updatedBy: msg.actorId,
      });
      // INT-FIX: only emit the finance GL accrual trigger when the run actually
      // accrued something. A run approved with zero slips (gross == 0) has no
      // salary to post; emitting it produced an all-zero journal that finance
      // correctly rejected and dead-lettered. The approval + notification below
      // still proceed; there is simply nothing to accrue to the GL.
      if (totalGross > 0n) {
        await enqueue(tx, {
          topic: EVENTS.runApproved, eventType: EVENTS.runApproved,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            runId: p.id,
            month: run.month,
            totalGrossMinor: totalGross.toString(),
            totalNetMinor: totalNet.toString(),
            totalEmployerContribMinor: totalEmployerContrib.toString(),
            ...(run.legalEntityId ? { legalEntityId: run.legalEntityId } : {}),
          },
        });
      }
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "payroll.run.approved",
          recipient: p.approvedBy,
          variables: { runId: p.id, month: run.month },
        }),
      });
      await audit(tx, msg, "approve", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });

  queue.subscribe(COMMANDS.runDisburse, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      assertRunStatusTransition(run.status, "disbursed");
      // Iter2: reconcile the disbursed amount against the authoritative slip sum,
      // never the denormalized counter (which the audit found could drift).
      const slips = await repo.listSlipsByRun(p.id, p.tenantId);
      const slipNet = slips
        .filter((s) => s.status !== "exception")
        .reduce((acc, s) => acc + s.netPayMinor, 0n);
      if (slipNet !== run.totalNetMinor) {
        throw new DomainError("DISBURSE_RECONCILIATION_FAILED", `run net ${run.totalNetMinor} != slip sum ${slipNet}`);
      }
      await repo.updateRun(tx, p.id, { status: "disbursed", disbursedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.runDisbursed, eventType: EVENTS.runDisbursed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { runId: p.id, month: run.month, totalNetMinor: slipNet.toString() },
      });
      await enqueue(tx, {
        topic: EFT_INITIATE, eventType: EFT_INITIATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          payrollRunId: p.id,
          amountMinor: slipNet.toString(),
          currency: run.currency,
          mode: "neft",
          pfmsTxnId: `PAYROLL-${p.id.slice(0, 8)}`,
        },
      });
      await audit(tx, msg, "disburse", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });

  queue.subscribe(COMMANDS.runRevert, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; revertedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdTx(tx, p.id);
      if (!run) throw new Error(`payroll run ${p.id} not found`);
      assertRunStatusTransition(run.status, "draft");
      await repo.updateRun(tx, p.id, { status: "draft", updatedBy: msg.actorId });
      await audit(tx, msg, "revert", "payroll_run", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_run", p.id));
  });

  // ─── CQRS lift (quality-payroll-95) ───────────────────────────────────────
  // routes.ts (ddos/pensioners) and world-class-routes.ts (arrears/bonus/
  // reimbursements) used to write synchronously in the request path. These
  // consumers now persist those writes, idempotently (markProcessed), and
  // fire the paired *ed event — mirrors works-service #354's masters/billing
  // CQRS lift.

  queue.subscribe(COMMANDS.ddoUpsert, async (msg) => {
    const p = msg.payload as { tenantId: string; ddoCode: string; name: string; departmentIds?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_ddos (tenant_id, ddo_code, name)
        VALUES (${p.tenantId}::uuid, ${p.ddoCode}, ${p.name})
        ON CONFLICT (tenant_id, ddo_code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      `);
      for (const deptId of p.departmentIds ?? []) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_ddo_departments (tenant_id, department_id, ddo_code)
          VALUES (${p.tenantId}::uuid, ${deptId}::uuid, ${p.ddoCode})
          ON CONFLICT (tenant_id, department_id) DO UPDATE SET ddo_code = EXCLUDED.ddo_code
        `);
      }
      await enqueue(tx, {
        topic: EVENTS.ddoUpserted, eventType: EVENTS.ddoUpserted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { ddoCode: p.ddoCode, name: p.name },
      });
      await audit(tx, msg, "upsert", "payroll_ddo", p.ddoCode);
    });
  });

  queue.subscribe(COMMANDS.pensionerCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ppoNo: string; fullName: string; dateOfBirth: string;
      basicPensionMinor: string; commutedPensionMinor?: string; commutationDate: string | null;
      medicalAllowanceMinor?: string; ddoCode: string | null;
      bankAccountNo: string | null; bankIfsc: string | null; pan: string | null; taxRegime: "old" | "new";
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // SEC-P1-06: insert via the Drizzle table so the encryptedText transform
      // on bank_account_no / bank_ifsc / pan applies — matches the guarantee
      // the previous synchronous handler in routes.ts made (never store this
      // PII in plaintext).
      await tx.insert(payrollPensioners).values({
        id: p.id,
        tenantId: p.tenantId,
        ppoNo: p.ppoNo,
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth,
        basicPensionMinor: BigInt(p.basicPensionMinor),
        commutedPensionMinor: BigInt(p.commutedPensionMinor ?? "0"),
        commutationDate: p.commutationDate ?? null,
        medicalAllowanceMinor: BigInt(p.medicalAllowanceMinor ?? "0"),
        ddoCode: p.ddoCode ?? null,
        bankAccountNo: p.bankAccountNo ?? null,
        bankIfsc: p.bankIfsc ?? null,
        pan: p.pan ?? null,
        taxRegime: p.taxRegime,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).onConflictDoNothing();
      await enqueue(tx, {
        topic: EVENTS.pensionerCreated, eventType: EVENTS.pensionerCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, ppoNo: p.ppoNo },
      });
      await audit(tx, msg, "create", "payroll_pensioner", p.id);
    });
  });

  queue.subscribe(COMMANDS.arrearCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; componentCode: string;
      fromPeriod: string; toPeriod: string; oldAmountMinor: number; newAmountMinor: number;
      reason?: string | null;
    };
    const diff = p.newAmountMinor - p.oldAmountMinor;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_arrears
          (id, tenant_id, employee_id, component_code, from_period, to_period,
           old_amount_minor, new_amount_minor, difference_minor, reason, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.employeeId}::uuid, ${p.componentCode},
          ${p.fromPeriod}, ${p.toPeriod}, ${p.oldAmountMinor}, ${p.newAmountMinor}, ${diff},
          ${p.reason ?? null}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.arrearCreated, eventType: EVENTS.arrearCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, differenceMinor: diff },
      });
      await audit(tx, msg, "create", "payroll_arrear", p.id);
    });
  });

  queue.subscribe(COMMANDS.bonusCompute, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; employeeId: string; fy: string; basicMinor: number; bonusPct: number };
    // bonusPct scaled to basis points to avoid IEEE 754 error (e.g. 8.33 -> 833n bps)
    const bonusPctBps = BigInt(Math.round(p.bonusPct * 100));
    const bonusAmountMinor = Number((BigInt(p.basicMinor) * bonusPctBps + 5000n) / 10000n);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_bonus (id, tenant_id, employee_id, fy, basic_minor, bonus_pct, bonus_amount_minor)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.employeeId}::uuid, ${p.fy}, ${p.basicMinor}, ${p.bonusPct}, ${bonusAmountMinor})
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.bonusComputed, eventType: EVENTS.bonusComputed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, bonusAmountMinor },
      });
      await audit(tx, msg, "compute", "payroll_bonus", p.id);
    });
  });

  queue.subscribe(COMMANDS.reimbursementCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; category: string; amountMinor: number;
      billDate?: string | null; billRef?: string | null; period: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_reimbursements
          (id, tenant_id, employee_id, category, amount_minor, bill_date, bill_ref, period, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.employeeId}::uuid, ${p.category}, ${p.amountMinor},
          ${p.billDate ?? null}::date, ${p.billRef ?? null}, ${p.period}, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.reimbursementCreated, eventType: EVENTS.reimbursementCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, amountMinor: p.amountMinor },
      });
      await audit(tx, msg, "create", "payroll_reimbursement", p.id);
    });
  });

  // ─── CQRS lift T1-03 (payroll/gap-routes.ts) ─────────────────────────────
  // Idempotent consumers for the 8 gap-routes.ts mutations that were doing
  // db.execute() INSERT/UPDATE in the HTTP handler. Each opens a tx, calls
  // markProcessed (idempotency key = messageId), applies the write, and
  // enqueues the paired *ed event to the outbox.

  queue.subscribe(COMMANDS.correctionCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; component: string;
      effectiveFrom: string; oldValueMinor: number; newValueMinor: number;
      arrearsMinor: string; affectedPeriods: number; reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.salary_corrections
          (id, tenant_id, employee_id, component, effective_from, old_value_minor,
           new_value_minor, arrears_minor, affected_periods, reason, status, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.employeeId}::uuid,
          ${p.component}, ${p.effectiveFrom}::date,
          ${p.oldValueMinor.toString()}::bigint, ${p.newValueMinor.toString()}::bigint,
          ${p.arrearsMinor}::bigint, ${p.affectedPeriods},
          ${p.reason ?? null}, 'pending', ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.correctionCreated, eventType: EVENTS.correctionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, arrearsMinor: p.arrearsMinor },
      });
      await audit(tx, msg, "create", "payroll_correction", p.id);
    });
  });

  queue.subscribe(COMMANDS.payGroupCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string;
      frequency: string; payDayOfMonth: number; timezone: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.pay_groups
          (id, tenant_id, name, frequency, pay_day_of_month, timezone, created_by, updated_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.name}, ${p.frequency},
          ${p.payDayOfMonth}, ${p.timezone}, ${msg.actorId}::uuid, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.payGroupCreated, eventType: EVENTS.payGroupCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, name: p.name, frequency: p.frequency },
      });
      await audit(tx, msg, "create", "payroll_pay_group", p.id);
    });
  });

  queue.subscribe(COMMANDS.flexPlanCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; fy: string;
      totalBudgetMinor: number;
      components: Array<{ name: string; maxMinor: number; taxExempt: boolean }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.flex_benefit_plans
          (id, tenant_id, name, fy, total_budget_minor, components, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.name}, ${p.fy},
          ${p.totalBudgetMinor.toString()}::bigint, ${JSON.stringify(p.components)}::jsonb,
          ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      await enqueue(tx, {
        topic: EVENTS.flexPlanCreated, eventType: EVENTS.flexPlanCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, name: p.name, fy: p.fy },
      });
      await audit(tx, msg, "create", "payroll_flex_plan", p.id);
    });
  });

  queue.subscribe(COMMANDS.flexElectionUpsert, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; planId: string; fy: string;
      elections: Array<{ component: string; electedMinor: number }>;
      totalElectedMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.flex_benefit_elections
          (id, tenant_id, employee_id, plan_id, fy, elections, total_elected_minor, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${msg.actorId}::uuid, ${p.planId}::uuid,
          ${p.fy}, ${JSON.stringify(p.elections)}::jsonb,
          ${p.totalElectedMinor.toString()}::bigint, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, employee_id, plan_id, fy)
        DO UPDATE SET elections = EXCLUDED.elections,
          total_elected_minor = EXCLUDED.total_elected_minor
      `);
      await enqueue(tx, {
        topic: EVENTS.flexElectionUpserted, eventType: EVENTS.flexElectionUpserted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, planId: p.planId, fy: p.fy },
      });
      await audit(tx, msg, "upsert", "payroll_flex_election", p.id);
    });
  });

  queue.subscribe(COMMANDS.costingRuleUpsert, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeGroup: string;
      costCenterId: string; splitPct: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.costing_rules
          (id, tenant_id, employee_group, cost_center_id, split_pct, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.employeeGroup},
          ${p.costCenterId}::uuid, ${p.splitPct}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, employee_group, cost_center_id)
        DO UPDATE SET split_pct = EXCLUDED.split_pct
      `);
      await enqueue(tx, {
        topic: EVENTS.costingRuleUpserted, eventType: EVENTS.costingRuleUpserted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, employeeGroup: p.employeeGroup, costCenterId: p.costCenterId },
      });
      await audit(tx, msg, "upsert", "payroll_costing_rule", p.id);
    });
  });

  queue.subscribe(COMMANDS.offCycleCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; runType: "bonus" | "incentive" | "adhoc";
      period: string; description?: string; totalAmountMinor: string;
      items: Array<{ employeeId: string; amountMinor: number }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.off_cycle_runs
          (id, tenant_id, run_type, period, description, total_amount_minor, created_by)
        VALUES (${p.id}::uuid, ${p.tenantId}::uuid, ${p.runType}, ${p.period},
          ${p.description ?? null}, ${p.totalAmountMinor}::bigint, ${msg.actorId}::uuid)
        ON CONFLICT (id) DO NOTHING
      `);
      for (const item of p.items) {
        await tx.execute(sql`
          INSERT INTO payroll.off_cycle_items
            (tenant_id, off_cycle_run_id, employee_id, amount_minor)
          VALUES (${p.tenantId}::uuid, ${p.id}::uuid, ${item.employeeId}::uuid,
            ${item.amountMinor.toString()}::bigint)
        `);
      }
      await enqueue(tx, {
        topic: EVENTS.offCycleCreated, eventType: EVENTS.offCycleCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, runType: p.runType, period: p.period, itemCount: p.items.length },
      });
      await audit(tx, msg, "create", "payroll_off_cycle_run", p.id);
    });
  });

  // Off-cycle process: consumer is the single source of truth for the 30% flat-tax split.
  queue.subscribe(COMMANDS.offCycleProcess, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const items = (await tx.execute(sql`
        SELECT id, employee_id, amount_minor FROM payroll.off_cycle_items
        WHERE off_cycle_run_id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
      `)) as unknown as Array<{ id: string; employee_id: string; amount_minor: string }>;
      let totalTax = 0n; let totalNet = 0n;
      for (const item of items) {
        const amt = BigInt(item.amount_minor);
        const tax = (amt * 30n) / 100n;
        const net = amt - tax;
        totalTax += tax; totalNet += net;
        await tx.execute(sql`
          UPDATE payroll.off_cycle_items
             SET tax_minor = ${tax.toString()}::bigint,
                 net_minor = ${net.toString()}::bigint,
                 status = 'processed'
           WHERE id = ${item.id}::uuid AND tenant_id = ${p.tenantId}::uuid
        `);
      }
      await tx.execute(sql`
        UPDATE payroll.off_cycle_runs
           SET total_tax_minor = ${totalTax.toString()}::bigint,
               total_net_minor = ${totalNet.toString()}::bigint,
               status = 'processed',
               updated_at = NOW()
         WHERE id = ${p.id}::uuid AND tenant_id = ${p.tenantId}::uuid
      `);
      await enqueue(tx, {
        topic: EVENTS.offCycleProcessed, eventType: EVENTS.offCycleProcessed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, totalTaxMinor: totalTax.toString(), totalNetMinor: totalNet.toString() },
      });
      await audit(tx, msg, "process", "payroll_off_cycle_run", p.id);
    });
  });

  queue.subscribe(COMMANDS.stateRulesUpsert, async (msg) => {
    const p = msg.payload as {
      tenantId: string; stateCode: string;
      ptSlabs?: Array<{ fromMinor: number; toMinor: number; taxMinor: number }>;
      lwfEmployee?: number; lwfEmployer?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const slab of p.ptSlabs ?? []) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_professional_tax
            (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor)
          VALUES (${p.tenantId}::uuid, ${p.stateCode},
            ${slab.fromMinor.toString()}::bigint, ${slab.toMinor.toString()}::bigint,
            ${slab.taxMinor.toString()}::bigint)
          ON CONFLICT (tenant_id, state_code, slab_from_minor)
          DO UPDATE SET slab_to_minor = EXCLUDED.slab_to_minor,
            pt_amount_minor = EXCLUDED.pt_amount_minor
        `);
      }
      if (p.lwfEmployee != null || p.lwfEmployer != null) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_lwf
            (tenant_id, state_code, employee_contrib_minor, employer_contrib_minor)
          VALUES (${p.tenantId}::uuid, ${p.stateCode},
            ${(p.lwfEmployee ?? 0).toString()}::bigint,
            ${(p.lwfEmployer ?? 0).toString()}::bigint)
          ON CONFLICT (tenant_id, state_code)
          DO UPDATE SET employee_contrib_minor = EXCLUDED.employee_contrib_minor,
            employer_contrib_minor = EXCLUDED.employer_contrib_minor
        `);
      }
      await enqueue(tx, {
        topic: EVENTS.stateRulesUpserted, eventType: EVENTS.stateRulesUpserted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { stateCode: p.stateCode, ptSlabCount: p.ptSlabs?.length ?? 0 },
      });
      await audit(tx, msg, "upsert", "payroll_state_rules", p.stateCode);
    });
  });
}

async function processPayrollRun(
  msg: { tenantId: string; actorId: string; correlationId: string },
  p: { id: string; tenantId: string; month: string; structureId: string; departmentId?: string; runType?: "regular" | "supplementary" | "arrears"; ddoCode?: string | null },
): Promise<void> {
  const input = await fetchPayrollInput(p.tenantId, p.month);
  const structComps = await repo.listComponentsByStructure(p.structureId, p.tenantId);
  // Multi-DDO: the departments this DDO pays (null => whole tenant, legacy).
  const ddoDepartments = await resolveDdoDepartments(p.tenantId, p.ddoCode ?? null);
  const daRateBps = await resolveDaRateBps(p.tenantId, p.month);
  // H14 FIX: PT slabs are now resolved per-employee (by state_code) inside the loop.
  // A tenant-level fallback is kept for employees without a state_code.
  const ptSlabsFallback = await resolvePtSlabs(p.tenantId);
  const protectedNetFloorMinor = await resolveProtectedNetFloorMinor(p.tenantId);
  // Days in the run month (LOP divisor) — 7th CPC uses actual days, not flat 30.
  const daysInMonth = BigInt(new Date(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), 0).getDate());
  let totalGross = 0n;
  let totalNet = 0n;

  const rawComponents: RawComponent[] = structComps.map((c) => ({
    code: c.code,
    name: c.name,
    type: c.componentType as "earning" | "deduction",
    fixedMinor: c.fixedMinor ?? null,
    pctOfBasic: c.pctOfBasic != null ? Number(c.pctOfBasic) : null,
  }));

  // M1 (idempotency/resume): a run can wedge in `processing` if slip computation
  // was interrupted (e.g. process crash after markProcessed committed). On
  // re-processing we skip employees that already have a slip for this run, so we
  // never duplicate slips/statutory rows and we resume a partially-computed run.
  // The DB also enforces UNIQUE(tenant_id, run_id, employee_id) on slips as a
  // belt-and-suspenders guard.
  const existingSlips = await repo.listSlipsByRun(p.id, p.tenantId);
  const alreadyComputed = new Set(existingSlips.map((s) => s.employeeId));

  await db.transaction(async (tx) => {
    for (const emp of input.employees) {
      if (p.departmentId && emp.departmentId !== p.departmentId) continue;
      // Multi-DDO: only pay employees whose department belongs to this run's DDO.
      if (ddoDepartments && !ddoDepartments.has(emp.departmentId)) continue;
      if (alreadyComputed.has(emp.id)) continue; // M1: skip already-computed employees
      // DIC engagement gate: consultants (invoice/194J), third-party (agency/194C)
      // and apprentices (stipend) are NOT paid through the salary run — their pay
      // is handled by their own flows. Skip like the department/DDO filters above.
      if (!isPayrollEligible(emp as { paymentRoute?: string; eligibleForPayroll?: boolean })) continue;

      const cityClass = emp.cityClass ?? "X";
      // P2: generate retro-arrears for any back-dated salary revision BEFORE
      // collecting earnings, so this run pays them. Only the regular run
      // generates them (idempotent index makes re-runs a no-op anyway).
      if ((p.runType ?? "regular") === "regular") {
        await generateRetroArrears(tx as unknown as typeof db, p.tenantId, emp.id, p.month, daRateBps, cityClass, msg.actorId);
      }

      // P2: source current Basic from the latest revision effective on/before the
      // run month; fall back to the HRMS-provided basic when no revision exists.
      const revision = await resolveLatestRevision(p.tenantId, emp.id, p.month);
      const basicMinor = revision ? revision.newBasicMinor : BigInt(emp.basicMinor);
      const daMinor = (basicMinor * daRateBps) / 10000n;
      // M2 (LOP double-count): one authoritative source per (employee, month).
      // The local LOP ledger (fed by leave/attendance events) takes precedence
      // when any ledger row exists for the month; otherwise we fall back to the
      // HRMS payroll-input feed. We never add the two together — that deducted
      // the same LOP twice.
      const ledgerLop = await lopRepo.getLopForMonth(p.tenantId, emp.id, p.month);
      const lopDays = ledgerLop.hasLedger ? ledgerLop.days : (input.lopDays[emp.id] ?? 0);
      // LOP daily rate on (Basic + DA) over actual days in month.
      const dailyRate = (basicMinor + daMinor) / daysInMonth;
      const lopDeduction = dailyRate * BigInt(lopDays);

      // Iter2: real loan recovery — split interest/principal, cap at outstanding.
      // P3: the actual EMI withheld may be capped by the protected-net floor, so
      // we only COMPUTE candidate installments here and defer the ledger writes
      // until AFTER computeSlip tells us how much recovery was actually applied.
      // The carried-forward (unrecovered) portion must NOT reduce the loan
      // outstanding — it is recovered in a future run.
      const loans = await loansRepo.findLoansByEmployee(p.tenantId, emp.id);
      const loanPlans: Array<{ loanId: string; principal: bigint; interest: bigint; outstanding: bigint }> = [];
      let emiTotal = 0n;
      for (const l of loans) {
        if (l.status !== "disbursed" || l.outstandingMinor <= 0n) continue;
        const monthlyRateBps = BigInt(Math.round(Number(l.interestRatePct ?? 0) * 100)); // pct -> bps
        const interest = (l.outstandingMinor * monthlyRateBps) / 120000n; // /100/12 in bps
        let principal = l.emiMinor - interest;
        if (principal < 0n) principal = 0n;
        if (principal > l.outstandingMinor) principal = l.outstandingMinor;
        const deduction = principal + interest;
        if (deduction <= 0n) continue;
        emiTotal += deduction;
        loanPlans.push({ loanId: l.id, principal, interest, outstanding: l.outstandingMinor });
      }

      const adHoc: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint }> = [];
      if (lopDeduction > 0n) adHoc.push({ code: "LOP", name: "Loss of Pay", type: "deduction" as const, amountMinor: lopDeduction });
      if (emiTotal > 0n) adHoc.push({ code: "LOAN_EMI", name: "Loan EMI", type: "deduction" as const, amountMinor: emiTotal });

      // P1: disburse recorded-but-dead earnings — pending/approved arrears,
      // approved bonus, approved reimbursements due by this month — as ad-hoc
      // EARNING components. Source rows are marked consumed after the slip is
      // persisted so they pay exactly once.
      const earned = await collectAdHocEarnings(tx as unknown as typeof db, p.tenantId, emp.id, p.month);
      for (const c of earned.components) adHoc.push(c);

      const fyStart = Number(p.month.slice(5, 7)) >= 4 ? Number(p.month.slice(0, 4)) : Number(p.month.slice(0, 4)) - 1;
      const fyStr = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
      const decl = await resolveDeclaration(p.tenantId, emp.id, fyStr);
      const monthIdxInFy = (Number(p.month.slice(5, 7)) - 4 + 12) % 12; // Apr=0..Mar=11
      // Sec 192 true-up: prev-employer TDS counts toward tax already deducted this FY.
      const tdsYtdMinor = (await resolveTdsYtdMinor(p.tenantId, emp.id, fyStart, p.month))
        + (decl?.prevEmployerTdsMinor ?? 0n);

      // Engagement statutory gates carried on the run input (default: on).
      const eng = emp as { statutoryPf?: boolean; statutoryEsi?: boolean; statutoryNps?: boolean };
      const result = await computeAndInsertSlip(tx, msg, {
        runId: p.id,
        tenantId: p.tenantId,
        employeeId: emp.id,
        employeeNo: emp.employeeNo,
        basicMinor,
        month: p.month,
        pensionScheme: emp.pensionScheme ?? "NPS",
        ...(eng.statutoryPf != null ? { statutoryPf: eng.statutoryPf } : {}),
        ...(eng.statutoryEsi != null ? { statutoryEsi: eng.statutoryEsi } : {}),
        ...(eng.statutoryNps != null ? { statutoryNps: eng.statutoryNps } : {}),
        daRateBps,
        cityClass,
        ptMinor: resolvePt(
          // H14 FIX: use employee's state_code for PT schedule lookup.
          // Falls back to tenant-level slabs when employee has no state.
          (emp as { stateCode?: string }).stateCode
            ? await resolvePtSlabs(p.tenantId, (emp as { stateCode?: string }).stateCode)
            : ptSlabsFallback,
          basicMinor + daMinor,
        ),
        taxRegime: decl?.regime ?? emp.taxRegime ?? "new",
        fyStartYear: fyStart,
        tdsYtdMinor,
        monthsRemaining: 12 - monthIdxInFy,
        protectedNetFloorMinor,
        ...(decl ? { declaration: { rentPaidAnnualMinor: decl.rentPaidAnnualMinor, ded80cMinor: decl.ded80cMinor, ded80dMinor: decl.ded80dMinor, otherDedMinor: decl.otherDedMinor, prevEmployerSalaryMinor: decl.prevEmployerSalaryMinor, otherSourcesIncomeMinor: decl.otherSourcesIncomeMinor, perquisitesMinor: decl.perquisitesMinor } } : {}),
        rawComponents,
        components: adHoc,
      });

      // P3: record loan repayments for the EMI that was ACTUALLY withheld after
      // the protected-net floor (computeSlip may have trimmed/dropped the EMI
      // line). The unrecovered remainder stays on the loan outstanding and is
      // carried forward to a future run.
      const appliedEmi = result.deductions.find((d) => d.code === "LOAN_EMI")?.amountMinor ?? 0n;
      let emiToAllocate = appliedEmi;
      for (const plan of loanPlans) {
        if (emiToAllocate <= 0n) break;
        const planTotal = plan.principal + plan.interest;
        const take = planTotal <= emiToAllocate ? planTotal : emiToAllocate;
        emiToAllocate -= take;
        // Interest is recovered first within an installment; the rest is principal.
        const interestPaid  = take <= plan.interest ? take : plan.interest;
        const principalPaid = take - interestPaid;
        if (take <= 0n) continue;
        const newOutstanding = plan.outstanding - principalPaid;
        const installmentNo = (await loansRepo.countRepayments(tx, plan.loanId)) + 1;
        await loansRepo.insertRepayment(tx, {
          id: randomUUID(), tenantId: p.tenantId, loanId: plan.loanId, runId: p.id,
          installmentNo, principalMinor: principalPaid, interestMinor: interestPaid, totalMinor: take,
          currency: "INR", status: "paid", paidAt: new Date(),
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await loansRepo.updateLoan(tx, plan.loanId, {
          outstandingMinor: newOutstanding,
          status: newOutstanding <= 0n ? "closed" : "disbursed",
          updatedBy: msg.actorId,
        });
      }

      // C2: mark the consumed source rows so a concurrent/second run does NOT pay
      // them again. Every UPDATE is conditional on the marker still being NULL and
      // scoped to the tenant, and we VERIFY the affected rowcount equals the number
      // of rows we collected. If a row was already consumed by a concurrent run
      // (rowcount short), we abort the whole transaction so this run pays nothing
      // it could not exclusively claim — the bonus/arrear/reimb is paid in exactly
      // one slip. (The FOR UPDATE lock in collectAdHocEarnings normally serialises
      // the runs; this rowcount check is the belt-and-suspenders guarantee.)
      if (earned.arrearIds.length > 0) {
        const updated = (await tx.execute(sql`
          UPDATE payroll.payroll_arrears SET status = 'paid', run_id = ${p.id}::uuid
          WHERE id = ANY(${sql`ARRAY[${sql.join(earned.arrearIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
            AND run_id IS NULL AND tenant_id = ${p.tenantId}::uuid
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length !== earned.arrearIds.length) {
          throw new DomainError("ARREAR_ALREADY_CONSUMED", `arrears double-pay race: expected ${earned.arrearIds.length} unconsumed rows, claimed ${updated.length}`);
        }
      }
      if (earned.bonusIds.length > 0) {
        const updated = (await tx.execute(sql`
          UPDATE payroll.payroll_bonus SET status = 'paid', paid_in_run_id = ${p.id}::uuid
          WHERE id = ANY(${sql`ARRAY[${sql.join(earned.bonusIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
            AND paid_in_run_id IS NULL AND tenant_id = ${p.tenantId}::uuid
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length !== earned.bonusIds.length) {
          throw new DomainError("BONUS_ALREADY_CONSUMED", `bonus double-pay race: expected ${earned.bonusIds.length} unconsumed rows, claimed ${updated.length}`);
        }
      }
      if (earned.reimbIds.length > 0) {
        const updated = (await tx.execute(sql`
          UPDATE payroll.payroll_reimbursements SET status = 'paid', paid_in_run_id = ${p.id}::uuid
          WHERE id = ANY(${sql`ARRAY[${sql.join(earned.reimbIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
            AND paid_in_run_id IS NULL AND tenant_id = ${p.tenantId}::uuid
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length !== earned.reimbIds.length) {
          throw new DomainError("REIMB_ALREADY_CONSUMED", `reimbursement double-pay race: expected ${earned.reimbIds.length} unconsumed rows, claimed ${updated.length}`);
        }
      }

      // Single source of truth: totals come from the same computed result.
      totalGross += result.grossMinor;
      totalNet += result.netPayMinor;
    }

    // M1: totals must reflect ALL slips of the run (newly computed + any from a
    // prior partial pass), not just this pass's accumulator. Read back the
    // authoritative slip set inside the same transaction.
    void totalGross; void totalNet;
    const allSlips = await repo.listSlipsByRunTx(tx, p.id, p.tenantId);
    const runGross = allSlips.reduce((s, sl) => s + sl.grossMinor, 0n);
    const runNet = allSlips.reduce((s, sl) => s + sl.netPayMinor, 0n);

    await repo.updateRun(tx, p.id, {
      totalGrossMinor: runGross,
      totalNetMinor: runNet,
      status: "processing",
      updatedBy: msg.actorId,
    });
  });
}

/**
 * Pensioner payroll run: a distinct run type from salary. Computes monthly
 * pension (basic pension, DR on pension, additional pension by age band,
 * commutation restoration, medical allowance) for every active pensioner of the
 * DDO (or whole tenant when unscoped), persists a slip + statutory TDS per
 * pensioner, and rolls up run totals. GL posting (run.approved event) and the
 * bank-file are produced by the shared run lifecycle, so they are per-DDO too.
 */
async function processPensionRun(
  msg: { tenantId: string; actorId: string; correlationId: string },
  p: { id: string; tenantId: string; month: string; ddoCode: string | null },
): Promise<void> {
  const drRateBps = await resolveDaRateBps(p.tenantId, p.month); // DR shares the DA series
  const fyStart = Number(p.month.slice(5, 7)) >= 4 ? Number(p.month.slice(0, 4)) : Number(p.month.slice(0, 4)) - 1;

  const pensioners = (await db.execute(sql`
    SELECT id, ppo_no, full_name, date_of_birth::text AS date_of_birth,
           basic_pension_minor, commuted_pension_minor, commutation_date::text AS commutation_date,
           medical_allowance_minor, tax_regime
    FROM payroll.payroll_pensioners
    WHERE tenant_id = ${p.tenantId}::uuid AND status = 'active'
      AND (${p.ddoCode}::varchar IS NULL OR ddo_code = ${p.ddoCode})
    ORDER BY ppo_no
  `)) as unknown as Array<{
    id: string; ppo_no: string; full_name: string; date_of_birth: string;
    basic_pension_minor: string | number; commuted_pension_minor: string | number;
    commutation_date: string | null; medical_allowance_minor: string | number; tax_regime: string;
  }>;

  // M1: resume — skip pensioners already having a slip for this run.
  const existingSlips = await repo.listSlipsByRun(p.id, p.tenantId);
  const alreadyComputed = new Set(existingSlips.map((s) => s.employeeId));

  await db.transaction(async (tx) => {
    for (const pen of pensioners) {
      if (alreadyComputed.has(pen.id)) continue;
      const regime: Regime = pen.tax_regime === "old" ? "old" : "new";
      // Pension is taxable as salary. Estimate annual taxable = annual gross
      // (basic + additional + DR + medical) less the std deduction baked into
      // the tax config, then spread evenly across the year. The commuted
      // portion withheld for restoration is NOT income, so tax is on full gross.
      const preview = computePension({
        basicPensionMinor: BigInt(pen.basic_pension_minor),
        drRateBps,
        commutedPensionMinor: BigInt(pen.commuted_pension_minor),
        commutationDate: pen.commutation_date,
        medicalAllowanceMinor: BigInt(pen.medical_allowance_minor),
        dateOfBirth: pen.date_of_birth,
        month: p.month,
      });
      const annualGross = preview.grossMinor * 12n;
      const stdDed = regime === "old" ? 5_000_000n : 7_500_000n; // Sec 16 std deduction (paise)
      let annualTaxable = annualGross - stdDed;
      if (annualTaxable < 0n) annualTaxable = 0n;
      const annualTax = annualTaxFromTaxableMinor(annualTaxable, regime, fyStart);
      const tdsMinor = (annualTax / 100n / 12n) * 100n; // even monthly spread, rupee-rounded

      const result = computePension({
        basicPensionMinor: BigInt(pen.basic_pension_minor),
        drRateBps,
        commutedPensionMinor: BigInt(pen.commuted_pension_minor),
        commutationDate: pen.commutation_date,
        medicalAllowanceMinor: BigInt(pen.medical_allowance_minor),
        dateOfBirth: pen.date_of_birth,
        month: p.month,
        tdsMinor,
      });

      const slipId = randomUUID();
      const allComps = [...result.earnings, ...result.deductions];
      await repo.insertSlip(tx, {
        id: slipId, tenantId: p.tenantId, runId: p.id,
        employeeId: pen.id, employeeNo: pen.ppo_no,
        basicMinor: result.basicPensionMinor, grossMinor: result.grossMinor,
        totalDeductionsMinor: result.totalDeductionsMinor, netPayMinor: result.netPayMinor,
        components: allComps.map((c) => ({ code: c.code, name: c.name, type: c.type, amountMinor: Number(c.amountMinor) })),
        tdsMinor: result.tdsMinor,
        status: result.netPayMinor < 0n ? "exception" : "computed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (result.tdsMinor > 0n) {
        await statutoryRepo.insertTds(tx, {
          id: randomUUID(), tenantId: p.tenantId, slipId, employeeId: pen.id,
          runId: p.id, annualBasicMinor: result.basicPensionMinor * 12n,
          taxableMinor: annualTaxable,
          tdsMinor: result.tdsMinor, currency: "INR", period: p.month,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
    }

    const allSlips = await repo.listSlipsByRunTx(tx, p.id, p.tenantId);
    const runGross = allSlips.reduce((s, sl) => s + sl.grossMinor, 0n);
    const runNet = allSlips.reduce((s, sl) => s + sl.netPayMinor, 0n);
    await repo.updateRun(tx, p.id, {
      totalGrossMinor: runGross, totalNetMinor: runNet,
      status: "processing", updatedBy: msg.actorId,
    });
  });
}

export async function computeAndInsertSlip(
  tx: Parameters<typeof repo.insertSlip>[0],
  msg: { actorId: string },
  params: {
    runId: string; tenantId: string; employeeId: string; employeeNo: string;
    basicMinor: bigint; month: string; pensionScheme?: PensionScheme;
    statutoryPf?: boolean; statutoryEsi?: boolean; statutoryNps?: boolean;
    daRateBps?: bigint; cityClass?: CityClass; ptMinor?: bigint;
    taxRegime?: "old" | "new"; fyStartYear?: number;
    tdsYtdMinor?: bigint; monthsRemaining?: number; protectedNetFloorMinor?: bigint;
    declaration?: { rentPaidAnnualMinor?: bigint; ded80cMinor?: bigint; ded80dMinor?: bigint; otherDedMinor?: bigint; prevEmployerSalaryMinor?: bigint; otherSourcesIncomeMinor?: bigint; perquisitesMinor?: bigint };
    rawComponents?: RawComponent[];
    components?: Array<{ code: string; name: string; type: "earning" | "deduction"; amountMinor: bigint }>;
  },
): Promise<SlipResult> {
  const result = computeSlip({
    basicMinor: params.basicMinor,
    daRateBps: params.daRateBps ?? 0n,
    cityClass: params.cityClass ?? "X",
    ptMinor: params.ptMinor ?? 0n,
    taxRegime: params.taxRegime ?? "new",
    fyStartYear: params.fyStartYear ?? 2025,
    ...(params.tdsYtdMinor != null ? { tdsYtdMinor: params.tdsYtdMinor } : {}),
    ...(params.monthsRemaining != null ? { monthsRemaining: params.monthsRemaining } : {}),
    ...(params.protectedNetFloorMinor != null ? { protectedNetFloorMinor: params.protectedNetFloorMinor } : {}),
    ...(params.declaration ? { declaration: params.declaration } : {}),
    rawComponents: params.rawComponents ?? [],
    components: params.components ?? [],
    pensionScheme: params.pensionScheme ?? "NPS",
    ...(params.statutoryPf != null ? { statutoryPf: params.statutoryPf } : {}),
    ...(params.statutoryEsi != null ? { statutoryEsi: params.statutoryEsi } : {}),
    ...(params.statutoryNps != null ? { statutoryNps: params.statutoryNps } : {}),
  });
  const slipId = randomUUID();
  const allComps = [...result.earnings, ...result.deductions];
  await repo.insertSlip(tx, {
    id: slipId, tenantId: params.tenantId, runId: params.runId,
    employeeId: params.employeeId, employeeNo: params.employeeNo,
    basicMinor: params.basicMinor, grossMinor: result.grossMinor,
    totalDeductionsMinor: result.totalDeductionsMinor, netPayMinor: result.netPayMinor,
    components: allComps.map((c) => ({ code: c.code, name: c.name, type: c.type, amountMinor: Number(c.amountMinor) })),
    pfEmployeeMinor: result.pfEmployeeMinor, pfEmployerMinor: result.pfEmployerMinor,
    gpfMinor: result.gpfMinor, npsEmployeeMinor: result.npsEmployeeMinor, npsEmployerMinor: result.npsEmployerMinor,
    esiMinor: result.esiMinor, tdsMinor: result.tdsMinor,
    status: result.negativeNet ? "exception" : "computed",
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  if (result.gpfMinor > 0n) {
    await statutoryRepo.insertGpf(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      contribPct: "10", empContribMinor: result.gpfMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  } else if (result.npsEmployeeMinor > 0n) {
    await statutoryRepo.insertNps(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      empContribPct: "10", erContribPct: "14",
      empContribMinor: result.npsEmployeeMinor, erContribMinor: result.npsEmployerMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  } else {
    await statutoryRepo.insertPf(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, basicMinor: params.basicMinor,
      empContribPct: "12", erContribPct: "12",
      empContribMinor: result.pfEmployeeMinor, erContribMinor: result.pfEmployerMinor,
      epsContribMinor: result.epsMinor, epfErContribMinor: result.epfEmployerMinor,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  if (result.esiMinor > 0n) {
    await statutoryRepo.insertEsi(tx, {
      id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
      runId: params.runId, grossMinor: result.grossMinor,
      empContribMinor: result.esiMinor,
      erContribMinor: (result.grossMinor * 325n) / 10000n,
      currency: "INR", period: params.month,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
  }
  await statutoryRepo.insertTds(tx, {
    id: randomUUID(), tenantId: params.tenantId, slipId, employeeId: params.employeeId,
    runId: params.runId, annualBasicMinor: params.basicMinor * 12n,
    taxableMinor: result.annualTaxableMinor,
    tdsMinor: result.tdsMinor, currency: "INR", period: params.month,
    createdBy: msg.actorId, updatedBy: msg.actorId,
  });
  return result;
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
