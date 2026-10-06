/**
 * GAP-PLATFORM-ADMIN-TENANT-CONFIG-01 / -02 — GET /v1/admin/tenant-config.
 *
 * Reads the CALLER's real admin_tenants row (never the old fabricated
 * DEFAULT_CONFIG), against a real Postgres with FORCE RLS on. Also pins the
 * infrastructure-identifier gate: dbSchema / keycloakRealm are returned only
 * to a platform_admin / super_admin; a tenant_admin gets them as null.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { db, sqlClient } = await import("../src/shared/db.js");
const { adminTenants } = await import("../src/modules/tenants/schema.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "0c000000-0000-4000-8000-0000000000c1";
const ACTOR = "0c111111-0000-4000-8000-000000000001";

function bearer(roles: string[], tid = T): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-tc" }, SECRET, 3600)}` };
}

async function wipe(): Promise<void> {
  await runWithTenant(T, () => db.transaction((tx) => tx.delete(adminTenants).where(eq(adminTenants.tenantId, T))));
}

async function seed(settings: Record<string, unknown> = {}): Promise<void> {
  await wipe();
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminTenants).values({
    id: T, tenantId: T, name: "Pune Municipal Office", domain: `tc-${T}.example`, edition: "govt_dept",
    status: "active", region: "ap-south-1", residency: "IN", settings,
    createdBy: ACTOR, updatedBy: ACTOR, version: 1,
  })));
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await seed({ features: ["hrms", "pfms_integration"] }); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const get = (roles: string[], tid = T) =>
  app.inject({ method: "GET", url: "/v1/admin/tenant-config", headers: bearer(roles, tid) });

describe("GET /v1/admin/tenant-config", () => {
  it("returns the caller's REAL office row, not the fabricated DEFAULT_CONFIG", async () => {
    const r = await get(["platform_admin"]);
    expect(r.statusCode).toBe(200);
    const data = r.json().data as Record<string, unknown>;
    expect(data.tenantName).toBe("Pune Municipal Office");
    expect(data.tenantName).not.toBe("Government of India — Pilot Tenant");
    expect(data.tenantId).toBe(T);
    expect(data.features).toEqual(["hrms", "pfms_integration"]);
    // Never-fabricated licence/quota numbers come back null, not invented.
    expect(data.licensedSeats).toBeNull();
    expect(data.storageQuotaGb).toBeNull();
  });

  it("exposes dbSchema + keycloakRealm to a platform_admin", async () => {
    const data = (await get(["platform_admin"])).json().data as Record<string, unknown>;
    expect(typeof data.dbSchema).toBe("string");
    expect(typeof data.keycloakRealm).toBe("string");
  });

  it("HIDES dbSchema + keycloakRealm from a plain tenant_admin (TENANT-CONFIG-02)", async () => {
    const r = await get(["tenant_admin"]);
    expect(r.statusCode).toBe(200);
    const data = r.json().data as Record<string, unknown>;
    expect(data.dbSchema).toBeNull();
    expect(data.keycloakRealm).toBeNull();
    // Non-infra fields are still present for a tenant_admin.
    expect(data.tenantName).toBe("Pune Municipal Office");
  });

  it("403 for a signed-in user without an admin role", async () => {
    expect((await get(["viewer"])).statusCode).toBe(403);
  });

  it("404 when the caller's office has no config row on record", async () => {
    const other = "0c999999-0000-4000-8000-0000000000c9";
    expect((await get(["platform_admin"], other)).statusCode).toBe(404);
  });
});
