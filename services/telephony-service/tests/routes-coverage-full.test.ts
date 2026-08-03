/**
 * Comprehensive route + domain coverage tests for telephony-service.
 * Targets all routes, commands, queries, and shared modules to push
 * line coverage from ~67% to ≥80%.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const UUID1 = "11111111-1111-4000-8000-000000000001";
const UUID2 = "22222222-2222-4000-8000-000000000002";
const UUID3 = "33333333-3333-4000-8000-000000000003";

function token(roles: string[] = ["telephony_admin", "super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function userToken(roles: string[] = ["telephony_user"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function supervisorToken(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["telephony_supervisor"] }, SECRET, 3600);
}

function noRoleToken(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"] }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

function userAuthHeader() {
  return { authorization: `Bearer ${userToken()}` };
}

function supervisorAuthHeader() {
  return { authorization: `Bearer ${supervisorToken()}` };
}

function noRoleAuthHeader() {
  return { authorization: `Bearer ${noRoleToken()}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// AGENTS MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Agents routes", () => {
  describe("GET /v1/telephony/agents", () => {
    it("returns 200 with paginated shape", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents", headers: authHeader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(typeof body.pagination.hasMore).toBe("boolean");
    });

    it("returns 200 with custom limit/offset", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents?limit=5&offset=0", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents", headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents" });
      expect(res.statusCode).toBe(401);
    });

    it("telephony_user can list agents", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents", headers: userAuthHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("telephony_supervisor can list agents", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents", headers: supervisorAuthHeader() });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/telephony/agents/:id", () => {
    it("returns 404 for unknown agent", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/agents/${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid uuid", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/agents/not-a-uuid", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/agents/${UUID1}`, headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/agents/${UUID1}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/telephony/agents", () => {
    it("returns 202 with valid body (admin)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
        payload: { userId: UUID1, displayName: "Agent Test", status: "available", extension: "1001" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
    });

    it("returns 202 with minimal body (supervisor)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: supervisorAuthHeader(),
        payload: { userId: UUID2, displayName: "Agent Two" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with queueId", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
        payload: { userId: UUID3, displayName: "Agent Three", queueId: UUID2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with all statuses", async () => {
      for (const status of ["available", "busy", "wrap_up", "offline"]) {
        const res = await app.inject({
          method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
          payload: { userId: UUID1, displayName: "Agent", status },
        });
        expect(res.statusCode).toBe(202);
      }
    });

    it("returns 400 with empty body", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/telephony/agents", headers: authHeader(), payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid extension", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
        payload: { userId: UUID1, displayName: "Test", extension: "abc" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid status", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
        payload: { userId: UUID1, displayName: "Test", status: "nope" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid userId (not uuid)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: authHeader(),
        payload: { userId: "not-uuid", displayName: "Test" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for telephony_user", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: userAuthHeader(),
        payload: { userId: UUID1, displayName: "Agent" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents", headers: noRoleAuthHeader(),
        payload: { userId: UUID1, displayName: "Agent" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/agents/:id/status", () => {
    it("returns 202 with valid status (admin)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: authHeader(),
        payload: { status: "available" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with expectedVersion (user)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: userAuthHeader(),
        payload: { status: "busy", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 for all valid statuses", async () => {
      for (const status of ["available", "busy", "wrap_up", "offline"]) {
        const res = await app.inject({
          method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: authHeader(),
          payload: { status },
        });
        expect(res.statusCode).toBe(202);
      }
    });

    it("returns 400 with invalid status", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: authHeader(),
        payload: { status: "invalid_status" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with empty body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid id", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/agents/bad-id/status", headers: authHeader(),
        payload: { status: "offline" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/agents/${UUID1}/status`, headers: noRoleAuthHeader(),
        payload: { status: "offline" },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// QUEUES MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Queues routes", () => {
  describe("GET /v1/telephony/queues", () => {
    it("returns 200 with paginated shape", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues", headers: authHeader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it("returns 200 with limit/offset", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues?limit=10&offset=0", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues", headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues" });
      expect(res.statusCode).toBe(401);
    });

    it("telephony_user can list queues", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues", headers: userAuthHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("supervisor can list queues", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues", headers: supervisorAuthHeader() });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/telephony/queues/:id", () => {
    it("returns 404 for unknown queue", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/queues/${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid uuid", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/queues/bad-uuid", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/queues/${UUID1}`, headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/queues/${UUID1}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/telephony/queues", () => {
    it("returns 202 with valid body (admin only)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "Support Queue", description: "Main support line", slaAnswerSeconds: 30 },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
      expect(body.correlationId).toBeDefined();
    });

    it("returns 202 with minimal body (default slaAnswerSeconds)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "Emergency Queue" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with description", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "Billing", description: "Billing queue for finance questions" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with empty body", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/telephony/queues", headers: authHeader(), payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with name too long", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "x".repeat(121) },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with slaAnswerSeconds out of range", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "Q", slaAnswerSeconds: 99999 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with slaAnswerSeconds zero", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: authHeader(),
        payload: { name: "Q", slaAnswerSeconds: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for telephony_user", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: userAuthHeader(),
        payload: { name: "Test Queue" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for telephony_supervisor", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/queues", headers: supervisorAuthHeader(),
        payload: { name: "Test Queue" },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CALLS MODULE — CREATE
// ══════════════════════════════════════════════════════════════════════════════
describe("Calls routes — create", () => {
  describe("POST /v1/telephony/calls", () => {
    it("returns 202 for inbound call with full body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: {
          direction: "inbound",
          callerNumber: "+919876543210",
          calleeNumber: "+911234567890",
          queueId: UUID1,
          agentId: UUID2,
          linkedRefType: "grievance",
          linkedRefId: UUID3,
        },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
      expect(body.correlationId).toBeDefined();
    });

    it("returns 202 for outbound call", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { direction: "outbound", calleeNumber: "+919000000001" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with minimal body (defaults to inbound)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: userAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with helpdesk_ticket link", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { linkedRefType: "helpdesk_ticket", linkedRefId: UUID1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with citizen_request link", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { linkedRefType: "citizen_request", linkedRefId: UUID2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with callerNumber only", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { callerNumber: "+91 98765 43210" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for invalid direction", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { direction: "lateral" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid linkedRefType", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { linkedRefType: "invalid_type", linkedRefId: UUID1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid queueId (not uuid)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { queueId: "not-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid callerNumber", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { callerNumber: "ab" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid agentId (not uuid)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: authHeader(),
        payload: { agentId: "bad" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls", headers: noRoleAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/telephony/calls", payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CALLS MODULE — LIST + DETAIL + METRICS
// ══════════════════════════════════════════════════════════════════════════════
describe("Calls routes — list, detail, metrics", () => {
  describe("GET /v1/telephony/calls", () => {
    it("returns 200 with paginated shape", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls", headers: authHeader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(typeof body.pagination.hasMore).toBe("boolean");
      expect(typeof body.pagination.pageSize).toBe("number");
    });

    it("returns 200 with limit/offset", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?limit=10&offset=0", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 200 with status filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?status=queued", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 200 with direction filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?direction=inbound", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 200 with queueId filter", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls?queueId=${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 200 with agentId filter", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls?agentId=${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 200 with callerNumber filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?callerNumber=9876543210", headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 400 for invalid status filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?status=banana", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid direction filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?direction=diagonal", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for limit out of range", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls?limit=9999", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls", headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/telephony/calls/metrics", () => {
    it("returns metrics shape", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics", headers: authHeader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.total).toBe("number");
      expect(typeof body.abandonmentRatePct).toBe("number");
      expect(typeof body.slaAnsweredPct).toBe("number");
      expect(body.byStatus).toBeDefined();
    });

    it("returns metrics with queueId filter", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls/metrics?queueId=${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics", headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/metrics" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/telephony/calls/:id", () => {
    it("returns 404 for unknown call", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls/${UUID1}`, headers: authHeader() });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid uuid", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/telephony/calls/not-a-uuid", headers: authHeader() });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls/${UUID1}`, headers: noRoleAuthHeader() });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls/${UUID1}` });
      expect(res.statusCode).toBe(401);
    });

    it("non-admin user sees call detail (if exists) with masking", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/telephony/calls/${UUID1}`, headers: userAuthHeader() });
      // 404 expected because UUID1 doesn't exist, but it exercises the non-admin path
      expect(res.statusCode).toBe(404);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CALLS MODULE — LIFECYCLE TRANSITIONS
// ══════════════════════════════════════════════════════════════════════════════
describe("Calls routes — lifecycle transitions", () => {
  describe("POST /v1/telephony/calls/:id/ring", () => {
    it("returns 202 with valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ring`, headers: authHeader(),
        payload: { agentId: UUID2, queueId: UUID3 },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
    });

    it("returns 202 with empty body (optional fields)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ring`, headers: userAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with expectedVersion", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ring`, headers: authHeader(),
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with invalid id", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls/bad-uuid/ring", headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ring`, headers: noRoleAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/answer", () => {
    it("returns 202 with valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/answer`, headers: authHeader(),
        payload: { agentId: UUID2 },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
    });

    it("returns 202 with expectedVersion", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/answer`, headers: authHeader(),
        payload: { agentId: UUID2, expectedVersion: 2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 without agentId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/answer`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid agentId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/answer`, headers: authHeader(),
        payload: { agentId: "not-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid id", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls/bad/answer", headers: authHeader(),
        payload: { agentId: UUID2 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/answer`, headers: noRoleAuthHeader(),
        payload: { agentId: UUID2 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/complete", () => {
    it("returns 202 with valid disposition", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
        payload: { disposition: "resolved", talkSeconds: 120 },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
    });

    it("returns 202 with all dispositions", async () => {
      const dispositions = ["resolved", "callback_scheduled", "escalated", "transferred", "information_provided", "wrong_number", "voicemail", "no_resolution"];
      for (const disposition of dispositions) {
        const res = await app.inject({
          method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
          payload: { disposition },
        });
        expect(res.statusCode).toBe(202);
      }
    });

    it("returns 202 with expectedVersion", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
        payload: { disposition: "escalated", expectedVersion: 3 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 without disposition", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid disposition", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
        payload: { disposition: "banana" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with talkSeconds out of range", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: authHeader(),
        payload: { disposition: "resolved", talkSeconds: 999999 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/complete`, headers: noRoleAuthHeader(),
        payload: { disposition: "resolved" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/miss", () => {
    it("returns 202 with empty body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/miss`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with null body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/miss`, headers: authHeader(),
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with expectedVersion", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/miss`, headers: authHeader(),
        payload: { expectedVersion: 2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with invalid id", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/telephony/calls/bad/miss", headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/miss`, headers: noRoleAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/abandon", () => {
    it("returns 202 with empty body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/abandon`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with null body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/abandon`, headers: authHeader(),
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with expectedVersion", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/abandon`, headers: authHeader(),
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/abandon`, headers: noRoleAuthHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/assign", () => {
    it("returns 202 with queueId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: supervisorAuthHeader(),
        payload: { queueId: UUID2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with agentId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: authHeader(),
        payload: { agentId: UUID3 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with both queueId and agentId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: authHeader(),
        payload: { queueId: UUID2, agentId: UUID3, expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 without queueId or agentId (refine)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid queueId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: authHeader(),
        payload: { queueId: "bad" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for telephony_user (supervisor+ required)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: userAuthHeader(),
        payload: { queueId: UUID2 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/assign`, headers: noRoleAuthHeader(),
        payload: { queueId: UUID2 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/ivr-hits", () => {
    it("returns 202 with valid batch body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: authHeader(),
        payload: { hits: [{ menuKey: "main_menu", digit: "1", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with DTMF special chars", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: authHeader(),
        payload: { hits: [{ menuKey: "support", digit: "*#", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 without menuKey", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: authHeader(),
        payload: { hits: [{ digit: "1", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 without digit", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: authHeader(),
        payload: { hits: [{ menuKey: "main", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with non-DTMF digit", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: authHeader(),
        payload: { hits: [{ menuKey: "main", digit: "abc", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/ivr-hits`, headers: noRoleAuthHeader(),
        payload: { hits: [{ menuKey: "main", digit: "1", timestamp: "2024-06-15T10:00:00Z" }] },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/link", () => {
    it("returns 202 with grievance link", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: { refType: "grievance", refId: UUID2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with helpdesk_ticket link", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: { refType: "helpdesk_ticket", refId: UUID3 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with citizen_request link", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: { refType: "citizen_request", refId: UUID1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with invalid refType", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: { refType: "invalid", refId: UUID2 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid refId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: { refType: "grievance", refId: "bad" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with empty body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/link`, headers: noRoleAuthHeader(),
        payload: { refType: "grievance", refId: UUID2 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/telephony/calls/:id/recording", () => {
    it("returns 202 with valid body (supervisor+)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: supervisorAuthHeader(),
        payload: { recordingId: "rec-001", recordingUrl: "https://s3.example.com/rec.mp3", durationSec: 300, format: "mp3" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with minimal body (admin)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
        payload: { recordingId: "rec-002" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with all formats", async () => {
      for (const format of ["mp3", "wav", "ogg", "opus"]) {
        const res = await app.inject({
          method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
          payload: { recordingId: `rec-${format}`, format },
        });
        expect(res.statusCode).toBe(202);
      }
    });

    it("returns 400 without recordingId", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid format", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
        payload: { recordingId: "rec-x", format: "flac" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid recordingUrl", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
        payload: { recordingId: "rec-x", recordingUrl: "not-a-url" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with durationSec out of range", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: authHeader(),
        payload: { recordingId: "rec-x", durationSec: 999999 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for telephony_user (supervisor+ required)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: userAuthHeader(),
        payload: { recordingId: "rec-001" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for wrong role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/telephony/calls/${UUID1}/recording`, headers: noRoleAuthHeader(),
        payload: { recordingId: "rec-001" },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
