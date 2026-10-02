/**
 * GAP-FINANCE-FISCAL-YEARS-01/-02 (review D2): fiscal-year create/activate
 * are serialised per tenant (pg_advisory_xact_lock in masters/consumer.ts),
 * so under genuine concurrency (real Postgres, Promise.all):
 *  - two overlapping creates with DIFFERENT codes leave exactly one row;
 *  - two activates of different years leave exactly one active year.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "70000000-0ba1-4000-8000-00000000f001";

/** Same tenant-GUC wrap as worker.ts / masters-opening-balance-race.test.ts. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

const msg = (tenantId: string, type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

async function years(tenantId: string): Promise<Array<{ code: string; status: string }>> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.execute(
    sql`SELECT code, status FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid ORDER BY code`,
  )));
  return (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Array<{ code: string; status: string }>;
}

afterAll(async () => { await sqlClient.end(); });

describe("fiscal-year writes under concurrency (real DB)", () => {
  it("concurrent overlapping creates with different codes leave exactly one row", async () => {
    const tenant = randomUUID();
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();
    // Several overlapping years with distinct codes (so the UNIQUE(tenant,
    // code) constraint cannot be what saves us) published at once: only the
    // per-tenant advisory lock + in-tx overlap re-check keeps this to one row.
    const creates = Array.from({ length: 6 }, (_, i) => ({
      id: randomUUID(), tenantId: tenant, code: `2031-${String(40 + i)}`, label: `Race ${i}`,
      startDate: `2031-0${4 + (i % 5)}-01`, endDate: "2032-03-31", reason: `race create ${i}`,
    }));
    await Promise.all(creates.map((p) => q.publish(COMMANDS.fiscalYearCreate, msg(tenant, COMMANDS.fiscalYearCreate, p))));
    await q.drain();
    const rows = await years(tenant);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(q.dlq.length).toBe(creates.length - 1);
  });

  it("two concurrent activates leave exactly one active year", async () => {
    const tenant = randomUUID();
    await runWithTenant(tenant, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by) VALUES
        (gen_random_uuid(), ${tenant}::uuid, '2028-29', 'X', '2028-04-01', '2029-03-31', 'active', ${ACTOR}::uuid),
        (gen_random_uuid(), ${tenant}::uuid, '2029-30', 'Y', '2029-04-01', '2030-03-31', 'closed', ${ACTOR}::uuid),
        (gen_random_uuid(), ${tenant}::uuid, '2030-31', 'Z', '2030-04-01', '2031-03-31', 'closed', ${ACTOR}::uuid)`)));
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();
    await Promise.all([
      q.publish(COMMANDS.fiscalYearActivate, msg(tenant, COMMANDS.fiscalYearActivate, { id: randomUUID(), tenantId: tenant, code: "2029-30", reason: "race activate Y" })),
      q.publish(COMMANDS.fiscalYearActivate, msg(tenant, COMMANDS.fiscalYearActivate, { id: randomUUID(), tenantId: tenant, code: "2030-31", reason: "race activate Z" })),
    ]);
    await q.drain();
    const active = (await years(tenant)).filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(["2029-30", "2030-31"]).toContain(active[0].code);
  });
});
