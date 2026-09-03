import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { CONSUMED_EVENTS } from "../src/topics.js";

// Mirror the mock infrastructure of domain-events-consumer.test.ts so we drive
// the REAL registerDomainEventConsumers / handleDomainEvent / resolveRecipients
// path and observe what gets enqueued to the outbox (notification.send).

vi.mock("../src/shared/db.js", () => {
  return {
    db: {
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({});
      },
    },
    sqlClient: { end: vi.fn() },
  };
});

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
  const mod = (await import("../src/shared/outbox.js")) as unknown as {
    __processedIds: Set<string>;
    __enqueuedMessages: Array<{ topic: string; payload: unknown }>;
  };
  return mod;
}

// SYSTEM_TEMPLATE_IDS.default — visitor security events have no EVENT_TEMPLATE_MAP
// entry, so buildNotificationPayload falls back to the default DB template id.
const DEFAULT_TEMPLATE_ID = "00000000-0000-4000-8001-000000000000";

describe("LIVE PROOF — visitor security choreography wiring", () => {
  let q: MemoryQueue;

  beforeEach(async () => {
    q = new MemoryQueue();
    const outboxMock = await getOutboxMock();
    outboxMock.__enqueuedMessages.length = 0;
    outboxMock.__processedIds.clear();
    const { registerDomainEventConsumers } = await import(
      "../src/modules/domain-events/consumer.js"
    );
    registerDomainEventConsumers(q);
  });

  function buildEnvelope(eventType: string, payload: Record<string, unknown>) {
    return {
      messageId: crypto.randomUUID(),
      type: eventType,
      tenantId: "tenant-777",
      actorId: "system",
      correlationId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  it("WIRED: visitor.security_incident.created → notification.send to the security control room with the right template + variables", async () => {
    const outboxMock = await getOutboxMock();
    const envelope = buildEnvelope(CONSUMED_EVENTS.visitorSecurityIncidentCreated, {
      visitRequestId: "vr-999",
      locationId: "loc-42",
      incidentType: "face_match_fail",
      severity: "high",
      confidence: 71,
      threshold: 85,
    });

    await q.publish(CONSUMED_EVENTS.visitorSecurityIncidentCreated, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const msg = outboxMock.__enqueuedMessages[0]!;
    expect(msg.topic).toBe("notification.send");
    const payload = msg.payload as {
      recipient: string;
      recipientId: string;
      eventType: string;
      templateId: string;
      variables: Record<string, string>;
    };
    // Role/desk recipient — NOT a per-person id.
    expect(payload.recipient).toBe("security_control_room");
    expect(payload.recipientId).toBe("security_control_room");
    expect(payload.eventType).toBe("visitor.security_incident.created");
    expect(payload.templateId).toBe(DEFAULT_TEMPLATE_ID);
    expect(payload.variables.incidentType).toBe("face_match_fail");
    expect(payload.variables.severity).toBe("high");
    expect(payload.variables.locationId).toBe("loc-42");
    expect(payload.variables.reference).toBe("vr-999");
  });

  it("WIRED: visitor.emergency.unlock.triggered → notification.send to security control room", async () => {
    const outboxMock = await getOutboxMock();
    const envelope = buildEnvelope(CONSUMED_EVENTS.visitorEmergencyUnlockTriggered, {
      locationId: "loc-42",
      reason: "fire_evacuation",
      deviceCount: 6,
      triggeredAt: "2026-07-12T10:00:00.000Z",
    });

    await q.publish(CONSUMED_EVENTS.visitorEmergencyUnlockTriggered, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as {
      recipient: string;
      variables: Record<string, string>;
    };
    expect(payload.recipient).toBe("security_control_room");
    expect(payload.variables.reason).toBe("fire_evacuation");
    expect(payload.variables.deviceCount).toBe("6");
  });

  it("SKIPPED (already-notifies): visitor.watchlist.matched is NOT wired — no subscriber, no notification enqueued", async () => {
    const outboxMock = await getOutboxMock();
    // This event is intentionally absent from CONSUMED_EVENTS (visitor-service
    // already emits notification.send inline at check-in). registerDomainEventConsumers
    // therefore never subscribes to it, so publishing it enqueues nothing here.
    const eventType = "visitor.watchlist.matched";
    expect(Object.values(CONSUMED_EVENTS)).not.toContain(eventType);

    const envelope = buildEnvelope(eventType, {
      visitorName: "Someone",
      passId: "pass-1",
      locationId: "loc-42",
    });
    await q.publish(eventType, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(0);
  });

  it("SKIPPED (already-notifies): visitor.capacity.threshold_reached is NOT wired", async () => {
    const outboxMock = await getOutboxMock();
    const eventType = "visitor.capacity.threshold_reached";
    expect(Object.values(CONSUMED_EVENTS)).not.toContain(eventType);
    await q.publish(eventType, buildEnvelope(eventType, { locationId: "loc-42", occupancy: 200 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(outboxMock.__enqueuedMessages).toHaveLength(0);
  });
});
