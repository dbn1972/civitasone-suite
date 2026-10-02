/**
 * GAP-FINANCE-PAYMENTS-DETAIL-03 (review H1): the submit-approval consumer must
 * never overwrite a blocked status, even when a release commits AFTER the
 * consumer's SELECT (check-then-write race). Real Postgres, no repo mocks.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import * as repo from "../src/modules/payments/repo.js";
import { PAYMENT_SUBMIT_BLOCKED_LIST } from "../src/modules/payments/domain.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = "70000000-0ba1-4000-8000-00000000c601";
const HEAD = randomUUID();
let headSeeded = false;

async function seed(status: string): Promise<string> {
  const id = randomUUID();
  const billId = randomUUID();
  if (!headSeeded) {
    await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "C6-HEAD", name: "Head", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
    headSeeded = true;
  }
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: billId, tenantId: TENANT, billNo: `B-${billId.slice(0, 8)}`, vendorId: randomUUID(), headId: HEAD,
    grossMinor: 100000n, netMinor: 100000n, status: "passed", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financePayments).values({
    id, tenantId: TENANT, billId, mode: "NEFT", amountMinor: 100000n, status,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}
const statusOf = async (id: string) =>
  (await scoped(TENANT, (tx) => tx.select({ s: financePayments.status }).from(financePayments).where(eq(financePayments.id, id))))[0]?.s;

afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(financePayments).where(eq(financePayments.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT)));
  await sqlClient.end();
});

describe("updatePaymentUnlessStatusIn (conditional UPDATE)", () => {
  it("updates an initiated payment and reports 1 row", async () => {
    const id = await seed("initiated");
    const n = await scoped(TENANT, (tx) => repo.updatePaymentUnlessStatusIn(tx, id, TENANT, PAYMENT_SUBMIT_BLOCKED_LIST, { status: "pending_approval", updatedBy: ACTOR }));
    expect(n).toBe(1);
    expect(await statusOf(id)).toBe("pending_approval");
  });

  it("does not touch a released payment (0 rows)", async () => {
    const id = await seed("released");
    const n = await scoped(TENANT, (tx) => repo.updatePaymentUnlessStatusIn(tx, id, TENANT, PAYMENT_SUBMIT_BLOCKED_LIST, { status: "pending_approval", updatedBy: ACTOR }));
    expect(n).toBe(0);
    expect(await statusOf(id)).toBe("released");
  });

  it("RACE: a release that commits between the consumer's SELECT and its UPDATE is NOT overwritten", async () => {
    const id = await seed("initiated");
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const consumerTx = scoped(TENANT, async (tx) => {
      const seen = await repo.findPaymentByIdTx(tx, id);
      expect(seen?.status).toBe("initiated"); // passes any check-then-write guard
      await gate; // ... the release commits here ...
      return repo.updatePaymentUnlessStatusIn(tx, id, TENANT, PAYMENT_SUBMIT_BLOCKED_LIST, { status: "pending_approval", updatedBy: ACTOR });
    });
    await scoped(TENANT, (tx) => tx.update(financePayments).set({ status: "released" }).where(eq(financePayments.id, id)));
    open();
    expect(await consumerTx).toBe(0);
    expect(await statusOf(id)).toBe("released");
  });
});

describe("COMMANDS.paymentSubmitApproval consumer (real DB)", () => {
  function queueFor(): MemoryQueue {
    const q = new MemoryQueue({ maxAttempts: 1 });
    const raw = q.subscribe.bind(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).subscribe = (topic: string, h: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => h(m)));
    return q;
  }
  const msg = (id: string) => ({
    messageId: randomUUID(), type: COMMANDS.paymentSubmitApproval, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: TENANT },
  });

  it("moves an initiated payment to pending_approval", async () => {
    const q = queueFor(); registerPaymentsConsumers(q); await q.start();
    const id = await seed("initiated");
    await q.publish(COMMANDS.paymentSubmitApproval, msg(id)); await q.drain();
    expect(q.dlq.length).toBe(0);
    expect(await statusOf(id)).toBe("pending_approval");
    await q.stop();
  });

  it("rejects (DLQ, NonRetryable) and leaves a released payment released", async () => {
    const q = queueFor(); registerPaymentsConsumers(q); await q.start();
    const id = await seed("released");
    await q.publish(COMMANDS.paymentSubmitApproval, msg(id)); await q.drain();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]!.error).toContain("PAYMENT_NOT_SUBMITTABLE");
    expect(await statusOf(id)).toBe("released");
    await q.stop();
  });
});

void db;
