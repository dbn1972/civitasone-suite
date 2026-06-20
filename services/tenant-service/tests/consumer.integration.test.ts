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
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";

// Fixed UUIDs scoped to this suite — cleaned up in beforeAll / afterAll.
const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const T1_ID   = "11111111-aaaa-4000-8000-000000000001";
const T2_ID   = "22222222-aaaa-4000-8000-000000000002";
const MSG_1   = "aaaaaaaa-1111-4000-8000-000000000001";
const MSG_2   = "bbbbbbbb-2222-4000-8000-000000000002";

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
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await db.delete(processed).where(eq(processed.messageId, messageId));
}

describe("tenant consumer — integration (real Postgres)", () => {
  beforeAll(async () => {
    await wipe(T1_ID, MSG_1);
    await wipe(T2_ID, MSG_2);
  });

  afterAll(async () => {
    await wipe(T1_ID, MSG_1);
    await wipe(T2_ID, MSG_2);
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

    const rows = await db.select().from(tenants).where(eq(tenants.id, T1_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Integration Test Tenant");
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.edition).toBe("govt");
    expect(rows[0]?.createdBy).toBe(ACTOR);

    // _inbox.processed must record the messageId so future duplicates are skipped.
    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_1));
    expect(seen).toHaveLength(1);

    // Outbox must have the domain event + the mandatory audit event (CLAUDE.md §3.8).
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
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

    const after1 = await db.select().from(tenants).where(eq(tenants.id, T2_ID));
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
    const after2 = await db.select().from(tenants).where(eq(tenants.id, T2_ID));
    expect(after2).toHaveLength(1);

    // Exactly one _inbox.processed entry (primary-key conflict would be the guard,
    // but markProcessed does a SELECT-then-INSERT so we prove it stayed at one).
    const inboxRows = await db.select().from(processed).where(eq(processed.messageId, MSG_2));
    expect(inboxRows).toHaveLength(1);
  });
});
