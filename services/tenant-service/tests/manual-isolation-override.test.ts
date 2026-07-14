/**
 * Unit test for manual isolation-override precedence (task 6.7).
 *
 * Onboards a tenant that resolves to a policy-derived `silo` tier, then
 * applies a manual `PATCH .../isolation`-equivalent (the `setIsolation`
 * command, exactly what that route publishes) downgrading it to `pool`.
 * Asserts the manual value wins and is never reverted by re-running the
 * placement policy (i.e. `createTenant` is never re-published for an
 * existing tenant in production — this test proves the persisted state
 * after the override reflects the manual value, matching Requirement 2.4:
 * "Manual PATCH .../isolation (setIsolation) remains untouched and
 * continues to take precedence as a last-write-wins override").
 *
 * Uses the real Postgres instance (same pattern as consumer.integration.test.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import type { CommandEnvelope, Handler, Queue, QueueDriver } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { tierFor } from "../src/modules/tenant/placement-policy.js";

const ACTOR = "00000000-cccc-4000-8000-000000000001";
const TENANT_ID = "44444444-cccc-4000-8000-000000000004";
const CREATE_MSG_ID = "55555555-cccc-4000-8000-000000000005";
const OVERRIDE_MSG_ID = "66666666-cccc-4000-8000-000000000006";

/**
 * A minimal `Queue` that captures subscribed handlers and invokes them
 * directly (inside `runWithTenant`, mirroring the `withTenantConsumer` wiring
 * the real worker applies) rather than going through `MemoryQueue`'s
 * `setTimeout`-based delivery, which breaks out of the AsyncLocalStorage
 * context before the handler runs. Matches the pattern used by
 * meeting-service's `*-consumer.test.ts` suite.
 */
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
      // Surface handler errors directly (no DLQ/retry swallowing) so test
      // failures point at the real cause.
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

/**
 * Cleanup must run inside the tenant's own RLS context (or bypass), otherwise
 * the DELETEs against `tenant.tenants`/`_outbox.messages` silently affect zero
 * rows under NOBYPASSRLS and leftover rows from a prior failed run collide
 * with this run's fixed TENANT_ID on the next attempt.
 */
async function wipe() {
  await runWithTenant(TENANT_ID, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_ID));
      await tx.delete(tenants).where(eq(tenants.id, TENANT_ID));
    }),
  );
  await db.delete(processed).where(eq(processed.messageId, CREATE_MSG_ID));
  await db.delete(processed).where(eq(processed.messageId, OVERRIDE_MSG_ID));
}

describe("manual isolation override takes precedence over the policy-derived tier", () => {
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("onboards to policy-derived silo, then a manual setIsolation to pool wins and persists", async () => {
    await wipe();

    // ── Step 1: onboard with a policy config that resolves `govt` -> silo ──
    const decision = tierFor("govt", { version: "override-test", mapping: { govt: "silo" } });
    expect(decision.tier).toBe("silo");

    const queue = new CapturingTenantAwareQueue();
    registerTenantConsumers(queue);
    await queue.start();

    await queue.publish(COMMANDS.createTenant, {
      messageId: CREATE_MSG_ID,
      type: COMMANDS.createTenant,
      tenantId: TENANT_ID,
      actorId: ACTOR,
      correlationId: "corr-override-1",
      schemaVersion: "1.0",
      payload: {
        id: TENANT_ID,
        tenantId: TENANT_ID,
        name: "Override Precedence Tenant",
        domain: `override-${TENANT_ID}.test.example`,
        edition: "govt",
        status: "draft",
        region: "ap-south-1",
        residency: "IN",
        isolationTier: decision.tier,
        policyVersion: decision.policyVersion,
        policyReason: decision.reason,
        settings: {},
        version: 0,
      },
    });

    const afterCreate = await runWithTenant(TENANT_ID, () =>
      db.transaction((tx) => tx.select().from(tenants).where(eq(tenants.id, TENANT_ID))),
    );
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0]?.isolationTier).toBe("silo");
    expect(afterCreate[0]?.policyReason).toBe("policy_mapped");

    // Exactly one isolation-changed event was published for the policy-derived silo tier.
    const outboxAfterCreate = await runWithTenant(TENANT_ID, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_ID))),
    );
    const isolationEventsAfterCreate = outboxAfterCreate.filter(
      (r) => r.eventType === EVENTS.tenantIsolationChanged,
    );
    expect(isolationEventsAfterCreate).toHaveLength(1);

    // ── Step 2: manual override — PATCH /v1/tenants/:id/isolation publishes setIsolation ──
    await queue.publish(COMMANDS.setIsolation, {
      messageId: OVERRIDE_MSG_ID,
      type: COMMANDS.setIsolation,
      tenantId: TENANT_ID,
      actorId: ACTOR,
      correlationId: "corr-override-2",
      schemaVersion: "1.0",
      payload: { id: TENANT_ID, tier: "pool", dbDsnRef: null, kmsKeyRef: null },
    });
    await queue.stop();

    // ── Step 3: the manual override wins — persisted tier is `pool`, not reverted ──
    const afterOverride = await runWithTenant(TENANT_ID, () =>
      db.transaction((tx) => tx.select().from(tenants).where(eq(tenants.id, TENANT_ID))),
    );
    expect(afterOverride).toHaveLength(1);
    expect(afterOverride[0]?.isolationTier).toBe("pool");
    // version incremented — the manual write is a distinct, later mutation.
    expect(afterOverride[0]!.version).toBeGreaterThan(afterCreate[0]!.version);

    // setIsolation published its own isolation-changed event too (Req 2.4's
    // pre-existing, untouched manual path) — now two total for this tenant,
    // one from onboarding (silo) and one from the manual override (pool).
    const outboxAfterOverride = await runWithTenant(TENANT_ID, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_ID))),
    );
    const isolationEventsAfterOverride = outboxAfterOverride.filter(
      (r) => r.eventType === EVENTS.tenantIsolationChanged,
    );
    expect(isolationEventsAfterOverride).toHaveLength(2);

    // Re-deriving the policy for the same edition still yields silo — proving
    // the persisted `pool` value reflects the manual override winning, not
    // the policy having changed underneath it.
    const rederived = tierFor("govt", { version: "override-test", mapping: { govt: "silo" } });
    expect(rederived.tier).toBe("silo");
    expect(afterOverride[0]?.isolationTier).toBe("pool"); // still pool — override was not reverted
  }, 30_000);
});
