/**
 * 10-T3 Chain #8 — Real cross-service fan-out:
 *   workflow SLA sweeper → notification.send + workflow.task.escalated + audit.event.record.
 *
 * The UAT gap report lists "workflow SLA breach → notification/escalation/audit"
 * as WIRED (`tasks/sweeper.ts` `sweepOverdueTasks`) but UNTESTED. The sweeper is
 * the PRODUCER: it scans overdue tasks (`db.select`), CAS-claims each under a row
 * lock (`tx.update(...).returning(...)`), appends a history row (`tx.insert`),
 * and emits THREE events under ONE correlationId. This needs the full 10-T3
 * harness extension — seedable select, a thenable `update().returning()`, and the
 * outbox `enqueue` re-publish that turns each emit into a real queue delivery.
 *
 * We seed one overdue task + its instance owner, drive `sweepOverdueTasks`
 * directly (the producer entrypoint a timer would call), and assert all three
 * downstream topics fire carrying the SAME correlationId — proving the fan-out is
 * correlated. A second seeded sweep with an empty CAS result proves the
 * row-claim guard short-circuits the emit (no duplicate fan-out).
 *
 * DB + outbox + cache/queue infra are stubbed in-memory so it runs in CI with no
 * Postgres.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- workflow-service data layer -------------------------------------------
vi.mock("../../services/workflow-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {}, scopedRead: (fn: any) => h.mockDb.transaction(fn) };
});

vi.mock("../../services/workflow-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
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

// infra exports `queue` (timer sweeper) + `cache`; the SLA sweeper only emits via
// the outbox `enqueue`, but importing the module pulls infra in, so stub it to a
// harness-backed queue so nothing reaches a real driver.
vi.mock("../../services/workflow-service/src/shared/infra.js", async () => {
  const h = await import("./harness.js");
  return {
    queue: {
      publish: async (topic: string, msg: unknown) =>
        h.mockEnqueue({}, {
          topic,
          eventType: (msg as { type: string }).type,
          tenantId: (msg as { tenantId: string }).tenantId,
          actorId: (msg as { actorId: string }).actorId,
          correlationId: (msg as { correlationId: string }).correlationId,
          payload: (msg as { payload: Record<string, unknown> }).payload,
        }),
      subscribe: () => {},
    },
    cache: { invalidate: async () => {}, makeKey: (...p: string[]) => p.join(":") },
  };
});

const { sweepOverdueTasks, SYSTEM_ACTOR_ID } = await import(
  "../../services/workflow-service/src/modules/tasks/sweeper.js"
);

const TENANT = "eeee1111-1111-4000-8000-000000000001";
const TASK_ID = "ffff2222-2222-4000-8000-000000000001";
const INSTANCE_ID = "11112222-3333-4000-8000-000000000001";
const OWNER_ID = "22223333-4444-4000-8000-000000000001";

/** One overdue, never-escalated pending task with an SLA in the past. */
function overdueTask(now: Date) {
  return {
    id: TASK_ID,
    tenantId: TENANT,
    instanceId: INSTANCE_ID,
    name: "Approve PO",
    status: "pending",
    roleRef: "role:approver",
    nodeKey: "approve",
    dueAt: new Date(now.getTime() - 60 * 60 * 1000), // 1h overdue
    escalatedAt: null,
    escalationCount: 0,
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain #8: workflow SLA sweeper → notification + escalation + audit", () => {
  it("an overdue task fans out all three topics under one correlationId", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");

    // tasks select → one overdue task; instances select → its owner; the CAS
    // update returns the claimed row with the bumped escalation count.
    harness.seedSelect("tasks", [overdueTask(now)]);
    harness.seedSelect("instances", [{ createdBy: OWNER_ID }]);
    harness.seedUpdateReturning([{ id: TASK_ID, escalationCount: 1 }]);

    // Capture every emit; key by topic so we can prove all three fired and share
    // a correlationId.
    const got: Record<string, CommandEnvelope> = {};
    for (const topic of ["workflow.task.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async (msg) => {
        got[topic] = msg;
      });
    }

    const escalated = await sweepOverdueTasks(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(escalated).toBe(1);

    // All three downstream topics fired.
    expect(got["workflow.task.escalated"]).toBeTruthy();
    expect(got["notification.send"]).toBeTruthy();
    expect(got["audit.event.record"]).toBeTruthy();

    // ...and they share ONE correlationId (the per-task escalation correlation).
    const corr = got["workflow.task.escalated"]!.correlationId;
    expect(got["notification.send"]!.correlationId).toBe(corr);
    expect(got["audit.event.record"]!.correlationId).toBe(corr);

    // Escalation event carries the task + recipient (resolved to the instance owner).
    const esc = got["workflow.task.escalated"]!.payload as {
      taskId: string;
      instanceId: string;
      recipient: string;
      escalationCount: number;
    };
    expect(esc.taskId).toBe(TASK_ID);
    expect(esc.instanceId).toBe(INSTANCE_ID);
    expect(esc.recipient).toBe(OWNER_ID);
    expect(esc.escalationCount).toBe(1);

    // Notification targets the same recipient; audit is the canonical workflow row.
    const note = got["notification.send"]!.payload as { recipient?: string; to?: string };
    expect(note.recipient ?? note.to).toBe(OWNER_ID);

    const aud = got["audit.event.record"]!.payload as {
      service: string;
      action: string;
      resourceType: string;
      resourceId: string;
    };
    expect(aud.service).toBe("workflow");
    expect(aud.action).toBe("escalate");
    expect(aud.resourceType).toBe("task");
    expect(aud.resourceId).toBe(TASK_ID);

    // All three are attributed to the system actor (not the task creator).
    expect(got["workflow.task.escalated"]!.actorId).toBe(SYSTEM_ACTOR_ID);
    expect(got["notification.send"]!.actorId).toBe(SYSTEM_ACTOR_ID);
    expect(got["audit.event.record"]!.actorId).toBe(SYSTEM_ACTOR_ID);
  });

  it("falls back to the role ref as recipient when the instance has no owner", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    harness.seedSelect("tasks", [overdueTask(now)]);
    harness.seedSelect("instances", []); // no owner row
    harness.seedUpdateReturning([{ id: TASK_ID, escalationCount: 1 }]);

    const esc = harness.nextEvent("workflow.task.escalated");
    await sweepOverdueTasks(now);
    const msg = await esc;
    expect((msg.payload as { recipient: string }).recipient).toBe("role:approver");
  });

  it("emits nothing when the CAS row-claim loses the race (idempotency guard)", async () => {
    const now = new Date("2026-06-25T10:00:00.000Z");
    harness.seedSelect("tasks", [overdueTask(now)]);
    harness.seedSelect("instances", [{ createdBy: OWNER_ID }]);
    // A concurrent sweep already claimed the row → update returns zero rows.
    harness.seedUpdateReturning([]);

    let emits = 0;
    for (const topic of ["workflow.task.escalated", "notification.send", "audit.event.record"]) {
      harness.queue.subscribe(topic, async () => {
        emits++;
      });
    }

    const escalated = await sweepOverdueTasks(now);
    await new Promise((r) => setTimeout(r, 200));

    expect(escalated).toBe(0);
    expect(emits).toBe(0);
  });
});
