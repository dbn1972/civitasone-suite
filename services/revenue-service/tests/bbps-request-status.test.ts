/**
 * GAP-REVENUE-BBPS-02 — BBPS requests are no longer fire-and-forget. Each
 * fetch/pay command records a status row keyed by the queue messageId the route
 * returned to the client, so GET /v1/revenue/bbps/requests/:messageId can report
 * pending | success | failed, the resulting receiptId, and a failure reason.
 *
 * This fails on the old code, where bbps_transactions carried no message_id and
 * a failed payment left no visible trace (silent roll-back).
 *
 * DB-backed, no mocks: drives the real bbps consumers through a MemoryQueue
 * against the test Postgres and reads back via repo.findRequestByMessageId.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { bbpsTransactions } from "../src/modules/bbps/schema.js";
import { assessees } from "../src/modules/assessee/schema.js";
import { dcbEntries } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerBbpsConsumers } from "../src/modules/bbps/consumer.js";
import { findRequestByMessageId } from "../src/modules/bbps/repo.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "bb020000-0000-4000-8000-00000000bb02";
const ASSESSEE = "bb020000-0000-4000-8000-0000000000ee";
const DEMAND = "bb020000-0000-4000-8000-0000000de111";
const ACTOR = "bb020000-0000-4000-8000-0000000ac702";
const IDENTIFIER = "BBPS-STATUS-0001";
const OUTSTANDING = 500_000n; // ₹5,000.00

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, messageId: string, payload: Record<string, unknown>) {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(bbpsTransactions).where(eq(bbpsTransactions.tenantId, TENANT));
      await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
      await tx.delete(assessees).where(eq(assessees.tenantId, TENANT));
    }),
  );
}

async function seed() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(assessees).values({
        id: ASSESSEE, tenantId: TENANT, assesseeType: "property", identifierNo: IDENTIFIER,
        ownerName: "Status Payer", address: "1 Civic Rd", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND,
        entryType: "demand", amountMinor: OUTSTANDING, balanceMinor: OUTSTANDING,
        referenceType: "demand", narration: "BBPS-02 fixture", createdBy: ACTOR,
      });
    }),
  );
}

async function startConsumers(): Promise<MemoryQueue> {
  const q = wireTenantAwareQueue(new MemoryQueue()) as MemoryQueue;
  registerBbpsConsumers(q);
  await q.start();
  return q;
}

beforeAll(async () => { await clean(); });
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("BBPS request status read model (GAP-REVENUE-BBPS-02, real DB)", () => {
  it("a successful pay-bill records a status row keyed by messageId with status=success and a receiptId", async () => {
    const q = await startConsumers();
    const messageId = randomUUID();
    await q.publish(
      COMMANDS.bbpsPayBill,
      makeMsg(COMMANDS.bbpsPayBill, messageId, {
        assesseeIdentifier: IDENTIFIER, amountMinor: "100000", bbpsTxnId: `TXN-${messageId.slice(0, 8)}`, channel: "online",
      }),
    );
    await q.drain();

    const req = await findRequestByMessageId(TENANT, messageId);
    expect(req).not.toBeNull();
    expect(req!.status).toBe("success");
    expect(req!.messageId).toBe(messageId);
    expect(req!.requestType).toBe("pay");
    expect(req!.receiptId).toBeTruthy();

    await q.stop();
  });

  it("a pay-bill that exceeds the outstanding balance records status=failed with a reason (no silent roll-back)", async () => {
    const q = await startConsumers();
    const messageId = randomUUID();
    await q.publish(
      COMMANDS.bbpsPayBill,
      makeMsg(COMMANDS.bbpsPayBill, messageId, {
        assesseeIdentifier: IDENTIFIER, amountMinor: "9999999", bbpsTxnId: `TXN-${messageId.slice(0, 8)}`, channel: "online",
      }),
    );
    await q.drain();

    const req = await findRequestByMessageId(TENANT, messageId);
    expect(req).not.toBeNull();
    expect(req!.status).toBe("failed");
    expect(req!.failureReason).toBeTruthy();
    expect(req!.receiptId).toBeNull();

    await q.stop();
  });

  it("a pay-bill for an unknown assessee records status=failed (not a silent no-op)", async () => {
    const q = await startConsumers();
    const messageId = randomUUID();
    await q.publish(
      COMMANDS.bbpsPayBill,
      makeMsg(COMMANDS.bbpsPayBill, messageId, {
        assesseeIdentifier: "NO-SUCH-ID", amountMinor: "100000", bbpsTxnId: `TXN-${messageId.slice(0, 8)}`, channel: "online",
      }),
    );
    await q.drain();

    const req = await findRequestByMessageId(TENANT, messageId);
    expect(req).not.toBeNull();
    expect(req!.status).toBe("failed");

    await q.stop();
  });

  it("a fetch-bill records a pending status row keyed by messageId", async () => {
    const q = await startConsumers();
    const messageId = randomUUID();
    await q.publish(
      COMMANDS.bbpsFetchBill,
      makeMsg(COMMANDS.bbpsFetchBill, messageId, { assesseeIdentifier: IDENTIFIER }),
    );
    await q.drain();

    const req = await findRequestByMessageId(TENANT, messageId);
    expect(req).not.toBeNull();
    expect(req!.requestType).toBe("fetch");
    expect(req!.messageId).toBe(messageId);

    await q.stop();
  });
});
