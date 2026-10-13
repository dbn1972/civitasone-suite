/**
 * ST-M01-11 — payroll posting consumer + as-of API, on REAL Postgres.
 *
 * Proves (against civitas_payroll migrated through 0087, as the NON-superuser
 * payroll_svc role so FORCE RLS is genuinely enforced):
 *   1. hrms.posting.changed → one dated posting_history row + one
 *      audit.event.record, in one transaction (house rule 1).
 *   2. The as-of API (GET /v1/payroll/posting-history/:id?asOf=YYYY-MM-DD)
 *      returns the posting effective on/before the date — before and after an
 *      effective date — and the full history without asOf.
 *   3. A redelivery of the same event (same messageId) is idempotent: no
 *      second row, no second audit (markProcessed drops it; the ON CONFLICT
 *      event_id key is the second guard).
 *   4. A non-payroll tenant (not in PAYROLL_POSTING_TENANTS) is a clean
 *      markProcessed-only no-op: nothing written.
 *   5. Staff-only: a citizen token is 403; another tenant cannot read a
 *      tenant's history (RLS + server-context tenant).
 *
 * Requires DATABASE_URL pointing at a disposable Postgres migrated through
 * payroll 0087. The consumer flag is set BEFORE importing the module so the
 * subscription registers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();          // a payroll tenant (allow-listed below)
const OTHER_TENANT = randomUUID();    // another payroll tenant, for RLS isolation
const NON_PAYROLL_TENANT = randomUUID(); // NOT in the allow-list → consumer no-op
const EMP = randomUUID();
const ACTOR = randomUUID();

// Enable the consumer and restrict it to the two payroll tenants, BEFORE import.
process.env.PAYROLL_POSTING_CONSUMER_ENABLED = "true";
process.env.PAYROLL_POSTING_TENANTS = `${TENANT},${OTHER_TENANT}`;

const POSTING_CHANGED = "hrms.posting.changed";

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerPostingConsumers } = await import("../src/modules/posting-history/consumer.js");
const { buildApp } = await import("../src/app.js");

// Mirror worker.ts: every consumer runs inside runWithTenant(msg.tenantId) so
// the RLS GUC is set for the guarded write.
{
  type H = (m: { tenantId: string }) => Promise<void>;
  const q = queue as unknown as { subscribe: (topic: string, h: H) => void };
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic: string, h: H) =>
    raw(topic, (m) => runWithTenant(m.tenantId, () => h(m)) as Promise<void>);
}
registerPostingConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

function token(roles: string[], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s1" }, SECRET);
}

type TxRunner = { execute: (q: unknown) => Promise<unknown> };
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

async function historyRows(tenantId: string, employeeId: string): Promise<Array<Record<string, unknown>>> {
  return runWithTenant(tenantId, async () =>
    rowsOf(
      await (db as unknown as { transaction: (f: (tx: TxRunner) => Promise<unknown>) => Promise<unknown> }).transaction(
        (tx) =>
          tx.execute(sql`
            SELECT order_number, station, state, city_class, ddo, effective_from::text AS effective_from, event_id
            FROM payroll.posting_history
            WHERE tenant_id = ${tenantId}::uuid AND employee_id = ${employeeId}::uuid
            ORDER BY effective_from`),
      ),
    ),
  ) as Promise<Array<Record<string, unknown>>>;
}

async function auditCount(tenantId: string): Promise<number> {
  // audit.event.record rides the outbox (_outbox.messages). Count unpublished
  // posting_history_record events for this tenant.
  const [row] = await sqlClient`
    SELECT count(*)::int AS c FROM _outbox.messages
    WHERE tenant_id = ${tenantId}::uuid AND topic = 'audit.event.record'
      AND payload->>'action' = 'posting_history_record'`;
  return (row as { c: number })?.c ?? 0;
}

/** Deliver a hrms.posting.changed event through the shared queue, then drain. */
async function deliver(
  tenantId: string,
  opts: { messageId: string; effectiveFrom: string; orderNumber: string; ddo?: string; cityClass?: string },
): Promise<void> {
  await queue.publish(POSTING_CHANGED, {
    messageId: opts.messageId,
    type: POSTING_CHANGED,
    tenantId,
    actorId: ACTOR,
    correlationId: `corr-${opts.messageId}`,
    schemaVersion: "1.0",
    payload: {
      employeeId: EMP,
      tenantId,
      fromOfficeId: "00000000-0000-0000-0000-0000000000f0",
      toOfficeId: "00000000-0000-0000-0000-0000000000f1",
      station: "Pune",
      state: "MH",
      cityClass: opts.cityClass ?? "Y",
      ...(opts.ddo ? { ddo: opts.ddo } : {}),
      effectiveFrom: opts.effectiveFrom,
      orderNumber: opts.orderNumber,
    },
  } as never);
  await drain();
}

let app: FastifyInstance;

beforeAll(async () => {
  await queue.start();
  app = await buildApp();
  await app.ready();
  // Clean any residue for the isolated tenants under test.
  await sqlClient`DELETE FROM payroll.posting_history WHERE tenant_id = ANY(${[TENANT, OTHER_TENANT, NON_PAYROLL_TENANT]}::uuid[])`;
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ANY(${[TENANT, OTHER_TENANT, NON_PAYROLL_TENANT]}::uuid[])`;
});

afterAll(async () => {
  await app?.close();
  await queue.stop();
  await sqlClient`DELETE FROM payroll.posting_history WHERE tenant_id = ANY(${[TENANT, OTHER_TENANT, NON_PAYROLL_TENANT]}::uuid[])`;
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ANY(${[TENANT, OTHER_TENANT, NON_PAYROLL_TENANT]}::uuid[])`;
  await sqlClient.end({ timeout: 5 });
});

describe("ST-M01-11 posting consumer (real Postgres)", () => {
  it("writes a dated posting_history row + one audit event, in one tx", async () => {
    await deliver(TENANT, { messageId: randomUUID(), effectiveFrom: "2026-01-01", orderNumber: "ORD-1", ddo: randomUUID() });
    const rows = await historyRows(TENANT, EMP);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ order_number: "ORD-1", station: "Pune", state: "MH", city_class: "Y", effective_from: "2026-01-01" });
    expect(rows[0]!.ddo).not.toBeNull();
    expect(await auditCount(TENANT)).toBe(1);
  });

  it("records a second posting; as-of returns the posting effective on/before the date", async () => {
    await deliver(TENANT, { messageId: randomUUID(), effectiveFrom: "2026-06-01", orderNumber: "ORD-2", cityClass: "X" });
    expect(await historyRows(TENANT, EMP)).toHaveLength(2);

    const before = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}?asOf=2026-03-01`,
      headers: { authorization: `Bearer ${token(["payroll_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.orderNumber).toBe("ORD-1");

    const after = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}?asOf=2026-07-01`,
      headers: { authorization: `Bearer ${token(["payroll_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.orderNumber).toBe("ORD-2");

    // No asOf → full history, most recent first.
    const all = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}`,
      headers: { authorization: `Bearer ${token(["payroll_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((r: { orderNumber: string }) => r.orderNumber)).toEqual(["ORD-2", "ORD-1"]);
  });

  it("404s an as-of before the earliest posting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}?asOf=2025-01-01`,
      headers: { authorization: `Bearer ${token(["payroll_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error?.code ?? res.json().code).toBe("POSTING_NOT_FOUND");
  });

  it("400s impossible calendar dates in asOf (not 500)", async () => {
    for (const bad of ["2026-02-30", "2026-02-31", "2026-04-31", "2026-13-01"]) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/payroll/posting-history/${EMP}?asOf=${bad}`,
        headers: { authorization: `Bearer ${token(["payroll_officer"])}`, "x-tenant-id": TENANT },
      });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it("is idempotent on a redelivered event (same messageId): no new row, no new audit", async () => {
    const mid = randomUUID();
    await deliver(TENANT, { messageId: mid, effectiveFrom: "2026-09-01", orderNumber: "ORD-3" });
    const afterFirst = (await historyRows(TENANT, EMP)).length;
    const auditFirst = await auditCount(TENANT);
    await deliver(TENANT, { messageId: mid, effectiveFrom: "2026-09-01", orderNumber: "ORD-3" }); // redelivery
    expect((await historyRows(TENANT, EMP)).length).toBe(afterFirst);
    expect(await auditCount(TENANT)).toBe(auditFirst);
  });

  it("no-ops for a non-payroll tenant (markProcessed only, nothing written)", async () => {
    await deliver(NON_PAYROLL_TENANT, { messageId: randomUUID(), effectiveFrom: "2026-01-01", orderNumber: "ORD-NP" });
    expect(await historyRows(NON_PAYROLL_TENANT, EMP)).toHaveLength(0);
    expect(await auditCount(NON_PAYROLL_TENANT)).toBe(0);
  });

  it("staff-only: citizen is 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}?asOf=2026-07-01`,
      headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(403);
  });

  it("RLS: another tenant cannot read this tenant's history (empty)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/posting-history/${EMP}`,
      headers: { authorization: `Bearer ${token(["payroll_officer"], OTHER_TENANT)}`, "x-tenant-id": OTHER_TENANT },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});
