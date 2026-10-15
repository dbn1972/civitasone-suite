/**
 * GAP-TENANT-ADMIN-ORG-TYPE-05 (real DB, real Fastify): PATCH /v1/tenants/:tenantId
 *  - validates settings.orgType (bogus -> 400, nothing stored)
 *  - a tenant_admin may update ONLY their own tenant: naming another tenant is 403
 *    and the other tenant's row is untouched (before the guard it was accepted and
 *    applied under the TARGET tenant's RLS)
 *  - a platform_admin may update any tenant
 *  - an accepted update leaves an audit event in the outbox
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";
import { queue } from "../src/shared/infra.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}`,
});
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

async function row(id: string) {
  const rows = await runWithTenant(id, () => db.transaction((tx) => tx.select().from(tenants).where(eq(tenants.id, id))));
  return rows[0]!;
}
async function seed(id: string, name: string) {
  await runWithTenant(id, () => db.transaction((tx) => tx.insert(tenants).values({
    id, tenantId: id, name, domain: `${id}.example.test`, edition: "govt", status: "active",
    region: "ap-south-1", residency: "IN", createdBy: ACTOR, updatedBy: ACTOR,
  })));
}
async function cleanup() {
  for (const t of [A, B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(tenants).where(eq(tenants.id, t));
    }));
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  registerTenantConsumers(queue);
  await queue.start();
  app = await buildApp();
  await cleanup();
  await seed(A, "Tenant A");
  await seed(B, "Tenant B");
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("PATCH /v1/tenants/:tenantId", () => {
  it("rejects a bogus orgType with 400 and stores nothing", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/tenants/${A}`, headers: bearer(["tenant_admin"], A), payload: { settings: { orgType: "bogus" } } });
    expect(r.statusCode).toBe(400);
    await drain();
    expect((await row(A)).settings).toEqual({});
  });

  it("a tenant_admin of A cannot update tenant B: 403 and B is untouched", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/tenants/${B}`, headers: bearer(["tenant_admin"], A), payload: { name: "Hijacked" } });
    expect(r.statusCode).toBe(403);
    await drain();
    expect((await row(B)).name).toBe("Tenant B");
  });

  it("a tenant_admin can update their own tenant (orgType stored, audit event written)", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/tenants/${A}`, headers: bearer(["tenant_admin"], A), payload: { settings: { orgType: "municipal" } } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await row(A)).settings).toMatchObject({ orgType: "municipal" });
    const out = await runWithTenant(A, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, A))));
    expect(out.some((o) => (o.payload as { action?: string }).action === "update")).toBe(true);
  });

  it("a platform_admin can update any tenant", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/tenants/${B}`, headers: bearer(["platform_admin"], A), payload: { name: "Tenant B renamed" } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await row(B)).name).toBe("Tenant B renamed");
  });
});
