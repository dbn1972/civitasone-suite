/**
 * UAT ux-docs (PR #2463 review, blocker 2; migration 0162): fill budget.finance_sanctions.approved_by /
 * approved_at for sanctions approved before the columns existed, from the approval event of record:
 *
 *   1. the finance.sanction.approved event in _outbox.messages (actor_id = the approving officer for
 *      both the direct approve and the eOffice decision; created_at = the approval commit time);
 *   2. else the "approve" audit event for the sanction (direct approval), same table.
 *
 * Only rows with status approved/exhausted and approved_by IS NULL are touched; a row is never
 * overwritten (the 0162 trigger also keeps the first values). A sanction with no event left (the
 * outbox was purged) is reported as UNRESOLVED and left NULL: its order then refuses with 422
 * SANCTION_APPROVAL_NOT_RECORDED until an operator records the approver from the paper file.
 *
 * DRY RUN BY DEFAULT. Usage (from services/finance-service; DATABASE_URL = owner/admin role):
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-sanction-approvals.ts [--tenant <uuid> ...]          # report only
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-sanction-approvals.ts --apply [--tenant <uuid> ...]  # write
 * Idempotent: a second --apply finds nothing to do.
 */
import { pathToFileURL } from "node:url";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SanctionApprovalPlan {
  sanctionId: string;
  tenantId: string;
  sanctionNo: string;
  approvedBy: string | null;
  approvedAt: string | null;
  source: "sanction_approved_event" | "approve_audit_event" | "unresolved";
}

export async function planSanctionApprovals(sql: Sql, tenants?: string[]): Promise<SanctionApprovalPlan[]> {
  for (const t of tenants ?? []) if (!UUID_RE.test(t)) throw new Error(`not a tenant uuid: ${t}`);
  const rows = await sql<{ id: string; tenant_id: string; sanction_no: string }[]>`
    SELECT id::text, tenant_id::text, sanction_no FROM budget.finance_sanctions
     WHERE approved_by IS NULL AND status IN ('approved', 'exhausted')
       ${tenants && tenants.length > 0 ? sql`AND tenant_id = ANY(${tenants}::uuid[])` : sql``}
     ORDER BY tenant_id, created_at, id`;
  const plans: SanctionApprovalPlan[] = [];
  for (const r of rows) {
    const [ev] = await sql<{ actor_id: string; created_at: Date }[]>`
      SELECT actor_id::text, created_at FROM _outbox.messages
       WHERE tenant_id = ${r.tenant_id}::uuid AND topic = 'finance.sanction.approved' AND payload->>'sanctionId' = ${r.id}
       ORDER BY created_at ASC LIMIT 1`;
    if (ev) { plans.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: ev.actor_id, approvedAt: ev.created_at.toISOString(), source: "sanction_approved_event" }); continue; }
    const [au] = await sql<{ actor_id: string; created_at: Date }[]>`
      SELECT actor_id::text, created_at FROM _outbox.messages
       WHERE tenant_id = ${r.tenant_id}::uuid AND topic = 'audit.event.record'
         AND payload->>'resourceType' = 'sanction' AND payload->>'resourceId' = ${r.id} AND payload->>'action' = 'approve'
       ORDER BY created_at ASC LIMIT 1`;
    if (au) { plans.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: au.actor_id, approvedAt: au.created_at.toISOString(), source: "approve_audit_event" }); continue; }
    plans.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: null, approvedAt: null, source: "unresolved" });
  }
  return plans;
}

/** Writes the resolved plans; returns how many rows were updated. Never overwrites a set approver. */
export async function applySanctionApprovals(sql: Sql, plans: SanctionApprovalPlan[]): Promise<number> {
  let n = 0;
  for (const p of plans) {
    if (!p.approvedBy || !p.approvedAt) continue;
    const res = await sql`
      UPDATE budget.finance_sanctions SET approved_by = ${p.approvedBy}::uuid, approved_at = ${p.approvedAt}::timestamptz
       WHERE id = ${p.sanctionId}::uuid AND tenant_id = ${p.tenantId}::uuid AND approved_by IS NULL`;
    n += res.count;
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const tenants: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--tenant" && args[i + 1]) tenants.push(args[++i]!);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1 });
  try {
    const plans = await planSanctionApprovals(sql, tenants);
    for (const p of plans) process.stdout.write(`${p.source.padEnd(24)} ${p.tenantId} ${p.sanctionNo} ${p.approvedBy ?? "-"} ${p.approvedAt ?? "-"}\n`);
    const unresolved = plans.filter((p) => p.source === "unresolved").length;
    if (!apply) { process.stdout.write(`DRY RUN: ${plans.length - unresolved} would be filled, ${unresolved} unresolved. Re-run with --apply to write.\n`); return; }
    const n = await applySanctionApprovals(sql, plans);
    process.stdout.write(`APPLIED: ${n} filled, ${unresolved} unresolved.\n`);
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { process.stderr.write(`${(err as Error).message}\n`); process.exit(1); });
}
