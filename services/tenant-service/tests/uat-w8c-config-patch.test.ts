/**
 * UAT W8-C (P1 accept-nonexistent): PATCH /v1/tenants/:tenantId/config answered 202 for a random
 * tenantId, creating a tenant_configs row for a tenant that does not exist (getOrInitConfig). It also
 * had no cross-tenant rule, unlike the GET beside it: any tenant_admin could rewrite another tenant's
 * modules / feature flags / billing config. Now: non-platform callers may only patch their own tenant
 * (403 otherwise), and the tenant must exist (404), read in the same tenant-scoped transaction.
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
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const hdr = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-w8c" }, SECRET, 3600)}`,
});

async function configRows(tid: string): Promise<number> {
  const rows = await runWithTenant(tid, () => db.transaction((tx) => tx.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tid))));
  return rows.length;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  for (const id of [A, B]) {
    await runWithTenant(id, () => db.transaction((tx) => tx.insert(tenants).values({
      id, tenantId: id, name: `w8c-${id.slice(0, 8)}`, domain: `${id}.example.test`, edition: "govt", status: "active",
      region: "ap-south-1", residency: "IN", createdBy: ACTOR, updatedBy: ACTOR,
    })));
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

describe("PATCH /v1/tenants/:tenantId/config", () => {
  it("unknown tenant (platform caller) -> 404 and no config row is created", async () => {
    const ghost = randomUUID();
    for (const payload of [{}, INVALID_FIELDS]) {
      const res = await app.inject({ method: "PATCH", url: `/v1/tenants/${ghost}/config`, headers: hdr(["super_admin"], A), payload });
      expect(res.statusCode).toBe(404);
    }
    expect(await configRows(ghost)).toBe(0);
  });

  it("a tenant_admin cannot patch ANOTHER tenant's config -> 403, nothing written", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/tenants/${B}/config`, headers: hdr(["tenant_admin"], A), payload: { featureFlags: { evil: true } } });
    expect(res.statusCode).toBe(403);
    expect(await configRows(B)).toBe(0);
  });

  it("a tenant_admin patches its OWN existing tenant -> 202", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/tenants/${A}/config`, headers: hdr(["tenant_admin"], A), payload: { featureFlags: { beta: true } } });
    expect(res.statusCode).toBe(202);
    const cfg = await app.inject({ method: "GET", url: `/v1/tenants/${A}/config`, headers: hdr(["tenant_admin"], A) });
    expect(cfg.json()).toMatchObject({ featureFlags: { beta: true } });
  });

  it("a platform admin may still patch another existing tenant -> 202", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/tenants/${B}/config`, headers: hdr(["platform_admin"], A), payload: { modules: { hrms: true } } });
    expect(res.statusCode).toBe(202);
  });
});
