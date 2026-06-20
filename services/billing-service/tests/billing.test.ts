import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { billingPlans } from "../src/modules/plans/schema.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { shouldSkipInvoiceGeneration } from "../src/modules/invoices/domain.js";
import { trialExpiresAt, TRIAL_DAYS } from "../src/modules/subscriptions/domain.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const PLAN_GOV = "22222222-bbbb-4000-8000-000000000001";
const SUB_ID = "33333333-cccc-4000-8000-000000000002";
const INV_ID = "44444444-dddd-4000-8000-000000000003";
const MSG_ID = "55555555-eeee-4000-8000-000000000004";

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(billingInvoices).where(eq(billingInvoices.tenantId, TENANT));
  await db.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, TENANT));
  await db.delete(billingPlans).where(eq(billingPlans.id, PLAN_GOV));
  await db.delete(processed).where(eq(processed.messageId, MSG_ID));
}

describe("invoices domain — govt exempt (pure)", () => {
  it("govt_exempt=true skips invoice generation", () => {
    expect(shouldSkipInvoiceGeneration(true)).toBe(true);
    expect(shouldSkipInvoiceGeneration(false)).toBe(false);
  });
});

describe("subscriptions domain — trial expiry (pure)", () => {
  it("trial expires 30 days after start", () => {
    const start = new Date("2025-06-01T00:00:00Z");
    const expires = trialExpiresAt(start);
    expect(expires.getTime() - start.getTime()).toBe(TRIAL_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe("invoice consumer — govt exempt skip (integration)", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(billingPlans).values({
      id: PLAN_GOV, name: "Govt Plan", code: "govt-free", priceMinor: 10000n,
      govtExempt: true, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(billingSubscriptions).values({
      id: SUB_ID, tenantId: TENANT, planId: PLAN_GOV, status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });

  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("govt_exempt plan skips invoice row creation", async () => {
    const q = new MemoryQueue();
    registerInvoicesConsumers(q);
    await q.start();

    await q.publish("billing.invoice.generate", {
      messageId: MSG_ID, type: "billing.invoice.generate", tenantId: TENANT,
      actorId: ACTOR, correlationId: "corr-invoice-skip", schemaVersion: "1.0",
      payload: { id: INV_ID, tenantId: TENANT, periodMonth: "2025-06", govtExempt: true, totalMinor: 0 },
    });

    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const invoices = await db.select().from(billingInvoices).where(eq(billingInvoices.id, INV_ID));
    expect(invoices).toHaveLength(0);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
    const skipped = outbox.find((r) => (r.payload as Record<string, unknown>).action === "invoice_skipped_govt_exempt");
    expect(skipped).toBeDefined();
  });
});
