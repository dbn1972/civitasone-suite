/**
 * DOM-032 — POST /v1/procurement/matches/invoice's optional invoiceDate
 * field was accepted and validated but never referenced anywhere in the
 * handler body: never forwarded into commands.runThreeWayMatch(), and had
 * no column to land in even if it were. Same discard shape DOM-027 just
 * fixed for invoiceRef on this same endpoint (invoiceDate was deliberately
 * left out of that gap's own scope since it's optional there, not required
 * to close DOM-027's DoD). Fix: invoiceDate, once supplied, is genuinely
 * threaded through to storage (new procurement.three_way_match.invoice_date
 * column, migration 0036) and surfaced on GET /v1/procurement/three-way-match,
 * not just accepted and dropped.
 *
 * Two layers:
 *  1. Routes-layer forwarding: proves the REAL POST /v1/procurement/matches
 *     /invoice handler reads body.invoiceDate and forwards it into the
 *     queued command payload. Spies on the shared queue's publish() (same
 *     singleton commands.ts publishes through) so no consumer/DB round trip
 *     is needed for this layer. Worth calling out: DOM-027's own equivalent
 *     coverage never actually exercised this exact line through HTTP either
 *     — its persistence-layer test hand-built the queue payload instead of
 *     going through the route handler for the write side. Closing that same
 *     coverage gap here rather than carrying it forward, since without this
 *     layer a sabotage-check on the routes.ts forwarding line would not be
 *     caught by layer 2 below (it never touches routes.ts's write path).
 *  2. Real Postgres + real RLS + the real consumer (mirrors dom-011/dom-027's
 *     seedPoAndGrn/tenantWrappedQueue fixture exactly): proves invoiceDate
 *     is genuinely persisted, visible on the GET read path, and that the
 *     upsert's conditional-preserve CASE branch (new for invoice_date, see
 *     repo.ts) actually keeps it across a later invoice-info-free re-run
 *     instead of silently wiping it.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/three-way-match/repo.js";
import { registerThreeWayMatchConsumers } from "../src/modules/three-way-match/consumer.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0032032-aaaa-4000-8000-000000000001";
const ACTOR = randomUUID();

function tok(roles: string[] = ["procurement_officer", "procurement_admin", "super_admin"]) {
  return signToken({ sub: "user-dom032", tid: TENANT, roles, sid: "sess-dom032" }, SECRET);
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

/** Mirrors tests/dom-027-three-way-match-invoice-ref.test.ts's fixture shape exactly. */
async function seedPoAndGrn(tenantId: string) {
  const poId = randomUUID();
  const poItemId = randomUUID();
  const grnId = randomUUID();
  const unitPriceMinor = 2_000n;
  const qty = 10;

  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPos).values({
    id: poId, tenantId, poNo: `PO-DOM032-${poId.slice(0, 8)}`, vendorId: randomUUID(),
    indentRef: "IND-DOM032", totalMinor: unitPriceMinor * BigInt(qty), status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPoItems).values({
    id: poItemId, poId, tenantId, itemCode: "ITEM-DOM032", description: "test item",
    quantity: qty, unitPriceMinor, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId, grnNo: `GRN-DOM032-${grnId.slice(0, 8)}`, poRef: `procurement_po:${poId}`,
    vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrnItems).values({
    id: randomUUID(), grnId, tenantId, poItemRef: poItemId, itemCode: "ITEM-DOM032",
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

describe("DOM-032 — POST /v1/procurement/matches/invoice forwards invoiceDate into the queued command (not silently discarded)", () => {
  it("the real HTTP handler reads body.invoiceDate and includes it in the published threeWayMatchRun payload", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);

    // Seed an existing match row directly so POST /matches/invoice's
    // findMatchById lookup succeeds — the full PO+GRN+consumer pipeline
    // isn't needed to prove THIS layer (that's what the second describe
    // block below does); this endpoint only ever upgrades an existing row.
    const matchId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.upsertDerivedMatch(tx, {
      id: matchId, tenantId: TENANT, poId, grnId,
      poAmountMinor: 20_000n, grnAmountMinor: 20_000n, matchStatus: "pending",
    })));

    const publishSpy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url: "/v1/procurement/matches/invoice", headers: auth,
        payload: { matchId, invoiceRef: "INV-DOM032-00001", invoiceDate: "2026-05-10", invoiceAmount: 200, invoiceTax: 36 },
      });
      await app.close();
      expect(res.statusCode).toBe(202);

      const call = publishSpy.mock.calls.find(([topic]) => topic === COMMANDS.threeWayMatchRun);
      expect(call, "handler should publish a threeWayMatchRun command").toBeDefined();
      const published = call![1] as { payload: { invoiceRef?: string; invoiceDate?: string } };
      expect(published.payload.invoiceRef).toBe("INV-DOM032-00001");
      // The exact line this gap is about: body.invoiceDate must reach the
      // queued payload, not stop at Zod validation.
      expect(published.payload.invoiceDate).toBe("2026-05-10");
    } finally {
      publishSpy.mockRestore();
    }
  });

  it("omitting invoiceDate (it stays optional, unlike invoiceRef) publishes undefined rather than throwing", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);
    const matchId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.upsertDerivedMatch(tx, {
      id: matchId, tenantId: TENANT, poId, grnId,
      poAmountMinor: 20_000n, grnAmountMinor: 20_000n, matchStatus: "pending",
    })));

    const publishSpy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url: "/v1/procurement/matches/invoice", headers: auth,
        payload: { matchId, invoiceRef: "INV-DOM032-00002", invoiceAmount: 200, invoiceTax: 36 },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
      const call = publishSpy.mock.calls.find(([topic]) => topic === COMMANDS.threeWayMatchRun);
      const published = call![1] as { payload: { invoiceDate?: string } };
      expect(published.payload.invoiceDate).toBeUndefined();
    } finally {
      publishSpy.mockRestore();
    }
  });
});

describe("DOM-032 — invoiceDate is genuinely persisted and visible on the read path, not just validated then dropped", () => {
  it("real Postgres + real RLS + real consumer: invoiceDate on the queued command payload ends up on the stored row AND on GET /v1/procurement/three-way-match", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);

    const q = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q);
    await q.start();
    const runId = randomUUID();
    const invoiceId = randomUUID();
    const INVOICE_REF = "INV-DOM032-00099";
    const INVOICE_DATE = "2026-05-10";
    await q.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: TENANT, poId, grnId, invoiceId, invoiceAmountMinor: 20_000, invoiceRef: INVOICE_REF, invoiceDate: INVOICE_DATE },
    });
    await drain(q);

    // 1. Stored on the row itself (repo.upsertDerivedMatch actually wrote invoice_date).
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(threeWayMatch).where(eq(threeWayMatch.id, runId))));
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.invoiceDate).toBe(INVOICE_DATE);

    // 2. Retrievable through the real HTTP read path (toApi() surfaces it, not silently dropped).
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/procurement/three-way-match?poId=${poId}`, headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; invoiceDate: string | null }> };
    const match = body.data.find((r) => r.id === runId);
    expect(match).toBeDefined();
    expect(match!.invoiceDate).toBe(INVOICE_DATE);
  });

  it("a later invoice-info-free re-run preserves the previously-stored invoiceDate (upsert's conditional-preserve CASE branch, mirrors invoice_ref's own pattern)", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT);
    const invoiceId = randomUUID();
    const INVOICE_DATE = "2026-04-01";

    // Run 1: PO+GRN only, no invoice yet.
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

    // Run 2: same (tenant, po, grn) key, now with an invoice + date (simulates the invoice-attach endpoint upgrading the row).
    const q2 = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q2);
    await q2.start();
    const runId2 = randomUUID();
    await q2.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId2, tenantId: TENANT, poId, grnId, invoiceId, invoiceAmountMinor: 20_000, invoiceDate: INVOICE_DATE },
    });
    await drain(q2);

    // Run 3: PO+GRN-only re-evaluation again (e.g. a tolerance re-check) — no invoice info at all.
    // EXCLUDED.invoice_id is NULL for this run, so repo.ts's CASE branch must
    // preserve the existing invoice_date rather than overwrite it with NULL.
    const q3 = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q3);
    await q3.start();
    const runId3 = randomUUID();
    await q3.publish(COMMANDS.threeWayMatchRun, {
      messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
      actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId3, tenantId: TENANT, poId, grnId },
    });
    await drain(q3);

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(threeWayMatch).where(eq(threeWayMatch.poId, poId))));
    expect(rows).toHaveLength(1); // upsert keyed on (tenant, po, grn) -- same row throughout
    expect(rows[0]!.invoiceDate).toBe(INVOICE_DATE); // preserved, not wiped by run 3
  });
});
