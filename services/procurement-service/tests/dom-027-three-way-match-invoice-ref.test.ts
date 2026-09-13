/**
 * DOM-027 — the direct POST /v1/procurement/three-way-match endpoint
 * accepted a bare invoiceId + client-asserted invoiceAmountMinor with zero
 * paper trail, unlike POST /v1/procurement/matches/invoice, which has always
 * required a structured invoiceRef. Fix: invoiceRef is now REQUIRED (HTTP
 * 400 otherwise) on the direct endpoint whenever invoice info is supplied,
 * and is genuinely threaded through to storage on BOTH endpoints instead of
 * being validated and then discarded.
 *
 * Two layers, matching this module's DOM-011 precedent
 * (tests/dom-011-three-way-match-tolerance.test.ts):
 *  1. HTTP-layer request validation (buildApp() + app.inject(), real signed
 *     JWTs, mirrors tests/routes-coverage-full.test.ts's auth pattern) --
 *     proves the schema actually rejects/accepts.
 *  2. Real Postgres + real RLS + the real threeWayMatchRun consumer over a
 *     MemoryQueue (mirrors dom-011's seedPoAndGrn/tenantWrappedQueue fixture
 *     pattern exactly) -- proves invoiceRef is genuinely persisted and
 *     visible on the GET read path, not just validated then dropped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerThreeWayMatchConsumers } from "../src/modules/three-way-match/consumer.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0027027-aaaa-4000-8000-000000000001";
const ACTOR = randomUUID();
const FAKE_UUID = "00000000-0000-4000-8000-000000000027";

function tok(roles: string[] = ["procurement_officer", "procurement_admin", "super_admin"]) {
  return signToken({ sub: "user-dom027", tid: TENANT, roles, sid: "sess-dom027" }, SECRET);
}
const auth = { authorization: `Bearer ${tok()}` };

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

async function drain(q: MemoryQueue) {
  const DRAIN_TIMEOUT_MS = 10_000;
  let timedOut = false;
  await Promise.race([
    q.drain(),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
  ]);
  expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms`).toBe(false);
  await q.stop();
}

/** Seeds a PO (single item) + GRN (single item) pair, mirroring tests/dom-011-three-way-match-tolerance.test.ts's fixture shape exactly. */
async function seedPoAndGrn(tenantId: string) {
  const poId = randomUUID();
  const poItemId = randomUUID();
  const grnId = randomUUID();
  const unitPriceMinor = 2_000n;
  const qty = 10;

  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPos).values({
    id: poId, tenantId, poNo: `PO-DOM027-${poId.slice(0, 8)}`, vendorId: randomUUID(),
    indentRef: "IND-DOM027", totalMinor: unitPriceMinor * BigInt(qty), status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPoItems).values({
    id: poItemId, poId, tenantId, itemCode: "ITEM-DOM027", description: "test item",
    quantity: qty, unitPriceMinor, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId, grnNo: `GRN-DOM027-${grnId.slice(0, 8)}`, poRef: `procurement_po:${poId}`,
    vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrnItems).values({
    id: randomUUID(), grnId, tenantId, poItemRef: poItemId, itemCode: "ITEM-DOM027",
    orderedQty: qty, receivedQty: qty, acceptedQty: qty, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return { poId, grnId };
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DOM-027 — POST /v1/procurement/three-way-match requires invoiceRef whenever invoice info is supplied", () => {
  it("400s when invoiceAmountMinor is present but invoiceRef is missing (the exact gap this fix closes)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID, invoiceId: randomUUID(), invoiceAmountMinor: 50_000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("400s when invoiceId alone is present (no amount) but invoiceRef is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID, invoiceId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("does NOT require invoiceRef for a PO+GRN-only match (no invoice info at all)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID },
    });
    await app.close();
    // Passes schema validation and proceeds to the PO lookup -- 404 (fake
    // UUID, no such PO), never 400. Proves the new .refine() doesn't
    // over-trigger for the no-invoice-info case.
    expect(res.statusCode).toBe(404);
  });

  it("passes validation once invoiceRef is supplied alongside invoice info (proceeds to PO lookup, not 400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID, invoiceId: randomUUID(), invoiceAmountMinor: 50_000, invoiceRef: "INV-2026-00042" },
    });
    await app.close();
    expect(res.statusCode).toBe(404); // fake UUID -> PO not found, but past validation
  });

  it("rejects an empty-string invoiceRef the same as a missing one (min(1), matching matches/invoice's own field)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID, invoiceId: randomUUID(), invoiceAmountMinor: 50_000, invoiceRef: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("DOM-027 — invoiceRef is genuinely persisted and visible on the read path, not just validated then dropped", () => {
  it("real Postgres + real RLS + real consumer: invoiceRef on the queued command payload ends up on the stored row AND on GET /v1/procurement/three-way-match", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);

    const q = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q);
    await q.start();
    const runId = randomUUID();
    const invoiceId = randomUUID();
    const INVOICE_REF = "INV-DOM027-00099";
    await q.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: TENANT, poId, grnId, invoiceId, invoiceAmountMinor: 20_000, invoiceRef: INVOICE_REF },
    });
    await drain(q);

    // 1. Stored on the row itself (repo.upsertDerivedMatch actually wrote invoice_ref).
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(threeWayMatch).where(eq(threeWayMatch.id, runId))));
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.invoiceRef).toBe(INVOICE_REF);

    // 2. Retrievable through the real HTTP read path (toApi() surfaces it, not silently dropped).
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/procurement/three-way-match?poId=${poId}`, headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; invoiceRef: string | null }> };
    const match = body.data.find((r) => r.id === runId);
    expect(match).toBeDefined();
    expect(match!.invoiceRef).toBe(INVOICE_REF);
  });

  it("a re-run without invoiceRef preserves the previously-stored reference (upsert's conditional-preserve, mirrors invoice_amount_minor's own existing behavior)", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);
    const invoiceId = randomUUID();
    const INVOICE_REF = "INV-DOM027-KEEP-ME";

    // First run: GRN-only, no invoice yet.
    const q1 = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q1);
    await q1.start();
    const runId = randomUUID();
    await q1.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: TENANT, poId, grnId },
    });
    await drain(q1);

    // Second run: same (tenant, po, grn) key, now with an invoice + ref (simulates the invoice-attach endpoint upgrading the row).
    const q2 = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q2);
    await q2.start();
    const runId2 = randomUUID();
    await q2.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId2, tenantId: TENANT, poId, grnId, invoiceId, invoiceAmountMinor: 20_000, invoiceRef: INVOICE_REF },
    });
    await drain(q2);

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(threeWayMatch).where(eq(threeWayMatch.poId, poId))));
    expect(rows).toHaveLength(1); // upsert keyed on (tenant, po, grn) -- same row, not a second one
    expect(rows[0]!.invoiceRef).toBe(INVOICE_REF);
  });
});
