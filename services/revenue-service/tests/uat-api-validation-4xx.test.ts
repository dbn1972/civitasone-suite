/**
 * UAT API sweep 2026-10-29 (FQ10b-1): malformed query / path ids / bodies must answer 400, never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so every
 * encapsulated route context without a handler of its own kept Fastify's default handler and a
 * thrown ZodError became a 500 (the circuit-breaker 503s on the same service were collateral).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b3";
const RND = "5e7c0000-0000-4000-8000-0000000000c3";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b3", tid: T, roles: ["super_admin", "revenue_admin"], sid: "sess-val" }, SECRET, 3600)}`,
};
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of [
    "/v1/revenue/assessees?limit=abc&offset=-5",
    "/v1/revenue/assessments?limit=abc&offset=-5",
    "/v1/revenue/demands?limit=abc&offset=-5",
    "/v1/revenue/rate-slabs?limit=abc&offset=-5",
    "/v1/revenue/penalty-rules?limit=abc&offset=-5",
    "/v1/revenue/rebate-rules?limit=abc&offset=-5",
  ]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain("VALIDATION_FAILED");
    });
  }
});

describe("malformed id path param -> 400, not a ZodError 500", () => {
  for (const url of ["/v1/revenue/assessees/not-a-uuid", "/v1/revenue/assessees/not-a-uuid/demands", "/v1/revenue/assessees/not-a-uuid/dcb"]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("empty / invalid body -> 400 VALIDATION_FAILED naming the missing field", () => {
  for (const [method, url, field] of [
    ["POST", "/v1/revenue/assessees", "assesseeType"],
    ["PATCH", `/v1/revenue/assessees/${RND}`, "version"],
    ["POST", "/v1/revenue/assessments", "assesseeId"],
    ["PATCH", `/v1/revenue/assessments/${RND}/revise`, "version"],
    ["POST", `/v1/revenue/assessments/${RND}/remit`, "reason"],
    ["PATCH", `/v1/revenue/assessments/${RND}/remit-decide`, "approve"],
  ] as const) {
    it(`${method} ${url} {}`, async () => {
      const res = await app.inject({ method, url, headers, payload: {} });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(body)).toContain(field);
    });
    it(`${method} ${url} invalid fields`, async () => {
      const res = await app.inject({ method, url, headers, payload: INVALID_FIELDS });
      expect(res.statusCode).toBe(400);
    });
    it(`${method} ${url} malformed JSON`, async () => {
      const res = await app.inject({ method, url, headers: { ...headers, "content-type": "application/json" }, payload: "{not json" });
      expect(res.statusCode).toBe(400);
    });
  }
});

describe("valid reads are unaffected", () => {
  for (const url of ["/v1/revenue/assessments", "/v1/revenue/demands", `/v1/revenue/assessees/${RND}/dcb`]) {
    it(`GET ${url} -> 200`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(200);
    });
  }
});
