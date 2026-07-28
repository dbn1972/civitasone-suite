/**
 * Internal composition endpoint (service-to-service) that feeds the gateway
 * module-guard. Verifies: un-onboarded tenants are `configured:false` (gateway
 * fails open), onboarded tenants return the dependency-resolved allow-list
 * projected to the gateway's route-key vocabulary. In test env
 * INTERNAL_SERVICE_SECRET is unset → the route is treated as internal (dev mode).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const ONBOARDED = "cccccccc-dddd-4000-8000-0000000000f7";
const VIRGIN = "cccccccc-dddd-4000-8000-0000000000f8";
const ADMIN = "11111111-eeee-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANTS = [ONBOARDED, VIRGIN];

let app: FastifyInstance;
let signToken: (p: Record<string, unknown>, s: string, ttl: number) => string;
// The internal endpoint accepts either a valid INTERNAL_SERVICE_SECRET (used by
// the gateway) OR super-admin JWT fallback. INTERNAL_SERVICE_SECRET is injected
// into the app after import here, so we exercise the endpoint via the JWT
// fallback — the same way the existing modules-list route tests do.
const auth = () => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: ONBOARDED, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}` });

beforeAll(async () => {
  ({ signToken } = await import("@civitasone/auth"));
  app = await buildApp();
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
  // ONBOARDED gets the govt profile (widest module set)
  const tok = signToken({ sub: ADMIN, tid: ONBOARDED, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600);
  await app.inject({
    method: "POST",
    url: "/v1/admin/composition/onboard",
    headers: { authorization: `Bearer ${tok}` },
    payload: { profile: "govt_dept" },
  });
});
afterAll(async () => {
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/admin/composition/internal/:tenantId/modules", () => {
  it("un-onboarded tenant → configured:false (gateway fails open)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${VIRGIN}/modules`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.data).toEqual([]);
  });

  it("onboarded govt tenant → resolved allow-list in gateway route-keys", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${ONBOARDED}/modules`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    const keys = body.data.map((m: { name: string }) => m.name);
    // HR cluster projects to "hrms"; payroll/finance/procurement present; core→workflow
    expect(keys).toEqual(expect.arrayContaining(["hrms", "payroll", "finance", "procurement", "workflow"]));
    // govt has no CRM by default → "crm" absent
    expect(keys).not.toContain("crm");
  });

  it("rejects a malformed tenant id (400)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/internal/not-a-uuid/modules", headers: auth() });
    expect(res.statusCode).toBe(400);
  });
});
