/**
 * UAT B24 group 3 (audit trail latency): the hash-chain append reads the tenant's latest event
 * (findLatestForTenantTx: WHERE tenant_id = ? ORDER BY occurred_at DESC LIMIT 1) once per ingested
 * event, under a per-tenant advisory lock. Only (tenant_id, event_at) was indexed, so on a busy
 * tenant that read bitmap-scanned and top-N-sorted every row the tenant had (33 ms at 26k rows on
 * the UAT host, growing linearly). Migration 0037 adds (tenant_id, occurred_at DESC).
 *
 * Real Postgres as the non-superuser audit_svc role (FORCE RLS in force), seeds written under the
 * tenant context. CI bootstraps it; locally run scripts/ci/bootstrap-postgres.sh against your own
 * disposable Postgres.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DSN = process.env["DATABASE_URL"] ?? "";
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1 FROM pg_indexes WHERE schemaname = 'events' AND tablename = 'events' LIMIT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = DSN !== "" && (await probe());
if (!reachable) throw new Error(`audit-latest-index: Postgres not reachable (DATABASE_URL=${DSN === "" ? "unset" : DSN.replace(/:[^:@/]+@/, ":***@")}); CI bootstraps it, locally run scripts/ci/bootstrap-postgres.sh`);

const { db, sqlClient } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const repo = await import("../src/modules/events/repo.js");
const { sql } = await import("drizzle-orm");

const ACTOR = randomUUID();
const SEED_ROWS = 20_000;
const tenantId = randomUUID();

async function seedHistory(): Promise<void> {
  await Promise.resolve(runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO events.events (id, tenant_id, type, actor, payload, occurred_at, created_by)
      SELECT gen_random_uuid(), ${tenantId}::uuid, 'audit.event.record',
             jsonb_build_object('actorId', ${ACTOR}::text),
             jsonb_build_object('service', 'finance', 'resourceType', 'journal_voucher'),
             now() - make_interval(secs => g), ${ACTOR}::uuid
      FROM generate_series(1, ${SEED_ROWS}) g`);
  })));
}

describe("audit hash-chain: latest-event read", () => {
  afterAll(async () => { await sqlClient.end({ timeout: 2 }).catch(() => undefined); });

  it("has a (tenant_id, occurred_at) index on the events table", async () => {
    const rows = await sqlClient<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'events' AND tablename = 'events'`;
    expect(rows.some((r) => /\(tenant_id, occurred_at/.test(r.indexdef))).toBe(true);
  });

  it("reads the newest event for a tenant with a deep history without sorting all of it", async () => {
    await seedHistory();
    const plan = await Promise.resolve(runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`
        EXPLAIN SELECT * FROM events.events WHERE tenant_id = ${tenantId}::uuid
        ORDER BY occurred_at DESC LIMIT 1`);
      return (r as unknown as Array<Record<string, string>>).map((x) => x["QUERY PLAN"]).join("\n");
    })));
    // With the index the partitions are merged in index order: no Sort node over an Append.
    expect(plan).not.toMatch(/(->\s+|^)Sort\s+\(/m);
    expect(plan).toMatch(/Merge Append|Index Scan/);

    const t0 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) {
      await Promise.resolve(runWithTenant(tenantId, () => db.transaction((tx) => repo.findLatestForTenantTx(tx, tenantId))));
    }
    const perRead = (performance.now() - t0) / N;
    // eslint-disable-next-line no-console
    console.log(`findLatestForTenantTx over ${SEED_ROWS} rows: ${perRead.toFixed(2)} ms/read, ${(1000 / perRead).toFixed(0)} reads/s`);
    expect(perRead).toBeLessThan(15);
  });
});
