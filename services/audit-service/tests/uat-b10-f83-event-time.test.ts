/**
 * UAT B10-F83 (review): audit timestamp integrity.
 *
 * occurred_at is the hash-chain instant (assigned at append, strictly
 * increasing per tenant, orders the chain). event_at is when the audited
 * action happened: the producer's outbox commit time, carried as the envelope
 * timestamp. A delayed or replayed delivery must keep its true event time, and
 * the chain must still verify.
 *
 * Real DB (migration 0036), real consumer through a MemoryQueue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import { registerAuditConsumers, resolveEventAt } from "../src/modules/events/consumer.js";
import { verifyTenantChain, findById } from "../src/modules/events/repo.js";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = randomUUID();
const ACTOR = randomUUID();

afterAll(async () => { await sqlClient.end(); });

describe("resolveEventAt", () => {
  const chain = new Date("2026-10-31T10:00:00.000Z");
  it("uses the envelope timestamp", () => {
    expect(resolveEventAt("2026-10-28T18:30:00.000Z", chain).toISOString()).toBe("2026-10-28T18:30:00.000Z");
  });
  it("never later than the chain instant, and falls back on junk", () => {
    expect(resolveEventAt("2027-01-01T00:00:00.000Z", chain)).toBe(chain);
    expect(resolveEventAt("not-a-date", chain)).toBe(chain);
    expect(resolveEventAt(undefined, chain)).toBe(chain);
  });
});

describe("UAT B10-F83 a late (replayed) audit event keeps its true event time", () => {
  let q: MemoryQueue;
  beforeAll(async () => {
    q = wire(new MemoryQueue()) as MemoryQueue;
    registerAuditConsumers(q);
    await q.start();
  });

  it("stores event_at = original commit time, appends to the chain now, and the chain verifies", async () => {
    const original = "2026-10-28T18:30:00.000Z";
    const late = randomUUID();
    // A current event first, then the late (replayed) one: chain order is append order.
    await q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(),
      schemaVersion: "1.0", payload: { service: "hrms", action: "confirm", resourceType: "employee", resourceId: randomUUID() },
    });
    await q.publish("audit.event.record", {
      messageId: late, type: "audit.event.record", tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(),
      schemaVersion: "1.0", timestamp: original,
      payload: { service: "revenue", action: "decide", resourceType: "refund", resourceId: "r-late", _replay: { reason: "UAT-B10-F83 replay" } },
    });
    await q.drain();

    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.target, "r-late"))));
    expect(row).toBeDefined();
    expect(row!.eventAt!.toISOString()).toBe(original);
    expect(row!.occurredAt.getTime()).toBeGreaterThan(new Date(original).getTime());
    expect((row!.payload as Record<string, unknown>)._eventAt).toBe(original); // bound into the hash

    const view = await findById(row!.id, TENANT);
    expect(view!.eventAt).toBe(original);

    const v = await verifyTenantChain(TENANT);
    expect(v.hashMismatches).toEqual([]);
    expect(v.linkBreaks).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
