import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const STAGE_UUID = "22222222-bbbb-4000-8000-000000000099";
const PROVISION_UUID = "33333333-cccc-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["install_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// STAGES — POST /v1/install/stages
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/install/stages", () => {
  it("202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "deployment-mode", stepNumber: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("202 with optional description", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "configure-db", stepNumber: 2, description: "Set up database connection" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("400 missing name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { stepNumber: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 missing stepNumber", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 stepNumber too low", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "test", stepNumber: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 stepNumber too high", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "test", stepNumber: 200 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 name too long", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "x".repeat(200), stepNumber: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 description too long", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "test", stepNumber: 1, description: "x".repeat(600) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(["citizen"]),
      payload: { name: "test", stepNumber: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      payload: { name: "test", stepNumber: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("202 with super_admin role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(["super_admin"]),
      payload: { name: "super-step", stepNumber: 3 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("202 with install_user role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(["install_user"]),
      payload: { name: "user-step", stepNumber: 4 },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGES — GET /v1/install/stages
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/install/stages", () => {
  it("200 list stages", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("pagination");
  });

  it("200 with limit param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages?limit=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 with offset param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages?offset=10",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 with limit and offset", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages?limit=10&offset=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGES — GET /v1/install/steps
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/install/steps", () => {
  it("200 list steps", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/steps",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 with limit param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/steps?limit=10",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/steps",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/steps",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGES — GET /v1/install/stages/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/install/stages/:id", () => {
  it("404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/stages/${STAGE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/stages/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/stages/${STAGE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/stages/${STAGE_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns created stage from cache", async () => {
    // First create a stage
    const createRes = await app.inject({
      method: "POST", url: "/v1/install/stages",
      headers: authHeader(),
      payload: { name: "find-me", stepNumber: 5 },
    });
    const { id } = createRes.json();
    // Then fetch it - should be in cache
    const res = await app.inject({
      method: "GET", url: `/v1/install/stages/${id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("find-me");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROVISIONING — GET /v1/install/silo-provisions
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/install/silo-provisions", () => {
  it("200 list provisions", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("200 with status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions?status=requested",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 with limit param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions?limit=10",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("400 invalid status", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions?status=invalid_status",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 limit too high", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions?limit=999",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 with install_user role (reader)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions",
      headers: authHeader(["install_user"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("200 with platform_admin role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions",
      headers: authHeader(["platform_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROVISIONING — GET /v1/install/silo-provisions/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/install/silo-provisions/:id", () => {
  it("404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/install/silo-provisions/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROVISIONING — PATCH /v1/install/silo-provisions/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/install/silo-provisions/:id", () => {
  it("202 valid update", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("202 with error field", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: { tenantId: TENANT, status: "failed", error: "disk full" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("202 with steps", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: {
        tenantId: TENANT, status: "provisioning",
        steps: [{ step: "create_db", ok: true }, { step: "run_migrations", ok: false, detail: "timeout" }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("202 with super_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("202 with platform_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["platform_admin"]),
      payload: { tenantId: TENANT, status: "provisioning" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 invalid status value", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: { tenantId: TENANT, status: "unknown" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 invalid tenantId", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: { tenantId: "not-a-uuid", status: "ready" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 bad id param", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/install/silo-provisions/not-a-uuid",
      headers: authHeader(["install_admin"]),
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 error too long", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_admin"]),
      payload: { tenantId: TENANT, status: "failed", error: "x".repeat(3000) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 install_user cannot patch", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["install_user"]),
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      headers: authHeader(["citizen"]),
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 no token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/install/silo-provisions/${PROVISION_UUID}`,
      payload: { tenantId: TENANT, status: "ready" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// OPS — Health / Readiness
// ══════════════════════════════════════════════════════════════════════════════
describe("Ops routes", () => {
  it("GET /health → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("GET /ready → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/ready", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ready");
  });
});
