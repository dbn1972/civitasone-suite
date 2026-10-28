/**
 * UAT API sweep 2026-10-28/29: malformed query / path ids / bodies must answer 400 (or 404), never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so every
 * encapsulated route context that sets no handler of its own kept Fastify's default error handler and
 * a thrown ZodError became a 500. Also: raw :id path params reached SQL ("invalid input syntax for
 * type uuid") inside modules whose own handler maps unknown errors to 500.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b1";
const OK_ID = "5e7c0000-0000-4000-8000-0000000000c1";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b1", tid: T, roles: ["super_admin", "hr_admin"], sid: "sess-val" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of [
    "/v1/hrms/ai/risk-scores?limit=abc&offset=-5",
    "/v1/hrms/attendance/face-log",
    `/v1/hrms/employee-types/${OK_ID}/policy`,
  ]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("malformed id path param -> 400, not a uuid-syntax 500", () => {
  for (const [method, url] of [
    ["GET", "/v1/hrms/ai/attrition-risk/not-a-uuid"],
    ["GET", "/v1/hrms/ai/face/status/not-a-uuid"],
    ["GET", "/v1/hrms/employees/not-a-uuid/profile-photo"],
    ["PATCH", "/v1/hrms/id-cards/not-a-uuid/suspend"],
    ["PATCH", "/v1/hrms/id-cards/not-a-uuid/revoke"],
    ["PATCH", "/v1/hrms/id-cards/not-a-uuid/reactivate"],
    ["GET", "/v1/hrms/expenses/not-a-uuid/receipt"],
    ["GET", "/v1/hrms/goals/not-a-uuid/checkins"],
    ["GET", "/v1/hrms/pulse-surveys/not-a-uuid/results"],
  ] as const) {
    it(`${method} ${url}`, async () => {
      const res = await app.inject({ method, url, headers, ...(method === "PATCH" ? { payload: {} } : {}) });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("empty body -> 400 VALIDATION_FAILED naming the missing field", () => {
  for (const [method, url, field] of [
    ["PATCH", `/v1/hrms/ai/alerts/${OK_ID}`, "status"],
    ["POST", "/v1/hrms/attendance/verify-face", "employeeId"],
    ["POST", "/v1/hrms/ai/face/enroll", "employeeId"],
    ["POST", "/v1/hrms/ai/recruitment/score-jd", "title"],
    ["POST", `/v1/hrms/employees/${OK_ID}/profile-photo`, "photoKey"],
  ] as const) {
    it(`${method} ${url} {}`, async () => {
      const res = await app.inject({ method, url, headers, payload: {} });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(body)).toContain(field);
    });
  }

  it("PATCH /v1/hrms/ai/alerts/:id with an invalid status enum -> 400", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/hrms/ai/alerts/${OK_ID}`, headers, payload: { status: 123 } });
    expect(res.statusCode).toBe(400);
  });
});
