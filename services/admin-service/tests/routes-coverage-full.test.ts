/**
 * admin-service — comprehensive route coverage tests.
 *
 * Covers ALL routes across all modules, auth 403, validation 400, domain logic,
 * and happy-path assertions. Uses buildApp + inject.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
const VALID_UUID = "11111111-cccc-4000-8000-333333333333";

function token(roles: string[] = ["super_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-cov" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/health", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/admin/health/readiness", () => {
  it("returns 200 for super_admin with readiness data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/readiness", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overall).toBe(100);
    expect(body.productionReady).toBe(true);
    expect(body.gates).toBeDefined();
    expect(body.scores).toBeDefined();
    expect(body.checkedAt).toBeDefined();
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/readiness", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/operations", () => {
  it("returns 200 for super_admin with operations snapshot", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checkedAt).toBeDefined();
    expect(body.summary).toBeDefined();
    expect(body.processes).toBeDefined();
    expect(body.queue).toBeDefined();
    expect(body.schedulers).toBeDefined();
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/health/:service", () => {
  it("returns health for a known service", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/identity-service", headers: authHeader(["super_admin"]) });
    // May return 200 (probed) -- service down is still 200 with status: "down"
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("identity-service");
  });

  it("returns 404 for unknown service", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/nonexistent-service", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/identity-service", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/queue-metrics", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/queue-metrics", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.driver).toBeDefined();
    expect(body.metrics).toBeDefined();
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/queue-metrics", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLATFORM CONFIG ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/platform-config", () => {
  it("returns 200 for platform_admin with controllable + infrastructure", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/platform-config", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.controllable).toBeDefined();
    expect(body.controllable.cacheTtl).toBeDefined();
    expect(body.controllable.rateLimits).toBeDefined();
    expect(body.controllable.notifications).toBeDefined();
    expect(body.infrastructure).toBeDefined();
    expect(body.infrastructure.database).toBeDefined();
    expect(body.infrastructure.redis).toBeDefined();
    expect(body.infrastructure.queue).toBeDefined();
    expect(body.infrastructure.auth).toBeDefined();
  });

  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/platform-config", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/platform-config", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/platform-config", () => {
  it("returns 200 and updates cacheTtl", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { cacheTtl: { finance: 120 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("updated");
    expect(body.controllable.cacheTtl.finance).toBe(120);
  });

  it("updates rateLimits", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["super_admin"]),
      payload: { rateLimits: { perMinute: 200, burstMax: 50 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controllable.rateLimits.perMinute).toBe(200);
  });

  it("updates logLevel", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { logLevel: "warn" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controllable.logLevel).toBe("warn");
  });

  it("ignores invalid logLevel", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { logLevel: "invalid_level" },
    });
    expect(res.statusCode).toBe(200);
    // logLevel should remain at previous value (warn from test above)
    expect(["debug", "info", "warn", "error"]).toContain(res.json().controllable.logLevel);
  });

  it("sets debugModeUntil and enables debug", async () => {
    const future = new Date(Date.now() + 600000).toISOString();
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { debugModeUntil: future },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controllable.debugModeUntil).toBe(future);
    expect(res.json().controllable.logLevel).toBe("debug");
  });

  it("clears debugModeUntil with null", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { debugModeUntil: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controllable.debugModeUntil).toBeNull();
  });

  it("updates notifications", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["platform_admin"]),
      payload: { notifications: { emailProvider: "ses" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controllable.notifications.emailProvider).toBe("ses");
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: authHeader(["tenant_admin"]),
      payload: { logLevel: "debug" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/admin/platform-config/debug-mode", () => {
  it("enables debug mode for given duration", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: authHeader(["platform_admin"]),
      payload: { durationMinutes: 30 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("debug_enabled");
    expect(body.durationMinutes).toBe(30);
    expect(body.until).toBeDefined();
  });

  it("clamps duration to min 5 minutes", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: authHeader(["platform_admin"]),
      payload: { durationMinutes: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().durationMinutes).toBe(5);
  });

  it("clamps duration to max 60 minutes", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: authHeader(["platform_admin"]),
      payload: { durationMinutes: 120 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().durationMinutes).toBe(60);
  });

  it("defaults to 15 minutes when no duration given", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: authHeader(["platform_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().durationMinutes).toBe(15);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/tenant/modules", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenant/modules", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenant/modules", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/admin/tenant/modules/:key/toggle", () => {
  it("returns 202 with valid body for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenant/modules/hrms/toggle",
      headers: authHeader(["tenant_admin"]),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing enabled field", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenant/modules/hrms/toggle",
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenant/modules/hrms/toggle",
      headers: authHeader(["employee"]),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/config", () => {
  it("returns result for tenant_admin (may be 200 or 404)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config", headers: authHeader(["tenant_admin"]) });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/tenants/:id/config", () => {
  it("returns result for super_admin (may be 200 or 404)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/config`, headers: authHeader(["super_admin"]) });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants/not-a-uuid/config", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/config`, headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/tenants/:id/modules/:module/toggle", () => {
  it("returns 202 for super_admin with valid body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/modules/finance/toggle`,
      headers: authHeader(["super_admin"]),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/modules/finance/toggle`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/modules/finance/toggle`,
      headers: authHeader(["tenant_admin"]),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/admin/feature-flags", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags",
      headers: authHeader(["super_admin"]),
      payload: { flagKey: "test_cov_flag", enabled: true },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing flagKey", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags",
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags",
      headers: authHeader(["tenant_admin"]),
      payload: { flagKey: "test_flag", enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/feature-flags/:key/override", () => {
  it("returns 202 for super_admin with valid body", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/feature-flags/test_cov_flag/override",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: VALID_UUID, enabled: true },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid tenantId", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/feature-flags/test_cov_flag/override",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: "not-uuid", enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing enabled", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/feature-flags/test_flag/override",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: VALID_UUID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/feature-flags/test_flag/override",
      headers: authHeader(["tenant_admin"]),
      payload: { tenantId: VALID_UUID, enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/feature-flags", () => {
  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/tenants/:id/modules-list", () => {
  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/modules-list`, headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 200 for tenant_admin (internal secret env not set = internal auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/modules-list`, headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants/bad/modules-list", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TENANT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/tenants", () => {
  it("returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test Gov", domain: "testgov.example", edition: "govt_dept", region: "ap-south-1", residency: "IN" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 with missing name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { domain: "x.example", edition: "psu", region: "r", residency: "IN" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid edition", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "T", domain: "x.example", edition: "enterprise", region: "r1", residency: "IN" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid domain format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test", domain: "a", edition: "psu", region: "r1", residency: "IN" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Test", domain: "test.example", edition: "psu", region: "r1", residency: "IN" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/tenants", () => {
  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("supports pagination params", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants?page=1&limit=5", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/tenants/:id", () => {
  it("returns result for super_admin (200 or 404)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}`, headers: authHeader(["super_admin"]) });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants/bad-id", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${VALID_UUID}`, headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/tenants/:id/edition", () => {
  it("returns 202 for super_admin with valid edition", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/edition`,
      headers: authHeader(["super_admin"]),
      payload: { edition: "small_office" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid edition value", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/edition`,
      headers: authHeader(["super_admin"]),
      payload: { edition: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid uuid param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/tenants/bad/edition",
      headers: authHeader(["super_admin"]),
      payload: { edition: "psu" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/edition`,
      headers: authHeader(["tenant_admin"]),
      payload: { edition: "psu" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/tenants/:id/suspend", () => {
  it("returns 202 for super_admin with valid reason", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: { reason: "Policy violation detected" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with short reason", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/suspend`,
      headers: authHeader(["tenant_admin"]),
      payload: { reason: "Should not work" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/tenants/:id/reactivate", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/reactivate`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/tenants/bad/reactivate",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${VALID_UUID}/reactivate`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BACKUP ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/tenants/:id/backup/schedule", () => {
  it("returns 202 for super_admin with valid cron", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/schedule`,
      headers: authHeader(["super_admin"]),
      payload: { cronExpr: "30 2 * * *" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid cron (sub-hourly)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/schedule`,
      headers: authHeader(["super_admin"]),
      payload: { cronExpr: "*/5 * * * *" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid cron (bad syntax)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/schedule`,
      headers: authHeader(["super_admin"]),
      payload: { cronExpr: "bad cron" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid cron (6 fields)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/schedule`,
      headers: authHeader(["super_admin"]),
      payload: { cronExpr: "0 0 1 1 * 2024" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid uuid param", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants/not-uuid/backup/schedule",
      headers: authHeader(["super_admin"]),
      payload: { cronExpr: "0 3 * * *" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/schedule`,
      headers: authHeader(["tenant_admin"]),
      payload: { cronExpr: "0 4 * * *" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/admin/tenants/:id/backup/run", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/run`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants/bad/backup/run",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/tenants/${VALID_UUID}/backup/run`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/tenants/:id/backup/runs", () => {
  it("returns 200 for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/backup/runs`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/tenants/invalid/backup/runs",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/tenants/${VALID_UUID}/backup/runs`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUPPORT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/breakglass", () => {
  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("supports tenantId query param", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/breakglass?tenantId=${VALID_UUID}`, headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("supports limit query param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass?limit=10", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with invalid tenantId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass?tenantId=bad", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/admin/support/break-glass", () => {
  it("returns 202 for super_admin with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/break-glass",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: VALID_UUID, ticketId: VALID_UUID, reason: "Emergency investigation required" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing tenantId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/break-glass",
      headers: authHeader(["super_admin"]),
      payload: { ticketId: VALID_UUID, reason: "Test reason long enough" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with short reason", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/break-glass",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: VALID_UUID, ticketId: VALID_UUID, reason: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid ticketId format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/break-glass",
      headers: authHeader(["super_admin"]),
      payload: { tenantId: VALID_UUID, ticketId: "not-uuid", reason: "Reason is long enough now" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/break-glass",
      headers: authHeader(["tenant_admin"]),
      payload: { tenantId: VALID_UUID, ticketId: VALID_UUID, reason: "Needs investigation now" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/support/break-glass/:id/close", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/support/break-glass/${VALID_UUID}/close`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/support/break-glass/bad-id/close",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/support/break-glass/${VALID_UUID}/close`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// API-KEY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/api-keys", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=1", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("supports limit param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=5", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/admin/api-keys", () => {
  it("returns 201 for super_admin with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["super_admin"]),
      payload: { keyName: "coverage-test-key", scopes: ["config:read"] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.key).toMatch(/^civ_/);
    expect(body.keyPrefix).toBeDefined();
    expect(body.status).toBe("active");
  });

  it("returns 201 with no scopes (empty array)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["super_admin"]),
      payload: { keyName: "no-scopes-key" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 201 with expiresAt", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["super_admin"]),
      payload: { keyName: "expiring-key", scopes: [], expiresAt: future },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 400 with missing keyName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty keyName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["super_admin"]),
      payload: { keyName: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin with platform scope", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["tenant_admin"]),
      payload: { keyName: "escalate", scopes: ["platform:admin"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 201 for tenant_admin with allowed scope", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["tenant_admin"]),
      payload: { keyName: "allowed-scope-key", scopes: ["config:read"] },
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: authHeader(["employee"]),
      payload: { keyName: "nope", scopes: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/api-keys/:id/rotate", () => {
  it("returns 404 for non-existent key", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/api-keys/${VALID_UUID}/rotate`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/api-keys/bad-id/rotate",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/api-keys/${VALID_UUID}/rotate`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/admin/api-keys/:id/revoke", () => {
  it("returns 404 for non-existent key", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/api-keys/${VALID_UUID}/revoke`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/api-keys/bad-id/revoke",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/api-keys/${VALID_UUID}/revoke`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/uploads/presign", () => {
  it("returns 200 with valid resume upload", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["admin"]),
      payload: { category: "resume", filename: "resume.pdf", contentType: "application/pdf" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toBeDefined();
    expect(body.method).toBe("PUT");
    expect(body.key).toContain("uploads/");
    expect(body.key).toContain("/resume/");
    expect(body.maxSizeMb).toBe(5);
  });

  it("returns 200 with attachment upload", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["hr_admin"]),
      payload: { category: "attachment", filename: "file.xlsx", contentType: "application/vnd.ms-excel" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxSizeMb).toBe(10);
  });

  it("returns 200 with document upload", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["officer"]),
      payload: { category: "document", filename: "report.docx", contentType: "application/msword" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxSizeMb).toBe(20);
  });

  it("returns 200 with photo upload", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["manager"]),
      payload: { category: "photo", filename: "avatar.png", contentType: "image/png" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxSizeMb).toBe(2);
  });

  it("returns 400 with disallowed file extension", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["admin"]),
      payload: { category: "resume", filename: "file.exe", contentType: "application/x-executable" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_FILE_TYPE");
  });

  it("returns error with invalid category (zod rejects at parse)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["admin"]),
      payload: { category: "malware", filename: "file.pdf", contentType: "application/pdf" },
    });
    // Zod enum validation rejects before reaching route logic
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns error with missing filename (zod rejects at parse)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["admin"]),
      payload: { category: "resume", contentType: "application/pdf" },
    });
    // Zod validation rejects before reaching route logic
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for employee role (not in allowed list)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/uploads/presign",
      headers: authHeader(["employee"]),
      payload: { category: "resume", filename: "cv.pdf", contentType: "application/pdf" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/uploads/:key", () => {
  it("returns 200 when key belongs to tenant", async () => {
    const key = `uploads/${TENANT}/resume/test-file.pdf`;
    const res = await app.inject({
      method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(key)}`,
      headers: authHeader(["admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.downloadUrl).toBeDefined();
    expect(body.key).toBe(key);
  });

  it("returns 403 when key does not belong to tenant", async () => {
    const otherTenant = "99999999-9999-4000-8000-999999999999";
    const key = `uploads/${otherTenant}/resume/file.pdf`;
    const res = await app.inject({
      method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(key)}`,
      headers: authHeader(["admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const key = `uploads/${TENANT}/resume/file.pdf`;
    const res = await app.inject({
      method: "GET", url: `/v1/admin/uploads/${encodeURIComponent(key)}`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC TESTS
// ══════════════════════════════════════════════════════════════════════════════
import { canTransition, assertTransition, DomainError as TenantDomainError } from "../src/modules/tenants/domain.js";
import { resolveFeatureFlag, assertModuleEnabled, DomainError as ConfigDomainError } from "../src/modules/config/domain.js";
import { aggregateHealth } from "../src/modules/health/domain.js";
import { breakGlassExpiresAt, isBreakGlassExpired, BREAK_GLASS_TTL_MS } from "../src/modules/support/domain.js";
import { disallowedScopes, allowsAllScopes } from "../src/modules/api-keys/scopes.js";
import { computeProductionReadiness } from "../src/modules/health/readiness.js";
import { isValidCron, meetsMinimumInterval } from "../src/modules/backup/validators.js";
import { redactLogLine } from "../src/modules/health/operations.js";
import { commandMessageId } from "../src/shared/idempotency.js";

describe("tenants/domain — canTransition", () => {
  it("active → suspended is allowed", () => {
    expect(canTransition("active", "suspended")).toBe(true);
  });

  it("active → archived is allowed", () => {
    expect(canTransition("active", "archived")).toBe(true);
  });

  it("suspended → active is allowed", () => {
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("archived → active is not allowed", () => {
    expect(canTransition("archived", "active")).toBe(false);
  });

  it("draft → active is allowed", () => {
    expect(canTransition("draft", "active")).toBe(true);
  });

  it("draft → suspended is not allowed", () => {
    expect(canTransition("draft", "suspended")).toBe(false);
  });

  it("assertTransition throws DomainError on invalid transition", () => {
    expect(() => assertTransition("archived", "active")).toThrow(TenantDomainError);
  });

  it("assertTransition does not throw on valid transition", () => {
    expect(() => assertTransition("active", "suspended")).not.toThrow();
  });
});

describe("config/domain — resolveFeatureFlag", () => {
  it("tenant override true wins over global false", () => {
    expect(resolveFeatureFlag({ globalEnabled: false, tenantOverride: true })).toBe(true);
  });

  it("tenant override false wins over global true", () => {
    expect(resolveFeatureFlag({ globalEnabled: true, tenantOverride: false })).toBe(false);
  });

  it("edition overrides global when no tenant override", () => {
    expect(resolveFeatureFlag({ globalEnabled: false, editionEnabled: true })).toBe(true);
  });

  it("falls back to global when no overrides", () => {
    expect(resolveFeatureFlag({ globalEnabled: true })).toBe(true);
    expect(resolveFeatureFlag({ globalEnabled: false })).toBe(false);
  });

  it("tenant override beats edition", () => {
    expect(resolveFeatureFlag({ globalEnabled: false, editionEnabled: true, tenantOverride: false })).toBe(false);
  });

  it("assertModuleEnabled throws when disabled", () => {
    expect(() => assertModuleEnabled(false, "hrms")).toThrow(ConfigDomainError);
  });

  it("assertModuleEnabled does not throw when enabled", () => {
    expect(() => assertModuleEnabled(true, "hrms")).not.toThrow();
  });
});

describe("health/domain — aggregateHealth", () => {
  it("all ok → ok", () => {
    const r = aggregateHealth([{ service: "a", status: "ok" }, { service: "b", status: "ok" }]);
    expect(r.status).toBe("ok");
  });

  it("all down → down", () => {
    const r = aggregateHealth([{ service: "a", status: "down" }, { service: "b", status: "down" }]);
    expect(r.status).toBe("down");
  });

  it("mixed → degraded", () => {
    const r = aggregateHealth([{ service: "a", status: "ok" }, { service: "b", status: "down" }]);
    expect(r.status).toBe("degraded");
  });

  it("empty array → ok", () => {
    const r = aggregateHealth([]);
    expect(r.status).toBe("ok");
  });
});

describe("support/domain — break-glass TTL", () => {
  it("expires exactly 2h after opened", () => {
    const opened = new Date("2025-01-01T10:00:00Z");
    const expires = breakGlassExpiresAt(opened);
    expect(expires.getTime() - opened.getTime()).toBe(BREAK_GLASS_TTL_MS);
  });

  it("isBreakGlassExpired returns true when now >= expiresAt", () => {
    const expires = new Date("2025-01-01T12:00:00Z");
    expect(isBreakGlassExpired(expires, new Date("2025-01-01T12:00:01Z"))).toBe(true);
    expect(isBreakGlassExpired(expires, new Date("2025-01-01T12:00:00Z"))).toBe(true);
  });

  it("isBreakGlassExpired returns false when now < expiresAt", () => {
    const expires = new Date("2025-01-01T12:00:00Z");
    expect(isBreakGlassExpired(expires, new Date("2025-01-01T11:59:59Z"))).toBe(false);
  });
});

describe("api-keys/scopes — disallowedScopes", () => {
  it("super_admin allows all scopes", () => {
    const ctx = { roles: ["super_admin"], actorId: ACTOR, tenantId: TENANT, correlationId: "c1" } as any;
    expect(allowsAllScopes(ctx)).toBe(true);
    expect(disallowedScopes(ctx, ["platform:admin", "anything"])).toEqual([]);
  });

  it("platform_admin allows all scopes", () => {
    const ctx = { roles: ["platform_admin"], actorId: ACTOR, tenantId: TENANT, correlationId: "c1" } as any;
    expect(allowsAllScopes(ctx)).toBe(true);
  });

  it("tenant_admin is denied platform scopes", () => {
    const ctx = { roles: ["tenant_admin"], actorId: ACTOR, tenantId: TENANT, correlationId: "c1" } as any;
    expect(allowsAllScopes(ctx)).toBe(false);
    const denied = disallowedScopes(ctx, ["platform:admin", "config:read"]);
    expect(denied).toEqual(["platform:admin"]);
  });

  it("tenant_admin can grant allowed scopes", () => {
    const ctx = { roles: ["tenant_admin"], actorId: ACTOR, tenantId: TENANT, correlationId: "c1" } as any;
    expect(disallowedScopes(ctx, ["config:read", "tenant:read"])).toEqual([]);
  });
});

describe("health/readiness — computeProductionReadiness", () => {
  it("returns overall 100 and productionReady true", () => {
    const result = computeProductionReadiness();
    expect(result.overall).toBe(100);
    expect(result.productionReady).toBe(true);
    expect(result.allGreen).toBe(true);
    expect(result.checkedAt).toBeDefined();
  });

  it("has all expected gates", () => {
    const result = computeProductionReadiness();
    expect(result.gates.queueFirstWrites).toBe(true);
    expect(result.gates.responseValidation).toBe(true);
    expect(result.gates.workersRunning).toBe(true);
  });
});

describe("backup/validators — cron validation", () => {
  it("valid 5-field cron", () => {
    expect(isValidCron("0 2 * * *")).toBe(true);
    expect(isValidCron("30 4 1 * *")).toBe(true);
    expect(isValidCron("0 0 * * 0")).toBe(true);
    expect(isValidCron("15 */6 * * *")).toBe(true);
  });

  it("invalid cron expressions", () => {
    expect(isValidCron("bad")).toBe(false);
    expect(isValidCron("0 2 * *")).toBe(false);
    expect(isValidCron("60 2 * * *")).toBe(false);
    expect(isValidCron("0 25 * * *")).toBe(false);
    expect(isValidCron("0 2 32 * *")).toBe(false);
    expect(isValidCron("0 2 * 13 *")).toBe(false);
  });

  it("meetsMinimumInterval rejects wildcard minute", () => {
    expect(meetsMinimumInterval("* 2 * * *")).toBe(false);
    expect(meetsMinimumInterval("*/5 * * * *")).toBe(false);
    expect(meetsMinimumInterval("1-5 * * * *")).toBe(false);
  });

  it("meetsMinimumInterval accepts fixed minute", () => {
    expect(meetsMinimumInterval("0 2 * * *")).toBe(true);
    expect(meetsMinimumInterval("30 4 * * *")).toBe(true);
    expect(meetsMinimumInterval("59 * * * *")).toBe(true);
  });
});

describe("health/operations — redactLogLine", () => {
  it("redacts email addresses", () => {
    expect(redactLogLine("user admin@gov.in logged in")).toContain("<email>");
    expect(redactLogLine("user admin@gov.in logged in")).not.toContain("admin@gov.in");
  });

  it("redacts Bearer tokens", () => {
    const line = "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.test";
    const redacted = redactLogLine(line);
    expect(redacted).toContain("<redacted>");
    expect(redacted).not.toContain("eyJhbGciOi");
  });

  it("redacts password= values", () => {
    const line = "password=supersecret";
    expect(redactLogLine(line)).toContain("<redacted>");
    expect(redactLogLine(line)).not.toContain("supersecret");
  });

  it("redacts postgres URLs", () => {
    const line = "connecting to postgres://user:pass@db:5432/mydb";
    expect(redactLogLine(line)).toContain("<redacted>");
    expect(redactLogLine(line)).not.toContain("user:pass@db");
  });

  it("redacts token= values", () => {
    expect(redactLogLine("token=abc123xyz")).toContain("<redacted>");
  });

  it("redacts api_key= values", () => {
    expect(redactLogLine("api_key=sk_live_123")).toContain("<redacted>");
  });
});

describe("shared/idempotency — commandMessageId", () => {
  it("returns deterministic id from entity+action+correlationId", () => {
    const ctx = { actorId: ACTOR, tenantId: TENANT, correlationId: "corr-1", roles: [] } as any;
    const id1 = commandMessageId(ctx, "tenant:123", "suspend");
    const id2 = commandMessageId(ctx, "tenant:123", "suspend");
    expect(id1).toBe(id2);
  });

  it("different entity produces different id", () => {
    const ctx = { actorId: ACTOR, tenantId: TENANT, correlationId: "corr-1", roles: [] } as any;
    const id1 = commandMessageId(ctx, "tenant:123", "suspend");
    const id2 = commandMessageId(ctx, "tenant:456", "suspend");
    expect(id1).not.toBe(id2);
  });

  it("different action produces different id", () => {
    const ctx = { actorId: ACTOR, tenantId: TENANT, correlationId: "corr-1", roles: [] } as any;
    const id1 = commandMessageId(ctx, "tenant:123", "suspend");
    const id2 = commandMessageId(ctx, "tenant:123", "reactivate");
    expect(id1).not.toBe(id2);
  });

  it("uses idempotentId when idempotencyKey is present", () => {
    const ctx = { actorId: ACTOR, tenantId: TENANT, correlationId: "corr-1", roles: [], idempotencyKey: "idem-key-1" } as any;
    const id = commandMessageId(ctx, "tenant:123", "suspend");
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  it("produces UUID-like format", () => {
    const ctx = { actorId: ACTOR, tenantId: TENANT, correlationId: "corr-1", roles: [] } as any;
    const id = commandMessageId(ctx, "entity:1", "action");
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  });
});
