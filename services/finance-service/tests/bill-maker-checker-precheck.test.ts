/**
 * GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03 -- the maker-checker / passer-payer rules on the bill money path, end to end
 * against real Postgres (RLS on, non-superuser service role):
 *
 *   - PATCH /v1/finance/bills/:id/approve  ("Pass bill")
 *       the officer who lodged the bill gets an immediate 409 MAKER_CHECKER_VIOLATION (not a 202 that only fails later in
 *       the queue); a different approver gets 202.
 *   - POST /v1/finance/payments/eft  ("Release payment")
 *       bill lodged by M and passed by A: M -> 409 MAKER_CHECKER_VIOLATION, A -> 409 PAYER_IS_PASSER, a third officer B is
 *       not refused (202).
 *   - the consumer stays authoritative: a creator's own approval that reaches the queue is dead-lettered and the bill is
 *     left exactly as it was; a different approver advances it.
 *   - GET /v1/finance/bills/:id carries createdBy, and passedBy only while the bill is passed, which is what the web uses
 *     to withhold the actions above.
 *
 * A refused request never changes the bill.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

// vitest.config.ts injects JWT_SECRET for the suite; no literal secret here (CI gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-00000000f206";
const MAKER = "00000000-aaaa-4000-8000-00000000f206";
const PASSER = "00000000-bbbb-4000-8000-00000000f206";
const THIRD = "00000000-cccc-4000-8000-00000000f206";
const VENDOR = "f2060000-aaaa-4000-8000-000000000001";
const HEAD = "f2060000-bbbb-4000-8000-000000000001";
const BILL_PENDING = "f2060000-cccc-4000-8000-000000000001";
const BILL_PASSED = "f2060000-cccc-4000-8000-000000000002";
const BILL_QUEUE = "f2060000-cccc-4000-8000-000000000003";
const ALL = [BILL_PENDING, BILL_PASSED, BILL_QUEUE];
const MSG_SELF = "f2060000-dddd-4000-8000-000000000001";
const MSG_OTHER = "f2060000-dddd-4000-8000-000000000002";
const CORR = "corr-f206-queue";

const token = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "sess-f206" }, SECRET);

function seedBill(id: string, status: string, stage: string, updatedBy: string) {
  return scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id, tenantId: TENANT, billNo: `BILL-${id.slice(-8)}`, vendorId: VENDOR, headId: HEAD,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    poRef: "po-f206", grnRef: "grn-f206",
    stage, status, createdBy: MAKER, updatedBy, version: 1,
  }));
}

async function readBill(id: string) {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, CORR)));
  for (const m of [MSG_SELF, MSG_OTHER]) await db.delete(processed).where(eq(processed.messageId, m));
  for (const id of ALL) await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, id)));
}

beforeEach(async () => {
  await clean();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "4706-F206", name: "Maker-checker route head", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
});
afterAll(async () => { await clean(); await sqlClient.end(); });

async function withApp<T>(fn: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<T>): Promise<T> {
  const app = await buildApp();
  try { return await fn(app); } finally { await app.close(); }
}

const approve = (id: string, sub: string) => withApp((app) => app.inject({
  method: "PATCH", url: `/v1/finance/bills/${id}/approve`,
  headers: { authorization: `Bearer ${token(sub, ["accounts_officer"])}`, "content-type": "application/json" },
  payload: {},
}));

const pay = (id: string, sub: string) => withApp((app) => app.inject({
  method: "POST", url: "/v1/finance/payments/eft",
  headers: { authorization: `Bearer ${token(sub, ["finance_officer"])}`, "content-type": "application/json" },
  payload: { billId: id, ddoCode: "DDO123", mode: "NEFT", amountMinor: "500000", reason: "Release payment for the passed bill" },
}));

describe("PATCH /v1/finance/bills/:id/approve -- the maker cannot pass their own bill", () => {
  it("409 MAKER_CHECKER_VIOLATION for the officer who lodged the bill, and the bill is untouched", async () => {
    await seedBill(BILL_PENDING, "pending", "section", MAKER);
    const res = await approve(BILL_PENDING, MAKER);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const bill = await readBill(BILL_PENDING);
    expect(bill?.status).toBe("pending");
    expect(bill?.stage).toBe("section");
    expect(bill?.version).toBe(1);
  });

  it("202 for a different approver", async () => {
    await seedBill(BILL_PENDING, "pending", "section", MAKER);
    const res = await approve(BILL_PENDING, PASSER);
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

describe("POST /v1/finance/payments/eft -- the lodger and the passer cannot release the payment", () => {
  it("bill lodged by M, passed by A: M -> 409 MAKER_CHECKER_VIOLATION, A -> 409 PAYER_IS_PASSER, B -> not refused", async () => {
    await seedBill(BILL_PASSED, "passed", "pay", PASSER);

    const asMaker = await pay(BILL_PASSED, MAKER);
    expect(asMaker.statusCode).toBe(409);
    expect(asMaker.json().code).toBe("MAKER_CHECKER_VIOLATION");

    const asPasser = await pay(BILL_PASSED, PASSER);
    expect(asPasser.statusCode).toBe(409);
    expect(asPasser.json().code).toBe("PAYER_IS_PASSER");

    const asThird = await pay(BILL_PASSED, THIRD);
    expect(asThird.statusCode).toBe(202);

    // the refusals changed nothing
    const bill = await readBill(BILL_PASSED);
    expect(bill?.status).toBe("passed");
    expect(bill?.updatedBy).toBe(PASSER);
  });
});

describe("the consumer stays authoritative for a self-approval that reaches the queue", () => {
  async function runApprove(messageId: string, actorId: string) {
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billApprove, {
      messageId, type: COMMANDS.billApprove, tenantId: TENANT, actorId, correlationId: CORR, schemaVersion: "1.0",
      payload: { id: BILL_QUEUE, tenantId: TENANT, expectedStage: "section" },
    });
    await q.drain();
    await q.stop();
    return q;
  }

  it("dead-letters the creator's own approval and leaves the bill as it was", async () => {
    await seedBill(BILL_QUEUE, "pending", "section", MAKER);
    const q = await runApprove(MSG_SELF, MAKER);
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER_VIOLATION/);
    const bill = await readBill(BILL_QUEUE);
    expect(bill?.status).toBe("pending");
    expect(bill?.stage).toBe("section");
  });

  it("advances the bill for a different approver", async () => {
    await seedBill(BILL_QUEUE, "pending", "section", MAKER);
    const q = await runApprove(MSG_OTHER, PASSER);
    expect(q.dlq.length).toBe(0);
    const bill = await readBill(BILL_QUEUE);
    expect(bill?.stage).toBe("accounts");
    expect(bill?.updatedBy).toBe(PASSER);
  });
});

describe("GET /v1/finance/bills/:id exposes the actors the web needs to withhold those actions", () => {
  const detail = (id: string) => withApp((app) => app.inject({
    method: "GET", url: `/v1/finance/bills/${id}`,
    headers: { authorization: `Bearer ${token(THIRD, ["audit_officer"])}` },
  }));

  it("returns createdBy, and passedBy only while the bill is passed", async () => {
    await seedBill(BILL_PENDING, "pending", "accounts", PASSER); // an earlier-stage approver is not "the passer"
    await seedBill(BILL_PASSED, "passed", "pay", PASSER);

    const pending = await detail(BILL_PENDING);
    expect(pending.statusCode).toBe(200);
    expect(pending.json().createdBy).toBe(MAKER);
    expect(pending.json().passedBy).toBeUndefined();

    const passed = await detail(BILL_PASSED);
    expect(passed.statusCode).toBe(200);
    expect(passed.json().createdBy).toBe(MAKER);
    expect(passed.json().passedBy).toBe(PASSER);
  });
});
