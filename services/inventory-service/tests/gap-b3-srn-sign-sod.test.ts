/**
 * GAP-PROCUREMENT-GRN-DETAIL-SRN-05 — separation of duties on SRN sign.
 *
 * The officer who signs the Store Receipt Note (the GFR Rule 149 payment gate)
 * must NOT be the same officer who created/received the GRN. The signer's
 * identity is the sign call's own authenticated actor; the GRN creator is
 * resolved cross-service from procurement (fetchGrn.createdBy). A self-sign is
 * rejected (SOD_VIOLATION) and the SRN stays 'draft'; a distinct signer
 * succeeds.
 *
 * Mirrors srn.test.ts's harness: real HTTP route -> MemoryQueue -> consumer ->
 * Postgres, with the cross-service GRN fetch stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerSrnConsumers } from "../src/modules/srn/consumer.js";
import { storeReceiptNotes } from "../src/modules/srn/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT   = "d4d4d4d4-0000-4000-8000-000000005005";
const RECEIVER = "d4d4d4d4-0000-4000-8000-aaaaaaaa5005"; // created the GRN
const SIGNER   = "d4d4d4d4-0000-4000-8000-bbbbbbbb5005"; // a different store officer

function tokenFor(actorId: string, roles = ["store_officer", "inventory_admin"]): string {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "sess-sod" }, SECRET, 3600);
}
function hdr(actorId: string) {
  return { authorization: `Bearer ${tokenFor(actorId)}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}
const drain = () => (queue as unknown as MemoryQueue).drain();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Stub fetchGrn: GRN accepted and created by RECEIVER. */
function stubGrn(grnId: string, createdBy: string): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const id = url.split("/").pop()!;
    if (id === grnId) return new Response(JSON.stringify({ id, status: "accepted", createdBy }), { status: 200 });
    return new Response(null, { status: 404 });
  }));
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(storeReceiptNotes).where(eq(storeReceiptNotes.tenantId, TENANT));
  }));
}

let app: FastifyInstance;

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerSrnConsumers(queue);
  app = await buildApp();
  await cleanup();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });
beforeEach(() => { vi.unstubAllGlobals(); });

describe("SRN sign SoD (GAP-PROCUREMENT-GRN-DETAIL-SRN-05)", () => {
  it("rejects a sign by the GRN creator — SRN stays draft (self-sign blocked)", async () => {
    const grnId = "e5e5e5e5-0000-4000-8000-00000000b001";
    stubGrn(grnId, RECEIVER);

    const create = await app.inject({ method: "POST", url: "/v1/inventory/srn", headers: hdr(RECEIVER), payload: { grnId } });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    // Same actor (RECEIVER, the GRN creator) tries to sign.
    await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${id}/sign`, headers: hdr(RECEIVER), payload: {} });
    await drain();

    expect(mq.dlq.slice(before).some((d) => d.error.includes("SOD_VIOLATION"))).toBe(true);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows[0]?.status).toBe("draft");
  });

  it("allows a sign by a different store officer — SRN becomes signed", async () => {
    const grnId = "e5e5e5e5-0000-4000-8000-00000000b002";
    stubGrn(grnId, RECEIVER);

    const create = await app.inject({ method: "POST", url: "/v1/inventory/srn", headers: hdr(RECEIVER), payload: { grnId } });
    const id = create.json().id as string;
    await drain();

    // A genuinely distinct signer.
    const sign = await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${id}/sign`, headers: hdr(SIGNER), payload: {} });
    expect(sign.statusCode).toBe(202);
    await drain();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows[0]?.status).toBe("signed");
  });
});
