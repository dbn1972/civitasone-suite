/**
 * PHASE-3 FLOW 1 — Leave → Notify.
 *
 * SEAM: hrms-service leave-application mutation → notification-service.
 *   Emitter  : hrms  EVENTS.leaveApplied          = "hrms.leave.applied"
 *   Consumer : notif CONSUMED_EVENTS.hrmsLeaveApplied = "hrms.leave.applied"
 *
 * (A) EMIT  — drive the REAL hrms leave consumer via COMMANDS.leaveApply and
 *     assert "hrms.leave.applied" is written to the outbox.
 * (B) CONSUME — the REAL notification domain-event registration subscribes to
 *     that exact topic.
 *
 * VERDICT: WIRED (topic strings match exactly on both sides).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ChainHarness, setCurrentHarness } from "../integration/harness.js";
import { RecordingQueue, envelope, collect, TENANT } from "./_helpers.js";
import { COMMANDS as HRMS_COMMANDS, EVENTS as HRMS_EVENTS } from "../../services/hrms-service/src/topics.js";
import { CONSUMED_EVENTS as NOTIF_CONSUMED } from "../../services/notification-service/src/topics.js";

// ── hrms-service (emitter) data layer ───────────────────────────────────────
vi.mock("../../services/hrms-service/src/shared/db.js", async () => {
  const h = await import("../integration/harness.js");
  return {
    db: h.mockDb,
    sqlClient: {},
    scopedRead: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => h.mockDb.transaction(fn),
  };
});
vi.mock("../../services/hrms-service/src/shared/outbox.js", async () => {
  const h = await import("../integration/harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});
vi.mock("../../services/hrms-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

// ── notification-service (consumer) data layer ──────────────────────────────
vi.mock("../../services/notification-service/src/shared/db.js", () => ({ db: {}, sqlClient: {} }));
vi.mock("../../services/notification-service/src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => true,
}));
vi.mock("../../services/notification-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerLeaveConsumers } = await import("../../services/hrms-service/src/modules/leave/consumer.js");
const { registerDomainEventConsumers } = await import(
  "../../services/notification-service/src/modules/domain-events/consumer.js"
);

const EMIT_TOPIC = "hrms.leave.applied";
let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  // Seed the leave allocation the apply handler reads (findAllocById) so it
  // passes the balance guard and reaches the outbox enqueue.
  harness.seedSelect("alloc", [{ id: "aa000000-0000-4000-8000-000000000001", totalDays: 30, balanceDays: 30 }]);
  registerLeaveConsumers(harness.queue);
  await harness.queue.start();
});
afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("FLOW 1 — Leave → Notify (WIRED)", () => {
  it("(A) EMIT: leave.apply writes hrms.leave.applied to the outbox", async () => {
    const emitted = collect(harness, EMIT_TOPIC);
    const appId = randomUUID();

    await harness.queue.publish(
      HRMS_COMMANDS.leaveApply,
      envelope(randomUUID(), HRMS_COMMANDS.leaveApply, {
        id: appId,
        tenantId: TENANT,
        employeeId: "ee000000-0000-4000-8000-000000000001",
        leaveTypeId: "1c000000-0000-4000-8000-000000000001",
        allocId: "aa000000-0000-4000-8000-000000000001",
        fromDate: "2026-08-01",
        toDate: "2026-08-03",
        daysApplied: 3,
      }),
    );
    await harness.queue.drain();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]!.type).toBe(EMIT_TOPIC);
    expect((emitted[0]!.payload as { leaveAppId: string }).leaveAppId).toBe(appId);
  });

  it("(B) CONSUME: notification registers a subscriber for hrms.leave.applied", () => {
    const rq = new RecordingQueue();
    registerDomainEventConsumers(rq.asQueue());
    expect(rq.subscribedTopics.has(EMIT_TOPIC)).toBe(true);
  });

  it("emitter and consumer agree on the exact topic string", () => {
    expect(HRMS_EVENTS.leaveApplied).toBe(EMIT_TOPIC);
    expect(NOTIF_CONSUMED.hrmsLeaveApplied).toBe(HRMS_EVENTS.leaveApplied);
  });
});
