/**
 * UAT T-PERIOD D-14 (ERP-head decision 2026-11-05): the leave year-end /
 * half-yearly credit job (rules in year-end.ts, CCS (Leave) Rules 1972).
 *
 *  - planLeaveYearEnd(dryRun: true)  -> what the job would do (no writes):
 *    GET /v1/hrms/leave/year-end/preview and scripts/leave-year-end.ts.
 *  - planLeaveYearEnd(dryRun: false) -> applies it, one transaction per
 *    employee under the employee leave lock. Idempotent: every change writes a
 *    leave.hrms_leave_year_end_entries row (migration 0264, UNIQUE per tenant /
 *    credit date / employee / leave type / action); an employee + leave type
 *    with entries for the credit date is never processed again.
 *  - runLeaveYearEndTickOnce: the scheduled run (worker tick). OFF unless
 *    HRMS_LEAVE_YEAR_END_ENABLED=true. Within LEAVE_YEAR_END_CATCH_UP_DAYS of
 *    a credit date it processes everyone; later in the half-year only the
 *    employees appointed in it (appointment credit), so enabling it never
 *    back-credits staff already in service.
 * Every change is audited (audit.event.record, action leave_year_end).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { SAFE_LOG_SERIALIZERS } from "../../shared/safe-error-log.js";
import type { Db, ScopedTx } from "../../shared/db.js";
import { scopedPlatformRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { todayIST, addDaysToDateOnly } from "../../shared/ist.js";
import * as employeeRepo from "../employee/repo.js";
import * as repo from "./repo.js";
import { and, eq } from "drizzle-orm";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import {
  halfYearOf, isCreditDate, normaliseStartMonth, planEmployeeYearEnd, eolDaysWithin, diesNonDaysWithin, DEFAULT_SUPERANNUATION_AGES,
  type HalfYear, type LeaveYearStartMonth, type YearEndAlloc, type YearEndLeaveType, type YearEndOp,
} from "./year-end.js";

export const LEAVE_YEAR_END_SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
export const LEAVE_YEAR_END_CATCH_UP_DAYS = 14;
const AUDIT = "audit.event.record";
const log = pino({ name: "hrms_leave_year_end", serializers: SAFE_LOG_SERIALIZERS });

export class LeaveYearEndError extends Error {
  constructor(public readonly code: "NOT_A_CREDIT_DATE" | "LEAVE_YEAR_CONFIG_INVALID", message: string, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export interface LeaveYearEndResult {
  tenantId: string; runDate: string; dryRun: boolean;
  leaveYearStartMonth: LeaveYearStartMonth; leaveYear: string; opensLeaveYear: boolean;
  halfYear: { start: string; end: string };
  leaveTypes: { EL: boolean; HPL: boolean; CL: boolean };
  employeesConsidered: number; alreadyProcessed: number;
  ops: YearEndOp[]; applied: number;
  warnings: string[];
}

type Row = Record<string, unknown>;
const rows = async (tx: ScopedTx, q: ReturnType<typeof sql>): Promise<Row[]> => (await tx.execute(q)) as unknown as Row[];

/** The tenant leave year (year_start_month 1 = calendar, the default; 4 = financial). */
export async function resolveLeaveYearStartMonth(tx: ScopedTx, tenantId: string): Promise<LeaveYearStartMonth> {
  const r = await rows(tx, sql`SELECT year_start_month FROM leave.hrms_leave_year_config WHERE tenant_id = ${tenantId}::uuid LIMIT 1`);
  const v = r[0]?.year_start_month;
  const m = normaliseStartMonth(v == null ? null : Number(v));
  if (m == null) throw new LeaveYearEndError("LEAVE_YEAR_CONFIG_INVALID", `leave year must start in January (calendar year) or April (financial year); configured month ${String(v)}`);
  return m;
}

interface Snapshot {
  half: HalfYear; startMonth: LeaveYearStartMonth;
  types: { EL?: YearEndLeaveType; HPL?: YearEndLeaveType; CL?: YearEndLeaveType };
  employees: Array<{ id: string; employeeNo: string; dateOfJoining: string | null; employeeType: string; status: string }>;
  allocsByEmployee: Map<string, YearEndAlloc[]>;
  eolByEmployee: Map<string, number>;
  done: Map<string, Set<string>>;
}

async function loadSnapshot(tx: ScopedTx, tenantId: string, runDate: string): Promise<Snapshot> {
  const startMonth = await resolveLeaveYearStartMonth(tx, tenantId);
  if (!isCreditDate(runDate, startMonth)) {
    const h = halfYearOf(runDate, startMonth);
    throw new LeaveYearEndError("NOT_A_CREDIT_DATE", `${runDate} is not a leave credit date for this tenant (half-years start on ${h.start} and the 1st of the month six months later)`, { halfYearStart: h.start });
  }
  const half = halfYearOf(runDate, startMonth);
  // Delta review SF4: superannuation age per employee type (tenant config; default 60, contract never).
  const cfg = await rows(tx, sql`SELECT superannuation_ages FROM leave.hrms_leave_year_config WHERE tenant_id = ${tenantId}::uuid LIMIT 1`);
  const rawAges = cfg[0]?.superannuation_ages;
  const ages: Record<string, number> = rawAges && typeof rawAges === "object" ? (rawAges as Record<string, number>) : { ...DEFAULT_SUPERANNUATION_AGES };
  // Resignation / VRS ...: last working day of an approved or completed separation.
  const seps = await rows(tx, sql`SELECT employee_id::text AS employee_id, MIN(COALESCE(last_working_date, effective_date))::text AS exit_date
    FROM lifecycle.hrms_separations WHERE tenant_id = ${tenantId}::uuid AND status IN (${"approved"}, ${"completed"}) GROUP BY employee_id`);
  const separationByEmployee = new Map(seps.map((s) => [String(s.employee_id), String(s.exit_date)]));
  const typeRows = await rows(tx, sql`SELECT id::text AS id, upper(code) AS code, max_days FROM leave.hrms_leave_types WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at ASC, id ASC`);
  const types: Snapshot["types"] = {};
  const eolTypeIds: string[] = [];
  for (const t of typeRows) {
    const code = String(t.code);
    const lt: YearEndLeaveType = { id: String(t.id), code, maxDays: Number(t.max_days ?? 0) };
    if ((code === "EL" || code === "HPL" || code === "CL") && !types[code]) types[code] = lt;
    if (code === "EOL") eolTypeIds.push(lt.id);
  }
  const emps = await rows(tx, sql`SELECT id::text AS id, employee_no, date_of_joining::text AS doj, date_of_birth::text AS dob, employee_type, status FROM employee.hrms_employees WHERE tenant_id = ${tenantId}::uuid ORDER BY employee_no ASC, id ASC`);
  const typeIds = [types.EL?.id, types.HPL?.id, types.CL?.id].filter((x): x is string => !!x);
  const allocsByEmployee = new Map<string, YearEndAlloc[]>();
  if (typeIds.length > 0) {
    const allocRows = await rows(tx, sql`SELECT id::text AS id, employee_id::text AS employee_id, leave_type_id::text AS leave_type_id, fy, total_days,
        COALESCE(balance_days_exact, balance_days::numeric)::text AS balance
      FROM leave.hrms_leave_allocs WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
        AND leave_type_id IN (${sql.join(typeIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const a of allocRows) {
      const list = allocsByEmployee.get(String(a.employee_id)) ?? [];
      list.push({ id: String(a.id), leaveTypeId: String(a.leave_type_id), label: String(a.fy), totalDays: Number(a.total_days), balanceDays: Number(a.balance) });
      allocsByEmployee.set(String(a.employee_id), list);
    }
  }
  const eolByEmployee = new Map<string, number>();
  if (eolTypeIds.length > 0) {
    const apps = await rows(tx, sql`SELECT employee_id::text AS employee_id, from_date::text AS from_date, to_date::text AS to_date FROM leave.hrms_leave_apps
      WHERE tenant_id = ${tenantId}::uuid AND status = ${"approved"}
        AND leave_type_id IN (${sql.join(eolTypeIds.map((id) => sql`${id}::uuid`), sql`, `)})
        AND from_date <= ${half.prevEnd}::date AND to_date >= ${half.prevStart}::date`);
    const byEmp = new Map<string, Array<{ fromDate: string; toDate: string }>>();
    for (const a of apps) {
      const list = byEmp.get(String(a.employee_id)) ?? [];
      list.push({ fromDate: String(a.from_date), toDate: String(a.to_date) });
      byEmp.set(String(a.employee_id), list);
    }
    for (const [emp, list] of byEmp) eolByEmployee.set(emp, eolDaysWithin(list, half.prevStart, half.prevEnd));
  }
  // Rule 27(3): dies non of the previous half-year (service book) reduces the credit like EOL.
  const diesNon = await tx.select({ employeeId: hrmsServiceBookEntries.employeeId, entryType: hrmsServiceBookEntries.entryType, effectiveDate: hrmsServiceBookEntries.effectiveDate, description: hrmsServiceBookEntries.description })
    .from(hrmsServiceBookEntries).where(and(eq(hrmsServiceBookEntries.tenantId, tenantId), eq(hrmsServiceBookEntries.entryType, "dies_non")));
  const dnByEmp = new Map<string, typeof diesNon>();
  for (const d of diesNon) dnByEmp.set(d.employeeId, [...(dnByEmp.get(d.employeeId) ?? []), d]);
  for (const [emp, list] of dnByEmp) {
    const dn = diesNonDaysWithin(list.map((d) => ({ entryType: d.entryType, effectiveDate: String(d.effectiveDate), description: d.description })), half.prevStart, half.prevEnd);
    if (dn > 0) eolByEmployee.set(emp, (eolByEmployee.get(emp) ?? 0) + dn);
  }
  const doneRows = await rows(tx, sql`SELECT DISTINCT employee_id::text AS employee_id, leave_type_id::text AS leave_type_id FROM leave.hrms_leave_year_end_entries
    WHERE tenant_id = ${tenantId}::uuid AND run_key = ${runDate}::date`);
  const done = new Map<string, Set<string>>();
  for (const d of doneRows) {
    const s = done.get(String(d.employee_id)) ?? new Set<string>();
    s.add(String(d.leave_type_id));
    done.set(String(d.employee_id), s);
  }
  return {
    half, startMonth, types, allocsByEmployee, eolByEmployee, done,
    employees: emps.map((e) => {
      const age = ages[String(e.employee_type)];
      return {
        id: String(e.id), employeeNo: String(e.employee_no ?? e.id), dateOfJoining: e.doj ? String(e.doj) : null, dateOfBirth: e.dob ? String(e.dob) : null,
        employeeType: String(e.employee_type), status: String(e.status),
        superannuationAge: typeof age === "number" && age > 0 ? age : null,
        separationDate: separationByEmployee.get(String(e.id)) ?? null,
      };
    }),
  };
}

function planAll(s: Snapshot, joinersOnly = false): { ops: YearEndOp[]; alreadyProcessed: number } {
  const ops: YearEndOp[] = [];
  let alreadyProcessed = 0;
  for (const e of s.employees) {
    // Review SF5(c): after the catch-up window only employees appointed in the
    // half-year are processed (their Rule 27(1) appointment credit).
    if (joinersOnly && !(e.dateOfJoining && e.dateOfJoining.slice(0, 10) > s.half.start)) continue;
    const done = s.done.get(e.id);
    if (done) alreadyProcessed += 1;
    ops.push(...planEmployeeYearEnd({
      half: s.half, employee: e, types: s.types, allocs: s.allocsByEmployee.get(e.id) ?? [],
      eolDaysPrevHalf: s.eolByEmployee.get(e.id) ?? 0, ...(done ? { done } : {}),
    }));
  }
  return { ops, alreadyProcessed };
}

const exactOrNull = (days: number): string | null => (Number.isInteger(days) ? null : days.toFixed(1));

async function applyEmployeeOps(tx: ScopedTx, tenantId: string, runDate: string, actorId: string, ops: YearEndOp[]): Promise<number> {
  const employeeId = ops[0]!.employeeId;
  await repo.lockEmployeeLeave(tx as unknown as Parameters<typeof repo.lockEmployeeLeave>[0], tenantId, employeeId);
  const already = await rows(tx, sql`SELECT DISTINCT leave_type_id::text AS leave_type_id FROM leave.hrms_leave_year_end_entries
    WHERE tenant_id = ${tenantId}::uuid AND run_key = ${runDate}::date AND employee_id = ${employeeId}::uuid`);
  const skip = new Set(already.map((r) => String(r.leave_type_id)));
  let applied = 0;
  for (const op of ops) {
    if (skip.has(op.leaveTypeId)) continue;
    if (op.sourceAllocId) {
      await tx.execute(sql`UPDATE leave.hrms_leave_allocs SET balance_days = 0, balance_days_exact = NULL, updated_at = now(), updated_by = ${actorId}::uuid
        WHERE id = ${op.sourceAllocId}::uuid AND tenant_id = ${tenantId}::uuid`);
    }
    let targetId = op.targetAllocId;
    if (targetId) {
      await tx.execute(sql`UPDATE leave.hrms_leave_allocs SET total_days = ${Math.ceil(op.newTotalDays)}, balance_days = ${Math.floor(op.newBalanceDays)},
          balance_days_exact = ${exactOrNull(op.newBalanceDays)}::numeric, updated_at = now(), updated_by = ${actorId}::uuid
        WHERE id = ${targetId}::uuid AND tenant_id = ${tenantId}::uuid`);
    } else {
      targetId = randomUUID();
      const ins = await rows(tx, sql`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, balance_days_exact, created_by, updated_by)
        VALUES (${targetId}::uuid, ${tenantId}::uuid, ${employeeId}::uuid, ${op.leaveTypeId}::uuid, ${op.targetLabel}, ${Math.ceil(op.newTotalDays)}, ${Math.floor(op.newBalanceDays)},
          ${exactOrNull(op.newBalanceDays)}::numeric, ${actorId}::uuid, ${actorId}::uuid)
        ON CONFLICT (tenant_id, employee_id, leave_type_id, fy) DO NOTHING RETURNING id::text AS id`);
      // An allocation for the year was created meanwhile (HR): leave it to the next tick to re-plan.
      if (ins.length === 0) throw new Error(`LEAVE_YEAR_END_RACE: a ${op.targetLabel} allocation appeared for employee ${employeeId}; re-planned next run`);
    }
    for (const e of op.entries) {
      await tx.execute(sql`INSERT INTO leave.hrms_leave_year_end_entries
          (tenant_id, run_key, leave_year, employee_id, leave_type_id, leave_code, action, days, alloc_id, target_alloc_id, note, created_by)
        VALUES (${tenantId}::uuid, ${runDate}::date, ${op.targetLabel}, ${employeeId}::uuid, ${op.leaveTypeId}::uuid, ${op.code}, ${e.action}, ${e.days},
          ${e.allocId ?? targetId}::uuid, ${targetId}::uuid, ${e.note ?? null}, ${actorId}::uuid)
        ON CONFLICT (tenant_id, run_key, employee_id, leave_type_id, action) DO NOTHING`);
    }
    await enqueue(tx as unknown as Parameters<typeof enqueue>[0], {
      topic: AUDIT, eventType: AUDIT, tenantId, actorId, correlationId: randomUUID(),
      payload: {
        service: "hrms", action: "leave_year_end", resourceType: "leave_alloc", resourceId: targetId, outcome: "success",
        metadata: {
          runDate, leaveYear: op.targetLabel, employeeId, employeeNo: op.employeeNo, leaveCode: op.code, leaveTypeId: op.leaveTypeId,
          sourceAllocId: op.sourceAllocId, sourceBalanceDays: op.sourceBalanceDays, newTotalDays: op.newTotalDays, newBalanceDays: op.newBalanceDays,
          entries: op.entries, credit: op.credit ?? null, warnings: op.warnings,
        },
      },
    });
    applied += 1;
  }
  return applied;
}

/** Plan (dryRun) or apply the leave credit / year-end of `runDate` for one tenant. */
export async function planLeaveYearEnd(db: Db, p: { tenantId: string; runDate: string; dryRun: boolean; actorId?: string; joinersOnly?: boolean }): Promise<LeaveYearEndResult> {
  const snap = await runWithTenant(p.tenantId, () => db.transaction((tx) => loadSnapshot(tx as unknown as ScopedTx, p.tenantId, p.runDate)));
  const { ops, alreadyProcessed } = planAll(snap, p.joinersOnly === true);
  const warnings: string[] = [];
  if (!snap.types.EL) warnings.push("the tenant has no EL leave type; no earned leave credited");
  if (!snap.types.CL && snap.half.opensLeaveYear) warnings.push("the tenant has no CL leave type; no casual leave lapsed / credited");
  for (const op of ops) for (const w of op.warnings) warnings.push(`${op.employeeNo} ${op.code}: ${w}`);
  let applied = 0;
  if (!p.dryRun) {
    const actorId = p.actorId ?? LEAVE_YEAR_END_SYSTEM_ACTOR;
    const byEmployee = new Map<string, YearEndOp[]>();
    for (const op of ops) byEmployee.set(op.employeeId, [...(byEmployee.get(op.employeeId) ?? []), op]);
    for (const [employeeId, list] of byEmployee) {
      try {
        applied += await runWithTenant(p.tenantId, () => db.transaction((tx) => applyEmployeeOps(tx as unknown as ScopedTx, p.tenantId, p.runDate, actorId, list)));
      } catch (err) {
        log.error({ err, tenantId: p.tenantId, employeeId, runDate: p.runDate }, "leave year-end: employee not processed; retried next run");
        warnings.push(`employee ${list[0]!.employeeNo}: not processed (${String((err as Error).message ?? err).slice(0, 200)})`);
      }
    }
  }
  return {
    tenantId: p.tenantId, runDate: p.runDate, dryRun: p.dryRun,
    leaveYearStartMonth: snap.startMonth, leaveYear: snap.half.leaveYearLabel, opensLeaveYear: snap.half.opensLeaveYear,
    halfYear: { start: snap.half.start, end: snap.half.end },
    leaveTypes: { EL: !!snap.types.EL, HPL: !!snap.types.HPL, CL: !!snap.types.CL },
    employeesConsidered: snap.employees.length, alreadyProcessed, ops, applied, warnings,
  };
}

export interface LeaveYearEndTickResult { enabled: boolean; runDate: string; tenants: number; applied: number; failed: number }

/**
 * Scheduled run: for every tenant whose current half-year started at most
 * LEAVE_YEAR_END_CATCH_UP_DAYS ago, apply that credit date. OFF unless
 * HRMS_LEAVE_YEAR_END_ENABLED=true (never run on the live UAT without a
 * reviewed dry run: GET /v1/hrms/leave/year-end/preview).
 */
export async function runLeaveYearEndTickOnce(db: Db, opts: { asOf?: string; enabled?: boolean } = {}): Promise<LeaveYearEndTickResult> {
  const runDate = opts.asOf ?? todayIST();
  const enabled = opts.enabled ?? process.env.HRMS_LEAVE_YEAR_END_ENABLED === "true";
  if (!enabled) return { enabled: false, runDate, tenants: 0, applied: 0, failed: 0 };
  let applied = 0, failed = 0, tenants = 0;
  const tenantIds = await scopedPlatformRead((tx) => employeeRepo.listEmployeeTenantIds(tx));
  for (const tenantId of tenantIds) {
    try {
      const startMonth = await runWithTenant(tenantId, () => db.transaction((tx) => resolveLeaveYearStartMonth(tx as unknown as ScopedTx, tenantId)));
      const half = halfYearOf(runDate, startMonth);
      const windowEnd = addDaysToDateOnly(half.start, LEAVE_YEAR_END_CATCH_UP_DAYS);
      if (!windowEnd) continue;
      // Within the window: everyone. After it: only employees appointed in the
      // half-year (review SF5(c)) -- an old half-year is never back-credited
      // for staff already in service. Idempotent per credit date either way.
      const joinersOnly = runDate > windowEnd;
      tenants += 1;
      const r = await planLeaveYearEnd(db, { tenantId, runDate: half.start, dryRun: false, joinersOnly });
      applied += r.applied;
    } catch (err) {
      failed += 1;
      log.error({ err, tenantId, runDate }, "leave year-end tick: tenant failed; retried next tick");
    }
  }
  log.info({ event: "scheduler.tick", runDate, tenants, applied, failed }, "leave year-end tick completed");
  return { enabled: true, runDate, tenants, applied, failed };
}
