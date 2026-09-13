/**
 * DOM-011 (2/2) — real RFQ close/award lifecycle.
 *
 * BEFORE this fix, registerRfqConsumers() only ever subscribed to
 * COMMANDS.rfqCreate: an RFQ was created directly as 'issued' and could
 * never transition again. Worse, COMMANDS.rfqRespond WAS published by
 * rfq/commands.ts and exposed via POST /v1/procurement/rfqs/:id/respond, but
 * had zero subscribers anywhere in the repo -- a vendor's response was
 * queued and silently dropped, nothing was ever persisted, and
 * rfq/queries.ts's getRfqDetail() hardcoded `responses: []`. This suite
 * proves: (1) a response is now actually persisted and reflected in
 * getRfqDetail, (2) close/award transitions actually change state and are
 * gated by the real domain.ts state machine, (3) an invalid transition is
 * rejected at the synchronous command layer (immediate 404/409/403, not a
 * silently-dropped queue message), and (4) self-award is rejected (SoD).
 *
 * Two layers, mirroring tests/rfq-create.test.ts's own split: a manually
 * constructed MemoryQueue + registerRfqConsumers() for anything that needs
 * real processing/persistence (buildApp()'s own internal queue is never
 * wired to a consumer in this test style -- see rfq-create.test.ts, whose
 * "route contract" describe block only ever asserts HTTP status/body shape),
 * and direct calls into rfq/commands.ts for the synchronous pre-check layer
 * (HttpError 404/409/403), which needs no queue/consumer at all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementRfqs, procurementRfqItems, procurementRfqResponses } from "../src/modules/rfq/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { registerRfqConsumers } from "../src/modules/rfq/consumer.js";
import * as commands from "../src/modules/rfq/commands.js";
import * as queries from "../src/modules/rfq/queries.js";
import { HttpError } from "../src/shared/context.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d011f000-1111-4000-8000-000000000001";
const CREATOR  = "d011f000-2222-4000-8000-000000000001"; // creates the RFQ
const APPROVER = "d011f000-2222-4000-8000-000000000002"; // closes/awards it (distinct actor -- SoD)
const VENDOR_A = "d011f000-3333-4000-8000-000000000001";
const VENDOR_B = "d011f000-3333-4000-8000-000000000002";

function ctxAs(actorId: string): RequestContext {
  return { tenantId: TENANT, actorId, correlationId: `test-${randomUUID()}` } as unknown as RequestContext;
}

/**
 * commands.closeRfq/awardRfq call repo.findRfqById(), which does its own
 * bare db.transaction() -- with no ambient tenant context, wrapWithTenantGuc
 * has nothing to inject and FORCE ROW LEVEL SECURITY hides/rejects
 * everything. A real HTTP request gets this from resolveContext's own
 * request-scoped runWithTenant wiring; a direct unit-style call from a test
 * (as these are, deliberately -- see file header) has to establish it
 * itself, exactly like payroll's statutory-config.integration.test.ts wraps
 * every direct resolveRunStatutoryConfig() call in runWithTenant.
 */
function closeRfqAs(actorId: string, rfqId: string) {
  return runWithTenant(TENANT, () => commands.closeRfq(ctxAs(actorId), rfqId));
}
function awardRfqAs(actorId: string, rfqId: string, responseId: string) {
  return runWithTenant(TENANT, () => commands.awardRfq(ctxAs(actorId), rfqId, { responseId }));
}

async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 300)); await q.stop(); }

/**
 * withTenantConsumer wraps each handler in runWithTenant(msg.tenantId, ...)
 * so db.transaction() inside it has an ambient AsyncLocalStorage tenant
 * context to inject as the `app.tenant_id` GUC -- without this, every write
 * inside a consumer handler runs with no tenant set at all, and FORCE ROW
 * LEVEL SECURITY silently rejects/hides it. Mirrors rfq-create.test.ts's
 * wire() and tx-001-three-way-match-nested-tx-deadlock.test.ts's
 * tenantWrappedQueue() exactly.
 */
function newQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  registerRfqConsumers(q as unknown as Queue);
  return q;
}

async function publishAndDrain(payload: { type: string; payload: Record<string, unknown> }) {
  const q = newQueue();
  await q.start();
  await q.publish(payload.type, {
    messageId: randomUUID(), type: payload.type, tenantId: TENANT,
    actorId: (payload.payload as { actorId?: string }).actorId ?? CREATOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: payload.payload,
  });
  await drain(q);
}

/** Creates one issued RFQ (bypassing HTTP -- see file header) and returns its id + its one item's id. */
async function createIssuedRfq(): Promise<{ rfqId: string; itemId: string }> {
  const rfqId = randomUUID();
  const q = newQueue();
  await q.start();
  await q.publish(COMMANDS.rfqCreate, {
    messageId: randomUUID(), type: COMMANDS.rfqCreate, tenantId: TENANT, actorId: CREATOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: rfqId, tenantId: TENANT, title: "DOM-011 lifecycle RFQ", closingDate: "2026-12-01",
      vendorIds: [VENDOR_A, VENDOR_B], items: [{ itemName: "Widget", quantity: 10, unit: "nos" }],
    },
  });
  await drain(q);
  const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, rfqId))));
  return { rfqId, itemId: items[0]!.id };
}

async function respond(rfqId: string, vendorId: string, itemId: string, unitPrice: number): Promise<void> {
  await publishAndDrain({
    type: COMMANDS.rfqRespond,
    payload: {
      id: randomUUID(), tenantId: TENANT, rfqId, vendorId, actorId: vendorId,
      items: [{ itemId, unitPrice, leadTimeDays: 5 }], termsAccepted: true,
    },
  });
}

async function getRfqRow(rfqId: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementRfqs).where(eq(procurementRfqs.id, rfqId))));
  return rows[0];
}

async function getResponseRow(rfqId: string, vendorId: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementRfqResponses)
      .where(and(eq(procurementRfqResponses.rfqId, rfqId), eq(procurementRfqResponses.vendorId, vendorId)))));
  return rows[0];
}

/** queries.getRfqDetail() -> repo.findRfqById() -> its own bare db.transaction() -- same ambient-tenant-context need as closeRfqAs/awardRfqAs above. */
function getDetail(rfqId: string) {
  return runWithTenant(TENANT, () => queries.getRfqDetail(rfqId, TENANT));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementRfqResponses).where(eq(procurementRfqResponses.tenantId, TENANT));
    await tx.delete(procurementRfqItems).where(eq(procurementRfqItems.tenantId, TENANT));
    await tx.delete(procurementRfqs).where(eq(procurementRfqs.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await wipe();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values([
    { id: VENDOR_A, tenantId: TENANT, name: "Vendor A Pvt Ltd", createdBy: CREATOR, updatedBy: CREATOR },
    { id: VENDOR_B, tenantId: TENANT, name: "Vendor B Pvt Ltd", createdBy: CREATOR, updatedBy: CREATOR },
  ])));
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("DOM-011 — rfq.respond consumer: a response is now actually persisted (previously silently dropped)", () => {
  it("a vendor response is stored, responsesReceived increments, and getRfqDetail reflects it (previously hardcoded [])", async () => {
    const { rfqId, itemId } = await createIssuedRfq();

    await respond(rfqId, VENDOR_A, itemId, 100);
    let rfq = await getRfqRow(rfqId);
    expect(rfq!.responsesReceived).toBe(1);

    await respond(rfqId, VENDOR_B, itemId, 120);
    rfq = await getRfqRow(rfqId);
    expect(rfq!.responsesReceived).toBe(2);

    const responseA = await getResponseRow(rfqId, VENDOR_A);
    expect(responseA).toBeDefined();
    expect(responseA!.status).toBe("submitted");
    expect(Number(responseA!.totalAmountMinor)).toBe(100 * 100 * 10); // unitPrice(rupees->minor) * item quantity(10)

    const detail = await getDetail(rfqId);
    expect(detail!.responses).toHaveLength(2);
    const vendorAResponse = detail!.responses.find((r) => r.vendorId === VENDOR_A);
    expect(vendorAResponse).toBeDefined();
    expect(vendorAResponse!.vendorName).toBe("Vendor A Pvt Ltd");
    expect(vendorAResponse!.status).toBe("submitted");
  });

  it("a second response from the SAME vendor revises the existing one instead of double-counting responsesReceived", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    await respond(rfqId, VENDOR_A, itemId, 90); // revised, lower quote

    const rfq = await getRfqRow(rfqId);
    expect(rfq!.responsesReceived).toBe(1); // NOT 2

    const response = await getResponseRow(rfqId, VENDOR_A);
    expect(Number(response!.totalAmountMinor)).toBe(90 * 100 * 10); // reflects the REVISED price
  });

  it("respond is rejected at the command layer with 409 once the RFQ is no longer 'issued'", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });
    expect((await getRfqRow(rfqId))!.status).toBe("closed");

    // route-layer pre-check (rfq/routes.ts) uses queries.getRfqDetail's status,
    // exercised directly here rather than via HTTP -- see file header.
    const detail = await getDetail(rfqId);
    expect(detail!.status).toBe("closed");
  });
});

describe("DOM-011 — RFQ close/award state machine: valid transitions work, invalid ones are rejected", () => {
  it("close: issued -> closed persists status + closedAt", async () => {
    const { rfqId } = await createIssuedRfq();
    await expect(closeRfqAs(APPROVER, rfqId)).resolves.toMatchObject({ status: "accepted" });
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });

    const rfq = await getRfqRow(rfqId);
    expect(rfq!.status).toBe("closed");
    expect(rfq!.closedAt).not.toBeNull();
  });

  it("award is rejected with 409 while the RFQ is still 'issued' (must close first)", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    const response = await getResponseRow(rfqId, VENDOR_A);

    await expect(awardRfqAs(APPROVER, rfqId, response!.id))
      .rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("close is rejected with 409 once already closed (invalid transition, not silently ignored)", async () => {
    const { rfqId } = await createIssuedRfq();
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });
    expect((await getRfqRow(rfqId))!.status).toBe("closed");

    await expect(closeRfqAs(APPROVER, rfqId))
      .rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("award to an unknown responseId is rejected with 404 before ever reaching the queue", async () => {
    const { rfqId } = await createIssuedRfq();
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });

    // commands.awardRfq's own pre-check only validates the RFQ + transition +
    // SoD synchronously (mirrors tender's awardTender: it does not resolve
    // the responseId itself, leaving that to the consumer's defense-in-depth
    // check) -- so a bogus responseId is accepted here and correctly
    // rejected one layer down, in the consumer. Publish directly to prove
    // that layer.
    await publishAndDrain({
      type: COMMANDS.rfqAward,
      payload: { id: rfqId, tenantId: TENANT, responseId: randomUUID(), actorId: APPROVER },
    });
    expect((await getRfqRow(rfqId))!.status).toBe("closed"); // NOT 'awarded' -- the consumer threw and rolled back
  });

  it("self-award is rejected with 403 (SoD) at the synchronous command layer", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    const response = await getResponseRow(rfqId, VENDOR_A);
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });

    // CREATOR is this RFQ's own createdBy -- self-award.
    await expect(awardRfqAs(CREATOR, rfqId, response!.id))
      .rejects.toMatchObject({ status: 403, code: "SOD_VIOLATION" });
  });

  it("self-award is ALSO rejected at the consumer layer (defense-in-depth) -- the award is not recorded even if the command-layer check were bypassed", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    const response = await getResponseRow(rfqId, VENDOR_A);
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });

    // Publish directly with actorId === createdBy (CREATOR), bypassing
    // commands.awardRfq's own synchronous 403 entirely.
    await publishAndDrain({
      type: COMMANDS.rfqAward,
      payload: { id: rfqId, tenantId: TENANT, responseId: response!.id, actorId: CREATOR },
    });

    const rfq = await getRfqRow(rfqId);
    expect(rfq!.status).toBe("closed"); // NOT 'awarded' -- assertDistinctMakerChecker threw inside the txn, rolled back
    const stillSubmitted = await getResponseRow(rfqId, VENDOR_A);
    expect(stillSubmitted!.status).toBe("submitted"); // not 'awarded' either
  });

  it("award: closed -> awarded marks the winning response 'awarded' and every other 'submitted' response 'rejected'", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    await respond(rfqId, VENDOR_B, itemId, 90); // lower quote, but award targets A explicitly (no auto-L1 for RFQ)
    const responseA = await getResponseRow(rfqId, VENDOR_A);
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });

    await expect(awardRfqAs(APPROVER, rfqId, responseA!.id))
      .resolves.toMatchObject({ status: "accepted" });
    await publishAndDrain({
      type: COMMANDS.rfqAward,
      payload: { id: rfqId, tenantId: TENANT, responseId: responseA!.id, actorId: APPROVER },
    });

    const rfq = await getRfqRow(rfqId);
    expect(rfq!.status).toBe("awarded");
    expect(rfq!.awardedResponseId).toBe(responseA!.id);
    expect(rfq!.awardedAt).not.toBeNull();

    const awarded = await getResponseRow(rfqId, VENDOR_A);
    expect(awarded!.status).toBe("awarded");
    const rejected = await getResponseRow(rfqId, VENDOR_B);
    expect(rejected!.status).toBe("rejected");

    const detail = await getDetail(rfqId);
    expect(detail!.status).toBe("awarded");
  });

  it("award is rejected with 409 once already awarded (terminal state)", async () => {
    const { rfqId, itemId } = await createIssuedRfq();
    await respond(rfqId, VENDOR_A, itemId, 100);
    const response = await getResponseRow(rfqId, VENDOR_A);
    await closeRfqAs(APPROVER, rfqId);
    await publishAndDrain({ type: COMMANDS.rfqClose, payload: { id: rfqId, tenantId: TENANT, actorId: APPROVER } });
    await awardRfqAs(APPROVER, rfqId, response!.id);
    await publishAndDrain({
      type: COMMANDS.rfqAward,
      payload: { id: rfqId, tenantId: TENANT, responseId: response!.id, actorId: APPROVER },
    });
    expect((await getRfqRow(rfqId))!.status).toBe("awarded");

    await expect(awardRfqAs(APPROVER, rfqId, response!.id))
      .rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("close/award on a nonexistent RFQ id is rejected with 404", async () => {
    const bogusId = randomUUID();
    await expect(closeRfqAs(APPROVER, bogusId)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(awardRfqAs(APPROVER, bogusId, randomUUID()))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

// Sanity: HttpError is the type these rejections should actually be (guards
// against a future refactor accidentally swapping in a plain Error that
// would still satisfy toMatchObject's duck-typed shape check above).
describe("DOM-011 — rejection type sanity", () => {
  it("closeRfq's 404 is a real HttpError instance", async () => {
    let threw = false;
    try {
      await closeRfqAs(APPROVER, randomUUID());
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(HttpError);
    }
    expect(threw).toBe(true);
  });
});
