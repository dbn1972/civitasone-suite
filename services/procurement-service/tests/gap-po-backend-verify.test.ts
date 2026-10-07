/**
 * Backend-verify pins for three audit items the 2026-09-29 snapshot marked
 * "service absent / cannot-verify". The procurement-service IS present and the
 * capabilities exist; these tests make the current behaviour regression-safe.
 *
 *  - GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-03: POST /pos/:id/amendments must
 *    reject with 409 when the PO is not in an amendable state (draft /
 *    cancelled / closed). amendment-commands.requestAmendment calls
 *    assertPoAmendable before publishing a command, so no amendment row or
 *    audit event is created for a non-live PO.
 *  - GAP-PROCUREMENT-ORDERS-DETAIL-06: the PO state machine rejects illegal
 *    transitions. Dispatching a draft PO (assertCanDispatch) must leave the PO
 *    in draft — the irreversible vendor-facing command never fires from a
 *    non-approved state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPos, procurementPoAmendments } from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "a7777777-0000-4000-8000-000000000001";

function tok(roles: string[] = ["procurement_officer"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pbv" }, SECRET);
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function seedPo(id: string, status: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id, tenantId: TENANT, poNo: `PO-${id.slice(-4)}`, vendorId: randomUUID(),
      indentRef: "procurement_indent:seed", orderType: "supply", totalMinor: 500_000n,
      currency: "INR", status, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}
async function getPo(id: string) {
  return (await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementPos).where(eq(procurementPos.id, id)))))[0];
}
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPoAmendments).where(eq(procurementPoAmendments.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

beforeAll(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-03 — amend status guard", () => {
  it("POST /pos/:id/amendments on a CANCELLED PO → 409, no amendment row written", async () => {
    const poId = randomUUID();
    await seedPo(poId, "cancelled");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pos/${poId}/amendments`,
      headers: { authorization: `Bearer ${tok()}` },
      payload: { amendmentType: "scope", reason: "attempt to amend a cancelled PO", deltaMinor: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PO_NOT_AMENDABLE");

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPoAmendments).where(and(
        eq(procurementPoAmendments.poId, poId), eq(procurementPoAmendments.tenantId, TENANT)))));
    expect(rows).toHaveLength(0);
  });

  it("POST /pos/:id/amendments on a DRAFT PO → 409 (not yet a live order)", async () => {
    const poId = randomUUID();
    await seedPo(poId, "draft");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pos/${poId}/amendments`,
      headers: { authorization: `Bearer ${tok()}` },
      payload: { amendmentType: "scope", reason: "attempt to amend a draft PO", deltaMinor: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PO_NOT_AMENDABLE");
  });

  it("POST /pos/:id/amendments on an APPROVED PO → 202 (amendable)", async () => {
    const poId = randomUUID();
    await seedPo(poId, "approved");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pos/${poId}/amendments`,
      headers: { authorization: `Bearer ${tok()}` },
      payload: { amendmentType: "scope", reason: "legitimate scope amendment", deltaMinor: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP-PROCUREMENT-ORDERS-DETAIL-06 — PO state machine", () => {
  it("dispatching a DRAFT PO is an illegal transition — PO stays draft, never dispatched", async () => {
    const poId = randomUUID();
    await seedPo(poId, "draft");
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poDispatch, {
      messageId: randomUUID(), type: COMMANDS.poDispatch, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${poId}`, schemaVersion: "1.0",
      payload: { id: poId, tenantId: TENANT, notes: "illegal dispatch from draft" },
    });
    await drain(q);
    const po = await getPo(poId);
    expect(po?.status).toBe("draft");
  });

  it("submit-approval from draft moves the PO to pending (legal transition) and emits an audit event", async () => {
    const poId = randomUUID();
    await seedPo(poId, "draft");
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poSubmitApproval, {
      messageId: randomUUID(), type: COMMANDS.poSubmitApproval, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${poId}`, schemaVersion: "1.0",
      payload: { id: poId, tenantId: TENANT },
    });
    await drain(q);
    const po = await getPo(poId);
    expect(po?.status).toBe("pending");

    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    const forThisPo = audits.filter((a) => (a.payload as Record<string, unknown>)?.resourceId === poId);
    expect(forThisPo.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GAP-PROCUREMENT-ORDERS-DETAIL-03 — dispatch maker-checker (SoD)", () => {
  const CREATOR = "a7777777-0000-4000-8000-00000000000c";
  const OTHER_OFFICER = "a7777777-0000-4000-8000-00000000000d";

  async function seedApprovedBy(id: string, createdBy: string): Promise<void> {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(procurementPos).values({
        id, tenantId: TENANT, poNo: `PO-${id.slice(-4)}`, vendorId: randomUUID(),
        indentRef: "procurement_indent:seed", orderType: "supply", totalMinor: 500_000n,
        currency: "INR", status: "approved", createdBy, updatedBy: createdBy,
      });
    }));
  }

  it("the PO's own creator dispatching their own PO is rejected (SOD_VIOLATION); PO stays approved", async () => {
    const poId = randomUUID();
    await seedApprovedBy(poId, CREATOR);
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poDispatch, {
      messageId: randomUUID(), type: COMMANDS.poDispatch, tenantId: TENANT, actorId: CREATOR,
      correlationId: `corr-${poId}`, schemaVersion: "1.0",
      payload: { id: poId, tenantId: TENANT, mode: "portal" },
    });
    await drain(q);
    const po = await getPo(poId);
    expect(po?.status).toBe("approved"); // NOT dispatched

    const rejections = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "procurement.po.dispatch_rejected")))));
    const forThisPo = rejections.filter((r) => (r.payload as Record<string, unknown>)?.poId === poId);
    expect(forThisPo.length).toBeGreaterThanOrEqual(1);
    expect((forThisPo[0]!.payload as Record<string, unknown>).code).toBe("SOD_VIOLATION");
  });

  it("a different officer dispatching an approved PO succeeds and records expectedDelivery", async () => {
    const poId = randomUUID();
    await seedApprovedBy(poId, CREATOR);
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poDispatch, {
      messageId: randomUUID(), type: COMMANDS.poDispatch, tenantId: TENANT, actorId: OTHER_OFFICER,
      correlationId: `corr-${poId}`, schemaVersion: "1.0",
      payload: { id: poId, tenantId: TENANT, mode: "courier", expectedDelivery: "2026-07-15" },
    });
    await drain(q);
    const po = await getPo(poId);
    expect(po?.status).toBe("dispatched");
    expect(String(po?.deliveryDate).slice(0, 10)).toBe("2026-07-15");
  });

  it("the dispatch audit event carries the UI-collected mode, notes and expectedDelivery", async () => {
    const poId = randomUUID();
    await seedApprovedBy(poId, CREATOR);
    const q = wire(new MemoryQueue()); registerPoConsumers(q); await q.start();
    await q.publish(COMMANDS.poDispatch, {
      messageId: randomUUID(), type: COMMANDS.poDispatch, tenantId: TENANT, actorId: OTHER_OFFICER,
      correlationId: `corr-audit-${poId}`, schemaVersion: "1.0",
      payload: { id: poId, tenantId: TENANT, mode: "courier", notes: "Sent via DTDC, docket 123", expectedDelivery: "2026-07-15" },
    });
    await drain(q);
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.correlationId, `corr-audit-${poId}`)))));
    const dispatchAudit = audits
      .map((r) => r.payload as Record<string, unknown>)
      .find((pl) => pl?.action === "dispatch" && pl?.resourceId === poId);
    expect(dispatchAudit).toBeDefined();
    expect(dispatchAudit!.details).toEqual({ mode: "courier", notes: "Sent via DTDC, docket 123", expectedDelivery: "2026-07-15" });
  });
});
