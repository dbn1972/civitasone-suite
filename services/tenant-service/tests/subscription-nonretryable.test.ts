/**
 * CLOS3-S6-17 — deterministic business rejections in the subscription consumers (invalid status
 * transition, "cannot renew") threw a plain Error, which both queue drivers treat as retryable: the
 * handler re-ran on every delivery (5x) and the message dead-lettered as outcome "failed" instead of
 * "rejected", so the command-result API reported the wrong status.
 * They now throw NonRetryableError -> straight to the DLQ on the first delivery with outcome "rejected".
 * "not found" stays a plain (retryable) Error: the row may simply not have been created yet.
 *
 * Real Postgres, MemoryQueue (the production drivers share the NonRetryableError contract).
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { subscriptions } from "../src/modules/subscriptions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as repo from "../src/modules/subscriptions/repo.js";
import { registerSubscriptionConsumers } from "../src/modules/subscriptions/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "00000000-dddd-4000-8000-0000000000a1";
const tenants: string[] = [];
const newTenant = () => { const t = randomUUID(); tenants.push(t); return t; };

type Outcome = { status: string; reason?: string };

/** MemoryQueue whose subscriptions count handler runs and capture the terminal outcome. */
function harness() {
  const q = new MemoryQueue();
  const runs: Record<string, number> = {};
  const outcomes: Outcome[] = [];
  const rawSubscribe = q.subscribe.bind(q) as (t: string, h: (m: never) => Promise<void>, o?: unknown) => void;
  (q as unknown as { subscribe: typeof rawSubscribe }).subscribe = (topic, handler) => {
    rawSubscribe(
      topic,
      async (m: never) => {
        runs[topic] = (runs[topic] ?? 0) + 1;
        const tenantId = (m as { tenantId: string }).tenantId;
        await runWithTenant(tenantId, () => handler(m));
      },
      { onOutcome: async (o: Outcome) => { outcomes.push(o); } },
    );
  };
  registerSubscriptionConsumers(q);
  return { q, runs, outcomes };
}

async function seed(tenantId: string, status: "active" | "cancelled" | "suspended") {
  const id = randomUUID();
  const now = new Date();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await repo.insert(tx as unknown as repo.Writer, {
      id, tenantId, planId: randomUUID(), status,
      startDate: now, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 864e5),
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    });
  }));
  return id;
}
const publish = (q: MemoryQueue, topic: string, tenantId: string, payload: unknown) =>
  q.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  } as never);

afterEach(async () => {
  for (const t of tenants.splice(0)) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(subscriptions).where(eq(subscriptions.tenantId, t));
    }));
  }
});
afterAll(async () => { await sqlClient.end(); });

describe("subscription consumers — error classification (CLOS3-S6-17)", () => {
  it("cancelling an already-cancelled subscription is rejected once, not retried", async () => {
    const t = newTenant();
    const id = await seed(t, "cancelled");
    const { q, runs, outcomes } = harness();
    await publish(q, COMMANDS.subscriptionCancel, t, { id, reason: "x", immediate: false });
    await q.drain();
    expect(runs[COMMANDS.subscriptionCancel]).toBe(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("rejected");
    expect(outcomes[0]!.reason).toMatch(/INVALID_SUBSCRIPTION_TRANSITION/);
    expect(q.dlq).toHaveLength(1);
  }, 30_000);

  it("renewing a cancelled subscription is rejected once (INVALID_SUBSCRIPTION_STATE)", async () => {
    const t = newTenant();
    const id = await seed(t, "cancelled");
    const { q, runs, outcomes } = harness();
    await publish(q, COMMANDS.subscriptionRenew, t, { id, newPeriodStart: new Date().toISOString(), newPeriodEnd: new Date().toISOString() });
    await q.drain();
    expect(runs[COMMANDS.subscriptionRenew]).toBe(1);
    expect(outcomes[0]!.status).toBe("rejected");
    expect(outcomes[0]!.reason).toMatch(/INVALID_SUBSCRIPTION_STATE/);
  }, 30_000);

  it("a missing subscription ('not found') is still retried (transient: the row may not exist yet)", async () => {
    const t = newTenant();
    const { q, runs, outcomes } = harness();
    await publish(q, COMMANDS.subscriptionCancel, t, { id: randomUUID(), reason: "x", immediate: false });
    await q.drain();
    expect(runs[COMMANDS.subscriptionCancel]).toBeGreaterThan(1);
    expect(outcomes[0]!.status).toBe("failed");
  }, 30_000);
});
