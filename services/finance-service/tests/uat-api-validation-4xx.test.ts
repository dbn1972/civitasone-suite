/**
 * UAT API sweep 2026-10-29 (FQ10b-1): malformed query / path ids / bodies must answer 400, never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so every
 * encapsulated route context without a handler of its own kept Fastify's default handler and a
 * thrown ZodError became a 500. Also: the TRACES PAN param accepted any <=10-char string, so a
 * non-PAN reached the (disabled) adapter and answered 503.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b4";
const RND = "5e7c0000-0000-4000-8000-0000000000c4";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b4", tid: T, roles: ["super_admin", "finance_admin", "finance_officer"], sid: "sess-val" }, SECRET, 3600)}`,
};
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of ["/v1/finance/cash-book?limit=abc&offset=-5", "/v1/finance/recurring-entries?limit=abc&offset=-5"]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("malformed path param -> 400, not a ZodError 500 / adapter 503", () => {
  for (const url of [
    "/v1/finance/journals/not-a-uuid/pdf",
    "/v1/finance/journals/not-a-uuid/download",
    "/v1/finance/traces/pan-status/not-a-uuid",
    `/v1/finance/traces/pan-status/${RND}`,
  ]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }

  it("a well-formed PAN still reaches the adapter (503 INTEGRATION_DISABLED while TRACES is off)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/finance/traces/pan-status/ABCDE1234F", headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
  });
});

describe("empty / invalid / malformed body -> 400", () => {
  for (const url of [
    "/v1/finance/recurring-entries",
    "/v1/finance/legal-entities",
    "/v1/finance/operating-units",
    "/v1/finance/cost-centers",
    "/v1/finance/profit-centers",
    "/v1/finance/traces/tds-returns",
  ]) {
    it(`POST ${url} {}`, async () => {
      const res = await app.inject({ method: "POST", url, headers, payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
    it(`POST ${url} invalid fields`, async () => {
      const res = await app.inject({ method: "POST", url, headers, payload: INVALID_FIELDS });
      expect(res.statusCode).toBe(400);
    });
    it(`POST ${url} malformed JSON`, async () => {
      const res = await app.inject({ method: "POST", url, headers: { ...headers, "content-type": "application/json" }, payload: "{not json" });
      expect(res.statusCode).toBe(400);
    });
  }
});

describe("valid reads are unaffected", () => {
  for (const url of ["/v1/finance/cash-book", "/v1/finance/recurring-entries"]) {
    it(`GET ${url} -> 200`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(200);
    });
  }
});
