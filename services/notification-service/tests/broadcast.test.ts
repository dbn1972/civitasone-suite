import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { CONSUMED_EVENTS } from "../src/topics.js";

/**
 * LOOP 2 — release-notes broadcast (admin change → notification).
 *
 * admin-service's change-management "complete" route emits
 * notification.broadcast.send on a successful release with release notes. The
 * domain-event consumer must turn it into a notification.send delivery addressed
 * to the tenant's broadcast audience, and dedupe redelivery. Mirrors the mocked
 * db/outbox harness used by domain-events-consumer.test.ts.
 */

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<void>) => { await fn({}); } },
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => {
  const processedIds = new Set<string>();
  const enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    markProcessed: async (_tx: unknown, messageId: string) => {
      if (processedIds.has(messageId)) return false;
      processedIds.add(messageId);
      return true;
    },
    enqueue: async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
      enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
    },
    __processedIds: processedIds,
    __enqueuedMessages: enqueuedMessages,
  };
});

async function getOutboxMock() {
  return (await import("../src/shared/outbox.js")) as unknown as {
    __processedIds: Set<string>;
    __enqueuedMessages: Array<{ topic: string; payload: unknown }>;
  };
}

describe("LOOP 2 — release-notes broadcast consumer (notification.broadcast.send)", () => {
  let q: MemoryQueue;
  let outboxMock: Awaited<ReturnType<typeof getOutboxMock>>;

  beforeEach(async () => {
    q = new MemoryQueue();
    outboxMock = await getOutboxMock();
    outboxMock.__processedIds.clear();
    outboxMock.__enqueuedMessages.length = 0;
    const { registerDomainEventConsumers } = await import("../src/modules/domain-events/consumer.js");
    registerDomainEventConsumers(q);
  });

  function broadcastEnvelope(messageId = crypto.randomUUID()) {
    return {
      messageId,
      type: CONSUMED_EVENTS.notificationBroadcastSend,
      tenantId: "tenant-001",
      actorId: "system",
      correlationId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        channel: "release_notes",
        changeId: "chg-2024-0042",
        title: "Helpdesk SLA engine v2",
        releaseNotes: "Faster breach detection and per-priority SLA policies.",
        affectedServices: ["helpdesk", "notification"],
      },
    };
  }

  it("turns a release-notes broadcast into a notification.send delivery for the audience", async () => {
    await q.publish(CONSUMED_EVENTS.notificationBroadcastSend, broadcastEnvelope());
    await new Promise((r) => setTimeout(r, 40));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const msg = outboxMock.__enqueuedMessages[0]!;
    expect(msg.topic).toBe("notification.send");
    const payload = msg.payload as { recipient: string; recipientId: string; eventType: string; variables: Record<string, string> };
    expect(payload.eventType).toBe("notification.broadcast.send");
    expect(payload.recipientId).toBe("all_users");
    expect(payload.recipient).toBe("all_users");
    expect(payload.variables?.title).toBe("Helpdesk SLA engine v2");
    expect(payload.variables?.releaseNotes).toContain("breach detection");
    expect(payload.variables?.affectedServices).toBe("helpdesk, notification");
    expect(payload.variables?.changeId).toBe("chg-2024-0042");
  });

  it("idempotent: redelivery of the same broadcast does not double-send", async () => {
    const env = broadcastEnvelope();
    await q.publish(CONSUMED_EVENTS.notificationBroadcastSend, env);
    await new Promise((r) => setTimeout(r, 40));
    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb)

    // same messageId → markProcessed rejects the duplicate
    await q.publish(CONSUMED_EVENTS.notificationBroadcastSend, env);
    await new Promise((r) => setTimeout(r, 40));
    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // still 2 (no NEW messages) -- duplicate rejected by markProcessed
  });
});
