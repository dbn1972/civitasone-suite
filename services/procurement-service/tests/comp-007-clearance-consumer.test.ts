/**
 * COMP-007 -- procurement-service `clearance` module (legal-service ->
 * procurement: caches contract clearance for the high-value PO gate)
 * smoke test.
 *
 * Registered as a consumer only (registerClearanceConsumers, no HTTP route at
 * all) but had zero test references anywhere in the service. Follows this
 * service's own established consumer-test convention exactly (see
 * tests/vendor-scorecard-consumer.test.ts): a fresh MemoryQueue per test,
 * wired with withTenantConsumer (RLS needs the tenant GUC set), drained via
 * q.drain() rather than a fixed sleep, verified against the real disposable
 * Postgres (_outbox.messages) and the module's own real cache (CACHE_DRIVER
 * memory per vitest.config.ts -- not a mock of the DB layer, the same real
 * per-package abstraction the queue driver uses for tests).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerClearanceConsumers, getLegalClearance } from "../src/modules/clearance/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

function envelope(payload: Record<string, unknown>, tenantId: string, actorId: string, correlationId: string, messageId = randomUUID()) {
  return {
    messageId, type: CONSUMED_EVENTS.legalContractCleared, tenantId, actorId, correlationId,
    schemaVersion: "1.0", payload,
  };
}

async function outboxRowsForCorrelation(correlationId: string) {
  const rows = await db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, correlationId));
  return rows;
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: clearance consumer -- legal.contract_review.cleared", () => {
  it("caches the clearance record (readable via getLegalClearance) and emits one audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    const reviewId = randomUUID();

    const q = wire(new MemoryQueue());
    registerClearanceConsumers(q);
    await q.start();

    await q.publish(
      CONSUMED_EVENTS.legalContractCleared,
      envelope({ reviewId, contractRef: "CTR-COMP007-001", valueMinor: 25_00_00000 }, TENANT, ACTOR, CORR),
    );
    await q.drain();

    const cached = await getLegalClearance(TENANT, reviewId);
    expect(cached).toBeTruthy();
    expect(cached!.reviewId).toBe(reviewId);
    expect(cached!.contractRef).toBe("CTR-COMP007-001");
    expect(cached!.valueMinor).toBe(25_00_00000);
    expect(typeof cached!.clearedAt).toBe("string");

    const rows = await outboxRowsForCorrelation(CORR);
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe("audit.event.record");
    expect(rows[0].payload).toMatchObject({
      service: "procurement",
      action: "legal_clearance_received",
      resourceType: "legal_clearance",
      resourceId: reviewId,
      outcome: "success",
    });
  });

  it("is idempotent: redelivering the same messageId does not cache twice or double-emit the audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    const reviewId = randomUUID();
    const messageId = randomUUID();

    const q = wire(new MemoryQueue());
    registerClearanceConsumers(q);
    await q.start();

    const env = envelope({ reviewId, contractRef: "CTR-COMP007-DUP", valueMinor: 1000 }, TENANT, ACTOR, CORR, messageId);
    await q.publish(CONSUMED_EVENTS.legalContractCleared, env);
    await q.publish(CONSUMED_EVENTS.legalContractCleared, env); // exact same messageId, replayed
    await q.drain();

    const rows = await outboxRowsForCorrelation(CORR);
    expect(rows).toHaveLength(1);
  });

  it("cache is tenant-scoped -- a clearance recorded for tenant A is not visible reading back under tenant B", async () => {
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const ACTOR = randomUUID();
    const reviewId = randomUUID();

    const q = wire(new MemoryQueue());
    registerClearanceConsumers(q);
    await q.start();

    await q.publish(
      CONSUMED_EVENTS.legalContractCleared,
      envelope({ reviewId, contractRef: "CTR-COMP007-TENANT", valueMinor: 500 }, TENANT_A, ACTOR, `corr-${randomUUID()}`),
    );
    await q.drain();

    expect(await getLegalClearance(TENANT_A, reviewId)).toBeTruthy();
    expect(await getLegalClearance(TENANT_B, reviewId)).toBeNull();
  });

  it("getLegalClearance returns null for a reviewId that was never cleared", async () => {
    expect(await getLegalClearance(randomUUID(), randomUUID())).toBeNull();
  });
});
