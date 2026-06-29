/**
 * R5 — the bill-approve gate enforces real tri-leg reconciliation end-to-end.
 *
 *  - a matched invoice (gross ≤ GRN ≤ PO) advances through approval
 *  - an over-billed invoice (gross ≫ GRN) is rejected (handler throws → bill
 *    stays at its current stage; the message lands in the DLQ)
 *  - the gate resolves PO/GRN amounts from the AP read-model when the bill row
 *    itself carries none (manual invoice citing a known GRN)
 *
 * Runs the real payments consumers against the dev DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { financeBills, financeGrnMatch } from "../src/modules/payments/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a5";
const ACTOR  = "00000000-aaaa-4000-8000-0000000000a5";
const VENDOR = "55555555-aaaa-4000-8000-000000000001";
const HEAD   = "55555555-bbbb-4000-8000-000000000001";

const MATCH_BILL = "55555555-cccc-4000-8000-000000000001";
const OVER_BILL  = "55555555-cccc-4000-8000-000000000002";
const PO_REF  = "procurement_po:po-a5";
const GRN_REF = "procurement_grn:grn-a5";

const MATCH_MSG = "55555555-dddd-4000-8000-000000000001";
const OVER_MSG  = "55555555-dddd-4000-8000-000000000002";

async function clean() {
  for (const c of [`corr-twm-match`, `corr-twm-over`]) {
    await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, c));
  }
  await db.delete(processed).where(eq(processed.messageId, MATCH_MSG));
  await db.delete(processed).where(eq(processed.messageId, OVER_MSG));
  await db.delete(financeBills).where(eq(financeBills.id, MATCH_BILL));
  await db.delete(financeBills).where(eq(financeBills.id, OVER_BILL));
  await db.delete(financeGrnMatch).where(eq(financeGrnMatch.tenantId, TENANT));
}

function seedBill(id: string, grossMinor: bigint, withSnapshot: boolean) {
  return db.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `BILL-${id.slice(0, 8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor, netMinor: grossMinor, currency: "INR", deductions: [],
    poRef: PO_REF, grnRef: GRN_REF,
    ...(withSnapshot ? { poAmountMinor: 100_000n, grnAmountMinor: 100_000n } : {}),
    stage: "section", status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  });
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  await clean();
  // AP read-model: PO 100000, GRN(accepted) 100000.
  await db.insert(financeGrnMatch).values({
    tenantId: TENANT, grnRef: GRN_REF, poRef: PO_REF, vendorId: VENDOR,
    poAmountMinor: 100_000n, grnAmountMinor: 100_000n,
  });
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("bill-approve 3-way match gate (R5)", () => {
  it("advances a matched invoice (gross == GRN == PO) past the gate", async () => {
    await seedBill(MATCH_BILL, 100_000n, true);
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.billApprove, {
      messageId: MATCH_MSG, type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-twm-match", schemaVersion: "1.0",
      payload: { id: MATCH_BILL, tenantId: TENANT },
    });

    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, MATCH_MSG))).length === 1);
    await q.stop();

    const bill = (await db.select().from(financeBills).where(eq(financeBills.id, MATCH_BILL)))[0];
    expect(bill?.stage).toBe("accounts"); // section → accounts (first approval)
    expect(q.dlq).toHaveLength(0);
  });

  it("rejects an over-billed invoice (gross ≫ GRN) — bill stays at section", async () => {
    // No snapshot on the bill: the gate must resolve PO/GRN from the read-model.
    await seedBill(OVER_BILL, 150_000n, false);
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.billApprove, {
      messageId: OVER_MSG, type: COMMANDS.billApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-twm-over", schemaVersion: "1.0",
      payload: { id: OVER_BILL, tenantId: TENANT },
    });

    await waitFor(async () => q.dlq.length === 1);
    await q.stop();

    const bill = (await db.select().from(financeBills).where(eq(financeBills.id, OVER_BILL)))[0];
    expect(bill?.stage).toBe("section"); // unchanged — gate blocked the transition
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/INVOICE_EXCEEDS_GRN/);
  });
});
