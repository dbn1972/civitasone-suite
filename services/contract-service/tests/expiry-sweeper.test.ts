/**
 * Owner decision #42 — contract.expiry.alert daily sweeper.
 *
 * Live-DB test: contracts.contract_contracts is FORCE RLS and contract_svc is
 * NOBYPASSRLS, so the cross-tenant sweep goes through the SECURITY DEFINER
 * function contracts.sweep_expiring_contracts() (migration 0023). Seeds
 * contracts for two tenants, runs the real sweeper against a recording queue,
 * then drives the real consumer to prove the alert is emitted exactly once.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { runExpirySweep } from "../src/modules/expiry/sweeper.js";
import { registerExpiryConsumers } from "../src/modules/expiry/consumer.js";
import { EXPIRY_MILESTONES, expiryMessageId } from "../src/modules/expiry/domain.js";

const T1 = "e1e1e1e1-4242-4000-8000-000000000001";
const T2 = "e2e2e2e2-4242-4000-8000-000000000002";
const ACTOR = "00000000-4242-4000-8000-0000000000aa";

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const ids = {
  a30: randomUUID(), b29: randomUUID(), c7: randomUUID(),
  draft30: randomUUID(), expired: randomUUID(), other30: randomUUID(),
};

async function seed(tenantId: string, id: string, no: string, expiry: string, status: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(contractContracts).values({
      id, tenantId, contractNo: no, vendorId: randomUUID(), title: `Title ${no}`,
      valueMinor: 100000n, startDate: day(-400), expiry, status,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

async function wipe() {
  for (const t of [T1, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(contractContracts).where(eq(contractContracts.tenantId, t));
    }));
  }
}

type Published = { topic: string; msg: { messageId: string; tenantId: string; payload: Record<string, unknown> } };

function recorder(): { queue: Queue; published: Published[] } {
  const published: Published[] = [];
  const queue = {
    publish: async (topic: string, msg: Published["msg"]) => { published.push({ topic, msg }); },
  } as unknown as Queue;
  return { queue, published };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 400));

beforeAll(async () => {
  await wipe();
  await seed(T1, ids.a30, "EXP-A30", day(30), "active");
  await seed(T1, ids.b29, "EXP-B29", day(29), "active");
  await seed(T1, ids.c7, "EXP-C7", day(7), "active");
  await seed(T1, ids.draft30, "EXP-D30", day(30), "draft");
  await seed(T1, ids.expired, "EXP-EXP", day(-3), "active");
  await seed(T2, ids.other30, "EXP-T2-30", day(30), "active");
});
afterAll(wipe);

describe("expiry sweeper (cross-tenant, RLS-safe)", () => {
  it("milestones are the documented 90/60/30/15/7/1 schedule", () => {
    expect([...EXPIRY_MILESTONES]).toEqual([90, 60, 30, 15, 7, 1]);
  });

  it("publishes one contract.expiry.check per active contract on a milestone day, across tenants", async () => {
    const { queue, published } = recorder();
    await runExpirySweep(queue);
    const checks = published.filter((p) => p.topic === COMMANDS.contractExpiryCheck);
    const byContract = new Map(checks.map((p) => [p.msg.payload.contractId as string, p]));
    expect([...byContract.keys()].sort()).toEqual([ids.a30, ids.c7, ids.other30].sort());
    expect(byContract.get(ids.a30)!.msg.tenantId).toBe(T1);
    expect(byContract.get(ids.other30)!.msg.tenantId).toBe(T2);
    expect(byContract.get(ids.a30)!.msg.payload).toMatchObject({ milestoneDays: 30, expiry: day(30) });
    expect(byContract.get(ids.c7)!.msg.payload).toMatchObject({ milestoneDays: 7 });
  });

  it("is idempotent: the messageId is deterministic per contract+expiry+milestone", async () => {
    const r1 = recorder(); const r2 = recorder();
    await runExpirySweep(r1.queue); await runExpirySweep(r2.queue);
    const a = r1.published.map((p) => p.msg.messageId).sort();
    const b = r2.published.map((p) => p.msg.messageId).sort();
    expect(a).toEqual(b);
    expect(a).toContain(expiryMessageId(ids.a30, day(30), 30));
  });
});

describe("expiry consumer — emits contract.expiry.alert exactly once", () => {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  registerExpiryConsumers(q);

  async function alerts(tenantId: string) {
    return runWithTenant(tenantId, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, EVENTS.contractExpiryAlert),
      ))));
  }

  function cmd(tenantId: string, contractId: string, expiry: string, milestoneDays: number, messageId?: string) {
    const mid = messageId ?? expiryMessageId(contractId, expiry, milestoneDays);
    return q.publish(COMMANDS.contractExpiryCheck, {
      messageId: mid, type: COMMANDS.contractExpiryCheck, tenantId, actorId: ACTOR,
      correlationId: mid, schemaVersion: "1.0",
      payload: { contractId, expiry, milestoneDays },
    });
  }

  it("emits the alert (notification-service payload shape) once, even on redelivery", async () => {
    await cmd(T1, ids.a30, day(30), 30);
    await settle();
    await cmd(T1, ids.a30, day(30), 30); // same deterministic messageId
    await settle();
    const rows = await alerts(T1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      contractId: ids.a30, contractNo: "EXP-A30", title: "Title EXP-A30",
      endDate: day(30), daysRemaining: 30,
    });
    const claimed = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(processed).where(eq(processed.messageId, expiryMessageId(ids.a30, day(30), 30)))));
    expect(claimed).toHaveLength(1);
  });

  it("writes an audit event in the same transaction", async () => {
    const audit = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, T1), eq(outboxMessages.topic, "audit.event.record")))));
    expect(audit.some((r) => (r.payload as { action?: string; resourceId?: string }).action === "expiry_alert"
      && (r.payload as { resourceId?: string }).resourceId === ids.a30)).toBe(true);
  });

  it("skips a stale command: expiry was amended after the sweep", async () => {
    await cmd(T1, ids.c7, day(60), 60);
    await settle();
    const rows = (await alerts(T1)).filter((r) => (r.payload as { contractId?: string }).contractId === ids.c7);
    expect(rows).toHaveLength(0);
  });

  it("skips a contract that is no longer active", async () => {
    await cmd(T1, ids.draft30, day(30), 30);
    await settle();
    const rows = (await alerts(T1)).filter((r) => (r.payload as { contractId?: string }).contractId === ids.draft30);
    expect(rows).toHaveLength(0);
  });

  it("never reads another tenant's contract (RLS): T1 command for a T2 contract emits nothing", async () => {
    await cmd(T1, ids.other30, day(30), 30);
    await settle();
    const rows = (await alerts(T1)).filter((r) => (r.payload as { contractId?: string }).contractId === ids.other30);
    expect(rows).toHaveLength(0);
  });
});
