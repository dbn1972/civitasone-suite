/**
 * One-off repair: payroll.flex_benefit_elections.employee_id written in the
 * wrong id space.
 *
 * Until the flex-elections id-space fix, the flexElectionUpsert consumer
 * stored `employee_id = msg.actorId` -- the elector's LOGIN user id -- instead
 * of their hrms employee id -- the id every other payroll table keys on.
 * Elections are now stored by hrms employee id so that any future
 * application or lookup by employee id matches them. (Payroll runs do not
 * apply flex elections today; only my-elections reads this table.) Those
 * pre-fix rows are
 * recognisable: the old consumer also wrote `created_by = msg.actorId`, so
 * `employee_id = created_by`.
 *
 * For ONE tenant at a time, this maps each such row's user id to the hrms
 * employee id via hrms (resolveActorEmployeeId, called with that tenant's
 * x-tenant-id) and rewrites employee_id. Guarantees:
 *  - Tenant-confined: every read/write runs in a tenant transaction (RLS GUC
 *    set from runWithTenant) AND filters tenant_id explicitly.
 *  - Dry-run by default: `apply: false` only reports what would change.
 *  - Fails closed: all identities are resolved BEFORE any write; an
 *    unreachable HRMS throws HrmsUnavailableError and nothing is written.
 *  - Idempotent: a repaired row has employee_id != created_by, so a re-run
 *    skips it. Each UPDATE is also guarded on the old employee_id.
 *  - Never destructive: a row whose target (tenant, employee, plan, fy)
 *    already exists is reported as a conflict and left untouched; a user id
 *    hrms cannot link to an employee is reported as unlinked and left
 *    untouched. Both need a human decision.
 *  - Audited: one audit.event.record per repaired row (outbox, same tx).
 *
 * CLI: src/scripts/backfill-flex-election-employee-ids.ts. Runbook:
 * docs/runbooks/payroll.md "Data repair: flex election employee ids".
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { resolveActorEmployeeId } from "../../shared/hrms-client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT = "audit.event.record";

export type FlexBackfillOutcome = "remapped" | "would_remap" | "conflict" | "unlinked";

export type FlexBackfillRow = {
  id: string;
  planId: string;
  fy: string;
  fromEmployeeId: string;
  toEmployeeId: string | null;
  outcome: FlexBackfillOutcome;
};

export type FlexBackfillReport = {
  tenantId: string;
  apply: boolean;
  scanned: number;
  remapped: number;
  conflicts: number;
  unlinked: number;
  rows: FlexBackfillRow[];
};

export type FlexBackfillOptions = {
  tenantId: string;
  /** false (default) = dry run, nothing is written. */
  apply?: boolean;
  /** Operator user id recorded on the audit events (required with apply). */
  actorId?: string | undefined;
  correlationId?: string | undefined;
};

type Candidate = { id: string; employee_id: string; plan_id: string; fy: string };

export async function backfillFlexElectionEmployeeIds(opts: FlexBackfillOptions): Promise<FlexBackfillReport> {
  const { tenantId } = opts;
  const apply = opts.apply === true;
  if (!UUID_RE.test(tenantId)) throw new Error("tenantId must be a UUID");
  if (apply && (!opts.actorId || !UUID_RE.test(opts.actorId))) {
    throw new Error("actorId (operator user UUID) is required with apply");
  }
  const correlationId = opts.correlationId ?? randomUUID();

  const candidates = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    (await tx.execute(sql`
      SELECT id::text AS id, employee_id::text AS employee_id, plan_id::text AS plan_id, fy
      FROM payroll.flex_benefit_elections
      WHERE tenant_id = ${tenantId}::uuid AND employee_id = created_by
      ORDER BY created_at, id
    `)) as unknown as Candidate[]));

  // Resolve every distinct user id first: an unreachable HRMS aborts here,
  // before any write (HrmsUnavailableError propagates to the caller).
  const resolved = new Map<string, string | null>();
  for (const c of candidates) {
    if (!resolved.has(c.employee_id)) resolved.set(c.employee_id, await resolveActorEmployeeId(tenantId, c.employee_id));
  }

  const report: FlexBackfillReport = { tenantId, apply, scanned: candidates.length, remapped: 0, conflicts: 0, unlinked: 0, rows: [] };

  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const claimed = new Set<string>();
    for (const c of candidates) {
      const target = resolved.get(c.employee_id) ?? null;
      const base = { id: c.id, planId: c.plan_id, fy: c.fy, fromEmployeeId: c.employee_id, toEmployeeId: target };
      if (target === c.employee_id) continue; // already an hrms employee id
      if (!target) {
        report.unlinked++;
        report.rows.push({ ...base, outcome: "unlinked" });
        continue;
      }
      const key = `${target}|${c.plan_id}|${c.fy}`;
      const existing = (await tx.execute(sql`
        SELECT 1 FROM payroll.flex_benefit_elections
        WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${target}::uuid
          AND plan_id = ${c.plan_id}::uuid AND fy = ${c.fy} LIMIT 1
      `)) as unknown as unknown[];
      if (existing.length > 0 || claimed.has(key)) {
        report.conflicts++;
        report.rows.push({ ...base, outcome: "conflict" });
        continue;
      }
      claimed.add(key);
      if (!apply) {
        report.rows.push({ ...base, outcome: "would_remap" });
        continue;
      }
      await tx.execute(sql`
        UPDATE payroll.flex_benefit_elections SET employee_id = ${target}::uuid
        WHERE id = ${c.id}::uuid AND tenant_id = ${tenantId}::uuid AND employee_id = ${c.employee_id}::uuid
      `);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId, actorId: opts.actorId as string, correlationId,
        payload: {
          service: "payroll", action: "backfill_employee_id", resourceType: "payroll_flex_election",
          resourceId: c.id, outcome: "success", fromEmployeeId: c.employee_id, toEmployeeId: target,
        },
      });
      report.remapped++;
      report.rows.push({ ...base, outcome: "remapped" });
    }
  }));

  return report;
}
