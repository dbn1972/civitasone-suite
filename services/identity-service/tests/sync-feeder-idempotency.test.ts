/**
 * Sync feeder idempotency tests — TX-009.
 *
 * registerSyncFeederConsumers used to call repo.appendChangelog() directly
 * with no markProcessed/dedup of any kind: every redelivery of any of the
 * ~30 upstream domain events it subscribes to (hrms.employee.created,
 * finance.payment.made, grant.disbursement.completed, etc.) appended a
 * brand-new, permanent changelog row. Mobile/web sync clients pull a
 * mailbox by cursor (pullSince) and apply every row they haven't seen, so a
 * redelivery made them observe and re-apply the same entity mutation twice,
 * and the changelog table grew unboundedly with dead duplicate rows.
 *
 * Fixed by gating the write with markProcessed (keyed on the message's own
 * messageId) inside the same transaction as the appendChangelogOne insert.
 *
 * This is a lightweight mock-based unit test (mocks shared/db.js,
 * shared/outbox.js, and devices/repo.js) rather than the real-Postgres style
 * used by sync.protocol.test.ts (that whole suite is DB_URL-gated and skipped
 * outside an environment with a live Postgres). It mirrors the mocking
 * convention already established for this exact class of fix in this
 * codebase (project-service's delay-forecast-consumer.test.ts,
 * report-service's consumers.test.ts): a stub queue capturing the registered
 * handler, plus a STATEFUL markProcessed mock that tracks seen messageIds
 * like the real Postgres-backed helper (ON CONFLICT DO NOTHING ... RETURNING)
 * instead of an unconditional `() => true`, so the redelivery test genuinely
 * exercises the dedup guard rather than assuming it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import type { Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  appendCalls: [] as Array<{ tenantId: string; mailbox: string; entityId: string; operation: string; ownerUserId?: string | null }>,
  processedIds: new Set<string>(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, messageId: string) => {
    if (H.processedIds.has(messageId)) return false;
    H.processedIds.add(messageId);
    return true;
  }),
}));

vi.mock("../src/modules/devices/repo.js", () => ({
  appendChangelogOne: vi.fn(async (_tx: unknown, entry: { tenantId: string; mailbox: string; entityId: string; operation: string; ownerUserId?: string | null }) => {
    H.appendCalls.push(entry);
    return { seq: String(H.appendCalls.length), etag: `etag-${H.appendCalls.length}` };
  }),
}));

interface StubQueueHandle {
  queue: Queue;
  getHandler: (topic: string) => (msg: unknown) => Promise<void>;
}

function makeStubQueue(): StubQueueHandle {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const queue = {
    subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => { handlers.set(topic, handler); },
    publish: async () => {},
  } as unknown as Queue;
  return { queue, getHandler: (topic: string) => handlers.get(topic)! };
}

function domainEvent(messageId: string, payload: Record<string, unknown>, tenantId = "tenant-1") {
  return { messageId, correlationId: "corr-1", tenantId, actorId: "actor-1", payload };
}

describe("Sync feeder — TX-009 redelivery idempotency", () => {
  beforeEach(() => {
    H.appendCalls.length = 0;
    H.processedIds.clear();
  });

  it("appends exactly one changelog row for a normal delivery", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, getHandler } = makeStubQueue();
    registerSyncFeederConsumers(queue);

    await getHandler("hrms.employee.created")(domainEvent("msg-1", { employeeId: "emp-1" }));

    expect(H.appendCalls).toHaveLength(1);
    expect(H.appendCalls[0]!.mailbox).toBe("employees");
    expect(H.appendCalls[0]!.entityId).toBe("emp-1");
    expect(H.appendCalls[0]!.operation).toBe("upsert");
  });

  it("TX-009 regression: redelivering the SAME event (same messageId) does not append a second changelog row", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, getHandler } = makeStubQueue();
    registerSyncFeederConsumers(queue);

    const handler = getHandler("finance.payment.made");
    const msg = domainEvent("fixed-redelivery-id", { paymentId: "pay-1" });

    await handler(msg);
    await handler(msg); // redelivery: identical messageId

    expect(H.appendCalls).toHaveLength(1); // not 2
  });

  it("a genuinely distinct event (different messageId) for the same entity still appends its own row", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, getHandler } = makeStubQueue();
    registerSyncFeederConsumers(queue);

    const handler = getHandler("finance.payment.made");
    await handler(domainEvent("msg-a", { paymentId: "pay-2" }));
    await handler(domainEvent("msg-b", { paymentId: "pay-2" }));

    expect(H.appendCalls).toHaveLength(2); // two distinct real events, two rows
  });

  it("still threads ownerUserId for user-private mailboxes (notification.delivered) after adding the markProcessed guard", async () => {
    // Regression guard for the fix itself: appendChangelogOne needed a new
    // optional ownerUserId field to keep this working once the feeder
    // switched from appendChangelog (which already supported it) to the
    // tx-taking appendChangelogOne (which didn't, before this fix).
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, getHandler } = makeStubQueue();
    registerSyncFeederConsumers(queue);

    await getHandler("notification.delivered")(domainEvent("msg-notif-1", { deliveryId: "d-1", recipientId: "user-42" }));

    expect(H.appendCalls).toHaveLength(1);
    expect(H.appendCalls[0]!.ownerUserId).toBe("user-42");
  });

  it("03-T5 tombstone rule still marks the changelog row as a delete, and is itself idempotent on redelivery", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, getHandler } = makeStubQueue();
    registerSyncFeederConsumers(queue);

    const handler = getHandler("crm.contact.deleted");
    const msg = domainEvent("msg-delete-1", { contactId: "contact-9" });
    await handler(msg);
    await handler(msg); // redelivery

    expect(H.appendCalls).toHaveLength(1);
    expect(H.appendCalls[0]!.operation).toBe("delete");
  });
});
