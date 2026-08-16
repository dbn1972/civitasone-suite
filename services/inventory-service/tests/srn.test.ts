/**
 * Store Receipt Note (SRN) — CQRS write-path round-trip integration tests.
 *
 * GFR Rule 149: a signed SRN gates payment authorisation against a GRN.
 * These tests POST through the real HTTP route, drive the in-memory queue to
 * deliver commands to the consumer, then GET through the read route and
 * assert the row was actually written to Postgres.
 *
 * Covered paths:
 *   1. srn.create -> row persisted with status 'draft' (GRN accepted)
 *   2. srn.create rejected when the remote GRN is not 'accepted'
 *   3. srn.create rejected when the GRN does not exist
 *   4. srn.sign -> status transitions to 'signed'
 *   5. one SRN per GRN — a second create for the same GRN is rejected
 *   6. GET by grnId returns null when no SRN exists yet
 *   7. RLS cross-tenant isolation -> tenant B cannot see tenant A's SRN
 *
 * Requirements: 1.1
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

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000005001";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000005002";
const ACTOR_A  = "a1a1a1a1-0000-4000-8000-aaaaaaaa5001";
const ACTOR_B  = "b2b2b2b2-0000-4000-8000-bbbbbbbb5002";

function tokenFor(tenantId: string, actorId: string, roles = ["store_officer", "inventory_admin"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-srn" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string, roles?: string[]) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId, roles)}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}

const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;

/** Wrap the shared queue so consumer handlers run inside runWithTenant (sets the RLS GUC). */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(storeReceiptNotes).where(eq(storeReceiptNotes.tenantId, t));
    }));
  }
}

/** Stub the cross-service GRN lookup that gates SRN creation (fetchGrn). */
function stubGrnFetch(statusByGrnId: Record<string, string | undefined>): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const grnId = url.split("/").pop()!;
    const status = statusByGrnId[grnId];
    if (status === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify({ id: grnId, status }), { status: 200 });
  }));
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerSrnConsumers(queue);
  app = await buildApp();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("SRN — create round-trip (persists, not just 202)", () => {
  it("POST srn (GRN accepted) -> consumer persists status 'draft' -> GET by grnId returns it", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a001";
    stubGrnFetch({ [grnId]: "accepted" });

    const res = await app.inject({
      method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A),
      payload: { grnId, remarks: "Received in good condition" },
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/srn/${grnId}`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(get.statusCode).toBe(200);
    const srn = get.json().data;
    expect(srn).not.toBeNull();
    expect(srn.grnId).toBe(grnId);
    expect(srn.status).toBe("draft");
    expect(srn.remarks).toBe("Received in good condition");

    // DB-level assertion (bypasses cache): row physically exists.
    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("draft");
  });
});

describe("SRN — creation gated on GRN acceptance", () => {
  it("rejects (no row persisted) when the GRN is still under_inspection", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a002";
    stubGrnFetch({ [grnId]: "under_inspection" });

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A),
      payload: { grnId },
    });
    expect(res.statusCode).toBe(202); // route accepts; the domain guard runs in the consumer
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows).toHaveLength(0);
    expect(mq.dlq.slice(before).some((d) => d.error.includes("GRN_NOT_ACCEPTED"))).toBe(true);
  });

  it("rejects when the referenced GRN does not exist", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a003";
    stubGrnFetch({}); // 404 for any id

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    await app.inject({
      method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A),
      payload: { grnId },
    });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows).toHaveLength(0);
    expect(mq.dlq.slice(before).some((d) => d.error.includes("GRN_NOT_FOUND"))).toBe(true);
  });
});

describe("SRN — sign transition", () => {
  it("PATCH sign -> consumer sets status 'signed'", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a004";
    stubGrnFetch({ [grnId]: "accepted" });

    const create = await app.inject({
      method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A),
      payload: { grnId },
    });
    const id = create.json().id as string;
    await drain();

    const sign = await app.inject({
      method: "PATCH", url: `/v1/inventory/srn/${id}/sign`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { remarks: "Signed off" },
    });
    expect(sign.statusCode).toBe(202);
    await drain();

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/srn/${grnId}`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(get.json().data.status).toBe("signed");
  });

  it("signing an already-signed SRN is rejected (idempotent guard, not a re-sign)", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a005";
    stubGrnFetch({ [grnId]: "accepted" });

    const create = await app.inject({
      method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A),
      payload: { grnId },
    });
    const id = create.json().id as string;
    await drain();
    await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${id}/sign`, headers: hdr(TENANT_A, ACTOR_A), payload: {} });
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    await app.inject({ method: "PATCH", url: `/v1/inventory/srn/${id}/sign`, headers: hdr(TENANT_A, ACTOR_A), payload: {} });
    await drain();
    expect(mq.dlq.slice(before).some((d) => d.error.includes("SRN_ALREADY_SIGNED"))).toBe(true);
  });
});

describe("SRN — one per GRN", () => {
  it("a second create for the same GRN is rejected, first row unaffected", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a006";
    stubGrnFetch({ [grnId]: "accepted" });

    await app.inject({ method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A), payload: { grnId, remarks: "first" } });
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    await app.inject({ method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A), payload: { grnId, remarks: "second" } });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.remarks).toBe("first");
    expect(mq.dlq.slice(before).some((d) => d.error.includes("SRN_ALREADY_EXISTS"))).toBe(true);
  });
});

describe("SRN — read-side defaults", () => {
  it("GET by grnId returns 200 with data: null when no SRN exists", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a999";
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/srn/${grnId}`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });
});

describe("SRN — RLS cross-tenant isolation", () => {
  it("tenant B cannot read tenant A's persisted SRN", async () => {
    const grnId = "cccccccc-0000-4000-8000-00000000a007";
    stubGrnFetch({ [grnId]: "accepted" });

    await app.inject({ method: "POST", url: "/v1/inventory/srn", headers: hdr(TENANT_A, ACTOR_A), payload: { grnId } });
    await drain();

    const asB = await app.inject({
      method: "GET", url: `/v1/inventory/srn/${grnId}`, headers: hdr(TENANT_B, ACTOR_B, ["inventory_admin"]),
    });
    expect(asB.statusCode).toBe(200);
    expect(asB.json().data).toBeNull(); // tenant B genuinely has no SRN for this grnId

    // Authoritative check: a raw tenant-B scoped read returns zero rows (RLS-enforced).
    const leaked = await runWithTenant(TENANT_B, () => db.transaction(async (tx) =>
      tx.select().from(storeReceiptNotes).where(eq(storeReceiptNotes.grnId, grnId))));
    expect(leaked).toHaveLength(0);
  });
});
