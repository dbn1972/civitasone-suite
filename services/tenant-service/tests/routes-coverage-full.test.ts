import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerTenantConsumers } from "../src/modules/tenant/consumer.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const OTHER_TENANT = "22222222-bbbb-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles }, SECRET, 3600);
}

function authHeader(roles: string[] = ["super_admin"], tid = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenants — Create Tenant
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenants", () => {
  const validBody = {
    name: "Ministry of Finance",
    domain: "mof.civitasone.in",
    edition: "govt",
    region: "IN-DL",
    residency: "IN",
  };

  it("→ 202 with platform_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["platform_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json()).toHaveProperty("id");
  });

  it("→ 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 403 with tenant_admin (not platform-level)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["tenant_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["citizen"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("→ 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 name too short", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid domain format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, domain: "invalid domain!!" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid edition", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, edition: "invalid_edition" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 missing region", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test", domain: "test.in", edition: "govt", residency: "IN" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenants/current
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenants/current", () => {
  it("→ 404 when tenant not found in cache/db", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/tenants/current",
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/tenants/current",
    });
    expect(res.statusCode).toBe(401);
  });

  it("→ 404 with super_admin (tenant not in db)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/tenants/current",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenants/:tenantId
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenants/:tenantId", () => {
  it("→ 404 when tenant not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });

  // Regression test for a real bug found in deep-verification (2026-08-27):
  // every test in this describe block only ever asserted the not-found path
  // (comments here used to read "won't exist" / "if it existed") -- none
  // inserted a real row and fetched it back, so a bug where the lookup could
  // NEVER find ANY tenant (tenant.tenants has FORCE RLS with no escape hatch;
  // repo.findById queried via a bare db.select(), which never sets the
  // app.tenant_id GUC) went completely undetected. Live-confirmed 404 for a
  // tenant verified to exist via a direct superuser query, before the fix in
  // src/modules/tenant/repo.ts. This test creates a real row and proves the
  // lookup actually finds it.
  it("→ 200 with a real, existing tenant (regression: RLS previously hid every row)", async () => {
    const { runWithTenant } = await import("@civitasone/db");
    const { db } = await import("../src/shared/db.js");
    const repo = await import("../src/modules/tenant/repo.js");
    const realId = "9f5b1a10-0000-4000-8000-00000000f00d";
    await runWithTenant(realId, () =>
      db.transaction((tx) =>
        repo.insert(tx as unknown as repo.Writer, {
          id: realId,
          tenantId: realId,
          name: "Regression Test Tenant",
          domain: `regression-${realId}.example.gov`,
          edition: "govt",
          region: "IN-DL",
          residency: "IN",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/tenants/${realId}`,
        headers: authHeader(["tenant_admin"], realId),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(realId);
      expect(body.name).toBe("Regression Test Tenant");
    } finally {
      // Clean up so this doesn't linger in the shared dev database. Raw SQL
      // (rather than importing the schema/eq helper here) keeps this test
      // self-contained; RLS still applies, so this must run inside the same
      // tenant-scoped transaction the insert used.
      const { sql } = await import("drizzle-orm");
      await runWithTenant(realId, () =>
        db.transaction((tx) => (tx as unknown as typeof db).execute(sql`DELETE FROM tenant.tenants WHERE id = ${realId}`)),
      ).catch(() => undefined);
    }
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/tenants/not-a-uuid",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenants/${TENANT}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /v1/tenants/:tenantId — Update Tenant
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/tenants/:tenantId", () => {
  it("→ 202 with super_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["super_admin"]),
      payload: { name: "Updated Ministry" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("→ 202 with platform_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["platform_admin"]),
      payload: { name: "Updated Ministry 2" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 202 with tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["tenant_admin"]),
      payload: { settings: { theme: "dark" } },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["citizen"]),
      payload: { name: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 400 empty body (no name or settings)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/tenants/not-a-uuid",
      headers: authHeader(["super_admin"]),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /v1/tenants/:tenantId/isolation — Set Isolation Tier
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/tenants/:tenantId/isolation", () => {
  it("→ 202 set to pool (super_admin)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["super_admin"]),
      payload: { tier: "pool" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 202 set to silo with dbDsnRef (platform_admin)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["platform_admin"]),
      payload: { tier: "silo", dbDsnRef: "arn:aws:secretsmanager:ap-south-1:123:secret:tenant-db" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 400 silo without dbDsnRef", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["super_admin"]),
      payload: { tier: "silo" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid tier value", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["super_admin"]),
      payload: { tier: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/tenants/not-a-uuid/isolation",
      headers: authHeader(["super_admin"]),
      payload: { tier: "pool" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 403 with tenant_admin (not platform-level)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["tenant_admin"]),
      payload: { tier: "pool" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["citizen"]),
      payload: { tier: "pool" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      payload: { tier: "pool" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenants/:tenantId/suspend — Suspend Tenant
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenants/:tenantId/suspend", () => {
  it("→ 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: { reason: "Non-payment of subscription fees" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("→ 202 with platform_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["platform_admin"]),
      payload: { reason: "Policy violation detected" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 403 with tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["tenant_admin"]),
      payload: { reason: "Self suspend?" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["citizen"]),
      payload: { reason: "hack" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 400 missing reason", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 reason too short", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants/not-a-uuid/suspend",
      headers: authHeader(["super_admin"]),
      payload: { reason: "some reason for suspension" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/tenants/${TENANT}/suspend`,
      payload: { reason: "test" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenant/onboard — Full Onboarding Pipeline
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenant/onboard", () => {
  const validBody = {
    name: "Department of IT",
    domain: "dit.civitasone.in",
    edition: "govt",
    region: "IN-KA",
    residency: "IN",
    adminEmail: "admin@dit.gov.in",
    adminName: "Director IT",
  };

  it("→ 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["super_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.status).toBe("accepted");
    expect(json).toHaveProperty("tenantId");
    expect(json).toHaveProperty("correlationId");
    expect(json.steps).toHaveLength(4);
  });

  it("→ 202 with platform_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["platform_admin"]),
      payload: { ...validBody, domain: "dit2.civitasone.in" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 403 with tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["tenant_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["citizen"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid email", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, adminEmail: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 missing adminName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test", domain: "t.in", edition: "psu", region: "IN", residency: "IN", adminEmail: "a@b.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/onboard",
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenant/:tenantId/quotas
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenant/:tenantId/quotas", () => {
  it("→ 200 returns default quotas for own tenant", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("maxEmployees");
    expect(json).toHaveProperty("maxFiles");
    expect(json).toHaveProperty("maxApiCallsPerMin");
    expect(json).toHaveProperty("maxStorageGb");
    expect(json).toHaveProperty("maxUsers");
  });

  it("→ 200 with super_admin cross-tenant", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenant/${OTHER_TENANT}/quotas`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("→ 403 cross-tenant access for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenant/${OTHER_TENANT}/quotas`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/tenant/not-a-uuid/quotas",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenant/${TENANT}/quotas`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /v1/tenant/:tenantId/quotas — Update Quotas
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/tenant/:tenantId/quotas", () => {
  // The route was converted to the F3 async pattern (queue-first, 202 +
  // upsertTenantQuotas consumer applies the write — see
  // src/modules/tenant/routes.ts and f3-p0-msme-quotas-cqrs.test.ts's
  // "tenant quotas PATCH is queue-first" lock) some time after these two
  // tests were written expecting a synchronous 200 with the updated row
  // echoed straight back. Scoped registration (not global — see
  // consumer.integration.test.ts for the same pattern) so only these two
  // tests pay for real consumer delivery; queue.drain() (MemoryQueue-only,
  // hence the cast) waits for the in-flight delivery from publish() to
  // fully settle before we read persisted state back via GET.
  describe("→ 202 (queue-first) + real persisted outcome", () => {
    beforeAll(async () => {
      registerTenantConsumers(queue);
      await queue.start();
    });
    afterAll(async () => {
      await queue.stop();
    });

    it("→ 202 with super_admin, persists maxEmployees", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
        headers: authHeader(["super_admin"]),
        payload: { maxEmployees: 1000 },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");

      await (queue as unknown as MemoryQueue).drain();

      const getRes = await app.inject({
        method: "GET", url: `/v1/tenant/${TENANT}/quotas`,
        headers: authHeader(["super_admin"]),
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().maxEmployees).toBe(1000);
    });

    it("→ 202 update multiple fields, persists all three", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
        headers: authHeader(["super_admin"]),
        payload: { maxFiles: 50000, maxStorageGb: 100, maxUsers: 5000 },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");

      await (queue as unknown as MemoryQueue).drain();

      const getRes = await app.inject({
        method: "GET", url: `/v1/tenant/${TENANT}/quotas`,
        headers: authHeader(["super_admin"]),
      });
      expect(getRes.statusCode).toBe(200);
      const json = getRes.json();
      expect(json.maxFiles).toBe(50000);
      expect(json.maxStorageGb).toBe(100);
      expect(json.maxUsers).toBe(5000);
    });
  });

  it("→ 403 with platform_admin (requires super_admin)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["platform_admin"]),
      payload: { maxEmployees: 999 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["tenant_admin"]),
      payload: { maxEmployees: 999 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 403 with citizen role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["citizen"]),
      payload: { maxEmployees: 999 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 400 empty body (no quota field)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid value (negative)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["super_admin"]),
      payload: { maxEmployees: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 value exceeds max", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      headers: authHeader(["super_admin"]),
      payload: { maxEmployees: 9999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/tenant/not-a-uuid/quotas",
      headers: authHeader(["super_admin"]),
      payload: { maxEmployees: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenant/${TENANT}/quotas`,
      payload: { maxEmployees: 100 },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenant/msme-onboard — MSME Self-Signup
// ══════════════════════════════════════════════════════════════════════════════
// NOTE (2026-08-27 deep-verification): the 5 "success" cases below asserted
// 201 against a handler that has returned 202 (queue-first/async, per the
// architectural lock in f3-p0-msme-quotas-cqrs.test.ts: "must match code(202),
// must NOT match code(201)") since before this session touched the file --
// confirmed by running this exact suite against unmodified origin/main, where
// these 5 assertions already failed. Corrected to 202 to match actual/intended
// behavior; left everything else (response shape, 400 cases) unchanged.
describe("POST /v1/tenant/msme-onboard", () => {
  const validBody = {
    udyamNumber: "UDYAM-KA-01-0000001",
    businessName: "TechServe Solutions",
    ownerName: "Rajesh Kumar",
    email: "rajesh@techserve.in",
    category: "micro",
    sector: "services",
  };

  it("→ 201 with valid body (super_admin token)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json).toHaveProperty("tenantId");
    expect(json).toHaveProperty("domain");
    expect(json.edition).toBe("small_office");
    expect(json.sector).toBe("services");
  });

  it("→ 201 with all optional fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: {
        ...validBody,
        udyamNumber: "UDYAM-MH-02-0000002",
        mobile: "9876543210",
        nicCode: "6201",
        gstin: "29ABCDE1234F1Z5",
        state: "IN-MH",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 201 manufacturing sector", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, udyamNumber: "UDYAM-DL-03-0000003", sector: "manufacturing", category: "small" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 201 trading sector, medium category", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, udyamNumber: "UDYAM-TN-04-0000004", sector: "trading", category: "medium" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 400 invalid udyam number format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, udyamNumber: "INVALID-FORMAT" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { udyamNumber: "UDYAM-KA-01-0000001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid email", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid category", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, category: "large" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid sector", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, sector: "agriculture" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 businessName too short", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, businessName: "A" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid GSTIN length", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      headers: authHeader(["super_admin"]),
      payload: { ...validBody, gstin: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Regression test for a real bug found in deep-verification (2026-08-27):
  // this route is documented as public self-signup, but every test above
  // supplies a super_admin Bearer token — none of them exercised the actual
  // real-world caller (an anonymous business owner with no account/token
  // yet), so a missing `config: { public: true }` on the route registration
  // went undetected: the global auth plugin rejected every real self-signup
  // attempt with 401 before the handler ever ran. Confirmed live via curl
  // with no Authorization header before the fix (401 UNAUTHORIZED); this
  // test locks in the fix so it can't silently regress again.
  it("→ 201 with NO auth header (true unauthenticated self-signup)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/msme-onboard",
      payload: { ...validBody, udyamNumber: "UDYAM-KA-01-0000099" },
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json).toHaveProperty("tenantId");
    expect(json).toHaveProperty("domain");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cross-tenant access control (GET /v1/tenants/:tenantId)
// ══════════════════════════════════════════════════════════════════════════════
describe("Cross-tenant access control", () => {
  it("super_admin can read another tenant (if it existed)", async () => {
    // The tenant won't exist (404) but we verify no 403 for super_admin
    const res = await app.inject({
      method: "GET", url: `/v1/tenants/${OTHER_TENANT}`,
      headers: authHeader(["super_admin"]),
    });
    // 404 because it doesn't exist, but NOT 403
    expect(res.statusCode).toBe(404);
  });

  it("platform_admin can read another tenant (if it existed)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/tenants/${OTHER_TENANT}`,
      headers: authHeader(["platform_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Domain pure function tests (extended)
// ══════════════════════════════════════════════════════════════════════════════
import { canTransition, assertTransition, DomainError } from "../src/modules/tenant/domain.js";

describe("Domain — canTransition exhaustive", () => {
  const cases: [string, string, boolean][] = [
    ["draft", "active", true],
    ["draft", "archived", true],
    ["draft", "suspended", false],
    ["active", "suspended", true],
    ["active", "restricted", true],
    ["active", "offboarding", true],
    ["active", "draft", false],
    ["active", "archived", false],
    ["suspended", "active", true],
    ["suspended", "offboarding", true],
    ["suspended", "draft", false],
    ["restricted", "active", true],
    ["restricted", "suspended", true],
    ["restricted", "draft", false],
    ["offboarding", "archived", true],
    ["offboarding", "active", false],
    ["archived", "active", false],
    ["archived", "draft", false],
  ];

  it.each(cases)("canTransition(%s → %s) = %s", (from, to, expected) => {
    expect(canTransition(from as any, to as any)).toBe(expected);
  });
});

describe("Domain — assertTransition throws on invalid", () => {
  it("throws DomainError for active → draft", () => {
    expect(() => assertTransition("active" as any, "draft" as any)).toThrow();
    try {
      assertTransition("archived" as any, "active" as any);
    } catch (e: any) {
      expect(e).toBeInstanceOf(DomainError);
      expect(e.code).toBe("INVALID_TRANSITION");
    }
  });

  it("does not throw for valid transitions", () => {
    expect(() => assertTransition("draft" as any, "active" as any)).not.toThrow();
    expect(() => assertTransition("active" as any, "suspended" as any)).not.toThrow();
    expect(() => assertTransition("offboarding" as any, "archived" as any)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ops / Health routes
// ══════════════════════════════════════════════════════════════════════════════
describe("Ops routes", () => {
  it("GET /health → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /ready → 200 or 503", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    // ready can be 200 (all checks pass) or 503 (db down in test env)
    expect([200, 503]).toContain(res.statusCode);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error handler coverage
// ══════════════════════════════════════════════════════════════════════════════
describe("Error handler", () => {
  it("returns proper error envelope with correlationId on 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: { ...authHeader(["super_admin"]), "x-correlation-id": "test-corr-123" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.correlationId).toBe("test-corr-123");
    expect(json.retryable).toBe(false);
    expect(json.fieldErrors).toBeDefined();
  });

  it("returns HttpError envelope on 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenants",
      headers: authHeader(["citizen"]),
      payload: { name: "Test", domain: "test.in", edition: "govt", region: "IN", residency: "IN" },
    });
    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.code).toBe("FORBIDDEN");
    expect(json.retryable).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validator edge cases
// ══════════════════════════════════════════════════════════════════════════════
describe("Validator edge cases", () => {
  it("createTenantBody accepts all valid editions", async () => {
    const editions = ["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"];
    for (const edition of editions) {
      const slug = edition.replace(/_/g, "-");
      const res = await app.inject({
        method: "POST", url: "/v1/tenants",
        headers: authHeader(["super_admin"]),
        payload: { name: "Test Org", domain: `${slug}.civitasone.in`, edition, region: "IN", residency: "IN" },
      });
      expect(res.statusCode).toBe(202);
    }
  });

  it("updateTenantBody with only settings", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}`,
      headers: authHeader(["super_admin"]),
      payload: { settings: { locale: "hi-IN", timezone: "Asia/Kolkata" } },
    });
    expect(res.statusCode).toBe(202);
  });

  it("setIsolationBody with kmsKeyRef for silo", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/tenants/${TENANT}/isolation`,
      headers: authHeader(["super_admin"]),
      payload: { tier: "silo", dbDsnRef: "arn:aws:sm:region:123:secret:db", kmsKeyRef: "arn:aws:kms:region:123:key/abc" },
    });
    expect(res.statusCode).toBe(202);
  });
});
