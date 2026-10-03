/**
 * GAP-PAYROLL-PAY-GROUPS-03: SQL for pay-group membership and the per-period
 * run claims. Every function takes the caller's transaction (`tx`), so it runs
 * under FORCE RLS with the tenant GUC set, and every statement is tenant
 * scoped explicitly as well.
 */
import { sql } from "drizzle-orm";
import { monthBounds, planAssignment } from "./pay-group-domain.js";

// Structural type: the real `db` transaction and a scopedRead tx both satisfy it.
export type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

const rows = <T>(r: unknown): T[] => (r == null ? [] : Array.from(r as Iterable<T>));

function uuidList(ids: readonly string[]) {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

export async function loadSettings(tx: Executor, tenantId: string): Promise<{ allowMidMonthEffective: boolean }> {
  const r = rows<{ allow_mid_month_effective: boolean }>(await tx.execute(sql`
    SELECT allow_mid_month_effective FROM payroll.pay_group_settings WHERE tenant_id = ${tenantId}::uuid
  `));
  return { allowMidMonthEffective: r[0]?.allow_mid_month_effective === true };
}

type AssignmentRow = {
  id: string; pay_group_id: string; effective_from: string; effective_to: string | null;
};

export type AssignOutcome =
  | { outcome: "assigned" }
  | { outcome: "moved"; fromPayGroupId: string }
  | { outcome: "unchanged"; code: "ALREADY_MEMBER" }
  | { outcome: "rejected"; code: "PAY_GROUP_INACTIVE" | "PAY_GROUP_NOT_FOUND" | "MEMBERSHIP_OVERLAP"; message: string };

/**
 * Put `employeeId` in `payGroupId` from `effectiveFrom`. If the employee is in
 * another group on that date the old assignment is closed on `effectiveFrom`
 * (a move) and history is kept. Serialised per employee by an advisory lock
 * (the DB trigger takes the same lock and is the backstop), and per group by
 * a row lock that deactivation also takes, so a member can never be added to
 * a group that is concurrently being deactivated.
 */
export async function applyAssignment(
  tx: Executor,
  p: { tenantId: string; actorId: string; employeeId: string; payGroupId: string; effectiveFrom: string; reason: string },
): Promise<AssignOutcome> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`epga:${p.tenantId}:${p.employeeId}`}, 0))`);
  const g = rows<{ status: string }>(await tx.execute(sql`
    SELECT status FROM payroll.pay_groups
     WHERE id = ${p.payGroupId}::uuid AND tenant_id = ${p.tenantId}::uuid FOR SHARE
  `));
  if (!g[0]) return { outcome: "rejected", code: "PAY_GROUP_NOT_FOUND", message: "pay group not found" };
  if (g[0].status !== "active") return { outcome: "rejected", code: "PAY_GROUP_INACTIVE", message: "the pay group is deactivated" };

  const existing = rows<AssignmentRow>(await tx.execute(sql`
    SELECT id, pay_group_id, effective_from::text AS effective_from, effective_to::text AS effective_to
      FROM payroll.employee_pay_group_assignments
     WHERE tenant_id = ${p.tenantId}::uuid AND employee_id = ${p.employeeId}::uuid
     ORDER BY effective_from DESC
  `));
  const plan = planAssignment(
    existing.map((a) => ({ id: a.id, payGroupId: a.pay_group_id, effectiveFrom: a.effective_from, effectiveTo: a.effective_to })),
    p.payGroupId, p.effectiveFrom,
  );
  if (plan.kind === "reject") return { outcome: "rejected", code: plan.code, message: plan.message };
  if (plan.kind === "unchanged") return { outcome: "unchanged", code: plan.code };
  if (plan.kind === "move") {
    await tx.execute(sql`
      UPDATE payroll.employee_pay_group_assignments
         SET effective_to = ${p.effectiveFrom}::date, ended_by = ${p.actorId}::uuid, ended_at = NOW(),
             end_reason = ${`moved: ${p.reason}`}
       WHERE id = ${plan.closeId}::uuid AND tenant_id = ${p.tenantId}::uuid
    `);
  }
  await tx.execute(sql`
    INSERT INTO payroll.employee_pay_group_assignments
      (tenant_id, employee_id, pay_group_id, effective_from, reason, created_by)
    VALUES (${p.tenantId}::uuid, ${p.employeeId}::uuid, ${p.payGroupId}::uuid, ${p.effectiveFrom}::date, ${p.reason}, ${p.actorId}::uuid)
  `);
  return plan.kind === "move" ? { outcome: "moved", fromPayGroupId: plan.fromPayGroupId } : { outcome: "assigned" };
}

export type EndOutcome =
  | { outcome: "ended" }
  | { outcome: "rejected"; code: "NOT_A_MEMBER" | "INVALID_END_DATE"; message: string };

/** End an employee's open-ended membership of `payGroupId` on `endsOn` (exclusive). */
export async function endAssignment(
  tx: Executor,
  p: { tenantId: string; actorId: string; employeeId: string; payGroupId: string; endsOn: string; reason: string },
): Promise<EndOutcome> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`epga:${p.tenantId}:${p.employeeId}`}, 0))`);
  const cur = rows<AssignmentRow>(await tx.execute(sql`
    SELECT id, pay_group_id, effective_from::text AS effective_from, effective_to::text AS effective_to
      FROM payroll.employee_pay_group_assignments
     WHERE tenant_id = ${p.tenantId}::uuid AND employee_id = ${p.employeeId}::uuid
       AND pay_group_id = ${p.payGroupId}::uuid AND effective_to IS NULL
     FOR UPDATE
  `));
  const a = cur[0];
  if (!a) return { outcome: "rejected", code: "NOT_A_MEMBER", message: "the employee has no open membership of this pay group" };
  if (p.endsOn <= a.effective_from) {
    return { outcome: "rejected", code: "INVALID_END_DATE", message: `the end date must be after the membership start (${a.effective_from})` };
  }
  await tx.execute(sql`
    UPDATE payroll.employee_pay_group_assignments
       SET effective_to = ${p.endsOn}::date, ended_by = ${p.actorId}::uuid, ended_at = NOW(), end_reason = ${p.reason}
     WHERE id = ${a.id}::uuid AND tenant_id = ${p.tenantId}::uuid
  `);
  return { outcome: "ended" };
}

/**
 * employee -> pay group that pays them for `month` (see groupForMonth in
 * pay-group-domain.ts: of the assignments overlapping the month, the latest
 * start wins). `payGroupId` narrows the result to one group's members.
 */
export async function resolveMonthMembers(
  tx: Executor, tenantId: string, month: string, payGroupId?: string,
): Promise<Map<string, string>> {
  const { start, endExclusive } = monthBounds(month);
  const r = rows<{ employee_id: string; pay_group_id: string }>(await tx.execute(sql`
    SELECT employee_id, pay_group_id FROM (
      SELECT DISTINCT ON (employee_id) employee_id, pay_group_id
        FROM payroll.employee_pay_group_assignments
       WHERE tenant_id = ${tenantId}::uuid
         AND effective_from < ${endExclusive}::date
         AND COALESCE(effective_to, 'infinity'::date) > ${start}::date
       ORDER BY employee_id, effective_from DESC
    ) m
    ${payGroupId ? sql`WHERE pay_group_id = ${payGroupId}::uuid` : sql``}
  `));
  return new Map(r.map((x) => [x.employee_id, x.pay_group_id]));
}

/** All of an employee's assignments, newest first (pure-planner input). */
export async function loadEmployeeAssignments(tx: Executor, tenantId: string, employeeId: string): Promise<import("./pay-group-domain.js").AssignmentSpan[]> {
  const r = rows<AssignmentRow>(await tx.execute(sql`
    SELECT id, pay_group_id, effective_from::text AS effective_from, effective_to::text AS effective_to
      FROM payroll.employee_pay_group_assignments
     WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
     ORDER BY effective_from DESC
  `));
  return r.map((a) => ({ id: a.id, payGroupId: a.pay_group_id, effectiveFrom: a.effective_from, effectiveTo: a.effective_to }));
}

/** Current + scheduled members (open or future-ending as of `asOf`) of a group. */
export async function countCurrentMembers(tx: Executor, tenantId: string, payGroupId: string, asOf: string): Promise<number> {
  const r = rows<{ n: string }>(await tx.execute(sql`
    SELECT COUNT(*)::text AS n FROM payroll.employee_pay_group_assignments
     WHERE tenant_id = ${tenantId}::uuid AND pay_group_id = ${payGroupId}::uuid
       AND (effective_to IS NULL OR effective_to > ${asOf}::date)
  `));
  return Number(r[0]?.n ?? 0);
}

/** Draft / processing runs scoped to the group. */
export async function countActiveRuns(tx: Executor, tenantId: string, payGroupId: string): Promise<number> {
  const r = rows<{ n: string }>(await tx.execute(sql`
    SELECT COUNT(*)::text AS n FROM payroll.payroll_runs
     WHERE tenant_id = ${tenantId}::uuid AND pay_group_id = ${payGroupId}::uuid AND status IN ('draft', 'processing')
  `));
  return Number(r[0]?.n ?? 0);
}

/**
 * Employees (of `employeeIds`) already included in another non-cancelled
 * REGULAR run for `month`: via the claims table, and via the slips of runs
 * that pre-date the claims table. `exceptRunId` is the run being processed.
 */
export async function findDoubleRunEmployees(
  tx: Executor, tenantId: string, month: string, employeeIds: readonly string[], exceptRunId: string | null,
): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const out = new Set<string>();
  for (let i = 0; i < employeeIds.length; i += 1000) {
    const chunk = employeeIds.slice(i, i + 1000);
    const except = exceptRunId ? sql`AND run_id <> ${exceptRunId}::uuid` : sql``;
    const exceptR = exceptRunId ? sql`AND r.id <> ${exceptRunId}::uuid` : sql``;
    const claimed = rows<{ employee_id: string }>(await tx.execute(sql`
      SELECT employee_id FROM payroll.payroll_run_employee_claims
       WHERE tenant_id = ${tenantId}::uuid AND month = ${month} AND employee_id IN (${uuidList(chunk)}) ${except}
    `));
    for (const c of claimed) out.add(c.employee_id);
    const slipped = rows<{ employee_id: string }>(await tx.execute(sql`
      SELECT DISTINCT s.employee_id FROM payroll.payroll_slips s
        JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${tenantId}::uuid AND r.month = ${month} AND r.run_type = 'regular'
         AND r.status NOT IN ('failed', 'cancelled') AND s.employee_id IN (${uuidList(chunk)}) ${exceptR}
    `));
    for (const c of slipped) out.add(c.employee_id);
  }
  return [...out];
}

/**
 * Claim `employeeIds` for `runId` / `month`. The INSERT ... ON CONFLICT DO
 * NOTHING + the PRIMARY KEY make the claim race-safe: of two concurrent runs
 * naming the same employee exactly one inserts the claim (the other waits on
 * the unique index, then sees the winner's claim). Re-claiming for the same
 * run is a no-op, so a resumed run is safe. The caller then asks
 * findDoubleRunEmployees(..., runId) whether anyone is ALREADY in another run.
 */
export async function claimRunEmployees(
  tx: Executor, p: { tenantId: string; runId: string; month: string; employeeIds: readonly string[] },
): Promise<void> {
  // Sorted: every run takes its claims in the same order, so two runs that
  // share employees queue behind one another instead of deadlocking.
  const ordered = [...p.employeeIds].sort();
  for (let i = 0; i < ordered.length; i += 1000) {
    const chunk = ordered.slice(i, i + 1000);
    await tx.execute(sql`
      INSERT INTO payroll.payroll_run_employee_claims (tenant_id, employee_id, month, run_id)
      VALUES ${sql.join(chunk.map((e) => sql`(${p.tenantId}::uuid, ${e}::uuid, ${p.month}, ${p.runId}::uuid)`), sql`, `)}
      ON CONFLICT (tenant_id, employee_id, month) DO NOTHING
    `);
  }
}
