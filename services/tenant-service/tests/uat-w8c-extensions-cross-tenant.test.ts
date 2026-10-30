/**
 * UAT W8-C (independent review of #2395): GET /v1/tenants/:tenantId/billing had no cross-tenant rule, so
 * a tenant_admin of tenant A read tenant B's billing (200). It now has the same rule as GET /config:
 * non-platform callers may only touch their own tenant (403 otherwise); platform roles are unchanged.
 *
 * The second block locks EVERY :tenantId route of the tenant-extensions module against the same gap:
 * a tenant_admin of A gets 403 on tenant B for each of them (by the cross-tenant rule, or by the
 * platform-only role gate), and nothing is written for B.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants, tenantConfigs } from "../src/modules/tenant/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();

const hdr = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-w8c-ext" }, SECRET, 3600)}`,
});

async function billingOf(tid: string): Promise<unknown> {
  const rows = await runWithTenant(tid, () => db.transaction((tx) => tx.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tid))));
  return rows[0]?.billing ?? null;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  for (const id of [A, B]) {
    await runWithTenant(id, () => db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id, tenantId: id, name: `w8c-ext-${id.slice(0, 8)}`, domain: `${id}.example.test`, edition: "govt", status: "active",
        region: "ap-south-1", residency: "IN", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(tenantConfigs).values({ tenantId: id, modules: {}, featureFlags: {}, billing: { plan: `plan-${id.slice(0, 4)}` }, updatedBy: null });
    }));
  }
});

afterAll(async () => {
  for (const id of [A, B]) {
    await runWithTenant(id, () => db.transaction(async (tx) => {
      await tx.delete(tenantConfigs).where(eq(tenantConfigs.tenantId, id));
      await tx.delete(tenants).where(eq(tenants.id, id));
    })).catch(() => undefined);
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/tenants/:tenantId/billing", () => {
  it("tenant_admin of A reading tenant B's billing -> 403 (was 200 with B's billing)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${B}/billing`, headers: hdr(["tenant_admin"], A) });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(`plan-${B.slice(0, 4)}`);
  });
  it("tenant_admin reading its OWN billing -> 200", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${A}/billing`, headers: hdr(["tenant_admin"], A) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: A, billing: { plan: `plan-${A.slice(0, 4)}` } });
  });
  for (const role of ["platform_admin", "super_admin"]) {
    it(`${role} may still read another tenant's billing -> 200 (unchanged)`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/tenants/${B}/billing`, headers: hdr([role], A) });
      expect(res.statusCode).toBe(200);
      expect(res.json().billing).toEqual({ plan: `plan-${B.slice(0, 4)}` });
    });
  }
});

describe("every tenant-extensions :tenantId route refuses a tenant_admin of another tenant (403)", () => {
  const ROUTES: Array<{ method: "GET" | "PATCH"; path: string; payload?: Record<string, unknown> }> = [
    { method: "GET", path: "config" },
    { method: "PATCH", path: "config", payload: { billing: { plan: "evil" } } },
    { method: "PATCH", path: "modules", payload: { modules: { evil: true } } },
    { method: "GET", path: "feature-flags" },
    { method: "PATCH", path: "feature-flags", payload: { featureFlags: { evil: true } } },
    { method: "GET", path: "stats" },
    { method: "GET", path: "billing" },
    { method: "PATCH", path: "billing", payload: { billing: { plan: "evil" } } },
  ];
  for (const r of ROUTES) {
    it(`${r.method} /v1/tenants/:tenantId/${r.path}`, async () => {
      const res = await app.inject({ method: r.method, url: `/v1/tenants/${B}/${r.path}`, headers: hdr(["tenant_admin"], A), ...(r.payload ? { payload: r.payload } : {}) });
      expect(res.statusCode).toBe(403);
    });
  }
  it("nothing was written to tenant B", async () => {
    expect(await billingOf(B)).toEqual({ plan: `plan-${B.slice(0, 4)}` });
  });
});
