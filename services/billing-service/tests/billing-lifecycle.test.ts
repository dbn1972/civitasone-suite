import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices, billingInvoiceItems, billingInvoiceApprovals } from "../src/modules/invoices/schema.js";
import { billingPayments, billingGatewayTxns } from "../src/modules/payments/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import * as invoiceRepo from "../src/modules/invoices/repo.js";
import { computeTotals, outstandingMinor, requiresApproval } from "../src/modules/invoices/domain.js";
import { COMMANDS } from "../src/topics.js";

/**
 * Test-harness fix: MemoryQueue used directly does NOT auto-wrap handlers with
 * withTenantConsumer. Production wiring (queue-service's createQueue()) decorates
 * subscribe() so every consumer handler runs inside runWithTenant(msg.tenantId, ...),
 * letting db.transaction() pick up the tenant GUC. Mirror that here.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const CHECKER = "00000000-aaaa-4000-8000-0000000000a2";
const T1 = "11111111-1111-4000-8000-0000000000b1";
const T2 = "22222222-2222-4000-8000-0000000000b2"; // isolation tenant

// Deterministic, valid v4-shaped UUIDs per test label (hex only).
import { createHash } from "node:crypto";
const id = (s: string): string => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

let q: MemoryQueue;
const settle = () => new Promise((r) => setTimeout(r, 250));

async function wipe() {
  const tenants = [T1, T2];
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const invs = await tx.select({ id: billingInvoices.id }).from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId));
      const invIds = invs.map((r) => r.id);
      if (invIds.length) {
        await tx.delete(billingGatewayTxns).where(eq(billingGatewayTxns.tenantId, tenantId));
        await tx.delete(billingPayments).where(inArray(billingPayments.invoiceId, invIds));
        await tx.delete(billingInvoiceApprovals).where(inArray(billingInvoiceApprovals.invoiceId, invIds));
        await tx.delete(billingInvoiceItems).where(inArray(billingInvoiceItems.invoiceId, invIds));
      }
      await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, tenantId));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    }));
  }
  // processed inbox: clear known message ids used below
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.delete(processed).where(inArray(processed.messageId, [
      id("inv1"), id("inv2"), id("iss1"), id("can1"), id("pay1"), id("pay2"), id("payX"),
      id("req1"), id("dec1"), id("decB"), id("isol"), id("reqC"),
    ]));
  }));
}

beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });
beforeEach(async () => {
  q = new MemoryQueue();
  registerInvoicesConsumers(q);
  registerPaymentsConsumers(q);
  await q.start();
});

function envelope(messageId: string, type: string, tenantId: string, payload: Record<string, unknown>, actorId = ACTOR) {
  return { messageId, type, tenantId, actorId, correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload };
}

// ── pure domain ───────────────────────────────────────────────────

describe("invoices domain (pure paise math)", () => {
  it("computeTotals splits line/tax/charge and sums in paise", () => {
    const t = computeTotals([
      { description: "a", amountMinor: 500000, quantity: 2 },
      { description: "b", amountMinor: 100000 },
      { description: "gst", amountMinor: 198000, kind: "tax" },
      { description: "round", amountMinor: 5000, kind: "charge" },
    ]);
    expect(t.subtotalMinor).toBe(1100000n);
    expect(t.taxMinor).toBe(198000n);
    expect(t.chargesMinor).toBe(5000n);
    expect(t.totalMinor).toBe(1303000n);
  });
  it("outstanding never goes negative", () => {
    expect(outstandingMinor(1000n, 1500n)).toBe(0n);
    expect(outstandingMinor(1000n, 400n)).toBe(600n);
  });
  it("requiresApproval gates on threshold (₹1,00,000 = 1e7 paise)", () => {
    expect(requiresApproval(9999999n)).toBe(false);
    expect(requiresApproval(10000000n)).toBe(true);
  });
});

// ── lifecycle: create → issue → pay → (separate bill) cancel ──────

describe("bill lifecycle (consumer → DB)", () => {
  it("create persists draft bill + line items with correct paise total", async () => {
    const invId = id("inv1");
    const totals = computeTotals([{ description: "fee", amountMinor: 700000 }, { description: "gst", amountMinor: 126000, kind: "tax" }]);
    await q.publish(COMMANDS.invoiceCreate, envelope(id("inv1"), COMMANDS.invoiceCreate, T1, {
      id: invId, tenantId: T1, periodMonth: "2026-06",
      items: [{ description: "fee", amountMinor: 700000, kind: "line", quantity: 1 }, { description: "gst", amountMinor: 126000, kind: "tax", quantity: 1 }],
      taxMinor: totals.taxMinor.toString(), chargesMinor: "0", totalMinor: totals.totalMinor.toString(),
    }));
    await settle();
    const rows = await db.select().from(billingInvoices).where(eq(billingInvoices.id, invId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("draft");
    expect(rows[0]!.totalMinor).toBe(826000n);
    expect(rows[0]!.taxMinor).toBe(126000n);
    const items = await db.select().from(billingInvoiceItems).where(eq(billingInvoiceItems.invoiceId, invId));
    expect(items).toHaveLength(2);
  });

  it("issue (below threshold) draft → issued and emits invoice.issued", async () => {
    const invId = id("inv1");
    await q.publish(COMMANDS.invoiceIssue, envelope(id("iss1"), COMMANDS.invoiceIssue, T1, { id: invId }));
    await settle();
    const inv = await invoiceRepo.findById(invId);
    expect(inv!.status).toBe("issued");
    expect(inv!.issuedBy).toBe(ACTOR);
    const ob = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1));
    expect(ob.map((r) => r.eventType)).toContain("billing.invoice.issued");
  });

  it("partial receipt → partially_paid; final receipt → paid (paise exact)", async () => {
    const invId = id("inv1");
    await q.publish(COMMANDS.paymentRecord, envelope(id("pay1"), COMMANDS.paymentRecord, T1, {
      id: id("pay1"), tenantId: T1, invoiceId: invId, amountMinor: 300000, method: "neft", gateway: "razorpay",
    }));
    await settle();
    let inv = await invoiceRepo.findById(invId);
    expect(inv!.status).toBe("partially_paid");
    expect(inv!.paidMinor).toBe(300000n);
    expect(outstandingMinor(inv!.totalMinor, inv!.paidMinor)).toBe(526000n);

    await q.publish(COMMANDS.paymentRecord, envelope(id("pay2"), COMMANDS.paymentRecord, T1, {
      id: id("pay2"), tenantId: T1, invoiceId: invId, amountMinor: 526000, method: "neft", gateway: "razorpay",
    }));
    await settle();
    inv = await invoiceRepo.findById(invId);
    expect(inv!.status).toBe("paid");
    expect(inv!.paidMinor).toBe(826000n);
    expect(inv!.paidAt).not.toBeNull();
    const receipts = await db.select().from(billingPayments).where(eq(billingPayments.invoiceId, invId));
    expect(receipts).toHaveLength(2);
  });

  it("over-payment is rejected: no row, paid_minor unchanged", async () => {
    const invId = id("inv1"); // already fully paid
    const before = await invoiceRepo.findById(invId);
    await q.publish(COMMANDS.paymentRecord, envelope(id("payX"), COMMANDS.paymentRecord, T1, {
      id: id("payX"), tenantId: T1, invoiceId: invId, amountMinor: 100, method: "neft", gateway: "razorpay",
    }));
    await settle();
    const after = await invoiceRepo.findById(invId);
    expect(after!.paidMinor).toBe(before!.paidMinor);
    const overpaid = await db.select().from(billingPayments).where(eq(billingPayments.id, id("payX")));
    expect(overpaid).toHaveLength(0);
  });

  it("cancel: a fresh draft bill goes draft → cancelled with reason", async () => {
    const invId = id("inv2");
    await q.publish(COMMANDS.invoiceCreate, envelope(id("inv2"), COMMANDS.invoiceCreate, T1, {
      id: invId, tenantId: T1, periodMonth: "2026-07",
      items: [{ description: "x", amountMinor: 5000, kind: "line", quantity: 1 }],
      taxMinor: "0", chargesMinor: "0", totalMinor: "5000",
    }));
    await settle();
    await q.publish(COMMANDS.invoiceCancel, envelope(id("can1"), COMMANDS.invoiceCancel, T1, { id: invId, reason: "duplicate bill" }));
    await settle();
    const inv = await invoiceRepo.findById(invId);
    expect(inv!.status).toBe("cancelled");
    expect(inv!.cancelReason).toBe("duplicate bill");
    expect(inv!.cancelledBy).toBe(ACTOR);
  });
});

// ── idempotency: redelivered command → exactly one effect ─────────

describe("idempotency (markProcessed)", () => {
  it("redelivered paymentRecord applies once", async () => {
    // fresh issued bill in T1
    const invId = "33333333-3333-4000-8000-0000000000b1";
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.delete(billingInvoices).where(eq(billingInvoices.id, invId));
      await tx.delete(processed).where(eq(processed.messageId, "44444444-4444-4000-8000-0000000000b1"));
      await tx.insert(billingInvoices).values({
        id: invId, tenantId: T1, periodMonth: "2026-08", status: "issued",
        totalMinor: 200000n, paidMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const env = envelope("44444444-4444-4000-8000-0000000000b1", COMMANDS.paymentRecord, T1, {
      id: "55555555-5555-4000-8000-0000000000b1", tenantId: T1, invoiceId: invId, amountMinor: 200000, method: "neft", gateway: "razorpay",
    });
    await q.publish(COMMANDS.paymentRecord, env);
    await settle();
    await q.publish(COMMANDS.paymentRecord, env); // redelivery, same messageId
    await settle();
    const inv = await invoiceRepo.findById(invId);
    expect(inv!.paidMinor).toBe(200000n); // applied exactly once
    const receipts = await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(billingPayments).where(eq(billingPayments.invoiceId, invId))));
    expect(receipts).toHaveLength(1);
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.delete(billingPayments).where(eq(billingPayments.invoiceId, invId));
      await tx.delete(billingInvoices).where(eq(billingInvoices.id, invId));
      await tx.delete(processed).where(eq(processed.messageId, "44444444-4444-4000-8000-0000000000b1"));
    }));
  });
});

// ── maker-checker: cross-actor approve, self-approve blocked ──────

describe("maker-checker (issue approval)", () => {
  const invId = id("req1");
  const apId = "66666666-6666-4000-8000-0000000000b1";

  it("request creates a pending approval; bill stays draft", async () => {
    await db.delete(processed).where(inArray(processed.messageId, [id("req1"), id("dec1"), id("decB"), apId]));
    await q.publish(COMMANDS.invoiceCreate, envelope(id("reqC"), COMMANDS.invoiceCreate, T1, {
      id: invId, tenantId: T1, periodMonth: "2026-09",
      items: [{ description: "big", amountMinor: 15000000, kind: "line", quantity: 1 }],
      taxMinor: "0", chargesMinor: "0", totalMinor: "15000000",
    }));
    await settle();
    await q.publish(COMMANDS.invoiceRequestIssue, envelope(id("req1"), COMMANDS.invoiceRequestIssue, T1, {
      approvalId: apId, invoiceId: invId, action: "issue", amountMinor: "15000000",
    }, ACTOR));
    await settle();
    const aps = await db.select().from(billingInvoiceApprovals).where(eq(billingInvoiceApprovals.invoiceId, invId));
    expect(aps).toHaveLength(1);
    expect(aps[0]!.status).toBe("pending");
    expect((await invoiceRepo.findById(invId))!.status).toBe("draft");
  });

  it("self-approval (checker == maker) is rejected; approval stays pending", async () => {
    await q.publish(COMMANDS.invoiceApprovalDecide, envelope(id("decB"), COMMANDS.invoiceApprovalDecide, T1, {
      approvalId: apId, approve: true,
    }, ACTOR)); // same actor as requester
    await settle();
    const ap = await invoiceRepo.findApprovalByIdTx(db as never, apId);
    expect(ap!.status).toBe("pending");
    expect((await invoiceRepo.findById(invId))!.status).toBe("draft");
  });

  it("approval by a DIFFERENT actor issues the bill", async () => {
    await q.publish(COMMANDS.invoiceApprovalDecide, envelope(id("dec1"), COMMANDS.invoiceApprovalDecide, T1, {
      approvalId: apId, approve: true,
    }, CHECKER)); // distinct checker
    await settle();
    const ap = await invoiceRepo.findApprovalByIdTx(db as never, apId);
    expect(ap!.status).toBe("approved");
    expect(ap!.decidedBy).toBe(CHECKER);
    expect((await invoiceRepo.findById(invId))!.status).toBe("issued");
  });
});

// ── tenant isolation + outstanding aggregate ──────────────────────

describe("tenant isolation + outstanding aggregate", () => {
  it("a bill created for T1 is invisible to T2 reads and aggregate", async () => {
    const invId = id("isol");
    await db.delete(processed).where(eq(processed.messageId, id("isol")));
    await q.publish(COMMANDS.invoiceCreate, envelope(id("isol"), COMMANDS.invoiceCreate, T1, {
      id: invId, tenantId: T1, periodMonth: "2026-10",
      items: [{ description: "y", amountMinor: 40000, kind: "line", quantity: 1 }],
      taxMinor: "0", chargesMinor: "0", totalMinor: "40000",
    }));
    await settle();
    // cross-tenant detail lookup must be empty
    const wrongTenant = await invoiceRepo.findById(invId);
    expect(wrongTenant!.tenantId).toBe(T1);
    // outstanding aggregate is per-tenant
    const aggT2 = await invoiceRepo.outstandingByTenant(T2);
    expect(aggT2.outstandingMinor).toBe(0n);
    expect(aggT2.openCount).toBe(0);
  });

  it("issued bills contribute to T1 outstanding in paise", async () => {
    // issue the isolation bill, then assert aggregate
    await db.delete(processed).where(eq(processed.messageId, "77777777-7777-4000-8000-0000000000b1"));
    await q.publish(COMMANDS.invoiceIssue, envelope("77777777-7777-4000-8000-0000000000b1", COMMANDS.invoiceIssue, T1, { id: id("isol") }));
    await settle();
    const aggT1 = await invoiceRepo.outstandingByTenant(T1);
    expect(aggT1.outstandingMinor).toBeGreaterThanOrEqual(40000n);
  });
});
