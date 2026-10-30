/**
 * Revenue decide guards — refund / write-off / waiver / remission decide.
 *
 * Covers the rescan findings (real DB, no mocks of db/consumers/routes):
 *  1. a decided refund / write-off can never be re-applied (double decide is a
 *     no-op; reject-then-approve does not apply the DCB entry)
 *  2. the decide routes answer 409 SYNCHRONOUSLY for self-approval and for an
 *     item that is not pending, instead of 202 + a silent consumer failure
 *  3. write-off approve re-checks the outstanding balance in the transaction,
 *     so pending write-offs approved together cannot exceed it
 *  4. a refund approval posts its DCB entry on the refunded receipt's demand
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { receipts, refunds } from "../src/modules/collection/schema.js";
import { writeOffs } from "../src/modules/arrears/schema.js";
import { waivers } from "../src/modules/trade-license/schema.js";
import { assessments, dcbEntries, remissions } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dec10000-0000-4000-8000-00000000de01";
const ASSESSEE = "dec10000-0000-4000-8000-0000000000ae";
const DEMAND = "dec10000-0000-4000-8000-00000000de11";
const MAKER = "dec10000-0000-4000-8000-00000000a001";
const CHECKER = "dec10000-0000-4000-8000-0000000c0ec1";

const OUTSTANDING = 100_000n; // ₹1,000.00 outstanding on DEMAND

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, actorId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function clean() {
  await inTenant(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(refunds).where(eq(refunds.tenantId, TENANT));
    await tx.delete(receipts).where(eq(receipts.tenantId, TENANT));
    await tx.delete(writeOffs).where(eq(writeOffs.tenantId, TENANT));
    await tx.delete(waivers).where(eq(waivers.tenantId, TENANT));
    await tx.delete(remissions).where(eq(remissions.tenantId, TENANT));
    await tx.delete(assessments).where(eq(assessments.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
  });
}

async function seedDemand() {
  await inTenant(async (tx) => {
    await tx.insert(dcbEntries).values({
      tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND,
      entryType: "demand", amountMinor: OUTSTANDING, balanceMinor: OUTSTANDING,
      referenceType: "demand", narration: "decide-guards fixture", createdBy: MAKER,
    });
  });
}

async function seedRefund(status = "pending"): Promise<string> {
  return inTenant(async (tx) => {
    const [receipt] = await tx.insert(receipts).values({
      tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: 40_000n,
      channel: "counter", createdBy: MAKER, updatedBy: MAKER,
    }).returning({ id: receipts.id });
    const [refund] = await tx.insert(refunds).values({
      tenantId: TENANT, receiptId: receipt!.id, assesseeId: ASSESSEE, amountMinor: 40_000n,
      reason: "Duplicate payment", status, makerUserId: MAKER,
    }).returning({ id: refunds.id });
    return refund!.id;
  });
}

async function seedWriteOff(amount: bigint, status = "pending"): Promise<string> {
  return inTenant(async (tx) => {
    const [row] = await tx.insert(writeOffs).values({
      tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: amount,
      reason: "Uncollectable", status, makerUserId: MAKER,
    }).returning({ id: writeOffs.id });
    return row!.id;
  });
}

const entries = (type: string) =>
  inTenant((tx) => tx.select().from(dcbEntries).where(eq(dcbEntries.tenantId, TENANT)))
    .then((rows) => rows.filter((r) => r.entryType === type));

const refundRow = (id: string) =>
  inTenant((tx) => tx.select().from(refunds).where(eq(refunds.id, id))).then((r) => r[0]!);
const writeOffRow = (id: string) =>
  inTenant((tx) => tx.select().from(writeOffs).where(eq(writeOffs.id, id))).then((r) => r[0]!);

/** Audited decide refusals recorded in the outbox for a resource type. */
const refusals = (resourceType: string, outcome: string) =>
  inTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))
    .then((rows) => rows.filter((r) => {
      const p = r.payload as Record<string, unknown>;
      return r.topic === "audit.event.record" && p.action === "decide" &&
        p.resourceType === resourceType && p.outcome === outcome;
    }));

async function startConsumers(): Promise<MemoryQueue> {
  const q = wireTenantAwareQueue(new MemoryQueue()) as MemoryQueue;
  registerCollectionConsumers(q);
  registerArrearsConsumers(q);
  await q.start();
  return q;
}

beforeAll(clean);
beforeEach(async () => {
  await clean();
  await seedDemand();
});
afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("refund decide consumer — no re-apply (real DB)", () => {
  it("approve posts ONE refund DCB entry on the refunded receipt's demand (not the assessee id)", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();

    const rows = await entries("refund");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.demandId).toBe(DEMAND);
    expect(rows[0]!.demandId).not.toBe(ASSESSEE);
    expect(rows[0]!.balanceMinor).toBe(OUTSTANDING + 40_000n);
    expect((await refundRow(id)).status).toBe("approved");
    await q.stop();
  });

  it("a double decide is a no-op (second approve adds no entry)", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();

    expect(await entries("refund")).toHaveLength(1);
    expect((await refundRow(id)).status).toBe("approved");
    await q.stop();
  });

  it("reject then approve does not apply the refund", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: false }));
    await q.drain();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();

    expect(await entries("refund")).toHaveLength(0);
    expect((await refundRow(id)).status).toBe("rejected");
    await q.stop();
  });

  it("approve then reject leaves the approved refund approved", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: false }));
    await q.drain();

    expect(await entries("refund")).toHaveLength(1);
    expect((await refundRow(id)).status).toBe("approved");
    await q.stop();
  });

  it("the maker cannot decide their own refund (consumer defence in depth)", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, MAKER, { refundId: id, approve: true }));
    await q.drain();

    expect(q.dlq.length).toBeGreaterThan(0);
    expect(await entries("refund")).toHaveLength(0);
    expect((await refundRow(id)).status).toBe("pending");
    await q.stop();
  });
});

describe("write-off decide consumer — no re-apply, outstanding re-checked (real DB)", () => {
  it("a double decide is a no-op (second approve adds no entry)", async () => {
    const id = await seedWriteOff(60_000n);
    const q = await startConsumers();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true }));
    await q.drain();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true }));
    await q.drain();

    const rows = await entries("write_off");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.balanceMinor).toBe(OUTSTANDING - 60_000n);
    expect((await writeOffRow(id)).status).toBe("approved");
    await q.stop();
  });

  it("reject then approve does not apply the write-off", async () => {
    const id = await seedWriteOff(60_000n);
    const q = await startConsumers();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: false }));
    await q.drain();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true }));
    await q.drain();

    expect(await entries("write_off")).toHaveLength(0);
    expect((await writeOffRow(id)).status).toBe("rejected");
    await q.stop();
  });

  it("pending write-offs approved together cannot exceed the outstanding balance", async () => {
    // Each 70,000 was valid on its own against 100,000 at request time.
    const first = await seedWriteOff(70_000n);
    const second = await seedWriteOff(70_000n);
    const q = await startConsumers();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: first, approve: true }));
    await q.drain();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: second, approve: true }));
    await q.drain();

    const rows = await entries("write_off");
    expect(rows).toHaveLength(1); // only the first applied
    expect(rows[0]!.balanceMinor).toBe(30_000n); // never negative
    expect((await writeOffRow(first)).status).toBe("approved");
    expect((await writeOffRow(second)).status).toBe("pending"); // refused, not applied
    expect(q.dlq.length).toBe(0); // consumed (markProcessed kept), not redelivered forever
    expect(await refusals("write_off", "exceeds_outstanding")).toHaveLength(1); // audited
    await q.stop();
  });

  it("a single write-off over the outstanding balance is rejected on approve", async () => {
    const id = await seedWriteOff(OUTSTANDING + 1n);
    const q = await startConsumers();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true }));
    await q.drain();

    expect(await entries("write_off")).toHaveLength(0);
    expect((await writeOffRow(id)).status).toBe("pending");
    expect(q.dlq.length).toBe(0);
    expect(await refusals("write_off", "exceeds_outstanding")).toHaveLength(1);
    await q.stop();
  });

  it("an over-outstanding approve is consumed once: redelivery of the same message does nothing", async () => {
    const id = await seedWriteOff(OUTSTANDING + 1n);
    const q = await startConsumers();
    const msg = makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true });
    await q.publish(COMMANDS.writeOffDecide, msg);
    await q.drain();
    await q.publish(COMMANDS.writeOffDecide, msg);
    await q.drain();
    expect(await refusals("write_off", "exceeds_outstanding")).toHaveLength(1);
    await q.stop();
  });
});

describe("decide consumers audit refusals instead of silently no-oping (real DB)", () => {
  it("refund: deciding an already-decided refund records an already_decided audit event", async () => {
    const id = await seedRefund();
    const q = await startConsumers();
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: false }));
    await q.drain();
    expect(await refusals("refund", "already_decided")).toHaveLength(0);
    await q.publish(COMMANDS.refundDecide, makeMsg(COMMANDS.refundDecide, CHECKER, { refundId: id, approve: true }));
    await q.drain();
    expect(await refusals("refund", "already_decided")).toHaveLength(1);
    expect(await entries("refund")).toHaveLength(0);
    await q.stop();
  });

  it("write-off: deciding an already-decided write-off records an already_decided audit event", async () => {
    const id = await seedWriteOff(10_000n);
    const q = await startConsumers();
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: false }));
    await q.drain();
    expect(await refusals("write_off", "already_decided")).toHaveLength(0);
    await q.publish(COMMANDS.writeOffDecide, makeMsg(COMMANDS.writeOffDecide, CHECKER, { writeOffId: id, approve: true }));
    await q.drain();
    expect(await refusals("write_off", "already_decided")).toHaveLength(1);
    expect(await entries("write_off")).toHaveLength(0);
    await q.stop();
  });
});

// ── Routes: synchronous 409s ───────────────────────────────────────────────────

describe("decide routes answer 409 synchronously (real DB)", () => {
  let app: FastifyInstance;
  const tokenFor = (userId: string) =>
    ({ authorization: `Bearer ${signToken({ sub: userId, tid: TENANT, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}` });
  const AS_MAKER = tokenFor(MAKER);
  const AS_CHECKER = tokenFor(CHECKER);

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const decide = (url: string, headers: Record<string, string>, method: "PATCH" | "POST" = "PATCH") =>
    app.inject({ method, url, headers, payload: { approve: true, reason: "ok" } });

  describe("refund", () => {
    it("self-approval is 409 MAKER_CHECKER_VIOLATION", async () => {
      const id = await seedRefund();
      const res = await decide(`/v1/revenue/refunds/${id}/decide`, AS_MAKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("MAKER_CHECKER_VIOLATION");
    });
    it("an already-decided refund is 409 REFUND_NOT_PENDING (even for a distinct checker)", async () => {
      const id = await seedRefund("rejected");
      const res = await decide(`/v1/revenue/refunds/${id}/decide`, AS_CHECKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("REFUND_NOT_PENDING");
    });
    it("an unknown refund is 404 and a pending one by a distinct checker is 202", async () => {
      expect((await decide(`/v1/revenue/refunds/${randomUUID()}/decide`, AS_CHECKER)).statusCode).toBe(404);
      const id = await seedRefund();
      expect((await decide(`/v1/revenue/refunds/${id}/decide`, AS_CHECKER)).statusCode).toBe(202);
    });
  });

  describe("write-off", () => {
    it("self-approval is 409 MAKER_CHECKER_VIOLATION", async () => {
      const id = await seedWriteOff(10_000n);
      const res = await decide(`/v1/revenue/write-offs/${id}/decide`, AS_MAKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("MAKER_CHECKER_VIOLATION");
    });
    it("an already-decided write-off is 409 WRITE_OFF_NOT_PENDING", async () => {
      const id = await seedWriteOff(10_000n, "approved");
      const res = await decide(`/v1/revenue/write-offs/${id}/decide`, AS_CHECKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("WRITE_OFF_NOT_PENDING");
    });
    it("a pending write-off by a distinct checker is 202", async () => {
      const id = await seedWriteOff(10_000n);
      expect((await decide(`/v1/revenue/write-offs/${id}/decide`, AS_CHECKER)).statusCode).toBe(202);
    });
  });

  describe("waiver (POST and PATCH)", () => {
    async function seedWaiver(status = "pending"): Promise<string> {
      return inTenant(async (tx) => {
        const [row] = await tx.insert(waivers).values({
          tenantId: TENANT, demandId: DEMAND, amountMinor: 1_000n, reason: "Hardship", status, requestedBy: MAKER,
        }).returning({ id: waivers.id });
        return row!.id;
      });
    }
    it("self-approval is 409 on both verbs", async () => {
      const id = await seedWaiver();
      for (const method of ["PATCH", "POST"] as const) {
        const res = await decide(`/v1/revenue/waivers/${id}/decide`, AS_MAKER, method);
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("MAKER_CHECKER_VIOLATION");
      }
    });
    it("an already-decided waiver is 409 WAIVER_NOT_PENDING; pending by a distinct checker is 202", async () => {
      const decided = await seedWaiver("approved");
      const res = await decide(`/v1/revenue/waivers/${decided}/decide`, AS_CHECKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("WAIVER_NOT_PENDING");
      const pending = await seedWaiver();
      expect((await decide(`/v1/revenue/waivers/${pending}/decide`, AS_CHECKER)).statusCode).toBe(202);
    });
  });

  describe("remission", () => {
    // The assessment module has no local error handler, so the app-level shape applies: { code, message } (not { error: { code } }).
    const ASSESSMENT = "dec10000-0000-4000-8000-0000000a5e55";
    async function seedRemission(status = "pending") {
      // remit-decide 404s an unknown assessment (UAT B8-F68), so the remission needs a real one
      await inTenant((tx) =>
        tx.insert(assessments).values({
          id: ASSESSMENT, tenantId: TENANT, assesseeId: ASSESSEE, rateHeadId: ASSESSEE, financialYear: "2026-27",
          baseValue: 1_000_000n, exemptions: [], status: "active", createdBy: MAKER, updatedBy: MAKER,
        }).onConflictDoNothing(),
      );
      await inTenant((tx) =>
        tx.insert(remissions).values({
          tenantId: TENANT, assessmentId: ASSESSMENT, reason: "Hardship", remissionPercent: 10, status, makerUserId: MAKER,
        }),
      );
    }
    it("self-approval is 409 MAKER_CHECKER_VIOLATION", async () => {
      await seedRemission();
      const res = await decide(`/v1/revenue/assessments/${ASSESSMENT}/remit-decide`, AS_MAKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    });
    it("no pending remission is 409 REMISSION_NOT_PENDING; pending by a distinct checker is 202", async () => {
      await seedRemission("approved");
      const res = await decide(`/v1/revenue/assessments/${ASSESSMENT}/remit-decide`, AS_CHECKER);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("REMISSION_NOT_PENDING");
      await seedRemission();
      expect((await decide(`/v1/revenue/assessments/${ASSESSMENT}/remit-decide`, AS_CHECKER)).statusCode).toBe(202);
    });
  });
});
