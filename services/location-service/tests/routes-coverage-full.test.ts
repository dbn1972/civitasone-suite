/**
 * Comprehensive route + domain coverage tests for location-service.
 * Uses buildApp + inject pattern with HS256 tokens for auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

// ── Test constants ──────────────────────────────────────────────────────────
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const LOCATION_UUID = "22222222-bbbb-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["location_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/locations — Create Location
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations", () => {
  it("→ 202 with minimal valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Head Office" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
  });

  it("→ 202 with full valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: {
        name: "District Branch",
        addressLine: "12 Main Road",
        city: "Bhubaneswar",
        postalCode: "751001",
        type: "branch",
        lgdCode: "123456",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 202 with super_admin role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(["super_admin"]),
      payload: { name: "Super Admin Office" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("→ 400 empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("→ 400 name too long (>200 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "A".repeat(201) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", type: "country" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid lgdCode (non-numeric)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", lgdCode: "AB12" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 invalid parentId (not uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", parentId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 parentId does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Child", parentId: "99999999-dead-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_PARENT");
  });

  it("→ 400 empty name string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 lgdCode too long (>32 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", lgdCode: "1".repeat(33) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 addressLine too long (>500 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", addressLine: "X".repeat(501) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 city too long (>120 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", city: "C".repeat(121) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 400 postalCode too long (>16 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Office", postalCode: "9".repeat(17) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(["citizen"]),
      payload: { name: "Office" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Office" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("→ 202 each valid type", async () => {
    const types = ["state", "district", "block", "ward", "office", "facility", "branch"] as const;
    for (const type of types) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/locations",
        headers: authHeader(),
        payload: { name: `${type} location`, type },
      });
      expect(res.statusCode).toBe(202);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/locations — List Locations
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/locations", () => {
  it("→ 200 default pagination", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.pagination).toBeDefined();
  });

  it("→ 200 with limit & offset", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations?limit=10&offset=0",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("→ 200 with location_user role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations",
      headers: authHeader(["location_user"]),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/locations/tree — Location Tree
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/locations/tree", () => {
  it("→ 200 returns tree structure", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/tree",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/tree",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/tree",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/locations/sample-data — Seed Samples
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/locations/sample-data", () => {
  it("→ 200 seeds sample data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/sample-data",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBeDefined();
  });

  it("→ 200 idempotent (second call returns 0 added)", async () => {
    // First seed
    await app.inject({
      method: "POST",
      url: "/v1/locations/sample-data",
      headers: authHeader(),
    });
    // Second seed should be idempotent
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/sample-data",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(0);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/sample-data",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations/sample-data",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/locations/sample-data — Clear Samples
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/locations/sample-data", () => {
  it("→ 200 clears sample data", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/locations/sample-data",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBeDefined();
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/locations/sample-data",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/locations/sample-data",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/locations/:id — Get Location by ID
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/locations/:id", () => {
  it("→ 404 non-existent location", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${LOCATION_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("→ 400 invalid uuid param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/locations/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("→ 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${LOCATION_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("→ 401 no token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${LOCATION_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("→ 200 returns location that was just created (cache hit)", async () => {
    // Create a location first (primes cache)
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "Cached Location", type: "office" },
    });
    const { id } = createRes.json();
    // Read it back (cache hit)
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Cached Location");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error handler coverage
// ══════════════════════════════════════════════════════════════════════════════
describe("Error handler", () => {
  it("returns correlationId from x-correlation-id header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: { ...authHeader(), "x-correlation-id": "test-corr-123" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().correlationId).toBe("test-corr-123");
  });

  it("ZodError returns fieldErrors array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: authHeader(),
      payload: { name: "", type: "invalid_type" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors).toBeDefined();
    expect(Array.isArray(body.fieldErrors)).toBe(true);
    expect(body.retryable).toBe(false);
  });

  it("HttpError returns correct structure", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${LOCATION_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.retryable).toBe(false);
    expect(body.correlationId).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Ops / health routes
// ══════════════════════════════════════════════════════════════════════════════
describe("Ops routes", () => {
  it("GET /health → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("location-service");
    expect(res.json().status).toBe("ok");
  });

  it("GET /ready → 200 or 503", async () => {
    const res = await app.inject({ method: "GET", url: "/ready", headers: authHeader() });
    // Readyz may be 503 if DB is not available in test env, both are valid
    expect([200, 503]).toContain(res.statusCode);
  });
});
