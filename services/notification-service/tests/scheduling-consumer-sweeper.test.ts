/**
 * Scheduling consumer + sweeper (scheduling/consumer.ts, scheduling/sweeper.ts).
 *
 * Both had ZERO line coverage. Between them they own the schedule → claim →
 * dispatch path, which is where a double-send would come from, so the
 * optimistic-locking claim and the idempotency guard get direct tests.
 *
 * The sweeper reads cross-tenant through the BYPASSRLS scanner pool
 * (scanner-db.ts) while it WRITES under runWithTenant, so this file also proves
 * that split works against real RLS rather than assuming it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { scheduledNotifications } from "../src/modules/scheduling/schema.js";
import { registerSchedulingConsumers } from "../src/modules/scheduling/consumer.js";
import { sweepDueSchedules, startScheduleSweeper } from "../src/modules/scheduling/sweeper.js";
import * as repo from "../src/modules/scheduling/repo.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "c0de0001-1111-4000-8000-000000000001";
const ACTOR = "c0deaaaa-1111-4000-8000-0000000000aa";
const TEMPLATE = "c0det111-1111-4000-8000-0000000000t1".replace(/t/g, "1");

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(scheduledNotifications).where(eq(scheduledNotifications.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

function future(minutes = 60): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function deliver(
  topic: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerSchedulingConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: "corr-sched-1", schemaVersion: "1.0", payload,
  });
  await q.drain();
  return q;
}

async function scheduleById(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(scheduledNotifications).where(eq(scheduledNotifications.id, id))));
  return rows[0];
}

async function outboxTopics(): Promise<string[]> {
  // _outbox.messages is FORCE RLS — this read needs a tenant context.
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  return rows.map((r) => r.topic).sort();
}

/** Insert a schedule row directly, bypassing the consumer, at a chosen time/status. */
async function seedSchedule(
  id: string, scheduledAt: Date, status = "scheduled", version = 1,
): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(scheduledNotifications).values({
      id, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", recipientId: null,
      channel: "email", priority: "normal", variables: { name: "Asha" },
      scheduledAt, status, createdBy: ACTOR, updatedBy: ACTOR, version,
    });
  }));
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("scheduling consumer — create", () => {
  const ID = "c0de5001-1111-4000-8000-000000000501";

  it("persists a schedule with defaults applied for the optional fields", async () => {
    const at = future();
    const q = await deliver(COMMANDS.scheduleNotification, "c0def001-1111-4000-8000-000000000101", {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", channel: "email", scheduledAt: at,
    });

    expect(q.dlq).toHaveLength(0);
    const row = await scheduleById(ID);
    expect(row?.status).toBe("scheduled");
    expect(row?.priority).toBe("normal");   // defaulted
    expect(row?.recipientId).toBeNull();    // defaulted
    expect(row?.variables).toEqual({});     // defaulted
    expect(row?.version).toBe(1);
  });

  it("honours explicitly supplied priority, recipientId and variables", async () => {
    const RECIP = "c0de9999-1111-4000-8000-000000000999";
    const q = await deliver(COMMANDS.scheduleNotification, "c0def001-1111-4000-8000-000000000102", {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", recipientId: RECIP, channel: "sms",
      priority: "high", variables: { code: "1234" }, scheduledAt: future(),
    });

    expect(q.dlq).toHaveLength(0);
    const row = await scheduleById(ID);
    expect(row?.priority).toBe("high");
    expect(row?.recipientId).toBe(RECIP);
    expect(row?.variables).toEqual({ code: "1234" });
    expect(row?.channel).toBe("sms");
  });

  it("emits the scheduled event plus an audit event", async () => {
    await deliver(COMMANDS.scheduleNotification, "c0def001-1111-4000-8000-000000000103", {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", channel: "email", scheduledAt: future(),
    });
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.scheduled].sort());
  });

  it("dead-letters a schedule in the past", async () => {
    const q = await deliver(COMMANDS.scheduleNotification, "c0def001-1111-4000-8000-000000000104", {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", channel: "email",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_SCHEDULE");
    expect(await scheduleById(ID)).toBeUndefined();
    expect(await outboxTopics()).toEqual([]);
  });

  it("dead-letters an unparseable scheduledAt", async () => {
    const q = await deliver(COMMANDS.scheduleNotification, "c0def001-1111-4000-8000-000000000105", {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", channel: "email", scheduledAt: "not-a-date",
    });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_SCHEDULE");
    expect(await scheduleById(ID)).toBeUndefined();
  });

  it("is idempotent — the same messageId twice inserts one row", async () => {
    const MSG = "c0def001-1111-4000-8000-000000000106";
    const body = {
      id: ID, tenantId: TENANT, templateId: TEMPLATE,
      recipient: "ops@example.test", channel: "email", scheduledAt: future(),
    };
    await deliver(COMMANDS.scheduleNotification, MSG, body);
    // Without the markProcessed guard the second insert would raise a duplicate
    // primary key; a clean DLQ proves the guard short-circuited it.
    const q2 = await deliver(COMMANDS.scheduleNotification, MSG, body);
    expect(q2.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.scheduled].sort());
  });
});

describe("scheduling consumer — cancel", () => {
  const ID = "c0de5002-1111-4000-8000-000000000502";

  it("cancels a scheduled notification and bumps the version", async () => {
    await seedSchedule(ID, new Date(Date.now() + 3_600_000));
    const q = await deliver(COMMANDS.cancelSchedule, "c0def002-1111-4000-8000-000000000201",
      { id: ID, tenantId: TENANT });

    expect(q.dlq).toHaveLength(0);
    const row = await scheduleById(ID);
    expect(row?.status).toBe("cancelled");
    expect(row?.version).toBe(2);
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.scheduleCancelled].sort());
  });

  it("cancelling something that does not exist is a silent no-op, not a failure", async () => {
    const q = await deliver(COMMANDS.cancelSchedule, "c0def002-1111-4000-8000-000000000202",
      { id: "c0de5999-1111-4000-8000-000000000599", tenantId: TENANT });

    expect(q.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual([]);
  });

  it("cancelling an already-cancelled schedule is a no-op (status filter)", async () => {
    await seedSchedule(ID, new Date(Date.now() + 3_600_000), "cancelled");
    const q = await deliver(COMMANDS.cancelSchedule, "c0def002-1111-4000-8000-000000000203",
      { id: ID, tenantId: TENANT });

    expect(q.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual([]);
    expect((await scheduleById(ID))?.version).toBe(1);
  });

  it("cannot cancel a schedule already claimed for sending (status='queued')", async () => {
    await seedSchedule(ID, new Date(Date.now() - 1000), "queued");
    const q = await deliver(COMMANDS.cancelSchedule, "c0def002-1111-4000-8000-000000000204",
      { id: ID, tenantId: TENANT });

    expect(q.dlq).toHaveLength(0);
    expect((await scheduleById(ID))?.status).toBe("queued");
  });
});

describe("scheduling sweeper — claim and dispatch", () => {
  const ID = "c0de5003-1111-4000-8000-000000000503";

  it("dispatches a due schedule and flips it to queued", async () => {
    await seedSchedule(ID, new Date(Date.now() - 60_000));
    const q = new MemoryQueue();
    const dispatched = await sweepDueSchedules(q, new Date());

    expect(dispatched).toBeGreaterThanOrEqual(1);
    expect((await scheduleById(ID))?.status).toBe("queued");
    expect((await scheduleById(ID))?.version).toBe(2);
  });

  it("publishes a sendNotification command carrying the schedule payload", async () => {
    await seedSchedule(ID, new Date(Date.now() - 60_000));
    const published: Array<{ topic: string; payload: unknown }> = [];
    const q = new MemoryQueue();
    q.subscribe(COMMANDS.sendNotification, async (msg) => {
      published.push({ topic: COMMANDS.sendNotification, payload: (msg as { payload: unknown }).payload });
    });
    await q.start();
    await sweepDueSchedules(q, new Date());
    await q.drain();

    const mine = published.find((p) =>
      (p.payload as { templateId?: string }).templateId === TEMPLATE);
    expect(mine).toBeDefined();
    expect(mine?.payload).toMatchObject({
      templateId: TEMPLATE, recipient: "ops@example.test",
      channel: "email", priority: "normal", variables: { name: "Asha" },
    });
  });

  it("leaves a not-yet-due schedule alone", async () => {
    await seedSchedule(ID, new Date(Date.now() + 3_600_000));
    const q = new MemoryQueue();
    await sweepDueSchedules(q, new Date());
    expect((await scheduleById(ID))?.status).toBe("scheduled");
  });

  it("a second sweeper losing the optimistic-lock race does not double-dispatch", async () => {
    await seedSchedule(ID, new Date(Date.now() - 60_000));
    const q = new MemoryQueue();

    // First sweep claims the row (version 1 → 2).
    await sweepDueSchedules(q, new Date());
    // A concurrent sweeper still holding the stale version-1 view must fail to claim.
    const claimedAgain = await runWithTenant(TENANT, () =>
      db.transaction((tx) => repo.claimSchedule(tx, ID, 1)));
    expect(claimedAgain).toBe(false);
  });

  it("claimSchedule refuses a row that is no longer in 'scheduled' status", async () => {
    await seedSchedule(ID, new Date(Date.now() - 60_000), "cancelled");
    const claimed = await runWithTenant(TENANT, () =>
      db.transaction((tx) => repo.claimSchedule(tx, ID, 1)));
    expect(claimed).toBe(false);
  });

  it("a publish failure leaves the row claimed and is swallowed for the next cycle", async () => {
    await seedSchedule(ID, new Date(Date.now() - 60_000));
    const q = new MemoryQueue();
    vi.spyOn(q, "publish").mockRejectedValue(new Error("broker unreachable"));

    // The sweeper must not throw — a broker outage is a retry-next-cycle concern.
    const dispatched = await sweepDueSchedules(q, new Date());
    expect(dispatched).toBe(0);
    // Row stays claimed; operators replay from 'queued' rather than double-send.
    expect((await scheduleById(ID))?.status).toBe("queued");
    vi.restoreAllMocks();
  });

  it("returns 0 when nothing is due", async () => {
    const q = new MemoryQueue();
    // Sweep as of the distant past: no row in any tenant can be due.
    expect(await sweepDueSchedules(q, new Date(0))).toBe(0);
  });
});

describe("scheduling sweeper — interval wiring", () => {
  it("startScheduleSweeper returns a timer that can be cleared", () => {
    const q = new MemoryQueue();
    const timer = startScheduleSweeper(q, 60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("the interval callback runs a sweep and swallows failures", async () => {
    vi.useFakeTimers();
    const q = new MemoryQueue();
    const spy = vi.spyOn(repo, "findDueSchedules").mockRejectedValue(new Error("db down"));
    const timer = startScheduleSweeper(q, 1000);

    await vi.advanceTimersByTimeAsync(1100);
    expect(spy).toHaveBeenCalled();  // fired, and the rejection did not escape

    clearInterval(timer);
    vi.useRealTimers();
    spy.mockRestore();
  });
});

describe("scheduling — tenant isolation", () => {
  const ID = "c0de5004-1111-4000-8000-000000000504";

  it("another tenant cannot see the schedule under FORCE RLS", async () => {
    await seedSchedule(ID, new Date(Date.now() + 3_600_000));
    const other = "c0de0002-2222-4000-8000-000000000002";
    const rows = await runWithTenant(other, () => db.transaction((tx) =>
      tx.select().from(scheduledNotifications).where(and(
        eq(scheduledNotifications.id, ID),
        eq(scheduledNotifications.tenantId, TENANT),
      ))));
    expect(rows).toHaveLength(0);
  });
});
