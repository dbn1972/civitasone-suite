/**
 * S8 G7 - project costing, transaction-level services (shared by the run
 * approval hook, the allocation consumer and the routes). Every function takes
 * the caller's transaction (RLS GUC already set) and never opens its own.
 */
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import {
  type AllocationLine, type CostAmounts, type CostLine, type TargetIdentity, type TargetType,
  addAmounts, effectiveMinCohort, monthEnd, monthStart, peakAllocationBps, pctToBps, reclassDeltas, splitSlipCost, totalOf, zeroAmounts,
} from "./domain.js";

export type Tx = { execute: (q: SQL) => Promise<unknown> };
const rowsOf = <T>(r: unknown): T[] => Array.from(r as Iterable<T>);
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));
const uuidList = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

export async function isProjectCostingEnabled(tx: Tx, tenantId: string): Promise<boolean> {
  const r = rowsOf<{ on: boolean }>(await tx.execute(sql`
    SELECT project_costing_enabled AS on FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`));
  return r[0]?.on === true;
}

/** Serialise allocation changes and reclassification of one employee (transaction-scoped). */
export async function lockEmployeeCosting(tx: Tx, tenantId: string, employeeId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cost_alloc:${tenantId}:${employeeId}`}, 0))`);
}

interface AllocRow {
  id: string; employee_id: string; target_type: TargetType; project_id: string | null; cost_center_id: string | null;
  split_pct: string; effective_from: string; effective_to: string | null; status: string;
}
const toLine = (r: AllocRow): AllocationLine => ({
  id: r.id, targetType: r.target_type, projectId: r.project_id, costCenterId: r.cost_center_id,
  bps: pctToBps(r.split_pct), from: r.effective_from, to: r.effective_to,
});

/** Allocations of the given employees overlapping [from, to] (to null = open) in the given statuses. */
export async function loadAllocations(
  tx: Tx, tenantId: string, employeeIds: string[], from: string, to: string | null, statuses: string[], excludeId?: string,
): Promise<Array<AllocationLine & { employeeId: string; status: string }>> {
  if (employeeIds.length === 0) return [];
  const r = rowsOf<AllocRow>(await tx.execute(sql`
    SELECT id, employee_id, target_type, project_id, cost_center_id, split_pct::text AS split_pct,
           effective_from::text AS effective_from, effective_to::text AS effective_to, status
      FROM payroll.employee_cost_allocations
     WHERE tenant_id = ${tenantId}::uuid
       AND employee_id IN (${uuidList(employeeIds)})
       AND status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
       AND effective_from <= COALESCE(${to}::date, 'infinity'::date)
       AND (effective_to IS NULL OR effective_to >= ${from}::date)
       AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
     ORDER BY effective_from, id`));
  return r.map((x) => ({ ...toLine(x), employeeId: x.employee_id, status: x.status }));
}

/**
 * The highest total an employee's lines (active + pending, excluding `excludeId`)
 * plus a candidate would reach on any day of [from, to], in bps.
 */
export async function peakWithCandidate(
  tx: Tx, tenantId: string, employeeId: string, cand: { bps: number; from: string; to: string | null }, statuses: string[], excludeId?: string,
): Promise<number> {
  const others = await loadAllocations(tx, tenantId, [employeeId], cand.from, cand.to, statuses, excludeId);
  return peakAllocationBps([...others, { bps: cand.bps, from: cand.from, to: cand.to }], cand.from, cand.to);
}

interface SlipRow {
  slip_id: string; employee_id: string; gross: string; pf: string; esi: string; nps: string; other: string;
}

/** Slips of a run with the employer-side cost from the statutory ledgers (the same source the GL accrual uses). */
async function loadRunSlipCosts(tx: Tx, tenantId: string, runId: string): Promise<Array<{ slipId: string; employeeId: string; amounts: CostAmounts }>> {
  const r = rowsOf<SlipRow>(await tx.execute(sql`
    SELECT s.id AS slip_id, s.employee_id, s.gross_minor::text AS gross,
           COALESCE(pf.er, 0)::text AS pf, COALESCE(esi.er, 0)::text AS esi, COALESCE(nps.er, 0)::text AS nps,
           (COALESCE(pf.other, 0) + COALESCE(ups.c, 0))::text AS other
      FROM payroll.payroll_slips s
      LEFT JOIN (SELECT slip_id, SUM(er_contrib_minor) AS er, SUM(edli_contrib_minor + epf_admin_minor) AS other
                   FROM statutory.payroll_pf WHERE run_id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid GROUP BY slip_id) pf ON pf.slip_id = s.id
      LEFT JOIN (SELECT slip_id, SUM(er_contrib_minor) AS er
                   FROM statutory.payroll_esi WHERE run_id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid GROUP BY slip_id) esi ON esi.slip_id = s.id
      LEFT JOIN (SELECT slip_id, SUM(er_contrib_minor) AS er
                   FROM statutory.payroll_nps WHERE run_id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid GROUP BY slip_id) nps ON nps.slip_id = s.id
      LEFT JOIN (SELECT slip_id, SUM(contrib_minor) AS c
                   FROM statutory.payroll_ups_pool WHERE run_id = ${runId}::uuid AND tenant_id = ${tenantId}::uuid GROUP BY slip_id) ups ON ups.slip_id = s.id
     WHERE s.run_id = ${runId}::uuid AND s.tenant_id = ${tenantId}::uuid AND s.status <> 'excluded'
     ORDER BY s.id`));
  return r.map((x) => ({
    slipId: x.slip_id, employeeId: x.employee_id,
    amounts: { gross: big(x.gross), employerPf: big(x.pf), employerEsi: big(x.esi), employerNps: big(x.nps), otherEmployer: big(x.other) },
  }));
}

interface LineInsert {
  kind: "run" | "reclass"; costMonth: string; runId: string; slipId: string; employeeId: string; batchId: string | null;
  line: { lineKey: string } & TargetIdentity & { splitBps: number | null }; amounts: CostAmounts;
}

async function insertLines(tx: Tx, tenantId: string, lines: LineInsert[]): Promise<void> {
  for (let i = 0; i < lines.length; i += 200) {
    const chunk = lines.slice(i, i + 200);
    const values = chunk.map((l) => sql`(
      ${tenantId}::uuid, ${l.kind}, ${l.costMonth}, ${l.runId}::uuid, ${l.slipId}::uuid, ${l.employeeId}::uuid, ${l.line.lineKey},
      ${l.line.allocationId}::uuid, ${l.line.targetType}, ${l.line.projectId}::uuid, ${l.line.costCenterId}::uuid, ${l.line.splitBps}::int,
      ${l.amounts.gross.toString()}::bigint, ${l.amounts.employerPf.toString()}::bigint, ${l.amounts.employerEsi.toString()}::bigint,
      ${l.amounts.employerNps.toString()}::bigint, ${l.amounts.otherEmployer.toString()}::bigint, ${totalOf(l.amounts).toString()}::bigint,
      ${l.batchId}::uuid)`);
    await tx.execute(sql`
      INSERT INTO payroll.slip_cost_lines
        (tenant_id, kind, cost_month, run_id, slip_id, employee_id, line_key, allocation_id, target_type, project_id, cost_center_id, split_bps,
         gross_minor, employer_pf_minor, employer_esi_minor, employer_nps_minor, other_employer_minor, total_cost_minor, reclass_batch_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT DO NOTHING`);
  }
}

export interface ProjectSnapshot {
  projectId: string; costMonth: string; grossMinor: string; employerCostMinor: string; totalCostMinor: string; cohort: number;
}

export async function loadMinCohort(tx: Tx, tenantId: string): Promise<number> {
  const r = rowsOf<{ k: number }>(await tx.execute(sql`
    SELECT project_cost_min_cohort AS k FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`));
  return effectiveMinCohort(r[0]?.k);
}

/**
 * Publish the CURRENT per-project, per-cost-month totals (run lines plus
 * reclass deltas) to project-service, for the given months or for every month.
 * A snapshot replaces the previous one (absolute values + `asOf`), so a stale
 * or repeated delivery cannot double count. Aggregates only: `cohort` is the
 * number of distinct people whose net cost on the project that month is not
 * zero, so project-service can hide a month that fewer than `minCohort` people
 * stand behind. No employee id and no per-person amount is in the payload.
 */
export async function emitProjectSnapshots(
  tx: Parameters<typeof enqueue>[0] & Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  scope: { months: string[] } | "all",
): Promise<number> {
  const monthFilter = scope === "all" ? sql`TRUE` : scope.months.length === 0 ? sql`FALSE` : sql`cost_month IN (${sql.join(scope.months.map((m) => sql`${m}`), sql`, `)})`;
  const r = rowsOf<{ project_id: string; cost_month: string; g: string; e: string; t: string; cohort: string }>(await tx.execute(sql`
    WITH per_emp AS (
      SELECT project_id, cost_month, employee_id, SUM(gross_minor) AS g,
             SUM(employer_pf_minor + employer_esi_minor + employer_nps_minor + other_employer_minor) AS e, SUM(total_cost_minor) AS t
        FROM payroll.slip_cost_lines
       WHERE tenant_id = ${msg.tenantId}::uuid AND target_type = 'project' AND ${monthFilter}
       GROUP BY project_id, cost_month, employee_id)
    SELECT project_id, cost_month, SUM(g)::text AS g, SUM(e)::text AS e, SUM(t)::text AS t,
           COUNT(*) FILTER (WHERE g <> 0 OR e <> 0 OR t <> 0)::text AS cohort
      FROM per_emp GROUP BY project_id, cost_month ORDER BY project_id, cost_month`));
  if (r.length === 0) return 0;
  await enqueue(tx, {
    topic: EVENTS.projectCostPosted, eventType: EVENTS.projectCostPosted,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      asOf: new Date().toISOString(), minCohort: await loadMinCohort(tx, msg.tenantId),
      postings: r.map((x): ProjectSnapshot => ({ projectId: x.project_id, costMonth: x.cost_month, grossMinor: x.g, employerCostMinor: x.e, totalCostMinor: x.t, cohort: Number(x.cohort) })),
    },
  });
  return r.length;
}

export type RunCostResult = { skipped: "disabled" | "no_slips" | null; slips: number; lines: number; projects: number };

/**
 * Write the immutable cost lines of an approved run (kind 'run'), book any
 * pending reclassification deltas against it, and publish the per-project
 * totals. A no-op while the tenant's flag is off. Idempotent: lines are unique
 * per (slip, target), so a retry or a manual regenerate cannot duplicate them.
 */
export async function recordRunCostLinesTx(
  tx: Parameters<typeof enqueue>[0] & Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  run: { id: string; month: string },
): Promise<RunCostResult> {
  if (!(await isProjectCostingEnabled(tx, msg.tenantId))) return { skipped: "disabled", slips: 0, lines: 0, projects: 0 };
  const slips = await loadRunSlipCosts(tx, msg.tenantId, run.id);
  if (slips.length === 0) return { skipped: "no_slips", slips: 0, lines: 0, projects: 0 };

  const allocs = await loadAllocations(tx, msg.tenantId, [...new Set(slips.map((s) => s.employeeId))], monthStart(run.month), monthEnd(run.month), ["active"]);
  const byEmployee = new Map<string, AllocationLine[]>();
  for (const a of allocs) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);

  const inserts: LineInsert[] = [];
  for (const s of slips) {
    for (const line of splitSlipCost(s.amounts, byEmployee.get(s.employeeId) ?? [], run.month)) {
      inserts.push({
        kind: "run", costMonth: run.month, runId: run.id, slipId: s.slipId, employeeId: s.employeeId, batchId: null,
        line, amounts: { gross: line.gross, employerPf: line.employerPf, employerEsi: line.employerEsi, employerNps: line.employerNps, otherEmployer: line.otherEmployer },
      });
    }
  }
  await insertLines(tx, msg.tenantId, inserts);

  // Reclass deltas created since the last approved run are now booked in this one.
  await tx.execute(sql`
    UPDATE payroll.slip_cost_lines SET booked_run_id = ${run.id}::uuid, booked_month = ${run.month}
     WHERE tenant_id = ${msg.tenantId}::uuid AND kind = 'reclass' AND booked_run_id IS NULL`);

  const projects = await emitProjectSnapshots(tx, msg, { months: [run.month] });
  return { skipped: null, slips: slips.length, lines: inserts.length, projects };
}

/**
 * Back-dated reclassification. After an allocation change effective from
 * `sinceDate`, every already-costed month of the employee from that month on is
 * re-split with the CURRENT active allocations; the difference to what is
 * booked becomes 'reclass' delta lines (the approved runs and their lines stay
 * untouched) that the next approved run books. Idempotent: a second call finds
 * no difference and writes nothing.
 */
export async function reclassEmployeeTx(
  tx: Parameters<typeof enqueue>[0] & Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  employeeId: string, sinceDate: string, batchId: string = randomUUID(),
): Promise<{ deltaLines: number; months: number }> {
  // With the flag off nothing is costed and nothing may be written (a tenant that switched it off must stay a no-op).
  if (!(await isProjectCostingEnabled(tx, msg.tenantId))) return { deltaLines: 0, months: 0 };
  const slips = rowsOf<{ slip_id: string; run_id: string; cost_month: string }>(await tx.execute(sql`
    SELECT DISTINCT slip_id, run_id, cost_month FROM payroll.slip_cost_lines
     WHERE tenant_id = ${msg.tenantId}::uuid AND employee_id = ${employeeId}::uuid AND kind = 'run' AND cost_month >= ${sinceDate.slice(0, 7)}
     ORDER BY cost_month, slip_id`));
  const inserts: LineInsert[] = [];
  for (const s of slips) {
    const booked = rowsOf<{
      line_key: string; allocation_id: string | null; target_type: TargetType | "unallocated"; project_id: string | null; cost_center_id: string | null;
      gross: string; pf: string; esi: string; nps: string; other: string;
    }>(await tx.execute(sql`
      SELECT line_key, (array_agg(allocation_id))[1] AS allocation_id, target_type, project_id, cost_center_id,
             SUM(gross_minor)::text AS gross, SUM(employer_pf_minor)::text AS pf, SUM(employer_esi_minor)::text AS esi,
             SUM(employer_nps_minor)::text AS nps, SUM(other_employer_minor)::text AS other
        FROM payroll.slip_cost_lines
       WHERE tenant_id = ${msg.tenantId}::uuid AND slip_id = ${s.slip_id}::uuid
       GROUP BY line_key, target_type, project_id, cost_center_id`));
    const bookedMap = new Map<string, { identity: TargetIdentity; amounts: CostAmounts }>();
    let totals = zeroAmounts();
    for (const b of booked) {
      const amounts: CostAmounts = { gross: big(b.gross), employerPf: big(b.pf), employerEsi: big(b.esi), employerNps: big(b.nps), otherEmployer: big(b.other) };
      bookedMap.set(b.line_key, { identity: { allocationId: b.allocation_id, targetType: b.target_type, projectId: b.project_id, costCenterId: b.cost_center_id }, amounts });
      totals = addAmounts(totals, amounts);
    }
    const allocs = await loadAllocations(tx, msg.tenantId, [employeeId], monthStart(s.cost_month), monthEnd(s.cost_month), ["active"]);
    const expected: CostLine[] = splitSlipCost(totals, allocs, s.cost_month);
    for (const d of reclassDeltas(bookedMap, expected)) {
      inserts.push({
        kind: "reclass", costMonth: s.cost_month, runId: s.run_id, slipId: s.slip_id, employeeId, batchId,
        line: { lineKey: d.lineKey, ...d.identity, splitBps: null }, amounts: d.delta,
      });
    }
  }
  await insertLines(tx, msg.tenantId, inserts);
  if (inserts.length > 0) await emitProjectSnapshots(tx, msg, { months: [...new Set(inserts.map((i) => i.costMonth))] });
  return { deltaLines: inserts.length, months: new Set(slips.map((s) => s.cost_month)).size };
}
