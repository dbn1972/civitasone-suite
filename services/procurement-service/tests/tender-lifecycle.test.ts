/**
 * procurement-service — competitive tender lifecycle (integration)
 *
 * Drives the GFR two-bid process end-to-end through the real consumers on a
 * MemoryQueue, against the real Postgres test DB:
 *
 *   create → publish → bid(×N, sealed financials) → technical-evaluation →
 *   open-financial → award (L1) → emits procurement.po.create
 *
 * Covers the rubric gaps:
 *   - Domain completeness: full L1 competitive flow, sealed-envelope integrity.
 *   - Edge cases/concurrency: no double-award (awarded is terminal); sealed
 *     financials withheld until opened; blacklisted bidder excluded from L1.
 *   - Security/SoD: award approver must differ from creator AND tech-evaluator
 *     (in-txn defense-in-depth — the award is NOT recorded on violation).
 *   - Idempotency: re-delivering the award command does not re-award.
 *   - Tenant isolation: a foreign-tenant award command finds no tender.
 *   - Finance commitment: PO consumer calls finance for sanction availability
 *     and only writes the PO when funds are sufficient (2xx + available>=value).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import {
  procurementTenders, procurementTenderBids, procurementTenderFinancialBids,
} from "../src/modules/tender/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const TENANT = "77777777-1111-4000-8000-0000000000aa";
const OTHER_TENANT = "77777777-2222-4000-8000-0000000000bb";

// Distinct actors so SoD checks are meaningful.
const CREATOR  = "88888888-0000-4000-8000-000000000001";
const TECH_EVAL = "88888888-0000-4000-8000-000000000002";
const AWARDER  = "88888888-0000-4000-8000-000000000003";

// Three vendors: L2 (highest), L1 (lowest), and a blacklisted lowest bidder.
const V_L1     = "99999999-0000-4000-8000-000000000001";
const V_L2     = "99999999-0000-4000-8000-000000000002";
const V_BLACK  = "99999999-0000-4000-8000-000000000003";

function msg(type: string, payload: Record<string, unknown>, actorId = CREATOR, tenantId = TENANT) {
  return {
    messageId: randomUUID(), type, tenantId, actorId,
    correlationId: `corr-${type}`, schemaVersion: "1.0", payload,
  };
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function seedVendor(id: string, vendorType = "registered") {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({
      id, tenantId: TENANT, name: `Vendor ${id.slice(-2)}`,
      vendorType, mse: false, msme: false, kycStatus: "verified",
      createdBy: CREATOR, updatedBy: CREATOR,
    }).onConflictDoNothing();
  }));
}

async function wipeTenant(t: string) {
  await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, t));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, t));
    await tx.delete(procurementTenderFinancialBids).where(eq(procurementTenderFinancialBids.tenantId, t));
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, t));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, t));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, t));
  }));
}

/** Run the queue until all in-flight handlers settle, then stop. */
async function drain(q: MemoryQueue) {
  await new Promise<void>((r) => setTimeout(r, 400));
  await q.stop();
}

beforeAll(async () => {
  await wipeTenant(TENANT);
  await wipeTenant(OTHER_TENANT);
  await seedVendor(V_L1);
  await seedVendor(V_L2);
  await seedVendor(V_BLACK, "blacklisted");
});

afterAll(async () => {
  await wipeTenant(TENANT);
  await wipeTenant(OTHER_TENANT);
  await sqlClient.end();
});

describe("Tender lifecycle — full L1 competitive flow + SoD + finance commitment", () => {
  const tenderId = randomUUID();
  const bidL1 = randomUUID();
  const bidL2 = randomUUID();
  const bidBlack = randomUUID();
  // Bid closing far in the future so late-bid guard never trips.
  const closeDate = "2999-12-31";

  it("create → tender persisted as draft", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    registerPoConsumers(q);
    await q.start();
    // Rs 4,00,000 estimated → limited_tender band; we run an OPEN (advertised)
    // tender which is higher rigour, so band enforcement passes at the route.
    await q.publish(COMMANDS.tenderCreate, msg(COMMANDS.tenderCreate, {
      id: tenderId, tenantId: TENANT, title: "Supply of Laptops",
      type: "open", estimatedMinor: 40_000_000, emdAmountMinor: 0,
      bidClosingDate: closeDate,
    }));
    await drain(q);

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.createdBy).toBe(CREATOR);
  });

  it("publish → status published, tenderPublished emitted", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderPublish, msg(COMMANDS.tenderPublish, { id: tenderId, tenantId: TENANT }));
    await drain(q);

    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("published");
    const events = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))
    ))).map((r) => r.eventType);
    expect(events).toContain(EVENTS.tenderPublished);
  });

  it("bids submitted → sealed financial envelopes are WITHHELD (bidAmount=0 on technical row)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // L1 vendor bids LOWEST (Rs 3,50,000); L2 bids Rs 3,80,000; blacklisted bids LOWEST of all (Rs 3,00,000).
    await q.publish(COMMANDS.tenderBidSubmit, msg(COMMANDS.tenderBidSubmit, {
      id: bidL1, tenderId, tenantId: TENANT, vendorId: V_L1, vendorName: "L1 Co",
      technicalScore: 90, financialAmountMinor: 35_000_000,
    }));
    await q.publish(COMMANDS.tenderBidSubmit, msg(COMMANDS.tenderBidSubmit, {
      id: bidL2, tenderId, tenantId: TENANT, vendorId: V_L2, vendorName: "L2 Co",
      technicalScore: 85, financialAmountMinor: 38_000_000,
    }));
    await q.publish(COMMANDS.tenderBidSubmit, msg(COMMANDS.tenderBidSubmit, {
      id: bidBlack, tenderId, tenantId: TENANT, vendorId: V_BLACK, vendorName: "Black Co",
      technicalScore: 95, financialAmountMinor: 30_000_000,
    }));
    await drain(q);

    const bids = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderBids).where(eq(procurementTenderBids.tenderId, tenderId))
    ));
    expect(bids).toHaveLength(3);
    // SEALED integrity: financial value NOT surfaced onto technical row yet.
    for (const b of bids) expect(b.bidAmount).toBe(0n);
    const fins = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderFinancialBids).where(eq(procurementTenderFinancialBids.tenderId, tenderId))
    ));
    expect(fins).toHaveLength(3);
    for (const f of fins) expect(f.sealed).toBe(true);
  });

  it("duplicate bid from same vendor is rejected (no second bid row)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderBidSubmit, msg(COMMANDS.tenderBidSubmit, {
      id: randomUUID(), tenderId, tenantId: TENANT, vendorId: V_L1, vendorName: "L1 Co dup",
      technicalScore: 99, financialAmountMinor: 1,
    }));
    await drain(q);
    const bids = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderBids)
        .where(and(eq(procurementTenderBids.tenderId, tenderId), eq(procurementTenderBids.vendorId, V_L1)))
    ));
    expect(bids).toHaveLength(1);
  });

  it("technical-evaluation → all qualified, tech evaluator recorded, status technical_evaluation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderTechEvaluate, msg(COMMANDS.tenderTechEvaluate, {
      id: tenderId, tenantId: TENANT,
      results: [
        { bidId: bidL1, qualified: true, score: 90 },
        { bidId: bidL2, qualified: true, score: 85 },
        { bidId: bidBlack, qualified: true, score: 95 },
      ],
    }, TECH_EVAL));
    await drain(q);

    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("technical_evaluation");
    expect(t?.techEvaluatedBy).toBe(TECH_EVAL);
  });

  it("open-financial → envelopes unsealed for qualified bids, amounts surfaced", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderFinancialOpen, msg(COMMANDS.tenderFinancialOpen, { id: tenderId, tenantId: TENANT }, TECH_EVAL));
    await drain(q);

    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("financial_evaluation");
    const fins = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderFinancialBids).where(eq(procurementTenderFinancialBids.tenderId, tenderId))
    ));
    for (const f of fins) expect(f.sealed).toBe(false);
    const l1Bid = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderBids).where(eq(procurementTenderBids.id, bidL1))
    )))[0];
    expect(l1Bid?.bidAmount).toBe(35_000_000n); // now revealed
    expect(l1Bid?.financialOpened).toBe(true);
  });

  it("SoD: award by the tender CREATOR is rejected in-txn → tender stays unawarded", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // CREATOR attempts the award (consumer re-checks SoD as defense-in-depth).
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, { id: tenderId, tenantId: TENANT }, CREATOR));
    await drain(q);
    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("financial_evaluation"); // NOT awarded
    expect(t?.awardedVendorId).toBeNull();
  });

  it("SoD: award by the TECHNICAL EVALUATOR is rejected in-txn → tender stays unawarded", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, { id: tenderId, tenantId: TENANT }, TECH_EVAL));
    await drain(q);
    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("financial_evaluation");
  });

  it("tenant isolation: a foreign-tenant award command does not touch this tender", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // Award command scoped to OTHER_TENANT for the same tenderId → not found.
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, { id: tenderId, tenantId: OTHER_TENANT }, AWARDER, OTHER_TENANT));
    await drain(q);
    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("financial_evaluation"); // untouched
  });

  it("C2 sanction gate: a high-value award WITHOUT a sanctionRef is rejected in-txn → tender stays unawarded", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // AWARDER is SoD-clean, but award value > Rs 1,000 and no sanctionRef → SANCTION_REQUIRED.
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, { id: tenderId, tenantId: TENANT }, AWARDER));
    await drain(q);
    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("financial_evaluation"); // NOT awarded — sanction missing
    expect(t?.awardedVendorId).toBeNull();
  });

  it("award by distinct AWARDER → L1 = lowest ELIGIBLE bid (blacklisted excluded), po.create emitted", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // Award value (Rs 3,50,000) is above the SANCTION_REQUIRED floor (Rs 1,000),
    // so a sanctionRef MUST accompany the award or the consumer rejects it
    // in-txn (SANCTION_REQUIRED) to avoid divergence with the downstream PO gate.
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, {
      id: tenderId, tenantId: TENANT, sanctionRef: "finance_sanction:tender-award-1",
    }, AWARDER));
    await drain(q);

    const t = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, tenderId))
    )))[0];
    expect(t?.status).toBe("awarded");
    expect(t?.awardedBy).toBe(AWARDER);
    // Blacklisted vendor bid Rs 3,00,000 (lowest) but is EXCLUDED → L1 is V_L1 at Rs 3,50,000.
    expect(t?.awardedVendorId).toBe(V_L1);
    expect(t?.awardedBidId).toBe(bidL1);

    const l1 = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderBids).where(eq(procurementTenderBids.id, bidL1))
    )))[0];
    expect(l1?.isL1).toBe(true);
    expect(l1?.rank).toBe(1);
    const black = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementTenderBids).where(eq(procurementTenderBids.id, bidBlack))
    )))[0];
    expect(black?.isL1).toBe(false); // excluded, never ranked #1

    // Award emits a PO create command + tenderAwarded event into the outbox.
    const events = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))
    ))).map((r) => r.eventType);
    expect(events).toContain(EVENTS.tenderAwarded);
    expect(events).toContain(COMMANDS.poCreate);
  });

  it("idempotency: re-delivering the award command does not double-award (no extra outbox po.create)", async () => {
    const before = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, COMMANDS.poCreate)))
    ))).length;
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    // awarded is a terminal state — a fresh award command must be rejected by the
    // transition guard (INVALID_TRANSITION), producing no new po.create.
    await q.publish(COMMANDS.tenderAward, msg(COMMANDS.tenderAward, { id: tenderId, tenantId: TENANT }, AWARDER));
    await drain(q);
    const after = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, COMMANDS.poCreate)))
    ))).length;
    expect(after).toBe(before);
  });
});

describe("Finance commitment — PO consumer calls finance for sanction availability", () => {
  const SANCTIONED_PO = randomUUID();
  const REJECTED_PO = randomUUID();
  const vendorId = "99999999-0000-4000-8000-0000000000f1";

  beforeAll(async () => {
    await seedVendor(vendorId);
  });

  it("finance returns available >= total (2xx) → PO is written", async () => {
    const originalFetch = global.fetch;
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    global.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledHeaders = (init?.headers ?? {}) as Record<string, string>;
      return { ok: true, status: 200, json: async () => ({ available: "100000000" }) } as unknown as Response;
    }) as typeof fetch;

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();
    await q.publish(COMMANDS.poCreate, msg(COMMANDS.poCreate, {
      id: SANCTIONED_PO, tenantId: TENANT, poNo: "AUTO", vendorId,
      indentRef: "tender:finance-test", sanctionRef: "finance_sanction:abc-123",
      items: [{ itemCode: "X", description: "Item", quantity: 1, unit: "nos", unitPriceMinor: 35_000_000, itemType: "service" }],
    }));
    await new Promise<void>((r) => setTimeout(r, 400)); // settle create (queue stays running)

    const pos = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, SANCTIONED_PO))
    ));
    expect(pos).toHaveLength(1);
    // PO is created in `draft` (finance availability checked at create). It only
    // moves to `pending` when submitted to eOffice for administrative approval.
    expect(pos[0]?.status).toBe("draft");
    // Verify the finance call carried the internal + tenant headers (commitment scoping).
    expect(calledUrl).toContain("/v1/finance/sanctions/abc-123/available");
    expect(calledHeaders["x-internal"]).toBe("1");
    expect(calledHeaders["x-tenant-id"]).toBe(TENANT);

    // draft → pending via submit-for-approval (eOffice administrative approval).
    await q.publish(COMMANDS.poSubmitApproval, msg(COMMANDS.poSubmitApproval, { id: SANCTIONED_PO, tenantId: TENANT }));
    await new Promise<void>((r) => setTimeout(r, 400)); // settle submit
    await q.stop();
    global.fetch = originalFetch;

    const afterSubmit = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, SANCTIONED_PO))
    ));
    expect(afterSubmit[0]?.status).toBe("pending");
  });

  it("finance returns available < total → BUDGET_EXCEEDED emitted, PO NOT written", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ available: "100" }) }) as unknown as Response) as typeof fetch;

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();
    await q.publish(COMMANDS.poCreate, msg(COMMANDS.poCreate, {
      id: REJECTED_PO, tenantId: TENANT, poNo: "AUTO", vendorId,
      indentRef: "tender:finance-test-2", sanctionRef: "finance_sanction:def-456",
      items: [{ itemCode: "X", description: "Item", quantity: 1, unit: "nos", unitPriceMinor: 35_000_000, itemType: "service" }],
    }));
    await drain(q);
    global.fetch = originalFetch;

    const pos = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, REJECTED_PO))
    ));
    expect(pos).toHaveLength(0);
    const events = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))
    ))).map((r) => r.eventType);
    expect(events).toContain(EVENTS.poBudgetExceeded);
  });
});
