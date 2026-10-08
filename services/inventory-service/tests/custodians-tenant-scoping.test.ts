/**
 * Custodian Routes — Tenant-Scoped Read Regression
 *
 * services/inventory-service/src/modules/custodians/routes.ts previously ran
 * both GET handlers through a bare `db.select()` — a pooled connection with
 * no `app.tenant_id` GUC set. Under this table's FORCE ROW LEVEL SECURITY
 * policy that silently returns zero rows for every tenant, not just other
 * tenants' data (see shared/db.ts's scopedRead() doc comment). This suite
 * pins both GET endpoints to the same tenant-scoped-read + cross-tenant-
 * isolation pattern already covered for other modules in rls-isolation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { withTenantConsumer, runWithTenant } from "@civitasone/db";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCustodianConsumers } from "../src/modules/custodians/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "cccccccc-0000-4000-8000-000000000001";
const TENANT_B = "dddddddd-0000-4000-8000-000000000002";
const ACTOR_A = "cccccccc-0000-4000-8000-cccccccccccc";
const ACTOR_B = "dddddddd-0000-4000-8000-dddddddddddd";

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-custodians" }, SECRET, 3600);
}

const drain = () => (queue as unknown as MemoryQueue).drain();

/** Wrap the shared queue so consumer handlers run inside the tenant GUC. */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Read custodian audit events enqueued to the transactional outbox. */
async function custodianAuditActions(): Promise<string[]> {
  const rows = await runWithTenant(TENANT_A, () =>
    db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, TENANT_A), eq(outboxMessages.topic, "audit.event.record")))));
  return rows
    .map((r) => (r.payload ?? {}) as { resourceType?: string; action?: string; resourceId?: string })
    .filter((p) => p.resourceType === "custodian")
    .map((p) => `${p.action}:${p.resourceId}`);
}

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;
const storeId = randomUUID();
let createdCustodianId: string | undefined;

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerCustodianConsumers(queue);
  app = await buildApp();
  tokenA = tokenForTenant(TENANT_A, ACTOR_A);
  tokenB = tokenForTenant(TENANT_B, ACTOR_B);
});

afterAll(async () => {
  // Clean the rows this suite created so repeat runs stay deterministic.
  const { custodians } = await import("../src/modules/items/schema.js");
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(custodians).where(eq(custodians.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  await app.close();
  await sqlClient.end();
});

describe("Custodians — CQRS write path + tenant-scoped reads", () => {
  it("Tenant A creates a custodian assignment via CQRS (202 Accepted), no insert in the route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/custodians",
      headers: { authorization: `Bearer ${tokenA}`, "x-tenant-id": TENANT_A, "content-type": "application/json" },
      payload: {
        storeId,
        employeeRef: randomUUID(),
        designation: "Store Keeper",
        effectiveFrom: "2026-01-01",
      },
    });
    // GAP2-INVENTORY-CUSTODIANS-01: route publishes a command and returns 202, not 201.
    expect(res.statusCode).toBe(202);
    const body = res.json();
    createdCustodianId = body.id;
    expect(createdCustodianId).toBeDefined();
    expect(body.status).toBe("accepted");

    // Drive the consumer: it applies the insert and audits in one transaction.
    await drain();

    // GAP2-INVENTORY-CUSTODIANS-01: the create must emit an audit event
    // (enqueued to the transactional outbox in the same tx as the insert).
    const actions = await custodianAuditActions();
    expect(actions).toContain(`create:${createdCustodianId}`);
  });

  it("Tenant A: GET /v1/inventory/custodians (list all) returns the new custodian, not an empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/custodians",
      headers: { authorization: `Bearer ${tokenA}`, "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((c: { id?: string }) => c.id === createdCustodianId)).toBe(true);
  });

  it("Tenant A: GET /v1/inventory/stores/:id/custodians returns the new custodian, not an empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/stores/${storeId}/custodians`,
      headers: { authorization: `Bearer ${tokenA}`, "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((c: { id?: string }) => c.id === createdCustodianId)).toBe(true);
  });

  it("Tenant B: GET /v1/inventory/custodians (list all) shows zero of Tenant A's custodians", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/custodians",
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((c: { id?: string }) => c.id === createdCustodianId)).toBe(false);
  });

  it("Tenant B: GET /v1/inventory/stores/:id/custodians (Tenant A's store) shows zero", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/stores/${storeId}/custodians`,
      headers: { authorization: `Bearer ${tokenB}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data).toHaveLength(0);
  });
});
