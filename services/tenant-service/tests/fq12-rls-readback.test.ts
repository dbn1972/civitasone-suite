/**
 * FQ12 (UAT items #139-#144, #147, and (g)) — subscriptions + quotas reads
 * under FORCE ROW LEVEL SECURITY.
 *
 * subscriptions.subscriptions and quotas.quotas are FORCE RLS with
 * `tenant_id = tenant.current_tenant_id()`. The GUC behind that function is
 * only set inside a runWithTenant()-wrapped db.transaction(); the bare
 * db.select() reads in subscriptions/repo.ts (findById, findByTenantId) and
 * quotas/repo.ts (findAllByTenant, findByTenantAndResource) never set it, so
 * every GET returned []/404 although the rows were in the table.
 *
 * Rows are seeded through the same tenant-scoped path the consumers use and
 * read back through the public routes. A second tenant must still see nothing.
 *
 * Also locks (g): POST /v1/quotas for an existing (tenant, resource) is an
 * upsert, so the 202 must carry the id of the row it updates, not a fresh one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerQuotaConsumers } from "../src/modules/quotas/consumer.js";
import { quotas } from "../src/modules/quotas/schema.js";
import { subscriptions } from "../src/modules/subscriptions/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "10001212-aaaa-4000-8000-000000000139";
const TENANT_B = "20001212-bbbb-4000-8000-000000000139";
const ACTOR = "aa001212-0012-4000-8000-0000000139aa";
const SUB_ID = randomUUID();

function bearer(tid: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-fq12" }, SECRET, 3600)}` };
}
const ADMIN = ["platform_admin", "tenant_admin"];

async function cleanup(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(quotas).where(eq(quotas.tenantId, tenantId));
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  }));
}

async function quotaRows(tenantId: string) {
  return runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.select({ id: quotas.id, resource: quotas.resource }).from(quotas).where(eq(quotas.tenantId, tenantId))));
}

let app: FastifyInstance;

describe("FQ12 tenant-service — RLS read-back for subscriptions and quotas", () => {
  beforeAll(async () => {
    app = await buildApp();
    registerQuotaConsumers(queue);
    await queue.start();
    await cleanup(TENANT_A);
    await cleanup(TENANT_B);
    const now = new Date();
    await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(subscriptions).values({
      id: SUB_ID, tenantId: TENANT_A, planId: randomUUID(), status: "active",
      startDate: now, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      createdBy: ACTOR, updatedBy: ACTOR,
    })));
  });

  afterAll(async () => {
    await cleanup(TENANT_A);
    await cleanup(TENANT_B);
    await app.close();
  });

  it("GET /v1/subscriptions/:id returns a row written before the cache was warm (#141-#144)", async () => {
    await cache.invalidate(cache.makeKey(TENANT_A, "subscription", SUB_ID));
    const res = await app.inject({ method: "GET", url: `/v1/subscriptions/${SUB_ID}`, headers: bearer(TENANT_A, ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: SUB_ID, tenantId: TENANT_A, status: "active" });
  });

  it("GET /v1/subscriptions/current returns the tenant's subscription (#140)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/subscriptions/current", headers: bearer(TENANT_A, ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: SUB_ID });
  });

  it("GET /v1/tenant/subscription/current returns the tenant's subscription (#147)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/current", headers: bearer(TENANT_A, ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: SUB_ID });
  });

  it("another tenant still cannot read the subscription", async () => {
    const byId = await app.inject({ method: "GET", url: `/v1/subscriptions/${SUB_ID}`, headers: bearer(TENANT_B, ["tenant_admin"]) });
    expect(byId.statusCode).toBe(404);
    const cur = await app.inject({ method: "GET", url: "/v1/subscriptions/current", headers: bearer(TENANT_B, ["tenant_admin"]) });
    expect(cur.statusCode).toBe(404);
  });

  it("POST /v1/quotas then GET /v1/quotas/:tenantId, /:resource and /v1/tenant/usage read the row back (#139)", async () => {
    const set = await app.inject({
      method: "POST", url: "/v1/quotas", headers: bearer(TENANT_A, ADMIN),
      payload: { tenantId: TENANT_A, resource: "documents", limit: 50 },
    });
    expect(set.statusCode).toBe(202);
    await (queue as unknown as MemoryQueue).drain();

    const list = await app.inject({ method: "GET", url: `/v1/quotas/${TENANT_A}`, headers: bearer(TENANT_A, ADMIN) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([expect.objectContaining({ tenantId: TENANT_A, resource: "documents", limit: 50 })]);

    const one = await app.inject({ method: "GET", url: `/v1/quotas/${TENANT_A}/documents`, headers: bearer(TENANT_A, ADMIN) });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ resource: "documents", limit: 50 });

    const usage = await app.inject({ method: "GET", url: "/v1/tenant/usage", headers: bearer(TENANT_A, ADMIN) });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().resources).toEqual([expect.objectContaining({ resource: "documents", limit: 50 })]);

    const other = await app.inject({ method: "GET", url: `/v1/quotas/${TENANT_B}`, headers: bearer(TENANT_B, ["tenant_admin"]) });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual([]);
  });

  it("POST /v1/quotas: the 202 id is the quota row id, also on an upsert of an existing row ((g))", async () => {
    const existing = (await quotaRows(TENANT_A)).find((r) => r.resource === "documents")?.id;
    expect(existing).toBeDefined();

    const again = await app.inject({
      method: "POST", url: "/v1/quotas", headers: bearer(TENANT_A, ADMIN),
      payload: { tenantId: TENANT_A, resource: "documents", limit: 75 },
    });
    expect(again.statusCode).toBe(202);
    expect(again.json().id).toBe(existing);
    await (queue as unknown as MemoryQueue).drain();
    expect((await quotaRows(TENANT_A)).find((r) => r.resource === "documents")?.id).toBe(existing);

    const fresh = await app.inject({
      method: "POST", url: "/v1/quotas", headers: bearer(TENANT_A, ADMIN),
      payload: { tenantId: TENANT_A, resource: "users", limit: 10 },
    });
    expect(fresh.statusCode).toBe(202);
    await (queue as unknown as MemoryQueue).drain();
    expect((await quotaRows(TENANT_A)).find((r) => r.resource === "users")?.id).toBe(fresh.json().id);
  });
});
