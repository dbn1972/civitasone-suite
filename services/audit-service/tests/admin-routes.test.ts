/**
 * Admin routes coverage — Audit Service
 *
 * Covers GET /v1/audit/risks, GET /v1/audit/breakglass, GET /v1/audit/exports:
 * - 401 when no bearer token is supplied
 * - 403 when caller's role is not in READER_ROLES
 * - 200 for each allowed reader role, asserting response shape matches the
 *   corresponding web schema (array, possibly empty)
 *
 * Uses a fresh random UUID tenant per suite run so RLS naturally scopes reads
 * to an empty result set without needing to seed any data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT_ID = randomUUID();
const ACTOR_ID = randomUUID();

const READER_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin", "finance_admin"];
const WRONG_ROLE = "employee";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Admin routes — GET /v1/audit/risks", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/risks" });
    expect(res.statusCode).toBe(401);
  });

  it("403 when caller's role is not permitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token([WRONG_ROLE], TENANT_ID, ACTOR_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  for (const role of READER_ROLES) {
    it(`200 for role ${role}, response shape matches RiskSummaryListSchema`, async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/audit/risks",
        headers: { authorization: `Bearer ${token([role], TENANT_ID, ACTOR_ID)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      // Fresh random tenant — expect no rows, but tolerate none-empty in case of shared fixtures.
      for (const item of body) {
        expect(typeof item.id).toBe("string");
        expect(typeof item.riskCode).toBe("string");
        expect(typeof item.title).toBe("string");
        expect(["financial", "operational", "compliance", "reputational", "strategic", "it"]).toContain(item.category);
        expect(["open", "mitigated", "closed", "escalated"]).toContain(item.status);
      }
    });
  }
});

describe("Admin routes — GET /v1/audit/breakglass", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/breakglass" });
    expect(res.statusCode).toBe(401);
  });

  it("403 when caller's role is not permitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/breakglass",
      headers: { authorization: `Bearer ${token([WRONG_ROLE], TENANT_ID, ACTOR_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  for (const role of READER_ROLES) {
    it(`200 for role ${role}, returns empty array by design`, async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/audit/breakglass",
        headers: { authorization: `Bearer ${token([role], TENANT_ID, ACTOR_ID)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual([]);
    });
  }
});

describe("Admin routes — GET /v1/audit/exports", () => {
  it("401 when no bearer token is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/exports" });
    expect(res.statusCode).toBe(401);
  });

  it("403 when caller's role is not permitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/exports",
      headers: { authorization: `Bearer ${token([WRONG_ROLE], TENANT_ID, ACTOR_ID)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  for (const role of READER_ROLES) {
    it(`200 for role ${role}, response shape matches AuditExportJobListSchema (empty for fresh tenant)`, async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/audit/exports",
        headers: { authorization: `Bearer ${token([role], TENANT_ID, ACTOR_ID)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual([]);
      for (const item of body) {
        expect(typeof item.id).toBe("string");
        expect(typeof item.jobType).toBe("string");
        expect(["pdf", "xlsx", "csv"]).toContain(item.format);
        expect(["queued", "processing", "completed", "failed"]).toContain(item.status);
      }
    });
  }

  it("400 on invalid limit query param (validation error)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/exports?limit=0",
      headers: { authorization: `Bearer ${token(["super_admin"], TENANT_ID, ACTOR_ID)}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("Admin routes — GET /v1/audit/risks validation", () => {
  it("400 on invalid limit query param (exceeds max)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit/risks?limit=99999",
      headers: { authorization: `Bearer ${token(["super_admin"], TENANT_ID, ACTOR_ID)}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});
