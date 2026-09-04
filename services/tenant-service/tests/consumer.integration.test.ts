/**
 * Integration tests for registerTenantConsumers against a real Postgres instance.
 * Requires DATABASE_URL set (injected via vitest.config.ts for local dev).
 * Queue driver is "memory" — no SQS/LocalStack required for these tests.
 *
 * Test 1 — happy path: tenant.tenant.create writes to tenant.tenants via the
 *   transactional outbox, primes _inbox.processed, and queues domain + audit events.
 *
 * Test 2 — idempotency: a second delivery of the same messageId (via a fresh
 *   MemoryQueue instance, bypassing queue-level dedup) is stopped by _inbox.processed,
 *   leaving exactly one row in tenant.tenants.
 *
 * Test 3 — quotas pre-accept validation: tenant.tenant_quota.upsert for a tenantId
 *   that doesn't exist is rejected (retried, then DLQ'd), not silently applied as an
 *   orphan tenant.tenant_quotas row. See consumer.ts's tenantQuotaUpsert handler.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants, tenantQuotas } from "../src/modules/tenant/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";
import { COMMANDS } from "../src/topics.js";

// RLS on tenant.tenants/tenant.tenant_quotas/_outbox.messages/_inbox.processed enforces
// `tenant_id = current_tenant_id()`. Bare db.select()/db.delete() outside a tenant-scoped
// transaction see zero rows (fail-closed), so every read/write in this suite runs inside
// runWithTenant() + db.transaction(), matching the consumer's own GUC-injection pattern
// (packages/db/src/wrap-tenant-db.ts).
async function tenantSelect<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => fn(tx as typeof db)));
}

// Fixed UUIDs scoped to this suite — cleaned up in beforeAll / afterAll.
const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const T1_ID   = "11111111-aaaa-4000-8000-000000000001";
const T2_ID   = "22222222-aaaa-4000-8000-000000000002";
const MSG_1   = "aaaaaaaa-1111-4000-8000-000000000001";
const MSG_2   = "bbbbbbbb-2222-4000-8000-000000000002";
// A tenantId that is never created in this suite — used to prove the quotas
// consumer rejects writes for tenants that don't exist.
const GHOST_TENANT_ID = "99999999-aaaa-4000-8000-000000000009";
const MSG_3            = "cccccccc-3333-4000-8000-000000000003";
// Dedicated row for the tenants_status_check CHECK-constraint test (0024).
const CHECK_TENANT_ID = "88888888-aaaa-4000-8000-000000000008";

function payload(tenantId: string, domain: string) {
  return {
    id: tenantId,
    tenantId,
    name: "Integration Test Tenant",
    domain,
    edition: "govt" as const,
    status: "draft" as const,
    region: "ap-south-1",
    residency: "IN",
    settings: {} as Record<string, unknown>,
    version: 0,
  };
}

async function wipe(tenantId: string, messageId: string) {
  await tenantSelect(tenantId, async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
    await tx.delete(tenantQuotas).where(eq(tenantQuotas.tenantId, tenantId));
    await tx.delete(processed).where(eq(processed.messageId, messageId));
  });
}

describe("tenant consumer — integration (real Postgres)", () => {
  beforeAll(async () => {
    await wipe(T1_ID, MSG_1);
    await wipe(T2_ID, MSG_2);
    await wipe(GHOST_TENANT_ID, MSG_3);
    await wipe(CHECK_TENANT_ID, CHECK_TENANT_ID);
  });

  afterAll(async () => {
    await wipe(T1_ID, MSG_1);
    await wipe(T2_ID, MSG_2);
    await wipe(GHOST_TENANT_ID, MSG_3);
    await wipe(CHECK_TENANT_ID, CHECK_TENANT_ID);
    await sqlClient.end();
  });

  it("happy path: inserts tenant row, writes _inbox.processed, and enqueues outbox events", async () => {
    const queue = new MemoryQueue();
    registerTenantConsumers(queue);
    await queue.start();

    await queue.publish("tenant.tenant.create", {
      messageId: MSG_1,
      type: "tenant.tenant.create",
      tenantId: T1_ID,
      actorId: ACTOR,
      correlationId: "corr-integ-1",
      schemaVersion: "1.0",
      payload: payload(T1_ID, "integ-happy.test.example"),
    });

    // MemoryQueue delivers on next tick; allow the full DB transaction to settle.
    await new Promise<void>((r) => setTimeout(r, 500));
    await queue.stop();

    const rows = await tenantSelect(T1_ID, (tx) => tx.select().from(tenants).where(eq(tenants.id, T1_ID)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Integration Test Tenant");
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.edition).toBe("govt");
    expect(rows[0]?.createdBy).toBe(ACTOR);

    // _inbox.processed must record the messageId so future duplicates are skipped.
    // (No RLS on _inbox.processed — bare read is fine.)
    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_1));
    expect(seen).toHaveLength(1);

    // Outbox must have the domain event + the mandatory audit event (CLAUDE.md §3.8).
    const outbox = await tenantSelect(T1_ID, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID)));
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain("tenant.tenant.created");
    expect(eventTypes).toContain("audit.event.record");
  });

  it("duplicate messageId: second delivery is a no-op (proven via _inbox.processed, not queue dedup)", async () => {
    // First delivery: creates row + marks _inbox.processed.
    const q1 = new MemoryQueue();
    registerTenantConsumers(q1);
    await q1.start();

    await q1.publish("tenant.tenant.create", {
      messageId: MSG_2,
      type: "tenant.tenant.create",
      tenantId: T2_ID,
      actorId: ACTOR,
      correlationId: "corr-integ-2a",
      schemaVersion: "1.0",
      payload: payload(T2_ID, "integ-dedup.test.example"),
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q1.stop();

    const after1 = await tenantSelect(T2_ID, (tx) => tx.select().from(tenants).where(eq(tenants.id, T2_ID)));
    expect(after1).toHaveLength(1);

    // Second delivery via a FRESH MemoryQueue — bypasses queue-level dedup (its `seen` set
    // is brand-new) so the handler is invoked again. The consumer must reject it via
    // _inbox.processed (markProcessed returns false → transaction returns without inserting).
    const q2 = new MemoryQueue();
    registerTenantConsumers(q2);
    await q2.start();

    await q2.publish("tenant.tenant.create", {
      messageId: MSG_2, // same messageId as first delivery
      type: "tenant.tenant.create",
      tenantId: T2_ID,
      actorId: ACTOR,
      correlationId: "corr-integ-2b",
      schemaVersion: "1.0",
      payload: payload(T2_ID, "integ-dedup.test.example"),
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q2.stop();

    // Still exactly one row — INSERT was not repeated.
    const after2 = await tenantSelect(T2_ID, (tx) => tx.select().from(tenants).where(eq(tenants.id, T2_ID)));
    expect(after2).toHaveLength(1);

    // Exactly one _inbox.processed entry (primary-key conflict would be the guard,
    // but markProcessed does a SELECT-then-INSERT so we prove it stayed at one).
    // (No RLS on _inbox.processed — bare read is fine.)
    const inboxRows = await db.select().from(processed).where(eq(processed.messageId, MSG_2));
    expect(inboxRows).toHaveLength(1);
  });

  it("tenantQuotaUpsert for a nonexistent tenant is rejected (DLQ), not silently applied as an orphan row", async () => {
    const queue = new MemoryQueue();
    registerTenantConsumers(queue);
    await queue.start();

    await queue.publish(COMMANDS.tenantQuotaUpsert, {
      messageId: MSG_3,
      type: COMMANDS.tenantQuotaUpsert,
      tenantId: GHOST_TENANT_ID,
      actorId: ACTOR,
      correlationId: "corr-integ-ghost-quota",
      schemaVersion: "1.0",
      payload: { id: MSG_3, tenantId: GHOST_TENANT_ID, maxEmployees: 1000 },
    });

    // drain() (MemoryQueue-only — see bus.ts) awaits every in-flight delivery
    // including retry backoffs, so this is deterministic unlike a fixed sleep.
    await queue.drain();
    await queue.stop();

    // No orphan tenant.tenant_quotas row for a tenant that was never created.
    const rows = await tenantSelect(GHOST_TENANT_ID, (tx) =>
      tx.select().from(tenantQuotas).where(eq(tenantQuotas.tenantId, GHOST_TENANT_ID)),
    );
    expect(rows).toHaveLength(0);

    // _inbox.processed was never durably marked — the whole transaction (including
    // markProcessed) rolled back when the existence check threw, so a corrected
    // retry of the same messageId could still succeed later.
    const inboxRows = await db.select().from(processed).where(eq(processed.messageId, MSG_3));
    expect(inboxRows).toHaveLength(0);

    // The rejection is loud (DLQ'd after retries), not a silent no-op.
    expect(
      queue.dlq.some((d) => d.topic === COMMANDS.tenantQuotaUpsert && d.msg.messageId === MSG_3),
    ).toBe(true);
  }, 15_000);

  it("tenants_status_check (migration 0024) allows the full six-state domain machine, not just draft/active/suspended", async () => {
    await tenantSelect(CHECK_TENANT_ID, (tx) =>
      tx.insert(tenants).values({
        id: CHECK_TENANT_ID,
        tenantId: CHECK_TENANT_ID,
        name: "CHECK Constraint Test Tenant",
        domain: `check-constraint-${CHECK_TENANT_ID}.test.example`,
        edition: "govt",
        status: "draft",
        region: "ap-south-1",
        residency: "IN",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );

    // Every domain-legal non-initial status (domain.ts's ALLOWED transitions) must
    // round-trip through the DB — before 0024, 'restricted'/'offboarding'/'archived'
    // all violated tenants_status_check even though canTransition() approved them.
    for (const status of ["restricted", "offboarding", "archived"] as const) {
      await tenantSelect(CHECK_TENANT_ID, (tx) =>
        tx.update(tenants).set({ status }).where(eq(tenants.id, CHECK_TENANT_ID)),
      );
      const [row] = await tenantSelect(CHECK_TENANT_ID, (tx) =>
        tx.select().from(tenants).where(eq(tenants.id, CHECK_TENANT_ID)),
      );
      expect(row?.status).toBe(status);
    }

    // The stale pre-rename value must now be rejected — proves it was actually
    // removed from the constraint, not just supplemented alongside the real ones.
    await expect(
      tenantSelect(CHECK_TENANT_ID, (tx) =>
        tx.update(tenants).set({ status: "decommissioned" }).where(eq(tenants.id, CHECK_TENANT_ID)),
      ),
    ).rejects.toThrow(/tenants_status_check/);
  }, 15_000);
});
