/**
 * Unit tests for the visit-request auto-reject + reminder scheduled worker.
 *
 * Validates Requirements 3.4 (4h reminder to host) and 3.5 (24h auto-reject).
 *
 * Tests use a fake in-memory DB and queue to verify the worker logic without
 * needing a real Postgres or SQS connection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processAutoRejectCycle } from "../src/modules/visit-request/auto-reject-worker.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

// ── Helpers ──────────────────────────────────────────────────────────────

const TENANT = "t-111";
const HOST = "host-001";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "req-1",
    tenantId: overrides.tenantId ?? TENANT,
    hostEmployeeId: overrides.hostEmployeeId ?? HOST,
    visitorName: overrides.visitorName ?? "Alice Visitor",
    visitorPhone: overrides.visitorPhone ?? "+919876543210",
    visitorEmail: overrides.visitorEmail ?? "alice@example.com",
    purpose: overrides.purpose ?? "Meeting",
    scheduledAt: overrides.scheduledAt ?? new Date("2025-01-15T10:00:00Z"),
    status: "pending_approval",
    createdAt: overrides.createdAt ?? new Date(),
  };
}

/**
 * Creates a fake Drizzle-like DB that returns configured rows for select queries.
 * The `from().where()` chain is simulated, filtering by the provided rows.
 */
function fakeDb(rows: ReturnType<typeof makeRequest>[]) {
  // Each call to db.select(...).from(...).where(...) should filter based on
  // the `createdAt` threshold in the `where` clause. We simulate this by
  // returning all rows and letting the worker logic handle duplicates.
  // For simplicity, we return all rows for any query — the worker itself
  // filters auto-rejected IDs from the reminder set.
  const builder = {
    from: () => builder,
    where: () => Promise.resolve(rows.map((r) => ({ ...r }))),
  };
  return {
    select: () => builder,
  };
}

function fakeQueue() {
  const published: Array<{ topic: string; input: unknown }> = [];
  return {
    published,
    publish: vi.fn(async (topic: string, input: unknown) => {
      published.push({ topic, input });
      return "msg-id";
    }),
    subscribe: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    healthCheck: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("processAutoRejectCycle", () => {
  const FOUR_HOURS = 4 * 60 * 60_000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60_000;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn() };
  });

  it("publishes auto-reject commands for requests older than 24h", async () => {
    const oldRequest = makeRequest({
      id: "old-req",
      createdAt: new Date(Date.now() - 25 * 60 * 60_000), // 25h old
    });

    // First call (auto-reject query) returns the old request
    // Second call (reminder query) also returns it — but it's excluded via autoRejectedIds
    const db = fakeDb([oldRequest]);
    const q = fakeQueue();

    const result = await processAutoRejectCycle(
      db as any,
      q as any,
      FOUR_HOURS,
      TWENTY_FOUR_HOURS,
      logger,
    );

    expect(result.autoRejected).toBe(1);
    // The auto-reject publish should use the correct command topic
    const autoRejectCall = q.published.find(
      (p) => p.topic === COMMANDS.visitRequestAutoReject,
    );
    expect(autoRejectCall).toBeDefined();
    const payload = (autoRejectCall!.input as any).payload;
    expect(payload.id).toBe("old-req");
    expect(payload.tenantId).toBe(TENANT);
  });

  it("publishes reminder notifications for requests older than 4h but not 24h", async () => {
    const reminderRequest = makeRequest({
      id: "reminder-req",
      createdAt: new Date(Date.now() - 5 * 60 * 60_000), // 5h old
    });

    // For the auto-reject query, no rows are returned (not old enough)
    // For the reminder query, the request is returned
    // We simulate this by having the fakeDb return empty for auto-reject
    // and the request for reminder. Since we can't distinguish queries,
    // we'll use a smarter fake:
    let callCount = 0;
    const builder = {
      from: () => builder,
      where: () => {
        callCount++;
        // First call is auto-reject (24h) — should return empty
        if (callCount === 1) return Promise.resolve([]);
        // Second call is reminder (4h) — should return the request
        return Promise.resolve([{ ...reminderRequest }]);
      },
    };
    const db = { select: () => builder };
    const q = fakeQueue();

    const result = await processAutoRejectCycle(
      db as any,
      q as any,
      FOUR_HOURS,
      TWENTY_FOUR_HOURS,
      logger,
    );

    expect(result.reminders).toBe(1);
    expect(result.autoRejected).toBe(0);

    // Should publish 2 notifications (push + in_app) for the host
    const notifications = q.published.filter((p) => p.topic === NOTIFICATION_SEND);
    expect(notifications).toHaveLength(2);

    // Verify push notification
    const pushNotif = notifications.find(
      (n) => (n.input as any).payload.channel === "push",
    );
    expect(pushNotif).toBeDefined();
    expect((pushNotif!.input as any).payload.recipient).toBe(HOST);

    // Verify in-app notification
    const inAppNotif = notifications.find(
      (n) => (n.input as any).payload.channel === "in_app",
    );
    expect(inAppNotif).toBeDefined();
    expect((inAppNotif!.input as any).payload.recipient).toBe(HOST);
  });

  it("does NOT send reminders for requests already auto-rejected in the same cycle", async () => {
    const oldRequest = makeRequest({
      id: "both-old",
      createdAt: new Date(Date.now() - 25 * 60 * 60_000),
    });

    // Both queries return the same request (it's older than both thresholds)
    const db = fakeDb([oldRequest]);
    const q = fakeQueue();

    const result = await processAutoRejectCycle(
      db as any,
      q as any,
      FOUR_HOURS,
      TWENTY_FOUR_HOURS,
      logger,
    );

    expect(result.autoRejected).toBe(1);
    // Since the request was auto-rejected, it should NOT receive a reminder
    expect(result.reminders).toBe(0);

    // Only the auto-reject command should be published, no NOTIFICATION_SEND
    const notifications = q.published.filter((p) => p.topic === NOTIFICATION_SEND);
    expect(notifications).toHaveLength(0);
  });

  it("does nothing when there are no pending requests", async () => {
    const db = fakeDb([]);
    const q = fakeQueue();

    const result = await processAutoRejectCycle(
      db as any,
      q as any,
      FOUR_HOURS,
      TWENTY_FOUR_HOURS,
      logger,
    );

    expect(result.autoRejected).toBe(0);
    expect(result.reminders).toBe(0);
    expect(q.published).toHaveLength(0);
    // Should NOT log when nothing happened
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs info when auto-rejects or reminders are sent", async () => {
    const oldRequest = makeRequest({
      id: "log-test",
      createdAt: new Date(Date.now() - 25 * 60 * 60_000),
    });

    const db = fakeDb([oldRequest]);
    const q = fakeQueue();

    await processAutoRejectCycle(db as any, q as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ autoRejected: 1, reminders: 0, event: "auto_reject_cycle_complete" }),
      expect.stringContaining("auto-reject cycle"),
    );
  });

  it("continues processing remaining requests when one publish fails", async () => {
    const req1 = makeRequest({ id: "fail-req", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const req2 = makeRequest({ id: "ok-req", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });

    const db = fakeDb([req1, req2]);
    const q = fakeQueue();

    // First publish fails, second succeeds
    let callNum = 0;
    q.publish.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) throw new Error("SQS timeout");
      return "msg-id";
    });

    const result = await processAutoRejectCycle(
      db as any,
      q as any,
      FOUR_HOURS,
      TWENTY_FOUR_HOURS,
      logger,
    );

    expect(result.autoRejected).toBe(1); // only second succeeded
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ visitRequestId: "fail-req", event: "auto_reject_publish_failed" }),
      expect.any(String),
    );
  });
});
