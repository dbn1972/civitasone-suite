import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  computeDeadline,
  scheduleNotifications,
  isExpired,
  LimitationDomainError,
} from "../src/modules/limitations/domain.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const MATTER_ID = "22222222-bbbb-4000-8000-000000000099";
const RULE_UUID = "33333333-cccc-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["legal_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — computeDeadline (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Limitation domain — computeDeadline", () => {
  it("adds period days to start date", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const deadline = computeDeadline(start, 90);
    expect(deadline.toISOString()).toBe("2024-03-31T00:00:00.000Z");
  });

  it("handles year boundary correctly", () => {
    const start = new Date("2024-12-01T00:00:00.000Z");
    const deadline = computeDeadline(start, 60);
    expect(deadline.toISOString()).toBe("2025-01-30T00:00:00.000Z");
  });

  it("handles single day period", () => {
    const start = new Date("2024-06-15T12:00:00.000Z");
    const deadline = computeDeadline(start, 1);
    expect(deadline.toISOString()).toBe("2024-06-16T12:00:00.000Z");
  });

  it("handles leap year", () => {
    const start = new Date("2024-02-28T00:00:00.000Z");
    const deadline = computeDeadline(start, 1);
    expect(deadline.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("handles large period (365 days)", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const deadline = computeDeadline(start, 365);
    expect(deadline.toISOString()).toBe("2024-12-31T00:00:00.000Z");
  });

  it("throws INVALID_PERIOD for zero days", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    expect(() => computeDeadline(start, 0)).toThrow(LimitationDomainError);
    try { computeDeadline(start, 0); } catch (e: any) { expect(e.code).toBe("INVALID_PERIOD"); }
  });

  it("throws INVALID_PERIOD for negative days", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    expect(() => computeDeadline(start, -10)).toThrow(LimitationDomainError);
  });

  it("does not mutate the input start date", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const original = start.toISOString();
    computeDeadline(start, 30);
    expect(start.toISOString()).toBe(original);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — scheduleNotifications (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Limitation domain — scheduleNotifications", () => {
  it("returns all three dates when deadline is far in the future", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeDefined();
    expect(result.at15d).toBeDefined();
    expect(result.at7d).toBeDefined();
  });

  it("at30d is exactly 30 days before deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d!.toISOString()).toBe("2025-05-02T00:00:00.000Z");
  });

  it("at15d is exactly 15 days before deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at15d!.toISOString()).toBe("2025-05-17T00:00:00.000Z");
  });

  it("at7d is exactly 7 days before deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at7d!.toISOString()).toBe("2025-05-25T00:00:00.000Z");
  });

  it("skips at30d when it is already past", () => {
    const deadline = new Date("2025-02-01T00:00:00.000Z");
    const now = new Date("2025-01-05T00:00:00.000Z"); // 30d before = Jan 2, already past
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeDefined();
    expect(result.at7d).toBeDefined();
  });

  it("skips at30d and at15d when both are past", () => {
    const deadline = new Date("2025-02-01T00:00:00.000Z");
    const now = new Date("2025-01-20T00:00:00.000Z"); // 15d before = Jan 17, past
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeUndefined();
    expect(result.at7d).toBeDefined();
  });

  it("skips all notifications when deadline is within 7 days", () => {
    const deadline = new Date("2025-02-01T00:00:00.000Z");
    const now = new Date("2025-01-28T00:00:00.000Z"); // 7d before = Jan 25, past
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeUndefined();
    expect(result.at7d).toBeUndefined();
  });

  it("skips all notifications when deadline is already past", () => {
    const deadline = new Date("2025-01-01T00:00:00.000Z");
    const now = new Date("2025-02-01T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeUndefined();
    expect(result.at7d).toBeUndefined();
  });

  it("includes at30d when now equals exactly the day before at30d", () => {
    const deadline = new Date("2025-03-01T00:00:00.000Z");
    // at30d = Jan 30. Now = Jan 29 → should include
    const now = new Date("2025-01-29T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeDefined();
  });

  it("excludes notification date when now equals the notification date exactly", () => {
    const deadline = new Date("2025-03-01T00:00:00.000Z");
    // at30d = Jan 30. Now = Jan 30 exactly → not future, should be excluded
    const now = new Date("2025-01-30T00:00:00.000Z");
    const result = scheduleNotifications(deadline, now);
    expect(result.at30d).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — isExpired (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Limitation domain — isExpired", () => {
  it("returns true when current date equals deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    expect(isExpired(deadline, deadline)).toBe(true);
  });

  it("returns true when current date is after deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-06-02T00:00:00.000Z");
    expect(isExpired(deadline, now)).toBe(true);
  });

  it("returns false when current date is before deadline", () => {
    const deadline = new Date("2025-06-01T00:00:00.000Z");
    const now = new Date("2025-05-31T23:59:59.999Z");
    expect(isExpired(deadline, now)).toBe(false);
  });

  it("returns false for far-future deadline", () => {
    const deadline = new Date("2030-01-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:00:00.000Z");
    expect(isExpired(deadline, now)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Limitation CRUD
// ══════════════════════════════════════════════════════════════════════════════
describe("Limitation routes — CRUD", () => {
  it("POST /v1/legal/limitations → 202 create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(),
      payload: {
        matterId: MATTER_ID,
        ruleType: "civil_suit",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 90,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
  });

  it("POST /v1/legal/limitations → 400 missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(),
      payload: { ruleType: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/limitations → 400 invalid periodDays (zero)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(),
      payload: {
        matterId: MATTER_ID,
        ruleType: "test",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 0,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/limitations → 400 invalid matterId (not uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(),
      payload: {
        matterId: "not-a-uuid",
        ruleType: "test",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 30,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/limitations → 401 no token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      payload: {
        matterId: MATTER_ID,
        ruleType: "test",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 30,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/legal/limitations → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(["citizen"]),
      payload: {
        matterId: MATTER_ID,
        ruleType: "test",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 30,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/limitations → 200 list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/limitations",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("meta");
    expect(body.meta).toHaveProperty("page");
    expect(body.meta).toHaveProperty("pageSize");
    expect(body.meta).toHaveProperty("total");
  });

  it("GET /v1/legal/limitations → 200 list with filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/limitations?matterId=${MATTER_ID}&status=active`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/limitations → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/limitations",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/limitations/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/limitations/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/limitations/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/limitations/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/legal/limitations/:id → 202 update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(),
      payload: { periodDays: 120 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("PATCH /v1/legal/limitations/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/legal/limitations/bad-uuid",
      headers: authHeader(),
      payload: { periodDays: 120 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/limitations/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(["citizen"]),
      payload: { periodDays: 120 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/legal/limitations/:id → 202 accepted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("DELETE /v1/legal/limitations/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/legal/limitations/bad-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/legal/limitations/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/legal/limitations/:id → 401 no token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/limitations/${RULE_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Audit officer read access
// ══════════════════════════════════════════════════════════════════════════════
describe("Limitation routes — audit_officer access", () => {
  it("GET /v1/legal/limitations → 200 with audit_officer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/limitations",
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/legal/limitations → 403 with audit_officer (no write)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/limitations",
      headers: authHeader(["audit_officer"]),
      payload: {
        matterId: MATTER_ID,
        ruleType: "test",
        startDate: "2024-01-01T00:00:00.000Z",
        periodDays: 30,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/legal/limitations/:id → 403 with audit_officer (no write)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(["audit_officer"]),
      payload: { periodDays: 60 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/legal/limitations/:id → 403 with audit_officer (no write)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/limitations/${RULE_UUID}`,
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
