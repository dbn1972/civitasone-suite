/**
 * Unit tests for the visit-request auto-reject + reminder scheduled worker.
 *
 * Validates Requirements 3.4 (4h reminder to host) and 3.5 (24h auto-reject),
 * AND Fix 5: emissions now go through the TRANSACTIONAL OUTBOX (`enqueue` inside
 * a per-tenant `db.transaction`) rather than a raw `queue.publish` outside any
 * tx. The tests assert on the outbox `enqueue` calls (durable + idempotent),
 * proving the event still fires and is now transactional.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

const enqueueMock = vi.fn(async () => undefined);

// The worker emits exclusively through the transactional outbox now.
vi.mock("../src/shared/outbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/outbox.js")>()),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));

const { processAutoRejectCycle } = await import("../src/modules/visit-request/auto-reject-worker.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const HOST = "22222222-2222-2222-2222-222222222222";

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
 * Fake Drizzle-like handle. `.select()` backs both the config-override load and
 * the two candidate scans (returns the configured rows). `.transaction(fn)`
 * backs the per-tenant transactional enqueue; `txImpl` lets a test simulate a
 * failing commit.
 */
function fakeDb(
  rows: ReturnType<typeof makeRequest>[],
  txImpl?: () => Promise<void>,
) {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => Promise.resolve(rows.map((r) => ({ ...r }))),
  };
  const fakeTx = {};
  return {
    select: () => builder,
    selectDistinct: () => builder,
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      if (txImpl) return txImpl();
      return fn(fakeTx);
    },
  };
}

/** Enqueued outbox event objects (enqueue is called as enqueue(tx, event)). */
function enqueuedEvents(): any[] {
  return enqueueMock.mock.calls.map((c) => c[1] as any);
}

const FOUR_HOURS = 4 * 60 * 60_000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60_000;

describe("processAutoRejectCycle — transactional outbox (Fix 5)", () => {
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    enqueueMock.mockReset().mockResolvedValue(undefined);
    logger = { info: vi.fn(), warn: vi.fn() };
  });

  it("enqueues an auto-reject COMMAND (transactionally) for requests older than 24h", async () => {
    const oldRequest = makeRequest({ id: "old-req", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const db = fakeDb([oldRequest]);

    const result = await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(result.autoRejected).toBe(1);
    const evt = enqueuedEvents().find((e) => e.topic === COMMANDS.visitRequestAutoReject);
    expect(evt).toBeDefined();
    expect(evt.payload.id).toBe("old-req");
    expect(evt.payload.tenantId).toBe(TENANT);
    // Zero-UUID system actor so the outbox row satisfies actor_id NOT NULL uuid.
    expect(evt.actorId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("enqueues reminder NOTIFICATIONs (push + in_app) for requests older than 4h but not 24h", async () => {
    const reminderRequest = makeRequest({ id: "reminder-req", createdAt: new Date(Date.now() - 5 * 60 * 60_000) });
    let callCount = 0;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => {
        callCount++;
        // call 1 = config-override load (empty), call 2 = auto-reject scan (empty
        // after the <24h re-filter), call 3 = reminder scan (returns the request).
        if (callCount === 1) return Promise.resolve([]);
        return Promise.resolve([{ ...reminderRequest }]);
      },
    };
    const db = {
      select: () => builder,
      selectDistinct: () => builder,
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
    };

    const result = await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(result.reminders).toBe(1);
    expect(result.autoRejected).toBe(0);

    const notifs = enqueuedEvents().filter((e) => e.topic === NOTIFICATION_SEND);
    expect(notifs).toHaveLength(2);
    expect(notifs.map((n) => n.payload.channel).sort()).toEqual(["in_app", "push"]);
    for (const n of notifs) expect(n.payload.recipient).toBe(HOST);
  });

  it("does NOT send reminders for requests already auto-rejected in the same cycle", async () => {
    const oldRequest = makeRequest({ id: "both-old", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const db = fakeDb([oldRequest]);

    const result = await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(result.autoRejected).toBe(1);
    expect(result.reminders).toBe(0);
    expect(enqueuedEvents().filter((e) => e.topic === NOTIFICATION_SEND)).toHaveLength(0);
  });

  it("does nothing when there are no pending requests", async () => {
    const db = fakeDb([]);
    const result = await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(result.autoRejected).toBe(0);
    expect(result.reminders).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs info when auto-rejects or reminders are enqueued", async () => {
    const oldRequest = makeRequest({ id: "log-test", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const db = fakeDb([oldRequest]);

    await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ autoRejected: 1, reminders: 0, event: "auto_reject_cycle_complete" }),
      expect.stringContaining("auto-reject cycle"),
    );
  });

  it("continues processing remaining requests when one transactional enqueue fails", async () => {
    const req1 = makeRequest({ id: "fail-req", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const req2 = makeRequest({ id: "ok-req", createdAt: new Date(Date.now() - 25 * 60 * 60_000) });

    // First per-tenant tx throws (simulating a commit/enqueue failure), the rest succeed.
    let txCall = 0;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => Promise.resolve([{ ...req1 }, { ...req2 }]),
    };
    const db = {
      select: () => builder,
      selectDistinct: () => builder,
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        txCall++;
        if (txCall === 1) throw new Error("DB commit failed");
        return fn({});
      },
    };

    const result = await processAutoRejectCycle(db as any, {} as any, FOUR_HOURS, TWENTY_FOUR_HOURS, logger);

    expect(result.autoRejected).toBe(1); // only the second committed
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ visitRequestId: "fail-req", event: "auto_reject_publish_failed" }),
      expect.any(String),
    );
  });

  it("proves EVENTS import wiring stays intact (no stray topic drift)", () => {
    expect(EVENTS.visitRequestCreated).toBe("visitor.visit_request.created");
  });
});
