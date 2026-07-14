/**
 * Property-based test for exactly-once isolation-changed publishing on
 * onboarding (task 6.6).
 *
 * **Property 4: Isolation-changed event fires exactly once, iff the assigned
 * tier is non-pool**
 * **Validates: Requirements 2.3**
 *
 * For arbitrary editions and arbitrary `TENANT_PLACEMENT_POLICY`-shaped
 * mappings, driving `registerTenantConsumers`' `createTenant` handler against
 * the real Postgres instance (same pattern as `consumer.integration.test.ts`):
 *
 *   - `EVENTS.tenantIsolationChanged` appears in the outbox EXACTLY ONCE when
 *     the resolved tier is `silo` (non-pool).
 *   - `EVENTS.tenantIsolationChanged` NEVER appears in the outbox when the
 *     resolved tier is `pool`.
 *
 * Handlers are invoked inside `runWithTenant(tenantId, …)` via a small
 * capturing `Queue` (rather than `MemoryQueue`, whose `setTimeout`-based
 * delivery breaks out of the AsyncLocalStorage context before the handler
 * runs) so `db.transaction()` sets the `app.tenant_id` GUC exactly as the
 * real worker does via `withTenantConsumer` — required because `tenant.tenants`
 * is under RLS (`NOBYPASSRLS` role): reads/writes outside a tenant-scoped
 * transaction silently affect/return zero rows. Matches the pattern used by
 * meeting-service's `*-consumer.test.ts` suite.
 */
import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { CommandEnvelope, Handler, Queue, QueueDriver } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";
import { EVENTS } from "../src/topics.js";
import { tierFor, type Edition, type PlacementPolicyConfig } from "../src/modules/tenant/placement-policy.js";

const ACTOR = "00000000-bbbb-4000-8000-000000000001";

const EDITIONS: Edition[] = ["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"];
const arbEdition = fc.constantFrom(...EDITIONS);
const arbTier = fc.constantFrom("pool" as const, "silo" as const);

/** See manual-isolation-override.test.ts for the rationale behind this queue shape. */
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

async function wipe(tenantId: string, messageId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
    }),
  );
  await db.delete(processed).where(eq(processed.messageId, messageId));
}

/** Publish a createTenant command through a fresh consumer registration. */
async function publishCreateTenant(payload: Record<string, unknown>, messageId: string): Promise<void> {
  const queue = new CapturingTenantAwareQueue();
  registerTenantConsumers(queue);
  await queue.start();
  await queue.publish("tenant.tenant.create", {
    messageId,
    type: "tenant.tenant.create",
    tenantId: payload.tenantId as string,
    actorId: ACTOR,
    correlationId: `corr-${messageId}`,
    schemaVersion: "1.0",
    payload,
  });
  await queue.stop();
}

describe("Property 4: Isolation-changed event fires exactly once, iff the assigned tier is non-pool", () => {
  const createdTenants: Array<{ tenantId: string; messageId: string }> = [];

  afterAll(async () => {
    for (const { tenantId, messageId } of createdTenants) {
      await wipe(tenantId, messageId);
    }
    await sqlClient.end();
  });

  it("publishes tenant.tenant.isolation_changed to the outbox exactly once iff the resolved tier is silo", async () => {
    await fc.assert(
      fc.asyncProperty(arbEdition, arbTier, async (edition, tier) => {
        const tenantId = randomUUID();
        const messageId = randomUUID();
        createdTenants.push({ tenantId, messageId });

        // Build a policy config that maps exactly this edition to the tier
        // under test, so tierFor deterministically resolves to `tier`.
        const config: PlacementPolicyConfig = { version: "prop-test", mapping: { [edition]: tier } };
        const decision = tierFor(edition, config);
        expect(decision.tier).toBe(tier); // sanity: our fixture config actually resolves as intended

        await publishCreateTenant(
          {
            id: tenantId,
            tenantId,
            name: "Property Test Tenant",
            domain: `prop-${tenantId}.test.example`,
            edition,
            status: "draft",
            region: "ap-south-1",
            residency: "IN",
            isolationTier: decision.tier,
            policyVersion: decision.policyVersion,
            policyReason: decision.reason,
            settings: {},
            version: 0,
          },
          messageId,
        );

        const outboxRows = await runWithTenant(tenantId, () =>
          db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
        );
        const isolationChangedCount = outboxRows.filter((r) => r.eventType === EVENTS.tenantIsolationChanged).length;

        if (tier === "silo") {
          expect(isolationChangedCount).toBe(1);
        } else {
          expect(isolationChangedCount).toBe(0);
        }
      }),
      { numRuns: 8 }, // each run does real DB I/O; keep the count modest
    );
  }, 60_000);
});
