/**
 * Unit tests for the provisioning consumer wiring (task 7.8, part 1/2).
 *
 * Covers: requested-record-creation idempotency (no duplicate on re-delivery)
 * for `registerProvisioningConsumers`'s `tenant.tenant.isolation_changed`
 * (tier=silo) handler.
 *
 * Validates: Requirements 3.1, 3.5, 4.4 (idempotency portion)
 *
 * Handlers are invoked inside `runWithTenant(tenantId, …)` via a small
 * capturing `Queue` (mirrors `services/tenant-service/tests/
 * manual-isolation-override.test.ts`) so `db.transaction()` sets the
 * `app.tenant_id` GUC exactly as the real worker does via `withTenantConsumer`
 * — required because `install.silo_provisions` is under RLS (`NOBYPASSRLS`
 * role): reads/writes outside a tenant-scoped transaction silently
 * affect/return zero rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import type { CommandEnvelope, Handler, Queue, QueueDriver } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { siloProvisions } from "../src/modules/provisioning/schema.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const ACTOR = "00000000-dddd-4000-8000-000000000001";

class CapturingTenantAwareQueue implements Queue {
  private handlers = new Map<string, Handler[]>();

  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async publish<T>(topic: string, input: { messageId: string } & Partial<CommandEnvelope<T>>): Promise<string> {
    const msg = input as CommandEnvelope<T>;
    const list = this.handlers.get(topic) ?? [];
    for (const handler of list) {
      await runWithTenant(msg.tenantId, () => handler(msg));
    }
    return msg.messageId;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> {
    return { healthy: true, driver: "memory" };
  }
}

async function wipe(tenantId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.delete(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
  );
}

describe("registerProvisioningConsumers — requested-record-creation idempotency", () => {
  const createdTenants: string[] = [];

  afterAll(async () => {
    for (const tenantId of createdTenants) await wipe(tenantId);
    await sqlClient.end();
  });

  it("creates exactly one requested record for tenant.tenant.isolation_changed (tier=silo), even on redelivery with a fresh queue instance", async () => {
    const tenantId = randomUUID();
    createdTenants.push(tenantId);

    async function deliverIsolationChanged(messageId: string): Promise<void> {
      const queue = new CapturingTenantAwareQueue();
      registerProvisioningConsumers(queue);
      await queue.start();
      await queue.publish(CONSUMED_EVENTS.tenantIsolationChanged, {
        messageId,
        type: CONSUMED_EVENTS.tenantIsolationChanged,
        tenantId,
        actorId: ACTOR,
        correlationId: `corr-${messageId}`,
        schemaVersion: "1.0",
        payload: { tenantId, tier: "silo" },
      });
      await queue.stop();
    }

    // First delivery creates the requested record.
    await deliverIsolationChanged(randomUUID());
    const afterFirst = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
    );
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.status).toBe("requested");

    // Redelivery via a FRESH queue instance (bypasses queue-level dedup, exactly
    // like MemoryQueue's own dedup-bypass test in tenant-service) with a
    // DIFFERENT messageId (simulating the event being re-published, not just
    // redelivered) — the consumer's own `existing = findByTenantTx` check
    // (not `markProcessed`) is what must prevent a duplicate `requested` row.
    await deliverIsolationChanged(randomUUID());
    const afterSecond = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
    );
    expect(afterSecond).toHaveLength(1); // still exactly one — no duplicate
  });

  it("does nothing for tier=pool (nothing to provision)", async () => {
    const tenantId = randomUUID();
    createdTenants.push(tenantId);

    const queue = new CapturingTenantAwareQueue();
    registerProvisioningConsumers(queue);
    await queue.start();
    await queue.publish(CONSUMED_EVENTS.tenantIsolationChanged, {
      messageId: randomUUID(),
      type: CONSUMED_EVENTS.tenantIsolationChanged,
      tenantId,
      actorId: ACTOR,
      correlationId: "corr-pool",
      schemaVersion: "1.0",
      payload: { tenantId, tier: "pool" },
    });
    await queue.stop();

    const rows = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
    );
    expect(rows).toHaveLength(0);
  });
});
