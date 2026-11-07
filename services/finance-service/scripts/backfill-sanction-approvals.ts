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
 * Tenant scoping: budget.finance_sanctions is FORCE ROW LEVEL SECURITY (policy on app.tenant_id), so every read and
 * write here runs per tenant inside its own transaction that first sets the tenant GUC with
 * set_config('app.tenant_id', <tenant>, true) (transaction-local, never a session SET: pgbouncer transaction
 * pooling), the same pattern as scripts/backfill-standard-gl-heads.ts. It therefore also works under the
 * RLS-enforced finance_svc role -- but with that role tenant DISCOVERY (no --tenant) sees no rows, so pass --tenant
 * explicitly, or run discovery with the owner/admin role.
 *
 * DRY RUN BY DEFAULT. Usage (from services/finance-service):
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

/** Run `fn` in a transaction scoped to one tenant (transaction-local GUC, so RLS applies exactly as in the service). */
function inTenant<T>(sql: Sql, tenantId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * Tenants that have an approved/exhausted sanction with no approver. Without an explicit list this is a plain
 * query: it sees every tenant only as the owner/admin role (under RLS-enforced finance_svc it returns none).
 */
async function tenantsToScan(sql: Sql, tenants?: string[]): Promise<string[]> {
  if (tenants && tenants.length > 0) return [...new Set(tenants)];
  const rows = await sql<{ tenant_id: string }[]>`
    SELECT DISTINCT tenant_id::text AS tenant_id FROM budget.finance_sanctions
     WHERE approved_by IS NULL AND status IN ('approved', 'exhausted') ORDER BY 1`;
  return rows.map((r) => r.tenant_id);
}

export async function planSanctionApprovals(sql: Sql, tenants?: string[]): Promise<SanctionApprovalPlan[]> {
  for (const t of tenants ?? []) if (!UUID_RE.test(t)) throw new Error(`not a tenant uuid: ${t}`);
  const plans: SanctionApprovalPlan[] = [];
  for (const tenantId of await tenantsToScan(sql, tenants)) {
    plans.push(...await inTenant(sql, tenantId, async (tx) => {
      const out: SanctionApprovalPlan[] = [];
      const rows = await tx<{ id: string; tenant_id: string; sanction_no: string }[]>`
        SELECT id::text, tenant_id::text, sanction_no FROM budget.finance_sanctions
         WHERE tenant_id = ${tenantId}::uuid AND approved_by IS NULL AND status IN ('approved', 'exhausted')
         ORDER BY created_at, id`;
      for (const r of rows) {
        const [ev] = await tx<{ actor_id: string; created_at: Date }[]>`
          SELECT actor_id::text, created_at FROM _outbox.messages
           WHERE tenant_id = ${r.tenant_id}::uuid AND topic = 'finance.sanction.approved' AND payload->>'sanctionId' = ${r.id}
           ORDER BY created_at ASC LIMIT 1`;
        if (ev) { out.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: ev.actor_id, approvedAt: ev.created_at.toISOString(), source: "sanction_approved_event" }); continue; }
        const [au] = await tx<{ actor_id: string; created_at: Date }[]>`
          SELECT actor_id::text, created_at FROM _outbox.messages
           WHERE tenant_id = ${r.tenant_id}::uuid AND topic = 'audit.event.record'
             AND payload->>'resourceType' = 'sanction' AND payload->>'resourceId' = ${r.id} AND payload->>'action' = 'approve'
           ORDER BY created_at ASC LIMIT 1`;
        if (au) { out.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: au.actor_id, approvedAt: au.created_at.toISOString(), source: "approve_audit_event" }); continue; }
        out.push({ sanctionId: r.id, tenantId: r.tenant_id, sanctionNo: r.sanction_no, approvedBy: null, approvedAt: null, source: "unresolved" });
      }
      return out;
    }));
  }
  return plans;
}

/** Writes the resolved plans, one transaction per tenant; returns how many rows were updated. Never overwrites a set approver. */
export async function applySanctionApprovals(sql: Sql, plans: SanctionApprovalPlan[]): Promise<number> {
  const byTenant = new Map<string, SanctionApprovalPlan[]>();
  for (const p of plans) {
    if (!p.approvedBy || !p.approvedAt) continue;
    if (!UUID_RE.test(p.tenantId)) throw new Error(`not a tenant uuid: ${p.tenantId}`);
    byTenant.set(p.tenantId, [...(byTenant.get(p.tenantId) ?? []), p]);
  }
  let n = 0;
  for (const [tenantId, list] of byTenant) {
    n += await inTenant(sql, tenantId, async (tx) => {
      let c = 0;
      for (const p of list) {
        const res = await tx`
          UPDATE budget.finance_sanctions SET approved_by = ${p.approvedBy}::uuid, approved_at = ${p.approvedAt}::timestamptz
           WHERE id = ${p.sanctionId}::uuid AND tenant_id = ${tenantId}::uuid AND approved_by IS NULL`;
        c += res.count;
      }
      return c;
    });
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
